/* Camera consent policy for Prolens.
 *
 * The browser permission prompt is deliberately hard to control, so the rules
 * live here as one small pure function instead of being scattered through the
 * UI code. The goal: ask exactly once, then never again.
 *
 *  - Once permission is granted, every later launch connects silently.
 *  - A remembered "granted" consent also connects silently, which covers
 *    browsers that do not implement the Permissions API (Safari).
 *  - A denial is remembered and never retried automatically: re-calling
 *    getUserMedia after a denial cannot prompt again, it only fails.
 *  - Inside an embedded frame the grant is usually session-scoped, so the app
 *    waits for an explicit tap instead of re-prompting on every page load.
 *  - If the user switched the camera off, that choice wins.
 */

export const CAMERA_CONSENT_KEY = "frame-camera-consent"; // true | false | null
export const CAMERA_INTENT_KEY = "frame-camera-intent"; // "on" | "off"

/**
 * @param {object} input
 * @param {boolean} input.supported  mediaDevices.getUserMedia exists
 * @param {boolean} input.secure     window.isSecureContext
 * @param {string}  input.permission "granted" | "denied" | "prompt" | "unknown"
 * @param {boolean|null} input.consent remembered result of a previous request
 * @param {string|null}  input.intent  "on" | "off" | null (never chosen)
 * @param {boolean} input.embedded    running inside an iframe
 * @returns {{ mode: "auto"|"first-run"|"tap"|"blocked"|"insecure"|"unsupported",
 *             silent: boolean, reason: string }}
 */
export function decideCameraStart({
  supported = true,
  secure = true,
  permission = "unknown",
  consent = null,
  intent = null,
  embedded = false,
} = {}) {
  if (!supported) return { mode: "unsupported", silent: false, reason: "no-media-devices" };
  if (!secure) return { mode: "insecure", silent: false, reason: "insecure-context" };
  if (permission === "denied" || consent === false)
    return { mode: "blocked", silent: false, reason: "denied" };
  if (intent === "off")
    return { mode: "tap", silent: false, reason: "camera-switched-off" };
  // Granted: no prompt will be shown, so connect straight away.
  if (permission === "granted")
    return { mode: "auto", silent: true, reason: "permission-granted" };
  // Consent remembered but the state is unknowable (Safari): connect silently
  // where the browser remembers, and let the platform ask where it cannot.
  if (consent === true)
    return { mode: "auto", silent: true, reason: "consent-remembered" };
  // Never asked before.
  if (consent == null)
    return embedded
      ? { mode: "tap", silent: false, reason: "embedded-first-run" }
      : { mode: "first-run", silent: false, reason: "first-run" };
  return { mode: "tap", silent: false, reason: "consent-not-remembered" };
}

/** Human-readable camera state for the Preferences sheet. */
export function describeCameraState({ permission = "unknown", consent = null } = {}) {
  if (permission === "granted" || consent === true)
    return {
      key: "granted",
      label: "Allowed",
      note: "Prolens opens with the camera ready and will not ask again.",
    };
  if (permission === "denied" || consent === false)
    return {
      key: "blocked",
      label: "Blocked",
      note: "Your browser is blocking the camera. Allow it in site settings, then reload.",
    };
  return {
    key: "prompt",
    label: "Not requested",
    note: "The camera is requested once, the first time you switch it on.",
  };
}
