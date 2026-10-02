package com.billo.app

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface

/**
 * JS ↔ native bridge. Exposed to the web app as `window.Billo`.
 */
class BilloWebBridge(private val activity: MainActivity) {

    /** Share text via the Android share sheet (WhatsApp etc.). */
    @JavascriptInterface
    fun shareText(text: String) {
        activity.runOnUiThread {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
            activity.startActivity(Intent.createChooser(intent, null))
        }
    }

    /** Open an external URL (Play Store, privacy policy) in the browser. */
    @JavascriptInterface
    fun openExternal(url: String) {
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (_: Exception) {
            }
        }
    }

    /** Whether Pro is unlocked on this device. */
    @JavascriptInterface
    fun isPro(): Boolean = PlayBilling.isPro(activity)

    /** Start the Play Billing flow for a Pro product (pro_monthly / pro_annual / pro_lifetime). */
    @JavascriptInterface
    fun buyPro(productId: String) = PlayBilling.buy(activity, productId)

    /** Voice bills: start listening. Results arrive in window.__billoVoice(...). */
    @JavascriptInterface
    fun startVoice(lang: String) = activity.startVoice(lang)

    @JavascriptInterface
    fun stopVoice() = activity.stopVoice()

    /** Whether this phone has speech recognition. */
    @JavascriptInterface
    fun hasVoice(): Boolean = activity.hasVoice()
}
