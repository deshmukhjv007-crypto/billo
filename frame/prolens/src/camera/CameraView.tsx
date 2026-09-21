import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import type { CameraPosition, PhysicalCameraDeviceType } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SuggestionEngine, Suggestion } from '../coaching/SuggestionEngine';
import { VoiceCoach } from '../coaching/VoiceCoach';
import { ExposureOptimizer } from '../ai/ExposureOptimizer';
import { SuggestionBubble } from '../hud/SuggestionBubble';
import { GridOverlay } from '../hud/GridOverlay';
import { HorizonLevel } from '../hud/HorizonLevel';
import { DirectionOverlay } from '../hud/DirectionOverlay';
import { TopBar, FLASH_CYCLE, FlashMode } from '../hud/TopBar';
import { BottomBar } from '../hud/BottomBar';
import { SettingsSheet } from '../hud/SettingsSheet';
import type { GridType } from '../hud/ControlsBar';
import { useFrameAnalyzer } from './useFrameAnalyzer';
import { ReviewScreen } from '../screens/ReviewScreen';
import { GalleryScreen } from '../screens/GalleryScreen';
import type { FrameAnalysis, SceneType } from '../ai/SceneAnalyzer';

/** Composition score above which the shutter ring turns green. */
const READY_THRESHOLD = 0.85;

/** Prefer the multi-cam so 0.5× / 2× switch lenses instead of cropping. */
const BACK_CAMERA_FILTER: { physicalDevices: PhysicalCameraDeviceType[] } = {
  physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
};

type Screen = 'camera' | 'review' | 'gallery';

/**
 * Neutral stand-in for the review screen if the shutter beats the first
 * frame analysis (only possible within ~100ms of camera start).
 */
function fallbackAnalysis(): FrameAnalysis {
  return {
    scene: 'portrait',
    confidence: 0,
    faces: [],
    horizon: { detected: false, tilt: 0 },
    lighting: {
      averageLuminance: 0.5,
      contrast: 0.5,
      colorTemperature: 5500,
      isBacklit: false,
      hasHarshShadows: false,
      isGoldenHour: false,
      isBlueHour: false,
      lightDirection: 'front',
      clippedHighlights: 0,
      clippedShadows: 0,
    },
    composition: {
      ruleOfThirds: 0.5,
      goldenRatio: 0.5,
      horizonLevel: 0.5,
      headroom: 0.5,
      lookingRoom: 0.5,
      symmetry: 0.5,
      leadingLines: 0.5,
      fillFrame: 0.5,
      overallScore: 0.5,
    },
    motion: 0,
    histogram: [],
    dominantColors: [],
    depthLayers: 2,
    timestamp: Date.now(),
  };
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Cheap identity for a suggestion list so we only re-render on real changes. */
function signature(list: Suggestion[]): string {
  return list.map((s) => `${s.id}|${s.priority}|${s.label}`).join(',');
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export default function ProlensCamera() {
  const insets = useSafeAreaInsets();
  const appActive = useAppActive();
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  // ── Navigation ────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('camera');
  const [galleryFrom, setGalleryFrom] = useState<Exclude<Screen, 'gallery'>>('camera');
  const [capturedPhoto, setCapturedPhoto] = useState<{
    path: string;
    analysis: FrameAnalysis;
  } | null>(null);
  const [lastPhotoUri, setLastPhotoUri] = useState<string | undefined>(undefined);

  // ── Camera hardware state ─────────────────────────────────
  const [position, setPosition] = useState<CameraPosition>('back');
  const device = useCameraDevice(position, position === 'back' ? BACK_CAMERA_FILTER : undefined);
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const flipAvailable = frontDevice != null && backDevice != null;
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const flashAvailable = device?.hasFlash ?? false;
  const [zoomFactor, setZoomFactor] = useState(1);
  const [capturing, setCapturing] = useState(false);

  // User-facing chips → real zoom values (relative to the device's 1× point).
  const zoomOptions = useMemo(() => {
    if (!device) return [1];
    const opts: number[] = [];
    if (device.minZoom <= device.neutralZoom * 0.5 + 1e-3) opts.push(0.5);
    opts.push(1);
    if (device.maxZoom >= device.neutralZoom * 2 - 1e-3) opts.push(2);
    return opts;
  }, [device]);
  const zoom = useMemo(() => {
    if (!device) return undefined;
    const target = device.neutralZoom * zoomFactor;
    return Math.min(device.maxZoom, Math.max(device.minZoom, target));
  }, [device, zoomFactor]);

  // ── HUD state ─────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ready, setReady] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [scene, setScene] = useState<SceneType | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // voice is opt-in
  const [gridType, setGridType] = useState<GridType>('thirds');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const engineRef = useRef(new SuggestionEngine());
  const optimizerRef = useRef(new ExposureOptimizer());
  const voiceCoachRef = useRef(new VoiceCoach(false)); // silent on cold launch
  const latestAnalysisRef = useRef<FrameAnalysis | null>(null);
  const suggestionSigRef = useRef('');
  const prevTopIdRef = useRef<string | undefined>(undefined);
  const capturingRef = useRef(false);
  const { processFrame } = useFrameAnalyzer();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Stop any in-flight speech when leaving the camera view.
  useEffect(() => {
    const coach = voiceCoachRef.current;
    return () => coach.stop();
  }, []);

  // Seed the gallery thumbnail from the library — but only if photo access
  // was already granted; never prompt on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync(false, ['photo']);
        if (!perm.granted || cancelled) return;
        const page = await MediaLibrary.getAssetsAsync({
          first: 1,
          mediaType: MediaLibrary.MediaType.photo,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        const uri = page.assets[0]?.uri;
        if (uri && !cancelled) setLastPhotoUri((prev) => prev ?? uri);
      } catch {
        // Thumbnail is a nicety; ignore failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Bridge from worklet to JS thread. Memoized (closure only touches stable
  // refs and setState) so the frame processor registers once.
  const handleAnalysis = useMemo(
    () =>
      Worklets.createRunOnJS((analysis: FrameAnalysis) => {
        latestAnalysisRef.current = analysis;

        const next = engineRef.current.generate(analysis);
        const sig = signature(next);
        if (sig !== suggestionSigRef.current) {
          suggestionSigRef.current = sig;
          setSuggestions(next);
        }
        setTilt(analysis.horizon.tilt);
        setReady(analysis.composition.overallScore > READY_THRESHOLD);
        setScene(analysis.scene);

        // Voice is a no-op unless the user switched it on.
        voiceCoachRef.current.speakSuggestion(next);

        // Success haptic once when the decisive moment lights up (edge, not
        // every frame).
        const topId = next[0]?.id;
        if (topId === 'shoot-now' && prevTopIdRef.current !== 'shoot-now') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        prevTopIdRef.current = topId;

        // Apply optimal exposure
        const exposure = optimizerRef.current.optimize(analysis.faces, analysis.lighting);
        // TODO: apply to camera via cameraRef
        void exposure;
      }),
    []
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Real pipeline: pixel luminance + live device-motion sensors.
      // processFrame throttles internally (every 3rd frame, ~20fps).
      const analysis = processFrame(frame);
      if (analysis === null) return;
      handleAnalysis(analysis);
    },
    [processFrame, handleAnalysis]
  );

  // ── Actions ───────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      const photo = await cam.takePhoto({
        flash: flashAvailable ? flashMode : 'off',
        enableShutterSound: true,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      voiceCoachRef.current.stop();
      setLastPhotoUri(toFileUri(photo.path));
      setCapturedPhoto({
        path: photo.path,
        analysis: latestAnalysisRef.current ?? fallbackAnalysis(),
      });
      setScreen('review');
    } catch (e) {
      console.error(e);
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [flashAvailable, flashMode]);

  const resetHud = useCallback(() => {
    engineRef.current.reset();
    suggestionSigRef.current = '';
    prevTopIdRef.current = undefined;
    setSuggestions([]);
  }, []);

  const flipCamera = useCallback(() => {
    setPosition((p) => (p === 'back' ? 'front' : 'back'));
    setZoomFactor(1);
    resetHud();
  }, [resetHud]);

  const cycleFlash = useCallback(() => setFlashMode((m) => FLASH_CYCLE[m]), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const toggleVoice = useCallback(() => {
    const next = !voiceCoachRef.current.getIsEnabled();
    voiceCoachRef.current.setEnabled(next);
    setVoiceEnabled(next);
  }, []);

  const openGallery = useCallback(() => {
    setGalleryFrom(screen === 'review' ? 'review' : 'camera');
    setScreen('gallery');
  }, [screen]);

  const closeGallery = useCallback(() => setScreen(galleryFrom), [galleryFrom]);

  const retake = useCallback(() => {
    setCapturedPhoto(null);
    resetHud();
    setScreen('camera');
  }, [resetHud]);

  // Android hardware back: gallery → where it came from, review → camera.
  useEffect(() => {
    if (screen === 'camera') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'gallery') closeGallery();
      else retake();
      return true;
    });
    return () => sub.remove();
  }, [closeGallery, retake, screen]);

  // ── Screens ───────────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'gallery') {
    return <GalleryScreen onClose={closeGallery} />;
  }

  if (screen === 'review' && capturedPhoto) {
    return (
      <ReviewScreen
        photoPath={capturedPhoto.path}
        analysis={capturedPhoto.analysis}
        onRetake={retake}
        onOpenGallery={openGallery}
      />
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Loading camera...</Text>
      </View>
    );
  }

  const top = suggestions[0];

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={appActive && screen === 'camera'}
        photo={true}
        zoom={zoom}
        // Required: PixelAnalyzer walks RGB(A) bytes; YUV is planar.
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
      />

      {/* Viewfinder layers (non-interactive) */}
      {gridType !== 'off' && <GridOverlay type={gridType} />}
      <HorizonLevel tilt={tilt} />
      <DirectionOverlay
        cue={top?.visualCue}
        priority={top?.priority}
        target={top?.action?.target}
      />
      <SuggestionBubble suggestions={suggestions} />

      {/* Native-style chrome (a faint band keeps the top icons legible over bright skies) */}
      <View style={[styles.topScrim, { height: insets.top + 52 }]} pointerEvents="none" />
      <TopBar
        flashMode={flashMode}
        flashAvailable={flashAvailable}
        onCycleFlash={cycleFlash}
        sceneLabel={scene ?? undefined}
        onOpenSettings={openSettings}
      />
      <BottomBar
        lastPhotoUri={lastPhotoUri}
        onOpenGallery={openGallery}
        onFlipCamera={flipCamera}
        flipAvailable={flipAvailable}
        onShutter={capturePhoto}
        ready={ready}
        capturing={capturing}
        zoomOptions={zoomOptions}
        zoom={zoomFactor}
        onSelectZoom={setZoomFactor}
      />

      {/* Settings tray: grid + voice live here, off the viewfinder */}
      <SettingsSheet
        visible={settingsOpen}
        onClose={closeSettings}
        voiceEnabled={voiceEnabled}
        onToggleVoice={toggleVoice}
        gridType={gridType}
        onSelectGrid={setGridType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  text: { color: 'white', fontSize: 16, marginBottom: 20 },
  button: { backgroundColor: '#fff', padding: 15, borderRadius: 30 },
  buttonText: { color: 'black', fontWeight: '600' },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
});
