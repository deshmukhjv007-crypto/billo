/** Lightweight local image analysis. This measures light, not semantic scene understanding. */
export function analyzePixels(data) {
  let sum = 0,
    square = 0,
    dark = 0,
    bright = 0;
  const count = data.length / 4;
  if (!count)
    return { luminance: 0, contrast: 0, shadows: 0, highlights: 0, score: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const light =
      (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    sum += light;
    square += light * light;
    if (light < 0.08) dark++;
    if (light > 0.95) bright++;
  }
  const luminance = sum / count;
  return {
    luminance,
    contrast: Math.sqrt(Math.max(0, square / count - luminance ** 2)),
    shadows: dark / count,
    highlights: bright / count,
    score: Math.round(
      Math.max(
        0,
        Math.min(
          100,
          // Penalise clipping/extremes, not a complexion-dependent midtone target.
          100 -
            Math.max(0, 0.12 - luminance) * 100 -
            Math.max(0, luminance - 0.92) * 100 -
            ((bright + dark) / count) * 65,
        ),
      ),
    ),
  };
}
/** Conservative global-light hint, not skin-tone metering. Avoid chasing a fixed average. */
export function suggestedExposure(stats) {
  if (stats.highlights > 0.08) return -0.3;
  if (stats.luminance < 0.18 && stats.highlights < 0.01) return 0.3;
  return 0;
}
export function cropRect(width, height, ratio) {
  const w = Math.min(width, height * ratio),
    h = w / ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
