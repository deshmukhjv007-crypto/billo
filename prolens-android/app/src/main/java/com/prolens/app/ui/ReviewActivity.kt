package com.prolens.app.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
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
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.prolens.app.Prefs
import com.prolens.app.billing.ProStore
import com.prolens.app.core.Features
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
    private lateinit var prefs: Prefs
    private var photoUri: Uri? = null
    private var listingBusy = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        prefs = Prefs(this)
        val uri = intent.data ?: return finish()
        photoUri = uri
        setContentView(build(uri))
        thread(name = "review") {
            val display = Photos.decodeUpright(this, uri, 1400)
            val small = display?.let { Bitmap.createScaledBitmap(it, if (it.width < it.height) 120 else 160, if (it.width < it.height) 160 else 120, true) }
            val review = small?.let { analyse(it) }
            val th = display?.let { Bitmap.createScaledBitmap(it, 160, max(1, 160 * it.height / it.width), true) }
            runOnUiThread {
                loading.visibility = View.GONE
                if (display != null) image.setImageBitmap(display)
                if (th != null) ShotStore.thumb = th
                ShotStore.seller?.let { showSeller(it) }
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
        buttons.addView(Ui.chip(this, "Share") { share(uri) }, lp())
        buttons.addView(Ui.chip(this, "Gallery") { openInGallery(uri) }, lp())
        col.addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20f) })
        col.addView(line(if (prefs.saveToCamera) "Saved to your Gallery (Camera)" else "Saved to your Gallery (Prolens album)", 12f, Ui.DIM).apply { gravity = Gravity.CENTER })
        scroll.addView(col)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            col.setPadding(dp(16f), b.top + dp(12f), dp(16f), b.bottom + dp(24f))
            insets
        }
        return scroll
    }

    private fun share(uri: Uri) {
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share photo"))
    }

    private fun openInGallery(uri: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) } catch (e: Throwable) {}
    }

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
        val face = at.primaryFace?.box?.let { b -> mirrored(b) }
        val faceLuma = face?.let {
            fs.region(Rect01(it.left + it.width * 0.2f, it.top + it.height * 0.25f, it.right - it.width * 0.2f, it.bottom - it.height * 0.15f))
        }
        return ShotReviewer.review(fs.luma(), faceLuma, at, ShotStore.preset, ShotStore.plan)
    }

    /** Selfies are saved mirrored, so boxes from the live preview flip left-right. */
    private fun mirrored(b: Rect01): Rect01 = if (ShotStore.frame?.camera?.front == true) Rect01(1f - b.right, b.top, 1f - b.left, b.bottom) else b

    private fun show(r: Review) {
        val dp = { v: Float -> Ui.dp(this, v) }
        val pro = ProStore.isPro
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
            val shown = if (pro) r.tips else r.tips.take(Features.FREE_TIPS)
            shown.forEach { body.addView(line("→  $it", 15f, Ui.TEXT).apply { setPadding(0, dp(3f), 0, dp(3f)) }) }
            val hidden = r.tips.size - shown.size
            if (hidden > 0) {
                body.addView(line("🔒  $hidden more ${if (hidden == 1) "tip" else "tips"} with Prolens Pro", 15f, Ui.ACCENT).apply {
                    setPadding(0, dp(6f), 0, dp(6f))
                    setOnClickListener { openPaywall("See every tip after every shot with Prolens Pro.") }
                })
            }
        }
        ShotStore.plan?.reasons?.takeIf { it.isNotEmpty() }?.let { rs ->
            body.addView(line("WHAT PROLENS SET", 12f, Ui.DIM).apply { setPadding(0, dp(18f), 0, dp(4f)); letterSpacing = 0.1f })
            rs.forEach { body.addView(line("•  $it", 13.5f, Ui.DIM)) }
        }
    }

    // ------------------------------------------------------------------ Seller Studio

    private fun showSeller(s: SellerShot) {
        val dp = { v: Float -> Ui.dp(this, v) }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.pill(Ui.CARD, Ui.dpf(this@ReviewActivity, 16f))
            setPadding(dp(16f), dp(14f), dp(16f), dp(16f))
        }
        card.addView(line("SELLER STUDIO · ${s.target.label.uppercase()}", 12f, Ui.ACCENT).apply { letterSpacing = 0.1f })
        s.status?.items?.forEach { card.addView(line((if (it.ok) "✓  " else "✕  ") + it.text, 14.5f, if (it.ok) Ui.TEXT else Ui.WARN).apply { setPadding(0, dp(4f), 0, 0) }) }
        val box = s.box
        if (box == null) {
            card.addView(line("Prolens couldn't find the product. Retake it in the middle of a plain background.", 14.5f, Ui.WARN), Ui.matchWrap(dp(10f)))
        } else {
            val left = prefs.listingsLeft()
            val label = if (ProStore.isPro) "Make listing image" else "Make listing image (${left.coerceAtLeast(0)} free today)"
            val result = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            card.addView(Ui.button(this, label, true) { makeListing(mirrored(box), s, result) }, Ui.matchWrap(dp(14f)))
            card.addView(result)
        }
        body.addView(card, Ui.matchWrap(dp(16f)))
    }

    private fun makeListing(box: Rect01, s: SellerShot, into: LinearLayout) {
        val uri = photoUri ?: return
        if (listingBusy) return
        if (!ProStore.isPro && prefs.listingsLeft() <= 0) {
            openPaywall("You've made today's ${Features.FREE_LISTINGS_PER_DAY} free listing images. Pro makes them unlimited.")
            return
        }
        listingBusy = true
        val dp = { v: Float -> Ui.dp(this, v) }
        into.removeAllViews()
        into.addView(line("Making the listing image…", 14f, Ui.DIM), Ui.matchWrap(dp(10f)))
        thread(name = "listing") {
            val made = try { ListingMaker.make(this, uri, box, s.target) } catch (e: Throwable) { null }
            runOnUiThread {
                listingBusy = false
                into.removeAllViews()
                if (made == null) {
                    into.addView(line("Couldn't make the listing image. Please try again.", 14f, Ui.WARN), Ui.matchWrap(dp(10f)))
                } else {
                    if (!ProStore.isPro) prefs.countListing()
                    into.addView(ImageView(this).apply { adjustViewBounds = true; setImageBitmap(made.preview); setBackgroundColor(Color.WHITE) }, Ui.matchWrap(dp(12f)))
                    into.addView(line("Saved to Pictures/Prolens Listings · ${made.size} × ${made.size} px", 13f, Ui.DIM), Ui.matchWrap(dp(6f)))
                    if (made.tooSmall) into.addView(line("Under ${s.target.minPx} px: move closer to the product next time for a sharper listing.", 13.5f, Ui.WARN), Ui.matchWrap(dp(4f)))
                    into.addView(Ui.button(this, "Share listing image", false) { share(made.uri) }, Ui.matchWrap(dp(10f)))
                    Toast.makeText(this, "Listing image saved", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun openPaywall(reason: String) {
        startActivity(Intent(this, PaywallActivity::class.java).putExtra(PaywallActivity.EXTRA_REASON, reason))
    }

    private fun line(t: String, size: Float, color: Int) = TextView(this).apply { text = t; textSize = size; setTextColor(color) }
}
