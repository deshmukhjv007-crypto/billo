/* ============================================================================
   test/boot.test.mjs — boots the real app against a stub DOM and asserts that
   nothing throws, the grain engine produces a valid data URI, and the content
   model stays consistent with the art registry.

   npm test          (node --test --test-force-exit test/)
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from './dom-stub.js';

const errors = [];
process.on('uncaughtException', e => errors.push('uncaughtException: ' + e.message));
process.on('unhandledRejection', e => errors.push('unhandledRejection: ' + (e && e.message)));

const dom = installDOM();

/* ---------------------------------------------------------------- content */

test('content.js: every role points at art that exists', async () => {
  const { ROLES, ART, TEXT_ART, HERO, ABOUT, CONTACT, RESUME } = await import('../content.js');
  const known = k => k in ART || k in TEXT_ART;
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
  layer.preset('VHS');
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
