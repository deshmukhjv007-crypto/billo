# pp-watchdog — profile picture exposure watchdog

**For:** `@j.v.d.7`

A local, single-user defensive tool that answers the question you can actually get an
answer to:

> Which third-party "anonymous Instagram viewer" / mirror / downloader sites are
> re-hosting my profile picture — and which of them are holding an **old** copy, or a
> **bigger** copy than Instagram itself shows, and what do I write to get it removed?

---

## Read this first: what this tool cannot do

It cannot tell you who viewed your profile. It cannot tell you who opened, zoomed, or
screenshotted your profile picture. **Nothing can**, and that is not a limitation of this
implementation:

| What you asked about | Reality |
|---|---|
| Who visited my profile | Instagram keeps no user-visible log; the Graph API exposes no visitor endpoint. Business/Creator accounts get a *count* of profile visits in Insights, never identities. |
| Who opened/zoomed my profile picture | No view tracking exists on profile pictures at all. No notification, no counter, no list. |
| Who screenshotted my story / post / picture | Not detected. The only capture Instagram ever reports is a screenshot of a **View-Once or Vanish-mode DM**. |
| A "profile viewer" app, extension or website | Fabricates its list (usually your own follower list, shuffled) and exists to capture your login. Installing one is how accounts get taken, not how you learn anything. |

So this tool does not pretend. It measures the public fallout of the thing that *is*
measurable — how widely your picture has been copied — and gives you the paperwork to
reduce it. If anyone offers to sell you a viewer list, that offer is the attack.

---

## Quick start

No dependencies, no install step, Python 3.10+:

```bash
cd pp-watchdog
./run.sh selftest                 # end-to-end proof the scanner works, on local fixtures
./run.sh init --handle j.v.d.7 --baseline ~/Pictures/my-current-pp.jpg
./run.sh scan --history           # one polite GET per page, robots.txt honoured
./run.sh takedown                 # writes ready-to-send notices, sends nothing
./run.sh serve --port 8899        # local dashboard
```

`pip install -e .` if you want the `pp-watchdog` command on your PATH. `pip install pillow`
is optional and only sharpens "is this an old photo of me?" from exact-file-hash to
perceptual matching (survives their re-encoding and resizing).

### Setup, in order

1. **`init`** writes `pp-watchdog.json` with your handle. It has **no password field,
   because nothing here ever needs one** — and `config-audit` will fail if you add one.
2. **Set `baseline_image`** to the file you actually uploaded as your profile picture.
   Without it, the scan can still tell you *where* your picture appears, but cannot
   distinguish a stale copy from a current one. A screenshot of your own profile works,
   it just weakens exact-hash matching.
3. **Fill `contact`** (name, reply email, mailing address, phone). Takedown notices
   require a real reply address; `takedown` refuses to pretend otherwise and prints
   `<REPLY-TO EMAIL>` placeholders until you do.

---

## What a scan does

For every site in the registry it fetches the profile page for your handle, extracts any
profile-image URL, fetches that image, and compares it to your baseline. Then it writes a
report, evidence JSON, and (on request) notices.

| verdict | meaning | score weight |
|---|---|---|
| `serving-hires` | they expose a **larger** file than Instagram displays (often the original upload). Worst case; primary takedown target. | 34 |
| `serving-stale` | they are still showing a picture you **replaced**. | 26 |
| `serving-current` | they have your live picture, cached without licence. | 14 |
| `serving-unidentified` | they have *a* picture of yours but old-vs-current cannot be judged (no baseline file, or no Pillow). Counted, but not asserted. | 18 |
| `profile-mirrored` | your name/bio/metadata mirrored, image not independently retrieved → **verify in a browser** before asserting it anywhere. | 8 |
| `login-wall` | they want credentials. Never comply. | 5 |
| `refused` / `blocked-robots` | they reject crawlers. Needs a manual browser check. | 3–4 |
| `moved` | 301 to a new domain — brand churn; note the new home, one complaint per operator. | 3 |
| `not-indexed` | nothing cached for you in what we could observe. | 0 |
| `unreachable` / `error` | no measurement made. **This is not good news**, it is a blind spot. | 1 |

Score = sum of weights, capped at 100. It is a prioritisation aid, not a risk certificate.

### Measured, not invented — the honesty rules

- **robots.txt is obeyed.** If a mirror disallows crawling, you get `blocked-robots`, not a
  guess. That undercounts exposure on purpose; forcing entry is how you get blocked harder
  than the caches you are trying to measure.
- **One request per host per `min_interval_seconds` (default 5s), hard `max_requests_per_scan`
  budget (default 60).** No concurrency, no retries against a host refusing us, no cookies,
  no JS, GET only, size-capped bodies.
- **Nothing is ever uploaded or sent.** No email, no form submission, no telemetry, no update
  pinger. Notices are files you read and send yourself.
- **Only your own handle.** `--handle somebody.else` is refused unless you pass
  `--acknowledge` confirming you act for that account with its owner's consent. This is a
  shield; the consent guard exists so it does not quietly become a stalking tool.
- **Abuse contacts are discovered, not guessed** — one fetch of the operator's own `/contact`
  or `/dmca` page, harvested for addresses, and recorded with the finding.
- **Local storage only:** `.pp-watchdog/` holds the SQLite history, reports, evidence JSON and
  notices. `rm -rf .pp-watchdog` and the tool has no memory of you.

### Why `not-indexed` is not "safe"

The mirror ecosystem churns brutally — in 2026 alone Picuki's original domain went parked on
a TikTok site, SmiHub and GreatFon merged into Dumpor's domain, InstaNavigation's DNS vanished,
and AnonyIG came back from a 451 legal block. The registry is therefore **leads to verify on
this run**, not truth: every entry carries a `confirmed` flag and a status note, and the report
prints how many entries are unverified. A clean verdict on an unverified domain means *"the
page we guessed did not show your image"*, nothing stronger. Add what your own manual searches
turn up:

```bash
./run.sh registry list
./run.sh registry add somename https://the-live-domain --path /user/{username}
./run.sh registry disable dead-site
```

---

## The other half: hardening (`checklist`)

`scan` measures. `checklist` is the part that actually changes your exposure, and it is where
the concern behind "who viewed my profile" gets addressed:

```bash
./run.sh checklist
./run.sh checklist done 2fa-app-not-sms
```

Highest-leverage items, in the order that matters:

1. **Revoke third-party app access** at `instagram.com/accounts/manage_access/` and log out of
   unfamiliar sessions. This is the real compromise vector in this whole category.
2. **2FA via authenticator app or passkeys** (not SMS — SIM-swap is how an account someone is
   fixated on gets taken). Print recovery codes, store them off-phone.
3. **Private account.** Private profiles get their picture degraded to a small thumbnail for
   logged-out visitors, so mirrors can only re-host a low-resolution copy. Public accounts can
   be served at up to full original resolution by third-party fetchers. Reversible, and the
   single biggest reduction in exposure available to you.
4. **Check for a profile-picture privacy toggle** in Settings → Account privacy (builds have
   shipped variants that restrict enlarging your picture, with naming and availability varying
   by region/version). Look in your app; do not trust a blog post — including this one — that it
   exists on your build.
5. **Scrub before you upload:**
   ```bash
   ./run.sh scrub --in ~/Pictures/new-pp.jpg            # strips EXIF/GPS, pixels untouched
   ./run.sh scrub --in ~/Pictures/new-pp.jpg --check   # just reports what it leaks
   ```
   Pure-stdlib marker surgery on JPEG and PNG. A mirrored copy of a phone-camera file can carry
   your GPS coordinates next to your face; this guarantees the *next* copy they cache carries
   nothing.
6. **`pp-watchdog links`** — manual searches (Google/Bing/Yandex Images, Instagram report forms,
   ICANN registrar lookup). These stay manual on purpose: scripted search-engine queries need an
   API key or invite a ban, and a search cache of a mirror page is not evidence the mirror still
   holds your picture. Look at the page itself.

---

## Takedown notices

`./run.sh takedown` writes one file per site per legal route into
`.pp-watchdog/notices/`, plus an index and a filing order that works:

- **DMCA notice** with all six elements required by 17 U.S.C. § 512(c)(3) — signature line,
  identification of the work, identification of the infringing material **with exact URLs**,
  contact info, good-faith statement, accuracy-under-penalty-of-perjury statement. Most of these
  hosts sit on US-adjacent infrastructure and respond to §512 regardless of where you are.
- **Indian route:** notice under IT Act § 79(2)(b) with Rule 3(2)(b) of the IT Rules, 2021,
  invoking the 36-hour (content) / 24-hour (identity-revealing) clocks, with escalation to the
  MeitY grievance portal named.
- **GDPR Art. 17 erasure** request, with Art. 19 recipient notification and Art. 15 access —
  useful when the operator is EU-hosted and copyright framing is a poor fit.
- **Instagram-side report texts** for the IP/counterfeit/privacy forms. Expectation: Instagram
  can act against the service and restrict what logged-out visitors see. It will **not** tell
  you who viewed your profile, and no appeal changes that.

Each notice embeds the machine evidence: the page URL, the mirrored image URL, served
dimensions, SHA-256 of the file, the captured markup snippet, observation timestamp, and how
long it has been up according to your own history. `notice-sent <site> <kind>` logs the send
and sets the +14-day follow-up, because the follow-up is what gets individual complaints acted
on.

**Not legal advice.** Only you can confirm the facts asserted are true of your work; a notice
containing a false statement made under penalty of perjury is an exposure for you. That is why
`profile-mirrored` findings arrive with a "verify in a browser first" warning baked into the
file rather than silently asserting what a page's markup implied.

---

## Commands

| command | what it does |
|---|---|
| `selftest` | runs the real scanner, robots gate, rate limiter, image comparison and notice generator against six local fixture sites — no network, proves the pipeline |
| `init` | writes your config (validates the handle: no `@`, no leading/trailing or doubled periods, ≤30 chars) |
| `scan` | probe the registry. `--history` records it, `--dry-run` prints the exact requests, `--offline DIR` replays captured pages with zero network, `--only` filters, `--json` for scripting (exit 1 when actionable) |
| `takedown` | generate notices from the latest recorded scan |
| `notice-sent <site> <kind>` | log a filing, start the follow-up clock |
| `history` / `scans` | exposure age per site, filing log, scan ledger with score trend |
| `checklist` | hardening posture, weighted so unaddressed criticals dominate |
| `scrub` | strip EXIF/GPS before a photo becomes your profile picture |
| `links` | manual searches + report forms for your handle |
| `registry` | list/add/disable/export mirror entries |
| `config` / `config-audit` | resolved settings; the audit fails if any credential-shaped value is present in this install |
| `serve` | local dashboard (`/` real state, `/demo` synthetic worked example, `/report`, `/notices`, `/healthz`) |

Exit codes: `0` nothing actionable · `1` actionable findings · `2` usage/config problem ·
`3` consent guard tripped.

---

## Tests

```bash
python3 tests/test_watchdog.py          # zero dependencies, includes an end-to-end fixture scan
python3 -m pytest -q                    # same suite under pytest, plus Pillow's perceptual path
./run.sh selftest
```

Covered: handle validation, PNG/JPEG size + fingerprint parsing, perceptual vs exact match,
`not-indexed`/`login-wall`/`refused` classification, rate limiter, request budget, consent
guard, robots gating, EXIF/GPS stripping for JPEG **and** PNG, config round-trip (and that no
credential field exists in the schema), notice contents against the §512 element list, scan
verdicts end-to-end, offline replay making zero requests, and history diffing.

## Known limits

- Unauthenticated GETs only, so private-account internals are out of reach — correctly: that is
  Instagram's access control doing its job.
- Sites that render images client-side yield `profile-mirrored` rather than a verdict; check by
  browser.
- Without Pillow, "is this an old photo of me?" degrades to `serving-unidentified` instead of
  guessing. `selftest` prints which mode it ran in, and the test suite passes in both.
- The registry can never be complete. New mirrors open weekly. This tool narrows and documents
  exposure; it cannot prove absence.
- `--no-robots` exists as an escape hatch and prints a warning; prefer adding the site to your
  manual search list.
- If the real issue is harassment, extortion, or intimate imagery, skip straight to
  `cybercrime.gov.in` and the escalation ladder in `checklist`. Copyright notices are the wrong
  tool and too slow for that.

## Ideas I deliberately rejected

Instagram Insights dashboard (official Graph API OAuth), a bio-link redirect tracker, and a
top-engagers report — all legitimate, all answering "is anyone paying attention" with real
data. Say the word and I'll build any of them next.
