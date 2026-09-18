/**
 * Myna — app orchestration.
 *
 * Wires the UI to the pure logic in /lib (question detection, analytics,
 * prompts) and to the speech + model clients. State is local to this browser.
 */
import { extractQuestions, classifyQuestion, isQuestion } from '/lib/detect.js';
import { analyzeSession, pairQuestionsWithAnswers, starCoverage, countWords } from '/lib/analyze.js';
import { systemPrompt, answerPrompt, mockQuestionPrompt, codingPrompt, debriefPrompt, scaffoldAnswer, KIND_COACHING } from '/lib/prompt.js';
import { createListener, sttSupported, openMic, createRecorder, transcribeFile, blobToB64 } from '/stt.js';
import { streamChat, complete, probe, mdToHtml, hasKey } from '/llm.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'myna.v1';

/* ------------------------------------------------------------------ state */
const state = {
  profile: { candidate: '', role: '', company: '', resume: '', jd: '', extra: '', lang: 'en-IN' },
  cfg: { endpoint: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', sttModel: 'whisper-1' },
  turns: [],            // {speaker, text, t}
  questions: [],        // {text, kind, answered}
  seen: new Set(),
  startedAt: 0,
  listening: false,
  speaker: 'interviewer',
  pending: '',          // interim text of the in-flight turn
  pendingSince: 0,
  timer: 0,
  currentAnswer: '',
  mic: null,
  recorder: null,
  listener: null,
  mock: { index: 0, asked: [], round: [] },
};

/* --------------------------------------------------------- offline bank */
const BANK = {
  behavioral: [
    'Tell me about a time you had to deliver something with a deadline you knew you would miss.',
    'Describe a conflict with a teammate and how it ended.',
    'Tell me about a mistake you made in production. What did you change afterwards?',
    'Give me an example of a time you had to influence someone who did not report to you.',
    'Tell me about the project you are most proud of, and what specifically you did on it.',
  ],
  technical: [
    'Explain the difference between a process and a thread, and when you would pick one.',
    'How does a database index actually speed up a query, and what does it cost you?',
    'What is the difference between horizontal and vertical scaling?',
    'Explain what happens between typing a URL and the page rendering.',
    'When would you reach for a queue instead of a direct call?',
  ],
  'system-design': [
    'Design a rate limiter for a public API doing 10,000 requests per second.',
    'Design a URL shortener that has to survive a regional outage.',
    'Design the notification service for an app with 50 million daily users.',
    'How would you design an idempotent payment retry path?',
  ],
  coding: [
    'Given a stream of integers, return the running median at each step.',
    'Write a function that finds the longest substring without repeating characters.',
    'Given a list of meeting intervals, return the minimum number of rooms needed.',
    'Implement an LRU cache with O(1) get and put.',
  ],
  situational: [
    'Your production service starts returning 500s five minutes after a deploy. Walk me through the first ten minutes.',
    'A stakeholder asks for a feature you are sure is the wrong thing to build. What do you do?',
    'You inherit a codebase with no tests and a launch in six weeks. How do you start?',
  ],
  company: [
    'Why do you want to work here specifically?',
    'What do you know about our product?',
    'Where do you see yourself in three years?',
  ],
  logistics: [
    'What are your salary expectations?',
    'What is your notice period, and is it negotiable?',
    'Why are you leaving your current role?',
  ],
  intro: ['Tell me about yourself.', 'Walk me through your background.'],
};

const OFFLINE_FEEDBACK = (a) => {
  const s = starCoverage(a);
  const w = countWords(a);
  const bits = [];
  if (w < 40) bits.push(`Only ${w} words — you are under-answering. A behavioural answer needs 150–220.`);
  if (w > 320) bits.push(`${w} words is a monologue. Cut to the action and the result.`);
  bits.push(`STAR coverage ${Math.round(s.score * 100)}% — ${['situation', 'task', 'action', 'result'].filter((k) => !s[k]).map((k) => k).join(', ') || 'all four present'}.`);
  if (!s.result) bits.push('No measurable result. Every STAR story should end in a number.');
  if (!s.action) bits.push('No first-person action verbs — it reads as something that happened *to* you.');
  bits.push('Offline mode: configure an API key in Setup for model-written feedback and a rewritten version.');
  return bits.map((b) => `- ${b}`).join('\n');
};

/* ------------------------------------------------------------- persistence */
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ profile: state.profile, cfg: state.cfg })); } catch { /* private mode */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state.profile, d.profile || {});
    Object.assign(state.cfg, d.cfg || {});
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------- tabs */
function selectTab(name) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
  if (name === 'debrief') renderDebrief();
}

/* ----------------------------------------------------------------- setup */
function bindSetup() {
  const fields = { pName: 'candidate', pRole: 'role', pCompany: 'company', pResume: 'resume', pJd: 'jd', pExtra: 'extra', pLang: 'lang' };
  for (const [id, key] of Object.entries(fields)) {
    $(id).value = state.profile[key] || '';
    $(id).addEventListener('input', () => { state.profile[key] = $(id).value; save(); });
  }
  const cfgFields = { aiEndpoint: 'endpoint', aiKey: 'apiKey', aiModel: 'model' };
  for (const [id, key] of Object.entries(cfgFields)) {
    $(id).value = state.cfg[key] || '';
    $(id).addEventListener('input', () => { state.cfg[key] = $(id).value.trim(); save(); setAiPill('not tested'); });
  }

  $('pResumeFile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('pResume').value = await f.text();
    state.profile.resume = $('pResume').value;
    save();
  });

  $('loadSample').addEventListener('click', () => {
    $('pResume').value = SAMPLE_RESUME;
    state.profile.resume = SAMPLE_RESUME;
    save();
  });

  $('testAi').addEventListener('click', async () => {
    if (!hasKey(state.cfg)) return showAiTest('Set a base URL and a model first.', 'bad');
    setAiPill('testing…');
    try {
      const r = await probe(state.cfg);
      setAiPill('connected', true);
      showAiTest(`Connected in ${r.ms} ms. Model replied: "${r.reply || '(empty)'}"`, 'ok');
    } catch (e) {
      setAiPill('failed');
      showAiTest(`Failed: ${e.message}`, 'bad');
    }
  });

  $('testMic').addEventListener('click', async () => {
    if (!sttSupported()) return setSttPill('no speech API — use Chrome/Edge', false);
    try {
      const mic = await openMic({ onLevel: () => {} });
      mic.close();
      setSttPill('microphone ready', true);
    } catch (e) {
      setSttPill(`denied: ${e.message}`, false);
    }
  });

  $('doTranscribe').addEventListener('click', async () => {
    const f = $('audioFile').files?.[0];
    if (!f) return alert('Choose an audio file first.');
    if (!hasKey(state.cfg)) return alert('Set a base URL and model in the AI panel first.');
    setSttPill('transcribing…');
    try {
      const text = await transcribeFile({ blob: f, cfg: state.cfg, language: state.profile.lang });
      ingestManual(text, 'interviewer');
      setSttPill('transcribed', true);
      selectTab('live');
    } catch (e) {
      setSttPill('failed', false);
      alert(`Transcription failed: ${e.message}`);
    }
  });

  $('policyLink').addEventListener('click', (e) => { e.preventDefault(); $('policy').scrollIntoView({ behavior: 'smooth' }); });
}

function setAiPill(txt, ok) {
  $('aiPillTxt').textContent = txt;
  $('aiPill').classList.toggle('ok', !!ok);
}
function setSttPill(txt, ok) {
  $('sttPillTxt').textContent = txt;
  $('sttPill').classList.toggle('ok', !!ok);
  $('sttPill').classList.toggle('bad', ok === false);
}
function showAiTest(msg, kind) {
  const el = $('aiTestOut');
  el.className = `notice ${kind === 'bad' ? 'bad' : 'info'}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ------------------------------------------------------------------ live */
function now() { return state.startedAt ? Date.now() - state.startedAt : 0; }
function mmss(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function pushTurn(speaker, text) {
  const t = text.trim();
  if (!t) return;
  state.turns.push({ speaker, text: t, t: now() });
  rescanQuestions();
  renderTranscript();
}

function ingestManual(text, speaker = state.speaker) {
  if (!state.startedAt) state.startedAt = Date.now();
  String(text || '').split(/\n+/).filter((l) => l.trim()).forEach((l) => pushTurn(speaker, l));
}

function bindLive() {
  $('btnListen').addEventListener('click', startListening);
  $('btnStop').addEventListener('click', stopListening);
  $('spkInterviewer').addEventListener('click', () => setSpeaker('interviewer'));
  $('spkCandidate').addEventListener('click', () => setSpeaker('candidate'));
  $('overlayOn').addEventListener('change', (e) => $('overlay').classList.toggle('on', e.target.checked));
  $('overlayClose').addEventListener('click', () => { $('overlay').classList.remove('on'); $('overlayOn').checked = false; });

  $('manualAdd').addEventListener('click', submitManual);
  $('manualIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitManual(); });

  $('copyAnswer').addEventListener('click', () => {
    if (!state.currentAnswer) return;
    navigator.clipboard.writeText(state.currentAnswer).then(() => flash($('copyAnswer'), 'Copied'));
  });
  $('regenAnswer').addEventListener('click', () => {
    const last = [...state.questions].reverse().find((q) => q.answered);
    if (last) answerQuestion(last, { askedAgain: true });
  });
  $('toOverlay').addEventListener('click', () => {
    $('overlay').classList.add('on');
    $('overlayOn').checked = true;
    $('overlayBody').textContent = state.currentAnswer || '—';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'a' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    const last = state.questions[state.questions.length - 1];
    if (last) answerQuestion(last, { askedAgain: last.answered });
  });

  makeDraggable($('overlay'), $('overlayHead'));
  setSpeaker('interviewer');
}

function submitManual() {
  const v = $('manualIn').value;
  if (!v.trim()) return;
  $('manualIn').value = '';
  ingestManual(v);
}

function setSpeaker(s) {
  state.speaker = s;
  $('spkInterviewer').classList.toggle('primary', s === 'interviewer');
  $('spkCandidate').classList.toggle('primary', s === 'candidate');
}

async function startListening() {
  if (!state.startedAt) state.startedAt = Date.now();
  state.listening = true;
  $('btnListen').disabled = true;
  $('btnStop').disabled = false;
  setEngine('listening', true);

  clearInterval(state.timer);
  state.timer = setInterval(() => { $('clock').textContent = mmss(now()); }, 500);

  try {
    state.mic = await openMic({ onLevel: (v) => { $('micLevel').style.width = `${Math.round(v * 100)}%`; } });
    state.recorder = createRecorder(state.mic.stream);
    state.recorder?.start();
  } catch (e) {
    setEngine('mic blocked', false);
    setSttPill(`mic denied: ${e.message}`, false);
  }

  state.listener = createListener({
    lang: state.profile.lang || 'en-IN',
    onState: (s, detail) => {
      if (s === 'error') { setEngine(detail || 'error', false); setSttPill(detail || 'error', false); }
    },
    onResult: (text, isFinal) => {
      if (isFinal) {
        state.pending = '';
        pushTurn(state.speaker, text);
      } else {
        state.pending = text;
        state.pendingSince = now();
        renderTranscript();
      }
    },
  });

  if (!state.listener.supported) {
    setEngine('no speech API', false);
    setSttPill('no SpeechRecognition — type instead', false);
  } else {
    state.listener.start();
    setSttPill('live', true);
  }
}

async function stopListening() {
  state.listening = false;
  clearInterval(state.timer);
  $('btnListen').disabled = false;
  $('btnStop').disabled = true;
  setEngine('stopped', false);
  state.listener?.stop();
  state.mic?.close();
  state.mic = null;
  $('micLevel').style.width = '0%';
  if (state.recorder) {
    const blob = await state.recorder.stop();
    state.recorder = null;
    if (blob && blob.size > 1000) window.__mynaLastRecording = blob; // available for re-transcription
  }
}

function setEngine(txt, live) {
  $('engineTxt').textContent = txt;
  $('enginePill').classList.toggle('live', !!live);
  $('enginePill').classList.toggle('ok', !live && txt !== 'engine idle');
}

/* --------------------------------------------------------- questions UI */
function interviewerText() {
  return state.turns.filter((t) => t.speaker === 'interviewer').map((t) => t.text).join(' ');
}

function rescanQuestions() {
  const found = extractQuestions(interviewerText(), state.seen);
  if (!found.length) return;
  for (const q of found) state.questions.push({ ...q, answered: false });
  renderQuestions();
  if ($('autoAnswer').checked) {
    const last = state.questions[state.questions.length - 1];
    if (last) answerQuestion(last);
  }
}

function renderTranscript() {
  const box = $('transcript');
  if (!state.turns.length && !state.pending) {
    box.innerHTML = '<div class="turn"><div class="who">waiting</div>Start listening, or type above.</div>';
    return;
  }
  const rows = state.turns.map((t) => `
    <div class="turn ${t.speaker}">
      <div class="who"><span>${t.speaker === 'candidate' ? '🗣 You' : '🎧 Interviewer'}</span><span class="t">${mmss(t.t)}</span></div>
      <div>${escapeHtml(t.text)}</div>
    </div>`);
  if (state.pending) {
    rows.push(`<div class="turn ${state.speaker} pending"><div class="who"><span>listening…</span></div>${escapeHtml(state.pending)}</div>`);
  }
  box.innerHTML = rows.join('');
  box.scrollTop = box.scrollHeight;
}

function renderQuestions() {
  $('qCount').textContent = state.questions.length;
  if (!state.questions.length) {
    $('qList').innerHTML = '<div class="q" style="border-left-color:var(--line)"><div class="txt" style="margin:0;color:var(--muted)">Nothing yet.</div></div>';
    return;
  }
  $('qList').innerHTML = state.questions.map((q, i) => `
    <div class="q ${q.answered ? 'answered' : ''}">
      <div class="kind">${q.kind}</div>
      <div class="txt">${escapeHtml(q.text)}</div>
      <button class="btn sm" data-ans="${i}">${q.answered ? 'Answer again' : 'Answer'}</button>
    </div>`).join('');
  $('qList').querySelectorAll('[data-ans]').forEach((b) =>
    b.addEventListener('click', () => answerQuestion(state.questions[Number(b.dataset.ans)], { askedAgain: true })));
}

/* -------------------------------------------------------------- answering */
async function answerQuestion(q, { askedAgain = false } = {}) {
  q.answered = true;
  renderQuestions();
  const out = $('answerOut');
  out.textContent = 'Thinking…';
  $('overlayBody').textContent = 'Thinking…';

  const messages = [
    { role: 'system', content: systemPrompt(state.profile, { mode: 'live' }) },
    { role: 'user', content: answerPrompt(q.text, { kind: q.kind, askedAgain }) },
  ];

  if (!hasKey(state.cfg)) {
    // Offline scaffold: honest, labelled, built from the candidate's own resume.
    const text = scaffoldAnswer(q.text, { kind: q.kind, resume: state.profile.resume, role: state.profile.role });
    streamOut(out, text);
    state.currentAnswer = text;
    return;
  }

  try {
    const full = await streamChat(state.cfg, messages, { onDelta: () => {} , temperature: 0.45 });
    streamOut(out, full);
    state.currentAnswer = full;
    $('overlayBody').textContent = full;
  } catch (e) {
    out.textContent = `Model error: ${e.message}\n\nFalling back to an offline scaffold.\n\n` +
      scaffoldAnswer(q.text, { kind: q.kind, resume: state.profile.resume, role: state.profile.role });
    state.currentAnswer = out.textContent;
    // The overlay was set to "Thinking…" above — don't leave it stuck there.
    $('overlayBody').textContent = out.textContent;
  }
}

function streamOut(el, text) {
  el.innerHTML = mdToHtml(text);
}

/* ----------------------------------------------------------------- mock */
function bindMock() {
  $('mockStart').addEventListener('click', () => startMock(true));
  $('mockNext').addEventListener('click', () => nextMockQuestion());
  $('mockSubmit').addEventListener('click', submitMockAnswer);
  $('mockMic').addEventListener('click', toggleMockMic);
}

function bankFor(kind) {
  if (kind === 'mixed') {
    const order = ['intro', 'behavioral', 'technical', 'system-design', 'situational', 'company', 'logistics'];
    return order.flatMap((k) => BANK[k]);
  }
  return BANK[kind] || BANK.behavioral;
}

async function startMock(fresh) {
  if (fresh) { state.mock = { index: 0, asked: [], round: [] }; $('mockList').innerHTML = ''; }
  $('mockNext').disabled = false;
  await nextMockQuestion();
}

async function nextMockQuestion() {
  const kind = $('mockKind').value;
  const focus = $('mockFocus').value.trim();
  setMockPill('asking…');
  $('mockNext').disabled = true;

  let question = '';
  if (hasKey(state.cfg)) {
    try {
      question = (await complete(state.cfg, [
        { role: 'system', content: systemPrompt(state.profile, { mode: 'mock' }) },
        { role: 'user', content: mockQuestionPrompt({ kind, index: state.mock.index, focus, previous: state.mock.asked }) },
      ], { temperature: 0.9, max_tokens: 90 })).trim().replace(/^["'\d.)\s]+|["']+$/g, '');
    } catch (e) {
      question = '';
    }
  }
  if (!question) {
    const bank = bankFor(kind);
    const pool = bank.filter((q) => !state.mock.asked.includes(q));
    // Once every bank question has been asked, cycle the full bank — the old
    // `index % Math.max(pool.length, 1)` collapsed to modulo 1 and repeated
    // the first question forever.
    const source = pool.length ? pool : bank;
    question = source[state.mock.index % source.length];
  }

  state.mock.asked.push(question);
  state.mock.index++;
  $('mockCount').textContent = state.mock.asked.length;
  $('mockList').innerHTML = state.mock.asked
    .map((q, i) => `<div class="q"><div class="kind">${i + 1}</div><div class="txt" style="margin:0">${escapeHtml(q)}</div></div>`).join('');
  $('mockOut').innerHTML = `<h3>Question ${state.mock.index}</h3><p><strong>${escapeHtml(question)}</strong></p><p style="color:var(--muted);font-size:13.5px">Type or speak your answer, then submit. Coaching brief: ${escapeHtml(KIND_COACHING[classifyQuestion(question)] || KIND_COACHING.other)}</p>`;
  $('mockAnswer').value = '';
  $('mockAnswer').focus();
  setMockPill('your turn');
}

async function submitMockAnswer() {
  const a = $('mockAnswer').value.trim();
  const q = state.mock.asked[state.mock.asked.length - 1];
  if (!a) return alert('Answer first — type it or use the mic.');
  setMockPill('coaching…');

  const s = starCoverage(a);
  const local = OFFLINE_FEEDBACK(a);
  let ai = '';

  if (hasKey(state.cfg)) {
    try {
      ai = await complete(state.cfg, [
        { role: 'system', content: systemPrompt(state.profile, { mode: 'debrief' }) },
        { role: 'user', content: [
          `The interviewer asked: "${q}"`,
          `The candidate answered (${countWords(a)} words, STAR coverage ${Math.round(s.score * 100)}%):`,
          a,
          '',
          'Give: (1) a 2-sentence verdict, (2) the single biggest thing that lost marks, (3) a rewritten answer in the candidate\'s voice, under 200 words, no fabrication.',
        ].join('\n') },
      ], { temperature: 0.4, max_tokens: 700 });
    } catch (e) {
      ai = `_Model error: ${e.message}_`;
    }
  }

  state.mock.round.push({ q, a, star: s });
  $('mockOut').innerHTML = `
    <h3>Question ${state.mock.index}</h3><p><strong>${escapeHtml(q)}</strong></p>
    <h3>Feedback</h3>${mdToHtml(ai || '')}
    <h3>Automated checks</h3>${mdToHtml(local)}
    <p class="star">STAR ${s.situation ? '<b>S</b>' : '<i>S</i>'}${s.task ? '<b>T</b>' : '<i>T</i>'}${s.action ? '<b>A</b>' : '<i>A</i>'}${s.result ? '<b>R</b>' : '<i>R</i>'}</p>`;
  $('mockNext').disabled = false;
  setMockPill('ready');
}

let mockListener = null;
async function toggleMockMic() {
  if (mockListener) { mockListener.stop(); mockListener = null; $('mockMic').textContent = '🎙 Answer by voice'; setMockPill('ready'); return; }
  mockListener = createListener({
    lang: state.profile.lang,
    onState: (s, d) => setMockPill(s === 'error' ? d : s),
    onResult: (text, isFinal) => {
      $('mockAnswer').value += (isFinal ? text + ' ' : '');
    },
  });
  if (!mockListener.supported) return setMockPill('no speech API');
  mockListener.start();
  $('mockMic').textContent = '■ Stop mic';
}

function setMockPill(t) { $('mockPillTxt').textContent = t; }

/* --------------------------------------------------------------- coding */
function bindCoding() {
  $('codeRun').addEventListener('click', () => runCoding(false));
  $('codeExplain').addEventListener('click', () => runCoding(true));
}

async function runCoding(explainOnly) {
  const problem = $('codeProblem').value.trim();
  if (!problem) return alert('Paste the problem statement first.');
  const out = $('codeOut');
  out.textContent = 'Working…';

  if (!hasKey(state.cfg)) {
    return (out.innerHTML = mdToHtml([
      '**Offline mode — no model configured.**',
      'Add a base URL and model in Setup for a real solution. Meanwhile, run this structure:',
      `1. Restate the problem in one sentence and name the constraint (n? duplicates? sorted? in-place?).`,
      `2. Brute force first, out loud, with its complexity.`,
      `3. The optimisation, and *why* it is valid.`,
      `4. Code. Then edge cases: ${explainOnly ? '' : 'empty input, single element, all-equal, very large n.'}`,
      '',
      `Detected question type: **${classifyQuestion(problem)}**.`,
    ].join('\n\n')));
  }

  const messages = [
    { role: 'system', content: systemPrompt(state.profile, { mode: 'coding' }) },
    { role: 'user', content: codingPrompt(problem, { language: $('codeLang').value, notes: $('codeNotes').value }) },
  ];
  if (explainOnly) messages.push({ role: 'user', content: 'Do not write code. Explain the approach, the trade-offs and the complexity only.' });

  try {
    const full = await streamChat(state.cfg, messages, { temperature: 0.2, max_tokens: 1400 });
    out.innerHTML = mdToHtml(full);
  } catch (e) {
    out.textContent = `Model error: ${e.message}`;
  }
}

/* -------------------------------------------------------------- debrief */
function debriefData() {
  const durationMs = state.turns.length ? Math.max(now(), 1) : 0;
  const { metrics, tips } = analyzeSession(state.turns, { durationMs });
  const qs = extractQuestions(interviewerText());
  const pairs = pairQuestionsWithAnswers(state.turns, qs);
  return { metrics, tips, pairs };
}

function renderDebrief() {
  const { metrics: m, tips, pairs } = debriefData();

  const talkCls = m.talkShare > 78 ? 'warn' : m.talkShare >= 40 ? 'good' : 'warn';
  const wpmCls = m.wpm > 175 ? 'warn' : m.wpm >= 100 ? 'good' : m.wpm ? 'warn' : '';
  const fillerCls = m.fillerRate > 6 ? 'bad' : m.fillerRate > 3 ? 'warn' : 'good';

  $('metricGrid').innerHTML = [
    card(mmss(m.durationMs), 'Session length', `${state.turns.length} turns`),
    card(`${m.talkShare}%`, 'Your talk share', 'healthy 60–70%', talkCls),
    card(m.wpm ? m.wpm : '–', 'Words / minute', 'healthy 120–150', wpmCls),
    card(`${m.fillerRate}`, 'Fillers / 100 words', `${m.fillerTotal} total`, m.candidateWords ? fillerCls : ''),
    card(`${m.hedgeRate}`, 'Hedges / 100 words', `${m.hedgeTotal} total`, m.hedgeRate > 4 ? 'warn' : 'good'),
    card(m.ownershipRatio === null ? '–' : `${m.ownershipRatio}%`, '"I" vs "we"', `${m.iStatements} I · ${m.weStatements} we`, m.ownershipRatio !== null && m.ownershipRatio < 45 ? 'warn' : 'good'),
    card(String(pairs.length), 'Questions captured', `${pairs.filter((p) => p.words > 0).length} with an answer`),
    card(pairs.length ? `${Math.round((pairs.reduce((n, p) => n + p.star.score, 0) / pairs.length) * 100)}%` : '–', 'Avg STAR coverage', 'per behavioural answer'),
  ].join('');

  $('tipList').innerHTML = tips.map((t) => `<div class="tip ${t.level === 'warn' ? '' : t.level}">${escapeHtml(t.tip)}</div>`).join('') ||
    '<div class="tip info">No transcript yet. Run a session in the Live tab.</div>';

  $('qaTable').querySelector('tbody').innerHTML = pairs.length
    ? pairs.map((p, i) => `<tr>
        <td>${i + 1}</td>
        <td><span class="kind" style="color:var(--warn);font-size:10.5px;text-transform:uppercase;letter-spacing:.6px">${p.kind}</span><br/>${escapeHtml(p.question.slice(0, 160))}${p.answer ? `<div style="color:var(--muted);font-size:12px;margin-top:5px">${escapeHtml(p.answer.slice(0, 220))}${p.answer.length > 220 ? '…' : ''}</div>` : ''}</td>
        <td>${p.words}</td>
        <td class="star">${p.star.situation ? '<b>S</b>' : '<i>S</i>'}${p.star.task ? '<b>T</b>' : '<i>T</i>'}${p.star.action ? '<b>A</b>' : '<i>A</i>'}${p.star.result ? '<b>R</b>' : '<i>R</i>'}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" style="color:var(--muted)">No questions captured yet.</td></tr>';
}

function card(v, k, s, cls = '') {
  return `<div class="metric"><div class="v ${cls}">${v}</div><div class="k">${k}</div><div class="s">${s}</div></div>`;
}

function bindDebrief() {
  $('runDebrief').addEventListener('click', async () => {
    const d = debriefData();
    if (!d.pairs.length) return alert('Nothing to debrief yet — run a session in the Live tab.');
    const out = $('debriefOut');
    if (!hasKey(state.cfg)) {
      out.innerHTML = mdToHtml([
        '**Offline mode — numbers only, no model commentary.**',
        ...d.tips.map((t) => `- ${t.tip}`),
        '',
        `Questions captured: ${d.pairs.length}. Answers with content: ${d.pairs.filter((p) => p.words > 0).length}.`,
        'Add an API key in Setup for the written debrief.',
      ].join('\n'));
      return;
    }
    out.textContent = 'Writing debrief…';
    try {
      const full = await complete(state.cfg, [
        { role: 'system', content: systemPrompt(state.profile, { mode: 'debrief' }) },
        { role: 'user', content: debriefPrompt(d) },
      ], { temperature: 0.4, max_tokens: 1500 });
      out.innerHTML = mdToHtml(full);
    } catch (e) {
      out.textContent = `Model error: ${e.message}`;
    }
  });

  $('exportMd').addEventListener('click', () => download(`myna-debrief-${stamp()}.md`, toMarkdown(), 'text/markdown'));
  $('exportJson').addEventListener('click', () => {
    const d = debriefData();
    download(`myna-session-${stamp()}.json`, JSON.stringify({ profile: { role: state.profile.role, company: state.profile.company }, ...d, turns: state.turns, questions: state.questions }, null, 2), 'application/json');
  });
}

function toMarkdown() {
  const d = debriefData();
  const m = d.metrics;
  return [
    `# Myna debrief — ${state.profile.company || 'interview'}${state.profile.role ? ` · ${state.profile.role}` : ''}`,
    `_${new Date().toLocaleString()}_`,
    '',
    `| metric | value |`, `|---|---|`,
    `| length | ${mmss(m.durationMs)} |`,
    `| your talk share | ${m.talkShare}% |`,
    `| words per minute | ${m.wpm || '–'} |`,
    `| fillers / 100 words | ${m.fillerRate} |`,
    `| hedges / 100 words | ${m.hedgeRate} |`,
    `| "I" vs "we" | ${m.ownershipRatio === null ? '–' : m.ownershipRatio + '%'} |`,
    `| questions captured | ${d.pairs.length} |`,
    '',
    '## What to fix',
    ...d.tips.map((t) => `- ${t.tip}`),
    '',
    '## Questions and answers',
    ...d.pairs.map((p, i) => [
      `### ${i + 1}. ${p.question}`,
      `_type: ${p.kind} · ${p.words} words · STAR ${Math.round(p.star.score * 100)}%_`,
      '',
      p.answer || '_(no answer captured)_',
      '',
    ].join('\n')),
    '',
    '## Full transcript',
    ...state.turns.map((t) => `**${t.speaker === 'candidate' ? 'You' : 'Interviewer'}** [${mmss(t.t)}]: ${t.text}`),
  ].join('\n');
}

/* ---------------------------------------------------------------- utils */
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function flash(btn, txt) {
  const old = btn.textContent;
  btn.textContent = txt;
  setTimeout(() => { btn.textContent = old; }, 1400);
}
function makeDraggable(el, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
  handle.addEventListener('pointerdown', (e) => {
    on = true; sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left; oy = r.top;
    el.style.right = 'auto'; el.style.bottom = 'auto';
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!on) return;
    el.style.left = `${Math.max(0, ox + e.clientX - sx)}px`;
    el.style.top = `${Math.max(0, oy + e.clientY - sy)}px`;
  });
  handle.addEventListener('pointerup', () => { on = false; });
}

const SAMPLE_RESUME = `Aditi Sharma — Backend Engineer, Pune
5 years building payments and ledger services in Go and Python.

- Led migration of a monolithic payments service to 4 Go microservices; cut p99 latency from 840ms to 210ms and removed 3 single points of failure.
- Built a double-entry ledger handling 2.1M transactions/day with zero reconciliation breaks across 14 months.
- Owned idempotency and retry design for the payout path; reduced duplicate payouts from ~40/week to 0.
- Introduced contract tests and a staged rollout pipeline; deploy frequency went from 2/week to 11/week, rollback time from 40min to 4min.
- Mentored 3 junior engineers; two now own services independently.
- On-call lead for 6 quarters; wrote the incident playbook that cut MTTR from 52 to 18 minutes.
Skills: Go, Python, PostgreSQL, Kafka, Redis, Kubernetes, gRPC, Terraform.`;

/* ----------------------------------------------------------------- boot */
load();
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
bindSetup();
bindLive();
bindMock();
bindCoding();
bindDebrief();
renderQuestions();
renderTranscript();
setEngine('engine idle', false);
if (!sttSupported()) setSttPill('no speech API in this browser', false);
