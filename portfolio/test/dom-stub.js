/* ============================================================================
   test/dom-stub.js — a deliberately forgiving fake DOM.

   There is no browser in CI here, so the app's boot path is exercised against
   this stub: every element is a Proxy that answers any property with another
   stub, so the modules run end-to-end and real mistakes (typos, calling a
   function that doesn't exist, reading a variable before it's declared) throw,
   while missing browser APIs simply no-op.
   ========================================================================== */

const listeners = [];

function makeEl(tag = 'div') {
  const store = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    childNodes: [],
    children: [],
    dataset: {},
    style: new Proxy({ setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } }, {
      get: (t, k) => (k in t ? t[k] : ''),
      set: (t, k, v) => (t[k] = v, true)
    }),
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); }
    },
    hidden: false,
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    width: 300,
    height: 150
  };

  const api = {
    ...store,
    appendChild(c) { store.childNodes.push(c); return c; },
    append(...c) { store.childNodes.push(...c); },
    prepend(...c) { store.childNodes.unshift(...c); },
    removeChild(c) { store.childNodes = store.childNodes.filter(x => x !== c); },
    remove() {},
    // write through the proxy (api spread copies primitives, so store is stale)
    insertAdjacentHTML(pos, html) { this.innerHTML = (this.innerHTML || '') + html; return this.innerHTML; },
    setAttribute(k, v) { store[k] = String(v); if (k.startsWith('data-')) store.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
    getAttribute(k) { return store[k] != null ? String(store[k]) : null; },
    hasAttribute(k) { return store[k] != null; },
    removeAttribute(k) { delete store[k]; },
    addEventListener(t, fn) { listeners.push([store, t, fn]); },
    removeEventListener() {},
    dispatchEvent(e) { listeners.filter(([, t]) => t === e.type).forEach(([, , fn]) => fn(e)); return true; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 1200, bottom: 700, width: 1200, height: 700, x: 0, y: 0 }; },
    scrollIntoView() {},
    focus() {},
    blur() {},
    click() {},
    cloneNode() { return makeEl(tag); },
    getContext() { return null; },                 // no canvas backend → field/grain degrade
    toDataURL() { return ''; },
    animate() { return { finished: Promise.resolve(), cancel() {} }; },
    offsetWidth: 100,
    offsetHeight: 100
  };

  return new Proxy(api, {
    get(t, k) {
      if (k === 'parentElement') return t._parent || (t._parent = makeEl('div'));
      if (k in t) return t[k];
      if (k === 'then') return undefined;          // don't look like a promise
      if (typeof k === 'symbol') return undefined;
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

class IO {
  constructor(fn) { this.fn = fn; this.els = []; }
  observe(el) { this.els.push(el); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

export function installDOM() {
  const html = makeEl('html');
  const body = makeEl('body');
  const head = makeEl('head');

  const registry = new Map();
  const qAll = new Map();

  /* fixtures: enough real structure for boot() to walk (hero split, art inject,
     field scene wiring, reveals) instead of iterating empty arrays */
  const chaosBtn = makeEl('button');
  chaosBtn.setAttribute('data-chaos', '');
  chaosBtn.textContent = 'little';
  const h1 = makeEl('h1');
  h1.setAttribute('data-split', '');
  h1.setAttribute('data-chaos-word', 'little');
  h1.childNodes.push(
    { nodeType: 3, textContent: 'Serious code. Curious mind. A ' },
    chaosBtn,
    { nodeType: 3, textContent: ' chaos.' }
  );
  const stage = makeEl('div');
  stage.dataset.art = 'spark';
  const scene = makeEl('section');
  scene.dataset.shape = 'spark';
  scene.querySelector = sel => (sel === '.stage' ? stage : makeEl());
  const wipe = makeEl('h2');
  const reveal = makeEl('p');
  const spy = makeEl('a');
  qAll.set('[data-split]', [h1]);
  qAll.set('.stage[data-art]', [stage]);
  qAll.set('[data-shape]', [scene]);
  qAll.set('[data-wipe]', [wipe]);
  qAll.set('.reveal', [reveal]);
  qAll.set('[data-chaos]', [chaosBtn]);
  qAll.set('[data-spy]', [spy]);
  qAll.set('[data-magnet]', []);
  qAll.set('.stage', [stage]);
  qAll.set('a[href^="#"]', []);

  html.scrollHeight = 6000;

  const document = {
    readyState: 'complete',
    documentElement: html,
    body,
    head,
    hidden: false,
    activeElement: body,
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
    createElement: t => makeEl(t),
    createDocumentFragment: () => makeEl('fragment'),
    createTextNode: t => ({ nodeType: 3, textContent: t }),
    querySelector(sel) {
      if (!registry.has(sel)) registry.set(sel, makeEl(sel.replace(/[^a-z0-9]/gi, '') || 'div'));
      return registry.get(sel);
    },
    querySelectorAll(sel) { return qAll.get(sel) || []; },
    getElementById(id) { return document.querySelector('#' + id); },
    addEventListener() {},
    removeEventListener() {}
  };

  const win = {
    document,
    innerWidth: 1280,
    innerHeight: 800,
    scrollY: 0,
    devicePixelRatio: 2,
    location: { href: 'http://localhost/', hash: '' },
    history: { replaceState() {}, pushState() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() }, vibrate: () => true, userAgent: 'node' },
    matchMedia: q => ({ matches: /hover: hover/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: fn => setTimeout(() => fn(performance.now()), 8),
    cancelAnimationFrame: id => clearTimeout(id),
    requestIdleCallback: fn => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), 1),
    scrollTo() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    IntersectionObserver: IO,
    ResizeObserver: IO,
    performance,
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); }
    }
  };

  const g = globalThis;
  /* some Node globals (navigator, performance) are getter-only — defineProperty
     them instead of assigning, and never let a stub failure hide a real one */
  const define = (k, v) => {
    try { Object.defineProperty(g, k, { value: v, writable: true, configurable: true, enumerable: false }); }
    catch (e) { console.error(`dom-stub: could not install global ${k}: ${e.message}`); }
  };
  for (const [k, v] of Object.entries(win)) define(k, v);
  define('window', win);
  define('self', win);
  define('globalThis_scrollY', 0);
  define('scrollY', 0);
  define('scrollX', 0);
  define('Path2D', class { constructor(d) { this.d = d; } });
  define('Image', class { set src(v) { this._src = v; } get src() { return this._src; } });

  return { window: win, document, html, body, registry, qAll, listeners, h1, stage, scene, chaosBtn };
}
