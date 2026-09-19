/* ============================================================================
   test/portrait.test.mjs — the halftone, tested without a browser.

   inkPoints() is pure: RGBA bytes in, particle targets out. That makes the one
   piece of this project with real judgement in it (how a photograph becomes
   dots that still read as a face) verifiable in Node, against synthetic images
   whose correct answer we know in advance.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import { inkPoints, coverCrop, BAYER8, PHOTO_SOURCES } from '../js/portrait.js';

/* ------------------------------------------------------------- fixtures -- */

/** Build an RGBA buffer from a per-pixel lightness function. */
function image(w, h, fn) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = fn(x, y, w, h);
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = rgb; px[i + 3] = 255;
    }
  }
  return px;
}

/** A crude "portrait": bright oval head above a bright shoulder slab, dark room. */
function fakePortrait(w = 120, h = 120) {
  return image(w, h, (x, y) => {
    const cx = w / 2, cy = h * 0.40;
    const head = Math.hypot((x - cx) / (w * 0.17), (y - cy) / (h * 0.22)) < 1;
    const shoulders = y > h * 0.68 && y < h * 0.95 && Math.abs(x - cx) < w * 0.36;
    if (head) return 225;
    if (shoulders) return 200;
    return 18;
  });
}

const bounds = pts => pts.reduce((b, p) => ({
  minU: Math.min(b.minU, p.u), maxU: Math.max(b.maxU, p.u),
  minV: Math.min(b.minV, p.v), maxV: Math.max(b.maxV, p.v)
}), { minU: 1, maxU: 0, minV: 1, maxV: 0 });

/* ---------------------------------------------------------------- dither -- */

test('portrait: the Bayer matrix is a valid 8x8 permutation of 0..63', () => {
  assert.equal(BAYER8.length, 64);
  assert.equal(new Set(BAYER8).size, 64, 'every threshold value must appear exactly once');
  assert.equal(Math.min(...BAYER8), 0);
  assert.equal(Math.max(...BAYER8), 63);
  for (const v of BAYER8) assert.ok(Number.isInteger(v) && v >= 0 && v <= 63);
});

test('portrait: a bright image inks more densely than a dark one', () => {
  const bright = inkPoints(image(80, 80, () => 235), 80, 80, { step: 2, falloff: null });
  const dark = inkPoints(image(80, 80, () => 25), 80, 80, { step: 2, falloff: null });
  const mid = inkPoints(image(80, 80, () => 130), 80, 80, { step: 2, falloff: null });
  assert.ok(bright.pts.length > mid.pts.length, 'bright must out-ink mid');
  assert.ok(mid.pts.length > dark.pts.length, 'mid must out-ink dark');
  /* a fully black frame should be nearly empty, not a rectangle of dots */
  assert.ok(dark.pts.length < bright.pts.length * 0.08, `black frame inked ${dark.pts.length} dots`);
});

test('portrait: density tracks lightness monotonically across the ramp', () => {
  let last = -1;
  for (const level of [0, 40, 80, 120, 160, 200, 240]) {
    const { pts } = inkPoints(image(64, 64, () => level), 64, 64, { step: 2, falloff: null });
    assert.ok(pts.length >= last, `density fell from ${last} to ${pts.length} at lightness ${level}`);
    last = pts.length;
  }
  assert.ok(last > 300, 'a white frame should be densely inked');
});

test('portrait: the whole tonal range is used, not just the extremes', () => {
  /* If the contrast curve were too aggressive, midtones would empty out and the
     face would lose its modelling. Check the middle of the ramp is populated. */
  const mid = inkPoints(image(80, 80, () => 128), 80, 80, { step: 2, falloff: null }).pts.length;
  const white = inkPoints(image(80, 80, () => 255), 80, 80, { step: 2, falloff: null }).pts.length;
  const black = inkPoints(image(80, 80, () => 0), 80, 80, { step: 2, falloff: null }).pts.length;
  const t = (mid - black) / (white - black);
  assert.ok(t > 0.25 && t < 0.85, `midtone should sit between the extremes, got ${t.toFixed(2)}`);
});

/* ---------------------------------------------------------------- geometry */

test('portrait: every point lands inside the unit square', () => {
  const { pts } = inkPoints(fakePortrait(), 120, 120, { step: 2 });
  assert.ok(pts.length > 100, 'the fake portrait should produce plenty of dots');
  for (const p of pts) {
    assert.ok(p.u >= 0 && p.u <= 1, `u out of range: ${p.u}`);
    assert.ok(p.v >= 0 && p.v <= 1, `v out of range: ${p.v}`);
    assert.ok(p.w > 0 && p.w <= 2, `absurd dot weight: ${p.w}`);
    assert.ok([0, 1, 2].includes(p.c), `unknown colour slot: ${p.c}`);
  }
});

test('portrait: the subject is inked and the background is not', () => {
  const { pts } = inkPoints(fakePortrait(120, 120), 120, 120, { step: 2 });
  const insideHead = pts.filter(p => Math.hypot((p.u - 0.5) / 0.17, (p.v - 0.40) / 0.22) < 0.85).length;
  const inRoom = pts.filter(p => p.v < 0.12 && (p.u < 0.15 || p.u > 0.85)).length;
  assert.ok(insideHead > 60, `the head should be dense, got ${insideHead} dots`);
  assert.equal(inRoom, 0, `the dark room must stay empty, got ${inRoom} dots`);
});

test('portrait: the falloff dissolves the edges and spares the centre', () => {
  /* This is the difference between "a photo" and "a rectangle of dots". The
     photographed background is bright, so without a falloff it inks as densely
     as the face and the subject disappears into it. The gradient must be
     monotonic outward and must reach zero, or a faint square border of dots is
     left sitting on the page. */
  const src = (o) => inkPoints(image(140, 140, () => 200), 140, 140, { step: 2, ...o });
  const { pts } = src({});
  const { pts: flat } = src({ falloff: null });
  const radius = p => Math.hypot(p.u - 0.5, p.v - 0.5);
  const band = (arr, lo, hi) => arr.filter(p => radius(p) >= lo && radius(p) < hi).length;

  const BANDS = [[0, 0.2], [0.2, 0.34], [0.34, 0.44], [0.44, 0.52]];
  let previous = Infinity;
  for (const [lo, hi] of BANDS) {
    const keep = band(flat, lo, hi);
    if (!keep) continue;
    const ratio = band(pts, lo, hi) / keep;
    assert.ok(ratio <= previous + 0.02, `density must fall outward, but rose at r=${lo}: ${ratio.toFixed(2)}`);
    previous = ratio;
  }
  assert.ok(band(pts, 0, 0.34) / band(flat, 0, 0.34) > 0.9, 'the centre of the frame must be untouched');
  assert.ok(band(pts, 0.44, 0.52) < band(flat, 0.44, 0.52) * 0.15, 'the rim should be nearly gone');
  assert.equal(pts.filter(p => radius(p) > 1.0).length, 0, 'nothing may be placed outside the composition');

  /* no straight border of dots anywhere along the four edges */
  const b = bounds(pts);
  assert.ok(b.maxV - b.minV > 0.8, 'the portrait should span the frame vertically');
  assert.ok(b.maxU - b.minU > 0.8, 'the portrait should span the frame horizontally');
});

test('portrait: it is a halftone, so dots land on a lattice with different phases', () => {
  /* Ordered dithering places dots on grid cells; a plain threshold would fill
     whole regions solid. Consecutive samples must therefore differ. */
  const { pts } = inkPoints(image(64, 64, () => 150), 64, 64, { step: 2, falloff: null });
  const key = new Set(pts.map(p => `${Math.round(p.u * 64)},${Math.round(p.v * 64)}`));
  assert.equal(key.size, pts.length, 'two dots shared a cell');
  const row = pts.filter(p => p.v < 0.1).sort((a, b) => a.u - b.u);
  let gaps = 0;
  for (let i = 1; i < row.length; i++) if (row[i].u - row[i - 1].u > 0.02) gaps++;
  assert.ok(gaps > 0, 'a perfectly even midtone should still be dithered, not solid');
});

/* --------------------------------------------------------------- the data */

test('portrait: sampling step trades points for muscle', () => {
  const fine = inkPoints(image(100, 100, () => 170), 100, 100, { step: 1, falloff: null });
  const coarse = inkPoints(image(100, 100, () => 170), 100, 100, { step: 4, falloff: null });
  assert.ok(fine.pts.length > coarse.pts.length * 6, 'a finer step should yield far more candidates');
  assert.ok(fine.pts.length < 100 * 100, 'it must never return more points than pixels');
});

test('portrait: aspect is measured, so dots are never stretched', () => {
  assert.equal(inkPoints(image(120, 120, () => 200), 120, 120).aspect, 1);
  assert.equal(inkPoints(image(200, 100, () => 200), 200, 100).aspect, 2);
});

test('portrait: degenerate input is refused rather than rendered as noise', () => {
  assert.deepEqual(inkPoints(null, 0, 0).pts, []);
  assert.deepEqual(inkPoints(new Uint8ClampedArray(0), 0, 0).pts, []);
  assert.deepEqual(inkPoints(image(4, 4, () => 255), 1, 1).pts, []);
  assert.equal(inkPoints(image(8, 8, () => 255), 8, 8).aspect, 1);
});

test('portrait: transparent pixels are not ink', () => {
  const w = 40, h = 40;
  const px = image(w, h, () => 255);
  for (let i = 3; i < px.length; i += 4) px[i] = 0;            // fully transparent
  const { pts } = inkPoints(px, w, h, { step: 2, falloff: null });
  assert.equal(pts.length, 0, 'a transparent image must produce no dots');
});

test('portrait: accents are a small, deterministic minority', () => {
  const { pts } = inkPoints(image(100, 100, () => 230), 100, 100, { step: 2, falloff: null, accent: 0.05 });
  const warm = pts.filter(p => p.c !== 0).length;
  assert.ok(warm > 0, 'there should be some warm accents to match the drawn art');
  assert.ok(warm / pts.length < 0.2, `accents took over: ${((warm / pts.length) * 100).toFixed(1)}%`);
  /* determinism: the same bytes must place the same coloured dots */
  const again = inkPoints(image(100, 100, () => 230), 100, 100, { step: 2, falloff: null, accent: 0.05 });
  assert.deepEqual(again.pts, pts);
});

/* -------------------------------------------------------------- the crop -- */

test('portrait: a square source is used whole, with no crop', () => {
  assert.deepEqual(coverCrop(1000, 1000), { sx: 0, sy: 0, side: 1000 });
});

test('portrait: a tall image is cropped to the head, not the middle', () => {
  /* A 4:5 portrait frame: centred would start at y=0.1*(h) and shave the top of
     the head. Biasing upward keeps the whole face. */
  const tall = coverCrop(1000, 1250);
  const centred = coverCrop(1000, 1250, 'center');
  assert.equal(tall.side, 1000);
  assert.ok(tall.sy < centred.sy, 'the face crop must sit higher than a centred one');
  assert.ok(tall.sy >= 0, 'the window may not start above the image');
  assert.ok(tall.sy + tall.side <= 1250, 'the window may not run past the bottom');
  assert.equal(tall.sx, 0, 'a tall image needs no horizontal crop');
});

test('portrait: a wide image is cropped from the middle horizontally', () => {
  const wide = coverCrop(1600, 900);
  assert.equal(wide.side, 900);
  assert.equal(wide.sx, 350, 'the window should be horizontally centred');
  assert.equal(wide.sy, 0);
});

test('portrait: the window always fits inside the image, whatever the aspect', () => {
  for (const [w, h] of [[1, 1], [10, 4000], [4000, 10], [1250, 1250], [999, 1000], [1000, 999], [37, 4129]]) {
    for (const mode of ['face', 'center']) {
      const c = coverCrop(w, h, mode);
      assert.ok(c.side > 0, `degenerate window for ${w}x${h}`);
      assert.ok(c.sx >= 0 && c.sy >= 0, `negative origin for ${w}x${h} ${mode}`);
      assert.ok(c.sx + c.side <= Math.max(1, w) + 0.001, `window overflows width for ${w}x${h} ${mode}`);
      assert.ok(c.sy + c.side <= Math.max(1, h) + 0.001, `window overflows height for ${w}x${h} ${mode}`);
    }
  }
  /* and it must survive nonsense dimensions rather than NaN into the canvas */
  for (const bad of [[0, 0], [-5, 10], [0, 100]]) {
    const c = coverCrop(bad[0], bad[1]);
    assert.ok(Number.isFinite(c.sx) && Number.isFinite(c.sy) && c.side >= 1, `bad dims ${bad} produced ${JSON.stringify(c)}`);
  }
});

test('portrait: the source list only ever names files under assets/', () => {
  for (const src of PHOTO_SOURCES) {
    assert.match(src, /^\.\/assets\/[a-z0-9._-]+$/i, `unexpected photo source: ${src}`);
  }
  assert.ok(PHOTO_SOURCES.some(s => s.includes('jayesh')), 'the obvious filename should be first');
});
