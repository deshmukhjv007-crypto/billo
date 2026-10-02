package com.prolens.app.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/*
 * Seller Studio — listing-ready product photos.
 *
 * Live: find the product against its background on the 160×120 luma grid and check the things
 * marketplaces reject photos for (grey or busy background, product cut off or tiny, blur, tilt).
 * After the shot: work out a square crop that makes the product fill ~87% of the image (Amazon asks
 * for 85%+ on a pure-white background, at least 1000 px on the long side, 2000 px recommended).
 */

enum class SellerTarget(
    val label: String,
    val detail: String,
    /** Must the background end up pure white? */
    val whiteBackground: Boolean,
    /** Smallest acceptable listing image side, px. */
    val minPx: Int,
    /** Size we export at when the photo has enough pixels, px. */
    val bestPx: Int,
    /** How much of the square the product's long side should fill. */
    val fill: Float
) {
    MARKETPLACE("Marketplace", "Amazon, Flipkart, Meesho: white background, product fills the frame", true, 1000, 2000, 0.87f),
    SOCIAL("Social", "Instagram, WhatsApp catalogue: square, plain background", false, 1080, 1080, 0.80f);
}

/** Where the product is, and what the background around it looks like. */
data class ProductFind(
    val box: Rect01,
    /** Median brightness of the frame's outer ring, 0..1. */
    val bgLevel: Float,
    /** Spread (standard deviation) of the outer ring, 0..1. Low = plain, even background. */
    val bgSpread: Float,
    /** Share of the frame that differs from the background. */
    val coverage: Float
)

object ProductFinder {
    /**
     * [grid] = upright luma values 0..255, row-major, [w]×[h]. Returns null when nothing stands out
     * from the background (or the grid is too small to judge).
     */
    fun find(grid: IntArray, w: Int, h: Int): ProductFind? {
        if (w < 16 || h < 16 || grid.size < w * h) return null
        val bx = max(1, (w * 0.06f).toInt())
        val by = max(1, (h * 0.06f).toInt())
        val ring = ArrayList<Int>((w + h) * 2 * max(bx, by))
        for (y in 0 until h) for (x in 0 until w) {
            if (x < bx || x >= w - bx || y < by || y >= h - by) ring.add(grid[y * w + x])
        }
        if (ring.isEmpty()) return null
        ring.sort()
        val bg = ring[ring.size / 2]
        // robust spread (median absolute deviation) decides what counts as "different from the background"
        val dev = IntArray(ring.size) { i -> abs(ring[i] - bg) }
        dev.sort()
        val mad = dev[dev.size / 2] * 1.4826
        val thr = max(22.0, 3.0 * mad)
        // evenness of the background itself: ignore ring pixels that belong to a product poking into the edge
        val keep = max(40.0, 3.0 * mad)
        var n = 0; var sum = 0.0
        for (v in ring) if (abs(v - bg) <= keep) { sum += v; n++ }
        val mean = if (n > 0) sum / n else bg.toDouble()
        var ss = 0.0
        for (v in ring) if (abs(v - bg) <= keep) { val d = v - mean; ss += d * d }
        val std = if (n > 0) sqrt(ss / n) else 0.0
        val spread = (std / 255.0).toFloat()

        val colCount = IntArray(w)
        val rowCount = IntArray(h)
        var fg = 0
        for (y in 0 until h) for (x in 0 until w) {
            if (abs(grid[y * w + x] - bg) > thr) { colCount[x]++; rowCount[y]++; fg++ }
        }
        val coverage = fg.toFloat() / (w * h)
        if (coverage < 0.01f) {
            // nothing stands out — but a busy background is worth saying so
            return if (spread > SellerCheck.PLAIN_MAX) ProductFind(Rect01(0f, 0f, 1f, 1f), bg / 255f, spread, 0f) else null
        }
        val minCol = max(2, (h * 0.03f).toInt())
        val minRow = max(2, (w * 0.03f).toInt())
        val x0 = colCount.indexOfFirst { it >= minCol }
        val x1 = colCount.indexOfLast { it >= minCol }
        val y0 = rowCount.indexOfFirst { it >= minRow }
        val y1 = rowCount.indexOfLast { it >= minRow }
        if (x0 < 0 || y0 < 0 || x1 < x0 || y1 < y0) return null
        val box = Rect01(x0.toFloat() / w, y0.toFloat() / h, (x1 + 1).toFloat() / w, (y1 + 1).toFloat() / h)
        return ProductFind(box, bg / 255f, spread, coverage)
    }
}

/** One line of the live checklist. */
data class SellerItem(val id: String, val ok: Boolean, val text: String)

data class SellerStatus(val items: List<SellerItem>) {
    val ready: Boolean get() = items.isNotEmpty() && items.all { it.ok }
    val firstProblem: SellerItem? get() = items.firstOrNull { !it.ok }
}

/** Where to cut the listing image from the photo (pixels of the upright photo). May reach past its edges: pad with white. */
data class ListingCrop(val left: Int, val top: Int, val side: Int, val outSize: Int, val tooSmall: Boolean)

object SellerCheck {
    const val WHITE_MIN = 0.80f      // preview brightness that ends up white after clean-up
    const val PLAIN_MAX = 0.07f      // background spread that still reads as one plain surface
    const val SOCIAL_PLAIN_MAX = 0.10f
    const val SIZE_MIN = 0.50f       // product long side vs the frame's short side

    /** [aspect] = upright image width / height (0.75 for a 3:4 portrait frame). */
    fun live(find: ProductFind?, frame: Frame, target: SellerTarget, aspect: Float = 0.75f): SellerStatus {
        val items = ArrayList<SellerItem>()
        if (find == null) {
            items += SellerItem("product", false, "Put the product in the middle of a plain background")
            return SellerStatus(items)
        }
        // background
        if (target.whiteBackground) {
            items += when {
                find.bgSpread > PLAIN_MAX -> SellerItem("background", false, "Background is uneven: use a plain white sheet or wall")
                find.bgLevel < WHITE_MIN -> SellerItem("background", false, "Background looks grey: add light or move near a window")
                else -> SellerItem("background", true, "White, even background")
            }
        } else {
            items += if (find.bgSpread > SOCIAL_PLAIN_MAX) SellerItem("background", false, "Busy background: use a plain surface")
            else SellerItem("background", true, "Plain background")
        }
        // whole product in the frame
        val b = find.box
        val touches = b.left < 0.02f || b.top < 0.02f || b.right > 0.98f || b.bottom > 0.98f
        items += if (touches) SellerItem("inside", false, "Step back: the product touches the edge")
        else SellerItem("inside", true, "Whole product in frame")
        // big enough
        val wPx = b.width * aspect
        val hPx = b.height
        val longVsShort = max(wPx, hPx) / min(aspect, 1f)
        items += if (!touches && longVsShort < SIZE_MIN) SellerItem("size", false, "Move closer: make the product bigger")
        else SellerItem("size", true, "Good size")
        // sharp
        items += if (frame.luma.sharpness < 0.10f) SellerItem("sharp", false, "Tap the product to focus")
        else SellerItem("sharp", true, "Sharp")
        // straight
        val levelMatters = frame.pitchDeg > -70f
        items += if (levelMatters && abs(frame.rollDeg) > 2f) SellerItem("level", false, "Hold the phone straight")
        else SellerItem("level", true, "Straight")
        return SellerStatus(items)
    }

    /** Square crop around [box] for an upright photo of [imgW]×[imgH] pixels. */
    fun crop(box: Rect01, imgW: Int, imgH: Int, target: SellerTarget): ListingCrop {
        val bw = box.width * imgW
        val bh = box.height * imgH
        val long = max(bw, bh).coerceAtLeast(1f)
        val side = (long / target.fill).roundToInt().coerceIn(1, max(imgW, imgH) * 2)
        val left = (box.cx * imgW - side / 2f).roundToInt()
        val top = (box.cy * imgH - side / 2f).roundToInt()
        val out = if (side >= target.bestPx) target.bestPx else side
        return ListingCrop(left, top, side, out, side < target.minPx)
    }
}

/** What the free app includes, and what needs Pro. Kept here so the rules are tested in one place. */
object Features {
    val FREE_PRESETS = setOf(Preset.AUTO, Preset.PORTRAIT, Preset.FOOD, Preset.SELLER)
    const val FREE_LISTINGS_PER_DAY = 3
    const val FREE_TIPS = 1

    fun presetAllowed(p: Preset, pro: Boolean) = pro || p in FREE_PRESETS

    /** Listing exports left today. [used] = exports already made on [today]; [usedDay] = the day they were counted on. */
    fun listingsLeft(pro: Boolean, today: String, usedDay: String?, used: Int): Int =
        if (pro) Int.MAX_VALUE else FREE_LISTINGS_PER_DAY - (if (usedDay == today) used else 0)
}
