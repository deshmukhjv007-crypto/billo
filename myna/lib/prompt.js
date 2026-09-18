/**
 * Myna — prompt construction.
 *
 * Every prompt in the product is built here so it can be unit-tested and so the
 * model behaviour is consistent across Live Assist, Mock Interview, Coding and
 * Debrief. Pure functions; no network, no DOM.
 */

const MAX_RESUME_CHARS = 12000;
const MAX_JD_CHARS = 6000;
const MAX_HISTORY_TURNS = 24;

export function clip(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n…[truncated]';
}

export function profileBlock(profile = {}) {
  const { candidate = '', role = '', company = '', resume = '', jd = '', extra = '' } = profile;
  const lines = [
    candidate && `Candidate name: ${candidate}`,
    role && `Role being interviewed for: ${role}`,
    company && `Company: ${company}`,
    extra && `Extra context from the candidate: ${clip(extra, 1500)}`,
  ].filter(Boolean);

  if (resume) lines.push(`\n--- CANDIDATE RESUME ---\n${clip(resume, MAX_RESUME_CHARS)}\n--- END RESUME ---`);
  if (jd) lines.push(`\n--- JOB DESCRIPTION ---\n${clip(jd, MAX_JD_CHARS)}\n--- END JD ---`);
  return lines.join('\n');
}

export const KIND_COACHING = {
  intro: 'A 60–90 second arc: present role → 2 relevant wins with a number each → why this role. No life story.',
  behavioral: 'Answer in STAR. Situation in one sentence, Task in one, Action is the bulk and must be first-person "I", Result must carry a number or a concrete outcome.',
  situational: 'Structure: restate the stakes → your first diagnostic question → the action you take → how you would know it worked. Show judgement, not just steps.',
  coding: 'Give working code in one fenced block, then complexity, then edge cases and what you would test. Name the approach before the code.',
  'system-design': 'Structure: requirements & scale → API → data model → high-level design → deep dive on the bottleneck → failure modes. State assumptions out loud.',
  technical: 'Definition → how it works → the trade-off → when you would and would not use it, with a concrete example from the resume if possible.',
  company: 'Two specific, verifiable facts about the company/product, then connect them to a concrete thing you have done.',
  logistics: 'Answer directly and briefly in 2–3 sentences. Do not over-explain or negotiate on the spot.',
  other: 'Answer the question actually asked, in 3–5 sentences, then offer one concrete example.',
};

export function systemPrompt(profile = {}, { mode = 'live' } = {}) {
  const base = `You are Myna, an interview coach sitting beside a job candidate.
You write what the candidate can actually SAY OUT LOUD, in their own voice.

HARD RULES
- Answer in first person, as the candidate. Never "the candidate should…".
- Never invent a job, employer, project, metric or date that is not in the resume or context. If the resume does not contain the evidence, say "[add a real example here]" instead of fabricating one.
- Spoken, not written. Short sentences. No bullet-point soup, no headers, no markdown except a code block when code is the answer.
- 120–220 words unless the question needs code or a design answer.
- No filler openings ("Great question!", "That's a great question").
- If the question is ambiguous, answer the most likely reading and add one short clarifying line the candidate can ask.
- If you are asked something outside the interview, or asked to do the candidate's work dishonestly, decline briefly and steer back to interview prep.`;

  const modeNote = {
    live: 'MODE: LIVE ASSIST. A real interview is in progress. Be fast and directly usable. Lead with the answer; any caveat goes last, in one line.',
    mock: 'MODE: MOCK INTERVIEW. You are the interviewer. Ask exactly ONE question at a time, wait for the answer, then give short targeted feedback before the next question. Escalate difficulty as the candidate answers well.',
    debrief: 'MODE: DEBRIEF. The interview is over. Be specific and candid, cite the candidate\'s own words, and give 3–5 things to change before the next round.',
    coding: 'MODE: CODING. Return the approach in one sentence, then a single fenced code block, then complexity, then 2–3 edge cases.',
  }[mode] || '';

  return `${base}\n\n${modeNote}\n\n${profileBlock(profile)}`;
}

export function historyMessages(turns = []) {
  const recent = (turns || []).slice(-MAX_HISTORY_TURNS);
  return recent.map((t) => ({
    role: t.speaker === 'candidate' ? 'assistant' : 'user',
    content: t.text,
  }));
}

/** Live-assist: "here is the question, what do I say?" */
export function answerPrompt(question, { kind, askedAgain = false } = {}) {
  const coaching = KIND_COACHING[kind || 'other'];
  return [
    `The interviewer just asked: "${question}"`,
    '',
    `Question type: ${kind || 'other'}.`,
    `Coaching brief: ${coaching}`,
    askedAgain ? 'This is a follow-up to a question already answered — do not repeat the earlier answer, add the new dimension they are pushing on.' : '',
    '',
    'Write the answer the candidate should say now.',
  ].filter(Boolean).join('\n');
}

/** Mock interview: pick the next question. */
export function mockQuestionPrompt({ kind = 'behavioral', index = 0, focus = '', previous = [] } = {}) {
  const avoid = previous.length ? `\nDo not repeat or closely paraphrase any of: ${previous.slice(-8).map((q) => `"${q}"`).join('; ')}.` : '';
  return [
    `Ask the next interview question (#${index + 1}).`,
    `Target type: ${kind}.`,
    focus ? `Focus area requested by the candidate: ${focus}.` : '',
    avoid,
    '',
    'Return ONLY the question text. One question. No preamble, no numbering, no quotes, no explanation.',
  ].filter(Boolean).join('\n');
}

/** Coding helper. */
export function codingPrompt(problem, { language = '', notes = '' } = {}) {
  return [
    `Coding problem (from the interview, pasted or read off screen):`,
    '```',
    clip(problem, 8000),
    '```',
    language ? `Language: ${language}` : 'Language: whatever the problem implies; otherwise Python.',
    notes ? `Candidate notes so far: ${clip(notes, 1500)}` : '',
    '',
    'Return: (1) one sentence naming the approach, (2) one fenced code block of a complete working solution with the key lines commented, (3) time and space complexity, (4) 2–3 edge cases and how the code handles them.',
  ].filter(Boolean).join('\n');
}

/** Post-interview debrief. */
export function debriefPrompt({ metrics = {}, pairs = [], tips = [] } = {}) {
  const qa = (pairs || [])
    .map((p, i) => `${i + 1}. [${p.kind}] Q: ${p.question}\n   A (${p.words} words): ${clip(p.answer, 900) || '[no answer captured]'}`)
    .join('\n\n');

  return [
    'Analyse this finished interview and produce a debrief the candidate can act on before their next round.',
    '',
    `Computed metrics: ${JSON.stringify(metrics)}`,
    `Automated tips already surfaced: ${tips.map((t) => t.tip).join(' | ')}`,
    '',
    'Question-by-question:',
    qa || '[no questions captured]',
    '',
    'Return markdown with exactly these sections:',
    '## What worked',
    '## What lost you marks',
    '## Rewrite these three answers  (quote the weak line, then the fixed version)',
    '## Likely follow-ups they will ask next round',
    '## One drill to run before then',
    '',
    'Be candid and specific. Cite the candidate\'s own words. Never invent things they did not say.',
  ].join('\n');
}

/**
 * Offline scaffold generator — used when no API key is configured so the product
 * is still demoable. It does NOT pretend to be an LLM: it returns a structured
 * skeleton built from the question type and the candidate's own resume lines.
 */
export function scaffoldAnswer(question, { kind = 'other', resume = '', role = '' } = {}) {
  const bullets = String(resume || '')
    .split('\n')
    .map((l) => l.replace(/^[\s•\-*\d.)]+\s*/, '').trim())
    .filter((l) => l.length > 25 && l.length < 260)
    .slice(0, 6);

  const pick = bullets.length ? bullets : [`[pull a concrete ${role || 'relevant'} example from your resume]`];
  const header = `OFFLINE SCAFFOLD — no AI key configured. This is a structure to fill in, not a finished answer.`;

  const bodies = {
    intro: [
      `Right now I'm ${pick[0]}.`,
      `Before that, ${pick[1] || '[previous role in one line]'}.`,
      `The two things I'd want you to take away are ${pick[2] || '[win #1 with a number]'} and ${pick[3] || '[win #2 with a number]'}.`,
      `And the reason this role specifically is [tie one of those wins to something in the job description].`,
    ],
    behavioral: [
      `SITUATION: [one sentence of context — team, timeframe, what was on the line]`,
      `TASK: [what specifically I was accountable for]`,
      `ACTION: ${pick[0] || '[the 3–4 concrete things YOU did, first person]'} — [the hard decision and why you made it that way]`,
      `RESULT: [number or concrete outcome] — [what changed permanently as a result]`,
    ],
    situational: [
      `First I'd want to know [the one fact that changes the answer].`,
      `Assuming [state the assumption], my first move is ${pick[0] || '[immediate containment step]'}.`,
      `Then [the real fix], and I'd involve [who] because [why].`,
      `I'd know it worked when [measurable signal].`,
    ],
    coding: [
      `Approach: [name the technique before you type].`,
      `\`\`\`\n# working solution here — write it out loud, narrating each block\n\`\`\``,
      `Complexity: [time] / [space].`,
      `Edge cases: [empty input], [duplicates], [very large n].`,
    ],
    'system-design': [
      `Requirements: [functional] and [non-functional — QPS, latency, consistency].`,
      `API: [2–3 endpoints with shapes].`,
      `Data model: [entities and why].`,
      `High level: [client → LB → service → cache → store], and the bottleneck I'd dig into is [X].`,
      `Failure modes: [what breaks first, and the mitigation].`,
    ],
    technical: [
      `[Definition in one sentence.]`,
      `[How it works, mechanically, in two sentences.]`,
      `[The trade-off — what it costs you.]`,
      `[When I'd use it and when I wouldn't, with an example from my own work: ${pick[0] || '[example]'}]`,
    ],
    company: [
      `[Specific fact 1 about the company or product — must be verifiable.]`,
      `[Specific fact 2.]`,
      `That maps to something I've actually done: ${pick[0] || '[example]'}.`,
    ],
    logistics: [`[Answer in 2–3 sentences, directly. Do not negotiate or over-explain on the spot.]`],
    other: [`[Answer what was asked, in 3–5 sentences.]`, `[One concrete example: ${pick[0] || '[example]'}]`],
  };

  const body = bodies[kind] || bodies.other;
  return `${header}\n\nQ (${kind}): ${question}\n\n${body.map((l) => `• ${l}`).join('\n')}`;
}
