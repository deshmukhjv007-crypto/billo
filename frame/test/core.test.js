import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzePixels,
  cropRect,
  lumaDiff,
  sharpness,
  suggestedExposure,
} from "../public/analysis.js";
import {
  CAMERA_CONSENT_KEY,
  decideCameraStart,
  describeCameraState,
} from "../public/permission.js";
import { server } from "../server.js";
const pixels = (...rgb) =>
  new Uint8ClampedArray(rgb.flatMap((v) => [v, v, v, 255]));
test("empty input is safe", () => {
  assert.equal(analyzePixels([]).score, 0);
});
test("black frames report darkness and bounded score", () => {
  const result = analyzePixels(pixels(0, 0, 0));
  assert.equal(result.luminance, 0);
  assert.equal(result.shadows, 1);
  assert.equal(result.highlights, 0);
  assert.ok(result.score >= 0);
  assert.equal(suggestedExposure(result), 0.3);
});
test("white frames report clipped highlights", () => {
  const result = analyzePixels(pixels(255, 255));
  assert.equal(result.highlights, 1);
  assert.equal(result.shadows, 0);
  assert.equal(suggestedExposure(result), -0.3);
});
test("ordinary midtones are not automatically normalised to a fixed brightness", () => {
  for (const level of [60, 85, 120, 170, 220])
    assert.equal(suggestedExposure(analyzePixels(pixels(level))), 0);
});
test("highlights take priority over raising a dark average", () => {
  assert.equal(suggestedExposure({ luminance: 0.1, highlights: 0.2 }), -0.3);
});
test("luminance uses weighted RGB channels", () => {
  const red = analyzePixels(new Uint8ClampedArray([255, 0, 0, 255]));
  assert.ok(Math.abs(red.luminance - 0.2126) < 0.00001);
});
test("contrast is zero for flat pixels and positive for mixed light", () => {
  assert.equal(analyzePixels(pixels(128, 128)).contrast, 0);
  assert.ok(analyzePixels(pixels(10, 240)).contrast > 0.4);
});
test("all ratios produce centered crops within source bounds", () => {
  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
    [100, 100],
  ])
    for (const ratio of [1, 4 / 3, 3 / 2, 16 / 9]) {
      const r = cropRect(w, h, ratio);
      assert.ok(Math.abs(r.width / r.height - ratio) < 0.00001);
      assert.ok(r.x >= 0 && r.y >= 0);
      assert.ok(r.x + r.width <= w + 0.00001);
      assert.ok(r.y + r.height <= h + 0.00001);
    }
});
test("server serves app and blocks invalid paths", async (t) => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Your pocket photographer/);
  const css = await fetch(base + "/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const js = await fetch(base + "/analysis.js");
  assert.match(js.headers.get("content-type"), /javascript/);
  const manifest = await fetch(base + "/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get("content-type"), /manifest\+json/);
  assert.match(await manifest.text(), /Prolens/);
  const sw = await fetch(base + "/sw.js");
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("content-type"), /javascript/);
  assert.match(sw.headers.get("cache-control"), /no-cache/);
  const icon = await fetch(base + "/icons/icon-192.png");
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type"), /image\/png/);
  for (const file of ["/ambient.js", "/permission.js"]) {
    const res = await fetch(base + file);
    assert.equal(res.status, 200, file + " should be served");
    assert.match(res.headers.get("content-type"), /javascript/);
  }
  assert.equal((await fetch(base + "/assets/demo-scene.jpg")).status, 404);
  assert.equal((await fetch(base + "/missing")).status, 404);
  assert.equal((await fetch(base + "/%2e%2e%2fpackage.json")).status, 403);
  assert.equal((await fetch(base + "/%FF")).status, 404);
});

test('light check does not prefer a single midtone brightness', () => {
  const scores = [60, 85, 120, 170, 220].map(value => analyzePixels(pixels(value)).score);
  assert.equal(new Set(scores).size, 1);
});
test("lumaDiff is zero for identical frames and positive for moved ones", () => {
  const a = new Float32Array(48 * 36).fill(0.5);
  const b = new Float32Array(a);
  assert.equal(lumaDiff(a, b), 0);
  const moved = new Float32Array(a);
  for (let i = 0; i < moved.length; i++) moved[i] = (i % 2 ? 0.2 : 0.8);
  assert.ok(lumaDiff(a, moved) > 0.3);
  assert.equal(lumaDiff([], []), 0);
});
test("sharpness is zero for flat frames and higher for detailed ones", () => {
  const flat = new Float32Array(96 * 72).fill(0.5);
  assert.equal(sharpness(flat, 96, 72), 0);
  const edge = new Float32Array(96 * 72);
  for (let y = 0; y < 72; y++)
    for (let x = 0; x < 96; x++) edge[y * 96 + x] = x % 8 < 4 ? 0 : 1;
  assert.ok(sharpness(edge, 96, 72) > 0.1);
  assert.equal(sharpness(null, 96, 72), 0);
});

test("camera consent: the first run asks, later runs never prompt again", () => {
  const base = { supported: true, secure: true };
  // Very first launch: one request, which is the one browser prompt.
  assert.equal(
    decideCameraStart({ ...base, permission: "prompt", consent: null, intent: null }).mode,
    "first-run",
  );
  // Browser remembers the grant.
  assert.deepEqual(
    decideCameraStart({ ...base, permission: "granted", consent: true, intent: "on" }),
    { mode: "auto", silent: true, reason: "permission-granted" },
  );
  // Browser does not expose permission state (Safari) but the user allowed it.
  assert.deepEqual(
    decideCameraStart({ ...base, permission: "unknown", consent: true, intent: "on" }),
    { mode: "auto", silent: true, reason: "consent-remembered" },
  );
});

test("camera consent: a refusal is remembered and never retried", () => {
  const base = { supported: true, secure: true };
  const denied = decideCameraStart({
    ...base,
    permission: "denied",
    consent: false,
    intent: "on",
  });
  assert.equal(denied.mode, "blocked");
  assert.equal(denied.silent, false);
  // Consent alone (browser does not report permission) is enough to stay blocked.
  assert.equal(
    decideCameraStart({ ...base, permission: "unknown", consent: false }).mode,
    "blocked",
  );
});

test("camera consent: the user's own off switch wins, and frames never auto-prompt", () => {
  const base = { supported: true, secure: true };
  assert.equal(
    decideCameraStart({ ...base, permission: "granted", consent: true, intent: "off" })
      .mode,
    "tap",
  );
  // Embedded previews get a session-scoped grant: do not consume the one prompt.
  assert.equal(
    decideCameraStart({
      ...base,
      permission: "prompt",
      consent: null,
      embedded: true,
    }).mode,
    "tap",
  );
});

test("camera consent: unsupported and insecure contexts are named, not attempted", () => {
  assert.equal(decideCameraStart({ supported: false }).mode, "unsupported");
  assert.equal(decideCameraStart({ secure: false }).mode, "insecure");
  // A secure context with an already-granted permission still connects.
  assert.equal(decideCameraStart({ secure: true, permission: "granted" }).mode, "auto");
});

test("camera state wording matches the remembered consent", () => {
  assert.equal(describeCameraState({ permission: "granted" }).key, "granted");
  assert.equal(describeCameraState({ consent: true }).key, "granted");
  assert.equal(describeCameraState({ consent: false }).key, "blocked");
  assert.equal(describeCameraState({}).key, "prompt");
  assert.equal(CAMERA_CONSENT_KEY, "frame-camera-consent");
});
