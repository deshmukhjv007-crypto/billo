/* ============================================================================
   js/photo-names.js — where to look for the photograph.

   Pure data, no `node:fs` and no DOM, so it is importable from everywhere:
   photo.js uses it to search the disk at build time, js/portrait.js uses it to
   build the browser's <img> candidate list, and the tests use it to check the
   two still agree.

   That sharing is the point. These lists were duplicated once and drifted
   immediately — the build found jayesh.jpeg while the browser only ever tried
   jayesh.jpg — which produced a site that reported a photo and then rendered
   the monogram anyway.
   ========================================================================== */

/** Filenames to try, in order of likelihood. The first is the documented one. */
export const PHOTO_STEMS = ['jayesh', 'photo', 'portrait', 'me', 'headshot'];

/** Extensions to try, in order. jpg first: it is what phones produce. */
export const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

/**
 * Every candidate URL for a photo, in search order.
 * @param {string} base  public directory holding the assets, e.g. './assets'
 */
export function photoSources(base = './assets') {
  const out = [];
  for (const stem of PHOTO_STEMS) {
    for (const ext of PHOTO_EXTS) out.push(`${base}/${stem}.${ext}`);
  }
  return out;
}
