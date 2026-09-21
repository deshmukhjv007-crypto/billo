import { FaceData, LightingAnalysis } from './SceneAnalyzer';
import { EXPOSURE_RULES } from '../coaching/PhotographyRules';

// NOTE: ITA° math lives in ./ColorScience (rgbToLab/calculateITA) — the single
// source of truth. This optimizer consumes skinToneITA from FaceData; it does
// not compute ITA° itself.

export type ExposureSettings = {
  iso: number;
  shutterSpeed: number; // in seconds (e.g., 1/125 = 0.008)
  exposureCompensation: number; // EV
  whiteBalance: number; // Kelvin
  useHDR: boolean;
  reasoning: string; // For UI transparency
};

export class ExposureOptimizer {
  /**
   * Calculate optimal exposure using skin tone + scene analysis
   * Based on Ansel Adams' Zone System applied to modern sensors
   */
  optimize(
    faces: FaceData[],
    lighting: LightingAnalysis,
    focalLength: number = 26 // iPhone default
  ): ExposureSettings {
    // Case 1: Portrait with detected face
    if (faces.length > 0) {
      return this.optimizeForSkin(faces[0], lighting, focalLength);
    }
    // Case 2: Landscape/scene — Expose to the Right
    return this.optimizeForScene(lighting, focalLength);
  }

  private optimizeForSkin(
    face: FaceData,
    lighting: LightingAnalysis,
    focalLength: number
  ): ExposureSettings {
    const ita = face.skinToneITA;
    const currentLuminance = face.luminance;

    // Determine skin category & target luminance (Zone System)
    const target = this.getSkinTargetLuminance(ita);

    // Calculate EV compensation needed
    // Each stop = doubling/halving luminance
    const ratio = target.luminance / Math.max(currentLuminance, 0.01);
    let evCompensation = Math.log2(ratio);

    // Clamp to reasonable range
    evCompensation = Math.max(-2, Math.min(2, evCompensation));

    // Extra boost for backlit dark skin (common failure mode)
    if (lighting.isBacklit && ita < 10) {
      evCompensation += 0.5;
    }

    // Calculate shutter speed (Reciprocal Rule)
    const minShutter = 1 / (focalLength * 2);
    const shutterSpeed = this.calculateShutter(lighting, minShutter);

    // ISO to fill remaining exposure
    const iso = this.calculateISO(lighting, shutterSpeed, evCompensation);

    // White balance — warm slightly for skin
    const wb = this.getSkinFriendlyWB(ita, lighting.colorTemperature);

    return {
      iso,
      shutterSpeed,
      exposureCompensation: evCompensation,
      whiteBalance: wb,
      useHDR: lighting.contrast > 0.7,
      reasoning: `Exposing skin to Zone ${target.zone} (${this.itaCategory(ita)} skin)`,
    };
  }

  private optimizeForScene(
    lighting: LightingAnalysis,
    focalLength: number
  ): ExposureSettings {
    // "Expose to the Right" — maximize sensor data without clipping
    let evCompensation = 0;
    if (lighting.clippedHighlights < 0.01 && lighting.averageLuminance < 0.5) {
      evCompensation = +0.3;
    }
    if (lighting.clippedHighlights > 0.05) {
      evCompensation = -0.7;
    }

    const minShutter = 1 / (focalLength * 2);
    const shutterSpeed = this.calculateShutter(lighting, minShutter);
    const iso = this.calculateISO(lighting, shutterSpeed, evCompensation);

    return {
      iso,
      shutterSpeed,
      exposureCompensation: evCompensation,
      whiteBalance: lighting.colorTemperature,
      useHDR: lighting.contrast > 0.6,
      reasoning: 'Expose-to-the-right for maximum dynamic range',
    };
  }

  private getSkinTargetLuminance(ita: number) {
    const T = EXPOSURE_RULES.SKIN_ZONE_TARGETS;
    if (ita < -30) return T.veryDark;
    if (ita < 10) return T.dark;
    if (ita < 28) return T.medium;
    if (ita < 41) return T.light;
    return T.veryLight;
  }

  private itaCategory(ita: number): string {
    if (ita < -30) return 'very dark';
    if (ita < 10) return 'dark';
    if (ita < 28) return 'medium';
    if (ita < 41) return 'light';
    return 'very light';
  }

  private getSkinFriendlyWB(ita: number, ambientWB: number): number {
    // Slightly warm skin (add 200-400K)
    // Darker skin benefits from slightly warmer WB
    const warmthBoost = ita < 20 ? 400 : 200;
    return Math.min(ambientWB + warmthBoost, 7500);
  }

  private calculateShutter(lighting: LightingAnalysis, minShutter: number): number {
    if (lighting.averageLuminance > 0.6) return 1 / 500;
    if (lighting.averageLuminance > 0.3) return 1 / 250;
    if (lighting.averageLuminance > 0.15) return 1 / 125;
    return Math.max(minShutter, 1 / 60);
  }

  private calculateISO(
    lighting: LightingAnalysis,
    shutter: number,
    evComp: number
  ): number {
    void shutter;
    const baseISO = 100;
    const targetLuminance = 0.5;
    const currentEV = Math.log2(lighting.averageLuminance / targetLuminance);
    const isoMultiplier = Math.pow(2, -currentEV + evComp);
    return Math.min(Math.max(baseISO * isoMultiplier, 50), 6400);
  }
}
