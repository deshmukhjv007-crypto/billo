# Myna usage policy

Myna is an interview **coach**. This page states what it is for, what it refuses to be,
and why — because the category it sits in contains tools whose entire selling point is
deceiving the person on the other side of the call.

## Intended use

- **Mock interviews and practice rounds.** Myna as interviewer, you as candidate, feedback
  after every answer.
- **Preparation.** Resume-aware answer drafts you rehearse and rewrite before the real thing.
- **Coding practice.** Approach, working code, complexity and edge cases for a problem you
  are working through.
- **Transcription you are entitled to make** — your own practice sessions, or a meeting
  where the participants consented.
- **Post-interview review.** Talk share, pace, filler and hedge rates, STAR coverage, and
  a written debrief of what to change before the next round.
- **Recruiter-side use**, with the candidate told: transcribe and structure an interview
  you conducted.

## Not built, and not on the roadmap

- **Anti-detection.** No process-name spoofing, no hiding from Activity Monitor or Task
  Manager, no evasion of proctoring or interview-integrity software.
- **Screen-share invisibility.** Myna is an ordinary browser tab. If you share your screen,
  it is visible. That is intentional.
- **Anything designed to defeat assessment integrity tooling.**

The reason is practical as well as ethical. Proctoring vendors publish detection guidance
for tools in this category, employers increasingly ban live AI assistance outright, and the
penalty is not a warning — it is a rescinded offer and a burned reference. A tool that helps
you pass a screen you were going to fail is a tool that gets you disqualified.

## Your responsibilities

- **Consent and recording law.** Whether you may record a call you are on varies by country
  and, in the US, by state (one-party vs all-party consent). That is on you, not on the app.
- **Assessment rules.** If the format forbids assistance — a proctored test, a take-home,
  an employer policy — do not use Myna. There is no version of "but it was just transcription"
  that survives contact with the rules.
- **Accuracy.** The model will sometimes be wrong, and it will sometimes want to invent a
  bullet point that is not on your resume. The prompts forbid it and the UI labels offline
  scaffolds as scaffolds, but you are the one who says the words out loud.

## Data

- Resume, transcript, question history and API key stay in your browser's localStorage.
- The only network call is to the AI endpoint **you** configure, proxied through the local
  server so the browser does not need CORS.
- The server writes nothing to disk. It has no database, no analytics, no account system.
- Mic audio is recorded locally only if you start a session, and is never uploaded
  automatically — the upload path is an explicit button.
