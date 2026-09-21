# Prolens — your pocket photographer

A standalone, mobile-friendly camera-coach prototype. Existing Billo, Myna and portfolio apps are unchanged.

## Run

```sh
cd frame
npm start       # http://localhost:4173; listens on 0.0.0.0
npm test        # dependency-free analysis and HTTP tests
```

Node.js 20+; no npm runtime dependencies. Set `PORT` to override 4173. Camera access needs HTTPS (or localhost) and permission. The Arena HTTPS preview works without host allowlists. Embedded previews can only grant camera access for the current page load, so Prolens waits for one tap there instead of prompting: open the preview in its own tab and the permission is remembered for good. Photo upload and the field guide work without a camera.

**Generated artwork, not stock photos.** The standby backdrop is code (`public/ambient.js`): cached static layers plus pre-rendered glow sprites, drawn at 20 fps and stopped whenever the stage is not showing it. Icons are generated the same way (`tools/make-icons.mjs`), so the repo carries no design binaries.

**Self-hosted face detection.** `public/vendor/facedet/` contains Google's
MediaPipe face-detection solution (Apache-2.0) — the JS API, the
`blaze_face_short_range` model (~200 KB) and the WASM runtime (~5.5 MB raw,
~1.7 MB gzipped). Nothing is fetched from a CDN at runtime: the model loads
lazily **only when the camera is turned on**, and the service worker caches it
for offline use. Every browser downloads exactly one runtime variant (SIMD or
fallback). The repo's only binary weight is this vendor folder; if you must
keep the repo lean, everything except it is small.

## Host on Netlify (fix for “Page not found”)

The app is a static site: everything the browser needs is inside **`frame/public/`**.
Netlify shows a broken/“Page not found” page when the publish directory does not
contain `index.html` — so **do not publish the `frame/` folder itself**.

Pick one method:

**Option A — Drag & drop (simplest).** Open
[app.netlify.com/drop](https://app.netlify.com/drop) and drop the
**`frame/public` folder** (the one containing `index.html`), not `frame/`.

**Option B — Git (auto-deploys on push).** Connect the repo and set:

| Setting | Value |
|---|---|
| Base directory | *(empty)* |
| Build command | *(empty — no build step)* |
| Publish directory | `frame/public` |

A [`netlify.toml`](../netlify.toml) with these settings is already in the repo,
plus [`frame/netlify.toml`](netlify.toml) if you set the base directory to `frame`.

## Install on a smartphone

Netlify serves HTTPS, so the app is installable once deployed:

- **Android (Chrome):** open the Netlify URL → tap ⋮ → **Add to Home screen**
  (or **Install app**). The icon, splash screen and offline support come from
  `manifest.webmanifest` + `sw.js`.
- **iPhone (Safari):** open the Netlify URL → tap Share → **Add to Home Screen**.

Grant camera permission when asked — analysis and photos stay on the device.

## UI

Prolens opens straight into a **full-screen camera app** — no sidebar, no website chrome, no stock sample photo. A deep-space instrument palette (near-black, cyan/violet HUD accents, mono readouts, hairline borders, soft glows) with a live aurora field and grid behind glassy overlay controls.

**Standby field (camera off).** Instead of a placeholder photograph, the stage shows a generated sensor backdrop — a procedural canvas viewfield (drifting light pools, a slowly turning reticle, a scanning line, grain and vignette) drawn on your device with zero network requests, zero image files and no stock assets. It runs only while it is on screen (usually 8–10 MB of canvas work per second, static layers cached) and stops the instant a live camera or an analysed photo takes over. A single glass card explains the app and offers **Enable camera** or **Analyse a photo**; while a photo is being analysed the card is replaced by a floating **Use camera** pill.

- **Camera permission is asked once, ever.** See “Camera access” below.
- **Live coach score in a corner badge** (top-left ring). While the camera is live it is a **shot-readiness score** blending light, steady hands and subject framing — the coach sheet breaks it down into three bars. Tap it for the full coach sheet: score + breakdown, lighting/composition/background checks, the light meter, a mode tip, Auto-tune and the Smart auto toggle. In standby the badge shows a dash and a breathing ring instead of a fake number.
- **The app sees your subject**: on-device face detection (MediaPipe) snaps the subject bracket onto a real face, meters exposure on the face region, and gives live gridline guidance ("slide a little left…"). Everything runs on the phone; frames never leave the device.
- **Steady meter**: a frame-difference motion check shows a live **Steady / Moving** chip, and the shutter glows when light, steadiness and framing are all good — the app tells you when to press.
- **Burst assist** (on by default): one tap grabs 3 frames in ~0.7 s and keeps the sharpest (Laplacian score), so a casual tap still lands a sharp photo. **Self-timer** (off/3 s/10 s) for selfies.
- **Tap-to-meter**: tap anywhere on the viewfinder to meter and frame that spot (tap again to move, tap it to clear).
- **Camera-style bottom controls**: mode row (Portrait / Landscape / Food / Night), last-shot thumbnail, shutter, and front/back flip.
- **Fine-tune sheet** (sliders tool, top right): exposure, warmth and zoom with the same capability-aware hardware/image-only behaviour as before, plus live Steady/timer/EV/warmth/zoom indicator chips over the viewfinder.
- **Capture-ratio letterbox**: the black frame over the live view is the exact crop that gets captured (cover → zoom → ratio), and the rule-of-thirds grid is aligned to it.
- Tapping the **Prolens** wordmark opens the menu sheet: camera on/off, My shots, Field guide, Preferences, About.
- My shots and Field guide are full-screen dark pages with the same content as before.

## Camera access — one prompt, then never again

Prolens is built so the browser permission prompt appears **exactly once**, on the first run, and never again:

| Situation | What Prolens does |
|---|---|
| First run, never asked | Asks once (that is the browser prompt), then connects on every later launch automatically |
| Permission already granted | Connects silently — no prompt, no tap needed |
| Browser without a Permissions API (Safari) | Remembers your grant locally and reconnects silently, so only the very first request prompts |
| Camera switched off in the menu | Stays in standby until you switch it back on; reopening the app does not undo your choice |
| Permission refused | Explains how to allow it, does **not** re-ask on every launch (re-asking a denial only fails and cannot prompt again) |
| Inside an embedded preview iframe | Waits for one tap instead of consuming the single prompt, because an embedded grant can be session-scoped |

Preferences shows the current state (**Allowed / Blocked / Not requested**) with the matching action, and a **Reset** option re-arms the first-run request if you ever want the prompt again. The policy itself lives in [`public/permission.js`](public/permission.js) as one small pure function with unit tests, so the behaviour is inspectable rather than tribal knowledge.

## Working now

- Camera permission asked once (see above), front/back camera requests, local live preview and camera shutdown (from the menu sheet, or automatically when the stream ends).
- **Live coach pipeline (~5 Hz, all on-device)**: brightness/contrast/highlight analysis; frame-difference **steadiness** meter; on-device **face detection** (self-hosted MediaPipe, short-range BlazeFace) that tracks a subject, meters the face region and drives framing guidance; and a **composite shot-readiness score** (light 50%, steadiness 25%, framing 25%; weights renormalise when a term is unavailable). The score is a guidance heuristic, not an aesthetic judgment.
- **Burst-assist capture**: three frames, keep the sharpest by Laplacian-variance score. **Self-timer** with on-screen countdown. **Tap-to-meter** for subject-specific exposure.
- Smart auto is on by default. It waits for similar light readings, makes conservative exposure adjustments, rate-limits hardware updates, and pauses 15 seconds after manual edits. Initial adjustment can happen after two usable readings; actual latency depends on device and permission/warm-up time.
- Requests continuous device exposure, white balance and autofocus **only when reported as supported**. Attempts exposure compensation/zoom on supported video tracks, verifies settings and labels image-only fallbacks. Browsers do not consistently expose these controls.
- No attempt to classify complexion or ethnicity; no skin lightening or colour-based face detector. No automatic warmth change based on a colourful dress or background. Creative warmth effects are explicitly not calibrated white balance.
- Rule-of-thirds overlay, framing demonstration, four educational photography modes, aspect ratios, exposure/warmth/zoom controls, and reset.
- **Standby field**: a procedurally drawn sensor backdrop shown while the camera is off — no stock photo, no image downloads, stopped whenever it is off screen.
- Photo upload for private image analysis. No images are sent to a server.
- Canvas capture with crop/zoom and image adjustments, browser-local gallery, JPEG download and confirmed deletion. Up to 12 photos; storage quota failures offer direct download. Downloads are the permanent backup.
- Camera captures are preview-frame captures capped at 1400px wide, **not native full-resolution stills**. No native portrait blur or multi-frame night processing is simulated.
- Camera-permission/no-device feedback, keyboard capture, responsive layout and accessible control labels.
- Source-linked field guide covering light, natural colour, clothing detail, composition and hardware limits.
- App icons are regenerated procedurally with `node tools/make-icons.mjs`; no binary design sources are kept in the repo.

## Important boundaries

This is not a native Android/iOS app and cannot change another camera app. It detects **face positions only** (bounding boxes, no landmarks, no tracking across people, no identity, no skin/skin-tone classification) to guide framing and metering; it still does not detect clothing, background semantics or scene categories. If the face model fails to load (old browser, very slow network) the app keeps working with light + steadiness only and says so. Modes change educational guidance, not lenses or hardware presets. The standby backdrop is a generated abstract field, not a camera preview: it shows no subject, no score and no measurement. Live/upload composition and background guidance are labelled as guidance, not detections. Global light measurements alone cannot determine the “best” exposure for every complexion, outfit or artistic intent.

The `Warmth` slider is a creative image effect. It does not measure colour temperature or apply calibrated Kelvin/tint correction. Native subject-aware metering, segmentation, multi-frame HDR and validated colour management are the next production stage; see [NATIVE-PLAN.md](NATIVE-PLAN.md).

## Photography and engineering references

1. Adobe, _How to adjust skin tones_: use neutral references to diagnose colour casts and distinguish global colour changes from subject-local corrections. [1](https://www.adobe.com/products/photoshop/fix-skin-tone.html)
2. Adobe, _Capturing light: The power of the exposure triangle_: retain detail in highlights and shadows and inspect histograms. These are starting principles, not a universal target histogram. [2](https://blog.adobe.com/en/publish/2022/09/19/capturing-light-power-exposure-triangle)
3. Android, _CameraX configuration_: supported controls, AF/AE/AWB metering, capability-aware exposure compensation and exposure-step handling. [3](https://developer.android.com/media/camera/camerax/configuration)
4. Android, _CameraControl_: asynchronous control application and device-dependent low-light boost. [4](https://developer.android.com/reference/androidx/camera/core/CameraControl)

The app's conservative thresholds are prototype heuristics, not values prescribed or certified by these sources.

## Validation

- Seventeen `node:test` checks: dark/bright frames, neutral midtones, highlight priority, weighted luminance, contrast, crop geometry, static assets and traversal rejection, motion-difference and sharpness helpers, plus the camera-consent policy (first run asks; granted launches stay silent; a refusal is remembered; an embedded first run waits for a tap; the user's own off switch wins).
- Chromium browser smoke checks (23 scenarios across four profiles — granted, first-run, refused, embedded): silent reconnect on later launches, standby after switching the camera off (and after a reload), shutter behaviour in standby, coach/fine-tune sheets, capture → gallery, upload analysis and its "use camera" pill, blocked-permission guidance, the embedded-frame rule, lifestyle lifecycle of the standby field, and responsive widths up to 1440.
- Chromium synthetic-camera checks: connection, live analysis, auto-tune, capture, switching request and shutdown, with no JS errors.
- Real phone camera hardware, sensor behaviour, colour fidelity and end-to-end latency still require physical-device testing. Synthetic-camera tests do not establish a “within seconds” guarantee on actual devices.

## Privacy

No analytics, accounts, API keys or server uploads. Images are analysed in canvas on the device; face detection runs entirely in the browser via the self-hosted MediaPipe model in `public/vendor/facedet/` — no frame, crop or photo is ever sent anywhere. Captures and preferences live in this origin's localStorage and are accessible to scripts served from the same origin. Clearing browser data removes them. Fonts are requested from Google Fonts; self-host them if fully offline operation is required. Do not describe the app as end-to-end encrypted or as a permanent photo backup.
