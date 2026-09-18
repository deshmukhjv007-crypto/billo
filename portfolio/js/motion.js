/* ============================================================================
   motion.js — one rAF loop for everything that moves.

   hire.rest pulls in GSAP + ScrollTrigger + Lenis (≈90 kB of CDN JS) to do
   scrubbing and smooth wheel. This does the same jobs in ~250 lines with zero
   dependencies, and — deliberately — does NOT hijack the wheel by default.
   Native scroll stays native: trackpad momentum, find-in-page, scroll
   restoration, assistive tech and browser zoom all keep working. Smooth wheel
   is a toggle for people who want the Lenis feel (press S, or the lab switch).
   ========================================================================== */

import { bus, state } from './bus.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

let smooth = false;          // wheel hijack, off by default
let virtualY = 0;            // where smooth scroll wants to be
let maxScroll = 1;
let lastY = 0, lastT = 0, burst = 0, lastSet = -1;
let ticking = false;

const scrubbed = [];         // {el, start, end, apply(p)}

export const motion = {
  init() {
    lastY = state.y = window.scrollY;
    lastT = performance.now();
    maxScroll = document.documentElement.scrollHeight - innerHeight;

    /* ---------- pointer ---------- */
    let plx = 0, ply = 0, plt = 0;
    const onPointer = e => {
      const now = performance.now();
      const dt = Math.max(1, now - plt);
      const dx = e.clientX - plx, dy = e.clientY - ply;
      state.pointer.vx = dx / dt * 1000;
      state.pointer.vy = dy / dt * 1000;
      state.pointer.speed = clamp(Math.hypot(state.pointer.vx, state.pointer.vy) / 2600, 0, 1);
      state.pointer.x = e.clientX; state.pointer.y = e.clientY;
      plx = e.clientX; ply = e.clientY; plt = now;
      const hint = document.querySelector('.hint');
      if (hint) hint.classList.add('gone');
      document.documentElement.style.setProperty('--mx', e.clientX + 'px');
      document.documentElement.style.setProperty('--my', e.clientY + 'px');
    };
    addEventListener('pointermove', e => { if (e.pointerType !== 'touch') onPointer(e); }, { passive: true });
    addEventListener('pointerdown', e => onPointer(e), { passive: true });
    addEventListener('pointerleave', () => { state.pointer.x = state.pointer.y = -1e5; });
    addEventListener('touchstart', e => { const t = e.touches[0]; if (t) onPointer(t); }, { passive: true });
    addEventListener('touchmove', e => { const t = e.touches[0]; if (t) onPointer(t); state.pointer.speed = 0.35; }, { passive: true });
    addEventListener('touchend', () => { state.pointer.x = state.pointer.y = -1e5; });

    /* ---------- reveals ---------- */
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));

    /* ---------- header shadow ---------- */
    const top = document.querySelector('.top');
    if (top) {
      const sentinel = document.createElement('div');
      sentinel.style.cssText = 'position:absolute;top:76px;left:0;width:1px;height:1px;pointer-events:none';
      document.body.prepend(sentinel);
      new IntersectionObserver(([e]) => top.classList.toggle('scrolled', !e.isIntersecting)).observe(sentinel);
    }

    /* ---------- scrubbed values ---------- */
    const rail = document.querySelector('.rail i');
    if (rail) scrubbed.push({
      run() {
        const p = clamp(state.y / Math.max(1, maxScroll), 0, 1);
        rail.style.transform = `scaleY(${p.toFixed(4)})`;
      }
    });

    const heroCopy = document.querySelector('.hero .copy');
    if (heroCopy) scrubbed.push({
      run() {
        const p = clamp((state.y - innerHeight * 0.15) / (innerHeight * 0.8), 0, 1);
        heroCopy.style.transform = `translate3d(0,${(-p * 46).toFixed(2)}px,0)`;
        heroCopy.style.opacity = (1 - p * 0.9).toFixed(3);
      }
    });

    const timeline = document.querySelector('.timeline');
    if (timeline) scrubbed.push({
      run() {
        const r = timeline.getBoundingClientRect();
        const p = clamp((innerHeight * 0.78 - r.top) / Math.max(1, r.height * 0.86), 0, 1);
        timeline.style.setProperty('--fill', p.toFixed(4));
      }
    });

    document.querySelectorAll('[data-wipe]').forEach(el => scrubbed.push({
      run() {
        const r = el.getBoundingClientRect();
        const p = clamp((innerHeight * 0.92 - r.top) / (innerHeight * 0.5), 0, 1);
        el.style.setProperty('--wipe', p.toFixed(4));
      }
    }));

    /* ---------- scroll spy ---------- */
    const links = [...document.querySelectorAll('[data-spy]')];
    if (links.length) {
      const map = new Map(links
        .filter(a => a.tagName === 'A' && a.getAttribute('href'))
        .map(a => [a.getAttribute('href').slice(1), a]));
      const spy = new IntersectionObserver(entries => {
        for (const e of entries) {
          const a = map.get(e.target.id);
          if (!a) continue;
          if (e.isIntersecting) { links.forEach(l => l.classList.remove('on')); a.classList.add('on'); }
        }
      }, { rootMargin: '-45% 0px -50% 0px' });
      [...map.keys()].forEach(id => { const el = document.getElementById(id); if (el) spy.observe(el); });
    }

    /* ---------- magnetic buttons ---------- */
    if (state.fine && !state.reduce) {
      document.querySelectorAll('[data-magnet]').forEach(el => {
        const R = Number(el.dataset.magnet) || 130;
        const host = el.closest('[data-magnet-host]') || el.parentElement;
        host.addEventListener('pointermove', e => {
          const r = el.getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2);
          const dy = e.clientY - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy);
          el.style.transform = d < R
            ? `translate3d(${(dx * (1 - d / R) * 0.38).toFixed(2)}px,${(dy * (1 - d / R) * 0.38).toFixed(2)}px,0)`
            : '';
        }, { passive: true });
        host.addEventListener('pointerleave', () => { el.style.transform = ''; }, { passive: true });
      });
    }

    /* ---------- contact glow ---------- */
    const glow = document.querySelector('.glow');
    const contact = document.querySelector('.contact');
    if (glow && contact) {
      let gx = 0.3, gy = 0.3, tx = 0.3, ty = 0.3, live = false;
      const t0 = performance.now();
      const loop = now => {
        if (!live) return;
        const t = (now - t0) / 1000;
        if (!state.fine) { tx = 0.5 + Math.cos(t * 0.31) * 0.34; ty = 0.5 + Math.sin(t * 0.24) * 0.3; }
        gx = lerp(gx, tx, 0.06); gy = lerp(gy, ty, 0.06);
        const r = contact.getBoundingClientRect();
        glow.style.transform = `translate3d(${(gx * r.width - r.width * 0.3).toFixed(1)}px,${(gy * r.height - r.height * 0.3).toFixed(1)}px,0)`;
        requestAnimationFrame(loop);
      };
      new IntersectionObserver(([e]) => { live = e.isIntersecting; if (live) requestAnimationFrame(loop); }).observe(contact);
      contact.addEventListener('pointermove', e => {
        if (!state.fine) return;
        const r = contact.getBoundingClientRect();
        tx = (e.clientX - r.left) / r.width; ty = (e.clientY - r.top) / r.height;
      }, { passive: true });
    }

    /* ---------- chaos ---------- */
    document.querySelectorAll('[data-chaos]').forEach(el => {
      el.addEventListener('click', () => {
        burst = 1;
        bus.emit('burst', 30);
        el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
        if (navigator.vibrate) navigator.vibrate(28);
      });
    });
    document.querySelectorAll('.stage').forEach(el =>
      el.addEventListener('pointerdown', () => { burst = 0.8; bus.emit('burst', 22); }));

    /* ---------- anchors ---------- */
    document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      scrollToEl(el);
      history.replaceState(null, '', id);
    }));

    addEventListener('resize', () => { maxScroll = document.documentElement.scrollHeight - innerHeight; }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { ticking = false; }
      else if (!ticking) { ticking = true; lastT = performance.now(); requestAnimationFrame(tick); }
    });

    /* reduced motion: leave every scrubbed custom property at its CSS default
       (--wipe:1, --fill:1) instead of writing 0 into them from JS */
    if (!state.reduce) { ticking = true; requestAnimationFrame(tick); }
    return this;
  },

  get smooth() { return smooth; },
  setSmooth(on) {
    smooth = !!on && !state.reduce && state.fine;
    document.documentElement.classList.toggle('smooth', smooth);
    if (smooth) { virtualY = window.scrollY; }
    return smooth;
  },
  toggleSmooth() { return motion.setSmooth(!smooth); },
  scrollTo: scrollToEl,
  kick(amount = 0.7) { burst = Math.max(burst, amount); bus.emit('burst', 24 * amount); }
};

function scrollToEl(el) {
  const top = el.getBoundingClientRect().top + window.scrollY - 76;
  if (smooth) { virtualY = clamp(top, 0, maxScroll); }
  else window.scrollTo({ top, behavior: state.reduce ? 'auto' : 'smooth' });
}

/* ---------------------------------------------------------------- the loop */
function tick(now) {
  if (!ticking) return;
  const dt = Math.max(1, now - lastT);
  lastT = now;

  /* smooth wheel: lerp the real scroll position toward the virtual one */
  if (smooth) {
    const cur = window.scrollY;
    const next = lerp(cur, virtualY, 1 - Math.pow(0.001, dt / 1000));
    if (Math.abs(virtualY - next) > 0.4) { lastSet = next; window.scrollTo(0, next); }
    else if (Math.abs(virtualY - cur) > 0.4) { lastSet = virtualY; window.scrollTo(0, virtualY); }
  }

  const y = window.scrollY;
  const v = ((y - lastY) / dt) * 1000;
  lastY = y;
  state.y = y;
  state.velocity = v;
  state.speed = clamp(Math.abs(v) / 2600, 0, 1);
  state.pointer.speed *= Math.pow(0.9, dt / 16.7);
  state.burst = burst;
  if (burst > 0.001) burst *= Math.pow(0.86, dt / 16.7); else burst = 0;

  for (const s of scrubbed) s.run && s.run();
  bus.emit('frame', { speed: state.speed, burst, dt, y });

  const idle = Math.abs(v) < 1 && burst === 0 && (!smooth || Math.abs(virtualY - y) < 1);
  if (!idle) requestAnimationFrame(tick);
  else { ticking = false; setTimeout(() => { if (!ticking) { ticking = true; lastT = performance.now(); requestAnimationFrame(tick); } }, 90); }
}

/* keep the loop alive while the user scrolls by other means (keys, scrollbar) */
addEventListener('scroll', () => {
  if (smooth) {
    // an outside scroll (scrollbar drag, find-in-page) re-syncs the target,
    // but our own lerp writes must not be mistaken for one
    if (lastSet < 0 || Math.abs(window.scrollY - lastSet) > 3) virtualY = window.scrollY;
    lastSet = -1;
  }
  if (!ticking) { ticking = true; lastT = performance.now(); requestAnimationFrame(tick); }
}, { passive: true });

/* smooth-wheel hijack — only when the user turns it on */
addEventListener('wheel', e => {
  if (!smooth) return;
  e.preventDefault();
  maxScroll = document.documentElement.scrollHeight - innerHeight;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  virtualY = clamp(virtualY + e.deltaY * unit * 1.05, 0, maxScroll);
  if (!ticking) { ticking = true; lastT = performance.now(); requestAnimationFrame(tick); }
}, { passive: false });

addEventListener('keydown', e => {
  if (!smooth) return;
  const k = e.key;
  const big = { PageDown: innerHeight * 0.9, PageUp: -innerHeight * 0.9, Home: -1e6, End: 1e6 }[k];
  const small = { ArrowDown: 90, ArrowUp: -90 }[k];
  const d = big !== undefined ? big : small;
  if (d === undefined) return;
  e.preventDefault();
  maxScroll = document.documentElement.scrollHeight - innerHeight;
  virtualY = clamp(virtualY + d, 0, maxScroll);
  if (!ticking) { ticking = true; lastT = performance.now(); requestAnimationFrame(tick); }
});
