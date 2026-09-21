/**
 * COLOR SCIENCE UTILITIES
 * Converts RGB -> XYZ -> CIELAB -> ITA° (Individual Typology Angle)
 * Dermatological standard for objective skin tone assessment.
 */

export interface LABColor {
  L: number; // Lightness (0-100)
  a: number; // Green (-) to Red (+)
  b: number; // Blue (-) to Yellow (+)
}

export function rgbToLab(r: number, g: number, b: number): LABColor {
  'worklet';

  // Normalize to 0-1
  let nr = r / 255;
  let ng = g / 255;
  let nb = b / 255;

  // sRGB gamma correction
  nr = nr > 0.04045 ? Math.pow((nr + 0.055) / 1.055, 2.4) : nr / 12.92;
  ng = ng > 0.04045 ? Math.pow((ng + 0.055) / 1.055, 2.4) : ng / 12.92;
  nb = nb > 0.04045 ? Math.pow((nb + 0.055) / 1.055, 2.4) : nb / 12.92;

  // Convert to XYZ (D65 illuminant standard)
  const x = (nr * 0.4124564 + ng * 0.3575761 + nb * 0.1804375) / 0.95047;
  const y = (nr * 0.2126729 + ng * 0.7151522 + nb * 0.072175) / 1.0;
  const z = (nr * 0.0193339 + ng * 0.119192 + nb * 0.9503041) / 1.08883;

  // XYZ to LAB transformation function
  const f = (val: number) =>
    val > 0.008856 ? Math.cbrt(val) : 7.787 * val + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Calculates Individual Typology Angle (ITA°)
 * Formula: ITA° = [arctan((L* - 50) / b*)] * (180 / π)
 */
export function calculateITA(L: number, b: number): number {
  'worklet';
  const denominator = Math.max(Math.abs(b), 0.0001); // Avoid div-by-zero
  const rad = Math.atan2(L - 50, denominator);
  return (rad * 180) / Math.PI;
}

/**
 * Classifies skin tone ITA° value into standard Fitzpatrick categories
 */
export function getSkinToneCategory(ita: number): {
  name: string;
  zoneTarget: number;
  description: string;
} {
  if (ita > 55) {
    return {
      name: 'Very Light',
      zoneTarget: 7,
      description: 'Zone VII - Protect highlights from blowing out',
    };
  } else if (ita > 41) {
    return {
      name: 'Light',
      zoneTarget: 6.5,
      description: 'Zone VI.5 - Standard Caucasian skin target',
    };
  } else if (ita > 28) {
    return {
      name: 'Intermediate',
      zoneTarget: 6,
      description: 'Zone VI - Balanced skin tone target',
    };
  } else if (ita > 10) {
    return {
      name: 'Tan',
      zoneTarget: 5.5,
      description: 'Zone V.5 - Preserve warmth and detail',
    };
  } else if (ita > -30) {
    return {
      name: 'Brown',
      zoneTarget: 5,
      description: 'Zone V - Mid-tone grey equivalent',
    };
  } else {
    return {
      name: 'Dark',
      zoneTarget: 4,
      description:
        'Zone IV - Increase exposure +0.7 EV to prevent shadow clipping',
    };
  }
}
