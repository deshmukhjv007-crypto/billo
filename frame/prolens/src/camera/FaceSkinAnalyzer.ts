import { calculateITA, rgbToLab } from '../ai/ColorScience';

/**
 * Face bounding box in FRAME PIXELS (not normalized 0-1 coordinates).
 * Callers must scale SceneAnalyzer FaceData.bounds by frame width/height.
 */
export interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Worklet function to sample facial skin pixels (cheek / forehead region)
 * and calculate average skin luminance + ITA° value.
 */
export function sampleFaceSkinTone(
  buffer: ArrayBuffer | null,
  frameWidth: number,
  frameHeight: number,
  faceBounds: FaceBounds
): { skinITA: number; skinLuminance: number } {
  'worklet';

  // Fallbacks for default/average values (Medium skin target)
  const defaultResult = { skinITA: 30, skinLuminance: 0.5 };

  if (!buffer || frameWidth <= 0 || frameHeight <= 0) {
    return defaultResult;
  }

  try {
    const data = new Uint8Array(buffer);

    // Target the center-upper portion of the face bounding box (cheek/forehead region)
    // to avoid lips, eyes, or hair shadows
    const sampleMinX = Math.floor(faceBounds.x + faceBounds.width * 0.3);
    const sampleMaxX = Math.floor(faceBounds.x + faceBounds.width * 0.7);
    const sampleMinY = Math.floor(faceBounds.y + faceBounds.height * 0.2);
    const sampleMaxY = Math.floor(faceBounds.y + faceBounds.height * 0.5);

    let lSum = 0;
    let bSum = 0;
    let lumSum = 0;
    let count = 0;

    // Sub-sample every 4th pixel inside facial region for speed
    const step = 4;

    for (let y = sampleMinY; y < sampleMaxY; y += step) {
      if (y < 0 || y >= frameHeight) continue;

      for (let x = sampleMinX; x < sampleMaxX; x += step) {
        if (x < 0 || x >= frameWidth) continue;

        const pixelIdx = (y * frameWidth + x) * 4;
        if (pixelIdx + 2 >= data.length) continue;

        const r = data[pixelIdx] ?? 0;
        const g = data[pixelIdx + 1] ?? 0;
        const b = data[pixelIdx + 2] ?? 0;

        // Standard BT.601 relative luminance
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        lumSum += lum;

        // Convert RGB -> CIELAB
        const lab = rgbToLab(r, g, b);
        lSum += lab.L;
        bSum += lab.b;
        count++;
      }
    }

    if (count > 0) {
      const avgL = lSum / count;
      const avgB = bSum / count;
      const avgLum = lumSum / count;

      const ita = calculateITA(avgL, avgB);

      return {
        skinITA: parseFloat(ita.toFixed(1)),
        skinLuminance: parseFloat(avgLum.toFixed(2)),
      };
    }
  } catch {
    // Worklet execution guard — defaults stand
  }

  return defaultResult;
}
