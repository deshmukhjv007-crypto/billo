import { analyzePixels, cropRect, suggestedExposure } from "./analysis.js";
const $ = (s) => document.querySelector(s);
const icons = {
  focus: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  camera:
    "M8 5l1-2h6l1 2h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  image:
    "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1 M3 17l6-6 4 4 3-3 5 5 M16 7h.01",
  book: "M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v16",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4",
  shield: "M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5z M8 12l3 3 5-6",
  "chevron-right": "M9 5l7 7-7 7",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-up-right": "M6 18L18 6M6 6h12v12",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  video: "M3 5h12v14H3z M15 9l6-4v14l-6-4",
  grid: "M3 3h18v18H3z M9 3v18m6-18v18M3 9h18M3 15h18",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  sparkles:
    "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4m-2-2h4",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  crop: "M6 2v16h16M2 6h16v16",
  layers: "M12 3l10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5",
  check: "M5 12l4 4L19 6",
  bulb: "M9 18h6m-6 3h6M8 15c-6-5-2-13 4-13s10 8 4 13v2H8z",
  sliders:
    "M4 3v5m0 4v9m8-18v11m0 4v3m8-18v3m0 4v11 M1 8h6v4H1z M9 14h6v4H9z M17 6h6v4h-6z",
  reset: "M3 10a9 9 0 1 1 1 8M3 3v7h7",
  thermometer: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0 M12 8v10",
  zoom: "M15 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M14 15l7 7M6 10h6M9 7v6",
  info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 11v6m0-10h.01",
  close: "M5 5l14 14M5 19L19 5",
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
let shots = readStored("frame-shots", []);
if (!Array.isArray(shots)) shots = [];
let prefs = { auto: true, grid: true, ...readStored("frame-prefs", {}) };
let stream = null,
  facing = "environment",
  source = "demo",
  mode = "Portrait",
  ratio = 3 / 2,
  cameraBusy = false;
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
  currentPage = "camera";
const img = $("#scene-image"),
  video = $("#camera-video");
const analysisCanvas = document.createElement("canvas");
analysisCanvas.width = 128;
analysisCanvas.height = 96;
const analysisContext = analysisCanvas.getContext("2d", {
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
function showPage(page) {
  currentPage = page;
  document
    .querySelectorAll(".page")
    .forEach((el) => (el.hidden = el.id !== `${page}-page`));
  document
    .querySelectorAll("[data-page]")
    .forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  $("#breadcrumb-page").textContent = {
    camera: "Camera coach",
    gallery: "My shots",
    guide: "Field guide",
  }[page];
  if (page === "gallery") renderGallery();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document
  .querySelectorAll("[data-page]")
  .forEach((el) => (el.onclick = () => showPage(el.dataset.page)));
document
  .querySelectorAll("[data-go-camera]")
  .forEach((el) => (el.onclick = () => showPage("camera")));
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
});
const howHtml = `<div class="dialog-eyebrow">POINT. PAUSE. CAPTURE.</div><h2>Your eye, with a little backup.</h2><ol><li><strong>Let the light in.</strong> Enable your camera. Prolens measures brightness, contrast and clipped highlights locally, roughly once a second.</li><li><strong>Let Smart auto help.</strong> Your device handles automatic focus, exposure and white balance where available. Prolens gently adjusts exposure when supported, or labels its image-only fallback.</li><li><strong>Make it yours.</strong> Try the framing grid, adjust the details, then capture. Download your favourites from My shots.</li></ol><p>This is a working browser prototype, not a replacement for native CameraX or AVFoundation. Framing, skin-tone and clothing tips are educational, not automatic person or outfit recognition. Demo guidance is illustrative. A photo cannot be guaranteed perfect.</p>`;
$("#how-it-works").onclick = () => dialog(howHtml);
$("#about-open").onclick = () =>
  dialog(
    `<div class="dialog-eyebrow">MEET PROLENS</div><h2>Less guessing. More creating.</h2><p>Your private, on-device photography companion. No account. No photo uploads to a server. The sample scene is AI-generated; your own images stay in this browser unless you download them.</p><p>My shots uses browser storage, not a permanent backup. Download photos you want to keep. This prototype captures preview-resolution images, not full-resolution native camera stills.</p><button class="optimize-button" id="mobile-preferences">Camera preferences</button>`,
  );
const autoButton = document.createElement("button");
autoButton.id = "auto-toggle";
autoButton.className = "auto-toggle";
$(".listening-dot").replaceWith(autoButton);
function updateAuto() {
  autoButton.textContent = `Smart auto ${prefs.auto ? "on" : "off"}`;
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
$("#settings-open").onclick = () => {
  dialog(
    `<div class="dialog-eyebrow">YOUR CAMERA, YOUR WAY</div><h2>A few personal touches.</h2><label class="preference-row"><div><strong>Smart auto</strong><p>Adapt exposure gently as conditions change.</p></div><input type="checkbox" id="pref-auto" ${prefs.auto ? "checked" : ""}></label><label class="preference-row"><div><strong>Composition grid</strong><p>A little structure. A lot of possibility.</p></div><input type="checkbox" id="pref-grid" ${prefs.grid ? "checked" : ""}></label><p>Natural colour first: no skin lightening, skin classification or automatic colour casts. Warmth is always your choice.</p><p id="hardware-info"></p>`,
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
$("#ratio-toggle").onclick = () => {
  ratio =
    ratio === 3 / 2
      ? 4 / 3
      : ratio === 4 / 3
        ? 16 / 9
        : ratio === 16 / 9
          ? 1
          : 3 / 2;
  $("#ratio-toggle").textContent =
    ratio === 3 / 2
      ? "3:2"
      : ratio === 4 / 3
        ? "4:3"
        : ratio === 16 / 9
          ? "16:9"
          : "1:1";
  $("#viewfinder").style.aspectRatio = String(ratio);
};
$("#expand-button").onclick = () => {
  const expanded = $("#viewfinder").classList.toggle("expanded");
  $("#expand-button").setAttribute(
    "aria-label",
    expanded ? "Close expanded viewfinder" : "Expand viewfinder",
  );
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#viewfinder").classList.remove("expanded");
  if (
    e.code === "Space" &&
    currentPage === "camera" &&
    !$("#info-dialog").open &&
    !["INPUT", "BUTTON", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    capture();
  }
});
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
      $("#frame-hint").textContent = modes[mode][2];
      $("#subject-bracket").hidden = source !== "demo" || mode !== "Portrait";
      toast(`${mode} guidance selected. No simulated camera lens effects.`);
    }),
);
$("#composition-guide").onclick = () => {
  prefs.grid = true;
  updateGrid();
  $("#subject-bracket").hidden = false;
  $("#subject-bracket").classList.toggle("teaching");
  $("#frame-hint").textContent = $("#subject-bracket").classList.contains(
    "teaching",
  )
    ? "Try this area for your subject. Keep space around them."
    : modes[mode][2];
  toast("The bracket is a framing guide, not detected subject tracking.");
};
function sourceElement() {
  return source === "camera" ? video : img;
}
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
  $("#zoom-indicator").textContent = `${z.toFixed(1)}×`;
  [img, video].forEach((el) => {
    el.style.filter = imageFilter();
    el.style.transform = `scale(${zoomHardware ? 1 : z})`;
  });
  document.querySelectorAll("input[type=range]").forEach((el) => {
    let pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.background = `linear-gradient(to right,#d1c0a5 ${pct}%,#eeeeea ${pct}%)`;
  });
}
function updateHardwareNote() {
  $("#adjustment-note").textContent =
    source === "camera"
      ? `Exposure: ${exposureHardware ? "camera hardware" : "image-only correction"}. Zoom: ${zoomHardware ? "camera hardware" : "digital crop"}. Warmth is a creative image effect, not calibrated white balance.`
      : source === "upload"
        ? "Image-only adjustments. Warmth is a creative effect, not calibrated white balance."
        : "Demo adjustments are applied to the image, not your camera hardware.";
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
updateAdjustmentUI();
function stopCamera() {
  clearInterval(timer);
  timer = null;
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
  $("#connect-camera").disabled = true;
  $("#connect-camera span").textContent = "Connecting…";
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
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
    img.hidden = true;
    video.hidden = false;
    $("#subject-bracket").hidden = true;
    $("#source-label").textContent = "LIVE CAMERA";
    $("#scene-description").textContent = "On-device light analysis";
    $("#connect-camera span").textContent = "Camera on";
    $("#composition-status").textContent = "Framing guide";
    $("#background-status").textContent = "Check the scene";
    $("#background-status").className = "status improve";
    $("#background-tip").textContent =
      "Look for objects behind the head, bright distractions, and colours reflecting onto skin.";
    $("#composition-tip").textContent = modes[mode][0];
    $("#score-eyebrow").textContent = "LIGHT CHECK";
    $("#score-subtitle").textContent =
      "Brightness estimate, not aesthetic quality.";
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
    timer = setInterval(analyzeLive, 1000);
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
    $("#connect-camera").disabled = false;
  }
}
$("#connect-camera").onclick = () =>
  source === "camera"
    ? dialog(
        `<div class="dialog-eyebrow">CAMERA CONNECTED</div><h2>You’re in control.</h2><p>The camera is active only in this tab. Smart auto can use the controls your browser exposes.</p><button class="optimize-button" id="stop-camera-button">Turn off camera & return to demo</button>`,
      )
    : connectCamera();
$("#info-dialog").addEventListener("click", (e) => {
  if (e.target.id === "mobile-preferences") $("#settings-open").click();
  if (e.target.id === "stop-camera-button") {
    restoreDemo();
    $("#info-dialog").close();
    toast("Camera off. Back to the demo.");
  }
});
$("#switch-camera").onclick = () => {
  if (source !== "camera") {
    toast("Enable your camera first to switch between front and back.");
    return;
  }
  facing = facing === "environment" ? "user" : "environment";
  connectCamera();
};
function restoreDemo() {
  stopCamera();
  source = "demo";
  img.src = "/assets/demo-scene.jpg";
  img.alt = "Demo scene: woman beside a sunlit archway";
  img.hidden = false;
  video.hidden = true;
  $("#source-label").textContent = "DEMO SCENE";
  $("#connect-camera span").textContent = "Enable camera";
  $("#scene-description").textContent = "Golden hour · Outdoor";
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
  $("#score-eyebrow").textContent = "DEMO LIGHT CHECK";
  $("#score-subtitle").textContent = "Illustrative scene guidance.";
  $("#composition-status").textContent = "Framing guide";
  $("#background-status").textContent = "Demo backdrop";
  $("#background-tip").textContent =
    "A simple backdrop keeps the attention right where it belongs.";
  $("#lighting-tip").textContent =
    "Soft, warm light in this demo scene. Let’s make the most of it.";
  $("#lighting-status").textContent = "Just right";
  $("#lighting-status").className = "status good";
  setScore(86);
  updateAdjustmentUI();
  updateHardwareNote();
}
function sample() {
  const el = sourceElement(),
    width = el.videoWidth || el.naturalWidth,
    height = el.videoHeight || el.naturalHeight;
  if (!width || !height) return null;
  const crop = cropRect(width, height, ratio),
    zoom = zoomHardware ? 1 : Number($("#zoom").value);
  const w = crop.width / zoom,
    h = crop.height / zoom;
  analysisContext.filter = "none";
  analysisContext.drawImage(
    el,
    crop.x + (crop.width - w) / 2,
    crop.y + (crop.height - h) / 2,
    w,
    h,
    0,
    0,
    128,
    96,
  );
  return analyzePixels(analysisContext.getImageData(0, 0, 128, 96).data);
}
function setScore(score) {
  $("#scene-score").textContent = score;
  $("#score-progress").style.strokeDasharray = `${score * 2.2} 264`;
  $("#score-title").innerHTML =
    score >= 75
      ? "A little closer<br>to a great shot."
      : score >= 45
        ? "A little light<br>goes a long way."
        : "Let’s find<br>a little more light.";
}
function renderAnalysis(stats) {
  setScore(stats.score);
  const low = stats.luminance < 0.22,
    high = stats.highlights > 0.1;
  $("#lighting-status").textContent = low
    ? "Needs light"
    : high
      ? "Bright highlights"
      : "Balanced";
  $("#lighting-status").className =
    `status ${low || high ? "improve" : "good"}`;
  $("#lighting-tip").textContent = low
    ? "Move closer to a window or soft light. Keep the phone steady; edits cannot recover lost detail."
    : high
      ? "Very bright areas are losing detail. Try a little shade, especially around pale clothing."
      : "Light levels are workable. Check the face and clothing for detail before you capture.";
  $("#frame-hint").textContent = low
    ? "A little more real light will help."
    : high
      ? "Protect the bright details. Try softer light."
      : modes[mode][2];
  document
    .querySelectorAll(".light-meter span")
    .forEach((el, i) =>
      el.classList.toggle(
        "current",
        i === Math.min(7, Math.floor(stats.luminance * 8)),
      ),
    );
}
async function analyzeLive() {
  if (source !== "camera" || document.hidden || tuning) return;
  const stats = sample();
  if (!stats) return;
  stableFrames =
    latest && Math.abs(stats.luminance - latest.luminance) < 0.06
      ? stableFrames + 1
      : 0;
  latest = stats;
  renderAnalysis(stats);
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
    let adjustment = suggestedExposure(stats);
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
    if (source !== "demo") renderAnalysis(stats);
  } finally {
    tuning = false;
  }
}
$("#auto-optimize").onclick = () => autoTune();
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
    stopCamera();
    source = "upload";
    img.src = url;
    await img.decode();
    img.alt = "Your uploaded photo";
    img.hidden = false;
    video.hidden = true;
    $("#source-label").textContent = "YOUR PHOTO";
    $("#connect-camera span").textContent = "Enable camera";
    $("#subject-bracket").hidden = true;
    $("#scene-description").textContent = "Private photo analysis";
    $("#exposure").min = -1.5;
    $("#exposure").max = 1.5;
    $("#exposure").step = 0.1;
    $("#zoom").min = 1;
    $("#zoom").max = 3;
    $("#zoom").step = 0.1;
    $("#exposure").value = 0;
    $("#warmth").value = 0;
    $("#zoom").value = 1;
    $("#score-eyebrow").textContent = "LIGHT CHECK";
    $("#score-subtitle").textContent =
      "Brightness estimate, not aesthetic quality.";
    $("#composition-status").textContent = "Framing guide";
    $("#composition-tip").textContent = modes[mode][0];
    $("#background-status").textContent = "Check the scene";
    $("#background-tip").textContent =
      "Check for distracting edges and bright objects behind your subject.";
    updateAdjustmentUI();
    updateHardwareNote();
    renderAnalysis(sample());
    if (prefs.auto) await autoTune(false);
    toast("Your photo is ready. Analysis stays on your device.");
  } catch {
    toast("This image format could not be opened. Try JPEG, PNG or WebP.");
  } finally {
    URL.revokeObjectURL(url);
    e.target.value = "";
  }
};
async function capture() {
  const el = sourceElement(),
    w = el.videoWidth || el.naturalWidth,
    h = el.videoHeight || el.naturalHeight;
  if (!w || !h) {
    toast("Your scene is still loading. Try again in a moment.");
    return;
  }
  const crop = cropRect(w, h, ratio),
    z = zoomHardware ? 1 : Number($("#zoom").value),
    sw = crop.width / z,
    sh = crop.height / z;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(1400, Math.round(sw));
  canvas.height = Math.round(canvas.width / ratio);
  const ctx = canvas.getContext("2d");
  ctx.filter = imageFilter();
  ctx.drawImage(
    el,
    crop.x + (crop.width - sw) / 2,
    crop.y + (crop.height - sh) / 2,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const shot = {
    id: crypto.randomUUID(),
    image: canvas.toDataURL("image/jpeg", 0.87),
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
      source === "demo"
        ? "Demo moment saved. Find it in My shots."
        : "Moment saved on this device. Find it in My shots.",
    );
  } catch {
    toast("Browser storage is full or unavailable. Download this shot below.");
    dialog(
      `<h2>Keep this moment.</h2><p>There isn’t enough browser storage. Download your photo now.</p><a class="optimize-button" id="direct-download" download="prolens-shot.jpg">Download photo</a>`,
    );
    $("#direct-download").href = shot.image;
  }
}
$("#capture").onclick = capture;
$("#last-shot").onclick = () => showPage("gallery");
function updateShotCount() {
  $("#shot-count").textContent = shots.length;
  $("#last-shot-image").style.backgroundImage = shots[0]
    ? `url("${shots[0].image}")`
    : "";
}
updateShotCount();
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
    card.append(picture);
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${shot.mode} · ${shot.source === "demo" ? "Demo moment" : shot.source === "upload" ? "Photo study" : "A moment worth keeping"}`;
    const date = document.createElement("p");
    date.textContent = new Date(shot.date).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const actions = document.createElement("div");
    actions.className = "shot-actions";
    const download = document.createElement("a");
    download.textContent = "Download ↗";
    download.download = `prolens-${shot.id.slice(0, 8)}.jpg`;
    download.href = shot.image;
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.onclick = () => {
      dialog(
        `<h2>Let this moment go?</h2><p>This removes the photo from this browser. Download it first if you want a copy.</p><button class="optimize-button" id="confirm-delete">Delete photo</button>`,
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
    actions.append(download, remove);
    info.append(title, date, actions);
    card.append(info);
    grid.append(card);
  }
}
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
    "https://developer.android.com/media/camera/camerax/configuration",
    "Android · Camera controls",
  ],
];
$("#guide-grid").innerHTML = guides
  .map(
    ([ic, eyebrow, title, body, url, label]) =>
      `<article class="guide-card"><div class="guide-visual">${icon(ic)}</div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2><p>${body}</p><a href="${url}" target="_blank" rel="noopener noreferrer">${label}${icon("arrow-up-right")}</a></article>`,
  )
  .join("");
window.addEventListener("pagehide", () => stopCamera());
window.addEventListener("pageshow", (e) => {
  if (e.persisted && source === "camera") restoreDemo();
});
