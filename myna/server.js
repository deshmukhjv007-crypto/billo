#!/usr/bin/env node
/**
 * Myna — server.
 *
 * Zero dependencies. Two jobs:
 *   1. Serve the app (public/ at /, lib/ at /lib/) so ES-module imports work.
 *   2. Proxy LLM calls so the browser never needs CORS and the API key is never
 *      embedded in shipped code — the key lives in the user's own localStorage
 *      and is sent per-request by the user's own browser.
 *
 *   POST /api/chat        → OpenAI-compatible /chat/completions (SSE passthrough)
 *   POST /api/transcribe  → OpenAI-compatible /audio/transcriptions (Whisper)
 *   GET  /api/health
 *
 * Nothing is logged to disk. Sessions are never recorded by this server.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MB — room for an audio upload

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

const ROOTS = { '/lib/': path.join(__dirname, 'lib'), '/': path.join(__dirname, 'public') };

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

/** Reject path traversal and resolve to a real file under an allowed root. */
function resolveStatic(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = clean === '/' ? '/index.html' : clean;
  for (const [prefix, root] of Object.entries(ROOTS)) {
    if (!rel.startsWith(prefix)) continue;
    const full = path.normalize(path.join(root, rel.slice(prefix.length)));
    if (!full.startsWith(root)) return null; // traversal attempt
    return full;
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function requireEndpoint({ endpoint }) {
  if (!endpoint) throw Object.assign(new Error('Missing `endpoint`.'), { status: 400 });
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    throw Object.assign(new Error('`endpoint` is not a valid URL.'), { status: 400 });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('`endpoint` must be http or https.'), { status: 400 });
  }
  return u;
}

/** OpenAI-compatible chat completions, with optional SSE streaming passthrough. */
async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return sendJSON(res, 400, { error: 'Request body must be valid JSON.' });
  }

  const { endpoint, apiKey, model, messages, stream = true, temperature = 0.4, max_tokens = 900 } = payload;
  if (!Array.isArray(messages) || !messages.length) return sendJSON(res, 400, { error: '`messages` must be a non-empty array.' });

  let base;
  try {
    base = requireEndpoint({ endpoint });
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const url = new URL(base.pathname.replace(/\/$/, '') + '/chat/completions', base);
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages, stream: !!stream, temperature, max_tokens }),
    });
  } catch (e) {
    return sendJSON(res, 502, {
      error: `Could not reach ${url.origin}`,
      detail: `${e?.message || e}. Is the endpoint running and reachable from this machine? For a local server (Ollama, LM Studio) check the port and that it serves /v1.`,
    });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return sendJSON(res, upstream.status, { error: `Upstream ${upstream.status}`, detail: text.slice(0, 2000) });
  }

  if (!stream || !upstream.body) {
    const data = await upstream.json();
    return sendJSON(res, 200, { content: data?.choices?.[0]?.message?.content ?? '', raw: data });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Pass through only the delta text as `data: {"t":"..."}` lines, then close.
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let carry = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
          if (delta) res.write(`data: ${JSON.stringify({ t: delta })}\n\n`);
        } catch {
          /* keep-alive comment lines etc. */
        }
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`);
  } finally {
    res.end();
  }
}

/** Whisper-compatible transcription. Audio arrives base64-encoded from the browser. */
async function handleTranscribe(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch {
    return sendJSON(res, 400, { error: 'Request body must be valid JSON.' });
  }

  const { endpoint, apiKey, model = 'whisper-1', audioB64, language, filename = 'audio.webm', mimeType = 'audio/webm' } = payload;
  if (!audioB64) return sendJSON(res, 400, { error: 'Missing `audioB64`.' });

  let base;
  try {
    base = requireEndpoint({ endpoint });
  } catch (e) {
    return sendJSON(res, e.status || 400, { error: e.message });
  }

  const bytes = Buffer.from(audioB64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  form.append('model', model);
  if (language) form.append('language', language);

  const url = new URL(base.pathname.replace(/\/$/, '') + '/audio/transcriptions', base);
  const upstream = await fetch(url, {
    method: 'POST',
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: form,
  });

  const text = await upstream.text();
  if (!upstream.ok) return sendJSON(res, upstream.status, { error: `Upstream ${upstream.status}`, detail: text.slice(0, 2000) });

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return sendJSON(res, 200, { text: json.text ?? '', raw: json });
}

async function handleStatic(req, res, urlPath) {
  const file = resolveStatic(urlPath);
  if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  try {
    const st = await stat(file);
    if (st.isDirectory()) return handleStatic(req, res, path.posix.join(urlPath, 'index.html'));
    const body = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, body, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // The preview is served from a different origin; allow the app itself freely.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    if (req.method === 'GET' && p === '/api/health') return sendJSON(res, 200, { ok: true, name: 'myna', version: '0.1.0' });
    if (req.method === 'POST' && p === '/api/chat') return await handleChat(req, res);
    if (req.method === 'POST' && p === '/api/transcribe') return await handleTranscribe(req, res);
    if (req.method === 'GET') return await handleStatic(req, res, p);
    return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
  } catch (e) {
    return sendJSON(res, 500, { error: String(e?.message || e) });
  }
});

export default server;
export function createApp() { return server; }

// Only bind a port when run directly (`node server.js`), not when imported by tests.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  server.listen(PORT, HOST, () => {
    console.log(`Myna interview copilot → http://${HOST}:${PORT}`);
  });
}

