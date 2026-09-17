# Changelog

One entry per released build. When a change ships, add a line under the current
version. Bump the number with: `python3 scripts/bump_version.py X.Y.Z`

## [Unreleased]
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
