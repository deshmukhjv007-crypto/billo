/**
 * Myna — question detection & classification.
 *
 * Pure, dependency-free, isomorphic: imported by the browser (ES module) and by
 * the Node test-suite. Nothing here touches the DOM or the network.
 */

/** Interview prompts that are questions even when they end in a full stop. */
const IMPERATIVE_PROMPTS = [
  /^(tell|walk|talk|take|run)\s+(me\s+|us\s+)?(through|about|over|by)\b/i,
  /^(describe|explain|outline|walk|detail|share|give)\b/i,
  /^(what|why|how|when|where|which|who|whose|whom)\b/i,
  /^(can|could|would|should|will|do|does|did|are|is|was|were|have|has|had)\s+(you|we|they|it|he|she|one|someone|anyone)\b/i,
  /^(can|could|would|should|will)\s+you\b/i,
  /^(have|has)\s+(you|we|they)\b/i,
  /^(is|are|was|were|do|does|did)\s+(there|it|this|that|your|the)\b/i,
  /^(walk me|give me|let me know|help me understand|walk us)\b/i,
];

/** Leading "um, so, like" and other ASR throat-clearing we should ignore. */
const LEAD_NOISE = /^(?:\s*(?:um+|uh+|ah+|oh+|er+|mm+|okay|ok|so|like|well|right|yeah|yes)\s*[,\.!?-]*)+\s*/i;

const CODING_RE =
  /\b(algorithm|algorithms|big[- ]o|time complexity|space complexity|complexity|leetcode|data structure|data structures|linked list|binary tree|binary search|hash ?map|hash ?table|dynamic programming|recursion|recursive|regex|sql query|write a (function|program|class|script)|implement|refactor|debug this|edge cases|unit test|api endpoint|rest api|scalability|thread safety|multithread|deadlock|race condition|merge (sort|two)|reverse (a |the )?(string|linked list|array)|palindrome|fibonacci|anagram|substring|binary search tree|graph traversal|heap|memoization|greedy|backtracking|sort an array|two sum|sliding window|lru cache|git rebase|docker|kubernetes|kafka|redis|postgres|mongodb)\b/i;

/** An explicit "produce code" ask — this outranks a system-design phrasing. */
const CODE_TASK_RE =
  /\b(write (a |an |the )?(function|program|class|script|query|code)|implement|code (it|this|up)|refactor|debug|solve|leetcode|algorithm|time complexity|space complexity|big[- ]o|data structure|linked list|binary tree|dynamic programming|memoization|two sum|palindrome|anagram|fibonacci|sliding window|lru cache|regex|sql query|reverse (a |the )?(string|linked list|array))\b/i;

const SYSTEM_DESIGN_RE =
  /\b(design (a|an|the) (system|service|url shortener|rate limiter|notification|feed|chat|search|payment|streaming|api|scheduler)|system design|architecture|scalability|load balanc|caching strategy|sharding|partition(ing)? strategy|eventual consistency|microservice|message queue|throughput|latency budget|qps|tps)\b/i;

const BEHAVIORAL_RE =
  /\b(tell me about a time|describe a (time|situation|situation where)|give me an example|walk me through a (time|situation)|a time when|past experience|previous (job|role|company|manager|team)|conflict|disagreement|mistake|failure|failed|setback|challenge|difficult|tough|pressure|deadline|criticism|feedback|leadership|led a|mentor|mentored|influence|persuade|stakeholder|cross[- ]functional|prioritiz|ownership|initiative|proud|proudest|achievement|accomplishment|strength|weakness|manage|managed)\b/i;


const SITUATIONAL_RE =
  /\b(what would you do|how would you (handle|deal|approach|respond|fix|debug)|when would you (use|choose|reach|go|pick)|if you (were|had|were given|found)|imagine|suppose|hypothetical|let's say|say you)\b/i;

const LOGISTICS_RE =
  /\b(salary|ctc|compensation|package|notice period|relocat|remote|hybrid|visa|sponsor|work permit|expectation|why are you leaving|leaving your current|current company|available to start|start date|joining|background check|other offers|offer in hand|expected ctc|annual package|in[- ]hand|per annum)\b/i;

const COMPANY_RE =
  /\b(why (us|this (company|role|position|team)|do you want to (work|join))|what do you know about (us|the company|our (product|company))|our (product|competitors)|where do you see yourself|five years|5 years|career goals|long[- ]term)\b/i;

const INTRO_RE =
  /\b(tell me about yourself|walk me through your (resume|background|cv|experience)|introduce yourself|about yourself|your background|your resume|your experience so far|your journey)\b/i;

/** "Explain / what is / difference between" — a concept question, not a coding task. */
const TECH_PHRASE_RE =
  /\b(what is|what are|what's|explain|how does|how do|how would you explain|difference between|differences between|why do we use|when would you use|trade[- ]?offs?|pros and cons|compare)\b/i;

export const QUESTION_KINDS = [
  'intro',
  'coding',
  'system-design',
  'behavioral',
  'situational',
  'company',
  'logistics',
  'technical',
  'other',
];

/** Strip leading ASR filler so detection is not thrown off by "um, so, ...". */
export function stripLeadNoise(text) {
  return String(text || '').replace(LEAD_NOISE, '').trim();
}

/**
 * Split a transcript blob into sentence-ish segments, keeping terminal punctuation.
 *
 * We only break when the next segment starts with a capital or a quote. That keeps
 * "I use e.g. kafka for streaming" intact while still splitting "…at Acme Inc.
 * Tell me about yourself." — swallowing a question behind an abbreviation is far
 * worse than occasionally over-splitting, because a swallowed question is never
 * detected at all.
 */
export function splitSentences(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];

  return raw
    .split(/(?<=[.!?])\s+(?=["'“”(\[]?[A-Z])|(?<=\?)\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this fragment look like something the interviewer wants answered? */
export function isQuestion(fragment) {
  const s = stripLeadNoise(fragment);
  if (!s) return false;
  if (s.length < 3) return false;
  if (/[?]\s*$/.test(s)) return true;
  return IMPERATIVE_PROMPTS.some((re) => re.test(s));
}

/**
 * Classify a question so the answer engine can pick the right scaffold
 * (STAR story, code + complexity, structured design doc, direct logistics reply).
 *
 * Order matters: an explicit "write/implement" ask beats a system-design phrasing,
 * and the concrete life-situation categories beat the generic "what is / explain"
 * technical bucket so "What is your expected CTC?" never becomes a concept question.
 */
export function classifyQuestion(question) {
  const q = String(question || '');
  if (CODE_TASK_RE.test(q)) return 'coding';
  if (SYSTEM_DESIGN_RE.test(q)) return 'system-design';
  if (INTRO_RE.test(q)) return 'intro';
  if (LOGISTICS_RE.test(q)) return 'logistics';
  if (BEHAVIORAL_RE.test(q)) return 'behavioral';
  if (SITUATIONAL_RE.test(q)) return 'situational';
  if (COMPANY_RE.test(q)) return 'company';
  if (TECH_PHRASE_RE.test(q)) return 'technical';
  if (CODING_RE.test(q)) return 'coding';
  return 'other';
}

/**
 * Walk a growing transcript and pull out complete questions.
 *
 * `seen` is a Set of already-emitted question strings, so a live transcript that
 * is re-scanned on every partial result does not re-emit the same question.
 * Returns questions in the order they were asked.
 */
export function extractQuestions(transcript, seen = new Set()) {
  const out = [];
  for (const sentence of splitSentences(transcript)) {
    if (!isQuestion(sentence)) continue;
    const clean = sentence.replace(/^[,.:;-]+\s*/, '').trim();
    const key = clean.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: clean, kind: classifyQuestion(clean) });
  }
  return out;
}

/** The most recent question, or null. Used by "answer the last thing they asked". */
export function lastQuestion(transcript) {
  const all = extractQuestions(transcript);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Heuristic end-of-question detector for streaming transcripts.
 * A question is "settled" when it ends in '?' or the speaker has stopped for
 * `silenceMs` after an imperative prompt. This is what drives auto-answer.
 */
export function isQuestionSettled(fragment, { silenceMs = 900, sinceLastWordMs = 0 } = {}) {
  const s = stripLeadNoise(fragment);
  if (!s) return false;
  if (!isQuestion(s)) return false;
  if (/[?]\s*$/.test(s)) return true;
  return sinceLastWordMs >= silenceMs;
}

/**
 * Words that can open a question clause mid-stream. Position-agnostic cousin of
 * IMPERATIVE_PROMPTS, used when ASR hands us speech with no punctuation at all:
 * the question is buried inside a longer fragment ("so moving on can you tell
 * me about a time you failed") and the sentence detector never sees it.
 */
const CLAUSE_START_RE =
  /\b(tell me|tell us|walk me|walk us|talk me through|describe|explain|outline|can you|could you|would you|will you|do you|did you|have you|are you|what's|whats|what|why|how|when|where|which|who|give me|let's say|say you|imagine|suppose|assume)\b/gi;

/**
 * "Let me tell you what we do here." — a wh-word followed by a plain subject
 * (no inversion, no "you") is a statement about something, not an ask.
 */
const INDIRECT_STATEMENT_RE = /^(what|why|how|when|where|which|who|whose)\s+(we|i|it|this|that|they|he|she|the|our|my|its)\b/i;

/**
 * Dig a question clause out of an unpunctuated ASR fragment.
 * Returns the clause text, or null when the fragment holds no ask.
 * Whole-fragment questions (starter at offset 0) are left to isQuestion —
 * this only fires when normal detection found nothing.
 */
export function findQuestionClause(text) {
  const s = stripLeadNoise(text);
  if (!s || /[?!]\s*$/.test(s)) return null;

  let last = null;
  for (const m of s.matchAll(CLAUSE_START_RE)) last = m;
  if (!last || last.index === 0) return null;

  // "…how would you design…" — the aux phrase matches last, but an adjacent
  // wh-word in front makes a cleaner question. Extend back to it.
  let start = last.index;
  if (/^(can|could|would|will|do|does|did|have|are) you\b/i.test(last[0])) {
    const before = s.slice(0, last.index);
    const wh = /(what's|whats|what|why|how|when|where|which|who)\s*$/i.exec(before);
    if (wh) start = wh.index;
  }

  const clause = s
    .slice(start)
    .replace(/^[,.:;–—-]+\s*/, '')
    .replace(/[\s.,…]+$/, '')
    .trim();

  // A stray "what" or "why" in passing is not a question — need substance.
  if (clause.split(/\s+/).length < 4) return null;
  if (INDIRECT_STATEMENT_RE.test(clause) && !/\b(you|your)\b/i.test(clause)) return null;
  return clause;
}
