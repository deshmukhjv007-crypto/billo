package com.prolens.app.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/*
 * Prolens core — pure Kotlin, no Android imports, so everything in core/ runs in plain JVM unit tests.
 *
 * Coordinates: every rectangle and point is normalised to the *upright preview* the user sees
 * (0,0 = top-left, 1,1 = bottom-right), whatever the sensor orientation.
 *
 * Device angles (from the rotation-vector sensor, portrait orientation):
 *   roll  — rotation around the camera axis. 0 = level. + = phone's top tipped to the right (clockwise).
 *   pitch — 0 = camera looking at the horizon, -90 = looking straight down, +90 = straight up.
 */

data class Rect01(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
    val cx get() = (left + right) / 2f
    val cy get() = (top + bottom) / 2f
    val area get() = max(0f, width) * max(0f, height)

    fun expand(f: Float): Rect01 {
        val dw = width * f / 2f
        val dh = height * f / 2f
        return Rect01(left - dw, top - dh, right + dw, bottom + dh).clamp()
    }

    fun clamp() = Rect01(left.coerceIn(0f, 1f), top.coerceIn(0f, 1f), right.coerceIn(0f, 1f), bottom.coerceIn(0f, 1f))

    fun distanceTo(o: Rect01): Float = max(abs(cx - o.cx), abs(cy - o.cy))

    companion object {
        fun centered(size: Float) = Rect01(0.5f - size / 2f, 0.5f - size / 2f, 0.5f + size / 2f, 0.5f + size / 2f)
    }
}

data class Face(val box: Rect01, val rollDeg: Float = 0f, val yawDeg: Float = 0f, val eyesOpen: Float? = null, val smiling: Float? = null)

/** Brightness statistics of one frame, all values 0..1 on the gamma-encoded (display) scale. */
data class Luma(
    val mean: Float,
    val p5: Float,
    val p50: Float,
    val p95: Float,
    val clipHigh: Float,   // share of pixels ≥ 250/255
    val clipLow: Float,    // share of pixels ≤ 5/255
    val center: Float,     // mean of the central 40% box
    val border: Float,     // mean of the outer ring (≈ background for a centred subject)
    val sharpness: Float,  // 0..1, normalised Laplacian energy
    val histogram: IntArray = IntArray(0)
) {
    val contrast get() = p95 - p5
    override fun equals(other: Any?) = other is Luma && other.mean == mean && other.p95 == p95 && other.sharpness == sharpness
    override fun hashCode() = mean.hashCode() * 31 + sharpness.hashCode()
}

/** Brightness of a region (a face, or the focus box). */
data class RegionLuma(val mean: Float, val clipHigh: Float, val clipLow: Float)

/** Colour cast from the chroma planes: + warm (orange/tungsten), − cool (blue/shade). Roughly Cr − Cb in 0..255 units. */
data class Tint(val warmth: Float, val green: Float = 0f)

/** What the camera is doing right now (read back from each capture result). */
data class CameraState(
    val iso: Int? = null,
    val exposureNs: Long? = null,
    val evIndex: Int = 0,
    val zoom: Float = 1f,
    val front: Boolean = false,
    val manual: Boolean = false,
    val mode: CaptureMode = CaptureMode.STANDARD
)

enum class Awb { AUTO, DAYLIGHT, CLOUDY, SHADE, INCANDESCENT, FLUORESCENT }

enum class CaptureMode { STANDARD, HDR, NIGHT, MANUAL_NIGHT }

/** What this particular phone's camera can do (read from Camera2 characteristics). */
data class Capabilities(
    val evMin: Int = -12,
    val evMax: Int = 12,
    val evStep: Float = 1f / 6f,          // EV per index step
    val isoMin: Int? = null,
    val isoMax: Int? = null,
    val exposureMinNs: Long? = null,
    val exposureMaxNs: Long? = null,
    val manualSensor: Boolean = false,
    val awbModes: Set<Awb> = setOf(Awb.AUTO),
    val maxMeteringRegions: Int = 1,
    val maxFocusRegions: Int = 1,
    val zoomMin: Float = 1f,
    val zoomMax: Float = 4f,
    val hasFlash: Boolean = false,
    val nightExtension: Boolean = false,
    val hdrExtension: Boolean = false,
    val focal35mm: Float = 26f,           // 35 mm-equivalent focal length of the main lens
    val ois: Boolean = false,
    val fixedFocus: Boolean = false
) {
    val evMinStops get() = evMin * evStep
    val evMaxStops get() = evMax * evStep
    fun clampEvIndex(i: Int) = min(evMax, max(evMin, i))
    fun indexFor(stops: Float): Int = clampEvIndex(Math.round(stops / evStep))
    /** Slowest shutter that is still sharp hand-held (reciprocal rule, with a 2× safety margin; OIS buys ~2 stops). */
    fun handheldLimitNs(zoom: Float): Long {
        val f = focal35mm * max(1f, zoom)
        val sec = (1.0 / (f * 2.0)) * (if (ois) 4.0 else 1.0)
        return (sec * 1e9).toLong()
    }
}

/** Everything the planner and the coach look at for one frame. */
data class Frame(
    val luma: Luma,
    val tint: Tint = Tint(0f),
    val faces: List<Face> = emptyList(),
    val subject: RegionLuma? = null,     // brightness of the primary face / focus region
    val rollDeg: Float = 0f,
    val pitchDeg: Float = 0f,
    val shake: Float = 0f,               // rad/s, smoothed gyro magnitude
    val camera: CameraState = CameraState(),
    val timeMs: Long = 0L
) {
    val primaryFace: Face? get() = faces.maxByOrNull { it.box.area }
}

fun Float.fmt(d: Int = 1): String = String.format(java.util.Locale.US, "%.${d}f", this)
