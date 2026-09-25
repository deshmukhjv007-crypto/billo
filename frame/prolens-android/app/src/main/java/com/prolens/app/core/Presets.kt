package com.prolens.app.core

/**
 * Scene presets. Each one is a small rulebook: what to expose for, how to hold the phone, how big the
 * subject should be, and which camera modes help. AUTO picks one of the others from what it sees.
 */
enum class Preset(val label: String) {
    AUTO("Auto"), PORTRAIT("Portrait"), GROUP("Group"), FOOD("Food"),
    LANDSCAPE("Landscape"), NIGHT("Night"), PRODUCT("Product");

    val rules: PresetRules get() = PresetRules.of(this)
}

data class PresetRules(
    /** Where the subject (face / focus box) should sit on the 0..1 brightness scale. */
    val subjectTarget: Float,
    /** Where the whole scene should sit when there is no subject. */
    val sceneTarget: Float,
    /** Share of blown-out pixels we accept before pulling exposure down. */
    val maxClip: Float,
    /** Level tolerance in degrees. */
    val levelTol: Float,
    /** Allowed camera pitch ranges (any of them is fine), degrees; null = don't care. */
    val pitchOk: List<ClosedFloatingPointRange<Float>>? = null,
    /** Face height as a share of the frame height. */
    val faceSize: ClosedFloatingPointRange<Float>? = null,
    /** Where the eyes should sit vertically (share of frame height from the top). */
    val eyeLine: ClosedFloatingPointRange<Float>? = null,
    /** Suggested zoom (lens) for this kind of shot. */
    val zoom: Float? = null,
    /** Focus/metering box when there is no face (null = let the camera decide). */
    val focusBox: Float? = null,
    val preferHdr: Boolean = false,
    val preferNight: Boolean = false,
    /** Static advice shown under the preset name. */
    val hint: String
) {
    companion object {
        fun of(p: Preset): PresetRules = when (p) {
            Preset.PORTRAIT -> PresetRules(
                subjectTarget = 0.52f, sceneTarget = 0.46f, maxClip = 0.04f, levelTol = 2.5f,
                pitchOk = listOf(-15f..12f), faceSize = 0.14f..0.42f, eyeLine = 0.26f..0.42f,
                zoom = 2f, hint = "Eye level, 2× lens, eyes on the upper third"
            )
            Preset.GROUP -> PresetRules(
                subjectTarget = 0.50f, sceneTarget = 0.46f, maxClip = 0.04f, levelTol = 2f,
                pitchOk = listOf(-15f..10f), faceSize = 0.05f..0.2f, eyeLine = 0.25f..0.5f,
                zoom = 1f, hint = "Everyone in, nobody at the edge, camera at eye level"
            )
            Preset.FOOD -> PresetRules(
                subjectTarget = 0.56f, sceneTarget = 0.52f, maxClip = 0.03f, levelTol = 3f,
                pitchOk = listOf(-60f..-30f, -90f..-78f), focusBox = 0.36f,
                zoom = 1f, hint = "Shoot at 45° or straight from above, window light from the side"
            )
            Preset.LANDSCAPE -> PresetRules(
                subjectTarget = 0.45f, sceneTarget = 0.42f, maxClip = 0.015f, levelTol = 1f,
                pitchOk = listOf(-20f..20f), preferHdr = true,
                zoom = null, hint = "Level horizon, protect the sky, go wide"
            )
            Preset.NIGHT -> PresetRules(
                subjectTarget = 0.42f, sceneTarget = 0.30f, maxClip = 0.05f, levelTol = 1.5f,
                preferNight = true, hint = "Brace the phone or rest it on something — Night mode needs 2–3 s"
            )
            Preset.PRODUCT -> PresetRules(
                subjectTarget = 0.55f, sceneTarget = 0.55f, maxClip = 0.02f, levelTol = 1f,
                pitchOk = listOf(-25f..-3f, -90f..-80f), focusBox = 0.4f,
                zoom = 2f, hint = "2× to avoid distortion, slightly above, plain background"
            )
            Preset.AUTO -> PresetRules(
                subjectTarget = 0.50f, sceneTarget = 0.46f, maxClip = 0.03f, levelTol = 2f,
                hint = "Prolens picks the scene for you"
            )
        }
    }
}

/**
 * Decides what AUTO means for this frame. Sticky: a new scene has to win for [holdFrames]
 * frames in a row before it replaces the current one, so the label doesn't flicker.
 */
class SceneClassifier(private val holdFrames: Int = 8) {
    var current: Preset = Preset.LANDSCAPE; private set
    private var candidate: Preset = current
    private var streak = 0

    fun guess(f: Frame): Preset {
        val faces = f.faces.filter { it.box.height > 0.04f }
        val veryDark = f.luma.mean < 0.16f && ((f.camera.iso ?: 0) >= 1600 || (f.camera.exposureNs ?: 0L) >= 50_000_000L)
        return when {
            veryDark -> Preset.NIGHT
            faces.size >= 3 -> Preset.GROUP
            faces.isNotEmpty() && faces.maxOf { it.box.height } >= 0.09f -> if (faces.size == 2 && faces.minOf { it.box.height } < 0.1f) Preset.GROUP else Preset.PORTRAIT
            f.pitchDeg <= -55f -> Preset.FOOD                       // pointing down at a table
            f.pitchDeg in -45f..-8f && f.luma.center > f.luma.border + 0.05f -> Preset.PRODUCT
            else -> Preset.LANDSCAPE
        }
    }

    fun update(f: Frame): Preset {
        val g = guess(f)
        if (g == current) { streak = 0; candidate = g; return current }
        if (g == candidate) streak++ else { candidate = g; streak = 1 }
        if (streak >= holdFrames) { current = g; streak = 0 }
        return current
    }

    fun reset(p: Preset = Preset.LANDSCAPE) { current = p; candidate = p; streak = 0 }
}
