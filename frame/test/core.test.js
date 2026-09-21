import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzePixels,
  cropRect,
  suggestedExposure,
} from "../public/analysis.js";
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
  assert.equal((await fetch(base + "/missing")).status, 404);
  assert.equal((await fetch(base + "/%2e%2e%2fpackage.json")).status, 403);
  assert.equal((await fetch(base + "/%FF")).status, 404);
});

test('light check does not prefer a single midtone brightness', () => {
  const scores = [60, 85, 120, 170, 220].map(value => analyzePixels(pixels(value)).score);
  assert.equal(new Set(scores).size, 1);
});
