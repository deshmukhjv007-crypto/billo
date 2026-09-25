package com.prolens.app.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.min

/** Shutter with a readiness ring: it fills as the shot gets better and turns green when it's ready. */
class ShutterButton(context: Context) : View(context) {
    var readiness = 0f
        set(v) { field = v.coerceIn(0f, 1f); invalidate() }
    var ready = false
        set(v) { field = v; invalidate() }
    var busy = false
        set(v) { field = v; invalidate() }

    private val d = resources.displayMetrics.density
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4f * d; color = 0x55FFFFFF }
    private val prog = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 4f * d; strokeCap = Paint.Cap.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
    private var pressed = false
    private val oval = RectF()

    init {
        isClickable = true
        contentDescription = "Take photo"
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { pressed = true; invalidate() }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { pressed = false; invalidate() }
        }
        return super.onTouchEvent(e)
    }

    override fun onDraw(cv: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val r = min(width, height) / 2f - 4f * d
        oval.set(cx - r, cy - r, cx + r, cy + r)
        cv.drawArc(oval, 0f, 360f, false, track)
        prog.color = if (ready) Ui.READY else Ui.ACCENT
        cv.drawArc(oval, -90f, 360f * (if (ready) 1f else readiness), false, prog)
        fill.color = if (busy) 0xFF888888.toInt() else 0xFFFFFFFF.toInt()
        cv.drawCircle(cx, cy, r * (if (pressed) 0.72f else 0.8f), fill)
    }
}
