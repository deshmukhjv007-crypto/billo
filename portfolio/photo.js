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

/* The candidate names live in js/photo-names.js, which has no fs import, so the
   browser's own source list in js/portrait.js is built from the very same
   constants. Re-exported here so existing importers keep working. */
export { PHOTO_STEMS, PHOTO_EXTS, photoSources } from './js/photo-names.js';
import { PHOTO_STEMS, PHOTO_EXTS } from './js/photo-names.js';

/**
 * @param {string} root        directory of the site (build.js's own folder)
 * @param {string|null} explicit  PERSON.photo, e.g. './assets/Jayesh-2026.jpg'
 * @returns {string|null} a site-relative URL ("./assets/…"), or null
 */
/* Formats a camera or phone might produce that no browser will decode. Worth
   naming explicitly: the file is sitting right there in assets/, so "no photo
   found" is a baffling answer. */
const UNDECODABLE = ['heic', 'heif', 'dng', 'tif', 'tiff', 'bmp'];
const LOOKS_LIKE_A_PHOTO = [...PHOTO_EXTS, ...UNDECODABLE, 'gif'];

/**
 * Read a photograph's format and pixel dimensions straight from its header.
 *
 * No decoding, no dependencies — just enough to tell somebody their 6 MB phone
 * photo is 4032x3024 when the page needs about 800, and that the square
 * cover-crop is therefore going to take a thin slice of the middle. Reads only
 * the first few KB.
 *
 * @returns {{format:string,width:number,height:number,bytes:number}|null}
 */
export function describePhoto(file) {
  let fd, bytes;
  try {
    bytes = fs.statSync(file).size;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(bytes, 65536));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return { ...parseImageHeader(buf, bytes), bytes };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

function parseImageHeader(b, bytes) {
  /* PNG: 8-byte signature, then IHDR with width/height as big-endian uint32. */
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  /* JPEG: walk the marker segments to the frame header (SOF0..SOF15, skipping
     the four that are not frame headers: DHT/JPG/DAC/DRI = C4/C8/CC/CE). */
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }

  /* WebP: RIFF container. VP8X carries canvas size; VP8 / VP8L are the two
     still formats and store it differently. */
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      return { format: 'webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (kind === 'VP8 ') {
      return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { format: 'webp', width: 0, height: 0 };
  }

  return { format: 'unknown', width: 0, height: 0 };
}

/**
 * Photographs in assets/ that the build will NOT use, and why.
 *
 * Every one of these is a person who has put their picture in the right folder
 * and cannot understand why the site still shows a monogram. Naming the file
 * and the reason turns a silent no-op into a one-line fix.
 *
 * @returns {{file:string, reason:'undecodable'|'unexpected-name'}[]}
 */
export function photoNearMisses(root, explicit = null) {
  const dir = path.join(root, 'assets');
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }

  const wanted = new Set();
  if (explicit) wanted.add(path.basename(String(explicit)));
  for (const stem of PHOTO_STEMS) for (const ext of PHOTO_EXTS) wanted.add(`${stem}.${ext}`);

  const out = [];
  for (const file of entries.sort()) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!LOOKS_LIKE_A_PHOTO.includes(ext)) continue;
    if (wanted.has(file)) continue;
    out.push({ file, reason: UNDECODABLE.includes(ext) ? 'undecodable' : 'unexpected-name' });
  }
  return out;
}

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
