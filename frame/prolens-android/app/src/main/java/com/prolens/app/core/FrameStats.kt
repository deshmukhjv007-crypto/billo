package com.prolens.app.core

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Measures a camera frame from its Y (luma) plane — and optionally the U/V planes for colour cast.
 * Works on a sampled grid (~160 × 120 points) so it costs well under a millisecond per frame.
 *
 * The plane is in *sensor* orientation; [rotation] (0/90/180/270, from ImageInfo.rotationDegrees)
 * tells us how to turn it upright, so regions passed in are in upright preview coordinates.
 */
class FrameStats(private val gridW: Int = 160, private val gridH: Int = 120) {

    /** Upright grid of luma values 0..255, filled by [sample]. */
    private var grid = IntArray(gridW * gridH)
    var gw = gridW; private set
    var gh = gridH; private set

    /**
     * Sample [y] (row stride [rowStride], pixel stride [pixelStride]) of a [width]×[height] sensor image
     * into an upright grid. For 90/270 the grid is transposed so it matches what the user sees.
     */
    fun sample(y: ByteArray, width: Int, height: Int, rowStride: Int, pixelStride: Int, rotation: Int) {
        val upright90 = rotation == 90 || rotation == 270
        gw = if (upright90) gridH else gridW
        gh = if (upright90) gridW else gridH
        if (grid.size != gw * gh) grid = IntArray(gw * gh)
        for (gy in 0 until gh) {
            for (gx in 0 until gw) {
                // upright normalised coords → sensor coords
                val u = (gx + 0.5f) / gw
                val v = (gy + 0.5f) / gh
                val (sx, sy) = when (rotation) {
                    90 -> Pair(v, 1f - u)
                    180 -> Pair(1f - u, 1f - v)
                    270 -> Pair(1f - v, u)
                    else -> Pair(u, v)
                }
                val px = min(width - 1, (sx * width).toInt())
                val py = min(height - 1, (sy * height).toInt())
                val idx = py * rowStride + px * pixelStride
                grid[gy * gw + gx] = if (idx in y.indices) (y[idx].toInt() and 0xFF) else 0
            }
        }
    }

    /** Copy of the current upright grid (so another thread can keep measuring regions). */
    fun snapshot(): IntArray = grid.copyOf(gw * gh)

    /** Fill the grid directly (tests, or a decoded photo). [values] is upright, row-major, 0..255. */
    fun load(values: IntArray, w: Int, h: Int) {
        gw = w; gh = h
        grid = values.copyOf()
    }

    fun luma(): Luma {
        val n = gw * gh
        val hist = IntArray(256)
        var sum = 0L
        var cSum = 0L; var cN = 0
        var bSum = 0L; var bN = 0
        val cx0 = (gw * 0.3f).toInt(); val cx1 = (gw * 0.7f).toInt()
        val cy0 = (gh * 0.3f).toInt(); val cy1 = (gh * 0.7f).toInt()
        val bx = max(1, (gw * 0.12f).toInt()); val by = max(1, (gh * 0.12f).toInt())
        for (yy in 0 until gh) for (xx in 0 until gw) {
            val v = grid[yy * gw + xx]
            hist[v]++
            sum += v
            if (xx in cx0 until cx1 && yy in cy0 until cy1) { cSum += v; cN++ }
            if (xx < bx || xx >= gw - bx || yy < by || yy >= gh - by) { bSum += v; bN++ }
        }
        fun pct(p: Float): Float {
            val target = (n * p).toInt()
            var acc = 0
            for (i in 0 until 256) { acc += hist[i]; if (acc > target) return i / 255f }
            return 1f
        }
        var hi = 0; for (i in 250..255) hi += hist[i]
        var lo = 0; for (i in 0..5) lo += hist[i]
        val coarse = IntArray(32); for (i in 0 until 256) coarse[i / 8] += hist[i]
        return Luma(
            mean = sum.toFloat() / n / 255f,
            p5 = pct(0.05f), p50 = pct(0.5f), p95 = pct(0.95f),
            clipHigh = hi.toFloat() / n, clipLow = lo.toFloat() / n,
            center = if (cN > 0) cSum.toFloat() / cN / 255f else 0f,
            border = if (bN > 0) bSum.toFloat() / bN / 255f else 0f,
            sharpness = sharpness(),
            histogram = coarse
        )
    }

    /** Brightness inside an upright region. */
    fun region(r: Rect01): RegionLuma {
        val x0 = (r.left * gw).toInt().coerceIn(0, gw - 1); val x1 = (r.right * gw).toInt().coerceIn(x0 + 1, gw)
        val y0 = (r.top * gh).toInt().coerceIn(0, gh - 1); val y1 = (r.bottom * gh).toInt().coerceIn(y0 + 1, gh)
        var s = 0L; var n = 0; var hi = 0; var lo = 0
        for (yy in y0 until y1) for (xx in x0 until x1) {
            val v = grid[yy * gw + xx]
            s += v; n++
            if (v >= 250) hi++
            if (v <= 5) lo++
        }
        if (n == 0) return RegionLuma(0f, 0f, 0f)
        return RegionLuma(s.toFloat() / n / 255f, hi.toFloat() / n, lo.toFloat() / n)
    }

    /**
     * Focus quality: RMS of the 4-neighbour Laplacian, normalised against local contrast so a dim
     * but sharp scene still scores well. ~0.05 = soft/blurred, ≥ 0.18 = crisp at preview resolution.
     */
    fun sharpness(r: Rect01? = null): Float {
        val x0 = if (r == null) 1 else (r.left * gw).toInt().coerceIn(1, gw - 2)
        val x1 = if (r == null) gw - 1 else (r.right * gw).toInt().coerceIn(x0 + 1, gw - 1)
        val y0 = if (r == null) 1 else (r.top * gh).toInt().coerceIn(1, gh - 2)
        val y1 = if (r == null) gh - 1 else (r.bottom * gh).toInt().coerceIn(y0 + 1, gh - 1)
        var e = 0.0; var g = 0.0; var n = 0
        for (yy in y0 until y1) for (xx in x0 until x1) {
            val c = grid[yy * gw + xx]
            val l = grid[yy * gw + xx - 1]; val rr = grid[yy * gw + xx + 1]
            val u = grid[(yy - 1) * gw + xx]; val d = grid[(yy + 1) * gw + xx]
            val lap = (l + rr + u + d - 4 * c).toDouble()
            val grad = (kotlin.math.abs(rr - l) + kotlin.math.abs(d - u)).toDouble()
            e += lap * lap; g += grad; n++
        }
        if (n == 0) return 0f
        val rms = sqrt(e / n)
        val meanGrad = g / n
        return (rms / (meanGrad + 12.0) * 0.5).toFloat().coerceIn(0f, 1f)
    }

    companion object {
        /** Mean of a chroma plane (U or V), sampled sparsely. Returns 0..255. */
        fun planeMean(p: ByteArray, width: Int, height: Int, rowStride: Int, pixelStride: Int): Float {
            var s = 0L; var n = 0
            val stepX = max(1, width / 64); val stepY = max(1, height / 48)
            var yy = 0
            while (yy < height) {
                var xx = 0
                while (xx < width) {
                    val i = yy * rowStride + xx * pixelStride
                    if (i in p.indices) { s += (p[i].toInt() and 0xFF); n++ }
                    xx += stepX
                }
                yy += stepY
            }
            return if (n == 0) 128f else s.toFloat() / n
        }

        /** Colour cast from mean Cb (U) and Cr (V). Neutral ≈ 0. */
        fun tint(meanU: Float, meanV: Float): Tint = Tint(warmth = (meanV - 128f) - (meanU - 128f), green = -((meanU - 128f) + (meanV - 128f)))
    }
}
