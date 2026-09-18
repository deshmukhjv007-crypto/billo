# Myna — real-time AI interview coach

A Parakeet-class interview copilot you can run yourself: it **listens** to the interview,
**transcribes** it live, **detects** each question, and surfaces an answer written in your
voice from your own resume — then debriefs you afterwards with the numbers.

Zero dependencies. No account. No telemetry. Nothing recorded server-side.

```
myna/
├── server.js          zero-dep Node server: static files + LLM/Whisper proxy
├── lib/
│   ├── detect.js      question detection & classification (pure)
│   ├── analyze.js     talk-time, pace, fillers, hedging, STAR coverage (pure)
│   └── prompt.js      every prompt in the product + the offline scaffold (pure)
├── public/
│   ├── index.html     the app
│   ├── app.js         orchestration
│   ├── stt.js         speech capture: Web Speech API, mic meter, recorder, Whisper upload
│   └── llm.js         streaming model client + markdown renderer
└── test/
    ├── core.test.js   30 tests: detection, analytics, prompts, end-to-end simulation
    ├── server.test.js 12 tests: routing, traversal, validation, SSE proxy end-to-end
    └── ui.test.js     13 tests: real app booted in jsdom, real clicks, real prompts
```

## Run it

```bash
cd myna
npm install        # only needed for the UI test suite (jsdom)
npm start          # → http://localhost:4173
npm test           # 55 tests
```

Open it in **Chrome or Edge** — the live microphone transcription uses the browser's
`SpeechRecognition` API, which Firefox does not ship.

## The five surfaces

| Tab | What it does |
|---|---|
| **Setup** | Role, company, resume, JD, language, and the model endpoint. Everything here is injected into every prompt, so answers are yours rather than generic. |
| **Live** | Live transcript with speaker turns, a question queue that classifies each question (intro / behavioral / coding / system-design / situational / company / logistics / technical), and a streamed answer panel. Optional floating overlay for a second monitor. |
| **Mock** | Myna plays the interviewer — one question at a time, feedback on your answer, then it raises the difficulty. |
| **Coding** | Paste a problem; get the approach, working code, complexity and edge cases. |
| **Debrief** | Talk share, words/minute, filler rate, hedge rate, "I" vs "we", per-question STAR coverage, and an AI debrief. Export to Markdown or JSON. |

## Models

Any OpenAI-compatible endpoint. The key lives in your browser's localStorage and is
forwarded per request by the local server — it is never baked into shipped code.

| Endpoint | Base URL | Model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.5` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Together | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` — leave the key blank |
| LM Studio | `http://localhost:1234/v1` | whatever you loaded |

**No key at all?** The app still works. It falls back to a labelled *offline scaffold*
built from your own resume lines — a STAR skeleton to fill in, not a fake LLM answer — and
the Debrief numbers, which are computed locally, need no model whatsoever.

## Transcription

1. **Web Speech API** — live, in Chrome/Edge. Flip `🎧 Interviewer` / `🗣 You` so turns are
   attributed correctly; the API cannot tell speakers apart on its own.
2. **Type or paste** — the box under the transcript, for anything the mic misses.
3. **Upload a recording** — sent to a Whisper-compatible `/audio/transcriptions` on the
   endpoint you configured.

## How question detection works

`lib/detect.js` splits the interviewer's transcript into sentences (splitting only when the
next segment starts with a capital, so a question is never swallowed behind "Inc."), then
tests each one against question marks and the imperative forms interviews actually use —
*tell me about a time…*, *walk me through…*, *describe a situation…* — because ASR output
frequently drops the question mark entirely. Results are deduped by a `seen` set so a
streaming transcript can be re-scanned on every partial result without re-emitting.

Classification drives the scaffold: a behavioral question gets a STAR brief, a coding
question gets "name the approach before the code", logistics gets "answer directly, do not
negotiate on the spot".

## Design decisions worth knowing

- **The model is forbidden from inventing resume facts.** The system prompt requires
  `[add a real example here]` when the evidence is not in the resume. A confident
  fabrication in an interview is worse than a placeholder you fill in.
- **The proxy exists for CORS and key hygiene**, not for features. Everything else runs
  in the browser.
- **Metrics are computed locally**, so the debrief has value even with no model configured
  and even if the model call fails mid-interview.
- **Streamed, not batched.** Answers render token by token, because the first sentence is
  what you need while the rest is still arriving.

## Verification

```
npm test
# 55 tests, 0 failures
```

- `core.test.js` — detection (including the abbreviation-swallowing and "explain vs
  implement" regressions these tests caught), analytics, every prompt builder, and a
  full simulated interview: transcript → questions → answers → debrief numbers.
- `server.test.js` — boots the real server against a fake OpenAI-compatible upstream and
  asserts the SSE stream reassembles into `I am Aditi.`, that the key and model are
  forwarded, that path traversal 404s, and that upstream errors keep their status.
- `ui.test.js` — boots the real `app.js` in jsdom against the real `index.html`, clicks
  the real buttons, and asserts the prompt actually sent contains your resume and the
  detected question.

## What Myna deliberately does not do

See [USAGE-POLICY.md](USAGE-POLICY.md). Short version: no stealth, no screen-share
hiding, no proctoring evasion — that layer is not in the product and is not on the roadmap.
