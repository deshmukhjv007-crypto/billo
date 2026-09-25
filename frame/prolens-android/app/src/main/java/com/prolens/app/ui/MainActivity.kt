package com.prolens.app.ui

import android.Manifest
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
import com.prolens.app.camera.Analysis
import com.prolens.app.camera.CameraEngine
import com.prolens.app.camera.CapabilityReader
import com.prolens.app.camera.MotionSensor
import com.prolens.app.core.Capabilities
import com.prolens.app.core.CaptureMode
import com.prolens.app.core.Coach
import com.prolens.app.core.CoachState
import com.prolens.app.core.Cue
import com.prolens.app.core.FlashAdvice
import com.prolens.app.core.Frame
import com.prolens.app.core.Plan
import com.prolens.app.core.Planner
import com.prolens.app.core.Preset
import com.prolens.app.core.Rect01
import com.prolens.app.core.SceneClassifier
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
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        motion = MotionSensor(this)
        setContentView(buildUi())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else requestPermissions()
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
    }
    override fun onPause() { motion.stop(); super.onPause() }
    override fun onDestroy() { engine?.shutdown(); super.onDestroy() }

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
        top.addView(scroll)

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
        root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        // ---- bottom: modes + zoom, then thumb / shutter / flip
        val bottom = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(16f), 0, dp(16f), dp(18f)) }
        modeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        zoomRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
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
            onError = { Toast.makeText(this, it, Toast.LENGTH_LONG).show() })
        engine?.start()
    }

    private fun onCameraReady(c: Capabilities) {
        caps = c
        planner = Planner(c)
        coach.reset()
        buildModeAndZoomChips()
        whyText.text = "This camera: " + CapabilityReader.describe(c)
    }

    private fun flipCamera() {
        engine?.flip()
        overlay.mirror = engine?.front == true
        planner.reset()
    }

    private fun selectPreset(p: Preset) {
        userPreset = p
        classifier.reset()
        coach.reset()
        planner.reset()
        planner.locked = false
        refreshLock()
        val e = engine ?: return refreshPresetChips()
        p.rules.zoom?.let { z -> if (!e.front) e.setZoom(z.coerceIn(caps.zoomMin, caps.zoomMax)) }
        if (p == Preset.LANDSCAPE && caps.zoomMin < 1f && !e.front) e.setZoom(1f)
        when {
            p == Preset.NIGHT && caps.nightExtension -> e.setMode(CaptureMode.NIGHT)
            p != Preset.NIGHT && e.mode == CaptureMode.NIGHT -> e.setMode(CaptureMode.STANDARD)
        }
        refreshPresetChips()
        refreshZoomChips(null)
        Toast.makeText(this, p.rules.hint, Toast.LENGTH_SHORT).show()
    }

    private fun buildModeAndZoomChips() {
        val dp = { v: Float -> Ui.dp(this, v) }
        modeRow.removeAllViews(); zoomRow.removeAllViews(); zoomChips.clear()
        hdrChip = null; nightChip = null; flashChip = null
        val lp = { LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(4f); rightMargin = dp(4f) } }
        if (caps.hdrExtension) hdrChip = Ui.chip(this, "HDR") {
            engine?.let { it.setMode(if (it.mode == CaptureMode.HDR) CaptureMode.STANDARD else CaptureMode.HDR) }
        }.also { modeRow.addView(it, lp()) }
        if (caps.nightExtension) nightChip = Ui.chip(this, "Night") {
            engine?.let { it.setMode(if (it.mode == CaptureMode.NIGHT) CaptureMode.STANDARD else CaptureMode.NIGHT) }
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
            val chip = Ui.chip(this, label) { engine?.setZoom(z); refreshZoomChips(null) }
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

        // overlay every frame (cheap), text at most ~6×/s
        overlay.faces = a.faces
        overlay.meterBox = plan.meteringBox
        overlay.roll = frame.rollDeg
        overlay.pitch = frame.pitchDeg
        overlay.levelTol = effective.rules.levelTol
        overlay.cue = cs.tip?.cue
        overlay.ready = cs.ready
        overlay.invalidate()
        shutter.readiness = cs.readiness
        shutter.ready = cs.ready
        if (cs.ready && !lastReadyHaptic) shutter.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        lastReadyHaptic = cs.ready

        if (a.timeMs - lastUiMs < 160) return
        lastUiMs = a.timeMs
        sceneText.text = (if (userPreset == Preset.AUTO) "AUTO · " else "") + effective.label.uppercase()
        settingsText.text = Planner.summary(e.state(), caps) + if (plan.meteringBox != null) (if (a.faces.isNotEmpty()) " · face" else " · centre") else ""
        whyText.text = (plan.reasons + listOf("This camera: " + CapabilityReader.describe(caps))).joinToString("\n") { "• $it" }
        val tip = cs.tip
        if (tip == null) tipText.visibility = View.INVISIBLE
        else {
            tipText.visibility = View.VISIBLE
            tipText.text = tip.text
            tipText.setTextColor(if (tip.cue == Cue.READY) Ui.READY else Ui.TEXT)
        }
        val sec = cs.secondary
        if (sec == null) tip2Text.visibility = View.GONE else { tip2Text.visibility = View.VISIBLE; tip2Text.text = sec.text }
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
        shutter.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        ShotStore.frame = lastFrame
        ShotStore.plan = lastPlan
        ShotStore.preset = effective
        ShotStore.settings = Planner.summary(e.state(), caps)
        if (lastPlan?.mode == CaptureMode.MANUAL_NIGHT) Toast.makeText(this, "Hold still…", Toast.LENGTH_SHORT).show()
        e.takePhoto(lastPlan, onSaved = { uri ->
            shooting = false; shutter.busy = false
            lastUri = uri
            openReview(uri)
        }, onFail = { msg ->
            shooting = false; shutter.busy = false
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        })
    }

    private fun openReview(uri: Uri) {
        startActivity(Intent(this, ReviewActivity::class.java).setData(uri))
    }
}
