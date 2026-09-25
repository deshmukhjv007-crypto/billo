package com.prolens.app.camera

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraInfo
import com.prolens.app.core.Awb
import com.prolens.app.core.Capabilities
import kotlin.math.sqrt

/** Reads what this phone's camera can actually do, so every decision stays within the hardware. */
object CapabilityReader {

    @androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
    fun read(info: CameraInfo, nightExtension: Boolean, hdrExtension: Boolean): Capabilities {
        val c2 = try { Camera2CameraInfo.from(info) } catch (e: Throwable) { null }
        fun <T> ch(key: CameraCharacteristics.Key<T>): T? = try { c2?.getCameraCharacteristic(key) } catch (e: Throwable) { null }

        val ex = info.exposureState
        val evRange = ex.exposureCompensationRange
        val step = ex.exposureCompensationStep
        val evStep = if (step.denominator != 0) step.numerator.toFloat() / step.denominator else 1f / 6f
        val supported = ex.isExposureCompensationSupported

        val isoRange = ch(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
        val expRange = ch(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
        val capsList: IntArray = ch(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
        val manual = capsList.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR) && isoRange != null && expRange != null

        val awbRaw: IntArray = ch(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES) ?: IntArray(0)
        val awbFound = HashSet<Awb>()
        for (mode in awbRaw) {
            val m: Awb? = when (mode) {
                CameraMetadata.CONTROL_AWB_MODE_AUTO -> Awb.AUTO
                CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT -> Awb.DAYLIGHT
                CameraMetadata.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT -> Awb.CLOUDY
                CameraMetadata.CONTROL_AWB_MODE_SHADE -> Awb.SHADE
                CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT -> Awb.INCANDESCENT
                CameraMetadata.CONTROL_AWB_MODE_FLUORESCENT -> Awb.FLUORESCENT
                else -> null
            }
            if (m != null) awbFound.add(m)
        }
        val awb: Set<Awb> = if (awbFound.isEmpty()) setOf(Awb.AUTO) else awbFound

        // 35 mm-equivalent focal length: f × (43.27 mm full-frame diagonal / sensor diagonal)
        val focals: FloatArray? = ch(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
        val focal: Float? = focals?.firstOrNull()
        val size = ch(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        val f35 = if (focal != null && size != null && size.width > 0f) {
            val diag = sqrt(size.width * size.width + size.height * size.height)
            (focal * 43.27f / diag).coerceIn(10f, 200f)
        } else 26f
        val oisModes: IntArray = ch(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION) ?: IntArray(0)
        val ois = oisModes
            .contains(CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON)
        val minFocus: Float = ch(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 1f

        val zoom = info.zoomState.value
        return Capabilities(
            evMin = if (supported) evRange.lower else 0,
            evMax = if (supported) evRange.upper else 0,
            evStep = if (evStep > 0f) evStep else 1f / 6f,
            isoMin = isoRange?.lower, isoMax = isoRange?.upper,
            exposureMinNs = expRange?.lower, exposureMaxNs = expRange?.upper,
            manualSensor = manual,
            awbModes = awb,
            maxMeteringRegions = (ch(CameraCharacteristics.CONTROL_MAX_REGIONS_AE) as Int?) ?: 0,
            maxFocusRegions = (ch(CameraCharacteristics.CONTROL_MAX_REGIONS_AF) as Int?) ?: 0,
            zoomMin = zoom?.minZoomRatio ?: 1f,
            zoomMax = zoom?.maxZoomRatio ?: 1f,
            hasFlash = info.hasFlashUnit(),
            nightExtension = nightExtension,
            hdrExtension = hdrExtension,
            focal35mm = f35,
            ois = ois,
            fixedFocus = minFocus == 0f
        )
    }

    /** One line for the "about this camera" sheet. */
    fun describe(c: Capabilities): String = buildString {
        append("${c.focal35mm.toInt()} mm-equiv")
        if (c.zoomMin < 1f) append(" · ultra-wide")
        if (c.zoomMax >= 2f) append(" · up to ${"%.0f".format(c.zoomMax)}× zoom")
        if (c.ois) append(" · OIS")
        if (c.manualSensor) append(" · manual ISO/shutter")
        if (c.nightExtension) append(" · Night mode")
        if (c.hdrExtension) append(" · HDR")
        if (c.hasFlash) append(" · flash")
    }
}
