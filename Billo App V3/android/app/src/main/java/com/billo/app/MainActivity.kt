package com.billo.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewAssetLoaderWebViewClient

/**
 * Billo — thin native shell around the PWA (bundled in assets/www).
 *  • WebView with JS + DOM storage (ledger lives in localStorage)
 *  • <input type=file> bridge for the "Snap it" camera/gallery picker
 *  • Native share sheet (WhatsApp) for summaries and invites
 *  • Google Play Billing bridge for Billo Pro (see PlayBilling.kt)
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFile =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = fileCallback
            fileCallback = null
            if (result.resultCode == RESULT_OK) {
                val uri = result.data?.data
                cb?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            } else {
                cb?.onReceiveValue(null)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                cacheMode = WebSettings.LOAD_DEFAULT
            }
        }
        setContentView(web)

        web.addJavascriptInterface(BilloWebBridge(this), "Billo")

        // Bill photo picker (camera + gallery) for <input type=file>
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams
            ): Boolean {
                fileCallback = callback
                try {
                    pickFile.launch(params.createIntent())
                } catch (e: Exception) {
                    callback.onReceiveValue(null)
                    fileCallback = null
                }
                return true
            }
        }

        // Serve assets over an internal HTTPS origin (https://appassets.androidplatform.net)
        // so Web Workers (on-device OCR) and the service worker work, exactly like a real site.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/www/", WebViewAssetLoader.AssetsPathHandler("www"))
            .build()
        web.webViewClient = object : WebViewAssetLoaderWebViewClient(assetLoader) {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("https://appassets.androidplatform.net/")) return false
                // external links (Play Store, privacy policy) open in the browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: Exception) {
                }
                return true
            }
        }

        web.loadUrl("https://appassets.androidplatform.net/www/index.html")

        PlayBilling.init(this)
    }

    /** Called by PlayBilling after a (restored or fresh) Pro purchase. */
    fun unlockPro() {
        web.evaluateJavascript("window.__billoPro && window.__billoPro();", null)
    }

    /**
     * Hardware / gesture back → the app's own back stack.
     * JS returns 1 when it handled the back (previous screen or modal closed),
     * 0 when the app is at its root screen (then the app exits, as usual).
     */
    private var backBusy = false

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (backBusy) return
        backBusy = true
        web.evaluateJavascript("window.__billoBack ? window.__billoBack() : 0") { res ->
            backBusy = false
            if (res == "0" || res == "null") finish()
        }
    }
}
