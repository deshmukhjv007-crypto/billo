package com.prolens.app.ui

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.prolens.app.Prefs
import com.prolens.app.ProlensApp
import com.prolens.app.billing.ProStore
import com.prolens.app.camera.Analysis
import com.prolens.app.diag.DiagLog
import com.prolens.app.diag.Snap
import com.prolens.app.diag.TestScript
import com.prolens.app.camera.CameraEngine
import com.prolens.app.camera.CapabilityReader
import com.prolens.app.camera.MotionSensor
import com.prolens.app.core.Capabilities
import com.prolens.app.core.CaptureMode
import com.prolens.app.core.Coach
import com.prolens.app.core.CoachState
import com.prolens.app.core.Cue
import com.prolens.app.core.Features
import com.prolens.app.core.FlashAdvice
import com.prolens.app.core.Frame
import com.prolens.app.core.Plan
import com.prolens.app.core.Planner
import com.prolens.app.core.Preset
import com.prolens.app.core.ProductFind
import com.prolens.app.core.ProductFinder
import com.prolens.app.core.Rect01
import com.prolens.app.core.SceneClassifier
import com.prolens.app.core.SellerCheck
import com.prolens.app.core.SellerStatus
import java.io.File
import kotlin.concurrent.thread
import kotlin.math.abs

class MainActivity : ComponentActivity() {

    private lateinit var preview: PreviewView
    private lateinit var overlay: OverlayView
    private lateinit var sceneText: TextView
    private lateinit var settingsText: TextView
    private lateinit var whyText: TextView
    private lateinit var tipText: TextView
    private lateinit var tip2Text: TextView
    private lateinit var lockText: TextView
    private lateinit var shutter: ShutterButton
    private lateinit var thumb: ImageView
    private lateinit var zoomRow: LinearLayout
    private lateinit var modeRow: LinearLayout
    private lateinit var permissionView: LinearLayout
    private lateinit var sellerPanel: TextView
    private lateinit var prefs: Prefs
    private var lastFind: ProductFind? = null
    private var lastSeller: SellerStatus? = null
    private val proListener: () -> Unit = { applyPro() }
    private lateinit var testBar: LinearLayout
    private lateinit var testTitle: TextView
    private lateinit var testText: TextView
    private var shotStartMs = 0L
    private val presetChips = LinkedHashMap<Preset, TextView>()
    private val zoomChips = LinkedHashMap<Float, TextView>()
    private var hdrChip: TextView? = null
    private var nightChip: TextView? = null
    private var flashChip: TextView? = null

    private var engine: CameraEngine? = null
    private lateinit var motion: MotionSensor
    private var caps = Capabilities()
    private var planner = Planner(caps)
    private val coach = Coach()
    private val classifier = SceneClassifier()
    private var userPreset = Preset.AUTO
    private var effective = Preset.LANDSCAPE
    private var lastFrame: Frame? = null
    private var lastPlan: Plan? = null
    private var lastCoach: CoachState? = null
    private var whyOpen = false
    private var lastUiMs = 0L
    private var lastReadyHaptic = false
    private var shooting = false

    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.CAMERA] == true) startCamera() else showPermission(true)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.onboarded) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        motion = MotionSensor(this)
        setContentView(buildUi())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else requestPermissions()
        offerCrashReport()
    }

    /** If Prolens crashed last time, offer to share the report (it never leaves the phone otherwise). */
    private fun offerCrashReport() {
        val f = File(filesDir, ProlensApp.CRASH_FILE)
        if (!f.exists()) return
        val report = try { f.readText() } catch (e: Throwable) { "" }
        f.delete()
        if (report.isBlank()) return
        AlertDialog.Builder(this)
            .setTitle("Prolens closed unexpectedly")
            .setMessage("Sorry about that. Sharing the technical report helps fix it. It contains the app version, phone model and error details, but no photos.")
            .setPositiveButton("Share report") { _, _ ->
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, "Prolens crash report")
                    .putExtra(Intent.EXTRA_TEXT, report.take(8000))
                if (SUPPORT_EMAIL.isNotBlank()) send.putExtra(Intent.EXTRA_EMAIL, arrayOf(SUPPORT_EMAIL))
                startActivity(Intent.createChooser(send, "Share report"))
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun requestPermissions() {
        val perms = mutableListOf(Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) perms += Manifest.permission.WRITE_EXTERNAL_STORAGE
        askCamera.launch(perms.toTypedArray())
    }

    override fun onResume() {
        super.onResume()
        motion.start()
        ShotStore.thumb?.let { thumb.setImageBitmap(it) }
        overlay.gridOn = prefs.grid
        overlay.sellerTarget = prefs.sellerTarget
        ProStore.addListener(proListener)
        ProStore.refresh()
        applyPro()
        refreshTestBar()
        DiagLog.event("screen", DiagLog.obj("name" to "camera", "pro" to ProStore.isPro))
        if (prefs.testMode && engine != null) stepStarted()
    }
    override fun onPause() { ProStore.removeListener(proListener); motion.stop(); super.onPause() }
    override fun onDestroy() { engine?.shutdown(); super.onDestroy() }

    /** Pro status changed (or the screen came back): unlock or lock features to match. */
    private fun applyPro() {
        val pro = ProStore.isPro
        planner.allowManualNight = pro
        for ((p, v) in presetChips) v.text = if (Features.presetAllowed(p, pro)) p.label else "${p.label} 🔒"
        if (!Features.presetAllowed(userPreset, pro)) selectPreset(Preset.AUTO)
    }

    // ------------------------------------------------------------------ test mode

    private fun buildTestBar(): LinearLayout {
        val dp = { v: Float -> Ui.dp(this, v) }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.pill(0xE61C1C1E.toInt(), Ui.dpf(this@MainActivity, 14f), dp(1f), Ui.ACCENT)
            setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
            visibility = View.GONE
        }
        testTitle = Ui.text(this, "", 13f, Ui.ACCENT, true)
        testText = Ui.text(this, "", 12.5f, Ui.TEXT)
        bar.addView(testTitle)
        bar.addView(testText, Ui.matchWrap(dp(2f)))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(3f); rightMargin = dp(3f) } }
        row.addView(Ui.chip(this, "✓ Worked") { answerStep("pass", null) }, lp())
        row.addView(Ui.chip(this, "✕ Not right") { askWhatWasWrong() }, lp())
        row.addView(Ui.chip(this, "Skip") { answerStep("skip", null) }, lp())
        bar.addView(row, Ui.matchWrap(dp(6f)))
        return bar
    }

    private fun refreshTestBar() {
        if (!this::testBar.isInitialized) return
        if (!prefs.testMode) { testBar.visibility = View.GONE; return }
        testBar.visibility = View.VISIBLE
        val i = prefs.testStep
        val steps = TestScript.steps
        if (i >= steps.size) {
            testTitle.text = "TEST COMPLETE"
            testText.text = "Thank you! Share the report: Settings → Test mode → Share test report. Tap ✓ to hide this bar."
            return
        }
        val st = steps[i]
        testTitle.text = "TEST ${i + 1}/${steps.size} · ${st.title.uppercase()}"
        testText.text = "Do: ${st.todo}\nShould: ${st.expect}"
    }

    private fun stepStarted() {
        val st = TestScript.steps.getOrNull(prefs.testStep) ?: return
        DiagLog.event("step_start", DiagLog.obj("step" to st.id, "n" to prefs.testStep + 1))
    }

    private fun askWhatWasWrong() {
        val input = android.widget.EditText(this).apply { hint = "What happened instead? (optional)" }
        AlertDialog.Builder(this)
            .setTitle("What wasn't right?")
            .setView(input)
            .setPositiveButton("Save") { _, _ -> answerStep("fail", input.text?.toString()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun answerStep(verdict: String, note: String?) {
        val steps = TestScript.steps
        val i = prefs.testStep
        if (i >= steps.size) { prefs.testMode = false; DiagLog.setEnabled(false); refreshTestBar(); return }
        val now = lastFrame?.let { f -> lastPlan?.let { p -> lastCoach?.let { c -> Snap.frame(f, userPreset, effective, p, c, lastSeller, lastFind, tipText.text?.toString()) } } }
        DiagLog.event("step_result", DiagLog.obj("step" to steps[i].id, "n" to i + 1, "verdict" to verdict, "note" to note, "state" to now))
        prefs.testStep = i + 1
        refreshTestBar()
        stepStarted()
        Toast.makeText(this, if (verdict == "fail") "Noted. Thanks!" else "Next test", Toast.LENGTH_SHORT).show()
    }

    private fun openPaywall(reason: String) {
        DiagLog.event("paywall", DiagLog.obj("reason" to reason))
        startActivity(Intent(this, PaywallActivity::class.java).putExtra(PaywallActivity.EXTRA_REASON, reason))
    }

    // ------------------------------------------------------------------ UI

    private fun buildUi(): View {
        val dp = { v: Float -> Ui.dp(this, v) }
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        preview = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FIT_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        overlay = OverlayView(this)
        overlay.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP) {
                DiagLog.event("tap_focus", DiagLog.obj("x" to e.x / v.width.coerceAtLeast(1), "y" to e.y / v.height.coerceAtLeast(1)))
                engine?.focusAt(e.x, e.y)
                overlay.showTap(e.x, e.y)
                planner.locked = true
                v.performClick()
                refreshLock()
            }
            true
        }
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // ---- top: presets + what the camera is doing
        val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12f), dp(8f), dp(12f), 0) }
        val presetRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (p in Preset.values()) {
            val chip = Ui.chip(this, p.label) { selectPreset(p) }
            presetChips[p] = chip
            presetRow.addView(chip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8f) })
        }
        val scroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(presetRow) }
        val topRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        topRow.addView(scroll, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val gear = Ui.chip(this, "⚙") { startActivity(Intent(this, SettingsActivity::class.java)) }.apply { textSize = 18f; contentDescription = "Settings" }
        topRow.addView(gear, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(8f) })
        top.addView(topRow)

        val status = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.pill(Ui.GLASS, Ui.dpf(this@MainActivity, 14f))
            setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
            setOnClickListener { whyOpen = !whyOpen; whyText.visibility = if (whyOpen) View.VISIBLE else View.GONE }
        }
        val statusLine = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        sceneText = TextView(this).apply { setTextColor(Ui.ACCENT); textSize = 12f; typeface = Typeface.create("sans-serif-medium", Typeface.BOLD); letterSpacing = 0.08f }
        settingsText = TextView(this).apply { setTextColor(Ui.TEXT); textSize = 13f; typeface = Typeface.MONOSPACE; setPadding(dp(10f), 0, 0, 0) }
        lockText = TextView(this).apply {
            text = "AE LOCK ✕"; setTextColor(Color.BLACK); textSize = 11f; visibility = View.GONE
            background = Ui.pill(Ui.WARN, Ui.dpf(this@MainActivity, 10f)); setPadding(dp(8f), dp(2f), dp(8f), dp(2f))
            setOnClickListener { planner.locked = false; refreshLock() }
        }
        statusLine.addView(sceneText)
        statusLine.addView(settingsText, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        statusLine.addView(lockText)
        whyText = TextView(this).apply { setTextColor(Ui.DIM); textSize = 12.5f; visibility = View.GONE; setPadding(0, dp(6f), 0, 0); setLineSpacing(0f, 1.15f) }
        status.addView(statusLine)
        status.addView(whyText)
        top.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8f) })

        tipText = TextView(this).apply {
            setTextColor(Ui.TEXT); textSize = 16f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER; background = Ui.pill(Ui.GLASS_STRONG, Ui.dpf(this@MainActivity, 22f))
            setPadding(dp(18f), dp(10f), dp(18f), dp(10f)); visibility = View.INVISIBLE
        }
        tip2Text = TextView(this).apply {
            setTextColor(Ui.DIM); textSize = 13f; gravity = Gravity.CENTER; background = Ui.pill(Ui.GLASS, Ui.dpf(this@MainActivity, 16f))
            setPadding(dp(12f), dp(6f), dp(12f), dp(6f)); visibility = View.GONE
        }
        val tips = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        tips.addView(tipText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        tips.addView(tip2Text, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6f) })
        top.addView(tips, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14f) })
        sellerPanel = TextView(this).apply {
            setTextColor(Ui.TEXT); textSize = 13f; setLineSpacing(0f, 1.25f); visibility = View.GONE
            background = Ui.pill(Ui.GLASS_STRONG, Ui.dpf(this@MainActivity, 14f))
            setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
        }
        top.addView(sellerPanel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10f) })
        root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        // ---- bottom: modes + zoom, then thumb / shutter / flip
        val bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(16f), 0, dp(16f), dp(18f)) }
        modeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        zoomRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        testBar = buildTestBar()
        bottom.addView(testBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10f) })
        bottom.addView(modeRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        bottom.addView(zoomRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10f) })
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        thumb = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = Ui.pill(Ui.GLASS, Ui.dpf(this@MainActivity, 12f))
            clipToOutline = true
            contentDescription = "Last photo"
            setOnClickListener { lastUri?.let { openReview(it) } }
        }
        shutter = ShutterButton(this).apply { setOnClickListener { shoot() } }
        val flip = Ui.chip(this, "⟲") { flipCamera() }.apply { textSize = 22f; contentDescription = "Switch camera" }
        controls.addView(thumb, LinearLayout.LayoutParams(dp(52f), dp(52f)))
        controls.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        controls.addView(shutter, LinearLayout.LayoutParams(dp(82f), dp(82f)))
        controls.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        controls.addView(flip, LinearLayout.LayoutParams(dp(52f), dp(52f)))
        bottom.addView(controls, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14f) })
        root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))

        // ---- permission screen
        permissionView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK); visibility = View.GONE
            setPadding(dp(32f), dp(32f), dp(32f), dp(32f))
            addView(TextView(this@MainActivity).apply {
                text = "Prolens needs the camera to coach your shots.\nPhotos are analysed on your phone and never uploaded."
                setTextColor(Ui.TEXT); textSize = 16f; gravity = Gravity.CENTER
            })
            addView(Ui.chip(this@MainActivity, "Allow camera") {
                if (shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) ||
                    ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_DENIED) requestPermissions()
                else startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20f) })
        }
        root.addView(permissionView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // keep the bars clear of the status / navigation bars
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            top.setPadding(dp(12f), bars.top + dp(8f), dp(12f), 0)
            bottom.setPadding(dp(16f), 0, dp(16f), bars.bottom + dp(18f))
            insets
        }
        refreshPresetChips()
        return root
    }

    private fun showPermission(show: Boolean) { permissionView.visibility = if (show) View.VISIBLE else View.GONE }

    // ------------------------------------------------------------------ camera

    private fun startCamera() {
        showPermission(false)
        if (engine != null) return
        engine = CameraEngine(this, this, preview,
            onFrame = { onFrame(it) },
            onReady = { onCameraReady(it) },
            onError = { DiagLog.event("camera_error", DiagLog.obj("msg" to it)); Toast.makeText(this, it, Toast.LENGTH_LONG).show() })
        engine?.start()
    }

    private fun onCameraReady(c: Capabilities) {
        caps = c
        planner = Planner(c)
        planner.allowManualNight = ProStore.isPro
        coach.reset()
        buildModeAndZoomChips()
        whyText.text = "This camera: " + CapabilityReader.describe(c)
        DiagLog.event("camera_ready", Snap.caps(c).put("front", engine?.front == true).put("summary", CapabilityReader.describe(c)))
        if (prefs.testMode) stepStarted()
    }

    private fun flipCamera() {
        DiagLog.event("flip", DiagLog.obj("toFront" to (engine?.front != true)))
        engine?.flip()
        overlay.mirror = engine?.front == true
        planner.reset()
    }

    private fun selectPreset(p: Preset) {
        if (!Features.presetAllowed(p, ProStore.isPro)) {
            openPaywall("${p.label} is part of Prolens Pro. Auto still uses it for you when it fits the scene.")
            return
        }
        DiagLog.event("preset", DiagLog.obj("to" to p.name))
        userPreset = p
        classifier.reset()
        coach.reset()
        planner.reset()
        planner.locked = false
        refreshLock()
        val e = engine ?: return refreshPresetChips()
        p.rules.zoom?.let { z -> if (!e.front) e.setZoom(z.coerceIn(caps.zoomMin, caps.zoomMax)) }
        if ((p == Preset.LANDSCAPE || p == Preset.SELLER) && !e.front && e.zoom != 1f && caps.zoomMin <= 1f) e.setZoom(1f)
        when {
            p == Preset.NIGHT && caps.nightExtension -> e.setMode(CaptureMode.NIGHT)
            p != Preset.NIGHT && e.mode == CaptureMode.NIGHT -> e.setMode(CaptureMode.STANDARD)
        }
        refreshPresetChips()
        refreshZoomChips(null)
        Toast.makeText(this, p.rules.hint, Toast.LENGTH_SHORT).show()
        if (p != Preset.SELLER) { overlay.sellerOn = false; sellerPanel.visibility = View.GONE; lastFind = null; lastSeller = null }
    }

    private fun buildModeAndZoomChips() {
        val dp = { v: Float -> Ui.dp(this, v) }
        modeRow.removeAllViews(); zoomRow.removeAllViews(); zoomChips.clear()
        hdrChip = null; nightChip = null; flashChip = null
        val lp = { LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(4f); rightMargin = dp(4f) } }
        if (caps.hdrExtension) hdrChip = Ui.chip(this, "HDR") {
            engine?.let { it.setMode(if (it.mode == CaptureMode.HDR) CaptureMode.STANDARD else CaptureMode.HDR); DiagLog.event("mode", DiagLog.obj("to" to it.mode.name)) }
        }.also { modeRow.addView(it, lp()) }
        if (caps.nightExtension) nightChip = Ui.chip(this, "Night") {
            engine?.let { it.setMode(if (it.mode == CaptureMode.NIGHT) CaptureMode.STANDARD else CaptureMode.NIGHT); DiagLog.event("mode", DiagLog.obj("to" to it.mode.name)) }
        }.also { modeRow.addView(it, lp()) }
        if (caps.hasFlash) flashChip = Ui.chip(this, "Flash off") {
            engine?.let { it.setFlash(!it.flashOn); (flashChip)?.text = if (it.flashOn) "Flash on" else "Flash off" }
        }.also { modeRow.addView(it, lp()) }

        val stops = ArrayList<Float>()
        if (caps.zoomMin < 0.95f) stops += caps.zoomMin
        stops += 1f
        if (caps.zoomMax >= 2f) stops += 2f
        if (caps.zoomMax >= 5f) stops += 5f
        for (z in stops) {
            val label = if (z < 1f) String.format(java.util.Locale.US, "%.1f", z) else "${z.toInt()}×"
            val chip = Ui.chip(this, label) { engine?.setZoom(z); refreshZoomChips(null); DiagLog.event("zoom", DiagLog.obj("to" to z)) }
            zoomChips[z] = chip
            zoomRow.addView(chip, lp())
        }
        refreshZoomChips(null)
    }

    private fun refreshPresetChips() {
        for ((p, v) in presetChips) Ui.setChipState(v, p == userPreset, userPreset == Preset.AUTO && p == effective)
    }

    private fun refreshZoomChips(suggest: Float?) {
        val z = engine?.zoom ?: 1f
        for ((k, v) in zoomChips) Ui.setChipState(v, abs(k - z) < 0.05f, suggest != null && abs(k - suggest) < 0.05f && abs(k - z) >= 0.05f)
    }

    private fun refreshLock() { lockText.visibility = if (planner.locked) View.VISIBLE else View.GONE }

    // ------------------------------------------------------------------ the loop

    private fun onFrame(a: Analysis) {
        val e = engine ?: return
        overlay.imageAspect = a.uprightW.toFloat() / a.uprightH.toFloat()
        overlay.mirror = e.front
        val face = a.faces.maxByOrNull { it.box.area }
        val rulesNow = (if (userPreset == Preset.AUTO) effective else userPreset).rules
        val subjectBox = when {
            face != null -> Rect01(face.box.left + face.box.width * 0.2f, face.box.top + face.box.height * 0.25f,
                face.box.right - face.box.width * 0.2f, face.box.bottom - face.box.height * 0.15f)
            rulesNow.focusBox != null -> Rect01.centered(rulesNow.focusBox)
            else -> null
        }
        val frame = Frame(
            luma = a.luma, tint = a.tint, faces = a.faces,
            subject = subjectBox?.let { a.region(it) },
            rollDeg = motion.roll, pitchDeg = motion.pitch(e.front), shake = motion.shake,
            camera = e.state(), timeMs = a.timeMs
        )
        effective = if (userPreset == Preset.AUTO) classifier.update(frame) else userPreset
        val plan = planner.plan(frame, effective)
        e.apply(plan, { r -> overlay.toView(r.cx, r.cy) }, a.timeMs)
        val cs = coach.update(frame, effective, plan)
        lastFrame = frame; lastPlan = plan; lastCoach = cs

        // Seller Studio: find the product and run the listing checklist
        val seller = effective == Preset.SELLER
        val status: SellerStatus? = if (seller) {
            val find = ProductFinder.find(a.stats.snapshot(), a.stats.gw, a.stats.gh)
            lastFind = find
            SellerCheck.live(find, frame, prefs.sellerTarget, a.uprightW.toFloat() / a.uprightH.toFloat())
        } else null
        lastSeller = status
        overlay.sellerOn = seller
        overlay.productBox = lastFind?.takeIf { seller }?.box

        // overlay every frame (cheap), text at most ~6×/s
        overlay.faces = a.faces
        overlay.meterBox = plan.meteringBox
        overlay.roll = frame.rollDeg
        overlay.pitch = frame.pitchDeg
        overlay.levelTol = effective.rules.levelTol
        overlay.cue = if (prefs.tips && status == null) cs.tip?.cue else null
        val ready = if (status != null) status.ready else cs.ready
        overlay.ready = ready
        overlay.invalidate()
        shutter.readiness = if (status != null) status.items.count { it.ok }.toFloat() / status.items.size.coerceAtLeast(1) else cs.readiness
        shutter.ready = ready
        if (ready && !lastReadyHaptic && prefs.haptics) shutter.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        lastReadyHaptic = ready

        if (DiagLog.frameDue(a.timeMs)) {
            val shown = if (status != null) (status.firstProblem?.text ?: "Listing-ready") else if (prefs.tips) cs.tip?.text else null
            DiagLog.frame(a.timeMs, Snap.frame(frame, userPreset, effective, plan, cs, status, lastFind.takeIf { status != null }, shown))
        }

        if (a.timeMs - lastUiMs < 160) return
        lastUiMs = a.timeMs
        sceneText.text = (if (userPreset == Preset.AUTO) "AUTO · " else "") + effective.label.uppercase()
        settingsText.text = Planner.summary(e.state(), caps) + if (plan.meteringBox != null) (if (a.faces.isNotEmpty()) " · face" else " · centre") else ""
        whyText.text = (plan.reasons + listOf("This camera: " + CapabilityReader.describe(caps))).joinToString("\n") { "• $it" }
        if (status != null) {
            // the checklist is the coach in Seller Studio
            val problem = status.firstProblem
            tipText.visibility = View.VISIBLE
            tipText.text = problem?.text ?: "Listing-ready: take the shot"
            tipText.setTextColor(if (problem == null) Ui.READY else Ui.TEXT)
            tip2Text.visibility = View.GONE
            sellerPanel.visibility = View.VISIBLE
            sellerPanel.text = status.items.joinToString("\n") { (if (it.ok) "✓  " else "✕  ") + it.text }
        } else {
            sellerPanel.visibility = View.GONE
            val tip = if (prefs.tips) cs.tip else cs.tip?.takeIf { it.cue == Cue.READY }
            if (tip == null) tipText.visibility = View.INVISIBLE
            else {
                tipText.visibility = View.VISIBLE
                tipText.text = tip.text
                tipText.setTextColor(if (tip.cue == Cue.READY) Ui.READY else Ui.TEXT)
            }
            val sec = if (prefs.tips) cs.secondary else null
            if (sec == null) tip2Text.visibility = View.GONE else { tip2Text.visibility = View.VISIBLE; tip2Text.text = sec.text }
        }
        refreshPresetChips()
        refreshZoomChips(plan.zoomSuggestion)
        hdrChip?.let { Ui.setChipState(it, e.mode == CaptureMode.HDR, plan.mode == CaptureMode.HDR && e.mode != CaptureMode.HDR) }
        nightChip?.let { Ui.setChipState(it, e.mode == CaptureMode.NIGHT, plan.mode == CaptureMode.NIGHT && e.mode != CaptureMode.NIGHT) }
        flashChip?.let { Ui.setChipState(it, e.flashOn, plan.flash == FlashAdvice.SUGGEST_ON && !e.flashOn) }
    }

    // ------------------------------------------------------------------ capture

    private var lastUri: Uri? = null

    private fun shoot() {
        val e = engine ?: return
        if (shooting) return
        shooting = true
        shutter.busy = true
        if (prefs.haptics) shutter.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        ShotStore.frame = lastFrame
        ShotStore.plan = lastPlan
        ShotStore.preset = effective
        ShotStore.settings = Planner.summary(e.state(), caps)
        val sellerShot = effective == Preset.SELLER
        ShotStore.seller = if (sellerShot) SellerShot(lastFind?.box?.takeIf { it.width < 0.99f || it.height < 0.99f }, prefs.sellerTarget, lastSeller) else null
        if (lastPlan?.mode == CaptureMode.MANUAL_NIGHT) Toast.makeText(this, "Hold still…", Toast.LENGTH_SHORT).show()
        shotStartMs = System.currentTimeMillis()
        DiagLog.event("shutter", DiagLog.obj("scene" to effective.name, "settings" to ShotStore.settings, "planMode" to lastPlan?.mode?.name,
            "camMode" to e.mode.name, "ready" to shutter.ready, "sellerReady" to lastSeller?.ready))
        e.takePhoto(lastPlan, prefs.albumPath, onSaved = { uri ->
            DiagLog.event("photo_saved", DiagLog.obj("ms" to System.currentTimeMillis() - shotStartMs, "album" to prefs.albumPath))
            shooting = false; shutter.busy = false
            lastUri = uri
            if (prefs.autoReview || sellerShot) openReview(uri)
            else {
                Toast.makeText(this, "Saved to your gallery", Toast.LENGTH_SHORT).show()
                loadThumb(uri)
            }
        }, onFail = { msg ->
            DiagLog.event("photo_failed", DiagLog.obj("msg" to msg))
            shooting = false; shutter.busy = false
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        })
    }

    private fun openReview(uri: Uri) {
        startActivity(Intent(this, ReviewActivity::class.java).setData(uri))
    }

    private fun loadThumb(uri: Uri) {
        thread(name = "thumb") {
            val b = Photos.decodeUpright(this, uri, 320) ?: return@thread
            val t = android.graphics.Bitmap.createScaledBitmap(b, 160, kotlin.math.max(1, 160 * b.height / b.width), true)
            runOnUiThread { ShotStore.thumb = t; thumb.setImageBitmap(t) }
        }
    }
}
