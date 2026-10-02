/* Two phones, two real browsers, one trip. Needs Playwright + Chromium.
   node test/sync_e2e.js   (starts test/fake-sync-server.js itself) */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(process.env.PW_HOME || '/root/work', 'node_modules', 'playwright'))); }

const PORT = 8800 + Math.floor(Math.random() * 900), BASE = 'http://localhost:' + PORT;
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
function assert(c, label, extra) { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ FAIL: ' + label + (extra ? ' — ' + extra : '')); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { try { if (await fn()) return true; } catch (e) {} await sleep(80); } return false; }

(async () => {
  const srv = global.__srv = spawn(process.execPath, [path.join(__dirname, 'fake-sync-server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.once('data', r));
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
  const fake = fs.readFileSync(path.join(__dirname, 'fake-sync.js'), 'utf8');
  const errors = [];
  async function phone(name, scheme) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme || 'light' });
    /* like Firebase Auth, the anonymous uid survives reloads (kept in this browser's storage) */
    await ctx.addInitScript(fake + '\n;(function(){ const c = BilloFakeSync.FakeClient(BilloFakeSync.httpTransport(location.origin), { uid: localStorage.getItem("__fakeuid") }); const r = c.ready; c.ready = async () => { const u = await r(); localStorage.setItem("__fakeuid", u); return u; }; window.BILLO_BACKEND = window.__fake = c; })();');
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/index.html');
    await p.fill('#w_name', name); await p.click('[data-act="welcome-go"]');
    return p;
  }
  const click = async (p, sel) => { await p.click(sel); await sleep(120); };
  const text = p => p.innerText('#screen');
  const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };

  const jay = await phone('Jay'), rahul = await phone('Rahul', 'dark');

  console.log('\nJay starts a trip and turns on live sync');
  await click(jay, '[data-act="new-trip"]');
  await jay.fill('#nt_name', 'Goa Trip');
  for (const n of ['Rahul', 'Priya']) { await jay.fill('#nt_member', n); await click(jay, '[data-act="nt-add-member"]'); }
  await click(jay, '[data-act="nt-create"]');
  assert(await jay.isVisible('[data-act="sync-on"]'), 'trip shows the "Share this trip live" card');
  await click(jay, '[data-act="trip-add"] >> nth=0'); await click(jay, '[data-act="tab-quick"]');
  await jay.fill('#f_amount', '6000'); await jay.fill('#f_desc', 'Hotel');
  await click(jay, '[data-act="confirm-draft"]'); await click(jay, '[data-act="done-trip"]');
  await shot(jay, 'e2e-1-cta');
  await click(jay, '[data-act="sync-on"]');
  await shot(jay, 'e2e-2-consent');
  await jay.evaluate(() => { window.__shared = null; window.Billo = { shareText: t => { window.__shared = t; } }; });
  await click(jay, '[data-act="sync-on-go"]');
  await until(() => jay.evaluate(() => isStrongCode(curTrip().code)));
  const code = await jay.evaluate(() => curTrip().code);
  assert(/^GOA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(code), 'strong join code ' + code);
  assert(await until(async () => (await jay.innerText('#modalRoot')).includes(code)), 'invite sheet shows the code');
  await shot(jay, 'e2e-invite');
  await click(jay, '[data-act="invite-share"]');
  const shared = await jay.evaluate(() => window.__shared || '');
  assert(shared.includes(code) && !shared.includes('{app}') && shared.includes('#join=' + code), 'invite text has the code and a join link', shared);
  await click(jay, '.mactions [data-act="modal-cancel"]');
  assert(await until(async () => /LIVE/.test(await text(jay))), 'Jay’s trip goes LIVE');
  assert((await text(jay)).includes(code), 'code stays visible on the trip screen');
  await shot(jay, 'e2e-live-code');
  await shot(jay, 'e2e-3-live');

  console.log('\nRahul taps the invite link');
  await rahul.goto(BASE + '/index.html#join=' + code);
  await sleep(300);
  assert(await until(async () => /Which one are you/.test(await text(rahul))), 'Rahul is asked which member he is');
  await shot(rahul, 'e2e-4-pick');
  await click(rahul, '.pickrow:has-text("Rahul")');
  assert(await until(async () => /HOTEL/.test(await text(rahul))), 'Rahul sees Jay’s hotel bill');
  assert(/You owe Jay/.test(await text(rahul)), 'Rahul’s balance is his own ("You owe Jay")');
  await shot(rahul, 'e2e-5-joined');

  console.log('\nbills flow both ways');
  await click(rahul, '[data-act="trip-add"] >> nth=0'); await click(rahul, '[data-act="tab-quick"]');
  await rahul.fill('#f_amount', '1500'); await rahul.fill('#f_desc', 'Scooty rental');
  await click(rahul, '[data-act="pay"]:has-text("Rahul")');
  await click(rahul, '[data-act="confirm-draft"]'); await click(rahul, '[data-act="done-trip"]');
  assert(await until(async () => /SCOOTY RENTAL/.test(await text(jay))), 'Jay sees Rahul’s scooty bill without doing anything');
  const net = p => p.evaluate(() => { const t = curTrip(), c = computeTrip(t); return t.members.map(m => m.name + ':' + c.net[m.id]).join(','); });
  assert(await until(async () => (await net(jay)) === (await net(rahul))), 'both phones show the same balances', (await net(jay)) + ' vs ' + (await net(rahul)));

  console.log('\nwhile Jay is typing a bill, Rahul’s changes do not wipe his draft');
  await click(jay, '[data-act="trip-add"] >> nth=0'); await click(jay, '[data-act="tab-quick"]');
  await jay.fill('#f_amount', '777'); await jay.fill('#f_desc', 'Half-typed');
  await rahul.evaluate(() => { const t = curTrip(); t.members.find(m => m.self).upi = 'rahul@ybl'; save(); });
  await sleep(500);
  assert((await jay.inputValue('#f_amount')) === '777' && (await jay.inputValue('#f_desc')) === 'Half-typed', 'draft untouched');
  await click(jay, '[data-act="cancel-draft"]');
  assert(await until(() => jay.evaluate(() => (curTrip().members.find(m => m.name === 'Rahul') || {}).upi === 'rahul@ybl')), 'Rahul’s UPI ID arrived on Jay’s phone');

  console.log('\nJay pays Rahul by UPI; the payment reaches Rahul');
  const jayOwes = await jay.evaluate(() => { const t = curTrip(); return computeTrip(t).flows.some(f => f.from === meIdOf(t)); });
  if (jayOwes) {
    await jay.evaluate(() => { window.Billo = { openExternal: u => { window.__opened = u; } }; });
    await click(jay, '.hero [data-act="upi-pay"]'); await sleep(1400);
    await click(jay, '[data-act="modal-ok"]');
    assert((await jay.evaluate(() => window.__opened || '')).includes('rahul%40ybl'), 'UPI link uses Rahul’s synced UPI ID');
  } else {
    await click(jay, '[data-act="mark-paid"] >> nth=0');
  }
  await click(jay, '.btnrow [data-act="paid-close"]');
  assert(await until(async () => (await rahul.evaluate(() => curTrip().payments.length)) === 1), 'Rahul sees the payment');

  console.log('\nRahul goes offline, adds a bill; Jay deletes one; they reconnect');
  await rahul.evaluate(() => window.__fake.setOnline(false));
  await rahul.evaluate(() => window.dispatchEvent(new Event('offline')));
  await click(rahul, '[data-act="trip-add"] >> nth=0'); await click(rahul, '[data-act="tab-quick"]');
  await rahul.fill('#f_amount', '420'); await rahul.fill('#f_desc', 'Chai and snacks');
  await click(rahul, '[data-act="confirm-draft"]'); await click(rahul, '[data-act="done-trip"]');
  assert(/OFFLINE|SAVING/.test(await text(rahul)), 'Rahul’s header says the change will sync later');
  await shot(rahul, 'e2e-6-offline');
  await jay.evaluate(() => { const t = curTrip(); t.expenses = t.expenses.filter(e => e.desc !== 'Scooty rental'); save(); render(); });
  await sleep(300);
  assert(/SCOOTY/.test(await text(rahul)), 'offline Rahul has not heard about the delete yet');
  await rahul.evaluate(() => window.__fake.setOnline(true));
  assert(await until(async () => /CHAI AND SNACKS/.test(await text(jay))), 'Jay gets Rahul’s offline bill after reconnect');
  assert(await until(async () => !/SCOOTY/.test(await text(rahul))), 'Rahul gets Jay’s delete after reconnect');
  assert(await until(async () => /LIVE/.test(await text(rahul))), 'Rahul is LIVE again');
  assert(await until(async () => (await net(jay)) === (await net(rahul))), 'balances agree after reconnect');

  console.log('\nreload keeps everything (local copy + sync resumes)');
  await rahul.reload();
  await click(rahul, '[data-act="open-trip"] >> nth=0');
  assert(await until(async () => /LIVE/.test(await text(rahul)) && /CHAI AND SNACKS/.test(await text(rahul))), 'after reload Rahul’s trip is live with all bills');
  const st = await (await fetch(BASE + '/__state')).json();
  assert(!JSON.stringify(st).includes('data:image'), 'no photo data on the server');

  console.log('\nerrors: ' + (errors.length ? errors.join(' | ') : 'none'));
  assert(errors.length === 0, 'no page errors');
  await browser.close(); srv.kill();
  console.log('\n' + (fail ? '❌ ' + fail + ' FAILED, ' : '') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); try { global.__srv && global.__srv.kill(); } catch (x) {} process.exit(1); });
