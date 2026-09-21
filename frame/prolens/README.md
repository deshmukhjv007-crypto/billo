# Prolens — native app (Expo)

The native Prolens camera coach: real-time on-device coaching (composition,
lighting, exposure, motion) with a vision-camera viewfinder and HUD overlays.

This is Step 1–8 of the native build. The browser prototype in `frame/public/`
is unchanged — see [`frame/README.md`](../README.md) — and the production
acceptance gates still live in [`frame/NATIVE-PLAN.md`](../NATIVE-PLAN.md).

## Structure

```
prolens/
├── App.tsx                      # Step 8 — entry point
├── app.json                     # Step 1 — camera permissions (iOS + Android)
├── src/
│   ├── coaching/
│   │   ├── PhotographyRules.ts  # Step 2 — the rulebook (composition, light, exposure…)
│   │   ├── SuggestionEngine.ts  # Step 4 — the brain: FrameAnalysis → top-2 tips
│   │   └── VoiceCoach.ts        # Hands-free spoken coaching (debounced, rate-limited)
│   ├── ai/
│   │   ├── SceneAnalyzer.ts     # Step 3 — FrameAnalysis / FaceData / Lighting types
│   │   ├── ExposureOptimizer.ts # Step 5 — skin-tone-aware (Zone System) exposure
│   │   └── ColorScience.ts      # RGB → CIELAB → ITA° skin-tone math (worklet-safe)
│   ├── camera/
│   │   ├── CameraView.tsx       # Step 6 — vision-camera view + frame processor
│   │   ├── PixelAnalyzer.ts     # Worklet pixel analysis (luminance, clipping, backlit)
│   │   ├── FaceSkinAnalyzer.ts  # Worklet cheek/forehead sampling → ITA° + luminance
│   │   └── useFrameAnalyzer.ts  # Pipeline: throttle + pixels + sensors → FrameAnalysis
│   ├── sensors/
│   │   └── useDeviceOrientation.ts # DeviceMotion tilt/shake → ref + shared values
│   ├── hud/
│   │   ├── SuggestionBubble.tsx # Step 7 — animated coaching tip
│   │   ├── GridOverlay.tsx      # Step 7 — thirds / golden-ratio grid
│   │   ├── HorizonLevel.tsx     # Step 7 — tilt indicator (green when level)
│   │   ├── HUDOverlay.tsx       # Step 7 — readiness corners + score badge
│   │   └── ControlsBar.tsx      # Voice toggle + grid mode (thirds/golden/off)
│   └── screens/
│       └── ReviewScreen.tsx     # Post-capture AI critique + save to gallery
```

## Setup

Requires Node 20+, the Expo CLI, and (for on-device runs) a development
build — `react-native-vision-camera` uses custom native code, so it does not
run inside Expo Go.

```sh
cd frame/prolens
npm install
npx expo install --fix          # align native modules with the Expo SDK
npx expo prebuild               # generate android/ + ios/
npx expo run:android            # or: npx expo run:ios
```

Camera permissions are declared in `app.json`:

- iOS: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSMotionUsageDescription` (tilt/stability).
- Android: `CAMERA`, `WRITE_EXTERNAL_STORAGE`. Microphone is off
  (`enableMicrophonePermission: false`) — Prolens never records audio.

## Current state / TODOs

- `CameraView.tsx` runs the real pipeline: `useFrameAnalyzer` throttles to
  every 3rd frame, `PixelAnalyzer` reads luminance/clipping/backlit from the
  RGB frame buffer, and `useDeviceOrientation` streams tilt/shake from
  DeviceMotion at 20 Hz. Shutter captures to `ReviewScreen` (AI critique +
  gallery save via `expo-media-library`); `ColorScience.ts` is the single
  source of ITA° truth (the `ExposureOptimizer` duplicate is removed).
  `VoiceCoach` speaks critical/high tips hands-free, `ControlsBar` toggles
  voice + grid mode, and `FaceSkinAnalyzer` samples cheek/forehead pixels
  for the face-detector milestone.
  Still TODO: face/landmark detector wiring, histogram, dominant colors,
  golden-ratio centroids, exposure application — plus physical-device
  validation of the rotation-axis mapping and RGB layout assumptions
  (see TODOs in code).
- Exposure application (`exposure` → camera device) and photo save + review
  screen are stubbed with `TODO`s.
- `zustand` + `react-native-mmkv` (settings/session state),
  `@shopify/react-native-skia` (custom HUD rendering), `expo-speech`
  (voice coaching) and `expo-sensors` (gyro tilt) are installed for the next
  milestones but not yet wired into the UI.

## Privacy

Same promise as the web prototype: frames are analysed on-device, no
analytics, no accounts, no uploads. Microphone permission is never requested.
