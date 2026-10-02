package com.billo.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject
import androidx.webkit.WebViewAssetLoader

/**
 * Billo — thin native shell around the PWA (bundled in assets/www).
 *  • WebView with JS + DOM storage (ledger lives in localStorage)
 *  • <input type=file> bridge for the "Snap it" camera/gallery picker
 *  • Native share sheet (WhatsApp) for summaries and invites
 *  • Google Play Billing bridge for Billo Pro (see PlayBilling.kt)
 *  • Voice bills: mic in the app (VoiceInput.kt) and billo://voice for
 *    "Hey Google, add a bill in Billo" / the long-press "Voice bill" shortcut
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

    // ---- voice ----
    private var pageReady = false
    private var voiceOnLoad = false
    private var pendingLang = "en-IN"

    private val voiceDialog =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            voice.onDialogResult(result.resultCode, result.data)
        }

    private val askMic =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) voice.start(pendingLang)
            else sendVoice(JSONObject().put("type", "error").put("code", "perm").toString())
        }

    private val voice: VoiceInput by lazy { VoiceInput(this, ::sendVoice, voiceDialog) }

    private fun sendVoice(json: String) {
        runOnUiThread {
            if (::web.isInitialized) {
                web.evaluateJavascript("window.__billoVoice && window.__billoVoice(" + JSONObject.quote(json) + ")", null)
            }
        }
    }

    /** Called from JS (window.Billo.startVoice). */
    fun startVoice(lang: String) {
        runOnUiThread {
            pendingLang = if (lang.isBlank()) "en-IN" else lang
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                voice.start(pendingLang)
            } else {
                askMic.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }

    fun stopVoice() {
        runOnUiThread { voice.stop() }
    }

    fun hasVoice(): Boolean = voice.available()

    private fun isVoiceIntent(i: Intent?): Boolean {
        if (i == null) return false
        if (i.getBooleanExtra("billo_voice", false)) return true
        val d = i.data ?: return false
        return d.scheme == "billo" && d.host == "voice"
    }

    /** Opened by "Hey Google" or the shortcut → open the listening screen once the app is up. */
    private fun openVoiceScreen() {
        if (!pageReady) { voiceOnLoad = true; return }
        web.postDelayed({
            web.evaluateJavascript("window.__billoVoiceStart ? window.__billoVoiceStart() : false", null)
        }, 350)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isVoiceIntent(intent)) openVoiceScreen()
    }

    override fun onPause() {
        super.onPause()
        if (::web.isInitialized) voice.stop()
    }

    override fun onDestroy() {
        if (::web.isInitialized) voice.stop()
        super.onDestroy()
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
        voiceOnLoad = isVoiceIntent(intent)

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
            .addPathHandler("/www/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

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

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                pageReady = true
                if (voiceOnLoad) {
                    voiceOnLoad = false
                    openVoiceScreen()
                }
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
