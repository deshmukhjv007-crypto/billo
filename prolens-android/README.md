# Prolens — native Android camera coach

Prolens looks at what you're pointing at, reads what **your** phone's camera can do, sets the
camera up for the shot and tells you how to hold it — then scores the photo and says what to
change next time. Everything runs on the phone; nothing is uploaded.

## What it does

| | |
|---|---|
| **Auto settings per shot** | Meters and focuses on the face (or the dish/product), steers exposure compensation so the subject lands at the right brightness without blowing out the sky, switches to **Night** or **HDR** where the phone supports them, and on phones with manual control takes a steady long exposure (e.g. ½ s at ISO 400) instead of a noisy one. The top bar shows what it chose (`ISO 400 · 1/60 s · +0.7 EV · face`); tap it for the reasons. |
| **Live framing coach** | One cue at a time, always "what to do with the phone": level it, raise it to eye level, tilt down, step back, move left, turn toward the light, hold steady. Arrows on screen, debounced so they don't flicker. The shutter ring fills as the shot improves and turns green when it's ready. |
| **Scene presets** | Auto (picks for you), Portrait, Group, Food, Landscape, Night, Product — each with its own exposure target, angle, subject size, lens (e.g. 2× for portraits/products) and mode. |
| **Shot review** | Score out of 100 (exposure, sharpness, level & angle, framing, light), what went right, the top three things to change, and what Prolens set. |
| **Seller Studio** (v0.2) | Finds the product against its background and runs a live checklist: white, even background · whole product in frame · big enough · sharp · straight. After the shot, **Make listing image** cuts a square with the product filling ~87% (Amazon asks 85%+), pads with white, lifts the background to pure white and saves a 2000 px JPEG to *Pictures/Prolens Listings*. A *Social* style makes 1080 px squares on a plain background. |
| **Settings, intro, crash safety** (v0.2) | Grid, tips, vibration, review-after-shot, save to main Camera album or a Prolens album, listing style. A 3-page intro on first launch. Crash reports are kept on the phone and offered for sharing on the next launch. In-app privacy policy. |
| **Prolens Pro** (v0.2) | One-time in-app purchase (`prolens_pro_lifetime`, suggested ₹299) through Google Play Billing 7. Free: live coaching, Auto, Portrait, Food, Seller Studio with 3 listing images a day, one review tip. Pro: every preset, steady long exposure, all review tips, unlimited listing images. |

It respects each phone's limits: exposure range and step, ISO/shutter ranges and manual-sensor
support, metering/focus regions, zoom range and ultra-wide, flash, OIS, and whether Night/HDR
extensions exist. Anything a phone can't do is simply not offered.

## Layout

```
app/src/main/java/com/prolens/app/
├── core/            pure Kotlin — the "camera brain", unit-tested on the JVM
│   ├── Model.kt         frames, faces, capabilities, camera state
│   ├── FrameStats.kt    luma histogram, clipping, centre/border, sharpness, colour cast (sensor → upright)
│   ├── Presets.kt       the seven presets + AUTO scene classifier (sticky, no flicker)
│   ├── Planner.kt       exposure/metering/mode decisions: closed loop, dead-banded, rate-limited
│   ├── Coach.kt         live cues with hysteresis and debouncing
│   ├── ShotReview.kt    score + tips for a finished photo
│   └── Seller.kt        product finder, listing checklist, listing crop, free-vs-Pro rules
├── camera/          CameraX + Camera2 interop + ML Kit faces + motion sensors
├── billing/         ProStore: Google Play Billing for Prolens Pro
├── Prefs.kt, ProlensApp.kt   settings storage; crash reporter + billing start-up
└── ui/              camera, overlay, review + listing maker, settings, intro, paywall, privacy
app/src/test/…       CoreTest.kt + SellerTest.kt — 36 tests for the brain
docs/privacy-policy.html      the page to host and link in Play Console
```

## Build

No Android Studio needed: every push that touches `prolens-android/` runs
**Actions → Build Prolens Android APK**, which runs the unit tests and builds the APK.
Download it from the run page (**Artifacts → prolens-debug-apk**), unzip, and install
`app-debug.apk` on your phone (allow "install unknown apps" for your browser/Files app).

Locally with Android Studio: *File → Open* → `prolens-android/` → Run.
Command line (Gradle 8.9+, JDK 17, Android SDK): `gradle testDebugUnitTest assembleDebug`.

Requires Android 8.0+ (API 26). Permissions: camera; storage only on Android 9 and older (to save photos).

## Before publishing on Google Play

1. **Support email:** set `SUPPORT_EMAIL` in `ui/LegalActivity.kt` and replace `ADD-YOUR-SUPPORT-EMAIL-HERE` in `docs/privacy-policy.html`.
2. **Host the privacy policy:** drag `docs/privacy-policy.html` onto Netlify Drop (or GitHub Pages) and paste the URL into Play Console → App content → Privacy policy.
3. **Package name:** `com.prolens.app` must be free on Google Play. If Play Console says it is taken, change `applicationId` in `app/build.gradle.kts` (e.g. `com.yourname.prolens`) before the first upload — it can never change afterwards.
4. **Pro product:** Play Console → Monetize → Products → In-app products → create `prolens_pro_lifetime`, set the price, activate it. Add yourself as a licence tester to test purchases without being charged.
5. **Release build:** Play needs a signed `.aab` (bundle). Test builds show an "Unlock Pro for testing" switch in Settings; store (release) builds ignore it.

## Notes & limits (v0.1)

- Exposure is steered through the phone's own auto-exposure (compensation + metering region),
  which works on every phone; manual ISO/shutter is used only for the steady-night shot.
- Metering never depends on skin tone: faces are metered to the same mid-tone target.
- Night/HDR use the phone maker's CameraX extensions; many mid-range phones don't ship them —
  then Prolens falls back to steady long exposure (manual-capable phones) or tells you to brace.
- White balance is left on auto; warm/cool casts are reported in the reasons.
