import type { Frame } from 'react-native-vision-camera';
import type { LightingAnalysis } from '../ai/SceneAnalyzer';

/**
 * Fast sub-sampled pixel analysis executed on the frame worklet thread.
 *
 * Requires the Camera to use pixelFormat="rgb" (set in CameraView): YUV
 * buffers have a planar layout this RGB walk cannot parse, so non-RGB or
 * invalid frames fall back to neutral defaults instead of returning garbage.
 *
 * Assumptions (documented, not validated on-device yet):
 * - RGB bytes are tightly packed RGBA/BGRA with no row padding.
 * - Channel order is treated as RGB; on BGRA platforms the R/B swap adds a
 *   small error to the luminance proxy, acceptable for guidance heuristics.
 */
export function analyzeFrameLuminance(frame: Frame): LightingAnalysis {
  'worklet';

  if (!frame.isValid || frame.pixelFormat !== 'rgb') {
    return {
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
    };
  }

  // Default fallbacks if the pixel buffer can't be read
  let avgLuminance = 0.5;
  let clippedHighlights = 0;
  let clippedShadows = 0;
  let isBacklit = false;

  try {
    // Frame metrics
    const width = frame.width;
    const height = frame.height;

    // Sample 1 out of every 16 pixels for 60fps performance
    const step = 16;
    let sampledLuminanceSum = 0;
    let highlightCount = 0;
    let shadowCount = 0;
    let sampleCount = 0;

    // Center region vs edge region luminance for backlit check
    let centerLuminanceSum = 0;
    let centerCount = 0;
    let outerLuminanceSum = 0;
    let outerCount = 0;

    const minX = Math.floor(width * 0.25);
    const maxX = Math.floor(width * 0.75);
    const minY = Math.floor(height * 0.25);
    const maxY = Math.floor(height * 0.75);

    // Read raw frame bytes (GPU -> CPU copy; sub-sampling keeps it cheap)
    const buffer = frame.toArrayBuffer();
    if (buffer) {
      const data = new Uint8Array(buffer);
      for (let i = 0; i + 2 < data.length; i += step * 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;

        // Standard ITU-R BT.601 relative luminance formula
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        sampledLuminanceSum += lum;
        sampleCount++;

        if (lum > 0.95) highlightCount++;
        if (lum < 0.05) shadowCount++;

        // Track center vs perimeter for backlight calculation
        const pixelIdx = i / 4;
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);

        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          centerLuminanceSum += lum;
          centerCount++;
        } else {
          outerLuminanceSum += lum;
          outerCount++;
        }
      }

      if (sampleCount > 0) {
        avgLuminance = sampledLuminanceSum / sampleCount;
        clippedHighlights = highlightCount / sampleCount;
        clippedShadows = shadowCount / sampleCount;

        const centerAvg =
          centerCount > 0 ? centerLuminanceSum / centerCount : avgLuminance;
        const outerAvg =
          outerCount > 0 ? outerLuminanceSum / outerCount : avgLuminance;

        // Backlit condition: background is 30%+ brighter than center subject area
        isBacklit = outerAvg - centerAvg > 0.3;
      }
    }
  } catch {
    // Non-fatal fallback for worklet execution variations — defaults stand
  }

  return {
    averageLuminance: avgLuminance,
    contrast: Math.min(1, Math.abs(clippedHighlights - clippedShadows) * 2 + 0.4),
    colorTemperature: 5500, // Standard daylight default
    isBacklit,
    hasHarshShadows: clippedShadows > 0.15 && clippedHighlights > 0.08,
    isGoldenHour: avgLuminance > 0.3 && avgLuminance < 0.6 && isBacklit,
    isBlueHour: false,
    lightDirection: isBacklit ? 'back' : 'front',
    clippedHighlights,
    clippedShadows,
  };
}
