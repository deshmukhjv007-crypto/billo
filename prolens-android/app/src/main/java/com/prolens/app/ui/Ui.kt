package com.prolens.app.ui

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.prolens.app.core.Frame
import com.prolens.app.core.Plan
import com.prolens.app.core.Preset
import com.prolens.app.core.Rect01
import com.prolens.app.core.SellerStatus
import com.prolens.app.core.SellerTarget

/** Shared look for the camera UI: dark glass chips, one warm accent, green for "ready". */
object Ui {
    const val ACCENT = 0xFFFFB23F.toInt()
    const val READY = 0xFF5BE0A0.toInt()
    const val WARN = 0xFFFFD166.toInt()
    const val BAD = 0xFFFF6B6B.toInt()
    const val GLASS = 0x99000000.toInt()
    const val GLASS_STRONG = 0xCC000000.toInt()
    const val CARD = 0xFF1C1C1E.toInt()
    const val TEXT = 0xFFFFFFFF.toInt()
    const val DIM = 0xB3FFFFFF.toInt()

    fun dp(ctx: Context, v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics).toInt()
    fun dpf(ctx: Context, v: Float): Float = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics)

    fun pill(color: Int, radius: Float, stroke: Int = 0, strokeColor: Int = 0): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radius
        setColor(color)
        if (stroke > 0) setStroke(stroke, strokeColor)
    }

    fun chip(ctx: Context, label: String, onClick: (View) -> Unit): TextView = TextView(ctx).apply {
        text = label
        setTextColor(TEXT)
        textSize = 13f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        gravity = Gravity.CENTER
        minHeight = dp(ctx, 36f)
        minWidth = dp(ctx, 44f)
        setPadding(dp(ctx, 14f), dp(ctx, 6f), dp(ctx, 14f), dp(ctx, 6f))
        background = pill(GLASS, dpf(ctx, 18f))
        isClickable = true
        setOnClickListener(onClick)
    }

    fun setChipState(v: TextView, selected: Boolean, suggested: Boolean = false) {
        val ctx = v.context
        v.background = when {
            selected -> pill(ACCENT, dpf(ctx, 18f))
            suggested -> pill(GLASS, dpf(ctx, 18f), dp(ctx, 2f), ACCENT)
            else -> pill(GLASS, dpf(ctx, 18f))
        }
        v.setTextColor(if (selected) Color.BLACK else TEXT)
    }

    /** A big rounded button; [primary] = accent fill with black text. */
    fun button(ctx: Context, label: String, primary: Boolean, onClick: (View) -> Unit): TextView = TextView(ctx).apply {
        text = label
        textSize = 16f
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        gravity = Gravity.CENTER
        minHeight = dp(ctx, 52f)
        setPadding(dp(ctx, 20f), dp(ctx, 12f), dp(ctx, 20f), dp(ctx, 12f))
        setTextColor(if (primary) Color.BLACK else TEXT)
        background = if (primary) pill(ACCENT, dpf(ctx, 26f)) else pill(CARD, dpf(ctx, 26f), dp(ctx, 1f), 0x33FFFFFF)
        isClickable = true
        setOnClickListener(onClick)
    }

    fun text(ctx: Context, t: CharSequence, size: Float, color: Int = TEXT, bold: Boolean = false): TextView = TextView(ctx).apply {
        text = t
        textSize = size
        setTextColor(color)
        setLineSpacing(0f, 1.15f)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
    }

    fun section(ctx: Context, t: String): TextView = text(ctx, t.uppercase(), 12f, ACCENT, true).apply {
        letterSpacing = 0.1f
        setPadding(0, dp(ctx, 22f), 0, dp(ctx, 8f))
    }

    fun matchWrap(topMargin: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { this.topMargin = topMargin }

    /** A scrolling black page that keeps clear of the status and navigation bars. Returns the column to fill. */
    fun page(a: Activity): LinearLayout {
        WindowCompat.setDecorFitsSystemWindows(a.window, false)
        val scroll = ScrollView(a).apply { setBackgroundColor(Color.BLACK); isFillViewport = true }
        val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(col)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            col.setPadding(dp(a, 20f), b.top + dp(a, 16f), dp(a, 20f), b.bottom + dp(a, 24f))
            insets
        }
        a.setContentView(scroll)
        return col
    }
}

/** What a Seller Studio shot needs on the review screen. [box] is in upright preview coordinates. */
data class SellerShot(val box: Rect01?, val target: SellerTarget, val status: SellerStatus?)

/** What the review screen needs from the moment the shutter was pressed. */
object ShotStore {
    var frame: Frame? = null
    var plan: Plan? = null
    var preset: Preset = Preset.AUTO
    var settings: String = ""
    var thumb: android.graphics.Bitmap? = null
    var seller: SellerShot? = null
}
