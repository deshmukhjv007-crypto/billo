package com.prolens.app.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.TextView
import com.prolens.app.core.Frame
import com.prolens.app.core.Plan
import com.prolens.app.core.Preset

/** Shared look for the camera UI: dark glass chips, one warm accent, green for "ready". */
object Ui {
    const val ACCENT = 0xFFFFB23F.toInt()
    const val READY = 0xFF5BE0A0.toInt()
    const val WARN = 0xFFFFD166.toInt()
    const val GLASS = 0x99000000.toInt()
    const val GLASS_STRONG = 0xCC000000.toInt()
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
}

/** What the review screen needs from the moment the shutter was pressed. */
object ShotStore {
    var frame: Frame? = null
    var plan: Plan? = null
    var preset: Preset = Preset.AUTO
    var settings: String = ""
    var thumb: android.graphics.Bitmap? = null
}
