package com.prolens.app.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import com.prolens.app.core.Coach
import com.prolens.app.core.Cue
import com.prolens.app.core.Face
import com.prolens.app.core.Rect01
import kotlin.math.abs
import kotlin.math.min

/**
 * Everything drawn over the live preview: thirds grid, level bar, face brackets, the direction arrow
 * for the current cue, and the tap-to-focus ring. Coordinates come in upright-image space (0..1)
 * and are mapped into the letterboxed 3:4 preview area (mirrored for the front camera).
 */
class OverlayView(context: Context) : View(context) {
    var imageAspect = 3f / 4f           // upright width / height of the camera image
    var mirror = false
    var faces: List<Face> = emptyList()
    var meterBox: Rect01? = null
    var roll = 0f
    var pitch = 0f
    var levelTol = 2f
    var cue: Cue? = null
    var ready = false
    var gridOn = true

    private val d = resources.displayMetrics.density
    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40FFFFFF; strokeWidth = 1f * d; style = Paint.Style.STROKE }
    private val bracket = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 3f * d; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val level = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 3f * d; strokeCap = Paint.Cap.ROUND }
    private val tick = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x99FFFFFF.toInt(); strokeWidth = 2f * d; strokeCap = Paint.Cap.ROUND }
    private val arrow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Ui.ACCENT; strokeWidth = 5f * d; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Ui.ACCENT; strokeWidth = 2f * d; style = Paint.Style.STROKE }
    private val path = Path()
    private var tapX = -1f; private var tapY = -1f; private var tapT = 0f
    private var pulse = 0f
    private val pulser = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1100; repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE
        addUpdateListener { pulse = it.animatedValue as Float; if (cue != null) invalidate() }
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); pulser.start() }
    override fun onDetachedFromWindow() { pulser.cancel(); super.onDetachedFromWindow() }

    /** The on-screen rectangle the camera image occupies (FIT_CENTER). */
    fun content(): RectF {
        val w = width.toFloat(); val h = height.toFloat()
        if (w <= 0 || h <= 0) return RectF()
        return if (w / h > imageAspect) {
            val cw = h * imageAspect; RectF((w - cw) / 2f, 0f, (w + cw) / 2f, h)
        } else {
            val ch = w / imageAspect; RectF(0f, (h - ch) / 2f, w, (h + ch) / 2f)
        }
    }

    /** Upright-image point → view point. */
    fun toView(x: Float, y: Float): Pair<Float, Float> {
        val c = content()
        val xx = if (mirror) 1f - x else x
        return Pair(c.left + xx * c.width(), c.top + y * c.height())
    }

    fun toViewRect(r: Rect01): RectF {
        val (x0, y0) = toView(if (mirror) r.right else r.left, r.top)
        val (x1, y1) = toView(if (mirror) r.left else r.right, r.bottom)
        return RectF(x0, y0, x1, y1)
    }

    fun showTap(x: Float, y: Float) {
        tapX = x; tapY = y
        ValueAnimator.ofFloat(0f, 1f).apply { duration = 700; addUpdateListener { tapT = it.animatedValue as Float; invalidate() } }.start()
    }

    override fun onDraw(cv: Canvas) {
        val c = content()
        if (c.width() <= 0f) return

        if (gridOn) {
            for (i in 1..2) {
                val x = c.left + c.width() * i / 3f; cv.drawLine(x, c.top, x, c.bottom, grid)
                val y = c.top + c.height() * i / 3f; cv.drawLine(c.left, y, c.right, y, grid)
            }
        }

        // faces / metering box: corner brackets
        bracket.color = if (ready) Ui.READY else Ui.ACCENT
        val boxes = if (faces.isNotEmpty()) faces.map { toViewRect(it.box) } else listOfNotNull(meterBox?.let { toViewRect(it) })
        for (r in boxes) corners(cv, r, min(r.width(), r.height()) * 0.22f)

        // level bar (hidden when pointing straight down, where roll means nothing)
        if (pitch > -70f) {
            val cx = c.centerX(); val cy = c.top + c.height() * 0.62f
            val half = c.width() * 0.16f
            cv.drawLine(cx - half * 1.35f, cy, cx - half * 1.1f, cy, tick)
            cv.drawLine(cx + half * 1.1f, cy, cx + half * 1.35f, cy, tick)
            level.color = when (Coach.levelColor(roll, levelTol)) { 2 -> Ui.READY; 1 -> Ui.WARN; else -> 0xFFFFFFFF.toInt() }
            cv.save()
            cv.rotate(-roll.coerceIn(-25f, 25f), cx, cy)
            cv.drawLine(cx - half, cy, cx + half, cy, level)
            cv.restore()
        } else if (pitch < -80f) {
            // top-down: a small bubble ring means "flat"
            val cx = c.centerX(); val cy = c.centerY()
            ring.color = if (pitch < -85f) Ui.READY else Ui.WARN
            cv.drawCircle(cx, cy, 18f * d, ring)
            cv.drawCircle(cx, cy, 3f * d, ring)
        }

        cue?.let { drawCue(cv, c, it) }

        if (tapX >= 0 && tapT < 1f) {
            ring.color = Ui.ACCENT
            ring.alpha = ((1f - tapT) * 255).toInt()
            cv.drawCircle(tapX, tapY, (36f - 12f * tapT) * d, ring)
            ring.alpha = 255
        }
    }

    private fun corners(cv: Canvas, r: RectF, len: Float) {
        path.reset()
        path.moveTo(r.left, r.top + len); path.lineTo(r.left, r.top); path.lineTo(r.left + len, r.top)
        path.moveTo(r.right - len, r.top); path.lineTo(r.right, r.top); path.lineTo(r.right, r.top + len)
        path.moveTo(r.right, r.bottom - len); path.lineTo(r.right, r.bottom); path.lineTo(r.right - len, r.bottom)
        path.moveTo(r.left + len, r.bottom); path.lineTo(r.left, r.bottom); path.lineTo(r.left, r.bottom - len)
        cv.drawPath(path, bracket)
    }

    /** Chevrons show which way to move the PHONE. */
    private fun drawCue(cv: Canvas, c: RectF, cue: Cue) {
        val s = 26f * d
        val off = 10f * d * pulse
        arrow.color = Ui.ACCENT
        when (cue) {
            Cue.PAN_LEFT -> chevron(cv, c.left + 30f * d - off, c.centerY(), s, 180f)
            Cue.PAN_RIGHT -> chevron(cv, c.right - 30f * d + off, c.centerY(), s, 0f)
            Cue.TILT_UP, Cue.RAISE_PHONE -> chevron(cv, c.centerX(), c.top + 40f * d - off, s, 270f)
            Cue.TILT_DOWN, Cue.LOWER_PHONE -> chevron(cv, c.centerX(), c.bottom - 40f * d + off, s, 90f)
            Cue.STEP_BACK -> { chevron(cv, c.left + 30f * d + off, c.top + 30f * d + off, s * 0.8f, 225f); chevron(cv, c.right - 30f * d - off, c.bottom - 30f * d - off, s * 0.8f, 45f) }
            Cue.STEP_CLOSER -> { chevron(cv, c.left + 30f * d - off, c.top + 30f * d - off, s * 0.8f, 45f); chevron(cv, c.right - 30f * d + off, c.bottom - 30f * d + off, s * 0.8f, 225f) }
            Cue.ROTATE_CCW, Cue.ROTATE_CW -> {
                val cx = c.centerX(); val cy = c.top + c.height() * 0.62f - 44f * d
                val r = 34f * d
                val oval = RectF(cx - r, cy - r, cx + r, cy + r)
                val ccw = cue == Cue.ROTATE_CCW
                cv.drawArc(oval, if (ccw) 300f else 200f, 40f + 20f * pulse, false, arrow)
                val endDeg = if (ccw) 240f else 300f
                val ex = cx + r * kotlin.math.cos(Math.toRadians(endDeg.toDouble())).toFloat()
                val ey = cy + r * kotlin.math.sin(Math.toRadians(endDeg.toDouble())).toFloat()
                chevron(cv, ex, ey, s * 0.55f, if (ccw) 180f else 0f)
            }
            Cue.HOLD_STEADY -> { ring.color = Ui.WARN; cv.drawCircle(c.centerX(), c.centerY(), (40f + 8f * pulse) * d, ring) }
            Cue.READY -> {}
            else -> {}
        }
    }

    private fun chevron(cv: Canvas, x: Float, y: Float, s: Float, deg: Float) {
        cv.save()
        cv.rotate(deg, x, y)
        path.reset()
        path.moveTo(x - s * 0.5f, y - s * 0.6f); path.lineTo(x + s * 0.2f, y); path.lineTo(x - s * 0.5f, y + s * 0.6f)
        cv.drawPath(path, arrow)
        cv.restore()
    }

    @Suppress("unused") private fun near(a: Float, b: Float) = abs(a - b) < 0.5f
}
