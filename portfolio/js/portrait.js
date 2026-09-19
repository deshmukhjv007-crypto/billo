/* ============================================================================
   portrait.js — your photograph, as particle ink.

   This is the trick at the centre of hire.rest's hero: the big illustration on
   the right is not a picture, it is a few thousand particles that have settled
   into the shape of a face. Theirs is a hand-drawn illustration sampled into
   dots; this samples the actual photograph, which is better — it is really you.

   Two halves, deliberately split:

     inkPoints(pixels, w, h, opts)   pure. RGBA bytes in, points out. No DOM,
                                     no canvas, no image decoding — so it is
                                     unit-testable, and it is where all the
                                     judgement lives.
     loadPortrait(...)               the browser half: find a file, draw it to
                                     an offscreen canvas, hand the bytes over.

   How the dots are placed
   -----------------------
   Naive thresholding ("dark pixel? dot.") gives a silhouette. The readable
   portrait comes from *ordered dithering*: sample on a grid, compare each
   pixel's lightness against a Bayer matrix cell, and ink the ones that win.
   Bright regions then get proportionally more dots than dark ones, which is
   exactly how a newspaper halftone carries a face — and because the dots are
   placed on a regular lattice instead of scattered, the result reads as printed
   rather than as noise.

   On a near-black page the ink is light, so dot density follows *lightness*.
   Two adjustments make it a portrait rather than a rectangle of dots:

     • a radial falloff, so the picture dissolves into the page instead of
       ending at a hard edge (a bright blurred office behind you would
       otherwise fill the frame with dots and swallow the face)
     • contrast around a pivot, to pull the face out of the midtones

   ── Dropping in a photo ──────────────────────────────────────────────────
   Put it at portfolio/assets/jayesh.jpg and rebuild, or set PERSON.photo in
   resume.js. If nothing is found, loadPortrait() resolves null and the hero
   keeps its drawn artwork — a missing photo is never a broken hero.
   ========================================================================== */

/* 8×8 ordered dither matrix (Bayer). Values 0..63, normalised at use. */
export const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
];

/* Colour slots used by field.js — index into its particle palette. */
const INK = 0, LAVA = 1, LIME = 2;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
};
/** Deterministic 0..1 from two ints — same dot, same colour, every build. */
const hash2 = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Turn raw RGBA pixels into particle targets.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels  RGBA, length w*h*4
 * @param {number} w @param {number} h           source dimensions
 * @param {object} o
 *   step      sample every Nth pixel (2 keeps a 200px source near the particle budget)
 *   pivot     lightness the contrast curve turns around
 *   gain      contrast multiplier
 *   bias      added after contrast; nudges overall dot density
 *   falloff   [inner, outer] radius (in half-widths) where dots fade out; null = off
 *   accent    fraction of dots allowed a warm colour accent
 * @returns {{pts: {u:number,v:number,c:number,w:number}[], aspect:number}}
 */
export function inkPoints(pixels, w, h, o = {}) {
  const {
    step = 2, pivot = 0.44, gain = 1.5, bias = 0.04,
    falloff = [0.66, 1.0], accent = 0.05
  } = o;

  const n = Math.max(1, Math.round(step));
  const pts = [];
  if (!pixels || w < 2 || h < 2) return { pts, aspect: 1 };

  /* The aspect the particles should settle into. A square source gives a
     square composition; anything else is measured so the dots are never
     stretched. */
  const aspect = w / h;

  /* The dither matrix is indexed by SAMPLE position, not source pixel
     coordinate. Indexing it by (x % 8, y % 8) while stepping by 2 only ever
     reaches 16 of the 64 thresholds — the reachable range collapses to 0..0.24
     and every midtone saturates to solid. Counting samples keeps the full
     0..0.99 range whatever the step. */
  for (let y = 0, sy = 0; y < h; y += n, sy++) {
    for (let x = 0, sx = 0; x < w; x += n, sx++) {
      const i = (y * w + x) * 4;
      if (i + 2 >= pixels.length) continue;
      const a = pixels.length > i + 3 ? pixels[i + 3] / 255 : 1;
      if (a <= 0.02) continue;                       // transparent: no subject here

      /* Rec. 709 luma, on the alpha-composited value. */
      const lum = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255 * a;

      /* Contrast around the pivot, then a small bias for overall density. */
      let l = clamp01((lum - pivot) * gain + pivot + bias);

      /* Dissolve toward the edges — multiplying by a smoothstep that reaches
         zero, so the outermost ring is genuinely empty rather than merely dim.
         A floor term here leaves a faint rectangular border of dots, which is
         exactly the tell that gives away a sampled photo on a dark page.
         Weighted slightly more on the vertical, so it reads as a portrait
         vignette rather than a perfect circle. */
      if (falloff) {
        const u = x / w, v = y / h;
        const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2 * 1.12;
        const r = Math.hypot(dx, dy);
        l *= smoothstep(falloff[1], falloff[0], r);
      }

      /* Ordered dither: ink this cell if it beats its Bayer threshold. */
      const threshold = (BAYER8[(sy % 8) * 8 + (sx % 8)] + 0.5) / 64;
      if (l <= threshold) continue;

      /* Slightly bigger dots in the highlights: the face gains weight where it
         matters and the shadows stay fine-grained. */
      const weight = 0.62 + l * 0.9;

      /* A few warm accents, deterministically scattered — the same
         two-colour screen-print language the drawn art uses. */
      const r0 = hash2(x, y);
      const c = r0 > 1 - accent * 0.22 ? LIME : r0 > 1 - accent ? LAVA : INK;

      pts.push({ u: (x + 0.5) / w, v: (y + 0.5) / h, c, w: weight });
    }
  }
  return { pts, aspect };
}

/* ------------------------------------------------------------ the loader -- */

import { photoSources } from './photo-names.js';

/** Filenames tried, in order, when nothing explicit is configured. Built from
    the shared list so the browser and the build can never disagree. */
export const PHOTO_SOURCES = photoSources();

/**
 * Which square window of the source to sample. Pure, because getting this wrong
 * is the difference between a portrait and a picture of somebody's chin: a
 * centred crop of a head-and-shoulders shot cuts the top of the head off, so
 * `face` biases the window upward instead.
 *
 * @returns {{sx:number, sy:number, side:number}}
 */
export function coverCrop(iw, ih, mode = 'face') {
  const w = Math.max(1, Math.round(iw) || 1);
  const h = Math.max(1, Math.round(ih) || 1);
  const side = Math.min(w, h);
  if (mode === 'center') return { sx: (w - side) / 2, sy: (h - side) / 2, side };
  /* 18% of the slack goes above the subject: enough to keep a full head in a
     tall frame, not so much that a wide one loses the shoulders. */
  return { sx: (w - side) / 2, sy: Math.max(0, Math.min(h - side, (h - side) * 0.18)), side };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image !== 'function') { reject(new Error('no Image constructor')); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty image')));
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * Find, decode and sample a photograph. Resolves null if there isn't one —
 * callers must treat that as "keep the drawn art", not as an error.
 *
 * @returns {Promise<null|{pts:Array, aspect:number, src:string, size:number}>}
 */
export async function loadPortrait({ sources = PHOTO_SOURCES, size = 208, step = 2, cover = 'face', ...opts } = {}) {
  if (typeof document === 'undefined') return null;

  for (const src of sources) {
    let img;
    try { img = await loadImage(src); } catch { continue; }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const g = canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      if (!g || !g.getImageData) return null;

      /* Cover-crop into the square — see coverCrop() for why it isn't centred. */
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const { sx, sy, side } = coverCrop(iw, ih, cover);
      g.drawImage(img, sx, sy, side, side, 0, 0, size, size);

      const data = g.getImageData(0, 0, size, size).data;
      const { pts, aspect } = inkPoints(data, size, size, { step, ...opts });
      if (!pts.length) continue;
      return { pts, aspect, src, size };
    } catch {
      /* a canvas we cannot read (tainted, no 2d) — try the next candidate */
    }
  }
  return null;
}
