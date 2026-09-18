import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../server.js';

let baseUrl;
let upstream, upstreamUrl;
let seenAuth = null;
let seenBody = null;

before(async () => {
  // A fake OpenAI-compatible upstream so the proxy is tested end to end.
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seenAuth = req.headers.authorization || null;
      seenBody = Buffer.concat(chunks).toString('utf8');

      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I am ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Aditi.' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (req.url === '/v1/audio/transcriptions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ text: 'tell me about yourself' }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;


  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await new Promise((r) => app.close(r));
  await new Promise((r) => upstream.close(r));
});

test('GET /api/health reports ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, name: 'myna', version: '0.1.0' });
});

test('GET / serves the app shell', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Myna/);
  assert.match(html, /data-tab="live"/);
  assert.match(html, /\/app\.js/);
});

test('static assets are served with the right content type', async () => {
  const css = await fetch(`${baseUrl}/styles.css`);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(`${baseUrl}/lib/detect.js`);
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.match(await js.text(), /export function classifyQuestion/);
});

test('path traversal is refused', async () => {
  const a = await fetch(`${baseUrl}/../server.js`);
  const b = await fetch(`${baseUrl}/lib/../../package.json`);
  assert.equal(a.status, 404);
  assert.equal(b.status, 404);
});

test('unknown route 404s', async () => {
  assert.equal((await fetch(`${baseUrl}/nope.html`)).status, 404);
});

test('/api/chat rejects a missing endpoint and missing messages', async () => {
  const a = await fetch(`${baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert.equal(a.status, 400);
  assert.match((await a.json()).error, /endpoint/i);

  const b = await fetch(`${baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: upstreamUrl, messages: [] }) });
  assert.equal(b.status, 400);
  assert.match((await b.json()).error, /messages/i);
});

test('/api/chat rejects a non-http endpoint', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'file:///etc/passwd', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http or https/i);
});

test('/api/chat proxies through and re-assembles the SSE stream', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: upstreamUrl,
      apiKey: 'sk-test-secret',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are Myna' }, { role: 'user', content: 'Tell me about yourself' }],
    }),
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const raw = await res.text();
  const deltas = raw.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)).t);
  assert.equal(deltas.join(''), 'I am Aditi.', 'streamed deltas must reassemble into the full answer');

  // The proxy must forward the user's key and model to the upstream.
  assert.equal(seenAuth, 'Bearer sk-test-secret');
  const body = JSON.parse(seenBody);
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.messages.length, 2);
  assert.equal(body.stream, true);
});

test('/api/chat surfaces upstream errors with their status', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: upstreamUrl.replace('/v1', '/wrong'), model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Upstream 404/);
});

test('/api/chat gives an actionable message when the endpoint is unreachable', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'http://127.0.0.1:9/v1', model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /Could not reach/);
  assert.match(body.detail, /Ollama/);
});

test('/api/transcribe forwards base64 audio and returns the text', async () => {
  const b64 = Buffer.from('fake-audio-bytes').toString('base64');
  const res = await fetch(`${baseUrl}/api/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: upstreamUrl, apiKey: 'sk-test', audioB64: b64 }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, 'tell me about yourself');
});

test('/api/transcribe requires audio', async () => {
  const res = await fetch(`${baseUrl}/api/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: upstreamUrl }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /audioB64/);
});
