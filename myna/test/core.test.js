import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isQuestion, splitSentences, extractQuestions, classifyQuestion,
  isQuestionSettled, stripLeadNoise, lastQuestion, findQuestionClause,
} from '../lib/detect.js';
import {
  analyzeSession, starCoverage, countWords, countPhrase, pairQuestionsWithAnswers, buildTips,
} from '../lib/analyze.js';
import {
  systemPrompt, answerPrompt, mockQuestionPrompt, codingPrompt, debriefPrompt,
  scaffoldAnswer, clip, profileBlock, KIND_COACHING,
} from '../lib/prompt.js';

/* ------------------------------------------------------------ detect.js */
test('splitSentences splits on terminal punctuation and keeps abbreviations intact', () => {
  const out = splitSentences('He works at Acme Inc. Tell me about yourself. Why this role?');
  assert.deepEqual(out, ['He works at Acme Inc.', 'Tell me about yourself.', 'Why this role?']);
});

test('splitSentences returns [] for empty input', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   \n  '), []);
});

test('stripLeadNoise removes ASR throat-clearing', () => {
  assert.equal(stripLeadNoise('um, so, like tell me about yourself'), 'tell me about yourself');
});

test('isQuestion catches question marks', () => {
  assert.equal(isQuestion('What is your notice period?'), true);
  assert.equal(isQuestion('How does the cache invalidation work?'), true);
});

test('isQuestion catches imperative interview prompts with no question mark', () => {
  assert.equal(isQuestion('Tell me about a time you handled a conflict'), true);
  assert.equal(isQuestion('Walk me through your background'), true);
  assert.equal(isQuestion('Describe a situation where you missed a deadline'), true);
  assert.equal(isQuestion('Can you explain the trade-off there'), true);
});

test('isQuestion rejects ordinary statements', () => {
  assert.equal(isQuestion('I worked on the payments team for three years.'), false);
  assert.equal(isQuestion('We shipped the migration in March.'), false);
  assert.equal(isQuestion('The latency dropped by 40 percent.'), false);
});

test('findQuestionClause digs a question out of unpunctuated ASR speech', () => {
  // Real Web Speech / Whisper chunks arrive as one flat fragment with no '?'.
  // It takes the last starter, so "…can you tell me about…" yields the cleaner "tell me about…".
  assert.equal(
    findQuestionClause('so moving on can you tell me about a time you failed'),
    'tell me about a time you failed',
  );
  assert.equal(
    findQuestionClause('alright and how would you design a rate limiter for this'),
    'how would you design a rate limiter for this',
  );
  // takes the LAST starter when the clause compounds ("let's say … walk me through …")
  assert.equal(
    findQuestionClause("okay let's say production is on fire walk me through your first ten minutes"),
    'walk me through your first ten minutes',
  );
  // an indirect ask ("tell me why you want to leave") is still worth answering
  assert.equal(
    findQuestionClause('before we wrap up tell me why you want to leave your current role'),
    'why you want to leave your current role',
  );
});

test('findQuestionClause ignores statements, chatter and whole-fragment questions', () => {
  // statement about something, not an ask
  assert.equal(findQuestionClause('let me explain how we scaled the service'), null);
  assert.equal(findQuestionClause('what we do here'), null);
  // trailing wh-word with no substance
  assert.equal(findQuestionClause('that is how'), null);
  // ordinary chat
  assert.equal(findQuestionClause('I worked on the payments team for three years'), null);
  // whole-fragment questions are isQuestion's job — clause extraction stays out of the way
  assert.equal(findQuestionClause('tell me about yourself'), null);
  assert.equal(findQuestionClause('Tell me about yourself?'), null);
  assert.equal(findQuestionClause(''), null);
  assert.equal(findQuestionClause(null), null);
});

test('a clause dug out of ASR speech classifies like a real question', () => {
  assert.equal(classifyQuestion(findQuestionClause('so moving on can you tell me about a time you failed')), 'behavioral');
  assert.equal(findQuestionClause('next question what is your expected ctc'), 'what is your expected ctc');
  assert.equal(classifyQuestion(findQuestionClause('next question what is your expected ctc')), 'logistics');
});

test('classifyQuestion routes to the right scaffold', () => {
  assert.equal(classifyQuestion('Tell me about a time you had a conflict with a teammate'), 'behavioral');
  assert.equal(classifyQuestion('Write a function to reverse a linked list'), 'coding');
  assert.equal(classifyQuestion('Design a rate limiter for 10k requests per second'), 'system-design');
  assert.equal(classifyQuestion('What is your expected CTC?'), 'logistics');
  assert.equal(classifyQuestion('Why do you want to work here?'), 'company');
  assert.equal(classifyQuestion('Tell me about yourself'), 'intro');
  assert.equal(classifyQuestion('Explain the difference between a process and a thread'), 'technical');
  assert.equal(classifyQuestion('What would you do if the deploy broke prod?'), 'situational');
});

test('extractQuestions dedupes across repeated scans of a growing transcript', () => {
  const seen = new Set();
  const first = extractQuestions('Tell me about yourself. I have five years of experience.', seen);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'intro');

  // Re-scan the same text plus one more question: only the new one is emitted.
  const second = extractQuestions('Tell me about yourself. I have five years of experience. What is your notice period?', seen);
  assert.equal(second.length, 1);
  assert.equal(second[0].text, 'What is your notice period?');
  assert.equal(second[0].kind, 'logistics');

  // Third scan of identical input emits nothing.
  assert.equal(extractQuestions('Tell me about yourself. I have five years of experience. What is your notice period?', seen).length, 0);
});

test('extractQuestions ignores statements between questions', () => {
  const q = extractQuestions('We are a fintech. Describe your proudest project. Our stack is Go.');
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'behavioral');
});

test('lastQuestion returns the most recent question', () => {
  const q = lastQuestion('Tell me about yourself. I am Aditi. Why this role?');
  assert.equal(q.text, 'Why this role?');
});

test('isQuestionSettled needs a question mark or a silence window', () => {
  assert.equal(isQuestionSettled('Why this role?'), true);
  assert.equal(isQuestionSettled('Tell me about a time you led a team', { silenceMs: 900, sinceLastWordMs: 200 }), false);
  assert.equal(isQuestionSettled('Tell me about a time you led a team', { silenceMs: 900, sinceLastWordMs: 1200 }), true);
  assert.equal(isQuestionSettled('We shipped in March', { sinceLastWordMs: 5000 }), false);
});

/* ----------------------------------------------------------- analyze.js */
test('countWords and countPhrase', () => {
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countPhrase('like, like I said, you know', 'like'), 2);
  assert.equal(countPhrase('I think we should, I think', 'i think'), 2);
});

const STAR_ANSWER = 'At my last company our payout service was failing. I was tasked with fixing it. I built an idempotency layer and I migrated the retry path. As a result duplicate payouts dropped from 40 a week to 0, a 100% reduction.';
const WEAK_ANSWER = 'Um, like, we had some issues and we fixed them I think. It was probably a team thing.';

test('starCoverage detects a complete STAR story', () => {
  const s = starCoverage(STAR_ANSWER);
  assert.equal(s.situation, true);
  assert.equal(s.task, true);
  assert.equal(s.action, true);
  assert.equal(s.result, true);
  assert.equal(s.score, 1);
});

test('starCoverage flags a weak answer', () => {
  const s = starCoverage(WEAK_ANSWER);
  assert.equal(s.situation, false);
  assert.equal(s.result, false);
  assert.ok(s.score < 0.5, `expected low STAR score, got ${s.score}`);
});

test('analyzeSession computes talk share, fillers and hedging', () => {
  const turns = [
    { speaker: 'interviewer', text: 'Tell me about yourself.', t: 0 },
    { speaker: 'candidate', text: WEAK_ANSWER, t: 2000 },
    { speaker: 'interviewer', text: 'Why this role?', t: 20000 },
  ];
  const { metrics } = analyzeSession(turns, { durationMs: 25000 });
  assert.equal(metrics.interviewerWords, 7);
  assert.equal(metrics.candidateWords, countWords(WEAK_ANSWER));
  assert.equal(metrics.talkShare, Math.round((metrics.candidateWords / (metrics.candidateWords + 7)) * 100));
  assert.ok(metrics.fillerTotal >= 2, `expected fillers, got ${metrics.fillerTotal}`);
  assert.ok(metrics.hedgeTotal >= 2, `expected hedges, got ${metrics.hedgeTotal}`);
  assert.ok(metrics.wpm > 0, 'wpm should be derived from floor time');
});

test('analyzeSession handles an empty session without throwing', () => {
  const { metrics, tips } = analyzeSession([], {});
  assert.equal(metrics.talkShare, 0);
  assert.equal(metrics.wpm, 0);
  assert.ok(Array.isArray(tips));
});

test('buildTips warns when the candidate dominates the conversation', () => {
  const tips = buildTips({ talkShare: 90, wpm: 130, fillerRate: 1, hedgeRate: 1, ownershipRatio: 80 }, {});
  assert.ok(tips.some((t) => /talk/i.test(t.tip)), 'expected a talk-share tip');
});

test('pairQuestionsWithAnswers attaches the answer spoken after each question', () => {
  const turns = [
    { speaker: 'interviewer', text: 'Tell me about yourself.', t: 0 },
    { speaker: 'candidate', text: 'I am a backend engineer in Pune.', t: 3000 },
    { speaker: 'interviewer', text: 'What is your notice period?', t: 9000 },
    { speaker: 'candidate', text: 'Sixty days.', t: 11000 },
  ];
  const qs = extractQuestions('Tell me about yourself. What is your notice period?');
  const pairs = pairQuestionsWithAnswers(turns, qs);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].answer, 'I am a backend engineer in Pune.');
  assert.equal(pairs[1].answer, 'Sixty days.');
  assert.equal(pairs[0].kind, 'intro');
  assert.equal(pairs[1].kind, 'logistics');
});

/* ------------------------------------------------------------ prompt.js */
test('clip truncates and marks truncation', () => {
  assert.equal(clip('abc', 10), 'abc');
  const long = 'x'.repeat(50);
  assert.ok(clip(long, 20).endsWith('…[truncated]'));
  assert.ok(clip(long, 20).length < 50);
});

test('systemPrompt embeds the resume, role and the no-fabrication rule', () => {
  const p = systemPrompt({ candidate: 'Aditi', role: 'Backend Engineer', company: 'Zeta', resume: 'Built a ledger at 2M txn/day' }, { mode: 'live' });
  assert.ok(p.includes('Aditi'));
  assert.ok(p.includes('Backend Engineer'));
  assert.ok(p.includes('Zeta'));
  assert.ok(p.includes('2M txn/day'));
  assert.ok(/never invent/i.test(p), 'must forbid fabricating resume facts');
  assert.ok(p.includes('MODE: LIVE ASSIST'));
});

test('systemPrompt switches mode instructions', () => {
  assert.ok(systemPrompt({}, { mode: 'mock' }).includes('MODE: MOCK INTERVIEW'));
  assert.ok(systemPrompt({}, { mode: 'debrief' }).includes('MODE: DEBRIEF'));
  assert.ok(systemPrompt({}, { mode: 'coding' }).includes('MODE: CODING'));
});

test('profileBlock caps resume length so a huge paste cannot blow the context', () => {
  const huge = 'a'.repeat(40000);
  const block = profileBlock({ resume: huge });
  assert.ok(block.length < 13000, `expected truncation, got ${block.length}`);
});

test('answerPrompt includes the question, its kind and the coaching brief', () => {
  const p = answerPrompt('Tell me about a conflict', { kind: 'behavioral' });
  assert.ok(p.includes('Tell me about a conflict'));
  assert.ok(p.includes('behavioral'));
  assert.ok(p.includes(KIND_COACHING.behavioral));
});

test('mockQuestionPrompt asks for exactly one question and avoids repeats', () => {
  const p = mockQuestionPrompt({ kind: 'technical', index: 2, previous: ['Why this role?'] });
  assert.ok(p.includes('ONLY the question text'));
  assert.ok(p.includes('Why this role?'));
  assert.ok(p.includes('#3'));
});

test('codingPrompt asks for approach, code, complexity and edge cases', () => {
  const p = codingPrompt('Reverse a linked list', { language: 'Go', notes: 'tried recursion' });
  assert.ok(p.includes('Reverse a linked list'));
  assert.ok(p.includes('Go'));
  assert.ok(p.includes('tried recursion'));
  assert.ok(/complexity/i.test(p));
  assert.ok(/edge cases/i.test(p));
});

test('debriefPrompt pins the output sections', () => {
  const p = debriefPrompt({ metrics: { talkShare: 70 }, pairs: [{ kind: 'intro', question: 'Tell me about yourself', answer: 'Hi', words: 1 }], tips: [{ tip: 'slow down' }] });
  assert.ok(p.includes('## What worked'));
  assert.ok(p.includes('## What lost you marks'));
  assert.ok(p.includes('Tell me about yourself'));
  assert.ok(p.includes('slow down'));
  assert.ok(/never invent/i.test(p));
});

test('scaffoldAnswer builds a STAR skeleton from the resume for behavioural questions', () => {
  const out = scaffoldAnswer('Tell me about a conflict', { kind: 'behavioral', resume: 'Led migration of payments monolith to four Go microservices, cutting p99 latency from 840ms to 210ms' });
  assert.ok(/OFFLINE SCAFFOLD/.test(out), 'must be labelled as offline');
  assert.ok(out.includes('SITUATION'));
  assert.ok(out.includes('RESULT'));
  assert.ok(out.includes('p99 latency'), 'should reuse a real resume line, not invent one');
});

test('scaffoldAnswer never fabricates a resume bullet when there is no resume', () => {
  const out = scaffoldAnswer('Tell me about yourself', { kind: 'intro', resume: '' });
  assert.ok(out.includes('[pull a concrete'), 'should leave a placeholder');
});

test('scaffoldAnswer covers every classified kind without throwing', () => {
  for (const kind of Object.keys(KIND_COACHING)) {
    const out = scaffoldAnswer('Some question?', { kind });
    assert.ok(typeof out === 'string' && out.length > 40, `kind ${kind} produced nothing`);
  }
});

/* ------------------------------------------------- end-to-end simulation */
test('a full live session flows: transcript → questions → answers → debrief numbers', () => {
  const script = [
    ['interviewer', 'Tell me about yourself.', 0],
    ['candidate', 'I am a backend engineer in Pune. I built a ledger handling 2.1 million transactions a day.', 4000],
    ['interviewer', 'Tell me about a time you had a conflict with a teammate.', 20000],
    ['candidate', STAR_ANSWER, 24000],
    ['interviewer', 'What is your notice period?', 70000],
    ['candidate', 'Sixty days, and it is negotiable for the right role.', 73000],
  ];

  const turns = script.map(([speaker, text, t]) => ({ speaker, text, t }));
  const interviewer = turns.filter((t) => t.speaker === 'interviewer').map((t) => t.text).join(' ');

  const qs = extractQuestions(interviewer);
  assert.deepEqual(qs.map((q) => q.kind), ['intro', 'behavioral', 'logistics']);

  const pairs = pairQuestionsWithAnswers(turns, qs);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[1].star.score, 1, 'the behavioural answer should score full STAR');
  assert.ok(pairs[2].answer.includes('Sixty days'));

  const { metrics, tips } = analyzeSession(turns, { durationMs: 80000 });
  assert.equal(metrics.talkShare, Math.round((metrics.candidateWords / (metrics.candidateWords + metrics.interviewerWords)) * 100));
  assert.ok(metrics.talkShare > 50, 'candidate should hold the majority of a real interview');
  assert.ok(tips.length >= 1);

  // The prompt that would go to the model is well-formed and bounded.
  const p = debriefPrompt({ metrics, pairs, tips });
  assert.ok(p.includes('Sixty days'));
  assert.ok(p.includes('## One drill to run before then'));
});
