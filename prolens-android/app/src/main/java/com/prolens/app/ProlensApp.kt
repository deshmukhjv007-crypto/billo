package com.prolens.app

import android.app.Application
import android.os.Build
import com.prolens.app.billing.ProStore
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * App start-up: keeps a crash report on the phone (nothing is sent anywhere) so the next launch can
 * offer to share it, and connects to Google Play to check whether this account owns Pro.
 */
class ProlensApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val sw = StringWriter()
                error.printStackTrace(PrintWriter(sw))
                val report = "Prolens ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})\n" +
                    "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})\n" +
                    "Thread: ${thread.name}\n\n$sw"
                File(filesDir, CRASH_FILE).writeText(report)
            } catch (e: Throwable) {
                // never let the crash reporter itself crash
            }
            previous?.uncaughtException(thread, error)
        }
        try { ProStore.init(this) } catch (e: Throwable) { }
    }

    companion object {
        const val CRASH_FILE = "last_crash.txt"
    }
}
