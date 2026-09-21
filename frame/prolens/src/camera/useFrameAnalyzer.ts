import { useCallback } from 'react';
import { useSharedValue } from 'react-native-worklets-core';
import type { Frame } from 'react-native-vision-camera';
import { useDeviceOrientation } from '../sensors/useDeviceOrientation';
import { analyzeFrameLuminance } from './PixelAnalyzer';
import type { FrameAnalysis } from '../ai/SceneAnalyzer';

export function useFrameAnalyzer() {
  const { tilt, motion } = useDeviceOrientation();
  const frameCount = useSharedValue(0);

  // Memoized on stable shared values so the frame processor registers once
  // instead of resetting its context on every render.
  const processFrame = useCallback(
    (frame: Frame): FrameAnalysis | null => {
      'worklet';

      // Throttle: analyze every 3rd frame (~20fps at 60fps input)
      frameCount.value += 1;
      if (frameCount.value % 3 !== 0) return null;

      const sensorTilt = tilt.value;
      const sensorMotion = motion.value;
      const lighting = analyzeFrameLuminance(frame);

      // Exposure-balance proxy for thirds alignment until centroid-based
      // subject tracking lands (higher when exposure sits near midtone).
      const ruleOfThirdsScore = Math.max(
        0.5,
        1 - Math.abs(lighting.averageLuminance - 0.5)
      );

      return {
        scene: lighting.averageLuminance < 0.2 ? 'night' : 'portrait',
        confidence: 0.85,
        faces: [], // Populated when the face detector milestone lands
        horizon: {
          detected: true,
          tilt: sensorTilt,
        },
        lighting,
        composition: {
          ruleOfThirds: ruleOfThirdsScore,
          goldenRatio: 0.68,
          horizonLevel: Math.max(0, 1 - Math.abs(sensorTilt) / 10),
          headroom: 0.8,
          lookingRoom: 0.75,
          symmetry: 0.5,
          leadingLines: 0.4,
          fillFrame: 0.65,
          overallScore: Math.min(
            1,
            (1 - Math.abs(sensorTilt) / 15) * 0.5 + ruleOfThirdsScore * 0.5
          ),
        },
        motion: sensorMotion,
        histogram: [],
        dominantColors: [],
        depthLayers: 2,
        timestamp: frame.timestamp,
      };
    },
    [frameCount, motion, tilt]
  );

  return { processFrame };
}
