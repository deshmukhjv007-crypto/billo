/* ============================================================================
   photo.js — where the portrait comes from.

   Kept in its own module (rather than inline in build.js) because two callers
   need the same answer: build.js, to render it, and the page tests, to assert
   that a photo which exists on disk actually reaches the markup. Node-only —
   content.js is imported by the browser, so fs can't live there.

   Drop a photo at assets/jayesh.jpg (or photo/portrait/me, .jpg/.jpeg/.png/
   .webp/.avif) and every build picks it up. Nothing needed if you'd rather
   name the file yourself: set PERSON.photo in resume.js.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';

/** File stems tried, in order, when PERSON.photo is not set. */
export const PHOTO_STEMS = ['jayesh', 'photo', 'portrait', 'me', 'headshot'];
export const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];

/**
 * @param {string} root        directory of the site (build.js's own folder)
 * @param {string|null} explicit  PERSON.photo, e.g. './assets/Jayesh-2026.jpg'
 * @returns {string|null} a site-relative URL ("./assets/…"), or null
 */
export function findPhoto(root, explicit = null) {
  const candidates = [];
  if (explicit) candidates.push(path.join(root, String(explicit).replace(/^\.\//, '')));
  for (const stem of PHOTO_STEMS) {
    for (const ext of PHOTO_EXTS) candidates.push(path.join(root, 'assets', `${stem}.${ext}`));
  }
  for (const file of candidates) {
    try {
      if (fs.statSync(file).isFile()) return './' + path.relative(root, file).split(path.sep).join('/');
    } catch { /* not there — keep looking */ }
  }
  return null;
}
