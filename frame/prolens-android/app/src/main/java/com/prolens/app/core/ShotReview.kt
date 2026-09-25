package com.prolens.app.core

import kotlin.math.abs
import kotlin.math.roundToInt

data class ScorePart(val name: String, val score: Int, val max: Int, val note: String)

data class Review(val score: Int, val parts: List<ScorePart>, val tips: List<String>, val praise: List<String>) {
    val grade: String get() = when { score >= 88 -> "Pro"; score >= 75 -> "Great"; score >= 60 -> "Good"; else -> "Keep trying" }
}

/**
 * Scores a finished photo. [photo] = stats of the captured image (decoded and downsampled),
 * [atShutter] = the live frame when the shutter was pressed (angles, shake, faces).
 */
object ShotReviewer {
    fun review(photo: Luma, photoFaceLuma: RegionLuma?, atShutter: Frame, preset: Preset, plan: Plan?): Review {
        val r = preset.rules
        val parts = ArrayList<ScorePart>()
        val tips = ArrayList<String>()
        val praise = ArrayList<String>()
        val face = atShutter.primaryFace

        // Exposure (30)
        val subj = photoFaceLuma?.mean ?: photo.p50
        val target = if (photoFaceLuma != null) r.subjectTarget else r.sceneTarget
        val off = abs(subj - target)
        var ex = (30 - off * 90).roundToInt()
        if (photo.clipHigh > r.maxClip * 2) { ex -= ((photo.clipHigh - r.maxClip * 2) * 150).roundToInt().coerceAtMost(12); tips += "Some areas are blown out — tap the brightest part or lower EV next time" }
        if (photoFaceLuma != null && photoFaceLuma.mean < target - 0.15f) tips += "The face is a bit dark — turn toward the light, or tap the face before shooting"
        if (photoFaceLuma == null && subj < target - 0.18f) tips += "A little dark — more light, or steady the phone for Night mode"
        if (subj > target + 0.18f) tips += "A little bright — tap a bright area to meter on it"
        ex = ex.coerceIn(0, 30)
        if (ex >= 26) praise += if (photoFaceLuma != null) "Skin is well exposed" else "Exposure is spot on"
        parts += ScorePart("Exposure", ex, 30, if (ex >= 26) "Well exposed" else if (subj < target) "Underexposed" else "Overexposed")

        // Sharpness (25)
        val sh = ((photo.sharpness / 0.16f).coerceAtMost(1f) * 25).roundToInt() - (if (atShutter.shake > 0.25f) 8 else if (atShutter.shake > 0.12f) 3 else 0)
        val sharp = sh.coerceIn(0, 25)
        if (sharp < 15) tips += if (atShutter.shake > 0.12f) "Motion blur — hold still and press gently (or use the timer)" else "Soft focus — tap your subject before shooting"
        else if (sharp >= 22) praise += "Tack sharp"
        parts += ScorePart("Sharpness", sharp, 25, if (sharp >= 22) "Crisp" else if (sharp >= 15) "OK" else "Soft")

        // Level & angle (15)
        var lv = 15
        if (atShutter.pitchDeg > -70f) lv -= ((abs(atShutter.rollDeg) - r.levelTol * 0.5f).coerceAtLeast(0f) * 3f).roundToInt()
        r.pitchOk?.let { ok -> if (ok.none { atShutter.pitchDeg in it }) { lv -= 5; tips += angleTip(preset) } }
        lv = lv.coerceIn(0, 15)
        if (atShutter.pitchDeg > -70f && abs(atShutter.rollDeg) > r.levelTol) tips += "Tilted ${abs(atShutter.rollDeg).roundToInt()}° — watch the level bar"
        if (lv >= 14) praise += "Perfectly level"
        parts += ScorePart("Level & angle", lv, 15, if (lv >= 14) "Level" else "Tilted")

        // Framing (20)
        var fr = 20
        if (face != null) {
            r.faceSize?.let { fs ->
                val h = face.box.height
                if (h < fs.start) { fr -= 6; tips += "Subject is small in the frame — get closer or use 2×" }
                if (h > fs.endInclusive) { fr -= 5; tips += "Very tight — step back a little" }
            }
            if (atShutter.faces.any { it.box.left < 0.015f || it.box.right > 0.985f || it.box.top < 0.01f }) { fr -= 7; tips += "Someone is cut off at the edge" }
            r.eyeLine?.let { el ->
                val eyeY = face.box.top + face.box.height * 0.42f
                if (eyeY > el.endInclusive + 0.04f) { fr -= 4; tips += "Too much empty space above — tilt down so the eyes sit on the upper third" }
            }
            if (fr >= 18) praise += "Nicely framed"
        } else {
            // no face: reward a clear centre of interest (centre differs from the edges) — gentle
            if (abs(photo.center - photo.border) < 0.03f && preset in setOf(Preset.FOOD, Preset.PRODUCT)) { fr -= 5; tips += "Make the subject stand out — a plainer or darker background helps" }
        }
        fr = fr.coerceIn(0, 20)
        parts += ScorePart("Framing", fr, 20, if (fr >= 18) "Good" else "Could be better")

        // Light quality (10)
        var li = 10
        if (plan?.backlit == true && plan.mode != CaptureMode.HDR) { li -= 4; tips += "Backlit — face the light, or use HDR" }
        if ((photoFaceLuma?.clipHigh ?: 0f) > 0.08f) { li -= 4; tips += "Harsh highlights on the face — open shade gives softer light" }
        if (photo.contrast < 0.3f) { li -= 3; tips += "Flat, hazy light — wipe the lens or add some directional light" }
        li = li.coerceIn(0, 10)
        parts += ScorePart("Light", li, 10, if (li >= 9) "Flattering" else "So-so")

        val total = parts.sumOf { it.score }
        return Review(total, parts, tips.distinct().take(3), praise.distinct().take(2))
    }

    private fun angleTip(p: Preset) = when (p) {
        Preset.FOOD -> "Food looks best from 45° or straight above"
        Preset.PORTRAIT, Preset.GROUP -> "Shoot from eye level — it's the most flattering angle"
        Preset.PRODUCT -> "Shoot products from just above, lens at 2×"
        else -> "Keep the camera pointing at the horizon"
    }
}
