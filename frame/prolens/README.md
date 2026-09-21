# Prolens — native app (Expo)

The native Prolens camera coach: real-time on-device coaching (composition,
lighting, exposure, motion) with a vision-camera viewfinder and a native-style
camera shell. **Coaching is visual first** — a spirit level, big direction
chevrons and short icon pills. Voice coaching is optional and **off by
default**.

This is Step 1–8 of the native build plus the "Native Camera Shell v2" UI
overhaul. The browser prototype in `frame/public/` is unchanged — see
[`frame/README.md`](../README.md) — and the production acceptance gates still
live in [`frame/NATIVE-PLAN.md`](../NATIVE-PLAN.md).

## HUD map

```
┌──────────────────────────────────────────────┐
│ [⚡ flash]        PORTRAIT           [⚙ gear] │  TopBar (safe-area top)
│                                              │
│              ( ↺  Tilt left )                │  SuggestionBubble — 1 primary pill
│              ( ✋ Hold steady )               │  (+ optional secondary: high/critical,
│                                              │   different category)
│   ‹‹                                    ››   │  DirectionOverlay — big chevrons /
│               ↺ (rotate glyph)               │  rotate arrow / magnifier / brackets,
│                                              │  shows 2.5 s after a cue appears
│        ─┤  ┼  ├──[ ● ]──┤  ┼  ├─             │  HorizonLevel — spirit level
│         −5°     0      +5°                   │  green <1° · yellow <3° · white
│                                              │
│                 (.5) (1×) (2)                │  BottomBar — zoom chips
│   [thumb]        (  ◉  )        [flip]       │  gallery · shutter (green ring when
│                                              │  ready) · camera flip
└──────────────────────────────────────────────┘
   ⚙ gear → SettingsSheet tray: GRID [THIRDS | GOLDEN | OFF] · VOICE OFF / VOICE ON
```

Cue convention: **every cue is the direction to move the phone.** `rotate-ccw`
= tilt the phone left, `arrow-left` = pan the phone left, `step-back` = move
back. The spirit-level bubble drifts towards the side that is *high*, like a
builder's level — lower that side until the bubble sits between the gates.

| Cue (`visualCue`)          | Pill glyph | DirectionOverlay                         | Voice (if ON) |
| -------------------------- | ---------- | ---------------------------------------- | ------------- |
| `rotate-ccw` / `rotate-cw` | ↺ / ↻      | curved rotate arrow above the level      | Tilt left / right |
| `arrow-left` … `arrow-down`| ← → ↑ ↓    | double chevron at that edge (nudges)     | Pan left / right, Tilt up / down |
| `step-closer` / `step-back`| ⊕ / ⊖      | magnifier with + / −                     | Step closer / back |
| `wait`                     | ✋          | breathing ring around the centre         | Hold steady |
| `shoot-now`                | 📸         | four corner brackets, green, pulsing     | Shoot now |
| `tap-to-focus`             | ◎          | reticle at the suggested tap point       | (label) |

There is **no numeric score on the live view**. The Pro Score, tilt in degrees
and the exposure breakdown live on the Review screen only.

## Flow

```
Camera ──shutter──▶ Review ──Save──▶ (stays on Review, "✓ Saved")
   ▲                  │  ▲
   │                  │  └── View Gallery ──▶ Gallery ──‹ back──▶ Review
   └───── Retake ─────┘
   └── thumbnail ─────────────────────────▶ Gallery ──‹ back──▶ Camera
```

- Voice: silent on cold launch. Toggle under ⚙ → **VOICE OFF / VOICE ON**. When
  on, `VoiceCoach` speaks only short commands ("Tilt left", "Pan right",
  "Hold steady", "Shoot now"), rate-limited and never for low/praise tips.
- Haptics: light impact once when the level enters green; success on
  shoot-now and on capture; selection on every chip/toggle.
- Suggestions: `SuggestionEngine.generate()` returns what should be on screen
  *right now* — an action tip stays while its condition holds and clears the
  moment it is fixed (short anti-strobe cooldown); pro-tips/praise show for
  4 s then rest for 20 s.

## Structure

```
prolens/
├── App.tsx                      # Entry: GestureHandlerRootView + SafeAreaProvider
├── app.json                     # Camera + photo-library permissions (iOS + Android)
├── babel.config.js              # worklets-core plugin, then reanimated plugin (last)
├── src/
│   ├── coaching/
│   │   ├── PhotographyRules.ts  # The rulebook (composition, light, exposure…)
│   │   ├── SuggestionEngine.ts  # FrameAnalysis → live tips (label + visualCue), max 2
│   │   └── VoiceCoach.ts        # Optional speech, default OFF, short phrases only
│   ├── ai/
│   │   ├── SceneAnalyzer.ts     # FrameAnalysis / FaceData / Lighting types
│   │   ├── ExposureOptimizer.ts # Skin-tone-aware (Zone System) exposure
│   │   └── ColorScience.ts      # RGB → CIELAB → ITA° skin-tone math (worklet-safe)
│   ├── camera/
│   │   ├── CameraView.tsx       # Viewfinder + HUD composition + screens (camera/review/gallery)
│   │   ├── PixelAnalyzer.ts     # Worklet pixel analysis (luminance, clipping, backlit)
│   │   ├── FaceSkinAnalyzer.ts  # Worklet cheek/forehead sampling → ITA° + luminance
│   │   └── useFrameAnalyzer.ts  # Pipeline: throttle + pixels + sensors → FrameAnalysis
│   ├── sensors/
│   │   └── useDeviceOrientation.ts # DeviceMotion tilt/shake → ref + shared values
│   ├── hud/
│   │   ├── TopBar.tsx           # Flash cycle · scene label · settings gear
│   │   ├── BottomBar.tsx        # Zoom chips · last-photo thumb · shutter · flip
│   │   ├── HorizonLevel.tsx     # Spirit level (bubble, −5°/0/+5° ticks, green/yellow/white)
│   │   ├── DirectionOverlay.tsx # Big chevrons / rotate / magnifier / brackets per visualCue
│   │   ├── SuggestionBubble.tsx # Icon pills: 1 primary (+1 secondary max)
│   │   ├── GridOverlay.tsx      # Thirds / golden-ratio grid
│   │   ├── ControlsBar.tsx      # Compact tray content: grid segmented + voice toggle
│   │   └── SettingsSheet.tsx    # Bottom-sheet modal hosting ControlsBar
│   └── screens/
│       ├── ReviewScreen.tsx     # Post-capture critique + Save / Retake / View Gallery
│       └── GalleryScreen.tsx    # expo-media-library grid → full screen (permission + empty states)
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
npm run typecheck               # tsc --noEmit --strict (must be 0 errors)
```

Camera permissions are declared in `app.json`:

- iOS: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSMotionUsageDescription` (tilt/stability). Saving asks for add-only photo
  access; the Gallery asks for read access separately, only when opened.
- Android: `CAMERA`, `WRITE_EXTERNAL_STORAGE` (+ the read permissions added by
  the `expo-media-library` plugin). Microphone is off
  (`enableMicrophonePermission: false`) — Prolens never records audio.

## Current state / TODOs

- `CameraView.tsx` runs the real pipeline: `useFrameAnalyzer` throttles to
  every 3rd frame, `PixelAnalyzer` reads luminance/clipping/backlit from the
  RGB frame buffer, and `useDeviceOrientation` streams tilt/shake from
  DeviceMotion at 20 Hz. Shutter captures to `ReviewScreen` (AI critique +
  gallery save via `expo-media-library`); `ColorScience.ts` is the single
  source of ITA° truth.
- Camera chrome: flash (off/on/auto, passed to `takePhoto` when the device has
  a flash), front/back flip, 0.5× / 1× / 2× zoom chips (wired to the camera
  `zoom` prop relative to `neutralZoom`; chips the device can't do are hidden).
  The back camera prefers the multi-lens device so 0.5×/2× switch lenses —
  change `BACK_CAMERA_FILTER` to `['wide-angle-camera']` if a device misbehaves.
- Still TODO: face/landmark detector wiring (thirds / headroom / looking-room /
  step-closer cues only fire once faces arrive), histogram, dominant colors,
  golden-ratio centroids, exposure application (`exposure` → camera device),
  pinch-to-zoom — plus physical-device validation of the rotation-axis mapping
  (spirit-level bubble direction depends on it), RGB layout assumptions, and
  that frame processors still run with the Reanimated babel plugin enabled.
- `zustand` + `react-native-mmkv` (persisting grid / voice / flash settings)
  and `@shopify/react-native-skia` (custom HUD rendering) are installed for the
  next milestones but not yet wired into the UI.

## Privacy

Same promise as the web prototype: frames are analysed on-device, no
analytics, no accounts, no uploads. Microphone permission is never requested,
photo access is requested only when you save or open the Gallery.
