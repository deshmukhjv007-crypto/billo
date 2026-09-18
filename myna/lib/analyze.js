/**
 * Myna — post-interview analytics.
 *
 * Turns a list of transcript turns into the numbers a candidate can actually
 * act on: talk-time share, pace, filler density, hedging, STAR coverage.
 * Pure and isomorphic — the same code runs in the browser and in `node:test`.
 */

export const FILLERS = [
  'uh', 'um', 'er', 'ah', 'like', 'you know', 'i mean', 'basically', 'actually',
  'literally', 'kind of', 'sort of', 'stuff', 'things', 'whatever', 'obviously',
];

export const HEDGES = [
  'i think', 'i guess', 'i suppose', 'probably', 'maybe', 'might', 'not sure',
  "i don't know", 'i dont know', 'i believe', 'hopefully', 'sort of', 'kind of',
  'it depends', 'to be honest',
];

export const ACTION_VERBS = [
  'built', 'build', 'led', 'lead', 'designed', 'design', 'implemented', 'implement',
  'shipped', 'migrated', 'reduced', 'increased', 'improved', 'automated', 'refactored',
  'launched', 'owned', 'coordinated', 'negotiated', 'mentored', 'set up', 'setup',
  'created', 'delivered', 'drove', 'introduced', 'optimized', 'optimised', 'fixed',
];

const STAR_SIGNALS = {
  situation: /\b(at my (last|previous|current)|when i (was|worked)|back (then|at)|in my (last|previous|current) (role|job|company)|the situation was|our team was|we were)\b/i,
  task: /\b(i (was|had been) (asked|tasked|responsible|expected)|my (job|role|responsibility|goal) was|the goal was|we needed to|i needed to|i had to)\b/i,
  action: null, // filled below from ACTION_VERBS + first-person density
  result: /\b(\d+\s?(%|percent|x|k|lakh|crore|ms|seconds|minutes|hours|days|weeks)|reduced by|increased by|cut .{0,20}by|improved by|saved|result was|as a result|outcome was|which led to|impact was|revenue|conversion|uptime|latency)\b/i,
};

const WORD_RE = /[A-Za-z'’]+/g;

export function countWords(text) {
  const m = String(text || '').match(WORD_RE);
  return m ? m.length : 0;
}

/** Count occurrences of a phrase (case-insensitive, whole-word for single words). */
export function countPhrase(text, phrase) {
  const hay = ' ' + String(text || '').toLowerCase().replace(WORD_RE, (w) => w) + ' ';
  const needle = phrase.toLowerCase();
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = /\s/.test(needle) ? new RegExp(esc, 'gi') : new RegExp(`\\b${esc}\\b`, 'gi');
  const m = hay.match(re);
  return m ? m.length : 0;
}

/**
 * Did this answer cover Situation / Task / Action / Result?
 * Returns { situation, task, action, result } booleans plus a 0-1 score.
 */
export function starCoverage(answer) {
  const text = String(answer || '');
  const lowered = text.toLowerCase();

  const action =
    ACTION_VERBS.filter((v) => countPhrase(lowered, v) > 0).length >= 2 ||
    (/\bi\s+(built|led|designed|implemented|shipped|created|drove|owned|set up|launched|delivered|introduced|automated|migrated|refactored|negotiated|mentored)\b/i.test(lowered));

  const cov = {
    situation: STAR_SIGNALS.situation.test(text),
    task: STAR_SIGNALS.task.test(text),
    action,
    result: STAR_SIGNALS.result.test(text),
  };
  const score = Object.values(cov).filter(Boolean).length / 4;
  return { ...cov, score };
}

/**
 * @param {Array<{speaker:'interviewer'|'candidate', text:string, t:number}>} turns
 *        `t` is milliseconds since session start for the turn's first word.
 */
export function analyzeSession(turns, { durationMs = 0 } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const candidateText = list.filter((t) => t.speaker === 'candidate').map((t) => t.text).join(' ');
  const interviewerText = list.filter((t) => t.speaker === 'interviewer').map((t) => t.text).join(' ');

  const candidateWords = countWords(candidateText);
  const interviewerWords = countWords(interviewerText);
  const totalWords = candidateWords + interviewerWords;

  const fillerHits = FILLERS.map((f) => ({ filler: f, count: countPhrase(candidateText, f) }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
  const fillerTotal = fillerHits.reduce((n, f) => n + f.count, 0);

  const hedgeHits = HEDGES.map((h) => ({ phrase: h, count: countPhrase(candidateText, h) }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count);
  const hedgeTotal = hedgeHits.reduce((n, h) => n + h.count, 0);

  const sentences = String(candidateText)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgSentenceWords = sentences.length ? Math.round((candidateWords / sentences.length) * 10) / 10 : 0;
  const longestSentence = sentences.reduce((max, s) => Math.max(max, countWords(s)), 0);

  // Speaking pace: candidate words over the time the candidate held the floor.
  const candidateMs = estimateSpeakerMs(list, 'candidate', durationMs);
  const wpm = candidateMs > 0 ? Math.round((candidateWords / candidateMs) * 60000) : 0;

  const iStatements = (candidateText.match(/\bi\s+(built|led|designed|implemented|shipped|created|drove|owned|decided|chose|proposed|delivered|launched|automated|migrated|improved|reduced|increased)\b/gi) || []).length;
  const weStatements = (candidateText.match(/\bwe\s+(built|led|designed|implemented|shipped|created|drove|owned|decided|chose|proposed|delivered|launched|automated|migrated|improved|reduced|increased)\b/gi) || []).length;

  const metrics = {
    durationMs,
    candidateWords,
    interviewerWords,
    talkShare: totalWords ? Math.round((candidateWords / totalWords) * 100) : 0,
    wpm,
    fillerTotal,
    fillerRate: candidateWords ? Math.round((fillerTotal / candidateWords) * 1000) / 10 : 0, // per 100 words
    topFillers: fillerHits.slice(0, 5),
    hedgeTotal,
    hedgeRate: candidateWords ? Math.round((hedgeTotal / candidateWords) * 1000) / 10 : 0,
    topHedges: hedgeHits.slice(0, 5),
    avgSentenceWords,
    longestSentence,
    iStatements,
    weStatements,
    ownershipRatio: iStatements + weStatements ? Math.round((iStatements / (iStatements + weStatements)) * 100) : null,
  };

  return { metrics, tips: buildTips(metrics, { avgSentenceWords, longestSentence, hedgeTotal, candidateWords }) };
}

/** Rough floor-time estimate: attribute the gap between turn starts to the speaker. */
function estimateSpeakerMs(list, speaker, durationMs) {
  const sorted = [...list].filter((t) => typeof t.t === 'number').sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return durationMs && list.some((t) => t.speaker === speaker) ? durationMs : 0;
  let ms = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].speaker !== speaker) continue;
    const gap = Math.min(sorted[i + 1].t - sorted[i].t, 120000); // cap runaway gaps
    if (gap > 0) ms += gap;
  }
  return ms;
}

export function buildTips(m, ctx = {}) {
  const tips = [];
  const { avgSentenceWords = 0, longestSentence = 0 } = ctx;

  if (m.talkShare > 78) tips.push({ level: 'warn', tip: `You held ${m.talkShare}% of the conversation. Interviewers read >75% as talking *at* them — aim for 60–70% and hand the floor back with a short check-in.` });
  else if (m.talkShare > 0 && m.talkShare < 35) tips.push({ level: 'warn', tip: `You only held ${m.talkShare}% of the words. You may be under-answering — add one concrete example per answer.` });

  if (m.wpm && m.wpm > 175) tips.push({ level: 'warn', tip: `You spoke at ~${m.wpm} wpm. Above ~165 wpm listeners start losing the thread — pause deliberately after your first sentence.` });
  if (m.wpm && m.wpm < 95) tips.push({ level: 'info', tip: `~${m.wpm} wpm is slow for an interview. Some pauses read as uncertainty; tighten to 120–150.` });

  if (m.fillerRate > 6) tips.push({ level: 'warn', tip: `${m.fillerTotal} filler words (${m.fillerRate} per 100 words). Top offenders: ${m.topFillers.map((f) => `"${f.filler}" ×${f.count}`).join(', ')}. A silent beat beats "um".` });
  if (m.hedgeRate > 4) tips.push({ level: 'warn', tip: `${m.hedgeTotal} hedges (${m.topHedges.map((h) => `"${h.phrase}"`).slice(0, 3).join(', ')}…). Replace "I think we…" with "We…", then give the evidence.` });

  if (longestSentence > 45) tips.push({ level: 'warn', tip: `Your longest sentence ran ${longestSentence} words. Anything past ~35 is hard to follow out loud — break it in two.` });
  if (avgSentenceWords > 30) tips.push({ level: 'info', tip: `Average sentence length ${avgSentenceWords} words. Spoken English lands better at 15–22.` });

  if (m.ownershipRatio !== null && m.ownershipRatio < 45) tips.push({ level: 'warn', tip: `Only ${m.ownershipRatio}% of your ownership statements were "I …" — the rest were "we …". Interviewers hire individuals; lead with what *you* did, then the team outcome.` });

  if (!tips.length) tips.push({ level: 'good', tip: 'Pace, filler rate and ownership balance all landed in a healthy range. Next step: tighten the Result half of your STAR stories with a number.' });
  return tips;
}

/**
 * Pair each detected interviewer question with the candidate words that followed
 * it — this is what feeds the per-question debrief table and the AI feedback.
 */
export function pairQuestionsWithAnswers(turns, questions) {
  const sorted = [...(turns || [])].sort((a, b) => (a.t || 0) - (b.t || 0));
  return (questions || []).map((q, idx) => {
    const qTurn = sorted.find((t) => t.speaker === 'interviewer' && t.text.includes(q.text.slice(0, 24)));
    const start = qTurn ? qTurn.t : -1;
    const next = questions[idx + 1];
    const nextTurn = next ? sorted.find((t) => t.speaker === 'interviewer' && t.text.includes(next.text.slice(0, 24))) : null;
    const end = nextTurn ? nextTurn.t : Infinity;
    const answer = sorted
      .filter((t) => t.speaker === 'candidate' && t.t >= start && t.t < end)
      .map((t) => t.text)
      .join(' ')
      .trim();
    return {
      question: q.text,
      kind: q.kind,
      answer,
      words: countWords(answer),
      star: starCoverage(answer),
      askedAt: qTurn ? qTurn.t : null,
    };
  });
}
