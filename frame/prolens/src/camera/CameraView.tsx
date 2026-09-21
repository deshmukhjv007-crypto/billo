import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import * as Haptics from 'expo-haptics';
import { SuggestionEngine, Suggestion } from '../coaching/SuggestionEngine';
import { VoiceCoach } from '../coaching/VoiceCoach';
import { ExposureOptimizer } from '../ai/ExposureOptimizer';
import { HUDOverlay } from '../hud/HUDOverlay';
import { SuggestionBubble } from '../hud/SuggestionBubble';
import { GridOverlay } from '../hud/GridOverlay';
import { HorizonLevel } from '../hud/HorizonLevel';
import { ControlsBar } from '../hud/ControlsBar';
import { useFrameAnalyzer } from './useFrameAnalyzer';
import { ReviewScreen } from '../screens/ReviewScreen';
import type { FrameAnalysis } from '../ai/SceneAnalyzer';

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

export default function ProlensCamera() {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<Camera>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [readyScore, setReadyScore] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [gridType, setGridType] = useState<'thirds' | 'golden' | 'off'>('thirds');
  const [capturedPhoto, setCapturedPhoto] = useState<{
    path: string;
    analysis: FrameAnalysis;
  } | null>(null);

  const engineRef = useRef(new SuggestionEngine());
  const optimizerRef = useRef(new ExposureOptimizer());
  const voiceCoachRef = useRef(new VoiceCoach(true));
  const latestAnalysisRef = useRef<FrameAnalysis | null>(null);
  const { processFrame } = useFrameAnalyzer();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Stop any in-flight speech when leaving the camera view.
  useEffect(() => {
    const coach = voiceCoachRef.current;
    return () => coach.stop();
  }, []);

  // Bridge from worklet to JS thread. Memoized (closure only touches stable
  // refs and setState) so the frame processor registers once.
  const handleAnalysis = useMemo(
    () =>
      Worklets.createRunOnJS((analysis: FrameAnalysis) => {
        latestAnalysisRef.current = analysis;
        const newSuggestions = engineRef.current.generate(analysis);
        setSuggestions(newSuggestions);
        setReadyScore(analysis.composition.overallScore);
        setTilt(analysis.horizon.tilt);
        voiceCoachRef.current.speakSuggestion(newSuggestions);

        // Haptic when ready to shoot
        if (analysis.composition.overallScore > 0.9) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }

        // Apply optimal exposure
        const exposure = optimizerRef.current.optimize(
          analysis.faces,
          analysis.lighting
        );
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

  const capturePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCapturedPhoto({
        path: photo.path,
        analysis: latestAnalysisRef.current ?? fallbackAnalysis(),
      });
    } catch (e) {
      console.error(e);
    }
  };

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

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Loading camera...</Text>
      </View>
    );
  }

  if (capturedPhoto) {
    return (
      <ReviewScreen
        photoPath={capturedPhoto.path}
        analysis={capturedPhoto.analysis}
        onRetake={() => setCapturedPhoto(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        // Required: PixelAnalyzer walks RGB(A) bytes; YUV is planar.
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
      />

      {/* HUD Overlays */}
      {gridType !== 'off' && <GridOverlay type={gridType} />}
      <HorizonLevel tilt={tilt} />
      <HUDOverlay readyScore={readyScore} />
      <ControlsBar
        voiceEnabled={voiceEnabled}
        onToggleVoice={() => {
          const next = !voiceEnabled;
          setVoiceEnabled(next);
          voiceCoachRef.current.setEnabled(next);
        }}
        gridType={gridType}
        onCycleGrid={() => {
          setGridType((prev) =>
            prev === 'thirds' ? 'golden' : prev === 'golden' ? 'off' : 'thirds'
          );
        }}
      />

      {/* Coaching Suggestions */}
      <View style={styles.suggestionsContainer}>
        {suggestions.map((s) => (
          <SuggestionBubble key={s.id} suggestion={s} />
        ))}
      </View>

      {/* Shutter Button */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.shutter, readyScore > 0.85 && styles.shutterReady]}
          onPress={capturePhoto}
        />
      </View>
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
  suggestionsContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    gap: 8,
  },
  controls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterReady: {
    borderColor: '#00ff88',
    shadowColor: '#00ff88',
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
});
