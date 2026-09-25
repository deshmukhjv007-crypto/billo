package com.prolens.app.core

import kotlin.math.abs

/**
 * Every cue is what to do with the PHONE (or your feet), never with the subject:
 * ROTATE_CCW = turn the phone anticlockwise, TILT_DOWN = point the camera lower, STEP_BACK = walk back.
 */
enum class Cue { HOLD_STEADY, ROTATE_CCW, ROTATE_CW, TILT_UP, TILT_DOWN, RAISE_PHONE, LOWER_PHONE, PAN_LEFT, PAN_RIGHT,
    STEP_CLOSER, STEP_BACK, TURN_TO_LIGHT, FIND_LIGHT, FIND_SHADE, TAP_FOCUS, WIPE_LENS, READY }

data class Tip(val cue: Cue, val text: String, val priority: Int)

data class CoachState(val tip: Tip?, val secondary: Tip?, val ready: Boolean, val readiness: Float)

/**
 * Live framing coach. Rules are evaluated every frame; what is *shown* is debounced:
 * a new cue must hold for [enterMs] before it appears, a shown cue stays at least [minShowMs],
 * and thresholds are looser for a cue that is already showing (hysteresis) so it doesn't strobe.
 */
class Coach(private val enterMs: Long = 300, private val minShowMs: Long = 1000) {
    private var shown: Tip? = null
    private var shownAt = 0L
    private var candidate: Cue? = null
    private var candidateSince = 0L

    fun reset() { shown = null; candidate = null }

    /** All tips that apply right now, best first. [active] = the cue currently on screen (for hysteresis). */
    fun evaluate(f: Frame, preset: Preset, plan: Plan?, active: Cue? = shown?.cue): List<Tip> {
        val r = preset.rules
        val tips = ArrayList<Tip>()
        fun loose(c: Cue, v: Float) = if (active == c) v * 0.6f else v

        // 1 — shake beats everything
        if (f.shake > (if (active == Cue.HOLD_STEADY) 0.15f else 0.25f)) tips += Tip(Cue.HOLD_STEADY, "Hold steady", 100)

        // 2 — level (skip when pointing straight down: roll is meaningless there)
        if (f.pitchDeg > -70f) {
            val tolCcw = loose(Cue.ROTATE_CCW, r.levelTol); val tolCw = loose(Cue.ROTATE_CW, r.levelTol)
            if (f.rollDeg > tolCcw) tips += Tip(Cue.ROTATE_CCW, "Level the phone", 90)
            else if (f.rollDeg < -tolCw) tips += Tip(Cue.ROTATE_CW, "Level the phone", 90)
        }

        // 3 — light
        val face = f.primaryFace
        if (plan?.dark == true && plan.mode == CaptureMode.STANDARD && f.camera.evIndex >= 0)
            tips += Tip(Cue.FIND_LIGHT, "Too dark — move toward a lamp or window", 80)
        if (face != null && plan?.backlit == true && plan.mode != CaptureMode.HDR)
            tips += Tip(Cue.TURN_TO_LIGHT, "Light is behind them — turn so it falls on their face", 70)
        if (face != null && (f.subject?.clipHigh ?: 0f) > 0.1f)
            tips += Tip(Cue.FIND_SHADE, "Harsh light on the face — try open shade", 65)

        // 4 — angle for this kind of shot
        r.pitchOk?.let { ok ->
            val slack = if (active in setOf(Cue.RAISE_PHONE, Cue.LOWER_PHONE, Cue.TILT_UP, Cue.TILT_DOWN)) 4f else 0f
            val inside = ok.any { f.pitchDeg >= it.start - slack && f.pitchDeg <= it.endInclusive + slack }
            if (!inside) tips += pitchTip(preset, f.pitchDeg, ok)
        }

        // 5 — subject size / placement
        if (face != null) {
            val faces = f.faces
            r.faceSize?.let { fs ->
                val h = if (preset == Preset.GROUP) faces.maxOf { it.box.height } else face.box.height
                if (h < fs.start * (if (active == Cue.STEP_CLOSER) 0.85f else 1f)) tips += Tip(Cue.STEP_CLOSER, if (preset == Preset.PORTRAIT) "Step closer (or use 2×)" else "Step closer", 55)
                else if (h > fs.endInclusive * (if (active == Cue.STEP_BACK) 1.15f else 1f)) tips += Tip(Cue.STEP_BACK, "Step back a little", 55)
            }
            val cut = faces.any { it.box.left < 0.015f || it.box.right > 0.985f }
            if (cut) tips += Tip(Cue.STEP_BACK, if (faces.size > 1) "Someone is cut off — step back" else "Face is cut off — step back", 60)
            if (face.box.top < 0.02f) tips += Tip(Cue.TILT_UP, "Don't crop the head — tilt up a little", 58)
            r.eyeLine?.let { el ->
                val eyeY = face.box.top + face.box.height * 0.42f
                if (eyeY > el.endInclusive + (if (active == Cue.TILT_DOWN) -0.03f else 0.04f)) tips += Tip(Cue.TILT_DOWN, "Tilt down — put the eyes on the upper third line", 45)
            }
            val cx = if (faces.size > 1) (faces.minOf { it.box.left } + faces.maxOf { it.box.right }) / 2f else face.box.cx
            val off = if (faces.size > 1) 0.14f else 0.3f
            if (cx < 0.5f - off) tips += Tip(Cue.PAN_LEFT, "Move the phone left", 40)
            else if (cx > 0.5f + off) tips += Tip(Cue.PAN_RIGHT, "Move the phone right", 40)
        }

        // 6 — focus / lens
        val dim = f.luma.mean < 0.12f
        if (!dim && f.luma.sharpness < loose(Cue.TAP_FOCUS, 0.07f) && f.shake < 0.15f) {
            if (f.luma.contrast < 0.3f && f.luma.mean > 0.3f) tips += Tip(Cue.WIPE_LENS, "Looks hazy — wipe the lens", 35)
            else tips += Tip(Cue.TAP_FOCUS, "Tap your subject to focus", 30)
        }

        return tips.sortedByDescending { it.priority }
    }

    private fun pitchTip(p: Preset, pitch: Float, ok: List<ClosedFloatingPointRange<Float>>): Tip = when (p) {
        Preset.FOOD -> if (pitch > -30f) Tip(Cue.TILT_DOWN, "Tilt down to about 45° — or shoot straight from above", 50)
            else if (pitch < -60f && pitch > -78f) {
                if (pitch < -69f) Tip(Cue.TILT_DOWN, "Go fully top-down", 50) else Tip(Cue.TILT_UP, "Come back up to about 45°", 50)
            } else Tip(Cue.TILT_UP, "Come back up to about 45°", 50)
        Preset.PRODUCT -> if (pitch > -3f) Tip(Cue.RAISE_PHONE, "Shoot from slightly above the product", 50)
            else Tip(Cue.LOWER_PHONE, "Lower the phone — just above the product", 50)
        Preset.PORTRAIT, Preset.GROUP -> if (pitch < ok.first().start) Tip(Cue.RAISE_PHONE, "Hold the phone at eye level (you're shooting down)", 50)
            else Tip(Cue.LOWER_PHONE, "Lower the phone to eye level (you're shooting up)", 50)
        else -> if (pitch < ok.first().start) Tip(Cue.TILT_UP, "Tilt up toward the horizon", 40) else Tip(Cue.TILT_DOWN, "Tilt down toward the horizon", 40)
    }

    /** Debounced state for the UI. */
    fun update(f: Frame, preset: Preset, plan: Plan?): CoachState {
        val tips = evaluate(f, preset, plan)
        val top = tips.firstOrNull()
        val now = f.timeMs
        val readiness = (1f - tips.sumOf { it.priority.toDouble() }.toFloat() / 220f).coerceIn(0f, 1f)

        if (top == null) {
            // fixed: clear right away (after the minimum show time for anything but a quick flicker)
            if (shown != null && now - shownAt < minShowMs && shown!!.priority >= 90) return CoachState(shown, null, false, readiness)
            shown = null; candidate = null
            return CoachState(Tip(Cue.READY, "Looks great — shoot", 0), null, true, 1f)
        }
        if (shown?.cue == top.cue) {
            shown = top
        } else {
            if (candidate != top.cue) { candidate = top.cue; candidateSince = now }
            val held = now - candidateSince >= enterMs || top.priority >= 100
            val canReplace = shown == null || now - shownAt >= minShowMs || top.priority > (shown?.priority ?: 0) + 20
            val shownStillValid = shown != null && tips.any { it.cue == shown!!.cue }
            if (held && (canReplace || !shownStillValid)) { shown = top; shownAt = now }
        }
        val sec = tips.firstOrNull { it.cue != shown?.cue && it.priority >= 60 && category(it.cue) != category(shown?.cue) }
        return CoachState(shown, sec, false, readiness)
    }

    private fun category(c: Cue?): Int = when (c) {
        Cue.ROTATE_CCW, Cue.ROTATE_CW -> 1
        Cue.TILT_UP, Cue.TILT_DOWN, Cue.RAISE_PHONE, Cue.LOWER_PHONE -> 2
        Cue.PAN_LEFT, Cue.PAN_RIGHT, Cue.STEP_BACK, Cue.STEP_CLOSER -> 3
        Cue.TURN_TO_LIGHT, Cue.FIND_LIGHT, Cue.FIND_SHADE -> 4
        null -> 0
        else -> 5
    }

    companion object {
        fun levelColor(roll: Float, tol: Float): Int = when { abs(roll) < tol * 0.5f -> 2; abs(roll) < tol -> 1; else -> 0 }
    }
}
