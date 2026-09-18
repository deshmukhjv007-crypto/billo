/**
 * Myna — model client.
 *
 * Talks to the local proxy (/api/chat), which forwards to whatever
 * OpenAI-compatible endpoint the user configured. The API key never ships in
 * code; it lives in localStorage and is sent per request.
 */

export function hasKey(cfg) {
  return !!(cfg && cfg.endpoint && cfg.model);
}

/**
 * Streaming completion. `onDelta` is called with each text chunk as it arrives.
 * Returns the full text.
 */
export async function streamChat(cfg, messages, { onDelta = () => {}, temperature = 0.4, max_tokens = 900 } = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      stream: true,
      temperature,
      max_tokens,
    }),
  });

  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  // Non-streaming fallback (some local servers ignore `stream`).
  if (!type.includes('text/event-stream')) {
    const json = await res.json();
    const text = json.content ?? '';
    if (text) onDelta(text);
    return text;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = '';
  let full = '';

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
        if (json.error) throw new Error(json.error);
        if (json.t) { full += json.t; onDelta(json.t); }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

/** Non-streaming convenience wrapper. */
export async function complete(cfg, messages, opts = {}) {
  let full = '';
  await streamChat(cfg, messages, { ...opts, onDelta: (d) => { full += d; opts.onDelta && opts.onDelta(d); } });
  return full;
}

/** Latency + reachability probe used by the "Test connection" button. */
export async function probe(cfg) {
  const t0 = performance.now();
  const text = await complete(cfg, [
    { role: 'user', content: 'Reply with the single word: ready' },
  ], { max_tokens: 8, temperature: 0 });
  return { ok: true, ms: Math.round(performance.now() - t0), reply: text.trim() };
}

/** Minimal, safe markdown → HTML for the panels. Escapes first, then formats. */
export function mdToHtml(md) {
  const esc = String(md || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const blocks = [];
  const withCode = esc.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code data-lang="${lang}">${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const html = withCode
    .split('\n')
    .map((line) => {
      if (/^\u0000\d+\u0000$/.test(line.trim())) return line.trim();
      if (/^###\s+/.test(line)) return `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`;
      if (/^##\s+/.test(line)) return `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`;
      if (/^#\s+/.test(line)) return `<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`;
      if (/^\s*[-*]\s+/.test(line)) return `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
      if (/^\s*\d+[.)]\s+/.test(line)) return `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`;
      if (!line.trim()) return '';
      return `<p>${inline(line)}</p>`;
    })
    .join('\n')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);

  return html;
}

function inline(s) {
  return String(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
