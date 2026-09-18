/* ============================================================================
   test/portrait-boot.test.mjs — the whole portrait path, end to end.

   inkPoints() is covered in isolation by portrait.test.mjs. What was still
   unproven is the wiring between the pieces, which is where this feature can
   fail silently: a photograph that loads but never reaches the particle field,
   or the field sampling it again on every scroll, or a decode failure taking
   the page down with it.

   So this file installs a fake decoder — an Image that "loads" named files, and
   a canvas whose 2D context returns synthetic pixels — and then drives the real
   field through it. Run in its own process by node --test, so the stubs cannot
   leak into the other suites.
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDOM } from './dom-stub.js';

const dom = installDOM();

/* ------------------------------------------------------- the fake browser */

const SIZE = 208;

/** A photograph that always loads: bright subject in the upper middle. */
function pixels(size = SIZE, level = 210) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = (u - 0.5) / 0.30, dy = (v - 0.42) / 0.34;
      const v0 = Math.hypot(dx, dy) < 1 ? level : 30;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v0; data[i + 3] = 255;
    }
  }
  return data;
}

const opened = [];        // every src the browser was asked for, in order
let serveFiles = new Set();   // src values that "exist"; everything else 404s

class FakeImage {
  constructor() { this.naturalWidth = 1200; this.naturalHeight = 1500; this.width = 1200; this.height = 1500; }
  set src(v) {
    this._src = v;
    opened.push(v);
    queueMicrotask(() => {
      if (serveFiles.has(v)) this.onload && this.onload();
      else this.onerror && this.onerror();
    });
  }
  get src() { return this._src; }
}

/* The field's drawing surface: every method js/field.js touches, plus the
   getImageData the portrait loader reads back. */
function context2d() {
  return {
    fillStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over',
    beginPath() {}, rect() {}, fill() {}, fillRect() {}, clearRect() {}, setTransform() {},
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, arc() {}, closePath() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() {},
    getImageData: () => ({ data: pixels() })
  };
}
const ctx2d = context2d();

const realCreate = dom.document.createElement.bind(dom.document);
dom.document.createElement = tag => tag === 'canvas'
  ? { width: 0, height: 0, getContext: () => ctx2d }
  : realCreate(tag);
Object.defineProperty(globalThis, 'Image', { value: FakeImage, writable: true, configurable: true });

/* ------------------------------------------------------------- the field */

const fieldCanvas = {
  width: 1200, height: 700, style: {},
  getContext: () => context2d(),
  getBoundingClientRect: () => ({ width: 1200, height: 700, top: 0, left: 0 })
};

const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));

const { bus } = await import('../js/bus.js');
const { PHOTO_SOURCES } = await import('../js/portrait.js');

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

/* Each scenario needs its own field: the shape cache is per-module-instance, and
   a cached portrait from an earlier test would quietly satisfy a later one.
   Importing with a fresh query string gives a clean instance while still
   sharing the event bus, which is what we want to observe through. */
let caseNo = 0;
async function newField() {
  const { field } = await import(`../js/field.js?scenario=${++caseNo}`);
  field.init(fieldCanvas);
  return field;
}

/** Drive one setShape('portrait') and collect everything it announced. */
async function ink(field) {
  const events = [];
  const off = bus.on('art', e => events.push(e));
  field.setShape('portrait', null);
  await settle();
  off();
  return events;
}

/* ---------------------------------------------------------------- tests */

test('portrait-boot: a photograph on disk is inked and handed to the field', async () => {
  serveFiles = new Set(['./assets/jayesh.jpg']);
  opened.length = 0;

  const events = await ink(await newField());
  assert.equal(events.length, 1, `expected exactly one art event, got ${events.length}`);
  const [event] = events;
  assert.equal(event.name, 'portrait');
  assert.equal(event.src, './assets/jayesh.jpg', 'it should use the first source that exists');
  assert.ok(event.points > 500, `only ${event.points} particles came through — the field would show a smudge`);
  assert.ok(event.points < SIZE * SIZE, 'more particles than the sampling budget allowed');

  assert.deepEqual(opened, ['./assets/jayesh.jpg'], 'it kept probing after a hit');
  assert.deepEqual(errors, [], errors.map(String).join('\n'));
});

test('portrait-boot: an inked photograph is not sampled a second time', async () => {
  /* Scroll back to the hero and setShape runs again. Decoding + halftoning on
     every scene change would stutter exactly when the page is moving. */
  serveFiles = new Set(['./assets/jayesh.jpg']);
  const field = await newField();
  opened.length = 0;
  await ink(field);
  assert.deepEqual(opened, ['./assets/jayesh.jpg'], 'the first pass should have read the file');
  opened.length = 0;
  await ink(field);
  assert.deepEqual(opened, [], 'the photograph was re-decoded after it was already inked');
});

test('portrait-boot: it tries every candidate before giving up', async () => {
  serveFiles = new Set();                       // nothing on disk at all
  opened.length = 0;
  const events = await ink(await newField());
  assert.deepEqual(events, [], 'art was announced for a photograph that does not exist');
  assert.deepEqual(opened, PHOTO_SOURCES, 'it did not work through the whole candidate list');
  assert.deepEqual(errors, [], errors.map(String).join('\n'));
});

test('portrait-boot: a late candidate still wins', async () => {
  /* Only assets/headshot.png exists. That is the last candidate, so the loader
     has to survive fourteen 404s and still produce a portrait. */
  const last = PHOTO_SOURCES[PHOTO_SOURCES.length - 1];
  serveFiles = new Set([last]);
  opened.length = 0;
  const events = await ink(await newField());
  assert.equal(events.length, 1, 'a photograph at the end of the list was never found');
  assert.equal(events[0].src, last);
  assert.equal(opened[opened.length - 1], last);
  assert.equal(opened.length, PHOTO_SOURCES.length, 'it stopped early');
});

test('portrait-boot: a decoder that throws does not take the page with it', async () => {
  /* Some browsers refuse getImageData on a canvas holding a cross-origin or
     exotic image. That must degrade to "no portrait", never to a dead page. */
  serveFiles = new Set(['./assets/jayesh.jpg']);
  const real = ctx2d.getImageData;
  ctx2d.getImageData = () => { throw new Error('tainted canvas'); };
  try {
    const events = await ink(await newField());
    assert.deepEqual(events, [], 'art was announced from a canvas that could not be read');
    assert.deepEqual(errors, [], errors.map(String).join('\n'));
  } finally {
    ctx2d.getImageData = real;
  }
});

test('portrait-boot: the inked shape is the photograph, not a default', async () => {
  /* Guards the wiring itself: if setShape silently kept the previous scene's
     shape, the field would still animate — just not as a face. The sampled
     points must therefore carry the subject's silhouette. */
  const { loadPortrait } = await import('../js/portrait.js');
  const res = await loadPortrait({ sources: ['./assets/jayesh.jpg'], size: SIZE, step: 2 });
  assert.ok(res, 'loadPortrait returned nothing for a photograph that exists');
  assert.equal(res.aspect, 1, 'the sampled square must be square');
  assert.equal(res.size, SIZE);

  /* the synthetic subject is a bright disc at (0.5, 0.42); dots outside it are
     almost all falloff, so the mass should sit where the subject is */
  const inDisc = res.pts.filter(p => Math.hypot((p.u - 0.5) / 0.30, (p.v - 0.42) / 0.34) < 0.9).length;
  assert.ok(inDisc / res.pts.length > 0.6, `only ${((inDisc / res.pts.length) * 100).toFixed(0)}% of dots are on the subject`);
});

test('portrait-boot: the field stays usable when the portrait never arrives', async () => {
  serveFiles = new Set(['./assets/jayesh.jpg']);
  const field = await newField();
  await ink(field);
  assert.doesNotThrow(() => field.setShape('spark', null));
  await settle(40);
  assert.deepEqual(errors, [], errors.map(String).join('\n'));
  assert.doesNotThrow(() => field.setShape('portrait', null));
  assert.doesNotThrow(() => field.start());
  assert.doesNotThrow(() => field.stop());
});
