/* ============================================================================
   grain.js — the grain engine.

   hire.rest v4 does grain in 5 lines:

     .grain{position:fixed;inset:0;z-index:60;pointer-events:none;
            opacity:.07;mix-blend-mode:overlay;
            background-image:url("data:image/svg+xml,...feTurbulence
              type='fractalNoise' baseFrequency='.9' numOctaves='2'
              stitchTiles='stitch'...");background-size:160px}

   That is the whole trick: an inline SVG feTurbulence tile, URL-encoded into a
   data URI, repeated at 160px, laid over the page at 7% with overlay blending.
   It costs one paint, never touches JS, and scales to any DPR. It is also
   completely *static* — one frozen frame of noise, forever, and because
   feTurbulence writes RGBA, the noise is faintly coloured rather than neutral.

   This engine keeps that trick (layer 1, `.g-turb`) and adds what a real film
   grain has:

   layer 2  `.g-film`  a canvas-generated sprite sheet of N noise frames,
                      cycled with a stepped CSS transform animation at film
                      cadence (8–24 fps) — compositor-only, no repaint of the
                      page, so the grain *moves* like 16mm instead of sitting
                      there like dust on the lens.
   reactivity          opacity lerps up with scroll velocity / pointer speed
                      and spikes on click, so the page feels like it has a
                      physical surface.
   tone control        gamma (`contrast`) shapes the noise distribution from
                      "TV static" to "sparse silver specks"; `mono` collapses
                      the turbulence to luminance so it stops tinting the art.
   theme aware         overlay on dark, multiply/soft-light on light.
   reduced motion      animation + reactivity off, static layer stays.

   Every knob is live in the Grain Lab (press G), including an A/B swatch that
   renders hire.rest's exact settings next to yours.
   ========================================================================== */

import { bus, state } from './bus.js';

/* The exact recipe lifted from https://hire.rest/style.css — kept for the A/B. */
export const HIRE_REST_CSS = `.grain{position:fixed;inset:0;z-index:60;pointer-events:none;opacity:.07;mix-blend-mode:overlay;
 background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:160px}`;

export const DEFAULTS = {
  on: true,
  opacity: 0.085,       // master — a texture you notice, not a layer you watch
  blend: 'overlay',     // overlay | soft-light | multiply | screen | hard-light | difference
  /* layer 1 — SVG feTurbulence (the hire.rest trick, tunable) */
  turbOn: true,
  turbOpacity: 0.55,
  baseFrequency: 0.72,
  numOctaves: 3,
  mono: true,           // desaturate the turbulence (theirs is coloured RGBA)
  seed: 7,
  /* layer 2 — canvas noise sprite, held still unless you ask for motion */
  filmOn: true,
  filmOpacity: 0.9,
  filmAnimate: false,   // <- OFF by default. See the note on _applyMotion().
  tile: 180,            // px per noise frame
  frames: 8,            // frames in the sprite sheet
  fps: 12,              // cadence when animation is on
  contrast: 1.3,        // gamma: >1 = sparser, punchier specks
  tint: 0.15,           // 0 = neutral, 1 = warm/cool chroma speckle
  /* behaviour */
  react: false,         // opacity follows scroll speed — off, it strobes
  reactMax: 1.25        // opacity multiplier at full scroll speed
};

export const PRESETS = {
  'hire.rest (theirs)': { opacity: 0.07, turbOn: true, turbOpacity: 1, baseFrequency: 0.9, numOctaves: 2, mono: false, filmOn: false, blend: 'overlay', react: false, contrast: 1, tint: 0 },
  'Subtle': { opacity: 0.06, turbOn: true, turbOpacity: 0.8, baseFrequency: 0.85, numOctaves: 2, mono: true, filmOn: false, blend: 'overlay', react: false, contrast: 1.1, tint: 0 },
  '35mm': { opacity: 0.1, turbOn: true, turbOpacity: 0.55, baseFrequency: 0.72, numOctaves: 3, mono: true, filmOn: true, filmAnimate: true, fps: 12, tile: 180, frames: 8, contrast: 1.3, tint: 0.15, blend: 'overlay', react: false, reactMax: 1.25 },
  '16mm (default)': { ...DEFAULTS },
  'Riso print': { opacity: 0.14, turbOn: true, turbOpacity: 0.5, baseFrequency: 0.34, numOctaves: 2, mono: false, filmOn: true, filmAnimate: false, fps: 7, tile: 220, frames: 5, contrast: 1.7, tint: 1, blend: 'multiply', react: false },
  'VHS — moving grain': { opacity: 0.17, turbOn: true, turbOpacity: 0.7, baseFrequency: 0.22, numOctaves: 5, mono: false, filmOn: true, filmAnimate: true, fps: 16, tile: 120, frames: 6, contrast: 0.75, tint: 0.6, blend: 'screen', react: false, reactMax: 1.25 },
  'Newsprint': { opacity: 0.09, turbOn: true, turbOpacity: 1, baseFrequency: 1.25, numOctaves: 1, mono: true, filmOn: false, blend: 'soft-light', react: false, contrast: 1 },
  'Off': { on: false }
};

/* -------------------------------------------------------------------------- */
/* texture builders                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The @keyframes that advance the noise sprite, as a string.
 *
 * One clean horizontal drift of exactly one whole sheet of tiles, stepped so
 * every jump lands on a frame boundary. Pure and exported: the animation is the
 * part that was wrong before, and it should be testable without a canvas.
 *
 * (For the record, what was wrong: the old version added an independent Y term,
 * `-(((f * 37) % 5) * tile)`, so consecutive frames displaced the noise field by
 * 402-569 px. Grain that teleports is not grain, it is the page rocking.)
 */
export function grainKeyframes({ tile = 180, frames = 8, fps = 12, name = 'grainShift' } = {}) {
  const F = Math.max(1, Math.round(frames));
  const T = Math.round(tile);
  const dur = (F / Math.max(1, fps)).toFixed(3);
  if (F < 2) return { css: '', animation: 'none', duration: dur, ticks: 1 };
  return {
    css: `@keyframes ${name}{from{transform:translate3d(0,0,0)}`
      + `to{transform:translate3d(${-T * F}px,0,0)}}`,
    animation: `${name} ${dur}s steps(${F}, end) infinite`,
    duration: dur,
    ticks: F
  };
}

/** The feTurbulence data-URI. Same primitive hire.rest uses, parameterised. */
export function turbulenceURI({ baseFrequency = 0.72, numOctaves = 3, mono = true, seed = 7, size = 180 } = {}) {
  const bf = Number(baseFrequency).toFixed(3);
  const oct = Math.max(1, Math.round(numOctaves));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${bf}' numOctaves='${oct}' seed='${seed}' stitchTiles='stitch'/>` +
    (mono ? `<feColorMatrix type='saturate' values='0'/>` : '') +
    `</filter>` +
    `<rect width='100%' height='100%' filter='url(#g)'/>` +
    `</svg>`;
  /* encodeURIComponent turns '#' into %23 — the browser decodes the data URI
     back to '#' before the SVG parser ever sees it. Double-encoding (%2523)
     is the classic bug here: it leaves a literal %23 in the SVG and the
     filter reference dies silently, so you get an invisible grain layer. */
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
}

/** A sprite sheet of `frames` noise tiles, side by side, as a data URL. */
export function filmSprite({ tile = 180, frames = 8, contrast = 1.3, tint = 0.15 } = {}) {
  const T = Math.max(32, Math.min(512, Math.round(tile)));
  const F = Math.max(1, Math.min(24, Math.round(frames)));
  const c = document.createElement('canvas');
  c.width = T * F; c.height = T;
  const g = c.getContext ? c.getContext('2d') : null;
  if (!g || !g.createImageData) return '';
  const img = g.createImageData(T, T);
  const d = img.data;
  const warm = tint * 26, cool = tint * 20;
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < T * T; i++) {
      // sum of two uniforms → triangular distribution. Real silver-halide grain
      // is clumpy, not uniform: this kills the "TV static" look.
      let n = (Math.random() + Math.random()) * 0.5;
      n = Math.pow(n, contrast);
      const lum = 128 + (n - 0.5) * 255;
      const o = i << 2;
      d[o] = lum + warm > 255 ? 255 : lum + warm;
      d[o + 1] = lum;
      d[o + 2] = lum - cool < 0 ? 0 : lum - cool;
      d[o + 3] = 255;
    }
    g.putImageData(img, f * T, 0);
  }
  try { return c.toDataURL('image/png'); } catch (_) { return ''; }
}

/* -------------------------------------------------------------------------- */
/* one grain layer (used for the page AND for each A/B swatch)                 */
/* -------------------------------------------------------------------------- */

let uid = 0;

export class GrainLayer {
  constructor(host, opts = {}) {
    this.host = host;
    this.id = ++uid;
    this.s = { ...DEFAULTS, ...opts };
    this.intensity = 0;
    this.target = 0;
    this._raf = 0;
    this._regen = 0;
    host.classList.add('grain-layer');
    host.innerHTML = `<div class="g-turb"></div><div class="g-film"><i></i></div>`;
    this.turb = host.querySelector('.g-turb');
    this.filmWrap = host.querySelector('.g-film');
    this.film = host.querySelector('.g-film i');
    this.style = document.createElement('style');
    document.head.appendChild(this.style);
    this.apply({ rebuild: true });
  }

  set(patch, { rebuild = false } = {}) {
    const needsSprite = ['tile', 'frames', 'contrast', 'tint'].some(k => k in patch && patch[k] !== this.s[k]);
    Object.assign(this.s, patch);
    this.apply({ rebuild: rebuild || needsSprite });
  }

  /** Still or moving — the one switch most people will want. */
  setMotion(on) {
    this.set({ filmAnimate: !!on });
  }

  preset(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.set({ ...DEFAULTS, on: true, ...p }, { rebuild: true });
  }

  apply({ rebuild = false } = {}) {
    const s = this.s;
    const h = this.host;
    h.style.display = s.on ? '' : 'none';
    if (!s.on) return;
    h.style.setProperty('--grain-blend', s.blend);
    h.style.opacity = s.opacity;
    h.style.mixBlendMode = s.blend;

    /* layer 1: turbulence */
    if (s.turbOn) {
      this.turb.style.display = '';
      this.turb.style.backgroundImage = turbulenceURI(s);
      this.turb.style.backgroundSize = `${s.tile}px ${s.tile}px`;
      this.turb.style.opacity = s.turbOpacity;
    } else this.turb.style.display = 'none';

    /* layer 2: the noise sprite */
    if (!s.filmOn) {
      this.filmWrap.style.display = 'none';
      return;
    }
    this.filmWrap.style.display = '';
    this.filmWrap.style.opacity = s.filmOpacity;
    if (rebuild || !this._sprite) {
      if (this._regen) cancelAnimationFrame(this._regen);
      this._applyMotion();                    // settle motion state immediately
      this._regen = requestAnimationFrame(() => {
        this._sprite = filmSprite(s);
        if (!this._sprite) { this.filmWrap.style.display = 'none'; return; }
        this.film.style.backgroundImage = `url(${this._sprite})`;
        this.film.style.backgroundSize = `${s.tile * s.frames}px ${s.tile}px`;
        this._applyMotion();
      });
    } else {
      this.film.style.backgroundSize = `${s.tile * s.frames}px ${s.tile}px`;
      this._applyMotion();
    }
  }

  /**
   * Motion, or none.
   *
   * The first version of this stepped the sprite with a translate that had a
   * second, independent term on the Y axis — `-(((f * 37) % 5) * tile)` — which
   * teleported the noise field by 402-569 px on every frame at 14 fps. That is
   * not grain; it is the whole texture jumping, and it reads exactly like the
   * page rocking under you.
   *
   * Film grain doesn't move *at all* relative to the frame — that is what makes
   * it grain. So stillness is the default, and when motion is switched on it is
   * a single clean horizontal drift of one tile per frame: the same gentle
   * crawl a projector gate has, never a jump.
   */
  _applyMotion() {
    const s = this.s;
    if (!(s.filmAnimate && !state.reduce)) {
      /* frame 0, held: a frozen silver-halide texture over the page */
      this.film.style.animation = 'none';
      this.film.style.transform = 'translate3d(0,0,0)';
      this.style.textContent = '';
      return;
    }
    const kf = grainKeyframes({ tile: s.tile, frames: s.frames, fps: s.fps, name: `grainShift${this.id}` });
    this.style.textContent = kf.css;
    this.film.style.animation = kf.animation;
  }

  /** v = 0..1 drive. Called from the single motion rAF loop. */
  setIntensity(v) {
    this.target = Math.max(0, Math.min(1, v));
    if (!this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  spike(amount = 1) {
    this.intensity = Math.min(1, this.intensity + amount);
    if (!this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  _loop = () => {
    const s = this.s;
    if (!s.on) { this._raf = 0; return; }
    if (!s.react || state.reduce) {
      this.host.style.opacity = s.opacity;
      this.intensity = this.target = 0;
      this._raf = 0;
      return;
    }
    const k = this.target > this.intensity ? 0.4 : 0.07;   // fast attack, slow release
    this.intensity += (this.target - this.intensity) * k;
    const op = s.opacity * (1 + this.intensity * (s.reactMax - 1));
    this.host.style.opacity = op.toFixed(4);
    if (Math.abs(this.target - this.intensity) > 0.002) this._raf = requestAnimationFrame(this._loop);
    else this._raf = 0;
  };

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.style.remove();
    this.host.innerHTML = '';
  }

  /* ---- the snippet you can paste into any project ---- */
  snippet() {
    const s = this.s;
    const uri = turbulenceURI(s);
    return `/* grain — ${s.filmOn ? '2 layers (static turbulence + animated film sprite)' : '1 layer (static turbulence)'} */
.grain{position:fixed;inset:0;z-index:60;pointer-events:none;contain:strict;
  opacity:${s.opacity};mix-blend-mode:${s.blend}}
.grain .g-turb{position:absolute;inset:0;opacity:${s.turbOn ? s.turbOpacity : 0};
  background-image:${uri.replace(/\n/g, '')};
  background-size:${s.tile}px ${s.tile}px}
${s.filmOn ? `.grain .g-film{position:absolute;inset:0;opacity:${s.filmOpacity}}
.grain .g-film i{position:absolute;inset:-60%;background-repeat:repeat;
  background-size:${s.tile * s.frames}px ${s.tile}px;will-change:transform;
  animation:grainShift ${(s.frames / s.fps).toFixed(3)}s steps(${s.frames}, end) infinite}
@keyframes grainShift{${Array.from({ length: s.frames }, (_, f) =>
    `${((f / s.frames) * 100).toFixed(2)}%{transform:translate3d(${-(f * s.tile)}px,0,0)}`).join('')}}
/* build the sprite once (~${((s.tile * s.tile * s.frames) / 1000) | 0}k px):
   filmSprite({tile:${s.tile},frames:${s.frames},contrast:${s.contrast},tint:${s.tint}}) */` : ''}
@media (prefers-reduced-motion:reduce){.grain .g-film i{animation:none}}`;
  }
}

/* -------------------------------------------------------------------------- */
/* the page grain + the Grain Lab                                             */
/* -------------------------------------------------------------------------- */

export const grain = {
  layer: null,
  init(host) {
    this.layer = new GrainLayer(host);
    bus.on('frame', ({ speed, burst }) => {
      if (!this.layer.s.react) return;
      this.layer.setIntensity(Math.min(1, speed * 1.15 + burst * 0.6 + state.pointer.speed * 0.35));
    });
    bus.on('burst', () => this.layer.spike(1));
    return this.layer;
  },
  set: (p, o) => grain.layer && grain.layer.set(p, o),
  preset: n => grain.layer && grain.layer.preset(n),
  get state() { return grain.layer ? grain.layer.s : DEFAULTS; },
  snippet: () => grain.layer ? grain.layer.snippet() : ''
};

/* The lab: sliders, presets, live A/B against hire.rest's exact settings. */
export function mountLab(root, layer) {
  root.innerHTML = `
  <div class="lab-head">
    <div>
      <h3>Grain lab</h3>
      <p>Everything on this page is these two layers. Drag, then take the CSS with you.</p>
      <p class="lab-note">The noise sits still by default &mdash; real grain does not move
      relative to the frame. Switch on <b>Animate it</b> if you want the projector-gate drift.</p>
    </div>
    <button class="lab-x" data-lab="close" aria-label="Close grain lab">✕</button>
  </div>

  <div class="ab">
    <figure class="swatch" data-ab="theirs">
      <div class="sw-art"><span>grain</span><div class="sw-grain"></div></div>
      <figcaption>hire.rest — <code>opacity:.07</code> · static · coloured turbulence</figcaption>
    </figure>
    <figure class="swatch" data-ab="yours">
      <div class="sw-art"><span>grain</span><div class="sw-grain"></div></div>
      <figcaption>yours — live (every knob below writes to both)</figcaption>
    </figure>
  </div>

  <div class="presets" data-lab="presets"></div>

  <div class="knobs">
    ${knob('opacity', 'Master opacity', 0, 0.4, 0.005)}
    ${knob('baseFrequency', 'baseFrequency', 0.05, 1.6, 0.01)}
    ${knob('numOctaves', 'numOctaves', 1, 6, 1)}
    ${knob('turbOpacity', 'Turbulence weight', 0, 1, 0.01)}
    ${knob('filmOpacity', 'Film weight', 0, 1, 0.01)}
    ${knob('fps', 'Film fps', 1, 30, 1)}
    ${knob('tile', 'Tile size', 64, 320, 4)}
    ${knob('frames', 'Sprite frames', 1, 16, 1)}
    ${knob('contrast', 'Grain gamma', 0.4, 2.6, 0.05)}
    ${knob('tint', 'Chroma tint', 0, 1, 0.01)}
    ${knob('reactMax', 'Velocity boost', 1, 3.5, 0.05)}
  </div>

  <div class="switches">
    ${toggle('turbOn', 'feTurbulence layer')}
    ${toggle('filmOn', 'Canvas noise layer')}
    ${toggle('filmAnimate', 'Animate it (moves like film)')}
    ${toggle('mono', 'Monochrome noise')}
    ${toggle('react', 'Pulse with scroll speed')}
    <label class="sw">
      <span>Blend</span>
      <select data-lab="blend">
        ${['overlay', 'soft-light', 'multiply', 'screen', 'hard-light', 'difference', 'normal']
          .map(b => `<option value="${b}">${b}</option>`).join('')}
      </select>
    </label>
  </div>

  <div class="lab-foot">
    <button class="btn small" data-lab="copy-css">Copy CSS</button>
    <button class="btn small ghost" data-lab="copy-js">Copy full engine</button>
    <button class="btn small ghost" data-lab="random">Randomize</button>
    <button class="btn small ghost" data-lab="reset">Reset</button>
    <output class="lab-out" data-lab="out" role="status"></output>
  </div>`;

  function knob(key, label, min, max, step) {
    return `<label class="knob" data-for="${key}">
      <span>${label}<b data-val="${key}"></b></span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-lab="${key}">
    </label>`;
  }
  function toggle(key, label) {
    return `<label class="sw"><input type="checkbox" data-lab="${key}"><span>${label}</span></label>`;
  }

  /* presets */
  const pWrap = root.querySelector('[data-lab=presets]');
  Object.keys(PRESETS).forEach(name => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = name;
    b.addEventListener('click', () => { layer.preset(name); push({}, { rebuild: true }); say(name); });
    pWrap.appendChild(b);
  });

  /* A/B swatches — left is hire.rest's exact recipe, right mirrors your live grain */
  const theirs = new GrainLayer(root.querySelector('[data-ab=theirs] .sw-grain'),
    { ...PRESETS['hire.rest (theirs)'], on: true });
  const mirror = new GrainLayer(root.querySelector('[data-ab=yours] .sw-grain'), { ...layer.s });

  /* every change flows through push(): page grain + the live swatch stay in step */
  function push(patch, opts) {
    layer.set(patch, opts);
    mirror.set({ ...layer.s }, { rebuild: true });
    syncUi();
  }

  root.querySelectorAll('[data-lab]').forEach(el => {
    const key = el.dataset.lab;
    if (key === 'close') { el.addEventListener('click', () => root.classList.remove('open')); return; }
    if (['copy-css', 'copy-js', 'random', 'reset'].includes(key)) {
      el.addEventListener('click', () => doAction(key));
      return;
    }
    if (key === 'blend') { el.addEventListener('change', () => push({ blend: el.value })); return; }
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        paintVal(key, v);
        push({ [key]: v }, { rebuild: ['tile', 'frames', 'contrast', 'tint'].includes(key) });
      });
      return;
    }
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => push({ [key]: el.checked }, { rebuild: true }));
    }
  });

  function paintVal(k, v) {
    const out = root.querySelector(`[data-val="${k}"]`);
    if (out) out.textContent = Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 3 : 2);
  }

  const COMPARE = ['on', 'opacity', 'blend', 'turbOn', 'turbOpacity', 'baseFrequency', 'numOctaves',
    'mono', 'filmOn', 'filmAnimate', 'filmOpacity', 'fps', 'tile', 'frames', 'contrast', 'tint', 'react', 'reactMax'];

  function matchesPreset(s, name) {
    const p = PRESETS[name];
    if (!p) return false;
    const target = { ...DEFAULTS, on: true, ...p };
    return COMPARE.every(k => s[k] === target[k]);
  }

  function syncUi() {
    const s = layer.s;
    root.querySelectorAll('input[type=range][data-lab]').forEach(el => {
      el.value = s[el.dataset.lab];
      paintVal(el.dataset.lab, s[el.dataset.lab]);
    });
    root.querySelectorAll('input[type=checkbox][data-lab]').forEach(el => { el.checked = !!s[el.dataset.lab]; });
    const sel = root.querySelector('[data-lab=blend]');
    if (sel) sel.value = s.blend;
    root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', matchesPreset(s, c.textContent)));
  }

  function say(msg) {
    const out = root.querySelector('[data-lab=out]');
    out.textContent = msg;
    clearTimeout(say._t);
    say._t = setTimeout(() => (out.textContent = ''), 2600);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); say('copied \u2713'); }
    catch { say('clipboard blocked \u2014 logged to console'); console.log(text); }
  }

  function doAction(kind) {
    if (kind === 'copy-css') return copy(layer.snippet());
    if (kind === 'copy-js') return copy(ENGINE_SOURCE);
    if (kind === 'reset') { push({ ...DEFAULTS }, { rebuild: true }); return say('reset to 16mm'); }
    if (kind === 'random') {
      push({
        on: true,
        opacity: +(0.05 + Math.random() * 0.16).toFixed(3),
        baseFrequency: +(0.12 + Math.random() * 1.1).toFixed(3),
        numOctaves: 1 + ((Math.random() * 5) | 0),
        fps: 4 + ((Math.random() * 22) | 0),
        tile: 96 + ((Math.random() * 8) | 0) * 24,
        frames: 3 + ((Math.random() * 9) | 0),
        contrast: +(0.6 + Math.random() * 1.8).toFixed(2),
        tint: +(Math.random()).toFixed(2),
        mono: Math.random() > 0.35,
        seed: (Math.random() * 999) | 0,
        filmOn: Math.random() > 0.15,
        turbOn: true,
        react: true
      }, { rebuild: true });
      return say('randomized');
    }
  }

  syncUi();
  return { sync: syncUi, mirror, theirs };
}

/* A self-contained version of the engine, handed out by "Copy full engine". */
const ENGINE_SOURCE = `/* standalone grain — paste into any page. MIT-ish, do what you like. */
(function(){
  var CFG = {opacity:.11, blend:'overlay', tile:180, frames:8, fps:14, contrast:1.3, tint:.15,
             baseFrequency:.72, numOctaves:3, mono:true, seed:7, react:true, reactMax:1.9};
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var el = document.createElement('div'); el.className='grain'; el.setAttribute('aria-hidden','true');
  el.style.cssText='position:fixed;inset:0;z-index:60;pointer-events:none;contain:strict;opacity:'+CFG.opacity+';mix-blend-mode:'+CFG.blend;
  var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='"+CFG.tile+"' height='"+CFG.tile+"'>"+
    "<filter id='g' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='"+CFG.baseFrequency+"' numOctaves='"+CFG.numOctaves+"' seed='"+CFG.seed+"' stitchTiles='stitch'/>"+
    (CFG.mono?"<feColorMatrix type='saturate' values='0'/>":"")+"</filter><rect width='100%' height='100%' filter='url(#g)'/></svg>";
  var turb = document.createElement('div');
  turb.style.cssText="position:absolute;inset:0;opacity:.55;background-size:"+CFG.tile+"px "+CFG.tile+"px;background-image:url(\\"data:image/svg+xml,"+encodeURIComponent(svg).replace(/'/g,'%27')+"\\")";
  el.appendChild(turb);
  if (!reduce) {
    var c=document.createElement('canvas'); c.width=CFG.tile*CFG.frames; c.height=CFG.tile;
    var g=c.getContext('2d'), img=g.createImageData(CFG.tile,CFG.tile), d=img.data;
    for (var f=0;f<CFG.frames;f++){
      for (var i=0;i<CFG.tile*CFG.tile;i++){
        var n=Math.pow((Math.random()+Math.random())*.5, CFG.contrast), lum=128+(n-.5)*255, o=i<<2;
        d[o]=Math.min(255,lum+CFG.tint*26); d[o+1]=lum; d[o+2]=Math.max(0,lum-CFG.tint*20); d[o+3]=255;
      }
      g.putImageData(img,f*CFG.tile,0);
    }
    var film=document.createElement('div'); film.style.cssText='position:absolute;inset:-60%;background-repeat:repeat;background-size:'+(CFG.tile*CFG.frames)+'px '+CFG.tile+'px;will-change:transform;background-image:url('+c.toDataURL()+')';
    var kf='@keyframes grainShift{'+Array.from({length:CFG.frames},function(_,i){
      return (i/CFG.frames*100).toFixed(2)+'%{transform:translate3d('+(-(i*CFG.tile))+'px,0,0)}';}).join('')+'}';
    var st=document.createElement('style'); st.textContent=kf; document.head.appendChild(st);
    film.style.animation='grainShift '+(CFG.frames/CFG.fps).toFixed(3)+'s steps('+CFG.frames+', end) infinite';
    el.appendChild(film);
    if (CFG.react) {
      var last=performance.now(), lastY=scrollY, cur=CFG.opacity, tgt=CFG.opacity;
      addEventListener('scroll',function(){var n=performance.now(),v=Math.abs(scrollY-lastY)/Math.max(1,n-lastY)*1000;
        tgt=CFG.opacity*(1+Math.min(1,v/2200)*(CFG.reactMax-1)); last=n; lastY=scrollY;},{passive:true});
      (function loop(){cur+=(tgt-cur)*(tgt>cur?.4:.07);el.style.opacity=cur.toFixed(4);requestAnimationFrame(loop);})();
    }
  }
  document.body.appendChild(el);
})();`;
