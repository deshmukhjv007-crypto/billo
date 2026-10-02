package com.prolens.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity

/** Set this before publishing: Google Play requires a contact address in the privacy policy. */
const val SUPPORT_EMAIL = ""

object Legal {
    const val UPDATED = "2 October 2026"

    /** Same text as docs/privacy-policy.html, which is the page to host and link in Play Console. */
    val PRIVACY: List<Pair<String, String>> = listOf(
        "In short" to "Prolens works on your phone. Your photos and the camera preview are analysed on the device and are never uploaded to us or anyone else. We don't run ads and we don't sell data.",
        "Camera" to "Prolens uses the camera to show the preview, measure light, find faces and products, and take photos. Face detection runs on the phone with Google's ML Kit; no face data leaves the device or is stored.",
        "Photos you take" to "Photos and listing images are saved to your phone's gallery. You decide whether to share them. Deleting the app does not delete photos you have already saved.",
        "Purchases" to "If you buy Prolens Pro, Google Play handles the payment. We receive only a confirmation that this Google account owns Pro, which the app keeps on the phone. We never see your card, UPI or bank details.",
        "Crash reports" to "If Prolens crashes, a short technical report (app version, phone model, Android version, error details) is saved on the phone. It is sent only if you choose to share it.",
        "Children" to "Prolens is a general camera app and is not directed at children under 13.",
        "Changes" to "If this policy changes, the new version will appear in the app and on this page with a new date."
    )

    fun contactLine(): String? = if (SUPPORT_EMAIL.isBlank()) null else "Questions: $SUPPORT_EMAIL"
}

/** In-app privacy policy. */
class LegalActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.page(this)
        val dp = { v: Float -> Ui.dp(this, v) }
        col.addView(Ui.text(this, "←  Back", 15f, Ui.DIM).apply { setPadding(0, 0, 0, dp(12f)); setOnClickListener { finish() } })
        col.addView(Ui.text(this, "Privacy policy", 28f, Ui.TEXT, true))
        col.addView(Ui.text(this, "Updated ${Legal.UPDATED}", 13f, Ui.DIM), Ui.matchWrap(dp(4f)))
        for ((h, b) in Legal.PRIVACY) {
            col.addView(Ui.section(this, h))
            col.addView(Ui.text(this, b, 15.5f, Ui.TEXT))
        }
        Legal.contactLine()?.let { col.addView(Ui.text(this, it, 15f, Ui.ACCENT), Ui.matchWrap(dp(22f))) }
    }
}
