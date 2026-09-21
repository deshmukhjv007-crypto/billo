/* Prolens standby field — the futuristic sensor backdrop shown while the
 * camera is off. Drawn entirely on a canvas in 2D: no images, no network,
 * no framework.
 *
 * Cost is kept low on purpose, because this runs behind glassy UI:
 *   - the static layers (base wash, HUD grid, horizon, vignette, grain) are
 *     rendered once per resize into an offscreen canvas and blitted per frame;
 *   - the moving glows are pre-rendered radial sprites drawn with `lighter`;
 *   - only the rings and the scan sweep are stroked per frame, capped at 20fps.
 * It runs only while it is on screen and stops the moment a live camera or an
 * analysed photo takes the stage, so it never competes with the coach loop.
 */

const TAU = Math.PI * 2;
const MAX_EDGE = 560; // render cap: gradients stay crisp without burning GPU
const FRAME_MS = 1000 / 20; // the field breathes; 20fps is plenty

/** Radial glow sprite, drawn once and reused (cheap alternative to gradients). */
function makeGlow(rgb, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.45, `rgba(${rgb},0.34)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Deterministic grain tile, used as a repeating pattern in the static layer. */
function makeGrain(size = 96) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const ctx = tile.getContext("2d");
  const image = ctx.createImageData(size, size);
  let seed = 1337;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const v = 128 + ((seed / 4294967296) * 2 - 1) * 90;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return tile;
}

export function createAmbientScene(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const grain = makeGrain();
  const glowCyan = makeGlow("77,216,255");
  const glowViolet = makeGlow("139,123,255");
  const glowTeal = makeGlow("62,240,200");
  const staticLayer = document.createElement("canvas");
  let running = false;
  let raf = 0;
  let startedAt = 0;
  let elapsed = 0;
  let lastPaint = 0;

  /** Everything that never moves: painted once per size change. */
  function paintStatic(w, h) {
    staticLayer.width = w;
    staticLayer.height = h;
    const s = staticLayer.getContext("2d");
    const base = s.createLinearGradient(0, 0, w * 0.3, h);
    base.addColorStop(0, "#05080f");
    base.addColorStop(0.5, "#071320");
    base.addColorStop(1, "#04070d");
    s.fillStyle = base;
    s.fillRect(0, 0, w, h);

    // HUD grid.
    const step = Math.max(w, h) / 9;
    s.lineWidth = 1;
    s.strokeStyle = "rgba(120,190,255,0.055)";
    s.beginPath();
    for (let x = 0; x < w + step; x += step) {
      s.moveTo(x, 0);
      s.lineTo(x, h);
    }
    for (let y = 0; y < h + step; y += step) {
      s.moveTo(0, y);
      s.lineTo(w, y);
    }
    s.stroke();

    // Horizon glow line: the stage the reticle sits on.
    const horizon = h * 0.72;
    const line = s.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, "rgba(77,216,255,0)");
    line.addColorStop(0.5, "rgba(77,216,255,0.22)");
    line.addColorStop(1, "rgba(77,216,255,0)");
    s.strokeStyle = line;
    s.beginPath();
    s.moveTo(0, horizon);
    s.lineTo(w, horizon);
    s.stroke();

    // Grain.
    s.save();
    s.globalAlpha = 0.05;
    s.globalCompositeOperation = "overlay";
    s.fillStyle = s.createPattern(grain, "repeat");
    s.fillRect(0, 0, w, h);
    s.restore();

    // Vignette.
    const g = s.createRadialGradient(
      w / 2,
      h * 0.45,
      Math.min(w, h) * 0.16,
      w / 2,
      h * 0.5,
      Math.max(w, h) * 0.78,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.65, "rgba(2,5,10,0.35)");
    g.addColorStop(1, "rgba(2,4,8,0.86)");
    s.fillStyle = g;
    s.fillRect(0, 0, w, h);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth || 360;
    const h = canvas.clientHeight || window.innerHeight || 640;
    const scale = Math.min(
      window.devicePixelRatio || 1,
      MAX_EDGE / Math.max(w, h),
    );
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    paintStatic(canvas.width, canvas.height);
    if (!running) draw(elapsed);
  }

  function drawReticle(t) {
    const { width: w, height: h } = canvas;
    const base = Math.min(w, h);
    ctx.save();
    ctx.translate(w / 2, h * 0.42);
    ctx.lineCap = "round";
    for (const [i, radius, spin, dash, alpha] of [
      [0, 0.3, 0.035, 0.12, 0.16],
      [1, 0.22, -0.05, 0.05, 0.12],
      [2, 0.14, 0.08, 0.16, 0.1],
    ]) {
      const r = base * radius;
      ctx.save();
      ctx.rotate(t * spin + i);
      ctx.setLineDash([r * dash, r * (dash + 0.09)]);
      ctx.strokeStyle = "rgba(150,220,255," + alpha + ")";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    // Corner ticks: reads as a viewfinder, not a logo.
    const r = base * 0.36;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(150,220,255,0.2)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 4 + Math.PI / 4;
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a) * (r * 1.12), Math.sin(a) * (r * 1.12));
    }
    ctx.stroke();
    ctx.restore();
  }

  function draw(t) {
    const { width: w, height: h } = canvas;
    if (!w || !h) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(staticLayer, 0, 0);

    // Drifting glows, blitted from sprites.
    const span = Math.max(w, h);
    const size = span * 1.05;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.3;
    ctx.drawImage(
      glowCyan,
      w * 0.24 + Math.sin(t * 0.11) * w * 0.07 - size / 2,
      h * 0.26 + Math.cos(t * 0.09) * h * 0.05 - size / 2,
      size,
      size,
    );
    ctx.globalAlpha = 0.24;
    ctx.drawImage(
      glowViolet,
      w * 0.82 + Math.cos(t * 0.07) * w * 0.06 - size / 2,
      h * 0.3 + Math.sin(t * 0.12) * h * 0.06 - size / 2,
      size,
      size,
    );
    ctx.globalAlpha = 0.16;
    ctx.drawImage(
      glowTeal,
      w * 0.5 + Math.sin(t * 0.05 + 2) * w * 0.1 - size / 2,
      h * 0.94 - size / 2,
      size,
      size,
    );
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    drawReticle(t);

    // Scan sweep.
    const cy = ((t * 0.07) % 1.15 - 0.075) * h;
    const band = h * 0.16;
    const sweep = ctx.createLinearGradient(0, cy - band, 0, cy + band);
    sweep.addColorStop(0, "rgba(77,216,255,0)");
    sweep.addColorStop(0.5, "rgba(77,216,255,0.06)");
    sweep.addColorStop(1, "rgba(77,216,255,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, cy - band, w, band * 2);
    ctx.fillStyle = "rgba(160,235,255,0.18)";
    ctx.fillRect(0, cy, w, 1);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - lastPaint < FRAME_MS) return;
    lastPaint = now;
    elapsed = (now - startedAt) / 1000;
    draw(elapsed);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw(6);
      running = false;
      return;
    }
    startedAt = performance.now() - elapsed * 1000;
    lastPaint = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  const api = {
    start,
    stop,
    resize,
    isRunning: () => running,
    /** Paints one frame at time `t` — used by the frame-budget test. */
    paint: (t = 0) => draw(t),
  };
  canvas.__ambientScene = api; // diagnostic handle for tests, not a global
  return api;
}
