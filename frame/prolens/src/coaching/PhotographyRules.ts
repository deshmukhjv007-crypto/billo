/**
 * PROLENS PHOTOGRAPHY RULEBOOK
 * Compiled from: Ansel Adams, Henri Cartier-Bresson, Annie Leibovitz,
 * Steve McCurry, Peter Lik, and modern computational photography research.
 */

export const COMPOSITION_RULES = {
  RULE_OF_THIRDS: {
    tolerance: 0.08, // 8% of frame width
    description: 'Place subjects on 1/3 or 2/3 gridlines',
    weight: 0.9,
  },
  GOLDEN_RATIO: {
    points: [0.382, 0.618], // Phi ratio
    description: 'Fibonacci spiral placement for organic feel',
    weight: 0.85,
  },
  LEADING_LINES: {
    minAngle: 15, // degrees from horizontal
    description: 'Lines should guide eye to subject',
    weight: 0.8,
  },
  HORIZON_LEVEL: {
    maxTilt: 1.5, // degrees
    description: 'Horizon must be perfectly level',
    weight: 1.0, // Non-negotiable
  },
  HEADROOM: {
    portraitMin: 0.05, // 5% above head
    portraitMax: 0.15, // 15% max
    description: 'Proper space above subject head',
    weight: 0.75,
  },
  LOOKING_ROOM: {
    minRatio: 0.6, // 60% of frame in direction subject faces
    description: 'Leave space in the direction subject looks',
    weight: 0.7,
  },
  SYMMETRY: {
    threshold: 0.85, // similarity score
    description: 'Perfect symmetry for architectural shots',
    weight: 0.8,
  },
  NEGATIVE_SPACE: {
    minRatio: 0.4,
    description: 'Empty space gives subject room to breathe',
    weight: 0.6,
  },
  FILL_THE_FRAME: {
    minSubjectArea: 0.4,
    description: 'Get closer — fill the frame with your subject',
    weight: 0.7,
  },
  DEPTH_LAYERS: {
    idealLayers: 3, // foreground, midground, background
    description: 'Create depth with 3 distinct layers',
    weight: 0.75,
  },
} as const;

export const LIGHTING_RULES = {
  GOLDEN_HOUR: {
    colorTempRange: [2500, 3500], // Kelvin
    description: '✨ Golden hour — magical warm light',
  },
  BLUE_HOUR: {
    colorTempRange: [8000, 12000],
    description: '💙 Blue hour — cinematic mood',
  },
  HARSH_MIDDAY: {
    condition: 'sun_high + high_contrast',
    warning: 'Harsh shadows — find shade or wait',
  },
  BACKLIT_SUBJECT: {
    condition: 'background_brighter_than_subject',
    fix: 'Expose for face, let background blow out (or use HDR)',
  },
  REMBRANDT_LIGHTING: {
    description: 'Triangle of light on shadow cheek — classic portrait',
    angle: [30, 45], // degrees from subject
  },
  BUTTERFLY_LIGHTING: {
    description: 'Light directly in front & above — glamour shot',
    angle: [0, 15],
  },
  SPLIT_LIGHTING: {
    description: 'Half face lit — dramatic mood',
    angle: [85, 95],
  },
  RIM_LIGHTING: {
    description: 'Light from behind subject — separation from background',
  },
} as const;

export const EXPOSURE_RULES = {
  // Ansel Adams' Zone System
  ZONE_SYSTEM: {
    zone_0: 'Pure black, no detail',
    zone_1: 'Near black, slight tonality',
    zone_2: 'Textured darkness',
    zone_3: 'Dark materials with detail (dark skin shadows)',
    zone_4: 'Average dark foliage, dark stone',
    zone_5: 'Middle gray (18%) — light meter target',
    zone_6: 'Average Caucasian skin, light stone',
    zone_7: 'Very light skin, light gray',
    zone_8: 'Whites with texture',
    zone_9: 'Near white, slight tonality',
    zone_10: 'Pure white, no detail',
  },

  // Skin tone should typically fall in Zones 5-7
  SKIN_ZONE_TARGETS: {
    veryDark: { zone: 4, luminance: 0.36 },
    dark: { zone: 5, luminance: 0.5 },
    medium: { zone: 6, luminance: 0.6 },
    light: { zone: 6.5, luminance: 0.68 },
    veryLight: { zone: 7, luminance: 0.75 },
  },

  EXPOSE_TO_THE_RIGHT: {
    description: 'Push histogram right without clipping — max data',
    threshold: 0.95,
  },

  PROTECT_HIGHLIGHTS: {
    description: 'Never blow out unless intentional',
    maxClipping: 0.02, // 2% blown pixels acceptable
  },
} as const;

export const MOTION_RULES = {
  RECIPROCAL_RULE: {
    // Shutter speed should be at least 1/focal_length for sharp handheld
    calculate: (focalLength: number) => 1 / (focalLength * 2), // 2x for safety
  },
  STABILITY_THRESHOLD: {
    gyroMax: 0.15, // rad/s
    description: 'Hold camera steady — brace elbows',
  },
  PANNING_SPEED: {
    idealMatch: 0.9, // match subject speed for motion blur backgrounds
  },
} as const;

export const COLOR_RULES = {
  COMPLEMENTARY: ['red-cyan', 'green-magenta', 'blue-yellow'],
  ANALOGOUS: 'colors next to each other on wheel',
  TRIADIC: '3 colors evenly spaced',
  COLOR_HARMONY_BOOST: 1.2, // multiplier for score
} as const;

export const DECISIVE_MOMENT = {
  // Cartier-Bresson's principle
  description: 'The moment when all elements align',
  triggers: [
    'peak_action',
    'eye_contact',
    'geometric_alignment',
    'expression_peak',
    'gesture_complete',
  ],
};
