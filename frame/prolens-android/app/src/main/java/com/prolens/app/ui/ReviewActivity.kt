package com.prolens.app.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.exifinterface.media.ExifInterface
import com.prolens.app.core.FrameStats
import com.prolens.app.core.Rect01
import com.prolens.app.core.Review
import com.prolens.app.core.ShotReviewer
import kotlin.concurrent.thread
import kotlin.math.max

/** After the shot: the photo, a score out of 100, what went right, and what to change next time. */
class ReviewActivity : ComponentActivity() {
    private lateinit var image: ImageView
    private lateinit var body: LinearLayout
    private lateinit var loading: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val uri = intent.data ?: return finish()
        setContentView(build(uri))
        thread(name = "review") {
            val display = decode(uri, 1400)
            val small = display?.let { Bitmap.createScaledBitmap(it, if (it.width < it.height) 120 else 160, if (it.width < it.height) 160 else 120, true) }
            val review = small?.let { analyse(it) }
            val th = display?.let { Bitmap.createScaledBitmap(it, 160, max(1, 160 * it.height / it.width), true) }
            runOnUiThread {
                loading.visibility = View.GONE
                if (display != null) image.setImageBitmap(display)
                if (th != null) ShotStore.thumb = th
                if (review != null) show(review) else body.addView(line("Couldn't read this photo back.", 15f, Ui.DIM))
            }
        }
    }

    private fun build(uri: Uri): View {
        val dp = { v: Float -> Ui.dp(this, v) }
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.BLACK) }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16f), dp(16f), dp(16f), dp(24f)) }
        val frame = FrameLayout(this)
        image = ImageView(this).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER }
        loading = ProgressBar(this)
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        frame.addView(loading, FrameLayout.LayoutParams(dp(48f), dp(48f), Gravity.CENTER))
        frame.minimumHeight = dp(240f)
        col.addView(frame)
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(body)

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(4f); rightMargin = dp(4f) } }
        buttons.addView(Ui.chip(this, "Retake") { finish() }, lp())
        buttons.addView(Ui.chip(this, "Share") {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share photo"))
        }, lp())
        buttons.addView(Ui.chip(this, "Gallery") {
            try { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) } catch (e: Throwable) {}
        }, lp())
        col.addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20f) })
        col.addView(line("Saved to Pictures/Prolens", 12f, Ui.DIM).apply { gravity = Gravity.CENTER })
        scroll.addView(col)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            col.setPadding(dp(16f), b.top + dp(12f), dp(16f), b.bottom + dp(24f))
            insets
        }
        return scroll
    }

    private fun decode(uri: Uri, maxSide: Int): Bitmap? = try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
        var sample = 1
        while (max(o.outWidth, o.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val bmp = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
        val orient = contentResolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            ?: ExifInterface.ORIENTATION_NORMAL
        val deg = when (orient) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
        val flip = orient == ExifInterface.ORIENTATION_FLIP_HORIZONTAL || orient == ExifInterface.ORIENTATION_TRANSPOSE || orient == ExifInterface.ORIENTATION_TRANSVERSE
        if (bmp != null && (deg != 0f || flip)) {
            val m = Matrix().apply { if (flip) postScale(-1f, 1f); postRotate(deg) }
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        } else bmp
    } catch (e: Throwable) { null }

    private fun analyse(small: Bitmap): Review? {
        val w = small.width; val h = small.height
        val px = IntArray(w * h)
        small.getPixels(px, 0, w, 0, 0, w, h)
        val lum = IntArray(w * h) { i ->
            val c = px[i]
            ((Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000)
        }
        val fs = FrameStats(); fs.load(lum, w, h)
        val at = ShotStore.frame ?: return null
        val face = at.primaryFace?.box?.let { b -> if (at.camera.front) Rect01(1f - b.right, b.top, 1f - b.left, b.bottom) else b }  // selfies are saved mirrored
        val faceLuma = face?.let {
            fs.region(Rect01(it.left + it.width * 0.2f, it.top + it.height * 0.25f, it.right - it.width * 0.2f, it.bottom - it.height * 0.15f))
        }
        return ShotReviewer.review(fs.luma(), faceLuma, at, ShotStore.preset, ShotStore.plan)
    }

    private fun show(r: Review) {
        val dp = { v: Float -> Ui.dp(this, v) }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; setPadding(0, dp(16f), 0, dp(4f)) }
        head.addView(line("${r.score}", 54f, if (r.score >= 75) Ui.READY else Ui.ACCENT).apply { typeface = Typeface.create("sans-serif-medium", Typeface.BOLD) })
        head.addView(line("  / 100 · ${r.grade}", 18f, Ui.TEXT).apply { setPadding(0, 0, 0, dp(10f)) })
        body.addView(head)
        body.addView(line("${ShotStore.preset.label} · ${ShotStore.settings}", 13f, Ui.DIM).apply { typeface = Typeface.MONOSPACE })

        for (p in r.parts) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(12f), 0, 0) }
            row.addView(line("${p.name}  ${p.score}/${p.max} · ${p.note}", 14f, Ui.TEXT))
            val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = p.max; progress = p.score
                progressTintList = android.content.res.ColorStateList.valueOf(if (p.score >= p.max * 0.85) Ui.READY else Ui.ACCENT)
            }
            row.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8f)).apply { topMargin = dp(4f) })
            body.addView(row)
        }
        if (r.praise.isNotEmpty()) {
            body.addView(line("NICE", 12f, Ui.READY).apply { setPadding(0, dp(18f), 0, dp(4f)); letterSpacing = 0.1f })
            r.praise.forEach { body.addView(line("✓  $it", 15f, Ui.TEXT)) }
        }
        if (r.tips.isNotEmpty()) {
            body.addView(line("NEXT TIME", 12f, Ui.ACCENT).apply { setPadding(0, dp(18f), 0, dp(4f)); letterSpacing = 0.1f })
            r.tips.forEach { body.addView(line("→  $it", 15f, Ui.TEXT).apply { setPadding(0, dp(3f), 0, dp(3f)) }) }
        }
        ShotStore.plan?.reasons?.takeIf { it.isNotEmpty() }?.let { rs ->
            body.addView(line("WHAT PROLENS SET", 12f, Ui.DIM).apply { setPadding(0, dp(18f), 0, dp(4f)); letterSpacing = 0.1f })
            rs.forEach { body.addView(line("•  $it", 13.5f, Ui.DIM)) }
        }
    }

    private fun line(t: String, size: Float, color: Int) = TextView(this).apply { text = t; textSize = size; setTextColor(color) }
}
