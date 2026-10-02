package com.prolens.app.ui

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import com.prolens.app.core.Rect01
import com.prolens.app.core.SellerCheck
import com.prolens.app.core.SellerTarget
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

object Photos {
    /** Decode a saved photo, turned upright from its EXIF orientation, with its long side ≤ [maxSide]. */
    fun decodeUpright(ctx: Context, uri: Uri, maxSide: Int): Bitmap? = try {
        val cr = ctx.contentResolver
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
        var sample = 1
        while (max(o.outWidth, o.outHeight) / sample > maxSide) sample *= 2
        val bmp = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        val orient = cr.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            ?: ExifInterface.ORIENTATION_NORMAL
        val deg = when (orient) {
            ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSVERSE -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSPOSE -> 270f
            else -> 0f
        }
        val flip = orient == ExifInterface.ORIENTATION_FLIP_HORIZONTAL || orient == ExifInterface.ORIENTATION_TRANSPOSE || orient == ExifInterface.ORIENTATION_TRANSVERSE
        if (bmp != null && (deg != 0f || flip)) {
            val m = Matrix().apply { if (flip) postScale(-1f, 1f); postRotate(deg) }
            val turned = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            if (turned != bmp) bmp.recycle()
            turned
        } else bmp
    } catch (e: Throwable) { null }

    /** Save a JPEG into the gallery under [album] (e.g. "Pictures/Prolens Listings"). */
    fun saveJpeg(ctx: Context, bmp: Bitmap, name: String, album: String): Uri? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                put(MediaStore.MediaColumns.RELATIVE_PATH, album)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val cr = ctx.contentResolver
            val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (uri != null) {
                cr.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.JPEG, 95, it) }
                cr.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            }
            uri
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Images.Media.insertImage(ctx.contentResolver, bmp, name, "Made with Prolens")?.let { Uri.parse(it) }
        }
    } catch (e: Throwable) { null }
}

/**
 * Turns a Seller Studio photo into a square listing image: product centred and filling ~87% of the
 * square, padded with white where the crop runs past the photo, and (for marketplaces) the
 * background lifted to pure white.
 */
object ListingMaker {
    class Result(val uri: Uri, val preview: Bitmap, val size: Int, val tooSmall: Boolean)

    /** [box] = the product in upright photo coordinates (0..1). Runs on a background thread. */
    fun make(ctx: Context, photo: Uri, box: Rect01, target: SellerTarget): Result? {
        val src = Photos.decodeUpright(ctx, photo, 4096) ?: return null
        val c = SellerCheck.crop(box, src.width, src.height, target)
        val out = Bitmap.createBitmap(c.outSize, c.outSize, Bitmap.Config.ARGB_8888)
        val cv = Canvas(out)
        cv.drawColor(Color.WHITE)
        val scale = c.outSize.toFloat() / c.side
        val inter = Rect(c.left, c.top, c.left + c.side, c.top + c.side)
        if (!inter.intersect(0, 0, src.width, src.height)) { src.recycle(); return null }
        val dst = RectF((inter.left - c.left) * scale, (inter.top - c.top) * scale, (inter.right - c.left) * scale, (inter.bottom - c.top) * scale)
        cv.drawBitmap(src, inter, dst, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        // where the product sits in the output, so clean-up leaves it alone
        val keep = RectF(
            (box.left * src.width - c.left) * scale, (box.top * src.height - c.top) * scale,
            (box.right * src.width - c.left) * scale, (box.bottom * src.height - c.top) * scale
        )
        src.recycle()
        if (target.whiteBackground) whiten(out, keep)
        val name = "Prolens_listing_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val uri = Photos.saveJpeg(ctx, out, name, "Pictures/Prolens Listings") ?: return null
        return Result(uri, out, c.outSize, c.tooSmall)
    }

    /** Brighten so the background reads as white, then snap near-white, near-grey pixels outside the product to pure white. */
    private fun whiten(bmp: Bitmap, keep: RectF) {
        val w = bmp.width; val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        // background level = median brightness of a thin outer ring
        val ring = ArrayList<Int>()
        val step = max(1, min(w, h) / 200)
        val edge = max(2, (min(w, h) * 0.04f).toInt())
        var y = 0
        while (y < h) {
            var x = 0
            while (x < w) {
                if (x < edge || y < edge || x >= w - edge || y >= h - edge) {
                    val p = px[y * w + x]
                    ring.add((Color.red(p) + Color.green(p) + Color.blue(p)) / 3)
                }
                x += step
            }
            y += step
        }
        if (ring.isEmpty()) return
        ring.sort()
        val bg = ring[ring.size / 2].coerceAtLeast(1)
        val gain = (250f / bg).coerceIn(1f, 1.6f)
        val margin = min(w, h) * 0.02f
        val kl = keep.left - margin; val kt = keep.top - margin; val kr = keep.right + margin; val kb = keep.bottom + margin
        for (yy in 0 until h) {
            val insideRow = yy >= kt && yy <= kb
            for (xx in 0 until w) {
                val i = yy * w + xx
                val p = px[i]
                val r = (Color.red(p) * gain).toInt().coerceAtMost(255)
                val g = (Color.green(p) * gain).toInt().coerceAtMost(255)
                val b = (Color.blue(p) * gain).toInt().coerceAtMost(255)
                val inside = insideRow && xx >= kl && xx <= kr
                val lo = min(r, min(g, b)); val hi = max(r, max(g, b))
                px[i] = if (!inside && lo >= 228 && hi - lo <= 28) Color.WHITE else Color.rgb(r, g, b)
            }
        }
        bmp.setPixels(px, 0, w, 0, 0, w, h)
    }
}
