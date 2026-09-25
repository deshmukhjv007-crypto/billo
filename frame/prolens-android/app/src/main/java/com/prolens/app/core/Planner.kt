package com.prolens.app.core

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong

enum class FlashAdvice { OFF, SUGGEST_ON }

/** The settings Prolens wants on the camera for this frame, plus the reasons in plain words. */
data class Plan(
    val evIndex: Int,
    val meteringBox: Rect01?,
    val awb: Awb,
    val mode: CaptureMode,             // what we'd shoot with (the UI may ask before switching to NIGHT/HDR)
    val manualIso: Int? = null,
    val manualExposureNs: Long? = null,
    val zoomSuggestion: Float? = null,
    val flash: FlashAdvice = FlashAdvice.OFF,
    val backlit: Boolean = false,
    val dark: Boolean = false,
    val highContrast: Boolean = false,
    val reasons: List<String> = emptyList()
)

private fun log2(x: Double) = ln(x) / ln(2.0)

/**
 * Closed-loop exposure + mode planner.
 *
 * The phone's own auto-exposure keeps running; we steer it with exposure compensation and a metering
 * region, which every Android camera supports. Changes are smoothed, dead-banded and rate-limited so
 * the preview never "pumps". Manual ISO/shutter is only used for steady low light on phones that
 * advertise MANUAL_SENSOR, and Night/HDR extensions only where the phone has them.
 */
class Planner(private val caps: Capabilities) {
    private var smoothed = -1f
    private var commanded = 0
    private var lastChangeMs = -100_000L
    private var lastErrSign = 0
    private var steadySinceMs: Long? = null
    var settleMs = 450L
    /** User tapped to lock exposure: keep the EV where it is. */
    var locked = false

    fun reset() { smoothed = -1f; commanded = 0; lastChangeMs = -100_000L; lastErrSign = 0; steadySinceMs = null }

    fun plan(f: Frame, preset: Preset): Plan {
        val r = preset.rules
        val face = f.primaryFace
        val reasons = ArrayList<String>()

        // ---- what are we measuring? ----------------------------------------------------------
        val measuredRaw = f.subject?.mean ?: (0.6f * f.luma.center + 0.4f * f.luma.mean)
        smoothed = if (smoothed < 0f) measuredRaw else smoothed + 0.35f * (measuredRaw - smoothed)
        val m = max(0.02f, smoothed)
        val target = if (f.subject != null) r.subjectTarget else r.sceneTarget

        val backlit = face != null && f.subject != null &&
            (f.luma.border > f.subject.mean + 0.22f || (f.luma.clipHigh > 0.06f && f.subject.mean < 0.4f))
        val highContrast = f.luma.contrast > 0.82f && f.luma.clipHigh > 0.03f && f.luma.clipLow > 0.06f
        val exp = f.camera.exposureNs ?: 0L
        val iso = f.camera.iso ?: 0
        val dark = f.luma.mean < 0.18f && (iso >= 1600 || exp >= 66_000_000L || f.camera.evIndex >= caps.evMax)

        // ---- exposure error in stops (display luma → roughly linear with γ 2.2) -------------------
        var err = 2.2 * log2(target.toDouble() / m)
        var guard = 0.0
        if (!backlit && f.luma.clipHigh > r.maxClip) {
            guard = -min(1.5, 0.6 * log2((f.luma.clipHigh / r.maxClip).toDouble()) + 0.3)
            err = min(err, 0.0) + guard
        }
        if (f.subject != null && f.subject.clipHigh > 0.08f) err = min(err, -0.3) // shiny face / hot spot

        // ---- steer EV compensation -------------------------------------------------------------
        val cur = f.camera.evIndex
        var next = commanded
        if (!locked && !f.camera.manual) {
            val sign = if (err > 0.2) 1 else if (err < -0.2) -1 else 0
            val settled = f.timeMs - lastChangeMs >= settleMs
            if (sign != 0 && sign == lastErrSign && settled) {
                val maxStep = max(1, (0.34 / caps.evStep).toInt())
                val wanted = (0.6 * err / caps.evStep).roundToInt().coerceIn(-maxStep, maxStep)
                if (wanted != 0) {
                    next = caps.clampEvIndex(cur + wanted)
                    if (next != commanded) { commanded = next; lastChangeMs = f.timeMs }
                }
            }
            lastErrSign = sign
        }
        val evStops = commanded * caps.evStep

        // ---- metering / focus region -------------------------------------------------------------
        val meterBox = when {
            face != null -> face.box.expand(0.15f)
            r.focusBox != null -> Rect01.centered(r.focusBox)
            else -> null
        }
        if (face != null) reasons += if (f.faces.size > 1) "Metering and focusing on the faces" else "Metering and focusing on the face"
        else if (meterBox != null) reasons += "Metering the centre of the frame"
        if (abs(evStops) >= 0.15f) {
            reasons += when {
                guard < 0 && evStops < 0 -> "${evStops.fmt()} EV to keep bright areas from blowing out"
                evStops > 0 && backlit -> "+${evStops.fmt()} EV: bright light behind the subject"
                evStops > 0 -> "+${evStops.fmt()} EV: the subject was in shadow"
                else -> "${evStops.fmt()} EV: the subject was too bright"
            }
        }
        if (locked) reasons += "Exposure locked (tap the frame again to unlock)"

        // ---- low light: Night extension > steady manual long exposure > just advice -------------------
        val steady = f.shake < 0.03f
        steadySinceMs = if (steady) (steadySinceMs ?: f.timeMs) else null
        val tripodLike = steadySinceMs?.let { f.timeMs - it >= 1200 } ?: false
        var mode = CaptureMode.STANDARD
        var manualIso: Int? = null
        var manualExp: Long? = null
        if (dark || preset == Preset.NIGHT) {
            when {
                caps.nightExtension -> { mode = CaptureMode.NIGHT; reasons += "Low light: Night mode stacks several frames" }
                caps.manualSensor && tripodLike && caps.exposureMaxNs != null && caps.isoMin != null && caps.isoMax != null -> {
                    val longNs = min(caps.exposureMaxNs, 500_000_000L)
                    val curExp = if (exp > 0) exp else 33_000_000L
                    val curIso = if (iso > 0) iso else 800
                    val boost = 2.0.pow(max(0.0, err).coerceAtMost(2.0))
                    val isoNeed = (curIso * curExp.toDouble() / longNs * boost).roundToInt()
                    manualIso = isoNeed.coerceIn(caps.isoMin, caps.isoMax)
                    manualExp = longNs
                    mode = CaptureMode.MANUAL_NIGHT
                    reasons += "Phone is steady: ${shutterLabel(longNs)} at ISO $manualIso for a clean night shot"
                }
                else -> reasons += "Low light: brace your elbows or rest the phone for a sharper shot"
            }
        }
        val limit = caps.handheldLimitNs(f.camera.zoom)
        if (mode == CaptureMode.STANDARD && exp > limit * 2 && f.shake > 0.05f) reasons += "Slow shutter (${shutterLabel(exp)}) — hold very still"

        if (mode == CaptureMode.STANDARD && (backlit || highContrast || (r.preferHdr && f.luma.contrast > 0.75f))) {
            if (caps.hdrExtension) { mode = CaptureMode.HDR; reasons += if (backlit) "HDR: keeps both the face and the bright background" else "HDR: very bright and very dark areas in one frame" }
            else reasons += if (backlit) "Exposing for the face — the background will be bright" else "High contrast scene"
        }

        // ---- colour -----------------------------------------------------------------------------------
        when {
            f.tint.warmth > 26f -> reasons += "White balance: auto (warm indoor light detected)"
            f.tint.warmth < -22f -> reasons += "White balance: auto (cool shade / blue light)"
        }

        // ---- lens and flash suggestions ----------------------------------------------------------------
        val edgeCut = f.faces.any { it.box.left < 0.02f || it.box.right > 0.98f || it.box.top < 0.01f }
        val zoomSuggestion = when {
            preset == Preset.GROUP && edgeCut && caps.zoomMin < 1f -> caps.zoomMin
            r.zoom != null -> r.zoom.coerceIn(caps.zoomMin, caps.zoomMax)
            preset == Preset.LANDSCAPE && caps.zoomMin < 1f -> null
            else -> null
        }
        val flash = if (dark && face != null && face.box.height > 0.2f && caps.hasFlash && !f.camera.front && !caps.nightExtension) FlashAdvice.SUGGEST_ON else FlashAdvice.OFF

        return Plan(
            evIndex = commanded, meteringBox = meterBox, awb = Awb.AUTO, mode = mode,
            manualIso = manualIso, manualExposureNs = manualExp, zoomSuggestion = zoomSuggestion,
            flash = flash, backlit = backlit, dark = dark, highContrast = highContrast, reasons = reasons
        )
    }

    companion object {
        fun shutterLabel(ns: Long): String {
            if (ns <= 0) return "—"
            val s = ns / 1e9
            return if (s >= 0.95) "${(s * 10).roundToLong() / 10.0} s" else "1/${(1 / s).roundToInt()} s"
        }

        /** "ISO 400 · 1/60 s · +0.7 EV" — what the camera is actually using. */
        fun summary(c: CameraState, caps: Capabilities): String {
            val parts = ArrayList<String>()
            c.iso?.let { parts += "ISO $it" }
            c.exposureNs?.let { parts += shutterLabel(it) }
            val ev = c.evIndex * caps.evStep
            if (abs(ev) >= 0.05f) parts += (if (ev > 0) "+" else "") + ev.fmt() + " EV"
            if (c.zoom != 1f) parts += c.zoom.fmt() + "×"
            if (c.mode != CaptureMode.STANDARD) parts += when (c.mode) { CaptureMode.HDR -> "HDR"; CaptureMode.NIGHT -> "NIGHT"; CaptureMode.MANUAL_NIGHT -> "MANUAL"; else -> "" }
            return if (parts.isEmpty()) "Auto" else parts.joinToString(" · ")
        }
    }
}
