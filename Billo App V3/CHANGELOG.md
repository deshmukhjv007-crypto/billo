# Changelog

One entry per released build. When a change ships, add a line under the current
version. Bump the number with: `python3 scripts/bump_version.py X.Y.Z`

## [Unreleased]

## [1.6.4] — 2026-10-02
- Bill names no longer pick up people's names or filler words ("I paid 600 for food with Sid" → **Food**, not "Food Sid" / "I Paid").
- A bill with no name is called **Bill** (not "Other"); old bills saved as "Other" or "I Paid" show their category's name instead.
- The bill icon follows its name when the name is a category (a bill called "Food" shows the food icon).

## [1.6.3] — 2026-10-02
- "Per person" only shows when every bill was split equally between everyone. Otherwise the trip shows **Your share**, and the share card says "Not everyone was in every bill" (₹3,530 ÷ 3 = ₹1,177 was nobody's real share).

## [1.6.2] — 2026-10-02
- **Share sends the picture now:** "Share to WhatsApp" attaches the dark trip card together with the text (it used to send text only).
- **Remind sends a personal card:** "Appu, you owe Jayesh ₹1,500" with your UPI ID, plus the message.
- Reminder amounts in whole rupees.

## [1.6.1] — 2026-10-02
- **Joined a live trip as the wrong person?** If the name you picked doesn't match yours but another member's does (Apurva → Appu), the trip shows "You joined as Jayesh — are you Appu?" with a one-tap switch. Members list also has "This is me" on shared trips.
- "Which one are you?" now marks who started the trip and highlights the name that looks like yours.
- Paise show as ₹113.50, not ₹113.5.

## [1.6.0] — 2026-10-02
- **New look: Cream + Ink.** Warm off-white, deep ink text, one indigo accent; Midnight and Paper (pure white) are in Settings → Look. New fonts (Bricolage Grotesque + Manrope, bundled, ₹ included).
- **No more emoji in the interface:** line icons for trips and bills; the trip picker shows icons.
- **Slide-to-pay / save:** white track, indigo knob.
- **Meet Billo:** a tomcat who lives in the top bar and does cat things (licks his paw, looks around, yawns, grooms). Tap him and he looks at you. Still for phones set to reduce motion.
- **Calm voice screen:** "Take your time. Say the whole bill." — the screen no longer redraws on every word; the card comes up when you stop talking. Android waits a little longer before deciding you've finished.
- **Share card:** back to the dark card, with line icons, avatars, "Who pays whom", whole rupees (no more ₹1,225.99) and a "Pay … on UPI" box. The text message lists UPI IDs too.
- **New app icon:** Billo's face on indigo (adaptive icon on Android 8+).
- Android status bar follows the chosen look.

## [1.5.0] — 2026-10-02
- **New look: Midnight.** Dark by default (Day theme in Settings), new fonts (Unbounded + Sora, bundled), clearer words instead of colour-only signals.
- **Your circle** on Home: you in the middle, the people you share bills with around you, arrows and plain words ("Rahul pays you ₹1,600").
- **Slide to pay / slide to save** (old-iPhone style). A tap shows a hint, so nobody pays by accident.
- **Settle up** reads as sentences: "You pay Rahul ₹1,600", your rows first. Bills show "your part / you lent / not in it".
- **Dock** at the bottom: Home · Mic · ＋ · Insights/Join · Settings.
- **Voice bills:** tap the mic, say "I paid 6000 for food with Rahul, Ajay and Krish" (Hinglish works: "Maine 6 hazaar diye khane ke liye…"), check the card, slide to save. New names can be added to the trip in one tap.
- **Android:** native speech recognition (asks for the microphone the first time), long-press shortcut "Voice bill", `billo://voice` deep link and a Google Assistant App Action ("Hey Google, add a bill in Billo" — works once Billo is live on Google Play).
- Android shell now serves the bundled app through a plain WebViewClient + WebViewAssetLoader (standard API).

## [1.4.3] — 2026-09-26
- Fixed: on narrow phones the Settle-up row squeezed names into the amount ("Jayesh → M₹1,000"). Names now wrap onto their own line, the buttons sit below, and very long names end in "…".

## [1.4.2] — 2026-09-25
- **Invite friends sheet:** big trip code, **Send on WhatsApp**, copy link, copy code.
- **Join links:** invites carry `…/#join=CODE`; tapping one opens Billo with the code filled in
  and goes straight to "Which one are you?" (`BILLO_WEB_URL` in `app/sync/config.js`).
- The trip code stays visible on shared trips (Trip code strip under your balance).
- The "Share this trip live" card now shows on one-person trips too.
- Fixed: `{app}` left unreplaced in the invite text (placeholders now replaced everywhere).

## [1.4.1] — 2026-09-25
- Live sync switched on: connected to Firebase project `billo-app-e3a6f` (`app/sync/config.js`).

## [1.4.0] — 2026-09-25
### Added — live sync (Firebase), opt-in per trip
- **Turn on live sync** on a trip: everyone adds bills from their own phone and sees the same
  balances. Friends join with a code like `GOA-7K2Q-X9MB` and pick which member they are
  (or add themselves).
- Works **offline first**: each phone keeps its own copy; changes made offline are queued and
  synced on reconnect. Header shows `LIVE` / `SAVING` / `OFFLINE · SAVED HERE`.
- Per-document three-way merge: concurrent edits to different bills both survive; deletes,
  payments, members, UPI IDs, trip name and budget all sync. Receipt photos never leave the phone.
- No accounts: Firebase Anonymous Auth. Firestore security rules (`firebase/firestore.rules`) let
  only phones that joined a trip read or write it; tests in `firebase/rules.test.mjs`.
- Firebase SDK bundled locally (`app/sync/firebase.js`, loaded only when sync is used) — no CDN,
  still works offline. Sync stays hidden until `app/sync/config.js` has a Firebase config.
- Leave a shared trip from the members sheet; the trip code and an Invite button live there too.
- Setup guide: `SYNC-SETUP.md`. Privacy policy and data-safety answers updated for sync.
- Tests: `test/sync_test.js` (49 — 3 phones, offline queues, 25-seed convergence fuzz) and
  `test/sync_e2e.js` (21 — two real browsers through a fake Firestore).
### Changed
- The share card no longer prints the trip code for shared trips (it's an invitation).
- Imported backups become local copies (never silently re-joined to a shared trip).
- Editing a bill always edits the current copy, even if sync replaced it while you typed.

## [1.3.0] — 2026-09-25
### Changed — the "Receipt" redesign
- **New look everywhere:** paper and ink instead of dark navy and purple. Money is set in a
  typewriter face (IBM Plex Mono, even-width digits), names in Instrument Serif, UI in DM Sans.
  Cards have torn receipt edges; bills read like a restaurant bill with dotted leaders and a total line.
- **Your number first:** the trip screen opens with *You owe Rahul ₹1,600* / *You get back …*
  and a one-tap **Pay via UPI** (or **Remind**) right under it.
- **Settlement slip:** paying (UPI or ✓) now ends on a printed slip with a **SETTLED** stamp,
  what's still open in the trip, and **Share slip**.
- **Home:** each trip is a receipt stub showing *your* balance; fully settled trips get a PAID stamp;
  a line sums what you're owed and what you owe across trips.
- **Trip statement:** insights restyled as a statement (budget, where it went, paid vs. used, day by day).
- **Share card:** now a story-sized (1080×1920) printed receipt on the brand colour, with UPI IDs
  for whoever is owed.
- **Night mode:** follows the phone by default; Settings → Look → Auto / Day / Night.
- **Icons instead of emoji** in the interface (emoji rendered differently on every Android phone).
- **New app icon** (rust tile, paper receipt, ₹) — regenerate with `python3 scripts/make_icons.py`.
- Fonts are bundled in `app/fonts/` (SIL OFL, see `OFL.txt`) and cached by the service worker,
  so the look works fully offline.
### Fixed
- Budget "at this pace" projection is no longer shown from a single day of bills.
- `scripts/bump_version.py` now matches the service-worker cache name (`billo-v1.2.0`) and
  multi-digit patch versions.

## [1.2.0] — 2026-09-25
### Added
- **UPI settle-up.** Save a UPI ID for yourself (Settings) and for each member (👥 Members).
  On a settlement you owe, **Pay** opens GPay / PhonePe / Paytm / BHIM with the payee and
  exact amount pre-filled, then asks once whether it went through and records the payment.
  On one you're owed, **Remind** shares a WhatsApp-ready nudge with your UPI ID.
  The trip share text now includes each receiver's UPI ID.
- **Split by item.** A third split mode next to Equal and Amounts: add line items, tap who
  had each one, and tax / service / tip (or a discount) is spread in proportion to what each
  person ordered. Paise-exact — shares always add up to the bill.
- **Receipt line items.** On-device OCR (and the optional AI reader) now pull item names and
  prices off itemized bills; a banner offers to split the bill by item in one tap.
- **Trip insights (📊).** Spend by category, day-by-day chart, paid-vs-used per person,
  biggest bill, per-day average.
- **Trip budget.** Set a budget (and optional trip length); a progress bar on the trip screen
  turns amber at 80% and red when over, with a projection at the current pace.
- 39 new unit tests (129 total), including a 300-bill random check that itemized shares
  always sum to the bill.
### Fixed
- Adding a member on the New trip screen no longer wipes the trip name you'd typed.
- Back from Settings no longer drops you on the Welcome screen when you have no trips yet.
### Fixed
- **Snap it now actually reads bills.** On-device OCR silently failed on every
  photo: the Tesseract worker was pointed at `ocr/` as a *directory*, so it
  requested `ocr/tesseract-core-simd-lstm.wasm.js` (404 — we ship the plain
  `.js` loader plus the `.wasm` beside it), and `gzip` defaulted to `true`, so
  it requested `ocr/eng.traineddata.gz` (404 — we ship the uncompressed file).
  The worker also ran from a `blob:` URL, which left the emscripten core unable
  to resolve `tesseract-core-simd-lstm.wasm` relative to itself. Pinned
  `corePath` to the exact file, set `gzip: false` and `workerBlobURL: false`.
  Photos that previously produced "Couldn't read the amount" now fill in.
- OCR failures no longer poison the session: a rejected engine-load promise is
  no longer cached, so the next photo retries instead of failing instantly.
  Devices without WebAssembly SIMD now get a clear message.
- Bills are now read from a high-quality rendition of the photo instead of the
  small preview JPEG (1280px / q0.78). The compression artefacts were enough to
  turn "₹1,250" into "71,250". The stored/preview copy is unchanged.
- Keyword matching is whole-word everywhere, which OCR output made visible:
  an OCR'd cafe bill reading "Koramangala" matched `ola` and was filed as a cab,
  and a noisy "…evers 47:50" line matched `rs` so the total became ₹47 instead
  of ₹997.50. Amount, category and description matching all use word guards now.

## [1.1.0] — 2026-09-17
- **On-device OCR** (zero setup): bill photos are read automatically with a
  bundled Tesseract engine — no API key, no network, photo never leaves the phone
  (Apache-2.0, licensed in `app/ocr/licenses/`). Optional cloud AI (user's own
  OpenAI-compatible key) is tried first when configured, with OCR fallback.
- **Multi-expense messages**: "I paid 2200 for booze and 1388 for food" now
  parses into a reviewable list of bills (tap to uncheck, ✏️ to edit, add all).
- **Photo from gallery**: Snap it offers both 📷 Take photo and 🖼 From gallery
  (previously camera-only).
- **Working back button**: hardware/gesture back navigates the app's own stack
  (New trip → Home, Add → Trip, …) instead of closing the app. In the APK the
  shell routes back through the same stack; the app now loads over an internal
  HTTPS origin (WebViewAssetLoader) so Web Workers work natively.
- GPay/UPI support: "Paid to Rahul" participant parsing, payment boilerplate
  stripped from descriptions, Zomato/Swiggy/Uber/Ola/Rapido categories.
- Share-card back arrow fixed (Trip, not Home); category chips never wipe the
  "Say it" text box; stronger AI prompt for payment screenshots.
- 90/90 unit tests.

## [1.0.0] — 2026-09-16
- Initial release: trips, members, Say it / Snap it / Quick expense entry,
  paise-exact ledger, fewest-payment settlements, WhatsApp share card,
  EN + हिंदी, pattern-learning participant suggestions, backup export/import,
  Pro paywall wired to Google Play Billing (₹79/mo · ₹399/yr · ₹699 lifetime),
  PWA (manifest + service worker), full Play Store kit.
