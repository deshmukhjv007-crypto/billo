export type SceneType =
  | 'portrait'
  | 'group-portrait'
  | 'landscape'
  | 'cityscape'
  | 'food'
  | 'macro'
  | 'night'
  | 'sunset'
  | 'action'
  | 'street'
  | 'architecture'
  | 'nature'
  | 'product'
  | 'pet';

export type FrameAnalysis = {
  scene: SceneType;
  confidence: number;
  faces: FaceData[];
  horizon: { detected: boolean; tilt: number };
  lighting: LightingAnalysis;
  composition: CompositionScore;
  motion: number; // 0-1 (0 = still, 1 = shaky)
  histogram: number[]; // 256 bins
  dominantColors: string[];
  depthLayers: number;
  timestamp: number;
};

export type FaceData = {
  bounds: { x: number; y: number; width: number; height: number };
  landmarks: { leftEye: Point; rightEye: Point; nose: Point; mouth: Point };
  skinToneITA: number; // Individual Typology Angle
  luminance: number; // 0-1
  isLookingAtCamera: boolean;
  eyeDirection: 'left' | 'right' | 'center';
  expression: 'neutral' | 'smile' | 'serious';
  sharpness: number; // 0-1
};

export type LightingAnalysis = {
  averageLuminance: number;
  contrast: number;
  colorTemperature: number; // Kelvin
  isBacklit: boolean;
  hasHarshShadows: boolean;
  isGoldenHour: boolean;
  isBlueHour: boolean;
  lightDirection: 'front' | 'back' | 'left' | 'right' | 'top' | 'diffuse';
  clippedHighlights: number; // % of blown pixels
  clippedShadows: number;
};

export type CompositionScore = {
  ruleOfThirds: number; // 0-1
  goldenRatio: number;
  horizonLevel: number;
  headroom: number;
  lookingRoom: number;
  symmetry: number;
  leadingLines: number;
  fillFrame: number;
  overallScore: number; // Weighted composite
};

type Point = { x: number; y: number };
