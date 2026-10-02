package com.prolens.app.ui

import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.prolens.app.billing.ProStore
import com.prolens.app.core.Features

/** What Pro adds, the one-time price, and Buy / Restore. Opened from any locked feature. */
class PaywallActivity : ComponentActivity() {
    private lateinit var buy: TextView
    private lateinit var status: TextView
    private val onChange: () -> Unit = { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.page(this)
        val dp = { v: Float -> Ui.dp(this, v) }
        col.addView(Ui.text(this, "✕", 22f, Ui.DIM).apply { setPadding(0, 0, 0, dp(8f)); setOnClickListener { finish() } })
        col.addView(Ui.text(this, "PROLENS PRO", 13f, Ui.ACCENT, true).apply { letterSpacing = 0.12f })
        col.addView(Ui.text(this, "Pay once. Shoot like a pro forever.", 28f, Ui.TEXT, true), Ui.matchWrap(dp(8f)))
        val why = intent.getStringExtra(EXTRA_REASON)
        if (why != null) col.addView(Ui.text(this, why, 15f, Ui.WARN), Ui.matchWrap(dp(12f)))

        val perks = listOf(
            "All scene presets" to "Group, Landscape, Night and Product, picked by you whenever you want",
            "Clean night shots" to "Steady long exposure on phones that support manual control",
            "Full shot review" to "Every tip after every photo, not just the first one",
            "Unlimited listing images" to "Seller Studio without the daily limit (free: ${Features.FREE_LISTINGS_PER_DAY} a day)",
            "No ads, no subscription" to "One payment, yours on every phone signed in to your Google account"
        )
        col.addView(Ui.section(this, "What you get"))
        for ((t, d) in perks) {
            col.addView(Ui.text(this, "✓  $t", 17f, Ui.TEXT, true), Ui.matchWrap(dp(10f)))
            col.addView(Ui.text(this, d, 14f, Ui.DIM).apply { setPadding(dp(26f), 0, 0, 0) })
        }

        buy = Ui.button(this, "", true) {
            val msg = ProStore.buy(this)
            if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        }
        col.addView(buy, Ui.matchWrap(dp(28f)))
        col.addView(Ui.button(this, "Restore purchase", false) {
            ProStore.refresh()
            Toast.makeText(this, "Checking Google Play…", Toast.LENGTH_SHORT).show()
        }, Ui.matchWrap(dp(10f)))
        status = Ui.text(this, "", 13f, Ui.DIM)
        col.addView(status, Ui.matchWrap(dp(14f)))
        refresh()
    }

    override fun onStart() { super.onStart(); ProStore.addListener(onChange); ProStore.refresh() }
    override fun onStop() { ProStore.removeListener(onChange); super.onStop() }

    private fun refresh() {
        if (ProStore.isPro) {
            buy.text = "You have Pro. Thank you!"
            buy.isEnabled = false
            status.text = "Pro is active on this account."
        } else {
            buy.text = "Get Pro for ${ProStore.price}"
            buy.isEnabled = true
            status.text = "Payment is handled by Google Play. Prolens never sees your card or UPI details."
        }
    }

    companion object { const val EXTRA_REASON = "reason" }
}
