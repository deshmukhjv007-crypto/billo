import {
  analyzePixels,
  lumaDiff,
  sharpness,
  suggestedExposure,
} from "./analysis.js";
import { detectFace, initFaceDetection, faceDetectionFailed } from "./face.js";
const $ = (s) => document.querySelector(s);
const icons = {
  focus: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  image:
    "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M3 17l6-6 4 4 3-3 5 5 M16 7h.01",
  book: "M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v16",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4",
  "chevron-right": "M9 5l7 7-7 7",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  video: "M3 5h12v14H3z M15 9l6-4v14l-6-4",
  grid: "M3 3h18v18H3z M9 3v18m6-18v18M3 9h18M3 15h18",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  sparkles:
    "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4m-2-2h4",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  crop: "M6 2v16h16M2 6h16v16",
  layers: "M12 3l10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5",
  bulb: "M9 18h6m-6 3h6M8 15c-6-5-2-13 4-13s10 8 4 13v2H8z",
  sliders:
    "M4 3v5m0 4v9m8-18v11m0 4v3m8-18v3m0 4v11 M1 8h6v4H1z M9 14h6v4H9z M17 6h6v4h-6z",
  reset: "M3 10a9 9 0 1 1 1 8M3 3v7h7",
  thermometer: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0 M12 8v10",
  zoom: "M15 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M14 15l7 7M6 10h6M9 7v6",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 11v6m0-10h.01",
  close: "M5 5l14 14M5 19L19 5",
  back: "M15 19l-7-7 7-7",
  power: "M12 3v9 M6.3 6.3a8 8 0 1 0 11.4 0",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 19h16",
  trash: "M4 7h16 M10 4h4 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  "switch-camera":
    "M3 8a9 9 0 0 1 16-3l2 3m0-6v6h-6M21 16a9 9 0 0 1-16 3l-2-3m0 6v-6h6",
  moon: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12",
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.focus}"/></svg>`;
function renderIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
renderIcons();
const readStored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
let shots = readStored("frame-shots", []);
if (!Array.isArray(shots)) shots = [];
let prefs = {
  auto: true,
  grid: true,
  burst: true,
  timer: 0,
  ...readStored("frame-prefs", {}),
};
let stream = null,
  facing = "environment",
  source = "demo",
  mode = "Portrait",
  ratioKey = "3:2",
  cameraBusy = false;
const RATIO_PRESETS = [
  { key: "3:2", label: "3:2", val: 3 / 2 },
  { key: "4:3", label: "4:3", val: 4 / 3 },
  { key: "16:9", label: "16:9", val: 16 / 9 },
  { key: "1:1", label: "1:1", val: 1 },
  { key: "Full", label: "Full", val: "full" },
];
function getEffectiveRatio() {
  const preset = RATIO_PRESETS.find((p) => p.key === ratioKey) || RATIO_PRESETS[0];
  if (preset.val === "full") {
    const { W, H } = stageSize();
    return W && H ? W / H : 3 / 2;
  }
  return preset.val;
}
let capabilities = {},
  exposureHardware = false,
  zoomHardware = false,
  tuning = false,
  timer = null,
  latest = null,
  toastTimer;
let manualUntil = 0,
  stableFrames = 0,
  lastTune = 0,
  currentScreen = "camera";
/* Live coach state */
let faceBox = null, // face in stage fractions {fx, fy, fw, fh}
  faceSeenAt = 0,
  faceDetBusy = false,
  faceFailedNotified = false,
  meterPoint = null, // tap-to-meter {fx, fy}
  meterNotified = false,
  steadyEma = 0.01,
  prevLuma = null,
  lastStats = null,
  composite = 86,
  currentHint = "",
  tick = 0,
  countdownActive = false,
  timerCountdown = null;
const stage = $("#stage");
const img = $("#scene-image"),
  video = $("#camera-video");
const analysisCanvas = document.createElement("canvas");
analysisCanvas.width = 128;
analysisCanvas.height = 96;
const analysisContext = analysisCanvas.getContext("2d", {
  willReadFrequently: true,
});
const motionCanvas = document.createElement("canvas");
motionCanvas.width = 48;
motionCanvas.height = 36;
const motionContext = motionCanvas.getContext("2d", {
  willReadFrequently: true,
});
const regionCanvas = document.createElement("canvas");
regionCanvas.width = 64;
regionCanvas.height = 64;
const regionContext = regionCanvas.getContext("2d", {
  willReadFrequently: true,
});
const sharpCanvas = document.createElement("canvas");
sharpCanvas.width = 96;
sharpCanvas.height = 72;
const sharpContext = sharpCanvas.getContext("2d", {
  willReadFrequently: true,
});
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4400);
}
function savePrefs() {
  try {
    localStorage.setItem("frame-prefs", JSON.stringify(prefs));
  } catch {}
}

/* ---------- Screens ---------- */

function showPage(page) {
  currentScreen = page;
  cancelCountdown();
  closeShotViewer();
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `${page}-screen`);
  });
  if (page === "gallery") renderGallery();
  if (page !== "camera") closeSheets();
}
document
  .querySelectorAll("[data-go-camera]")
  .forEach((el) => (el.onclick = () => showPage("camera")));

/* ---------- Sheets ---------- */

const sheetElements = {
  "coach-sheet": $("#coach-sheet"),
  "adjust-sheet": $("#adjust-sheet"),
  "menu-sheet": $("#menu-sheet"),
};
const backdrop = $("#sheet-backdrop");
let openSheetId = null;
function openSheet(id) {
  Object.values(sheetElements).forEach((s) => s.classList.remove("open"));
  sheetElements[id].classList.add("open");
  backdrop.classList.add("open");
  openSheetId = id;
}
function closeSheets() {
  if (!openSheetId) return;
  sheetElements[openSheetId].classList.remove("open");
  openSheetId = null;
  backdrop.classList.remove("open");
}
backdrop.onclick = closeSheets;
document
  .querySelectorAll("[data-close-sheet]")
  .forEach((el) => (el.onclick = closeSheets));
$("#score-chip").onclick = () => openSheet("coach-sheet");
$("#adjust-open").onclick = () => openSheet("adjust-sheet");
$("#menu-open").onclick = () => openSheet("menu-sheet");

/* ---------- Dialog ---------- */

function dialog(html) {
  $("#dialog-content").innerHTML = html;
  renderIcons($("#dialog-content"));
  if (!$("#info-dialog").open) $("#info-dialog").showModal();
}
$(".dialog-close").onclick = () => $("#info-dialog").close();
$("#info-dialog").addEventListener("click", (e) => {
  if (e.target === $("#info-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
  if (e.target.id === "mobile-preferences") {
    $("#info-dialog").close();
    openSettings();
  }
});
$("#about-open").onclick = () => {
  closeSheets();
  dialog(
    `<div class="dialog-eyebrow">MEET PROLENS</div><h2>Less guessing. More creating.</h2><p>Your private, on-device photography companion. No account. No photo uploads to a server. The sample scene is AI-generated; your own images stay in this browser unless you download them.</p><p>Face detection, light metering and sharpness checks all run on your phone — frames and photos never leave the device. My shots uses browser storage, not a permanent backup. Download photos you want to keep. This prototype captures preview-resolution images, not full-resolution native camera stills.</p><button class="primary-button" id="mobile-preferences">Camera preferences</button>`,
  );
};

/* ---------- Menu ---------- */

document
  .querySelectorAll(".menu-row[data-open]")
  .forEach((el) =>
    (el.onclick = () => {
      closeSheets();
      showPage(el.dataset.open);
    }),
  );
$("#menu-camera-off").onclick = () => {
  restoreDemo();
  closeSheets();
  toast("Camera off. Back to the demo.");
};

/* ---------- Preferences ---------- */

const autoButton = $("#auto-toggle");
function updateAuto() {
  autoButton.textContent = `Smart auto · ${prefs.auto ? "on" : "off"}`;
  autoButton.classList.toggle("off", !prefs.auto);
  autoButton.setAttribute("aria-pressed", String(prefs.auto));
  savePrefs();
}
autoButton.onclick = () => {
  prefs.auto = !prefs.auto;
  manualUntil = 0;
  updateAuto();
  toast(
    prefs.auto
      ? "Smart auto on. Gentle adjustments as the light changes."
      : "Smart auto paused. Your settings, your choice.",
  );
};
updateAuto();
function updateTimerChip() {
  const chip = $("#timer-chip");
  chip.hidden = !(prefs.timer > 0);
  chip.textContent = `${prefs.timer}s`;
}
function openSettings() {
  dialog(
    `<div class="dialog-eyebrow">YOUR CAMERA, YOUR WAY</div><h2>A few personal touches.</h2><label class="preference-row"><div><strong>Smart auto</strong><p>Adapt exposure gently as conditions change.</p></div><input type="checkbox" id="pref-auto" ${prefs.auto ? "checked" : ""}></label><label class="preference-row"><div><strong>Composition grid</strong><p>A little structure. A lot of possibility.</p></div><input type="checkbox" id="pref-grid" ${prefs.grid ? "checked" : ""}></label><label class="preference-row"><div><strong>Burst assist</strong><p>Capture 3 frames and keep the sharpest one.</p></div><input type="checkbox" id="pref-burst" ${prefs.burst ? "checked" : ""}></label><div class="preference-row"><div><strong>Self-timer</strong><p>Countdown before the shutter fires.</p></div><div class="seg" id="pref-timer" role="group" aria-label="Self-timer"><button class="seg-btn" data-timer="0">Off</button><button class="seg-btn" data-timer="3">3s</button><button class="seg-btn" data-timer="10">10s</button></div></div><p>Natural colour first: no skin lightening, skin classification or automatic colour casts. Warmth is always your choice.</p><p id="hardware-info"></p>`,
  );
  $("#hardware-info").textContent =
    source === "camera"
      ? `Camera controls available: ${Object.keys(capabilities).join(", ") || "standard device automatic controls only"}.`
      : "Enable your camera to check supported hardware controls.";
  $("#pref-auto").onchange = (e) => {
    prefs.auto = e.target.checked;
    updateAuto();
  };
  $("#pref-grid").onchange = (e) => {
    prefs.grid = e.target.checked;
    updateGrid();
  };
  $("#pref-burst").onchange = (e) => {
    prefs.burst = e.target.checked;
    savePrefs();
  };
  const seg = $("#pref-timer");
  seg.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.timer) === prefs.timer);
    b.onclick = () => {
      prefs.timer = Number(b.dataset.timer);
      savePrefs();
      seg
        .querySelectorAll(".seg-btn")
        .forEach((x) => x.classList.toggle("selected", x === b));
      updateTimerChip();
      toast(
        prefs.timer
          ? `Self-timer on — ${prefs.timer} second countdown.`
          : "Self-timer off.",
      );
    };
  });
}
$("#settings-open").onclick = () => {
  closeSheets();
  openSettings();
};
function updateGrid() {
  $("#thirds-grid").hidden = !prefs.grid;
  $("#grid-toggle").classList.toggle("active", prefs.grid);
  $("#grid-toggle").setAttribute("aria-pressed", String(prefs.grid));
  savePrefs();
}
updateGrid();
$("#grid-toggle").onclick = () => {
  prefs.grid = !prefs.grid;
  updateGrid();
};
updateTimerChip();

/* ---------- Ratio, capture frame & zoom ---------- */

function sourceElement() {
  return source === "camera" ? video : img;
}
function stageSize() {
  return { W: stage.clientWidth, H: stage.clientHeight };
}
function elementSize(el) {
  return {
    ew: el.videoWidth || el.naturalWidth,
    eh: el.videoHeight || el.naturalHeight,
  };
}
/** Stage pixels per element pixel, including digital zoom about the centre. */
function stageScale(el) {
  const { W, H } = stageSize(),
    { ew, eh } = elementSize(el);
  if (!ew || !eh || !W || !H) return 0;
  return (
    Math.max(W / ew, H / eh) * (zoomHardware ? 1 : Number($("#zoom").value))
  );
}
/**
 * Capture region in *source* pixels: the view is object-fit:cover on the
 * stage, digitally zoomed about the centre, then cropped to the ratio.
 * Sampling and capture both use this so what you see is what you get.
 */
function frameRect() {
  const el = sourceElement(),
    { ew, eh } = elementSize(el),
    { W, H } = stageSize();
  if (!ew || !eh || !W || !H) return null;
  const currentRatio = getEffectiveRatio();
  const scale = Math.max(W / ew, H / eh);
  const dw = W / scale,
    dh = H / scale,
    z = zoomHardware ? 1 : Number($("#zoom").value);
  const w = Math.min(dw / z, (dh / z) * currentRatio),
    h = w / currentRatio;
  return { x: ew / 2 - w / 2, y: eh / 2 - h / 2, width: w, height: h };
}
function updateCropFrame() {
  const el = sourceElement(),
    { ew, eh } = elementSize(el),
    { W, H } = stageSize(),
    frame = $("#crop-frame");
  const r = frameRect();
  if (!r || !W || !H || !ew) return;
  const scale = Math.max(W / ew, H / eh);
  const z = zoomHardware ? 1 : Number($("#zoom").value);
  const w = r.width * scale * z,
    h = r.height * scale * z;
  if (w >= W - 2 && h >= H - 2) {
    frame.classList.remove("shown");
    frame.style.left = "0px";
    frame.style.top = "0px";
    frame.style.width = "100%";
    frame.style.height = "100%";
    return;
  }
  frame.classList.add("shown");
  frame.style.left = (W - w) / 2 + "px";
  frame.style.top = (H - h) / 2 + "px";
  frame.style.width = w + "px";
  frame.style.height = h + "px";
}
$("#ratio-toggle").onclick = () => {
  const idx = RATIO_PRESETS.findIndex((p) => p.key === ratioKey);
  const next = RATIO_PRESETS[(idx + 1) % RATIO_PRESETS.length];
  ratioKey = next.key;
  $("#ratio-toggle").textContent = next.label;
  updateCropFrame();
  toast(`Aspect ratio: ${next.label}`);
};
window.addEventListener("resize", updateCropFrame);
window.addEventListener("orientationchange", updateCropFrame);
video.onloadedmetadata = updateCropFrame;
img.onload = updateCropFrame;

/* ---------- Face tracking (on-device) ---------- */

function elPointToStage(el, px, py) {
  const { ew, eh } = elementSize(el),
    { W, H } = stageSize();
  if (!ew || !W) return null;
  const scale = stageScale(el);
  return {
    fx: 0.5 + ((px - ew / 2) * scale) / W,
    fy: 0.5 + ((py - eh / 2) * scale) / H,
  };
}
function faceBoxToStage(bbox) {
  const el = sourceElement(),
    { ew, eh } = elementSize(el),
    { W, H } = stageSize();
  if (!ew || !W) return null;
  const scale = stageScale(el);
  const c = elPointToStage(el, bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
  if (!c) return null;
  const fw = (bbox.w * scale) / W,
    fh = (bbox.h * scale) / H;
  return {
    fx: c.fx - fw / 2,
    fy: c.fy - fh / 2,
    fw,
    fh,
  };
}
function positionBracket(box) {
  const b = $("#subject-bracket");
  b.hidden = false;
  b.style.left = box.fx * 100 + "%";
  b.style.top = box.fy * 100 + "%";
  b.style.width = box.fw * 100 + "%";
  b.style.height = box.fh * 100 + "%";
}
function clearBracketInline() {
  const b = $("#subject-bracket");
  b.style.left = b.style.top = b.style.width = b.style.height = "";
}
function framingScore(box) {
  const cx = box.fx + box.fw / 2,
    cy = box.fy + box.fh / 2;
  if (cx < -0.02 || cx > 1.02 || cy < -0.02 || cy > 1.02) return 0;
  const d = Math.min(Math.abs(cx - 1 / 3), Math.abs(cx - 2 / 3));
  let s = clamp01((0.15 - d) / (0.15 - 0.035)) * 100;
  // Penalty when the subject is being cropped by the frame edge.
  if (box.fx < 0.01 || box.fy < 0.01 || box.fx + box.fw > 0.99 || box.fy + box.fh > 0.99)
    s *= 0.6;
  return Math.round(s);
}
function framingHint() {
  const cx = faceBox.fx + faceBox.fw / 2;
  const dL = Math.abs(cx - 1 / 3),
    dR = Math.abs(cx - 2 / 3);
  if (Math.min(dL, dR) <= 0.035) return "On the line — nice. Hold it.";
  const line = dL < dR ? 1 / 3 : 2 / 3;
  const dir = cx > line ? "left" : "right";
  return `Slide a little ${dir} to bring the face onto the gridline.`;
}
function handleFace(bbox) {
  const box = faceBoxToStage(bbox);
  if (!box) return;
  faceBox = box;
  faceSeenAt = Date.now();
  positionBracket(box);
  refreshScores();
}
function handleNoFace() {
  if (!faceBox) return;
  if (Date.now() - faceSeenAt > 1200) {
    faceBox = null;
    $("#subject-bracket").hidden = true;
    refreshScores();
  }
}
function refreshScores() {
  if (!lastStats) return;
  const steady = source === "camera" ? steadyScore() : null;
  const framing = faceBox ? framingScore(faceBox) : null;
  const comp = computeComposite(lastStats.score, steady, framing);
  composite = comp;
  const low = lastStats.luminance < 0.22,
    high = lastStats.highlights > 0.1;
  setScoreUI(comp, low || high ? "improve" : "good");
  updateSubBars(lastStats.score, steady, framing);
}
function steadyScore() {
  return Math.round(clamp01(1 - steadyEma / 0.05) * 100);
}
function computeComposite(light, steady, framing) {
  const parts = [[light, 0.5]];
  if (steady != null) parts.push([steady, 0.25]);
  if (framing != null) parts.push([framing, 0.25]);
  const tw = parts.reduce((s, p) => s + p[1], 0);
  return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / tw);
}

/* ---------- Coach loop (live camera) ---------- */

function sampleMotion() {
  const el = sourceElement(),
    { ew, eh } = elementSize(el),
    { W, H } = stageSize();
  if (!ew || !W) return null;
  const scale = Math.max(W / ew, H / eh);
  const dw = W / scale,
    dh = H / scale;
  motionContext.filter = "none";
  motionContext.drawImage(el, (ew - dw) / 2, (eh - dh) / 2, dw, dh, 0, 0, 48, 36);
  const d = motionContext.getImageData(0, 0, 48, 36).data;
  const luma = new Float32Array(48 * 36);
  for (let i = 0; i < luma.length; i++)
    luma[i] =
      (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) /
      255;
  return luma;
}
function updateSteadyUI() {
  const chip = $("#steady-chip");
  if (source !== "camera") {
    chip.hidden = true;
    $("#capture").classList.remove("ready");
    return;
  }
  chip.hidden = false;
  const steady = steadyEma < 0.025;
  chip.textContent = steady ? "Steady" : "Moving";
  chip.className = `indicator ${steady ? "steady" : "moving"}`;
  $("#capture").classList.toggle(
    "ready",
    composite >= 82 && steady && source === "camera",
  );
}
function updateLiveHint() {
  if (source !== "camera" || !lastStats) return;
  const low = lastStats.luminance < 0.22,
    high = lastStats.highlights > 0.1;
  let text;
  if (low) text = "A little more real light will help.";
  else if (high) text = "Protect the bright details. Try softer light.";
  else if (steadyEma > 0.03) text = "Hold steady — a little shake softens the shot.";
  else if (faceBox && mode === "Portrait") text = framingHint();
  else if (faceBox) text = "Nice frame. Find your light, then make it a moment.";
  else text = modes[mode][2];
  if (text !== currentHint) {
    currentHint = text;
    $("#frame-hint-text").textContent = text;
  }
}
async function coachLoop() {
  if (source !== "camera" || document.hidden || !stage.clientWidth) return;
  tick++;
  const luma = sampleMotion();
  if (luma) {
    if (prevLuma) steadyEma = steadyEma * 0.6 + lumaDiff(prevLuma, luma) * 0.4;
    prevLuma = luma;
  }
  updateSteadyUI();
  if (faceBox && Date.now() - faceSeenAt > 1500) {
    faceBox = null;
    $("#subject-bracket").hidden = true;
    refreshScores();
  }
  if (tick % 2 === 0 && !faceDetBusy) {
    faceDetBusy = true;
    detectFace(video)
      .then((bbox) => (bbox ? handleFace(bbox) : handleNoFace()))
      .catch(() => {
        if (!faceFailedNotified && faceDetectionFailed()) {
          faceFailedNotified = true;
          toast(
            "Face tracking isn’t available in this browser. Light, steady and framing checks stay on.",
          );
        }
      })
      .finally(() => {
        faceDetBusy = false;
      });
  }
  updateLiveHint();
  if (tick % 5 === 0) analyzeLive();
}

/* ---------- Adjustments ---------- */

function imageFilter() {
  const exp = exposureHardware ? 0 : Number($("#exposure").value),
    warm = Number($("#warmth").value);
  return `brightness(${2 ** exp}) sepia(${Math.max(0, warm) / 250}) saturate(${1 + Math.abs(warm) / 500}) hue-rotate(${warm < 0 ? warm / 3 : 0}deg)`;
}
function updateAdjustmentUI() {
  const e = Number($("#exposure").value),
    w = Number($("#warmth").value),
    z = Number($("#zoom").value);
  $("#exposure-value").textContent = `${e > 0 ? "+" : ""}${e.toFixed(1)} EV`;
  $("#warmth-value").textContent =
    w === 0 ? "Neutral" : `${Math.abs(w)} ${w > 0 ? "warmer" : "cooler"}`;
  $("#zoom-value").textContent = `${z.toFixed(1)}×`;
  [img, video].forEach((el) => {
    el.style.filter = imageFilter();
    el.style.transform = `scale(${zoomHardware ? 1 : z})`;
  });
  const chips = [
    ["#ev-chip", Math.abs(e) > 0.001, `${e > 0 ? "+" : ""}${e.toFixed(1)} EV`],
    ["#warm-chip", w !== 0, `${w > 0 ? "Warm" : "Cool"} ${Math.abs(w)}`],
    ["#zoom-chip", z > 1.001, `${z.toFixed(1)}×`],
  ];
  for (const [id, show, text] of chips) {
    const el = $(id);
    el.hidden = !show;
    if (show) el.textContent = text;
  }
  document.querySelectorAll("input[type=range]").forEach((el) => {
    let pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.background = `linear-gradient(to right,#e8825a ${pct}%,rgba(255,255,255,0.14) ${pct}%)`;
  });
  updateCropFrame();
}
function updateHardwareNote() {
  const meter = meterPoint ? " Tap-to-meter is active — tap the viewfinder to move it, tap it again to clear." : "";
  $("#adjustment-note").textContent =
    (source === "camera"
      ? `Exposure: ${exposureHardware ? "camera hardware" : "image-only correction"}. Zoom: ${zoomHardware ? "camera hardware" : "digital crop"}. `
      : source === "upload"
        ? "Image-only adjustments. "
        : "Demo adjustments are applied to the image. ") +
    "Warmth is a creative image effect, not calibrated white balance." +
    meter;
}
function bounded(value, cap) {
  let v = Math.min(cap.max, Math.max(cap.min, value));
  if (cap.step) v = cap.min + Math.round((v - cap.min) / cap.step) * cap.step;
  return Math.min(cap.max, Math.max(cap.min, v));
}
async function applyHardware(key, value) {
  const track = stream?.getVideoTracks()[0];
  if (!track || !capabilities[key]) return false;
  try {
    await track.applyConstraints({
      advanced: [{ [key]: bounded(value, capabilities[key]) }],
    });
    const actual = track.getSettings()[key];
    return (
      typeof actual === "number" &&
      Math.abs(actual - bounded(value, capabilities[key])) <
        Math.max(0.1, capabilities[key].step || 0)
    );
  } catch {
    return false;
  }
}
let inputDebounce;
for (const id of ["exposure", "warmth", "zoom"])
  $("#" + id).addEventListener("input", () => {
    manualUntil = Date.now() + 15000;
    updateAdjustmentUI();
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(async () => {
      if (id === "exposure" && exposureHardware) {
        exposureHardware = await applyHardware(
          "exposureCompensation",
          Number($("#exposure").value),
        );
      }
      if (id === "zoom" && zoomHardware) {
        zoomHardware = await applyHardware("zoom", Number($("#zoom").value));
      }
      updateAdjustmentUI();
      updateHardwareNote();
    }, 150);
  });
$("#reset-adjustments").onclick = async () => {
  manualUntil = Date.now() + 15000;
  $("#exposure").value = "0";
  $("#warmth").value = "0";
  $("#zoom").value = $("#zoom").min;
  if (exposureHardware)
    exposureHardware = await applyHardware("exposureCompensation", 0);
  if (zoomHardware)
    zoomHardware = await applyHardware("zoom", Number($("#zoom").value));
  updateAdjustmentUI();
  updateHardwareNote();
  toast("Back to a natural starting point. Smart auto pauses for 15 seconds.");
};
$("#ideal-settings-btn").onclick = async () => {
  manualUntil = Date.now() + 15000;
  await autoTune(true);
};

/* ---------- Tap to meter ---------- */

stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".topbar, .bottombar, .score-chip, .start-cta")) return;
  const r = stage.getBoundingClientRect();
  if (!r.width) return;
  const fx = (e.clientX - r.left) / r.width,
    fy = (e.clientY - r.top) / r.height;
  if (
    meterPoint &&
    Math.hypot((meterPoint.fx - fx) * r.width, (meterPoint.fy - fy) * r.height) < 18
  ) {
    meterPoint = null;
    $("#meter-ring").hidden = true;
  } else {
    meterPoint = { fx, fy };
    const ring = $("#meter-ring");
    ring.hidden = false;
    ring.style.left = fx * 100 + "%";
    ring.style.top = fy * 100 + "%";
    if (!meterNotified) {
      meterNotified = true;
      toast("Tap-to-meter on. Exposure now follows that spot. Tap again to move, tap it once more to clear.");
    }
  }
  updateHardwareNote();
});
function clearMeter() {
  meterPoint = null;
  $("#meter-ring").hidden = true;
}

/* ---------- Camera lifecycle ---------- */

function setSourcePill(kind, label) {
  const pill = $("#source-pill");
  pill.className = `source-pill pill-${kind}`;
  $("#source-label").textContent = label;
  $("#chip-label").textContent = kind === "live" ? "score" : "light";
}
function setStartCta(show, label) {
  const cta = $("#start-camera");
  cta.hidden = !show;
  if (show) $("#start-camera-label").textContent = label;
}
function resetCoachState() {
  clearInterval(timer);
  timer = null;
  cancelCountdown();
  faceBox = null;
  faceSeenAt = 0;
  prevLuma = null;
  lastStats = null;
  steadyEma = 0.01;
  tick = 0;
  currentHint = "";
  clearMeter();
  clearBracketInline();
  $("#steady-chip").hidden = true;
  $("#capture").classList.remove("ready");
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  capabilities = {};
  exposureHardware = false;
  zoomHardware = false;
}
async function connectCamera() {
  if (cameraBusy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast(
      "Camera access needs a supported browser and a secure HTTPS connection. Try uploading a photo.",
    );
    return;
  }
  cameraBusy = true;
  $("#start-camera").disabled = true;
  $("#start-camera-label").textContent = "Connecting…";
  resetCoachState();
  initFaceDetection().catch(() => {}); // warm the model while the camera opens
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 3840, max: 3840 },
        height: { ideal: 2160, max: 2160 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const track = stream.getVideoTracks()[0];
    capabilities = track.getCapabilities?.() || {};
    const auto = {};
    for (const key of ["exposureMode", "whiteBalanceMode", "focusMode"])
      if (capabilities[key]?.includes("continuous")) auto[key] = "continuous";
    if (Object.keys(auto).length)
      try {
        await track.applyConstraints({ advanced: [auto] });
      } catch {}
    source = "camera";
    try {
      localStorage.setItem("frame-camera-prompted", "true");
    } catch {}
    img.hidden = true;
    video.hidden = false;
    $("#subject-bracket").hidden = true;
    setSourcePill("live", "Live");
    setStartCta(false, "");
    $("#menu-camera-off").hidden = false;
    $("#lighting-tip").textContent =
      "Reading the light now. The score blends light, steady hands and framing.";
    $("#composition-status").textContent = "Framing guide";
    $("#background-status").textContent = "Check the scene";
    $("#background-status").className = "status improve";
    $("#background-tip").textContent =
      "Look for objects behind the head, bright distractions, and colours reflecting onto skin.";
    $("#composition-tip").textContent = modes[mode][0];
    $("#score-eyebrow").textContent = "Shot score";
    $("#score-subtitle").textContent =
      "Light, steady hands and framing — updated as you frame.";
    exposureHardware = !!capabilities.exposureCompensation;
    zoomHardware = !!capabilities.zoom;
    for (const [id, key, defaults] of [
      ["exposure", "exposureCompensation", [-1.5, 1.5, 0.1]],
      ["zoom", "zoom", [1, 3, 0.1]],
    ]) {
      const cap = capabilities[key];
      $("#" + id).min = cap?.min ?? defaults[0];
      $("#" + id).max = cap?.max ?? defaults[1];
      $("#" + id).step = cap?.step || defaults[2];
      $("#" + id).value = track.getSettings()[key] ?? (id === "zoom" ? 1 : 0);
    }
    $("#warmth").value = 0;
    updateHardwareNote();
    updateAdjustmentUI();
    stableFrames = 0;
    latest = null;
    lastTune = 0;
    timer = setInterval(coachLoop, 200);
    coachLoop();
    analyzeLive();
    track.addEventListener("ended", () => {
      if (source === "camera") {
        restoreDemo();
        toast("Camera disconnected. Your demo scene is ready.");
      }
    });
    toast("Camera ready. Point, pause, and let the light settle.");
  } catch (error) {
    restoreDemo();
    toast(
      error.name === "NotAllowedError"
        ? "Camera permission was not granted. Allow it in your browser or upload a photo."
        : error.name === "NotFoundError"
          ? "No camera found. Try the demo or upload your own photo."
          : "Camera could not start. Close other camera apps and try again.",
    );
  } finally {
    cameraBusy = false;
    $("#start-camera").disabled = false;
    if (source !== "camera") {
      $("#start-camera-label").textContent =
        source === "upload" ? "Use camera" : "Enable camera";
    }
  }
}
$("#start-camera").onclick = () => {
  if (source === "camera") return;
  connectCamera();
};
$("#switch-camera").onclick = () => {
  if (source !== "camera") {
    toast("Enable your camera first to switch between front and back.");
    return;
  }
  facing = facing === "environment" ? "user" : "environment";
  connectCamera();
};
function restoreDemo() {
  resetCoachState();
  source = "demo";
  img.src = "./assets/demo-scene.jpg";
  img.alt = "Demo scene: woman beside a sunlit archway";
  img.hidden = false;
  video.hidden = true;
  setSourcePill("demo", "Demo");
  setStartCta(true, "Enable camera");
  $("#menu-camera-off").hidden = true;
  $("#subject-bracket").hidden = mode !== "Portrait";
  $("#exposure").min = -1.5;
  $("#exposure").max = 1.5;
  $("#exposure").step = 0.1;
  $("#exposure").value = 0;
  $("#zoom").min = 1;
  $("#zoom").max = 3;
  $("#zoom").step = 0.1;
  $("#zoom").value = 1;
  $("#warmth").value = 0;
  $("#score-eyebrow").textContent = "Demo light check";
  $("#score-subtitle").textContent = "Illustrative scene guidance.";
  $("#composition-status").textContent = "Framing guide";
  $("#background-status").textContent = "Demo backdrop";
  $("#background-status").className = "status good";
  $("#background-tip").textContent =
    "A simple backdrop keeps the attention right where it belongs.";
  $("#lighting-tip").textContent =
    "Soft, warm light in this demo scene. Let’s make the most of it.";
  $("#lighting-status").textContent = "Just right";
  $("#lighting-status").className = "status good";
  setScoreUI(86, "good");
  updateSubBars(86, null, null);
  updateAdjustmentUI();
  updateHardwareNote();
  updateCropFrame();
  // If the model is already loaded (from a previous camera session),
  // snap the bracket to the demo subject's face for real.
  detectFace(img)
    .then((bbox) => {
      if (!bbox || source !== "demo") return;
      const box = faceBoxToStage(bbox);
      if (!box) return;
      faceBox = box;
      if (mode === "Portrait") positionBracket(box);
      const stats = sample();
      if (stats) {
        lastStats = stats;
        renderAnalysis(stats, regionStats());
      }
    })
    .catch(() => {});
}

/* ---------- Analysis ---------- */

function sample() {
  const el = sourceElement();
  const r = frameRect();
  if (!r) return null;
  analysisContext.filter = "none";
  analysisContext.drawImage(
    el,
    r.x,
    r.y,
    r.width,
    r.height,
    0,
    0,
    128,
    96,
  );
  return analyzePixels(analysisContext.getImageData(0, 0, 128, 96).data);
}
/**
 * Subject-region stats for metering. Priority: tap-to-meter > face > null.
 * This is where "meter on the subject, not the sky" happens.
 */
function regionStats() {
  const el = sourceElement(),
    { ew, eh } = elementSize(el),
    { W, H } = stageSize();
  if (!ew || !W) return null;
  const scale = stageScale(el);
  if (!scale) return null;
  let cx, cy, sizeFrac;
  if (meterPoint) {
    cx = ew / 2 + (meterPoint.fx - 0.5) * (W / scale);
    cy = eh / 2 + (meterPoint.fy - 0.5) * (H / scale);
    sizeFrac = 0.3;
  } else if (faceBox) {
    cx = ew / 2 + (faceBox.fx + faceBox.fw / 2 - 0.5) * (W / scale);
    cy = eh / 2 + (faceBox.fy + faceBox.fh / 2 - 0.5) * (H / scale);
    sizeFrac = Math.min(0.6, faceBox.fw * 2.4 * (W / Math.min(W, H)));
  } else return null;
  let size = (sizeFrac * Math.min(W, H)) / scale;
  size = Math.min(size, ew, eh);
  const x = Math.max(0, Math.min(ew - size, cx - size / 2)),
    y = Math.max(0, Math.min(eh - size, cy - size / 2));
  regionContext.filter = "none";
  regionContext.drawImage(el, x, y, size, size, 0, 0, 64, 64);
  return analyzePixels(regionContext.getImageData(0, 0, 64, 64).data);
}
function setScoreUI(score, state) {
  $("#scene-score").textContent = score;
  $("#score-progress").style.strokeDasharray = `${score * 2.2} 264`;
  $("#chip-score").textContent = score;
  $("#chip-progress").style.strokeDasharray = `${score * 1.26} 126`;
  $("#score-title").innerHTML =
    score >= 75
      ? "A little closer<br>to a great shot."
      : score >= 45
        ? "A little light<br>goes a long way."
        : "Let’s find<br>a little more light.";
  if (state) {
    $("#score-chip").className = `score-chip ${state}`;
    $("#score-card").className = `score-card ${state}`;
  }
}
function updateSubBars(light, steady, framing) {
  const set = (barSel, valSel, v) => {
    const bar = $(barSel),
      val = $(valSel),
      row = bar.closest(".sub-score");
    if (v == null) {
      bar.style.width = "0%";
      val.textContent = "–";
      row.classList.remove("good");
      return;
    }
    bar.style.width = v + "%";
    val.textContent = v;
    row.classList.toggle("good", v >= 70);
  };
  set("#sub-light", "#sub-light-val", light);
  set("#sub-steady", "#sub-steady-val", steady);
  set("#sub-framing", "#sub-framing-val", framing);
}
function renderAnalysis(stats, region = null) {
  const ref = region || stats;
  const low = ref.luminance < 0.22,
    high = ref.highlights > 0.1;
  const light = stats.score;
  const steady = source === "camera" ? steadyScore() : null;
  const framing = faceBox ? framingScore(faceBox) : null;
  composite = computeComposite(light, steady, framing);
  setScoreUI(composite, low || high ? "improve" : "good");
  updateSubBars(light, steady, framing);
  $("#chip-label").textContent =
    source === "camera" || framing != null ? "score" : "light";
  $("#lighting-status").textContent = low
    ? "Needs light"
    : high
      ? "Bright highlights"
      : "Balanced";
  $("#lighting-status").className = `status ${low || high ? "improve" : "good"}`;
  $("#lighting-tip").textContent = low
    ? "Move closer to a window or soft light. Keep the phone steady; edits cannot recover lost detail."
    : high
      ? "Very bright areas are losing detail. Try a little shade, especially around pale clothing."
      : "Light levels are workable. Check the face and clothing for detail before you capture.";
  document
    .querySelectorAll(".light-meter span")
    .forEach((el, i) =>
      el.classList.toggle(
        "current",
        i === Math.min(7, Math.floor(stats.luminance * 8)),
      ),
    );
  if (source !== "camera") {
    $("#frame-hint-text").textContent = low
      ? "A little more real light will help."
      : high
        ? "Protect the bright details. Try softer light."
        : modes[mode][2];
  }
}
async function analyzeLive() {
  if (source !== "camera" || document.hidden || tuning) return;
  const stats = sample();
  if (!stats) return;
  lastStats = stats;
  stableFrames =
    latest && Math.abs(stats.luminance - latest.luminance) < 0.06
      ? stableFrames + 1
      : 0;
  latest = stats;
  renderAnalysis(stats, regionStats());
  if (
    prefs.auto &&
    stableFrames >= 1 &&
    Date.now() > manualUntil &&
    Date.now() - lastTune > 2200
  )
    await autoTune(false);
}
async function autoTune(notify = true) {
  if (tuning) return;
  tuning = true;
  const start = performance.now();
  try {
    const stats = sample();
    if (!stats) {
      if (notify) toast("Wait a moment for the camera or image to be ready.");
      return;
    }
    latest = stats;
    const region = regionStats();
    let adjustment = suggestedExposure(region || stats);
    let current = Number($("#exposure").value);
    let next = exposureHardware
      ? Math.max(-0.7, Math.min(0.7, current + adjustment))
      : adjustment;
    $("#exposure").value = next;
    if (exposureHardware) {
      exposureHardware = await applyHardware(
        "exposureCompensation",
        Number($("#exposure").value),
      );
      if (!exposureHardware) $("#exposure").value = adjustment;
    }
    updateAdjustmentUI();
    updateHardwareNote();
    lastTune = Date.now();
    const label = exposureHardware
      ? "Camera exposure adjusted"
      : "Image-only exposure checked";
    $("#optimize-caption").textContent =
      `${label} · ${(Math.max(1, performance.now() - start) / 1000).toFixed(2)}s processing`;
    if (notify) {
      toast(
        `${label}. Natural colour preserved; no skin or outfit classification.`,
      );
      $("#auto-optimize span").textContent = "All set. Make it yours.";
      setTimeout(
        () => ($("#auto-optimize span").textContent = "Auto-tune my shot"),
        2200,
      );
    }
    if (source !== "demo") renderAnalysis(stats, region);
  } finally {
    tuning = false;
  }
}
$("#auto-optimize").onclick = () => autoTune();

/* ---------- Upload ---------- */

$("#upload-button").onclick = () => $("#photo-upload").click();
$("#photo-upload").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Please choose an image.");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("Choose a photo smaller than 25 MB.");
    return;
  }
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.src = url;
  try {
    await probe.decode();
    resetCoachState();
    source = "upload";
    img.src = url;
    await img.decode();
    img.alt = "Your uploaded photo";
    img.hidden = false;
    video.hidden = true;
    setSourcePill("photo", "Your photo");
    setStartCta(true, "Use camera");
    $("#menu-camera-off").hidden = true;
    $("#subject-bracket").hidden = true;
    $("#exposure").min = -1.5;
    $("#exposure").max = 1.5;
    $("#exposure").step = 0.1;
    $("#zoom").min = 1;
    $("#zoom").max = 3;
    $("#zoom").step = 0.1;
    $("#exposure").value = 0;
    $("#warmth").value = 0;
    $("#zoom").value = 1;
    $("#score-eyebrow").textContent = "Light check";
    $("#score-subtitle").textContent =
      "Brightness estimate, not aesthetic quality.";
    $("#composition-status").textContent = "Framing guide";
    $("#composition-tip").textContent = modes[mode][0];
    $("#background-status").textContent = "Check the scene";
    $("#background-tip").textContent =
      "Check for distracting edges and bright objects behind your subject.";
    updateAdjustmentUI();
    updateHardwareNote();
    // If the face model is already in memory, meter and frame the subject.
    detectFace(img)
      .then((bbox) => {
        if (!bbox || source !== "upload") return;
        const box = faceBoxToStage(bbox);
        if (!box) return;
        faceBox = box;
        positionBracket(box);
        refreshScores();
        renderAnalysis(sample(), regionStats());
      })
      .catch(() => {});
    renderAnalysis(sample(), regionStats());
    if (prefs.auto) await autoTune(false);
    toast("Your photo is ready. Analysis stays on your device.");
  } catch {
    toast("This image format could not be opened. Try JPEG, PNG or WebP.");
  } finally {
    URL.revokeObjectURL(url);
    e.target.value = "";
  }
};

/* ---------- Capture (burst-assist + self-timer) ---------- */

function grabFrame() {
  const el = sourceElement(),
    r = frameRect();
  if (!r) return null;
  const currentRatio = getEffectiveRatio();
  const canvas = document.createElement("canvas");
  // Use uncompressed full sensor dimensions of the frame crop up to 3840px
  canvas.width = Math.min(3840, Math.round(r.width));
  canvas.height = Math.round(canvas.width / currentRatio);
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = imageFilter();
  ctx.drawImage(el, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function sharpnessOfCanvas(c) {
  sharpContext.filter = "none";
  sharpContext.drawImage(c, 0, 0, 96, 72);
  const d = sharpContext.getImageData(0, 0, 96, 72).data;
  const luma = new Float32Array(96 * 72);
  for (let i = 0; i < luma.length; i++)
    luma[i] =
      (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) /
      255;
  return sharpness(luma, 96, 72);
}
function cancelCountdown() {
  countdownActive = false;
  clearTimeout(timerCountdown);
  const el = $("#countdown");
  el.hidden = true;
  el.classList.remove("pop");
}
function startCountdown() {
  if (countdownActive) return;
  countdownActive = true;
  const el = $("#countdown");
  let n = prefs.timer;
  const step = () => {
    if (!countdownActive) return;
    if (n <= 0) {
      cancelCountdown();
      capture();
      return;
    }
    el.textContent = n;
    el.hidden = false;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    n--;
    timerCountdown = setTimeout(step, 1000);
  };
  step();
}
async function capture() {
  const el = sourceElement();
  if (!frameRect()) {
    toast("Your scene is still loading. Try again in a moment.");
    return;
  }
  let best = null,
    burstUsed = false,
    bestScore = -1;
  if (source === "camera" && prefs.burst) {
    for (let i = 0; i < 3; i++) {
      const c = grabFrame();
      if (c) {
        const s = sharpnessOfCanvas(c);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (i < 2) await sleep(220);
    }
    burstUsed = true;
  } else {
    best = grabFrame();
  }
  if (!best) return;
  const shot = {
    id: crypto.randomUUID(),
    image: best.toDataURL("image/jpeg", 0.95),
    date: new Date().toISOString(),
    mode,
    source,
  };
  if (shots.length >= 12) {
    toast(
      "Your library holds 12 shots. Download and delete a few before capturing more.",
    );
    return;
  }
  const updated = [shot, ...shots];
  try {
    localStorage.setItem("frame-shots", JSON.stringify(updated));
    shots = updated;
    updateShotCount();
    $("#capture-flash").classList.remove("flash");
    void $("#capture-flash").offsetWidth;
    $("#capture-flash").classList.add("flash");
    toast(
      burstUsed
        ? "Kept the sharpest of 3 frames. Find it in My shots."
        : source === "demo"
          ? "Demo moment saved. Find it in My shots."
          : "Moment saved on this device. Find it in My shots.",
    );
  } catch {
    toast("Browser storage is full or unavailable. Download this shot below.");
    dialog(
      `<h2>Keep this moment.</h2><p>There isn’t enough browser storage. Download your photo now.</p><a class="primary-button" id="direct-download" download="prolens-shot.jpg">Download photo</a>`,
    );
    $("#direct-download").href = shot.image;
  }
}
$("#capture").onclick = () => {
  if (countdownActive) {
    cancelCountdown();
    toast("Self-timer cancelled.");
    return;
  }
  if (source === "camera" && prefs.timer > 0) {
    startCountdown();
    return;
  }
  capture();
};
$("#last-shot").onclick = () => showPage("gallery");
function updateShotCount() {
  $("#shot-count").textContent = shots.length;
  $("#menu-shot-count").textContent = shots.length;
  $("#last-shot-image").style.backgroundImage = shots[0]
    ? `url("${shots[0].image}")`
    : "";
}
updateShotCount();

/* ---------- Modes & coach copy ---------- */

const modes = {
  Portrait: [
    "Place your subject on a gridline to give the scene room to breathe.",
    "Turn your subject slightly toward the light for a softer, more natural portrait.",
    "A little to the right. A lot more story.",
  ],
  Landscape: [
    "Place the horizon on the upper or lower third. Keep vertical lines straight.",
    "Include a foreground detail to give a wide view a sense of depth.",
    "Find your horizon. Leave a little wonder.",
  ],
  Food: [
    "Try a 45° angle for depth, or shoot overhead for a flat arrangement.",
    "Use side light from a window. Turn off overhead bulbs to avoid mixed colour.",
    "Follow the light. Savour the details.",
  ],
  Night: [
    "Brace your phone against something steady and keep bright signs away from faces.",
    "Ask your subject to stay still. More light helps more than digital brightening.",
    "Steady hands. A little patience.",
  ],
};
document.querySelectorAll("[data-mode]").forEach(
  (el) =>
    (el.onclick = () => {
      mode = el.dataset.mode;
      document
        .querySelectorAll("[data-mode]")
        .forEach((b) => b.classList.toggle("selected", b === el));
      $("#composition-tip").textContent = modes[mode][0];
      $("#instinct-tip").textContent = modes[mode][1];
      if (source !== "camera") $("#frame-hint-text").textContent = modes[mode][2];
      if (source === "demo") $("#subject-bracket").hidden = mode !== "Portrait";
      toast(`${mode} guidance selected. No simulated camera lens effects.`);
    }),
);
$("#composition-guide").onclick = () => {
  prefs.grid = true;
  updateGrid();
  $("#subject-bracket").hidden = false;
  $("#subject-bracket").classList.toggle("teaching");
  $("#frame-hint-text").textContent = $("#subject-bracket").classList.contains(
    "teaching",
  )
    ? "Try this area for your subject. Keep space around them."
    : modes[mode][2];
  toast("The bracket is a framing guide, not detected subject tracking.");
};

/* ---------- Keyboard ---------- */

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#shot-viewer").hidden) {
      closeShotViewer();
      return;
    }
    closeSheets();
  }
  if (
    e.code === "Space" &&
    currentScreen === "camera" &&
    !$("#info-dialog").open &&
    !openSheetId &&
    $("#shot-viewer").hidden &&
    !["INPUT", "BUTTON", "TEXTAREA", "A"].includes(
      document.activeElement?.tagName,
    )
  ) {
    e.preventDefault();
    $("#capture").click();
  }
});

/* ---------- Gallery ---------- */

function renderGallery() {
  const grid = $("#gallery-grid");
  grid.innerHTML = "";
  if (!shots.length) {
    grid.innerHTML = `<div class="empty-state">${icon("image")}<h2>A story waiting to happen.</h2><p>Your captured moments will find a home here. Let’s make the first one.</p><button id="first-shot">Find your first shot ${icon("arrow-right")}</button></div>`;
    $("#first-shot").onclick = () => showPage("camera");
    return;
  }
  for (const shot of shots) {
    const card = document.createElement("article");
    card.className = "shot-card";
    const picture = document.createElement("img");
    picture.src = shot.image;
    picture.alt = `Captured ${shot.mode.toLowerCase()} photo`;
    const meta = document.createElement("div");
    meta.className = "shot-meta";
    const text = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${shot.mode} · ${shot.source === "demo" ? "Demo moment" : shot.source === "upload" ? "Photo study" : "A moment worth keeping"}`;
    const date = document.createElement("p");
    date.textContent = new Date(shot.date).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    text.append(title, date);
    const actions = document.createElement("div");
    actions.className = "shot-actions";
    const download = document.createElement("a");
    download.className = "shot-action";
    download.title = "Download";
    download.setAttribute("aria-label", "Download photo");
    download.innerHTML = icon("download");
    download.download = `prolens-${shot.id.slice(0, 8)}.jpg`;
    download.href = shot.image;
    const remove = document.createElement("button");
    remove.className = "shot-action danger";
    remove.title = "Delete";
    remove.setAttribute("aria-label", "Delete photo");
    remove.innerHTML = icon("trash");
    remove.onclick = () => {
      dialog(
        `<h2>Let this moment go?</h2><p>This removes the photo from this browser. Download it first if you want a copy.</p><button class="primary-button" id="confirm-delete">Delete photo</button>`,
      );
      $("#confirm-delete").onclick = () => {
        const updated = shots.filter((s) => s.id !== shot.id);
        try {
          localStorage.setItem("frame-shots", JSON.stringify(updated));
          shots = updated;
          updateShotCount();
          renderGallery();
          $("#info-dialog").close();
          toast("Photo removed.");
        } catch {
          toast("Storage could not be updated. Please try again.");
        }
      };
    };
    meta.append(text, actions);
    card.append(picture, meta);
    card.onclick = (e) => {
      if (e.target.closest(".shot-actions")) return;
      openShotViewer(shot);
    };
    grid.append(card);
  }
  renderIcons(grid);
}

/* ---------- Shot viewer ---------- */

function openShotViewer(shot) {
  const viewer = $("#shot-viewer");
  const img = $("#viewer-img");
  img.src = shot.image;
  img.alt = `Captured ${shot.mode.toLowerCase()} photo`;
  $("#viewer-title").textContent = `${shot.mode} · ${shot.source === "demo" ? "Demo moment" : shot.source === "upload" ? "Photo study" : "A moment worth keeping"}`;
  $("#viewer-date").textContent = new Date(shot.date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const dl = $("#viewer-download");
  dl.href = shot.image;
  dl.download = `prolens-${shot.id.slice(0, 8)}.jpg`;
  $("#viewer-delete").onclick = () => {
    dialog(
      `<h2>Let this moment go?</h2><p>This removes the photo from this browser. Download it first if you want a copy.</p><button class="primary-button" id="confirm-delete-viewer">Delete photo</button>`,
    );
    $("#confirm-delete-viewer").onclick = () => {
      const updated = shots.filter((s) => s.id !== shot.id);
      try {
        localStorage.setItem("frame-shots", JSON.stringify(updated));
        shots = updated;
        updateShotCount();
        renderGallery();
        closeShotViewer();
        $("#info-dialog").close();
        toast("Photo removed.");
      } catch {
        toast("Storage could not be updated. Please try again.");
      }
    };
  };
  viewer.hidden = false;
  renderIcons(viewer);
}
function closeShotViewer() {
  const viewer = $("#shot-viewer");
  viewer.hidden = true;
  $("#viewer-img").src = "";
}
$("#viewer-close").onclick = closeShotViewer;

/* ---------- Field guide ---------- */

const guides = [
  [
    "sun",
    "01 · WORK WITH THE LIGHT",
    "Soft light, strong portraits.",
    "Open shade and window light often make gentler portraits than direct midday sun. Turn the face slightly toward the light; check the eyes and cheek highlights.",
    "https://www.adobe.com/creativecloud/photography/discover/portrait-photography.html",
    "Adobe · Portrait photography",
  ],
  [
    "thermometer",
    "02 · NATURAL COLOUR",
    "Every complexion, as it is.",
    "Use a genuinely neutral reference to assess white balance. Preserve individual skin tones. A colourful dress or wall is not a neutral reference, and warmth is not always a correction.",
    "https://www.adobe.com/products/photoshop/fix-skin-tone.html",
    "Adobe · Natural skin tones",
  ],
  [
    "layers",
    "03 · KEEP THE DETAILS",
    "Let the outfit have its moment.",
    "Check bright fabric for lost texture and dark fabric for crushed shadows. If face and clothing cannot both hold detail, soften the light or move into shade rather than overcorrecting the whole image.",
    "https://www.adobe.com/creativecloud/photography/discover/exposure-in-photography.html",
    "Adobe · Understanding exposure",
  ],
  [
    "grid",
    "04 · FIND YOUR FRAME",
    "A little breathing room.",
    "Try a subject on a third, leave room in the direction they are looking, and avoid a horizon through their head. The grid is a starting point, never a rule you have to follow.",
    "https://www.adobe.com/creativecloud/photography/discover/rule-of-thirds.html",
    "Adobe · Rule of thirds",
  ],
  [
    "moon",
    "05 · WHEN THE SUN GOES DOWN",
    "More light, less guesswork.",
    "Stabilise the phone and ask your subject to stay still. Brightening a preview cannot recover missing detail or prevent motion blur. Native night modes can offer better low-light capture.",
    "https://developer.android.com/reference/androidx/camera/core/CameraControl",
    "Android · Low-light controls",
  ],
  [
    "sliders",
    "06 · KNOW YOUR CAMERA",
    "Smart, within its limits.",
    "Prolens checks browser camera capabilities before applying controls. Native CameraX supports exposure compensation and AF/AE/AWB metering on supported hardware. A web app cannot control your separate default camera app.",
    "https://developer.android.com/media/camerax/configuration",
    "Android · Camera controls",
  ],
];
$("#guide-grid").innerHTML = guides
  .map(
    ([ic, eyebrow, title, body, url, label]) =>
      `<article class="guide-card"><div class="guide-visual">${icon(ic)}</div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${body}</p><a href="${url}" target="_blank" rel="noopener noreferrer">${label}${icon("arrow-right")}</a></article>`,
  )
  .join("");
renderIcons($("#guide-grid"));

/* ---------- Lifecycle ---------- */

window.addEventListener("pagehide", () => resetCoachState());
window.addEventListener("pageshow", (e) => {
  if (e.persisted && source === "camera") restoreDemo();
});

/* ---------- Init ---------- */

setScoreUI(86, "good");
updateSubBars(86, null, null);
updateAdjustmentUI();
updateHardwareNote();
requestAnimationFrame(updateCropFrame);

// If the user hasn't explicitly been prompted before (first time), prompt to enable camera.
// If previously prompted/declined or camera was turned off, keep demo mode with manual enable option.
const cameraEverPrompted = readStored("frame-camera-prompted", false);
if (!cameraEverPrompted && navigator.mediaDevices?.getUserMedia) {
  try {
    localStorage.setItem("frame-camera-prompted", "true");
  } catch {}
  connectCamera().catch(() => {});
}
