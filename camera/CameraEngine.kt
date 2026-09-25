package com.prolens.app.camera

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.util.Size
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.extensions.ExtensionMode
import androidx.camera.extensions.ExtensionsManager
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.prolens.app.core.CameraState
import com.prolens.app.core.Capabilities
import com.prolens.app.core.CaptureMode
import com.prolens.app.core.Face
import com.prolens.app.core.FrameStats
import com.prolens.app.core.Luma
import com.prolens.app.core.Plan
import com.prolens.app.core.Rect01
import com.prolens.app.core.RegionLuma
import com.prolens.app.core.Tint
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

/** One analysed preview frame, handed to the UI thread. */
class Analysis(
    val luma: Luma,
    val tint: Tint,
    val faces: List<Face>,
    val uprightW: Int,
    val uprightH: Int,
    val stats: FrameStats,
    val timeMs: Long
) {
    fun region(r: Rect01): RegionLuma = stats.region(r)
}

/**
 * CameraX pipeline: Preview + ImageAnalysis (luma/colour stats + ML Kit faces, ~15 fps) + ImageCapture.
 * Applies the planner's decisions (EV, metering/focus region, zoom, manual night exposure) within
 * what the device reports it can do.
 */
@SuppressLint("UnsafeOptInUsageError")
class CameraEngine(
    private val ctx: Context,
    private val owner: LifecycleOwner,
    private val previewView: PreviewView,
    private val onFrame: (Analysis) -> Unit,
    private val onReady: (Capabilities) -> Unit,
    private val onError: (String) -> Unit
) {
    private val main = Handler(Looper.getMainLooper())
    private val exec = Executors.newSingleThreadExecutor()
    private var provider: ProcessCameraProvider? = null
    private var extensions: ExtensionsManager? = null
    private var camera: Camera? = null
    private var capture: ImageCapture? = null
    private val stats = FrameStats()

    var front = false; private set
    var mode = CaptureMode.STANDARD; private set
    var caps = Capabilities(); private set
    var flashOn = false

    @Volatile var iso: Int? = null; private set
    @Volatile var exposureNs: Long? = null; private set
    var evIndex = 0; private set
    var zoom = 1f; private set
    var analysisRunning = true; private set

    private var lastMeter: Rect01? = null
    private var lastMeterMs = 0L
    private var lastAfMs = 0L
    private var userPointUntil = 0L

    // ---------- faces (ML Kit, bundled model) ----------
    private val faceDetector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
            .setMinFaceSize(0.08f)
            .enableTracking()
            .build()
    )
    @Volatile private var faces: List<Face> = emptyList()
    @Volatile private var facesAt = 0L
    @Volatile private var faceBusy = false
    private var frameNo = 0

    // reusable plane buffers
    private var yBuf = ByteArray(0)
    private var uBuf = ByteArray(0)
    private var vBuf = ByteArray(0)

    fun start() {
        val f = ProcessCameraProvider.getInstance(ctx)
        f.addListener({
            try {
                provider = f.get()
                val ef = ExtensionsManager.getInstanceAsync(ctx, provider!!)
                ef.addListener({
                    extensions = try { ef.get() } catch (e: Throwable) { null }
                    bind()
                }, ContextCompat.getMainExecutor(ctx))
            } catch (e: Throwable) {
                onError("Camera unavailable: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(ctx))
    }

    fun flip() { front = !front; mode = CaptureMode.STANDARD; zoom = 1f; bind() }

    /** Switch between standard, HDR and Night (the last two only if the phone has the extension). */
    fun setMode(m: CaptureMode) {
        val target = when (m) {
            CaptureMode.NIGHT -> if (caps.nightExtension) CaptureMode.NIGHT else CaptureMode.STANDARD
            CaptureMode.HDR -> if (caps.hdrExtension) CaptureMode.HDR else CaptureMode.STANDARD
            else -> CaptureMode.STANDARD
        }
        if (target != mode) { mode = target; bind() }
    }

    private fun baseSelector() = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA

    @androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
    private fun bind() {
        val p = provider ?: return
        p.unbindAll()
        val base = baseSelector()
        val ext = extensions
        val night = try { ext?.isExtensionAvailable(base, ExtensionMode.NIGHT) == true } catch (e: Throwable) { false }
        val hdr = try { ext?.isExtensionAvailable(base, ExtensionMode.HDR) == true } catch (e: Throwable) { false }
        val selector = when {
            mode == CaptureMode.NIGHT && night -> ext!!.getExtensionEnabledCameraSelector(base, ExtensionMode.NIGHT)
            mode == CaptureMode.HDR && hdr -> ext!!.getExtensionEnabledCameraSelector(base, ExtensionMode.HDR)
            else -> { if (mode == CaptureMode.NIGHT || mode == CaptureMode.HDR) mode = CaptureMode.STANDARD; base }
        }

        val ratio = ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .build()
        val pb = Preview.Builder().setResolutionSelector(ratio)
        if (mode == CaptureMode.STANDARD) {
            Camera2Interop.Extender(pb).setSessionCaptureCallback(object : CameraCaptureSession.CaptureCallback() {
                override fun onCaptureCompleted(s: CameraCaptureSession, r: CaptureRequest, result: TotalCaptureResult) {
                    iso = result.get(CaptureResult.SENSOR_SENSITIVITY)
                    exposureNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
                }
            })
        } else { iso = null; exposureNs = null }
        val preview = pb.build().also { it.setSurfaceProvider(previewView.surfaceProvider) }

        val cap = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
            .setResolutionSelector(ratio)
            .setFlashMode(if (flashOn) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF)
            .build()
        capture = cap

        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
        analysis.setAnalyzer(exec) { img -> analyze(img) }

        fun tryBind(cases: List<UseCase>): Camera? = try {
            p.bindToLifecycle(owner, selector, *cases.toTypedArray())
        } catch (e: Throwable) { Log.w(TAG, "bind failed with ${cases.size} use cases: ${e.message}"); p.unbindAll(); null }

        // Night/HDR sessions can't always run the analyser alongside; fall back gracefully.
        var cam = tryBind(listOf(preview, cap, analysis))
        analysisRunning = cam != null
        if (cam == null) cam = tryBind(listOf(preview, cap))
        if (cam == null && selector !== base) { mode = CaptureMode.STANDARD; cam = tryBind(listOf(preview, cap, analysis)); analysisRunning = cam != null }
        if (cam == null) { onError("Couldn't open the camera"); return }
        camera = cam
        caps = CapabilityReader.read(cam.cameraInfo, night, hdr)
        evIndex = cam.cameraInfo.exposureState.exposureCompensationIndex
        lastMeter = null
        cam.cameraControl.setZoomRatio(zoom.coerceIn(caps.zoomMin, caps.zoomMax))
        onReady(caps)
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun analyze(img: ImageProxy) {
        var handedOff = false
        try {
            val rot = img.imageInfo.rotationDegrees
            val yP = img.planes[0]; val uP = img.planes[1]; val vP = img.planes[2]
            yBuf = copy(yP.buffer, yBuf); uBuf = copy(uP.buffer, uBuf); vBuf = copy(vP.buffer, vBuf)
            stats.sample(yBuf, img.width, img.height, yP.rowStride, yP.pixelStride, rot)
            val cw = img.width / 2; val chh = img.height / 2
            val mu = FrameStats.planeMean(uBuf, cw, chh, uP.rowStride, uP.pixelStride)
            val mv = FrameStats.planeMean(vBuf, cw, chh, vP.rowStride, vP.pixelStride)
            val luma = stats.luma()
            val upright90 = rot == 90 || rot == 270
            val uw = if (upright90) img.height else img.width
            val uh = if (upright90) img.width else img.height
            val now = System.currentTimeMillis()

            // faces every other frame; the ImageProxy stays open until ML Kit is done with it
            frameNo++
            val media = img.image
            if (!faceBusy && frameNo % 2 == 0 && media != null) {
                faceBusy = true
                val task = try { faceDetector.process(InputImage.fromMediaImage(media, rot)) } catch (e: Throwable) { null }
                if (task == null) faceBusy = false
                else {
                    handedOff = true
                    task.addOnSuccessListener { list ->
                        faces = list.map { f ->
                            val b = f.boundingBox
                            Face(Rect01(b.left.toFloat() / uw, b.top.toFloat() / uh, b.right.toFloat() / uw, b.bottom.toFloat() / uh).clamp(),
                                rollDeg = f.headEulerAngleZ, yawDeg = f.headEulerAngleY)
                        }
                        facesAt = System.currentTimeMillis()
                    }
                    .addOnCompleteListener { faceBusy = false; img.close() }
                }
            }
            val fresh = if (now - facesAt < 700) faces else emptyList()
            val snapshot = FrameStats().also { it.load(stats.snapshot(), stats.gw, stats.gh) }
            val a = Analysis(luma, FrameStats.tint(mu, mv), fresh, uw, uh, snapshot, now)
            main.post { onFrame(a) }
        } catch (e: Throwable) {
            Log.w(TAG, "analyze: ${e.message}")
        } finally {
            if (!handedOff) img.close()
        }
    }

    private fun copy(src: java.nio.ByteBuffer, reuse: ByteArray): ByteArray {
        val b = src.duplicate()          // leave the plane's own position alone — ML Kit reads it next
        b.rewind()
        val n = b.remaining()
        val out = if (reuse.size >= n) reuse else ByteArray(n)
        b.get(out, 0, n)
        return out
    }

    fun state(): CameraState = CameraState(iso = iso, exposureNs = exposureNs, evIndex = evIndex, zoom = zoom, front = front, mode = mode)

    // ---------- applying the plan ----------

    /** Called on the UI thread after every plan. Cheap: only talks to the camera when something changed. */
    fun apply(plan: Plan, toView: (Rect01) -> Pair<Float, Float>, now: Long) {
        val cam = camera ?: return
        if (mode == CaptureMode.STANDARD && caps.evMax > caps.evMin && plan.evIndex != evIndex) {
            evIndex = caps.clampEvIndex(plan.evIndex)
            cam.cameraControl.setExposureCompensationIndex(evIndex)
        }
        if (now < userPointUntil) return                      // user tapped a point: leave it alone for a while
        val box = plan.meteringBox
        if (box == null) {
            if (lastMeter != null) { cam.cameraControl.cancelFocusAndMetering(); lastMeter = null }
            return
        }
        val moved = lastMeter?.let { box.distanceTo(it) } ?: 1f
        if (caps.maxMeteringRegions <= 0 && caps.maxFocusRegions <= 0) return
        val needAf = lastMeter == null || moved > 0.18f || now - lastAfMs > 6000
        val needAe = moved > 0.06f && now - lastMeterMs > 800
        if (!needAf && !needAe) return
        val (vx, vy) = toView(box)
        val point = previewView.meteringPointFactory.createPoint(vx, vy, max(box.width, box.height).coerceIn(0.05f, 0.6f))
        var flags = 0
        if (caps.maxMeteringRegions > 0) flags = flags or FocusMeteringAction.FLAG_AE
        if (needAf && caps.maxFocusRegions > 0 && !caps.fixedFocus) flags = flags or FocusMeteringAction.FLAG_AF
        if (flags == 0) return
        val action = FocusMeteringAction.Builder(point, flags).disableAutoCancel().build()
        cam.cameraControl.startFocusAndMetering(action)
        lastMeter = box; lastMeterMs = now
        if (flags and FocusMeteringAction.FLAG_AF != 0) lastAfMs = now
    }

    /** Tap to focus + meter at a view point; Prolens keeps its hands off the region for 8 s. */
    fun focusAt(viewX: Float, viewY: Float) {
        val cam = camera ?: return
        val point = previewView.meteringPointFactory.createPoint(viewX, viewY, 0.15f)
        var flags = FocusMeteringAction.FLAG_AE
        if (!caps.fixedFocus) flags = flags or FocusMeteringAction.FLAG_AF
        cam.cameraControl.startFocusAndMetering(FocusMeteringAction.Builder(point, flags).setAutoCancelDuration(8, TimeUnit.SECONDS).build())
        userPointUntil = System.currentTimeMillis() + 8000
    }

    fun setZoom(z: Float) {
        zoom = z.coerceIn(caps.zoomMin, caps.zoomMax)
        camera?.cameraControl?.setZoomRatio(zoom)
    }

    fun setFlash(on: Boolean) { flashOn = on; capture?.flashMode = if (on) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF }

    // ---------- capture ----------

    @androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
    fun takePhoto(plan: Plan?, onSaved: (Uri) -> Unit, onFail: (String) -> Unit) {
        val cam = camera ?: return onFail("Camera not ready")
        val ic = capture ?: return onFail("Camera not ready")
        val name = "Prolens_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/Prolens")
        }
        val meta = ImageCapture.Metadata().apply { isReversedHorizontal = front }
        val out = ImageCapture.OutputFileOptions.Builder(ctx.contentResolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            .setMetadata(meta).build()

        val mIso: Int? = plan?.manualIso
        val mExp: Long? = plan?.manualExposureNs
        val manual = plan != null && plan.mode == CaptureMode.MANUAL_NIGHT && mode == CaptureMode.STANDARD &&
            caps.manualSensor && mIso != null && mExp != null
        val c2 = if (manual) Camera2CameraControl.from(cam.cameraControl) else null

        val shoot = {
            ic.takePicture(out, ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(r: ImageCapture.OutputFileResults) {
                    c2?.clearCaptureRequestOptions()
                    val uri = r.savedUri
                    if (uri != null) onSaved(uri) else onFail("Saved, but no file address came back")
                }
                override fun onError(e: ImageCaptureException) {
                    c2?.clearCaptureRequestOptions()
                    onFail("Couldn't take the photo: ${e.message}")
                }
            })
        }
        if (c2 != null && mIso != null && mExp != null) {
            // manual long exposure only for the shot itself — the preview would crawl at 2 fps otherwise
            val opts = CaptureRequestOptions.Builder()
                .setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF)
                .setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, mIso)
                .setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, mExp)
                .build()
            c2.setCaptureRequestOptions(opts)
            val settle = (mExp / 1_000_000L) * 3 + 300
            main.postDelayed({ shoot() }, settle)
        } else shoot()
    }

    fun shutdown() {
        try { provider?.unbindAll() } catch (e: Throwable) {}
        try { faceDetector.close() } catch (e: Throwable) {}
        exec.shutdown()
    }

    /** Is the planner's EV index close to what the camera reports? (Used to ignore stale frames.) */
    fun evSettled(target: Int) = abs(target - evIndex) <= 0

    companion object { private const val TAG = "Prolens" }
}
