package com.billo.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.text.Html
import android.widget.Toast
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import java.io.ByteArrayInputStream
import java.io.IOException

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

    private companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
    }

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
        // The service worker fetches files too — send those through the same asset reader.
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    serveAsset(request.url)
            })
        } catch (_: Throwable) {
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                serveAsset(request.url)

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

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) mainFrameFailed("" + error.errorCode + " " + error.description)
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

    /**
     * https://appassets.androidplatform.net/www/x → the bundled file assets/www/x.
     * Missing files get a real 404 (not a broken response) so the page can carry on.
     */
    private fun serveAsset(uri: Uri): WebResourceResponse? {
        if (uri.host != ASSET_HOST) return null
        var path = (uri.path ?: "/").removePrefix("/")
        if (path.isEmpty() || path.endsWith("/")) path += "index.html"
        val mime = mimeFor(path)
        val text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("+json")
        return try {
            WebResourceResponse(mime, if (text) "UTF-8" else null, assets.open(path))
        } catch (e: IOException) {
            WebResourceResponse(
                "text/plain", "UTF-8", 404, "Not Found",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(("Billo: file not found in the app: " + path).toByteArray())
            )
        }
    }

    private var fallbackTried = false

    /**
     * The normal load failed. Plan B: read index.html ourselves and hand it to the WebView with the
     * same web address, so storage and all the other files keep working. If even that isn't possible,
     * show what's wrong (version + what's inside the app) instead of a blank error.
     */
    private fun mainFrameFailed(why: String) {
        val ver = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
        val html = try { assets.open("www/index.html").bufferedReader().use { it.readText() } } catch (_: Exception) { null }
        if (html != null && !fallbackTried) {
            fallbackTried = true
            web.post {
                web.loadDataWithBaseURL("https://$ASSET_HOST/www/index.html", html, "text/html", "UTF-8", null)
                Toast.makeText(this, "Billo $ver — loaded in safe mode ($why)", Toast.LENGTH_LONG).show()
            }
            return
        }
        val inside = try { (assets.list("www") ?: emptyArray()).joinToString(", ") } catch (_: Exception) { "(can't list)" }
        val page = "<body style='font-family:sans-serif;padding:20px;background:#0B0C10;color:#F2F3F7'>" +
            "<h2>Billo couldn't open</h2><p>Version " + Html.escapeHtml(ver ?: "?") + "</p>" +
            "<p>Error: " + Html.escapeHtml(why) + "</p>" +
            "<p>index.html in app: " + (if (html != null) "yes, " + html.length + " chars" else "NO") + "</p>" +
            "<p>Files in www: " + Html.escapeHtml(inside) + "</p>" +
            "<p>Send a screenshot of this screen.</p></body>"
        web.post { web.loadDataWithBaseURL(null, page, "text/html", "UTF-8", null) }
    }

    private fun mimeFor(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "wasm" -> "application/wasm"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "svg" -> "image/svg+xml"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
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
