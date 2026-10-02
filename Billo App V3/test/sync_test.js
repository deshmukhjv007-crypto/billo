/* Billo live-sync tests: several "phones" (each its own copy of the app logic) syncing through
   the fake Firestore in fake-sync.js. Run: node test/sync_test.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { FakeServer, FakeClient, directTransport } = require('./fake-sync');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const logic = html.match(/<script>([\s\S]*)<\/script>/)[1].split('/* ===== UI ===== */')[0];

let pass = 0, fail = 0;
function assert(c, label, extra) { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ FAIL: ' + label + (extra ? ' — ' + extra : '')); } }
function eq(a, b, label) { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, label, A + ' !== ' + B); }
const tick = (ms) => new Promise(r => setTimeout(r, ms || 5));
async function settle() { for (let i = 0; i < 6; i++) await tick(3); }

/* a phone = isolated app logic + a fake Firestore client + the sync engine */
function Phone(server, name) {
  const ctx = { console, Intl, Date, Math, JSON, Object, Array, String, Number, RegExp, parseFloat, isNaN, Promise, Set, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(logic, ctx);
  const client = FakeClient(directTransport(server), { latency: 1 });
  const state = { trips: [] };
  let changes = 0;
  ctx.__backend = client; ctx.__state = state;
  ctx.__persist = () => {}; ctx.__changed = () => { changes++; };
  const sync = vm.runInContext('createSync({ backend: __backend, trips: () => __state.trips, persist: () => __persist(), changed: id => __changed(id) })', ctx);
  const J = e => vm.runInContext(e, ctx);
  ctx.meName = name;
  return {
    name, ctx, client, sync, state, J,
    trip(i) { return state.trips[i || 0]; },
    /* app-style edit: mutate then push, exactly like save() does */
    edit(fn) { fn(state.trips[0], ctx); sync.pushAll(); },
    nets() { const t = state.trips[0]; ctx.__t = t; return J('(function(){ const c = computeTrip(__t); const o = {}; __t.members.forEach(m => o[m.name] = c.net[m.id]); return o; })()'); },
    bills() { return state.trips[0].expenses.map(e => e.desc + ':' + e.amount).sort(); },
    get changes() { return changes; }
  };
}
function newTrip(p) {
  const t = {
    id: 't1', name: 'Goa Trip', emoji: '🏖️', code: 'GOA-1234', currency: 'INR', createdAt: 1, learn: {},
    members: [{ id: 'mJ', name: 'Jay', self: true, upi: 'jay@okicici' }, { id: 'mR', name: 'Rahul' }, { id: 'mP', name: 'Priya' }],
    expenses: [
      { id: 'e1', ts: 10, desc: 'Villa', cat: 'hotel', amount: 20000, currency: 'INR', date: '2026-09-22', payerId: 'mR', parts: ['mJ', 'mR', 'mP'], custom: false, customAmts: null, settled: false, src: 'form', raw: '', ai: false, img: 'data:image/jpeg;base64,SECRET', items: null, extra: 0 },
      { id: 'e2', ts: 20, desc: 'Dinner', cat: 'food', amount: 3000, currency: 'INR', date: '2026-09-23', payerId: 'mJ', parts: ['mJ', 'mR', 'mP'], custom: false, customAmts: null, settled: false, src: 'text', raw: 'paid 3000 dinner', ai: false, img: '', items: null, extra: 0 }
    ],
    payments: []
  };
  p.state.trips.push(t);
  return t;
}
const bill = (id, desc, amount, payer, ts) => ({ id, ts, desc, cat: 'other', amount, currency: 'INR', date: '2026-09-24', payerId: payer, parts: ['mJ', 'mR', 'mP'], custom: false, customAmts: null, settled: false, src: 'form', raw: '', ai: false, img: '', items: null, extra: 0 });

(async () => {
  console.log('\njoin codes');
  {
    const p = Phone(FakeServer(), 'x');
    const c = p.J('makeJoinCode("Goa Trip")');
    assert(p.J('isStrongCode(' + JSON.stringify(c) + ')'), 'code looks like GOA-XXXX-XXXX', c);
    assert(/^GOA-/.test(c), 'prefix from trip name');
    eq(p.J('normJoinCode("goa 7k2q x9mb")'), 'GOA-7K2Q-X9MB', 'normalises spaces/case');
    eq(p.J('normJoinCode("GOA7K2QX9MB")'), 'GOA-7K2Q-X9MB', 'adds dashes');
    eq(p.J('normJoinCode("GOA-1234")'), '', 'old short local code is not a join code');
    eq(p.J('normJoinCode("GOA-7K2Q-X9M0")'), '', 'rejects look-alike 0');
    const ids = new Set(); for (let i = 0; i < 200; i++) ids.add(p.J('makeRemoteId()'));
    assert(ids.size === 200, 'remote ids are unique (200)');
    eq(p.J('makeRemoteId()').length, 22, 'remote id length 22');
  }

  console.log('\nshare a trip and join it');
  const server = FakeServer();
  const jay = Phone(server, 'Jay'), rahul = Phone(server, 'Rahul');
  const t = newTrip(jay);
  const code = await jay.sync.enable(t);
  assert(t.sync && t.sync.on, 'trip marked synced');
  eq(t.code, code, 'trip code replaced by strong join code');
  const rid = await rahul.sync.lookup(code.toLowerCase().replace(/-/g, ' '));
  eq(rid, t.sync.remoteId, 'lookup finds the trip from a sloppily typed code');
  eq(await rahul.sync.lookup('GOA-2222-3333'), null, 'unknown code → null');
  const meta = await rahul.sync.join(rid);
  eq(Object.keys(meta.members).length, 3, 'joiner sees the member list before choosing');
  rahul.sync.adopt(rid, meta, 'mR');
  jay.sync.start();
  await settle();
  eq(rahul.bills(), ['Dinner:3000', 'Villa:20000'], 'joiner gets all bills');
  assert(rahul.trip().members.find(m => m.id === 'mR').self, 'joiner is "you" as Rahul');
  assert(!rahul.trip().members.find(m => m.id === 'mJ').self, 'Jay is not "you" on Rahul’s phone');
  eq(rahul.trip().expenses.find(e => e.id === 'e1').img, '', 'receipt photo did not leave Jay’s phone');
  assert(!JSON.stringify(server._trips).includes('SECRET'), 'server never saw the photo');
  eq(jay.trip().expenses.find(e => e.id === 'e1').img, 'data:image/jpeg;base64,SECRET', 'Jay keeps his photo');
  eq(rahul.nets(), jay.nets(), 'both phones compute the same balances');
  eq(rahul.trip().members.find(m => m.id === 'mJ').upi, 'jay@okicici', 'UPI IDs travel with members');

  console.log('\nlive edits both ways');
  rahul.edit(tr => tr.expenses.unshift(bill('e3', 'Cab', 900, 'mR', 30)));
  await settle();
  eq(jay.bills(), ['Cab:900', 'Dinner:3000', 'Villa:20000'], 'Rahul’s bill shows up on Jay’s phone');
  jay.edit(tr => { tr.expenses.find(e => e.id === 'e2').amount = 3300; });
  await settle();
  eq(rahul.trip().expenses.find(e => e.id === 'e2').amount, 3300, 'Jay’s edit shows up on Rahul’s phone');
  eq(rahul.nets(), jay.nets(), 'balances agree after edits');

  console.log('\nconcurrent edits to different bills both survive');
  jay.edit(tr => { tr.expenses.find(e => e.id === 'e1').desc = 'Villa (2 nights)'; });
  rahul.edit(tr => { tr.expenses.find(e => e.id === 'e3').amount = 950; });
  await settle();
  eq(jay.bills(), ['Cab:950', 'Dinner:3300', 'Villa (2 nights):20000'], 'Jay has both edits');
  eq(rahul.bills(), jay.bills(), 'Rahul has both edits');

  console.log('\ndeletes, payments, members');
  rahul.edit(tr => { tr.expenses = tr.expenses.filter(e => e.id !== 'e3'); });
  await settle();
  eq(jay.bills(), ['Dinner:3300', 'Villa (2 nights):20000'], 'delete propagates');
  jay.edit(tr => { tr.payments.push({ id: 'p1', from: 'mJ', to: 'mR', amount: 500, ts: 40, via: 'upi' }); });
  await settle();
  eq(rahul.trip().payments.map(p => p.amount), [500], 'payment propagates');
  rahul.edit(tr => { tr.payments = []; });
  await settle();
  eq(jay.trip().payments.length, 0, 'undoing a payment propagates');
  rahul.edit(tr => { tr.members.push({ id: 'mA', name: 'Amit', at: 99 }); tr.members.find(m => m.id === 'mR').upi = 'rahul@ybl'; });
  await settle();
  eq(jay.trip().members.map(m => m.name), ['Jay', 'Rahul', 'Priya', 'Amit'], 'new member appears, order kept');
  eq(jay.trip().members.find(m => m.id === 'mR').upi, 'rahul@ybl', 'UPI edit propagates');
  jay.edit(tr => { tr.name = 'Goa 2026'; tr.budget = 40000; });
  await settle();
  eq([rahul.trip().name, rahul.trip().budget], ['Goa 2026', 40000], 'trip name + budget propagate');
  eq(rahul.trip().code, code, 'code stays the same');

  console.log('\noffline, then back');
  await rahul.client.setOnline(false);
  rahul.edit(tr => tr.expenses.unshift(bill('e4', 'Scooty', 600, 'mR', 50)));
  jay.edit(tr => { tr.expenses = tr.expenses.filter(e => e.id !== 'e2'); });
  await settle();
  eq(rahul.bills(), ['Dinner:3300', 'Scooty:600', 'Villa (2 nights):20000'], 'offline phone keeps its own bill (and has not heard of the delete)');
  eq(rahul.sync.status(rahul.trip()).state, 'offline', 'status shows offline (changes will sync)');
  await rahul.client.setOnline(true);
  await settle();
  eq(rahul.bills(), ['Scooty:600', 'Villa (2 nights):20000'], 'after reconnect Rahul has the delete…');
  eq(jay.bills(), ['Scooty:600', 'Villa (2 nights):20000'], '…and Jay has the offline bill');
  eq(rahul.sync.status(rahul.trip()).state, 'live', 'status back to live');
  eq(rahul.nets(), jay.nets(), 'balances agree after reconnect');

  console.log('\na third phone joins as a new person');
  const priya = Phone(server, 'Priya D');
  const m3 = await priya.sync.join(await priya.sync.lookup(code));
  priya.sync.adopt(t.sync.remoteId, m3, '__new__', 'Priya D');
  await settle();
  eq(jay.trip().members.map(m => m.name), ['Jay', 'Rahul', 'Priya', 'Amit', 'Priya D'], 'new person appears for everyone');
  assert(priya.trip().members.find(m => m.name === 'Priya D').self, 'and is "you" on her phone');
  eq(priya.bills(), jay.bills(), 'third phone has every bill');

  console.log('\noutsiders and leaving');
  const eve = Phone(server, 'Eve');
  await eve.client.ready();
  let err = null;
  eve.state.trips.push({ id: 'x', name: 'x', members: [], expenses: [], payments: [], sync: { on: true, remoteId: t.sync.remoteId, memberId: null, base: null } });
  eve.sync.start();
  await settle();
  eq(eve.sync.status(eve.trip()).state, 'removed', 'a phone that never joined gets no data');
  eq(eve.trip().expenses.length, 0, 'and sees no bills');
  await priya.sync.leave(priya.trip());
  await settle();
  assert(server._trips[t.sync.remoteId].meta.uids.length === 2, 'leaving removes that phone from the trip');

  console.log('\ncold start offline');
  {
    const p = Phone(FakeServer(), 'x');
    const evs = [];
    p.ctx.__stub = { ready: async () => 'u', watch: (id, cb) => { evs.push(cb); return () => {}; }, apply: async () => {} };
    const sy = p.J('createSync({ backend: __stub, trips: () => __state.trips, persist: () => {}, changed: () => {} })');
    p.state.trips.push({ id: 'z', name: 'z', members: [], expenses: [], payments: [], sync: { on: true, remoteId: 'R', memberId: null, base: null } });
    sy.start();
    evs[0]({ part: 'meta', data: null, info: { fromCache: true } });
    eq(sy.status(p.trip()).state, 'offline', 'no cached copy yet while offline → "offline", not "removed"');
    evs[0]({ part: 'meta', data: null, info: { fromCache: false } });
    eq(sy.status(p.trip()).state, 'removed', 'server says it is gone → "removed"');
  }

  console.log('\nconvergence under random concurrent + offline edits (25 seeds × 3 phones × 80 rounds)');
  let allSame = true, allServer = true, firstBad = '';
  for (let S0 = 1; S0 <= 25; S0++) {
    const srv = FakeServer();
    const A = Phone(srv, 'Jay'), Bp = Phone(srv, 'Rahul'), C = Phone(srv, 'Priya');
    newTrip(A);
    const c2 = await A.sync.enable(A.trip());
    for (const [p, mid] of [[Bp, 'mR'], [C, 'mP']]) { const r = await p.sync.lookup(c2); p.sync.adopt(r, await p.sync.join(r), mid); }
    await settle();
    let seed = S0 * 7919; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    const phones = [A, Bp, C]; let k = 100;
    for (let round = 0; round < 80; round++) {
      const p = phones[Math.floor(rnd() * 3)];
      const r = rnd();
      if (r < 0.12) await p.client.setOnline(!(p.client.pendingCount() >= 0 && rnd() < 0.5));
      else if (r < 0.5) p.edit(tr => tr.expenses.unshift(bill('r' + (k++), 'B' + k, Math.round(rnd() * 5000) + 1, ['mJ', 'mR', 'mP'][Math.floor(rnd() * 3)], k)));
      else if (r < 0.7) p.edit(tr => { const e = tr.expenses[Math.floor(rnd() * tr.expenses.length)]; if (e) e.amount = Math.round(rnd() * 5000) + 1; });
      else if (r < 0.85) p.edit(tr => { if (tr.expenses.length > 1) tr.expenses.splice(Math.floor(rnd() * tr.expenses.length), 1); });
      else p.edit(tr => { tr.payments.push({ id: 'q' + (k++), from: 'mP', to: 'mR', amount: Math.round(rnd() * 900) + 1, ts: k }); });
      if (rnd() < 0.4) await settle();
    }
    for (const p of phones) await p.client.setOnline(true);
    await settle(); await settle();
    const snap = p => JSON.stringify([p.bills(), p.trip().payments.map(x => x.id + ':' + x.amount).sort(), p.nets()]);
    if (!(snap(A) === snap(Bp) && snap(Bp) === snap(C))) { allSame = false; firstBad = firstBad || ('seed ' + S0 + ': ' + snap(A).slice(0, 150) + ' | ' + snap(C).slice(0, 150)); }
    const s = srv._trips[A.trip().sync.remoteId];
    const serverBills = Object.values(s.expenses).filter(e => !e.deleted).map(e => e.desc + ':' + e.amount).sort();
    if (JSON.stringify(A.bills()) !== JSON.stringify(serverBills)) allServer = false;
  }
  assert(allSame, 'all three phones end identical, every seed', firstBad);
  assert(allServer, 'and identical to the server, every seed');

  console.log('\n' + (fail ? '❌ ' + fail + ' FAILED, ' : '') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
