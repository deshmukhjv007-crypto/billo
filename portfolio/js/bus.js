/* Tiny shared event bus + frame state so there is exactly ONE rAF loop
   driving scroll velocity, pointer speed, grain reactivity and the field. */

const handlers = new Map();

export const bus = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt).delete(fn);
  },
  emit(evt, payload) {
    const set = handlers.get(evt);
    if (set) for (const fn of set) fn(payload);
  }
};

/* Live, always-current values. Written by motion.js, read by grain.js/field.js. */
export const state = {
  y: 0,            // scrollY
  velocity: 0,     // px/s, signed
  speed: 0,        // |velocity| normalised 0..1
  pointer: { x: -1e5, y: -1e5, vx: 0, vy: 0, speed: 0 },
  burst: 0,        // decays; spiked by clicks
  fps: 60,
  fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
  reduce: matchMedia('(prefers-reduced-motion: reduce)').matches
};
