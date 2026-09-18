/**
 * Myna — speech capture.
 *
 * Three sources, in order of preference:
 *   1. Web Speech API  (Chrome/Edge) — live interim + final transcripts.
 *   2. Manual entry    — the user types/pastes what was said.
 *   3. File upload     — decoded to base64 and sent to a Whisper-compatible endpoint.
 *
 * Plus a mic-level meter and an optional local recording so a session can be
 * re-transcribed afterwards. Audio is never uploaded automatically.
 */

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function sttSupported() {
  return !!SR;
}

/**
 * @param {object} o
 * @param {string} o.lang            BCP-47 tag
 * @param {(text:string, isFinal:boolean)=>void} o.onResult
 * @param {(state:'listening'|'stopped'|'error', detail?:string)=>void} o.onState
 */
export function createListener({ lang = 'en-IN', onResult = () => {}, onState = () => {} } = {}) {
  if (!SR) {
    return {
      supported: false,
      start() { onState('error', 'This browser has no SpeechRecognition API. Use Chrome or Edge, or type the transcript in.'); },
      stop() {},
    };
  }

  let rec = null;
  let stopped = false;
  let restartTimer = null;

  const build = () => {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.maxAlternatives = 1;

    r.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        onResult(res[0].transcript, res.isFinal);
      }
    };
    r.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // Chrome noise; auto-restarts
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        stopped = true;
        onState('error', 'Microphone permission denied. Allow it in the browser, then start again.');
        return;
      }
      onState('error', `Recognition error: ${ev.error}`);
    };
    // Chrome ends the stream roughly every 60s; restart unless we asked it to stop.
    r.onend = () => {
      if (stopped) { onState('stopped'); return; }
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => { try { r.start(); } catch { /* already started */ } }, 120);
    };
    return r;
  };

  return {
    supported: true,
    start() {
      stopped = false;
      rec = build();
      try {
        rec.start();
        onState('listening');
      } catch (e) {
        onState('error', String(e?.message || e));
      }
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      try { rec && rec.stop(); } catch { /* noop */ }
      onState('stopped');
    },
  };
}

/** Live mic level (0–1) for the meter, plus the stream so we can record it. */
export async function openMic({ onLevel = () => {} } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    onLevel(Math.min(1, peak * 2.2));
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    stream,
    close() {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

/** Record the mic locally so a round can be re-transcribed later. Nothing is uploaded. */
export function createRecorder(stream) {
  if (typeof MediaRecorder === 'undefined') return null;
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  return {
    start() { try { rec.start(1000); } catch { /* already recording */ } },
    stop() {
      return new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        try { rec.stop(); } catch { resolve(null); }
      });
    },
  };
}

export function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/** Send audio to a Whisper-compatible /audio/transcriptions through the local proxy. */
export async function transcribeFile({ blob, cfg, language }) {
  const audioB64 = await blobToB64(blob);
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.sttModel || 'whisper-1',
      language: language ? language.split('-')[0] : undefined,
      audioB64,
      filename: 'myna-audio.webm',
      mimeType: blob.type || 'audio/webm',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
  return json.text || '';
}
