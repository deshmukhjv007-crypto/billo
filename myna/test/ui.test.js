/**
 * UI boot test.
 *
 * Boots the real app.js inside jsdom with the real index.html, so every
 * getElementById binding and every event handler is actually executed — not
 * re-implemented. The model call is stubbed at `fetch` so the whole answer
 * pipeline (prompt → streamChat → SSE parse → render) runs for real.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let dom, window, document, bundlePath, tmpDir;

/** Rewrite the browser-absolute imports ("/lib/x.js") to file:// URLs. */
function bundleApp() {
  const src = readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  return src
    .replace(/from '\/lib\//g, `from '${pathToFileURL(path.join(ROOT, 'lib')).href}/`)
    .replace(/from '\/stt\.js'/g, `from '${pathToFileURL(path.join(ROOT, 'public/stt.js')).href}'`)
    .replace(/from '\/llm\.js'/g, `from '${pathToFileURL(path.join(ROOT, 'public/llm.js')).href}'`);
}

/** A minimal OpenAI-style SSE response so streamChat has something real to parse. */
function sseResponse(chunks) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: c })}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

let fetchCalls = [];
function stubFetch(reply) {
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init?.body || '{}') });
    return reply;
  };
}

const tick = () => new Promise((r) => setImmediate(r));

before(async () => {
  dom = new JSDOM(readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), {
    url: 'http://localhost:4173/',
    pretendToBeVisual: true,
  });
  window = dom.window;
  document = window.document;

  // Install browser globals before importing app.js — its boot code runs on import.
  // Some (navigator, localStorage) are getter-only on Node's globalThis, so defineProperty.
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  def('window', window);
  def('document', document);
  def('navigator', window.navigator);
  def('localStorage', window.localStorage);
  def('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  def('cancelAnimationFrame', (id) => clearTimeout(id));
  def('Blob', window.Blob);
  def('alert', () => {});
  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};
  stubFetch(sseResponse(['stub answer']));

  tmpDir = mkdtempSync(path.join(tmpdir(), 'myna-ui-'));
  bundlePath = path.join(tmpDir, 'app.bundle.mjs');
  writeFileSync(bundlePath, bundleApp());
  await import(pathToFileURL(bundlePath).href); // <- the real app boot
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  dom.window.close();
});

beforeEach(() => { fetchCalls = []; });

const $ = (id) => document.getElementById(id);
const click = (id) => $(id).dispatchEvent(new window.Event('click', { bubbles: true }));

test('app boots and renders its initial state', () => {
  assert.equal($('engineTxt').textContent, 'engine idle');
  assert.match($('sttPillTxt').textContent, /no speech API/);
  assert.equal($('qCount').textContent, '0');
  assert.match($('transcript').textContent, /waiting/);
  assert.ok($('qList').querySelectorAll('[data-ans]').length === 0);
});

test('all five tabs switch panes', () => {
  const btns = [...document.querySelectorAll('nav.tabs button')];
  assert.equal(btns.length, 5);
  btns.find((b) => b.dataset.tab === 'coding').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(!document.querySelector('[data-pane="coding"]').classList.contains('hidden'));
  assert.ok(document.querySelector('[data-pane="setup"]').classList.contains('hidden'));
});

test('Load a sample resume fills the resume field', () => {
  click('loadSample');
  assert.match($('pResume').value, /Aditi Sharma/);
  assert.match($('pResume').value, /2\.1M transactions/);
});

test('setup fields persist to localStorage as they are typed', () => {
  $('pRole').value = 'Staff Engineer';
  $('pRole').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('aiModel').value = 'gpt-4o';
  $('aiModel').dispatchEvent(new window.Event('input', { bubbles: true }));

  const saved = JSON.parse(window.localStorage.getItem('myna.v1'));
  assert.equal(saved.profile.role, 'Staff Engineer');
  assert.equal(saved.cfg.model, 'gpt-4o');
});

test('manual entry adds a turn, detects the question and classifies it', async () => {
  $('manualIn').value = 'Tell me about a time you handled a production outage.';
  click('manualAdd');
  await tick();

  assert.match($('transcript').textContent, /production outage/);
  assert.equal($('qCount').textContent, '1');
  const q = $('qList').querySelector('.q');
  assert.match(q.textContent, /behavioral/);
  assert.equal($('qList').querySelectorAll('[data-ans]').length, 1);
});

test('Answer builds a resume-aware prompt, streams the model reply and renders it', async () => {
  stubFetch(sseResponse(['At my last job ', 'the payout service failed.']));
  $('qList').querySelector('[data-ans]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(); await tick(); await tick();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/api/chat');
  const sent = fetchCalls[0].body;
  assert.equal(sent.model, 'gpt-4o');
  assert.ok(sent.messages[0].content.includes('Myna'), 'system prompt must be sent');
  assert.ok(sent.messages[0].content.includes('Aditi Sharma'), 'resume must be injected into the system prompt');
  assert.ok(sent.messages[1].content.includes('production outage'), 'the detected question must be in the user prompt');

  assert.equal($('answerOut').textContent.trim(), 'At my last job the payout service failed.');
});

test('the question is marked answered and can be re-answered', () => {
  assert.ok($('qList').querySelector('.q').classList.contains('answered'));
  assert.match($('qList').querySelector('[data-ans]').textContent, /Answer again/);
});

test('candidate turns are attributed to the candidate and do not become questions', async () => {
  click('spkCandidate');
  $('manualIn').value = 'We migrated the monolith to four services.';
  click('manualAdd');
  await tick();
  assert.equal($('qCount').textContent, '1', 'a statement must not be counted as a question');
  assert.ok($('transcript').innerHTML.includes('turn candidate'));
});

test('Debrief renders computed metrics from the live transcript', () => {
  [...document.querySelectorAll('nav.tabs button')].find((b) => b.dataset.tab === 'debrief')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  const cells = [...$('metricGrid').querySelectorAll('.metric')];
  assert.equal(cells.length, 8);
  const labels = cells.map((c) => c.querySelector('.k').textContent);
  assert.ok(labels.includes('Your talk share'));
  assert.ok(labels.includes('Words / minute'));
  assert.equal($('qaTable').querySelectorAll('tbody tr').length, 1);
  assert.match($('qaTable').textContent, /production outage/);
  assert.ok($('tipList').textContent.length > 10);
});

test('Mock interview asks an offline question from the bank when no model is reachable', async () => {
  stubFetch(sseResponse([''])); // upstream returns nothing usable
  [...document.querySelectorAll('nav.tabs button')].find((b) => b.dataset.tab === 'mock')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  $('mockKind').value = 'behavioral';
  click('mockStart');
  await tick(); await tick(); await tick();

  assert.equal($('mockCount').textContent, '1');
  assert.ok($('mockOut').textContent.length > 30, 'a question should be on screen');
  assert.equal($('mockList').querySelectorAll('.q').length, 1);
});

test('Mock interview cycles the offline bank instead of repeating the first question', async () => {
  stubFetch(sseResponse([''])); // no model output — every ask falls back to the bank
  $('mockKind').value = 'company'; // smallest selectable bank (3 questions) so it exhausts fast
  click('mockStart');
  await tick(); await tick(); await tick();
  for (let i = 0; i < 4; i++) { // 5 asks total against a 3-question bank → exhausts it
    click('mockNext');
    await tick(); await tick(); await tick();
  }

  const asked = [...$('mockList').querySelectorAll('.txt')].map((n) => n.textContent);
  assert.equal(asked.length, 5);
  assert.equal(new Set(asked.slice(0, 3)).size, 3, 'the first pass asks each bank question once');
  assert.equal(asked[3], asked[0], 'an exhausted bank restarts from the top');
  assert.notEqual(asked[4], asked[3], 'it must keep cycling, not stall on question #1');
});

test('Coding tab refuses to run with an empty problem and solves a pasted one', async () => {
  [...document.querySelectorAll('nav.tabs button')].find((b) => b.dataset.tab === 'coding')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  let alerted = null;
  globalThis.alert = (m) => { alerted = m; };
  click('codeRun');
  assert.match(alerted, /Paste the problem/);

  stubFetch(sseResponse(['```python\ndef two_sum(nums, target):\n    pass\n```']));
  $('codeProblem').value = 'Write a function that returns the two indices summing to a target.';
  $('codeLang').value = 'Python';
  click('codeRun');
  await tick(); await tick(); await tick();

  assert.ok(fetchCalls.some((c) => c.body.messages.some((m) => /Write a function/.test(m.content))));
  assert.ok(fetchCalls.at(-1).body.messages.some((m) => /Python/.test(m.content)), 'language choice must reach the prompt');
  assert.match($('codeOut').textContent, /two_sum/);
});

test('Test connection reports success from the probe', async () => {
  stubFetch(sseResponse(['ready']));
  [...document.querySelectorAll('nav.tabs button')].find((b) => b.dataset.tab === 'setup')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  click('testAi');
  await tick(); await tick(); await tick();
  assert.match($('aiPillTxt').textContent, /connected/);
  assert.match($('aiTestOut').textContent, /Connected in \d+ ms/);
});

test('Test connection surfaces a failure instead of hanging', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401, headers: { 'content-type': 'application/json' } });
  click('testAi');
  await tick(); await tick(); await tick();
  assert.match($('aiPillTxt').textContent, /failed/);
  assert.match($('aiTestOut').textContent, /401/);
});
