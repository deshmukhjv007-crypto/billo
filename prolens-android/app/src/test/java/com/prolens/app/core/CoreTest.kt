package com.prolens.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class CoreTest {
    private fun luma(mean: Float, clipHigh: Float = 0f, clipLow: Float = 0f, p5: Float = mean - 0.3f, p95: Float = mean + 0.3f,
                     center: Float = mean, border: Float = mean, sharp: Float = 0.2f) =
        Luma(mean, p5.coerceIn(0f, 1f), mean, p95.coerceIn(0f, 1f), clipHigh, clipLow, center, border, sharp)

    private fun face(cx: Float = 0.5f, top: Float = 0.2f, h: Float = 0.25f) = Face(Rect01(cx - h * 0.4f, top, cx + h * 0.4f, top + h))

    private val caps = Capabilities(evMin = -12, evMax = 12, evStep = 1f / 6f, isoMin = 50, isoMax = 6400,
        exposureMinNs = 100_000L, exposureMaxNs = 1_000_000_000L, manualSensor = true, hasFlash = true, zoomMin = 0.6f, zoomMax = 8f)

    // ---------------- FrameStats ----------------
    @Test fun statsOnFlatGray() {
        val s = FrameStats(); s.load(IntArray(160 * 120) { 128 }, 160, 120)
        val l = s.luma()
        assertEquals(128f / 255f, l.mean, 0.002f)
        assertEquals(0f, l.clipHigh, 0.0001f)
        assertTrue("flat image is not sharp", l.sharpness < 0.02f)
    }

    @Test fun statsSeeClippingAndSharpEdges() {
        val w = 160; val h = 120
        val v = IntArray(w * h) { i -> if ((i % w) / 8 % 2 == 0) 255 else 20 }  // hard stripes
        val s = FrameStats(); s.load(v, w, h)
        val l = s.luma()
        assertTrue("half the pixels are clipped", l.clipHigh in 0.45f..0.55f)
        assertTrue("stripes are sharp: ${l.sharpness}", l.sharpness > 0.1f)
    }

    @Test fun rotationMapsSensorToUpright() {
        // sensor 4x2 landscape image; bright pixel at sensor top-left. Rotated 90° CW it must be at upright top-right.
        val w = 40; val h = 20
        val y = ByteArray(w * h) { 0 }
        for (yy in 0 until 5) for (xx in 0 until 5) y[yy * w + xx] = 255.toByte()
        val s = FrameStats(40, 20); s.sample(y, w, h, w, 1, 90)
        assertEquals(20, s.gw); assertEquals(40, s.gh)
        assertTrue("top-right bright", s.region(Rect01(0.8f, 0f, 1f, 0.1f)).mean > 0.9f)
        assertTrue("top-left dark", s.region(Rect01(0f, 0f, 0.2f, 0.1f)).mean < 0.1f)
    }

    @Test fun regionMeasuresOnlyTheBox() {
        val w = 100; val h = 100
        val v = IntArray(w * h) { i -> val x = i % w; val yy = i / w; if (x in 40..59 && yy in 40..59) 220 else 40 }
        val s = FrameStats(); s.load(v, w, h)
        assertEquals(220f / 255f, s.region(Rect01(0.42f, 0.42f, 0.58f, 0.58f)).mean, 0.01f)
    }

    @Test fun tintSign() {
        assertTrue(FrameStats.tint(110f, 150f).warmth > 20f)   // tungsten: low Cb, high Cr
        assertTrue(FrameStats.tint(150f, 115f).warmth < -20f)  // shade
    }

    // ---------------- Scene classifier ----------------
    @Test fun classifierPicksScenes() {
        val c = SceneClassifier(holdFrames = 1)
        assertEquals(Preset.PORTRAIT, c.guess(Frame(luma(0.5f), faces = listOf(face()))))
        assertEquals(Preset.GROUP, c.guess(Frame(luma(0.5f), faces = listOf(face(0.2f, h = 0.1f), face(0.5f, h = 0.1f), face(0.8f, h = 0.1f)))))
        assertEquals(Preset.FOOD, c.guess(Frame(luma(0.5f), pitchDeg = -80f)))
        assertEquals(Preset.NIGHT, c.guess(Frame(luma(0.08f), camera = CameraState(iso = 3200))))
        assertEquals(Preset.LANDSCAPE, c.guess(Frame(luma(0.5f), pitchDeg = 2f)))
    }

    @Test fun classifierIsSticky() {
        val c = SceneClassifier(holdFrames = 5)
        val portrait = Frame(luma(0.5f), faces = listOf(face()))
        repeat(4) { c.update(portrait) }
        assertEquals("needs 5 frames", Preset.LANDSCAPE, c.current)
        c.update(portrait)
        assertEquals(Preset.PORTRAIT, c.current)
        c.update(Frame(luma(0.5f)))   // one frame without the face doesn't flip it back
        assertEquals(Preset.PORTRAIT, c.current)
    }

    // ---------------- Planner ----------------
    private fun run(p: Planner, frames: Int, mk: (Int, Long) -> Frame): Plan {
        var ev = 0; var plan: Plan? = null
        for (i in 0 until frames) { plan = p.plan(mk(ev, i * 100L), Preset.PORTRAIT); ev = plan.evIndex }
        return plan!!
    }

    @Test fun darkFaceGetsPositiveEv() {
        val p = Planner(caps)
        val plan = run(p, 40) { ev, t ->
            // the face brightens as EV rises (camera AE follows our compensation)
            val faceL = (0.25f * Math.pow(2.0, (ev * caps.evStep) / 2.2).toFloat()).coerceAtMost(0.95f)
            Frame(luma(0.4f), faces = listOf(face()), subject = RegionLuma(faceL, 0f, 0f), camera = CameraState(evIndex = ev), timeMs = t)
        }
        val stops = plan.evIndex * caps.evStep
        assertTrue("≈ +2 stops to lift 0.25 → 0.52, got $stops", stops in 1.6f..2.1f)
        assertTrue(plan.reasons.any { it.contains("face") })
    }

    @Test fun plannerDoesNotPumpOnSteadyScene() {
        val p = Planner(caps)
        var changes = 0; var last = 0
        for (i in 0 until 60) {
            val ev = last
            val plan = p.plan(Frame(luma(0.5f), subject = RegionLuma(0.51f, 0f, 0f), faces = listOf(face()), camera = CameraState(evIndex = ev), timeMs = i * 100L), Preset.PORTRAIT)
            if (plan.evIndex != last) changes++
            last = plan.evIndex
        }
        assertEquals("already on target → no changes", 0, changes)
    }

    @Test fun plannerRateLimitsSteps() {
        val p = Planner(caps)
        var last = 0; var maxJump = 0
        for (i in 0 until 30) {
            val plan = p.plan(Frame(luma(0.05f), camera = CameraState(evIndex = last), timeMs = i * 100L), Preset.LANDSCAPE)
            maxJump = maxOf(maxJump, kotlin.math.abs(plan.evIndex - last)); last = plan.evIndex
        }
        assertTrue("≤ 1/3 EV per step (2 indices at 1/6)", maxJump <= 2)
        assertEquals("pinned at the phone's max", caps.evMax, last)
    }

    @Test fun skyClippingPullsExposureDown() {
        val p = Planner(caps)
        var ev = 0
        for (i in 0 until 20) ev = p.plan(Frame(luma(0.6f, clipHigh = 0.12f), camera = CameraState(evIndex = ev), timeMs = i * 100L), Preset.LANDSCAPE).evIndex
        assertTrue("negative EV for blown sky, got $ev", ev < 0)
    }

    @Test fun backlitFaceIsDetectedAndExposedForFace() {
        val p = Planner(caps)
        val plan = p.plan(Frame(luma(0.7f, clipHigh = 0.15f, border = 0.9f), faces = listOf(face()), subject = RegionLuma(0.3f, 0f, 0f), timeMs = 0), Preset.PORTRAIT)
        assertTrue(plan.backlit)
        val later = run(Planner(caps), 30) { ev, t -> Frame(luma(0.7f, clipHigh = 0.15f, border = 0.9f), faces = listOf(face()), subject = RegionLuma(0.3f, 0f, 0f), camera = CameraState(evIndex = ev), timeMs = t) }
        assertTrue("backlit face → EV goes UP despite clipped background", later.evIndex > 0)
    }

    @Test fun nightUsesExtensionThenManualThenAdvice() {
        val dark = { t: Long, shake: Float -> Frame(luma(0.08f), shake = shake, camera = CameraState(iso = 3200, exposureNs = 66_000_000L, evIndex = 0), timeMs = t) }
        assertEquals(CaptureMode.NIGHT, Planner(caps.copy(nightExtension = true)).plan(dark(0, 0.2f), Preset.LANDSCAPE).mode)
        val manual = Planner(caps)
        var plan = manual.plan(dark(0, 0.01f), Preset.LANDSCAPE)
        assertEquals("not steady long enough yet", CaptureMode.STANDARD, plan.mode)
        plan = manual.plan(dark(1500, 0.01f), Preset.LANDSCAPE)
        assertEquals(CaptureMode.MANUAL_NIGHT, plan.mode)
        assertEquals(500_000_000L, plan.manualExposureNs)
        assertTrue("ISO drops for the long exposure: ${plan.manualIso}", plan.manualIso!! < 3200)
        val handheld = Planner(caps.copy(manualSensor = false)).plan(dark(0, 0.2f), Preset.LANDSCAPE)
        assertEquals(CaptureMode.STANDARD, handheld.mode)
        assertTrue(handheld.reasons.any { it.contains("brace") })
    }

    @Test fun meteringFollowsTheFaceOrPresetBox() {
        val f = face(0.3f)
        assertEquals(f.box.expand(0.15f), Planner(caps).plan(Frame(luma(0.5f), faces = listOf(f), subject = RegionLuma(0.5f, 0f, 0f)), Preset.PORTRAIT).meteringBox)
        assertEquals(Rect01.centered(0.36f), Planner(caps).plan(Frame(luma(0.5f)), Preset.FOOD).meteringBox)
        assertEquals(null, Planner(caps).plan(Frame(luma(0.5f)), Preset.LANDSCAPE).meteringBox)
    }

    @Test fun zoomSuggestionRespectsHardware() {
        assertEquals(2f, Planner(caps).plan(Frame(luma(0.5f)), Preset.PORTRAIT).zoomSuggestion)
        assertEquals(1.5f, Planner(caps.copy(zoomMax = 1.5f)).plan(Frame(luma(0.5f)), Preset.PORTRAIT).zoomSuggestion)
    }

    @Test fun lockedExposureStays() {
        val p = Planner(caps); p.locked = true
        for (i in 0 until 20) assertEquals(0, p.plan(Frame(luma(0.1f), timeMs = i * 100L), Preset.LANDSCAPE).evIndex)
    }

    @Test fun summaryIsReadable() {
        assertEquals("ISO 400 · 1/60 s · +0.7 EV", Planner.summary(CameraState(iso = 400, exposureNs = 16_666_667L, evIndex = 4), caps))
        assertEquals("1/2 s", Planner.shutterLabel(500_000_000L))
        assertEquals("1.0 s", Planner.shutterLabel(1_000_000_000L))
    }

    // ---------------- Coach ----------------
    private fun coachFrame(roll: Float = 0f, pitch: Float = 0f, faces: List<Face> = emptyList(), shake: Float = 0f, t: Long = 0) =
        Frame(luma(0.5f), faces = faces, subject = if (faces.isEmpty()) null else RegionLuma(0.5f, 0f, 0f), rollDeg = roll, pitchDeg = pitch, shake = shake, timeMs = t)

    @Test fun levelCueDirection() {
        val c = Coach()
        assertEquals(Cue.ROTATE_CCW, c.evaluate(coachFrame(roll = 5f), Preset.LANDSCAPE, null).first().cue)
        assertEquals(Cue.ROTATE_CW, c.evaluate(coachFrame(roll = -5f), Preset.LANDSCAPE, null).first().cue)
        assertTrue(c.evaluate(coachFrame(roll = 0.4f), Preset.LANDSCAPE, null).isEmpty())
    }

    @Test fun levelHysteresis() {
        val c = Coach()
        // 0.8° is inside the 1° tolerance normally, but not while the cue is already showing (0.6° exit)
        assertTrue(c.evaluate(coachFrame(roll = 0.8f), Preset.LANDSCAPE, null, active = null).isEmpty())
        assertEquals(Cue.ROTATE_CCW, c.evaluate(coachFrame(roll = 0.8f), Preset.LANDSCAPE, null, active = Cue.ROTATE_CCW).first().cue)
    }

    @Test fun shakeWins() {
        assertEquals(Cue.HOLD_STEADY, Coach().evaluate(coachFrame(roll = 6f, shake = 0.5f), Preset.LANDSCAPE, null).first().cue)
    }

    @Test fun foodAngle() {
        val c = Coach()
        assertEquals(Cue.TILT_DOWN, c.evaluate(coachFrame(pitch = -10f), Preset.FOOD, null).first().cue)
        assertTrue("45° is fine", c.evaluate(coachFrame(pitch = -45f), Preset.FOOD, null).isEmpty())
        assertTrue("top-down is fine", c.evaluate(coachFrame(pitch = -86f), Preset.FOOD, null).isEmpty())
    }

    @Test fun portraitFraming() {
        val c = Coach()
        assertEquals(Cue.STEP_CLOSER, c.evaluate(coachFrame(faces = listOf(face(h = 0.08f, top = 0.2f))), Preset.PORTRAIT, null).first().cue)
        assertEquals(Cue.RAISE_PHONE, c.evaluate(coachFrame(pitch = -30f, faces = listOf(face())), Preset.PORTRAIT, null).first().cue)
        val lowEyes = c.evaluate(coachFrame(faces = listOf(face(top = 0.45f, h = 0.25f))), Preset.PORTRAIT, null)
        assertTrue("eyes low → tilt down", lowEyes.any { it.cue == Cue.TILT_DOWN })
        val cut = c.evaluate(coachFrame(faces = listOf(face(0.1f, h = 0.3f), face(0.5f))), Preset.GROUP, null)
        assertTrue("edge cut → step back", cut.any { it.cue == Cue.STEP_BACK })
        assertTrue("good portrait → no tips", c.evaluate(coachFrame(faces = listOf(face(0.5f, top = 0.16f, h = 0.26f))), Preset.PORTRAIT, null).isEmpty())
    }

    @Test fun coachDebouncesAndShowsReady() {
        val c = Coach(enterMs = 300, minShowMs = 1000)
        assertNull(c.update(coachFrame(roll = 5f, t = 0), Preset.LANDSCAPE, null).tip)
        assertEquals(Cue.ROTATE_CCW, c.update(coachFrame(roll = 5f, t = 350), Preset.LANDSCAPE, null).tip?.cue)
        val fixed = c.update(coachFrame(roll = 0f, t = 400), Preset.LANDSCAPE, null)
        assertEquals("level cue lingers briefly", Cue.ROTATE_CCW, fixed.tip?.cue)
        val later = c.update(coachFrame(roll = 0f, t = 1500), Preset.LANDSCAPE, null)
        assertEquals(Cue.READY, later.tip?.cue); assertTrue(later.ready)
    }

    private fun assertNull(v: Any?) = assertTrue("expected null, got $v", v == null)

    // ---------------- Review ----------------
    @Test fun reviewScoresAGoodShotHigh() {
        val shot = Frame(luma(0.5f), faces = listOf(face(0.5f, top = 0.16f, h = 0.26f)), subject = RegionLuma(0.52f, 0f, 0f), timeMs = 0)
        val r = ShotReviewer.review(luma(0.5f, sharp = 0.2f, p5 = 0.1f, p95 = 0.9f), RegionLuma(0.52f, 0f, 0f), shot, Preset.PORTRAIT, null)
        assertTrue("score ${r.score}", r.score >= 90)
        assertTrue(r.praise.isNotEmpty())
    }

    @Test fun reviewExplainsProblems() {
        val shot = Frame(luma(0.3f), faces = listOf(face(0.5f, top = 0.16f, h = 0.26f)), rollDeg = 6f, shake = 0.4f, timeMs = 0)
        val r = ShotReviewer.review(luma(0.3f, sharp = 0.04f), RegionLuma(0.25f, 0f, 0f), shot, Preset.PORTRAIT, null)
        assertTrue("score ${r.score}", r.score < 60)
        assertTrue(r.tips.any { it.contains("blur") })
        assertTrue(r.tips.size <= 3)
        assertFalse(r.tips.isEmpty())
    }
}
