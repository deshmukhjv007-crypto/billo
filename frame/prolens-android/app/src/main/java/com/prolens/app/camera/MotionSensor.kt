package com.prolens.app.camera

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * Phone angle and hand shake.
 *   roll  — 0 = level (portrait), + = top of the phone tipped clockwise.
 *   pitch — 0 = camera at the horizon, −90 = pointing straight down, +90 = straight up.
 *           (Computed for the camera in use: the front camera looks the other way.)
 *   shake — smoothed gyroscope magnitude, rad/s.
 */
class MotionSensor(context: Context) : SensorEventListener {
    private val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val gravity = sm.getDefaultSensor(Sensor.TYPE_GRAVITY)
    private val accel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val g = FloatArray(3)
    private var haveG = false

    @Volatile var roll = 0f; private set
    @Volatile var pitchBack = 0f; private set
    @Volatile var shake = 0f; private set
    val hasGyro get() = gyro != null

    fun pitch(front: Boolean) = if (front) -pitchBack else pitchBack

    fun start() {
        (gravity ?: accel)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        gyro?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() = sm.unregisterListener(this)

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_GRAVITY, Sensor.TYPE_ACCELEROMETER -> {
                val a = if (e.sensor.type == Sensor.TYPE_ACCELEROMETER) 0.15f else 1f   // low-pass raw accelerometer
                for (i in 0..2) g[i] = if (haveG) g[i] + a * (e.values[i] - g[i]) else e.values[i]
                haveG = true
                val n = sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).coerceAtLeast(0.1f)
                val ux = g[0] / n; val uy = g[1] / n; val uz = g[2] / n     // "up" in device axes
                roll = Math.toDegrees(atan2(-ux.toDouble(), uy.toDouble())).toFloat()
                pitchBack = -Math.toDegrees(asin(uz.coerceIn(-1f, 1f).toDouble())).toFloat()
            }
            Sensor.TYPE_GYROSCOPE -> {
                val m = sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
                shake += 0.2f * (m - shake)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
