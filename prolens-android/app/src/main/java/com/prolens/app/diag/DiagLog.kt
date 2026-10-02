package com.prolens.app.diag

import android.content.Context
import android.os.Build
import com.prolens.app.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Test recorder. When Test mode is on, Prolens writes what it sees and decides — about twice a
 * second — plus every event (preset change, shot, review score, listing image, paywall, error,
 * crash) and the tester's verdict on each guided test step, as one JSON object per line.
 *
 * Nothing is sent anywhere: the report stays in the app until the tester shares it.
 * No images are recorded, only numbers and short texts.
 */
object DiagLog {
    private const val MAX_BYTES = 20L * 1024 * 1024
    private const val FRAME_EVERY_MS = 500L

    private val io = Executors.newSingleThreadExecutor()
    private var dir: File? = null
    private var file: File? = null
    private var t0 = 0L
    private var bytes = 0L
    private var lastFrameMs = 0L
    private var framesSince = 0

    @Volatile var enabled = false
        private set

    fun init(ctx: Context, on: Boolean) {
        dir = File(ctx.filesDir, "diag").apply { mkdirs() }
        if (on) start()
    }

    fun setEnabled(on: Boolean) {
        if (on == enabled) return
        if (on) start() else { event("session_end"); enabled = false }
    }

    private fun start() {
        val d = dir ?: return
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        file = File(d, "session_$stamp.jsonl")
        t0 = System.currentTimeMillis()
        bytes = d.listFiles()?.sumOf { it.length() } ?: 0L
        enabled = true
        event("session_start", obj(
            "app" to "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            "debug" to BuildConfig.DEBUG,
            "device" to "${Build.MANUFACTURER} ${Build.MODEL}",
            "android" to "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            "wall" to SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        ))
    }

    /** One event line. */
    fun event(type: String, data: JSONObject = JSONObject()) {
        if (!enabled) return
        val line = try {
            JSONObject().put("t", System.currentTimeMillis() - t0).put("type", type).put("d", data).toString()
        } catch (e: Throwable) { return }
        write(line)
    }

    /** Call on every analysed frame; returns true (and counts fps) when a frame snapshot is due. */
    fun frameDue(nowMs: Long): Boolean {
        if (!enabled) return false
        framesSince++
        return nowMs - lastFrameMs >= FRAME_EVERY_MS
    }

    /** Record a frame snapshot; adds the analysis rate since the last one. */
    fun frame(nowMs: Long, data: JSONObject) {
        val span = nowMs - lastFrameMs
        if (lastFrameMs > 0 && span in 1..10_000) data.put("fps", num(framesSince * 1000f / span))
        lastFrameMs = nowMs
        framesSince = 0
        event("frame", data)
    }

    /** Written straight away (the process is about to die). */
    fun crashNow(report: String) {
        val f = file ?: return
        if (!enabled) return
        try {
            val line = JSONObject().put("t", System.currentTimeMillis() - t0).put("type", "crash").put("d", JSONObject().put("report", report.take(8000))).toString()
            f.appendText(line + "\n")
        } catch (e: Throwable) { }
    }

    private fun write(line: String) {
        val f = file ?: return
        io.execute {
            try {
                if (bytes > MAX_BYTES) return@execute
                f.appendText(line + "\n")
                bytes += line.length + 1
            } catch (e: Throwable) { }
        }
    }

    /** How much has been recorded, for the Settings screen. */
    fun summary(): String {
        val files = dir?.listFiles()?.filter { it.name.endsWith(".jsonl") } ?: emptyList()
        val kb = files.sumOf { it.length() } / 1024
        val full = if (bytes > MAX_BYTES) " · full: share it, then delete the test data" else ""
        return if (files.isEmpty()) "Nothing recorded yet" else "${files.size} session${if (files.size == 1) "" else "s"} · $kb KB$full"
    }

    /** All sessions merged into one shareable text file (in the cache, where the share sheet can read it). */
    fun buildReport(ctx: Context): File? {
        val sessions = dir?.listFiles()?.filter { it.name.endsWith(".jsonl") }?.sortedBy { it.name } ?: return null
        if (sessions.isEmpty()) return null
        // let queued lines (e.g. the "report_shared" event) reach the file first
        try { io.submit(Runnable {}).get(2, java.util.concurrent.TimeUnit.SECONDS) } catch (e: Throwable) { }
        val outDir = File(ctx.cacheDir, "reports").apply { mkdirs() }
        outDir.listFiles()?.forEach { it.delete() }
        val stamp = SimpleDateFormat("yyyyMMdd_HHmm", Locale.US).format(Date())
        val out = File(outDir, "prolens_test_report_$stamp.txt")
        out.bufferedWriter().use { w ->
            w.write("# Prolens test report. Share this file with the developer as it is.\n")
            for (s in sessions) {
                w.write("# file ${s.name}\n")
                s.forEachLine { w.write(it); w.write("\n") }
            }
        }
        return out
    }

    fun clear() {
        dir?.listFiles()?.forEach { it.delete() }
        bytes = 0
        if (enabled) start()
    }

    // ---- small JSON helpers (JSONObject refuses NaN / infinity)

    fun num(v: Float): Double = if (v.isNaN() || v.isInfinite()) 0.0 else Math.round(v * 1000.0) / 1000.0

    fun obj(vararg pairs: Pair<String, Any?>): JSONObject {
        val o = JSONObject()
        for ((k, v) in pairs) {
            when (v) {
                null -> {}
                is Float -> o.put(k, num(v))
                is Double -> o.put(k, if (v.isNaN() || v.isInfinite()) 0.0 else v)
                is Collection<*> -> o.put(k, JSONArray(v.map { if (it is Float) num(it) else it }))
                else -> o.put(k, v)
            }
        }
        return o
    }
}
