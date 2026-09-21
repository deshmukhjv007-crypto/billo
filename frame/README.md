# Prolens — your pocket photographer

A standalone, mobile-friendly camera-coach prototype. Existing Billo, Myna and portfolio apps are unchanged.

## Run

```sh
cd frame
npm start       # http://localhost:4173; listens on 0.0.0.0
npm test        # dependency-free analysis and HTTP tests
```

Node.js 20+; no runtime dependencies. Set `PORT` to override 4173. Camera access needs HTTPS (or localhost) and permission. The Arena HTTPS preview works without host allowlists. If an embedded browser blocks camera permission, open the preview in its own tab. Demo and photo upload work without a camera.

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

## Working now

- Camera permission, front/back camera requests, local live preview and camera shutdown.
- Low-resolution brightness, contrast and highlight/shadow clipping analysis once per second. The score is a **light-level heuristic**, not an assessment of aesthetic quality.
- Smart auto is on by default. It waits for similar light readings, makes conservative exposure adjustments, rate-limits hardware updates, and pauses 15 seconds after manual edits. Initial adjustment can happen after two usable readings; actual latency depends on device and permission/warm-up time.
- Requests continuous device exposure, white balance and autofocus **only when reported as supported**. Attempts exposure compensation/zoom on supported video tracks, verifies settings and labels image-only fallbacks. Browsers do not consistently expose these controls.
- No attempt to classify complexion or ethnicity; no skin lightening or colour-based face detector. No automatic warmth change based on a colourful dress or background. Creative warmth effects are explicitly not calibrated white balance.
- Rule-of-thirds overlay, framing demonstration, four educational photography modes, aspect ratios, exposure/warmth/zoom controls, and reset.
- Photo upload for private image analysis. No images are sent to a server.
- Canvas capture with crop/zoom and image adjustments, browser-local gallery, JPEG download and confirmed deletion. Up to 12 photos; storage quota failures offer direct download. Downloads are the permanent backup.
- Camera captures are preview-frame captures capped at 1400px wide, **not native full-resolution stills**. No native portrait blur or multi-frame night processing is simulated.
- Camera-permission/no-device feedback, keyboard capture, responsive layout and accessible control labels.
- Source-linked field guide covering light, natural colour, clothing detail, composition and hardware limits.

## Important boundaries

This is not a native Android/iOS app, cannot change another camera app, and does not yet detect faces, skin regions, clothing, background semantics or scene categories. Modes change educational guidance, not lenses or hardware presets. The demo photograph is AI-generated; its initial score and scene-specific guidance are illustrative. Live/upload composition and background guidance are labelled as guidance, not detections. Global light measurements alone cannot determine the “best” exposure for every complexion, outfit or artistic intent.

The `Warmth` slider is a creative image effect. It does not measure colour temperature or apply calibrated Kelvin/tint correction. Native subject-aware metering, segmentation, multi-frame HDR and validated colour management are the next production stage; see [NATIVE-PLAN.md](NATIVE-PLAN.md).

## Photography and engineering references

1. Adobe, _How to adjust skin tones_: use neutral references to diagnose colour casts and distinguish global colour changes from subject-local corrections. [1](https://www.adobe.com/products/photoshop/fix-skin-tone.html)
2. Adobe, _Capturing light: The power of the exposure triangle_: retain detail in highlights and shadows and inspect histograms. These are starting principles, not a universal target histogram. [2](https://blog.adobe.com/en/publish/2022/09/19/capturing-light-power-exposure-triangle)
3. Android, _CameraX configuration_: supported controls, AF/AE/AWB metering, capability-aware exposure compensation and exposure-step handling. [3](https://developer.android.com/media/camera/camerax/configuration)
4. Android, _CameraControl_: asynchronous control application and device-dependent low-light boost. [4](https://developer.android.com/reference/androidx/camera/core/CameraControl)

The app's conservative thresholds are prototype heuristics, not values prescribed or certified by these sources.

## Validation

- Ten `node:test` checks: dark/bright frames, neutral midtones, highlight priority, weighted luminance, contrast, crop geometry, static assets and traversal rejection.
- Chromium browser smoke checks: demo capture, upload, manual controls/reset, gallery persistence/download links/deletion, mode/ratio/grid controls, preferences, missing-camera recovery and responsive widths 390/768/1024/1440.
- Chromium synthetic-camera checks: connection, live analysis, auto-tune, capture, switching request and shutdown, with no JS errors.
- Real phone camera hardware, sensor behaviour, colour fidelity and end-to-end latency still require physical-device testing. Synthetic-camera tests do not establish a “within seconds” guarantee on actual devices.

## Privacy

No analytics, accounts, API keys or server uploads. Images are analysed in canvas on the device. Captures and preferences live in this origin's localStorage and are accessible to scripts served from the same origin. Clearing browser data removes them. Fonts are requested from Google Fonts; self-host them if fully offline operation is required. Do not describe the app as end-to-end encrypted or as a permanent photo backup.
