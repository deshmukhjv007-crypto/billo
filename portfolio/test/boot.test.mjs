/* ============================================================================
   test/boot.test.mjs — boots the real app against a stub DOM and asserts that
   nothing throws, the grain engine produces a valid data URI, and the content
   model stays consistent with the art registry.

   npm test          (node --test --test-force-exit test/)
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { installDOM } from './dom-stub.js';

const ROOT = path.join(import.meta.dirname, '..');

const errors = [];
process.on('uncaughtException', e => errors.push('uncaughtException: ' + e.message));
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + (e && e.message)));

const dom = installDOM();

/* ---------------------------------------------------------------- content */

test('content.js: every role points at art that exists', async () => {
  const { ROLES, ART, TEXT_ART, IMAGE_ART, HERO, ABOUT, CONTACT, RESUME } = await import('../content.js');
  const known = k => k in ART || k in TEXT_ART || k in IMAGE_ART;
  for (const r of ROLES) {
    assert.ok(known(r.art), `${r.id}: art "${r.art}" is not in ART/TEXT_ART`);
    assert.ok(r.name && r.kicker && r.sub && r.role && r.when, `${r.id}: missing copy`);
    assert.ok(Array.isArray(r.tags) && r.tags.length, `${r.id}: missing tags`);
    assert.ok(Array.isArray(r.bullets) && r.bullets.length >= 3, `${r.id}: missing achievement bullets`);
  }
  assert.ok(known(HERO.shape) && known(ABOUT.shape) && known(CONTACT.shape) && known(RESUME.shape));
  assert.equal(new Set(ROLES.map(r => r.id)).size, ROLES.length, 'duplicate role id');
});

test('content.js: the page and the PDF cannot drift apart', async () => {
  const C = await import('../content.js');
  const R = await import('../resume.js');
  // the page imports its facts from resume.js, so these must be the same objects
  assert.deepEqual(C.ROLES.map(r => r.bullets), R.EXPERIENCE.map(j => j.bullets),
    'the page bullets and the PDF bullets have diverged');
  assert.equal(C.ME.email, R.PERSON.email);
  assert.equal(C.ME.phone, R.PERSON.phone);
  assert.equal(C.ME.resume, `./${R.FILE_STEM}.pdf`);
  assert.equal(C.ME.resumeTxt, `./${R.FILE_STEM}.txt`);
  assert.deepEqual(C.KIT.map(k => k.k), R.SKILLS.map(g => g.group), 'skill groups out of sync');
  assert.equal(C.HIGHLIGHTS.length, R.STATS.length);
  // the download link must actually exist on disk
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(new URL('.', import.meta.url));
  assert.ok(existsSync(here + '../' + R.FILE_STEM + '.pdf'), 'index.html links a PDF that has not been built');
  assert.ok(existsSync(here + '../' + R.FILE_STEM + '.txt'), 'index.html links a text résumé that has not been built');
});

test('content.js: art paths look like path data', async () => {
  const { ART } = await import('../content.js');
  for (const [name, art] of Object.entries(ART)) {
    assert.ok(art.paths.length, `${name}: no paths`);
    for (const d of art.paths) {
      assert.match(d.trim(), /^[MmLlHhVvCcSsQqTtAaZz]/, `${name}: "${d.slice(0, 24)}…" is not path data`);
      assert.ok(d.length < 600, `${name}: suspiciously long path`);
    }
  }
});

/* ------------------------------------------------------------------- bus */

test('bus: on/emit round-trips and state has sane defaults', async () => {
  const { bus, state } = await import('../js/bus.js');
  let got = null;
  const off = bus.on('probe', v => { got = v; });
  bus.emit('probe', 42);
  assert.equal(got, 42);
  off();
  bus.emit('probe', 43);
  assert.equal(got, 42, 'unsubscribe did not work');
  assert.equal(typeof state.speed, 'number');
  assert.equal(state.pointer.x, -1e5);
});

/* ----------------------------------------------------------------- grain */

test('grain: turbulence data URI decodes back to a working SVG filter ref', async () => {
  const { turbulenceURI } = await import('../js/grain.js');
  const css = turbulenceURI({ baseFrequency: 0.72, numOctaves: 3, mono: true, size: 180 });
  assert.match(css, /^url\("data:image\/svg\+xml,.*"\)$/);
  const enc = css.slice('url("data:image/svg+xml,'.length, -2);
  const svg = decodeURIComponent(enc);
  assert.ok(svg.includes("<feTurbulence type='fractalNoise'"), 'no feTurbulence');
  assert.ok(svg.includes("baseFrequency='0.720'"), 'baseFrequency not written through');
  assert.ok(svg.includes("numOctaves='3'"));
  assert.ok(svg.includes("stitchTiles='stitch'"), 'seams will show without stitchTiles');
  assert.ok(svg.includes("filter='url(#g)'"), 'the # must decode to a real #, not %23');
  assert.ok(svg.includes('<feColorMatrix'), 'mono should desaturate the noise');
  assert.ok(!svg.includes('%23'), 'double-encoded hash → invisible grain');
});

test('grain: monochrome toggle actually removes the colour matrix', async () => {
  const { turbulenceURI } = await import('../js/grain.js');
  const colour = decodeURIComponent(turbulenceURI({ mono: false }).slice(24, -2));
  assert.ok(!colour.includes('feColorMatrix'), 'coloured turbulence should stay coloured');
  assert.ok(colour.includes('feTurbulence'));
});

test('grain: presets only use keys the engine knows', async () => {
  const { PRESETS, DEFAULTS } = await import('../js/grain.js');
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const key of Object.keys(preset)) {
      assert.ok(key in DEFAULTS, `preset "${name}" sets unknown key "${key}"`);
    }
  }
  assert.ok('hire.rest (theirs)' in PRESETS, 'the A/B preset disappeared');
  const theirs = PRESETS['hire.rest (theirs)'];
  assert.equal(theirs.opacity, 0.07);
  assert.equal(theirs.baseFrequency, 0.9);
  assert.equal(theirs.numOctaves, 2);
  assert.equal(theirs.filmOn, false, 'hire.rest has no animated layer');
});

test('grain: a layer builds, applies, presets and emits a snippet', async () => {
  const { GrainLayer, PRESETS } = await import('../js/grain.js');
  const host = dom.document.createElement('div');
  const layer = new GrainLayer(host, { ...PRESETS['16mm (default)'] });
  assert.equal(host.innerHTML.includes('g-turb'), true, 'turbulence layer not mounted');
  assert.equal(host.innerHTML.includes('g-film'), true, 'film layer not mounted');
  assert.equal(layer.s.opacity, PRESETS['16mm (default)'].opacity);
  layer.preset('VHS — moving grain');
  assert.equal(layer.s.blend, 'screen');
  layer.set({ opacity: 0.2 });
  assert.equal(layer.s.opacity, 0.2);
  layer.setIntensity(1);
  layer.spike(1);
  const css = layer.snippet();
  assert.match(css, /\.grain\{position:fixed;inset:0;z-index:60/);
  assert.match(css, /mix-blend-mode:screen/);
  assert.match(css, /feTurbulence/);
  layer.destroy();
});

test('grain: the noise is STANDING STILL by default', async () => {
  /* Regression. The sprite used to be stepped with a translate that carried a
     second, independent Y term — `-(((f * 37) % 5) * tile)` — which teleported
     the noise field 402-569 px every frame at 14 fps. That is not grain, that is
     the page rocking. Motion is now opt-in and, when on, is one clean horizontal
     tile per frame. */
  const { DEFAULTS } = await import('../js/grain.js');
  assert.equal(DEFAULTS.filmAnimate, false, 'grain must not animate unless asked');
  assert.equal(DEFAULTS.react, false, 'scroll-reactive opacity strobing must be opt-in too');
  assert.ok(DEFAULTS.opacity <= 0.1, `master opacity ${DEFAULTS.opacity} is too loud for a default`);
});

test('grain: when animation IS on, it drifts one sheet in X and never in Y', async () => {
  const { grainKeyframes } = await import('../js/grain.js');
  const kf = grainKeyframes({ tile: 180, frames: 8, fps: 12, name: 'grainShift1' });
  assert.match(kf.css, /@keyframes grainShift1\{from\{transform:translate3d\(0,0,0\)\}/);
  const to = kf.css.match(/to\{transform:translate3d\((-?[\d.]+)px,0,0\)\}/);
  assert.ok(to, 'the drift must translate in X only — a Y term is what broke it');
  assert.equal(Number(to[1]), -(180 * 8), 'exactly one whole sheet of tiles per cycle');
  assert.equal(kf.animation, 'grainShift1 0.667s steps(8, end) infinite');
  assert.match(kf.animation, /steps\(8, end\)/, 'stepping keeps each frame on a tile boundary');
  /* and the catastrophic case: a single frame must mean no animation at all */
  assert.equal(grainKeyframes({ frames: 1 }).animation, 'none');
});

test('grain: switching motion off restores a held frame', async () => {
  const { GrainLayer, DEFAULTS } = await import('../js/grain.js');
  const host = dom.document.createElement('div');
  const layer = new GrainLayer(host, { ...DEFAULTS, filmAnimate: true });
  assert.match(layer.style.textContent, /@keyframes/, 'should start animating');
  layer.setMotion(false);
  assert.equal(layer.s.filmAnimate, false);
  assert.equal(layer.film.style.animation, 'none');
  assert.equal(layer.film.style.transform, 'translate3d(0,0,0)');
  assert.equal(layer.style.textContent, '', 'keyframes should be torn down, not just unused');
  layer.destroy();
});

test('grain: mountLab wires presets, A/B swatches and the copy buttons', async () => {
  const { GrainLayer, mountLab, PRESETS } = await import('../js/grain.js');
  const host = dom.document.createElement('div');
  const layer = new GrainLayer(host);
  const root = dom.document.createElement('aside');
  const api = mountLab(root, layer);
  assert.ok(root.innerHTML.includes('Grain lab'));
  assert.ok(root.innerHTML.includes('data-ab="theirs"'), 'A/B swatch missing');
  assert.ok(api && typeof api.sync === 'function');
  assert.ok(Object.keys(PRESETS).length >= 7);
  api.sync();                       // must not throw
  layer.set({ opacity: 0.3 });
  api.sync();
  assert.equal(layer.s.opacity, 0.3);
});

/* ------------------------------------------------------------------ field */

test('field: survives a browser with no 2D context and still takes commands', async () => {
  const { field } = await import('../js/field.js');
  const canvas = dom.document.createElement('canvas');   // getContext → null in the stub
  assert.equal(field.init(canvas), null, 'should bail out cleanly');
  assert.doesNotThrow(() => field.setShape('spark', dom.document.createElement('div')));
  assert.doesNotThrow(() => field.setShape('hello', dom.document.createElement('div')));
  assert.doesNotThrow(() => field.setShape('cloud', null));
  assert.doesNotThrow(() => field.start());
  assert.doesNotThrow(() => field.stop());
  assert.ok(field.stats.count > 0);
});

/* ----------------------------------------------------------------- motion */

test('motion: init runs, exposes smooth-wheel toggle and a kick', async () => {
  const { motion } = await import('../js/motion.js');
  assert.doesNotThrow(() => motion.init());
  assert.equal(motion.smooth, false, 'wheel hijack must be opt-in');
  motion.setSmooth(true);
  assert.equal(motion.smooth, true);
  motion.setSmooth(false);
  assert.doesNotThrow(() => motion.kick(1));
  assert.doesNotThrow(() => motion.scrollTo(dom.document.createElement('section')));
});

/* -------------------------------------------------------------------- app */

test('app: the whole page boots without throwing', async () => {
  await import('../js/app.js');           // boot() runs on import
  await new Promise(r => setTimeout(r, 120));   // let rAF callbacks land
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(dom.html.classList.contains('motion'), 'motion class not added');
  assert.ok(dom.h1.classList.contains('split'), 'hero heading was not split');
  assert.ok(dom.h1.childNodes.length >= 1, 'split produced nothing');
  assert.ok(dom.stage.innerHTML.includes('<svg class="blueprint"'), 'blueprint art not injected');
  assert.ok(dom.stage.innerHTML.includes('pathLength="1"'), 'draw-on needs normalised path length');
});

test('app: image art falls back to a drawing when there is no JS to ink it', async () => {
  /* The blueprint is what a reader with JavaScript off sees. There is no field
     to ink a photograph into dots, so image art falls back to a drawn shape
     rather than repeating the picture the hero already frames. */
  const { blueprint } = await import('../js/app.js');
  const { IMAGE_ART, ART, TEXT_ART } = await import('../content.js');

  const img = blueprint('portrait');
  assert.match(img, /<svg class="blueprint"/, 'image art must fall back to the drawn shape');
  assert.ok(!img.includes('<img'), 'the photograph must not be drawn twice');
  assert.ok(img.includes('pathLength="1"'), 'the fallback drawing needs its draw-on length');
  assert.ok(IMAGE_ART.portrait.fallback, 'image art must declare what to draw when it cannot be sampled');
  assert.ok(IMAGE_ART[IMAGE_ART.portrait.fallback] || ART[IMAGE_ART.portrait.fallback],
    `the fallback shape "${IMAGE_ART.portrait.fallback}" does not exist`);

  /* and it must not have stolen the drawn shapes' behaviour */
  const drawn = Object.keys(ART)[0];
  assert.ok(blueprint(drawn).includes('<svg class="blueprint"'), 'drawn shapes still need their SVG');
  const written = Object.keys(TEXT_ART)[0];
  assert.ok(blueprint(written).includes('<svg class="blueprint"'), 'text shapes still need their SVG');
  assert.equal(blueprint('no-such-shape'), '', 'an unknown shape must render nothing at all');
});

test('portrait: the hero looks for the same photo the build does, in the same order', async () => {
  /* These two lists disagreeing is not a cosmetic bug: the build would report a
     portrait and the browser would fall back to a monogram, with no error
     anywhere. They are generated from one shared constant, and this checks it. */
  const { IMAGE_ART } = await import('../content.js');
  const { PERSON } = await import('../resume.js');
  const { photoSources } = await import('../js/photo-names.js');
  const { findPhoto } = await import('../photo.js');

  const { sources } = IMAGE_ART.portrait;
  assert.ok(sources.length > 1, 'there should be conventional filenames to fall back on');
  assert.equal(new Set(sources).size, sources.length, 'the source list repeats itself');
  assert.ok(sources.every(s => typeof s === 'string' && s.length), 'a source is empty');
  assert.deepEqual(sources, photoSources(), 'the browser list drifted from the shared one');

  /* Walk the list the way the loader does — <img> tries each source in turn —
     and check the browser lands on the same file the build already picked.
     Note findPhoto() cannot be used per-source here: given an explicit path it
     falls back to the conventional stems, so it would answer "yes, somewhere"
     for every candidate. Ask the disk instead. */
  const firstOnDisk = sources.find(src => fs.existsSync(path.join(ROOT, src.replace(/^\.\//, ''))));
  assert.equal(firstOnDisk ?? null, findPhoto(ROOT, PERSON.photo),
    'the build and the browser would pick different files as the portrait');

  if (PERSON.photo) assert.equal(sources[0], PERSON.photo, 'a configured photo path must be tried first');
  /* whatever the build found must be a path the browser actually tries */
  const found = findPhoto(ROOT, PERSON.photo);
  if (found) assert.ok(sources.includes(found), `the build found ${found}, which the browser never tries`);
});

test('field: fitting art to the particle budget keeps the whole composition', async () => {
  /* The budget is per device (4200 with a fine pointer, 2400 without), and a
     photograph arrives with far more candidates than either. The cut must be a
     uniform sample of the WHOLE frame: taking the first N in sampling order
     silently deletes the bottom of the face on smaller screens, and taking them
     unsorted leaves the portrait fading in as random scatter instead of a
     scanline sweep. */
  const { budgetPoints } = await import('../js/field.js');
  const grid = (cols, rows) => {
    const pts = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      pts.push({ u: (i + 0.5) / cols, v: (j + 0.5) / rows, c: 0, w: 1 });
    }
    return pts;
  };

  const fitted = budgetPoints(grid(60, 60), 1, 2400);
  assert.equal(fitted.pts.length, 2400, 'the budget was not respected');
  /* a budget below the floor still yields the floor: the field is never
     allowed to degrade into a sparse sprinkle */
  assert.equal(budgetPoints(grid(60, 60), 1, 900).pts.length, 1200, 'the minimum was not applied');
  const v = fitted.pts.map(p => p.v);
  assert.ok(Math.min(...v) < 0.05, `the top of the frame was dropped (min v ${Math.min(...v).toFixed(3)})`);
  assert.ok(Math.max(...v) > 0.95, `the bottom of the frame was dropped (max v ${Math.max(...v).toFixed(3)})`);

  /* and the thinning itself must be even, not concentrated in one region */
  const band = (lo, hi) => fitted.pts.filter(p => p.v >= lo && p.v < hi).length;
  const bands = [band(0, .2), band(.2, .4), band(.4, .6), band(.6, .8), band(.8, 1)];
  assert.ok(Math.min(...bands) > fitted.pts.length * 0.15, `uneven thinning across the frame: ${bands.join('/')}`);

  /* sorted by scanline, which is what makes the ink-on sweep read as a sweep */
  const key = p => p.v * 6 + p.u;
  for (let i = 1; i < fitted.pts.length; i++) {
    assert.ok(key(fitted.pts[i]) >= key(fitted.pts[i - 1]) - 1e-9, `not in scanline order at ${i}`);
  }
});

test('field: a point set smaller than the budget is used whole', async () => {
  const { budgetPoints } = await import('../js/field.js');
  const small = Array.from({ length: 300 }, (_, i) => ({ u: (i % 20) / 20, v: Math.floor(i / 20) / 15, c: 0, w: 1 }));
  const fitted = budgetPoints(small, 2.5, 4200);
  assert.equal(fitted.pts.length, 300, 'points were invented to fill the budget');
  assert.equal(fitted.aspect, 2.5, 'the aspect was not carried through');
  /* an empty set must still yield a shape, or the field has nothing to draw */
  const empty = budgetPoints([], 1, 4200);
  assert.equal(empty.pts.length, 1, 'an empty point set left the field with no shape at all');
});

test('field: image art that never loads leaves the drawn shape in place', async () => {
  /* Sampling a photograph is async. If it fails — no file, no decoder — the
     field must simply carry on with whatever it was already drawing and must
     never emit art that does not exist. */
  const { field } = await import('../js/field.js');
  const { bus } = await import('../js/bus.js');
  const seen = [];
  const off = bus.on('art', p => seen.push(p));
  assert.doesNotThrow(() => field.setShape('portrait', null));
  await new Promise(r => setTimeout(r, 80));
  off();
  assert.deepEqual(seen, [], 'an art event fired for a photograph that could not be read');
  assert.deepEqual(errors, [], errors.join('\n'));
  /* and the setter must survive being called twice while a load is in flight */
  assert.doesNotThrow(() => { field.setShape('portrait', null); field.setShape('portrait', null); });
});

test('app: theme flips and the grain blend follows the surface', async () => {
  const { applyTheme } = await import('../js/app.js');
  const { grain } = await import('../js/grain.js');
  applyTheme('light');
  assert.equal(dom.html.dataset.theme, 'light');
  assert.equal(grain.state.blend, 'multiply', 'light theme should multiply the grain');
  applyTheme('dark');
  assert.equal(grain.state.blend, 'overlay');
  assert.deepEqual(errors, [], errors.join('\n'));
});
