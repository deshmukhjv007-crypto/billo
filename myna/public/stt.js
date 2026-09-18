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
  const mimeType = blob.type || 'audio/webm';
  const ext = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }[mimeType.split(';')[0]] || 'webm';
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.sttModel || 'whisper-1',
      language: language ? language.split('-')[0] : undefined,
      audioB64,
      filename: `myna-audio.${ext}`,
      mimeType,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
  return json.text || '';
}

/**
 * Whisper-on-silence hallucinations we never want to drop into the transcript.
 */
const WHISPER_NOISE_RE = /^[\s\W]*(thank\s?you|thanks|thank you so much|thanks for watching|thank you for watching|bye|you)[\s.!…]*$/i;

/**
 * Capture the interviewer's voice from a meeting tab / window and transcribe it
 * in small chunks through the configured Whisper endpoint.
 *
 * Why this exists: SpeechRecognition only listens to the microphone. In an
 * online interview the other side's voice comes out of the speakers, so the
 * mic channel never hears a single interview question. Browsers cannot route a
 * MediaStream into SpeechRecognition, so the only way to hear the interviewer
 * is display-capture audio + chunked Whisper transcription.
 *
 * Chunking detail: MediaRecorder timeslice chunks after the first are not
 * independently decodable, so each chunk is a fresh stop()/start() pair — the
 * next recorder starts immediately while the finished chunk uploads in the
 * background.
 *
 * @param {object} o
 * @param {object} o.cfg           proxy config (endpoint / apiKey / sttModel)
 * @param {string} o.language      BCP-47 tag
 * @param {(text:string)=>void} o.onText   one call per transcribed chunk
 * @param {(state:'listening'|'stopped'|'error', detail?:string)=>void} o.onState
 * @param {number} o.chunkMs       chunk length (default 4s — latency vs. accuracy trade-off)
 */
export async function createSpeakerChannel({ cfg, language, onText = () => {}, onState = () => {}, chunkMs = 4000 } = {}) {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    onState('error', 'This browser cannot capture tab audio. Use desktop Chrome or Edge — or paste what the interviewer said into the manual box.');
    return { supported: false, stop() {} };
  }

  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const audioTracks = display.getAudioTracks();
  if (!audioTracks.length) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('No audio was shared. Pick the meeting TAB in the chooser and tick "Also share tab audio" (on Windows, "Also share system audio" works for the whole call).');
  }
  display.getVideoTracks().forEach((t) => t.stop()); // we only need the sound
  const stream = new MediaStream(audioTracks);
  const audioTrack = audioTracks[0];

  let stopped = false;
  audioTrack.addEventListener('ended', () => {
    stopped = true;
    onState('stopped', 'Audio sharing was stopped from the browser bar.');
  });

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';

  const runChunk = () => {
    if (stopped) return;
    let rec;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      stopped = true;
      onState('error', `Could not record the shared audio: ${e?.message || e}`);
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      runChunk(); // start the next chunk immediately — don't wait for Whisper
      if (stopped || blob.size < 2000) return;
      transcribeFile({ blob, cfg, language })
        .then((text) => {
          const t = String(text || '').trim();
          if (t && !WHISPER_NOISE_RE.test(t)) onText(t);
        })
        .catch((e) => {
          stopped = true;
          onState('error', `Transcription failed: ${e.message}`);
        });
    };
    try {
      rec.start();
    } catch (e) {
      stopped = true;
      onState('error', `Could not record the shared audio: ${e?.message || e}`);
      return;
    }
    setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, chunkMs);
  };

  runChunk();
  onState('listening');
  return {
    supported: true,
    stream,
    stop() {
      stopped = true;
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      onState('stopped');
    },
  };
}
