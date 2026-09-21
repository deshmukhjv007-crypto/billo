# Production path: point → settle → capture

## Product promise

An approachable camera **within Prolens**, not remote control of the installed camera app. One primary shutter, Smart Auto on, natural colour first. Aim for a useful initial setting within 1–2 seconds **after camera preview is ready** on target devices. This is a performance target to validate, not a current guarantee. Say “Ready” only after camera-control completion and stable metering.

## Android first

Use Kotlin + CameraX `Preview`, `ImageAnalysis`, and `ImageCapture`. Bind to lifecycle; use keep-only-latest analysis backpressure. Feed downscaled frames to an on-device analyzer off the UI thread, initially 5–10 Hz, with adaptive throttling for heat and battery. Deliver full-resolution stills through `ImageCapture`, never by screenshotting the preview.

Use CameraInfo to query exposure range and step, autofocus/metering support, zoom and extensions. Use `startFocusAndMetering` with AF/AE/AWB regions based on a detected subject or user tap, `setExposureCompensationIndex` for bounded compensation and `setZoomRatio` for zoom. Await completion and inspect reported state. Low-light boost, HDR, Night and Bokeh extensions must be individually capability-gated. CameraX controls and metering are documented here. [1](https://developer.android.com/media/camera/camerax/configuration) [2](https://developer.android.com/reference/androidx/camera/core/CameraControl)

Use Camera2 interop only where supported and validated. Do not promise simultaneous independent manual ISO, shutter, Kelvin or aperture controls on every phone. Many phone apertures are fixed; automatic exposure and manual sensor settings can conflict.

## Subject-aware decisions

1. **Locate, don’t identify.** Add a licensed, on-device face/person detector or segmenter. Do not recognise identities, estimate race/ethnicity, or map complexion to a prescribed brightness. Keep frames and landmarks ephemeral.
2. **Meter locally.** Measure subject-region luminance distributions, clipping and local contrast. Handle multiple subjects; use a user-selected subject when confidence is low. Confidence is not interchangeable with photographic quality.
3. **Preserve skin and clothing.** Distinguish genuine highlight clipping from bright fabric, specular reflections and naturally light skin. Preserve texture in dark clothes without lifting every shadow. Never use a colourful garment as the white-balance neutral reference. Adobe's guidance supports checking neutral references and separating colour-cast correction from subject-local colour work. [3](https://www.adobe.com/products/photoshop/fix-skin-tone.html)
4. **Choose feasible settings.** Prefer device auto white balance; meter around the subject where supported. Protect important highlights, consider HDR when scene range exceeds capture range, and factor subject/device motion into shutter/noise trade-offs. If physical light is insufficient, show one useful action instead of implying an exposure slider can create detail.
5. **Avoid pumping.** Smooth readings, require confidence/stability, apply bounded changes with hysteresis, debounce after camera changes, and pause automatic decisions after manual input. Do not stack multiple outstanding exposure changes.
6. **Keep the human in control.** “Step into softer light” beats a settings dashboard. Allow tap-to-meter, auto lock, undo, and explicit manual overrides. Describe failure: “Face in deep shadow—move toward a window,” not “Perfect shot.”

## iPhone

An equivalent native AVFoundation capture pipeline needs a separate implementation and validation of device formats, focus/exposure/white-balance modes, capture settings and permissions. Reuse decision policy and design principles, not assumed Android hardware controls. No iOS integration is implemented in this prototype.

## Physical-device acceptance gates

- At least representative low/mid/high Android devices and selected iPhones; outdoor, window, tungsten, fluorescent/LED, mixed light, backlit and very dim scenes.
- Consenting subjects with varied complexions, makeup, hair, white/dark/saturated clothing and multiple people. Include standard colour/grey references for technical tests, not as a mandatory user task.
- Evaluate skin-colour fidelity against reference captures and human review, retained clothing texture, clipping, noise, motion blur, and autofocus success; do not judge quality with a single brightness target.
- Record p50/p95 time from usable preview to completed control convergence, including model initialization, exposure settle, power saver and thermal conditions. Publish only measured device-specific performance.
- No progressive exposure drift or flicker across stable scenes; repeatability when moving between scenes; hardware failure and permission recovery; rotation, suspend/resume and incoming-call interruption.
- Test full-resolution capture versus preview appearance, orientation, colour space, HDR output, optional location metadata and local deletion.
- Privacy review: explicit permissions, no hidden uploads or persistent biometric templates, inspect model licences and network activity, clear retention controls.
- Permission UX review: the web build asks for camera access exactly once and remembers the answer (`public/permission.js`). A native shell should hold the same promise — one system prompt on first launch, silent start afterwards, and a visible state (Allowed / Blocked / Not requested) in preferences.

This plan describes follow-on work; it is not a claim that native integration or subject recognition is already delivered.
