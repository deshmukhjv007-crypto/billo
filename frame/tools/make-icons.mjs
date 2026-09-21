/* Regenerates the Prolens app icons — the only build step in this project.
 *
 *   node tools/make-icons.mjs
 *
 * Icons are drawn procedurally (rounded panel, cyan→violet focus brackets and
 * an aperture dot) and written straight to public/icons/ as PNGs using Node's
 * own zlib — no image libraries, no network, no binary sources in the repo.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(fileURLToPath(new URL("../public/icons/", import.meta.url)));
const SS = 3; // supersampling factor

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const CYAN = hex("#4dd8ff");
const VIOLET = hex("#8b7bff");
const DEEP = hex("#04070d");
const PANEL_TOP = hex("#0a1727");

/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(x, y, hw, hh, r) {
  const qx = Math.abs(x) - hw + r;
  const qy = Math.abs(y) - hh + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}

/** Distance from a point to a line segment (unsigned). */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

function over(dst, i, rgb, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  for (let c = 0; c < 3; c++)
    dst[i + c] = Math.round(dst[i + c] * (1 - a) + rgb[c] * 255 * a);
  dst[i + 3] = Math.round(dst[i + 3] * (1 - a) + 255 * a);
}

/**
 * Draws the mark in a 40×40 design space, mapped onto a size×size bitmap.
 * `inset` shrinks the mark so maskable icons keep their content in the
 * platform's safe zone.
 */
function render(size, { maskable = false } = {}) {
  const data = new Uint8ClampedArray(size * size * 4);
  const unit = size / 40;
  const scale = maskable ? 0.74 : 0.96;
  const panel = 40 * scale * 0.5; // half-extent of the rounded panel
  const cx = 20;
  const cy = 20;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 4;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / unit - cx;
          const y = (py + (sy + 0.5) / SS) / unit - cy;
          const t = Math.min(1, Math.max(0, (x + y + 20) / 40));
          const grad = [lerp(CYAN[0], VIOLET[0], t), lerp(CYAN[1], VIOLET[1], t), lerp(CYAN[2], VIOLET[2], t)];
          let px4 = [DEEP[0] * 255, DEEP[1] * 255, DEEP[2] * 255, 0];

          const d = sdRoundRect(x, y, panel, panel, 5.4 * scale);
          if (maskable && d < 0) px4 = [PANEL_TOP[0] * 255, PANEL_TOP[1] * 255, PANEL_TOP[2] * 255, 255];
          if (d < 0) {
            // Panel fill: subtle vertical lift from deep navy to near-black.
            const lift = Math.min(1, Math.max(0, (-y + panel) / (panel * 2)));
            const base = [
              lerp(PANEL_TOP[0], DEEP[0], lift) * 255,
              lerp(PANEL_TOP[1], DEEP[1], lift) * 255,
              lerp(PANEL_TOP[2], DEEP[2], lift) * 255,
            ];
            px4 = [...base, 255];
            // Hairline inner border.
            const ring = Math.min(
              1,
              Math.max(0, (0.42 * scale - Math.abs(d + 0.24)) * unit * SS),
            );
            if (ring > 0)
              px4 = [
                lerp(px4[0], grad[0] * 255, ring * 0.8),
                lerp(px4[1], grad[1] * 255, ring * 0.8),
                lerp(px4[2], grad[2] * 255, ring * 0.8),
                255,
              ];
          }

          // Focus brackets (same geometry as the in-app brand mark).
          const w = 1.35 * scale;
          const arm = 3.1 * scale;
          const off = 6.6 * scale;
          let stroke = Infinity;
          for (const [ax, ay, bx, by] of [
            [-off, -off, -off + arm, -off],
            [-off, -off, -off, -off + arm],
            [off, -off, off - arm, -off],
            [off, -off, off, -off + arm],
            [-off, off, -off + arm, off],
            [-off, off, -off, off - arm],
            [off, off, off - arm, off],
            [off, off, off, off - arm],
          ])
            stroke = Math.min(stroke, sdSegment(x, y, ax, ay, bx, by));
          // Aperture ring.
          const ringR = 3.3 * scale;
          const ring = Math.abs(Math.hypot(x, y) - ringR);

          const strokeAlpha = Math.min(1, Math.max(0, (w - stroke) * unit * SS));
          const ringAlpha = Math.min(1, Math.max(0, (w * 0.82 - ring) * unit * SS));
          const alpha = Math.max(strokeAlpha, ringAlpha);
          if (alpha > 0)
            px4 = [
              lerp(px4[0], grad[0] * 255, alpha),
              lerp(px4[1], grad[1] * 255, alpha),
              lerp(px4[2], grad[2] * 255, alpha),
              Math.max(px4[3], Math.round(255 * alpha)),
            ];

          r += px4[0];
          g += px4[1];
          b += px4[2];
          a += px4[3];
        }
      const n = SS * SS;
      data[idx] = Math.round(r / n);
      data[idx + 1] = Math.round(g / n);
      data[idx + 2] = Math.round(b / n);
      data[idx + 3] = Math.round(a / n);
    }
  }
  return data;
}

/* ---------- Minimal PNG encoder (RGBA, filter 0) ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}
function encodePng(data, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
]) {
  const png = encodePng(render(size, { maskable }), size);
  writeFileSync(path.join(OUT, name), png);
  console.log(`${name}: ${size}×${size}, ${(png.length / 1024).toFixed(1)} KB`);
}
