/* ============================================================================
   field.js — one fixed canvas, a few thousand particles, and every drawing on
   the page is a shape they fly into.

   hire.rest v4 does this too, and it's the best idea on that site. This keeps
   the idea and fixes what it costs:

   theirs                                  here
   --------------------------------------  --------------------------------------
   7 webp illustrations downloaded, then    art is a list of SVG path strings —
   rasterised to 180px and sampled           sampled at any resolution, 0 bytes
                                             over the wire, crisp on a 5K display
   Array of 4,000 objects, GC-churny        Float32Array / Uint8Array SoA layout
   fillStyle swapped per particle           3 batched paths, one fill() per colour
   fixed particle count                     adaptive: measures frame time and
                                             drops draw density before it drops
                                             frames
   morph = everything moves at once         morph = per-particle stagger, so the
                                             drawing "inks itself on" in scanline
                                             order
   GSAP ScrollTrigger + Lenis (2 CDNs)      IntersectionObserver + one shared rAF
   runs whenever the tab is visible         pauses on hidden, on reduced-motion,
                                             and when no stage is on screen
   ========================================================================== */

import { ART, TEXT_ART } from '../content.js';
import { bus, state } from './bus.js';

const COLORS = ['#f4f1ea', '#ef5024', '#ffd166'];   // ink · lava · lime
const INK = 0, LAVA = 1, LIME = 2;

/* ---------------------------------------------------------------- shapes --- */

const shapeCache = new Map();

function sampleCanvas(c, W, H) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const out = [];
  if (!g || !g.getImageData) return out;
  const d = g.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (a < 90) continue;
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      // deterministic colour mix: mostly ink, lava on the upper right,
      // lime as the rare accent — reads like a two-colour screen print.
      const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      let col = INK, w = 1;
      if (r > 0.93) { col = LIME; w = 1.5; }
      else if (r > 0.74 || (u > 0.62 && v < 0.4 && r > 0.5)) { col = LAVA; w = 1.25; }
      if (a > 220) w *= 1.15;
      out.push({ u, v, c: col, w });
    }
  }
  return out;
}

function rasterise(draw, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);   // opaque bg → alpha comes from strokes
  g.clearRect(0, 0, W, H);
  draw(g, W, H);
  return c;
}

function fromPaths(paths, S = 260, lw = 7) {
  const c = rasterise((g, W, H) => {
    const k = W / 200;                            // ART is authored in a 0 0 200 200 box
    g.save(); g.scale(k, k);
    g.strokeStyle = '#fff'; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const d of paths) { try { g.stroke(new Path2D(d)); } catch (_) { /* skip bad path */ } }
    g.restore();
  }, S, S);
  return finish(sampleCanvas(c, S, S), 1);
}

function fromText(spec, S = 260) {
  const [W, H] = spec.box || [360, 170];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return finish([], W / H);
  g.fillStyle = '#fff';
  g.font = spec.font;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(spec.text, W / 2, H / 2);
  return finish(sampleCanvas(c, W, H), W / H);
}

/** Shuffle, cap to COUNT, then sort into rough scanline order so morphs sweep. */
function finish(pts, aspect) {
  if (!pts.length) pts = [{ u: 0.5, v: 0.5, c: 0, w: 1 }];
  for (let i = pts.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const cut = pts.slice(0, Math.max(COUNT, 1200));
  cut.sort((a, b) => (a.v * 6 + a.u) - (b.v * 6 + b.u));
  return { pts: cut, aspect };
}

let COUNT = state.fine ? 4200 : 2400;

function buildShape(name) {
  if (shapeCache.has(name)) return shapeCache.get(name);
  let s = null;
  if (name === 'cloud' || name == null) s = null;
  else if (TEXT_ART[name]) s = fromText(TEXT_ART[name]);
  else if (ART[name]) s = fromPaths(ART[name].paths);
  shapeCache.set(name, s);
  return s;
}

/* --------------------------------------------------------------- engine --- */

const P = {
  x: null, y: null, vx: null, vy: null,
  u: null, v: null, pu: null, pv: null,      // current + previous normalised targets
  col: null, w: null,
  sx: null, sy: null,                        // scatter direction
  ph: null, k: null, s: null, st: null,      // phase, spring, size, stagger
  cx: null, cy: null                         // cloud anchor
};

function alloc() {
  P.x = new Float32Array(COUNT); P.y = new Float32Array(COUNT);
  P.vx = new Float32Array(COUNT); P.vy = new Float32Array(COUNT);
  P.u = new Float32Array(COUNT); P.v = new Float32Array(COUNT);
  P.pu = new Float32Array(COUNT); P.pv = new Float32Array(COUNT);
  P.col = new Uint8Array(COUNT); P.w = new Float32Array(COUNT);
  P.sx = new Float32Array(COUNT); P.sy = new Float32Array(COUNT);
  P.ph = new Float32Array(COUNT); P.k = new Float32Array(COUNT);
  P.s = new Float32Array(COUNT); P.st = new Float32Array(COUNT);
  P.cx = new Float32Array(COUNT); P.cy = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.2;
    P.x[i] = Math.random() * (VW || 800); P.y[i] = Math.random() * (VH || 600);
    P.u[i] = P.pu[i] = Math.random(); P.v[i] = P.pv[i] = Math.random();
    P.col[i] = INK; P.w[i] = 1;
    P.sx[i] = Math.cos(a) * r; P.sy[i] = Math.sin(a) * r;
    P.ph[i] = Math.random() * 6.283;
    P.k[i] = 0.045 + Math.random() * 0.035;
    P.s[i] = 0.85 + Math.random() * 0.8;
    P.cx[i] = Math.random(); P.cy[i] = Math.random();
  }
}

function applyShape(shape) {
  if (!P.x) return;                         // engine never allocated
  const pts = shape.pts;
  const n = pts.length;
  for (let i = 0; i < COUNT; i++) {
    const q = pts[i % n];
    P.pu[i] = P.u[i]; P.pv[i] = P.v[i];       // remember where we were
    P.u[i] = q.u; P.v[i] = q.v; P.col[i] = q.c; P.w[i] = q.w;
    P.st[i] = i / COUNT;                      // scanline stagger
  }
  morph = 0;                                  // restart the ink-on sweep
}

let canvas, ctx, VW = 0, VH = 0, dpr = 1;
const fontReady = new Set();

function waitForFont(shorthand) {
  if (!document.fonts) return Promise.resolve();
  return document.fonts.load(shorthand)
    .then(() => document.fonts.ready)
    .catch(() => document.fonts ? document.fonts.ready : undefined);
}
let shape = null, stage = null, morph = 1, running = false, raf = 0;
let stillFor = 0, calm = 1;
let shake = 0, stride = 1, frameEMA = 16, t0 = 0, lastStats = 0;

export const field = {
  init(el) {
    canvas = el;
    if (!canvas || !canvas.getContext || state.reduce) return null;
    ctx = canvas.getContext ? canvas.getContext('2d', { alpha: true }) : null;
    if (!ctx) { canvas.style.display = 'none'; return null; }
    dpr = Math.min(2, window.devicePixelRatio || 1);
    size();
    alloc();
    addEventListener('resize', () => { size(); }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    bus.on('burst', n => { burstAmount = Math.max(burstAmount, n || 26); });
    t0 = performance.now();
    return this;
  },

  /** Point the particles at a shape, fitted inside `stageEl`. */
  setShape(name, stageEl) {
    stage = stageEl || null;
    if (!ctx) return;                       // no 2D context → nothing to draw into
    if (!name || name === 'cloud') { shape = null; return; }

    /* text shapes get built twice: instantly with a fallback face, then again
       once the webfont lands, so "hello" is never rendered in the wrong hand */
    if (TEXT_ART[name] && !fontReady.has(name)) {
      const s0 = buildShape(name);
      if (s0) { shape = s0; applyShape(s0); }
      fontReady.add(name);
      waitForFont(TEXT_ART[name].font).then(() => {
        shapeCache.delete(name);
        const s1 = buildShape(name);
        if (s1) { shape = s1; applyShape(s1); }
      });
      return;
    }
    const s = buildShape(name);
    if (s) { shape = s; applyShape(s); }
  },

  /** Build the remaining shapes during idle time so morphs never stutter. */
  prewarm(names = []) {
    let i = 0;
    const step = () => {
      if (i >= names.length) return;
      const n = names[i++];
      const work = () => { if (!TEXT_ART[n]) buildShape(n); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(work); else work();
      setTimeout(step, 140);
    };
    setTimeout(step, 700);
  },

  start, stop,
  get stats() { return { count: COUNT, drawn: Math.ceil(COUNT / stride), fps: Math.round(1000 / Math.max(1, frameEMA)), stride }; }
};

let burstAmount = 0;

function size() {
  VW = innerWidth; VH = innerHeight;
  canvas.width = Math.round(VW * dpr);
  canvas.height = Math.round(VH * dpr);
}

function start() { if (!running && ctx) { running = true; raf = requestAnimationFrame(frame); } }
function stop() { running = false; cancelAnimationFrame(raf); }

const easeOut = t => 1 - Math.pow(1 - t, 3);

function frame(now) {
  if (!running) return;
  const dt = Math.min(48, now - (frame._last || now));
  frame._last = now;
  frameEMA += (dt - frameEMA) * 0.08;

  /* adaptive quality: drop draw density before dropping frames */
  if (now - (frame._q || 0) > 900) {
    if (frameEMA > 21 && stride < 3) { stride++; frame._q = now; }
    else if (frameEMA < 14 && stride > 1) { stride--; frame._q = now; }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, VW, VH);

  const t = (now - t0) / 1000;

  /* scroll speed shakes the drawing loose; it settles back when still */
  const target = Math.min(1, state.speed * 1.4);
  shake += (target - shake) * (target > shake ? 0.22 : 0.05);
  const dis = shake * shake;

  /* Everything the field does at rest is now gated on this: full motion while
     the page is moving, and a genuine standstill after a moment of stillness,
     so a reader gets a still surface. */
  stillFor = state.speed < 0.004 ? stillFor + dt : 0;
  const calmTarget = stillFor > 1400 ? 0 : 1;
  calm += (calmTarget - calm) * (calmTarget > calm ? 0.06 : 0.02);

  /* where the drawing lives right now */
  let ox = 0, oy = 0, w = 0, h = 0, drawing = false;
  if (shape && stage) {
    const r = stage.getBoundingClientRect();
    if (r.bottom > -VH * 0.4 && r.top < VH * 1.4) {
      const pad = 0.9;
      w = Math.min(r.width * pad, r.height * pad * shape.aspect);
      h = w / shape.aspect;
      ox = r.left + (r.width - w) / 2;
      oy = r.top + (r.height - h) / 2;
      drawing = true;
    }
  }

  if (morph < 1) morph = Math.min(1, morph + dt / 900);
  const m = easeOut(morph);

  const spread = Math.max(VW, VH) * 0.26;
  const px = state.pointer.x, py = state.pointer.y;
  const R = state.fine ? 105 : 74, R2 = R * R;
  const step = Math.max(1, stride | 0);

  const alpha = drawing ? 1 - dis * 0.45 : 0.26;

  /* three batched passes — one beginPath/fill per colour instead of per dot */
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = pass; i < COUNT; i += 3 * step) {
      const ci = drawing ? P.col[i] : INK;
      if (ci !== pass) continue;
      any = true;

      /* target: inside the drawing, or drifting as a cloud between scenes */
      let tx, ty;
      if (drawing) {
        const pm = Math.max(0, Math.min(1, m * 1.7 - P.st[i] * 0.7));
        const e = easeOut(pm);
        const uu = P.pu[i] + (P.u[i] - P.pu[i]) * e;
        const vv = P.pv[i] + (P.v[i] - P.pv[i]) * e;
        tx = ox + uu * w + P.sx[i] * spread * dis;
        ty = oy + vv * h + P.sy[i] * spread * dis;
      } else {
        /* Between scenes the particles drift as a cloud. It used to be a
           perpetual 34px sine at ~0.3 rad/s — never still, never quiet, and
           always at the edge of your vision. Now it is a slow 11px float, and
           it eases to a complete standstill while you are actually reading. */
        const amp = 11 * calm;
        tx = P.cx[i] * VW + Math.sin(t * 0.14 + P.ph[i]) * amp;
        ty = P.cy[i] * VH + Math.cos(t * 0.11 + P.ph[i]) * amp;
      }

      let ax = (tx - P.x[i]) * P.k[i], ay = (ty - P.y[i]) * P.k[i];

      /* pointer pushes the ink around */
      const dx = P.x[i] - px, dy = P.y[i] - py, d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 0.01) {
        const d = Math.sqrt(d2), f = (1 - d / R) * 2.6;
        ax += (dx / d) * f; ay += (dy / d) * f;
      }
      if (burstAmount > 0.2) {
        ax += (Math.random() - 0.5) * burstAmount;
        ay += (Math.random() - 0.5) * burstAmount;
      }

      P.vx[i] = (P.vx[i] + ax) * 0.845;
      P.vy[i] = (P.vy[i] + ay) * 0.845;
      P.x[i] += P.vx[i] * (dt / 16.7);
      P.y[i] += P.vy[i] * (dt / 16.7);

      const sz = P.s[i] * (drawing ? P.w[i] * 1.5 : 1.25);
      ctx.rect(P.x[i], P.y[i], sz, sz);
    }
    if (!any) continue;
    ctx.globalAlpha = alpha * (pass === INK ? 1 : 0.92);
    ctx.globalCompositeOperation = pass === INK ? 'source-over' : 'lighter';
    ctx.fillStyle = COLORS[pass];
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  if (burstAmount > 0.2) burstAmount *= Math.pow(0.6, dt / 16.7);

  if (now - lastStats > 500) { lastStats = now; bus.emit('stats', field.stats); }
  raf = requestAnimationFrame(frame);
}

export { start, stop };
