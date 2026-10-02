package com.prolens.app.ui

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.prolens.app.Prefs

/** Three short pages on first launch: what Prolens does, how to follow it, and Seller Studio. */
class OnboardingActivity : ComponentActivity() {
    private val pages = listOf(
        Triple("1 / 3", "Prolens sets your camera for every shot",
            "It reads what your phone's camera can do, then adjusts exposure, focus, HDR and Night mode for each scene. You just point and shoot."),
        Triple("2 / 3", "Follow the tips, shoot on green",
            "Arrows and short tips tell you how to hold the phone. When the ring around the shutter turns green, the shot is ready. Tap the screen to focus or lock exposure."),
        Triple("3 / 3", "Seller Studio for product photos",
            "Make listing-ready images for Amazon, Flipkart, Meesho and Instagram. Everything happens on your phone: your photos are never uploaded.")
    )
    private var index = 0
    private lateinit var step: TextView
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var next: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val dp = { v: Float -> Ui.dp(this, v) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            gravity = Gravity.CENTER_VERTICAL
        }
        val skip = Ui.text(this, "Skip", 15f, Ui.DIM).apply {
            gravity = Gravity.END
            setPadding(dp(8f), dp(8f), dp(8f), dp(8f))
            setOnClickListener { finishOnboarding() }
        }
        root.addView(skip, Ui.matchWrap())
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        step = Ui.text(this, "", 13f, Ui.ACCENT, true).apply { letterSpacing = 0.1f }
        title = Ui.text(this, "", 30f, Ui.TEXT, true)
        body = Ui.text(this, "", 17f, Ui.DIM)
        root.addView(step, Ui.matchWrap())
        root.addView(title, Ui.matchWrap(dp(10f)))
        root.addView(body, Ui.matchWrap(dp(16f)))
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        next = Ui.button(this, "Next", true) {
            if (index < pages.size - 1) { index++; show() } else finishOnboarding()
        }
        root.addView(next, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            root.setPadding(dp(24f), b.top + dp(12f), dp(24f), b.bottom + dp(24f))
            insets
        }
        setContentView(root)
        show()
    }

    private fun show() {
        val p = pages[index]
        step.text = p.first
        title.text = p.second
        body.text = p.third
        next.text = if (index == pages.size - 1) "Start shooting" else "Next"
    }

    private fun finishOnboarding() {
        Prefs(this).onboarded = true
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
