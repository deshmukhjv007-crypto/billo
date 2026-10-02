package com.billo.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.result.ActivityResultLauncher
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Voice bills: on-device speech → text, streamed to the web app as
 * window.__billoVoice({type:'partial'|'final'|'error'|'end', text, code}).
 * The web app turns the words into a bill (voiceNormalize + parseExpenseText) and shows the confirm card.
 *
 * Error codes the web app understands: perm, unavailable, no-speech, err.
 * Must be called on the main thread.
 */
class VoiceInput(
    private val activity: AppCompatActivity,
    private val emit: (String) -> Unit,
    private val dialogLauncher: ActivityResultLauncher<Intent>
) {
    private var recognizer: SpeechRecognizer? = null
    private var stopped = false

    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity) ||
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).resolveActivity(activity.packageManager) != null

    private fun intent(lang: String): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_PROMPT, "Say the bill")
        // give people time to list several names
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
    }

    fun start(lang: String) {
        stop()
        stopped = false
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            // no recognition service we can talk to directly → the system's speech dialog
            try {
                dialogLauncher.launch(intent(lang))
            } catch (_: ActivityNotFoundException) {
                send("error", code = "unavailable")
            } catch (_: Exception) {
                send("error", code = "unavailable")
            }
            return
        }
        val r = try {
            SpeechRecognizer.createSpeechRecognizer(activity)
        } catch (_: Exception) {
            send("error", code = "unavailable"); return
        }
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                if (stopped) return
                val t = first(partialResults)
                if (t.isNotEmpty()) send("partial", text = t)
            }

            override fun onResults(results: Bundle?) {
                if (stopped) return
                val t = first(results)
                if (t.isNotEmpty()) send("final", text = t) else send("error", code = "no-speech")
                send("end")
                release()
            }

            override fun onError(error: Int) {
                if (stopped) return
                val code = when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "perm"
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                    else -> "err"
                }
                send("error", code = code)
                send("end")
                release()
            }
        })
        try {
            r.startListening(intent(lang))
        } catch (_: Exception) {
            send("error", code = "unavailable")
            release()
        }
    }

    /** Result of the system speech dialog fallback. */
    fun onDialogResult(resultCode: Int, data: Intent?) {
        val t = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim().orEmpty()
        if (resultCode == android.app.Activity.RESULT_OK && t.isNotEmpty()) send("final", text = t)
        else send("error", code = "no-speech")
        send("end")
    }

    fun stop() {
        stopped = true
        try { recognizer?.cancel() } catch (_: Exception) {}
        release()
    }

    private fun release() {
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
    }

    private fun first(b: Bundle?): String =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

    private fun send(type: String, text: String? = null, code: String? = null) {
        val o = JSONObject().put("type", type)
        if (text != null) o.put("text", text)
        if (code != null) o.put("code", code)
        emit(o.toString())
    }
}
