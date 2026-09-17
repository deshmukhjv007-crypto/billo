# Changelog

One entry per released build. When a change ships, add a line under the current
version. Bump the number with: `python3 scripts/bump_version.py X.Y.Z`

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
