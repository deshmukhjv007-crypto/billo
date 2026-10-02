package com.prolens.app.ui

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.prolens.app.BuildConfig
import com.prolens.app.Prefs
import com.prolens.app.ProlensApp
import com.prolens.app.billing.ProStore
import com.prolens.app.core.SellerTarget
import com.prolens.app.diag.DiagLog
import com.prolens.app.diag.TestScript
import androidx.core.content.FileProvider
import java.io.File

class SettingsActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private lateinit var proLine: TextView
    private lateinit var proButton: TextView
    private val targetChips = LinkedHashMap<SellerTarget, TextView>()
    private lateinit var targetDetail: TextView
    private lateinit var testInfo: TextView
    private val onChange: () -> Unit = { refreshPro() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val col = Ui.page(this)
        val dp = { v: Float -> Ui.dp(this, v) }
        col.addView(Ui.text(this, "←  Back", 15f, Ui.DIM).apply { setPadding(0, 0, 0, dp(12f)); setOnClickListener { finish() } })
        col.addView(Ui.text(this, "Settings", 28f, Ui.TEXT, true))

        // ---- Pro
        col.addView(Ui.section(this, "Prolens Pro"))
        proLine = Ui.text(this, "", 15f, Ui.TEXT)
        col.addView(proLine)
        proButton = Ui.button(this, "", true) { startActivity(Intent(this, PaywallActivity::class.java)) }
        col.addView(proButton, Ui.matchWrap(dp(10f)))
        col.addView(Ui.text(this, "Restore purchase", 15f, Ui.ACCENT).apply {
            setPadding(0, dp(12f), 0, dp(4f))
            setOnClickListener { ProStore.refresh(); Toast.makeText(this@SettingsActivity, "Checking Google Play…", Toast.LENGTH_SHORT).show() }
        })

        // ---- camera
        col.addView(Ui.section(this, "Camera"))
        col.addView(toggle("Grid lines", "Rule-of-thirds guides on the preview", prefs.grid) { prefs.grid = it })
        col.addView(toggle("Coaching tips", "Short tips on how to hold the phone", prefs.tips) { prefs.tips = it })
        col.addView(toggle("Vibration", "A small buzz when the shot is ready", prefs.haptics) { prefs.haptics = it })
        col.addView(toggle("Review after each shot", "Show the score and tips straight after taking a photo", prefs.autoReview) { prefs.autoReview = it })
        col.addView(toggle("Save to the main Camera album", "Off: save into a separate Prolens album", prefs.saveToCamera) { prefs.saveToCamera = it })

        // ---- seller studio
        col.addView(Ui.section(this, "Seller Studio"))
        col.addView(Ui.text(this, "Listing style", 16f, Ui.TEXT))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (t in SellerTarget.values()) {
            val c = Ui.chip(this, t.label) { prefs.sellerTarget = t; refreshTargets() }
            targetChips[t] = c
            row.addView(c, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8f) })
        }
        col.addView(row, Ui.matchWrap(dp(8f)))
        targetDetail = Ui.text(this, "", 13.5f, Ui.DIM)
        col.addView(targetDetail, Ui.matchWrap(dp(6f)))
        refreshTargets()

        // ---- test mode
        col.addView(Ui.section(this, "Test mode"))
        col.addView(Ui.text(this, "Records what Prolens sees and decides while you try ${TestScript.steps.size} short tests, so the developer can check it works. Numbers only, no photos. Nothing is sent until you share it.", 13.5f, Ui.DIM))
        col.addView(toggle("Test mode", "Shows a test guide on the camera screen", prefs.testMode) { on ->
            prefs.testMode = on
            if (on && prefs.testStep >= TestScript.steps.size) prefs.testStep = 0
            DiagLog.setEnabled(on)
            refreshTest()
        })
        testInfo = Ui.text(this, "", 13.5f, Ui.DIM)
        col.addView(testInfo, Ui.matchWrap(dp(4f)))
        col.addView(link("Share test report") { shareReport() })
        col.addView(link("Restart the tests from step 1") { prefs.testStep = 0; refreshTest(); Toast.makeText(this, "Tests restart at step 1", Toast.LENGTH_SHORT).show() })
        col.addView(link("Delete recorded test data") { DiagLog.clear(); prefs.testStep = 0; refreshTest() })
        refreshTest()

        // ---- help
        col.addView(Ui.section(this, "Help"))
        col.addView(link("Show the intro again") { prefs.onboarded = false; startActivity(Intent(this, OnboardingActivity::class.java)); finishAffinity() })
        col.addView(link("Privacy policy") { startActivity(Intent(this, LegalActivity::class.java)) })
        col.addView(link("Report a problem") { reportProblem() })

        // ---- test builds only
        if (BuildConfig.DEBUG) {
            col.addView(Ui.section(this, "Test build"))
            col.addView(toggle("Unlock Pro for testing", "Only in test builds. Store builds ignore this switch.", prefs.debugPro) { prefs.debugPro = it; refreshPro() })
        }

        col.addView(Ui.text(this, "Prolens ${BuildConfig.VERSION_NAME}", 13f, Ui.DIM).apply { gravity = Gravity.CENTER }, Ui.matchWrap(dp(28f)))
        refreshPro()
    }

    override fun onStart() { super.onStart(); ProStore.addListener(onChange) }
    override fun onStop() { ProStore.removeListener(onChange); super.onStop() }

    private fun refreshPro() {
        if (prefs.isPro) {
            proLine.text = "Pro is active. Thank you for supporting Prolens."
            proButton.text = "See what Pro includes"
        } else {
            proLine.text = "Free: live coaching, Auto, Portrait, Food and Seller Studio (${prefs.listingsLeft().coerceAtLeast(0)} listing images left today)."
            proButton.text = "Get Pro for ${ProStore.price}"
        }
    }

    private fun refreshTest() {
        val step = prefs.testStep.coerceAtMost(TestScript.steps.size)
        testInfo.text = "Progress: $step of ${TestScript.steps.size} tests · ${DiagLog.summary()}"
    }

    private fun shareReport() {
        DiagLog.event("report_shared")
        val f = try { DiagLog.buildReport(this) } catch (e: Throwable) { null }
        if (f == null) { Toast.makeText(this, "No test data yet. Turn on Test mode and try the camera first.", Toast.LENGTH_LONG).show(); return }
        val uri = FileProvider.getUriForFile(this, "${packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "Prolens test report")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        startActivity(Intent.createChooser(send, "Share test report"))
    }

    private fun refreshTargets() {
        val cur = prefs.sellerTarget
        for ((t, v) in targetChips) Ui.setChipState(v, t == cur)
        targetDetail.text = cur.detail
    }

    private fun toggle(title: String, detail: String, on: Boolean, onChange: (Boolean) -> Unit): LinearLayout {
        val dp = { v: Float -> Ui.dp(this, v) }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8f), 0, dp(8f)) }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(Ui.text(this, title, 16f, Ui.TEXT))
        texts.addView(Ui.text(this, detail, 13.5f, Ui.DIM))
        val sw = Switch(this).apply { isChecked = on; setOnCheckedChangeListener { _, v -> onChange(v) } }
        row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(sw)
        row.setOnClickListener { sw.isChecked = !sw.isChecked }
        return row
    }

    private fun link(title: String, onClick: () -> Unit): TextView = Ui.text(this, title, 16f, Ui.TEXT).apply {
        setPadding(0, Ui.dp(this@SettingsActivity, 12f), 0, Ui.dp(this@SettingsActivity, 12f))
        setOnClickListener { onClick() }
    }

    private fun reportProblem() {
        val crash = File(filesDir, ProlensApp.CRASH_FILE)
        val body = buildString {
            append("Prolens ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n")
            append("${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}\n\n")
            append("What happened:\n\n")
            if (crash.exists()) { append("\n--- last crash ---\n"); append(crash.readText().take(6000)) }
        }
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, "Prolens problem report")
            .putExtra(Intent.EXTRA_TEXT, body)
        if (SUPPORT_EMAIL.isNotBlank()) send.putExtra(Intent.EXTRA_EMAIL, arrayOf(SUPPORT_EMAIL))
        startActivity(Intent.createChooser(send, "Send report"))
    }
}
