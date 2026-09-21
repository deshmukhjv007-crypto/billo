/* On-device face detection (Google MediaPipe face-detection solution,
 * self-hosted under vendor/facedet). The runtime (~1.7 MB gz) and model
 * (~200 KB) are fetched lazily — only when the camera is used — and then
 * served from the PWA cache. Frames never leave the device.
 */
let detectorPromise = null;
let faceFailed = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

/** Load (once) and return the face detector. Rejects if unsupported. */
export function initFaceDetection() {
  if (faceFailed) return Promise.reject(new Error("face detection unavailable"));
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if (!window.FaceDetection) {
        await loadScript("./vendor/facedet/face_detection.js");
      }
      const detector = new window.FaceDetection({
        locateFile: (f) => "./vendor/facedet/" + f,
      });
      await detector.initialize({
        modelAssetPath:
          "./vendor/facedet/face_detection_short_range.tflite",
      });
      return detector;
    })().catch((err) => {
      faceFailed = true;
      throw err;
    });
  }
  return detectorPromise;
}

export function faceDetectionFailed() {
  return faceFailed;
}

/**
 * Detect the largest face in the given <video>/<img> element.
 * Returns { x, y, w, h, score } in the element's pixel space, or null.
 */
export async function detectFace(el) {
  const detector = await initFaceDetection();
  const result = await detector.detect(el);
  const dets = result?.detections || [];
  if (!dets.length) return null;
  let best = dets[0];
  for (const d of dets) {
    if (
      d.boundingBox.width * d.boundingBox.height >
      best.boundingBox.width * best.boundingBox.height
    )
      best = d;
  }
  const b = best.boundingBox;
  return {
    x: b.originX,
    y: b.originY,
    w: b.width,
    h: b.height,
    score: typeof best.score === "number" ? best.score : 0.8,
  };
}
