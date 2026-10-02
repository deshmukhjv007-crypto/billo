package com.prolens.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SellerTest {
    private val w = 120
    private val h = 160

    /** White background (230) with a dark product box. */
    private fun scene(x0: Int, y0: Int, x1: Int, y1: Int, bg: (Int, Int) -> Int = { _, _ -> 230 }, product: Int = 60) =
        IntArray(w * h) { i -> val x = i % w; val y = i / w; if (x in x0 until x1 && y in y0 until y1) product else bg(x, y) }

    private fun frame(sharp: Float = 0.2f, roll: Float = 0f, pitch: Float = -20f) =
        Frame(Luma(0.7f, 0.2f, 0.7f, 0.95f, 0.1f, 0f, 0.6f, 0.9f, sharp), rollDeg = roll, pitchDeg = pitch)

    @Test fun findsProductOnWhite() {
        val f = ProductFinder.find(scene(30, 40, 90, 120), w, h)
        assertNotNull(f)
        f!!
        assertEquals(30f / w, f.box.left, 0.01f)
        assertEquals(40f / h, f.box.top, 0.01f)
        assertEquals(90f / w, f.box.right, 0.01f)
        assertEquals(120f / h, f.box.bottom, 0.01f)
        assertTrue("white background: ${f.bgLevel}", f.bgLevel > 0.85f)
        assertTrue("even background: ${f.bgSpread}", f.bgSpread < 0.02f)
    }

    @Test fun nothingOnEmptyBackground() {
        assertNull(ProductFinder.find(IntArray(w * h) { 230 }, w, h))
    }

    @Test fun readyWhenEverythingIsRight() {
        val find = ProductFinder.find(scene(20, 30, 100, 130), w, h)
        val s = SellerCheck.live(find, frame(), SellerTarget.MARKETPLACE)
        assertTrue(s.items.joinToString { "${it.id}=${it.ok}" }, s.ready)
    }

    @Test fun greyBackgroundIsFlagged() {
        val find = ProductFinder.find(scene(20, 30, 100, 130, bg = { _, _ -> 150 }, product = 40), w, h)
        val s = SellerCheck.live(find, frame(), SellerTarget.MARKETPLACE)
        assertFalse(s.ready)
        assertEquals("background", s.firstProblem?.id)
        // the same photo is fine for a social post
        assertTrue(SellerCheck.live(find, frame(), SellerTarget.SOCIAL).items.first { it.id == "background" }.ok)
    }

    @Test fun busyBackgroundIsFlagged() {
        val find = ProductFinder.find(scene(30, 40, 90, 120, bg = { x, y -> if ((x / 6 + y / 6) % 2 == 0) 240 else 120 }), w, h)
        val s = SellerCheck.live(find, frame(), SellerTarget.SOCIAL)
        assertFalse(s.items.first { it.id == "background" }.ok)
    }

    @Test fun tinyAndCutOffProducts() {
        val tiny = SellerCheck.live(ProductFinder.find(scene(55, 70, 70, 90), w, h), frame(), SellerTarget.MARKETPLACE)
        assertEquals("size", tiny.firstProblem?.id)
        val cut = SellerCheck.live(ProductFinder.find(scene(0, 40, 80, 120), w, h), frame(), SellerTarget.MARKETPLACE)
        assertEquals("inside", cut.firstProblem?.id)
    }

    @Test fun blurAndTiltAreFlagged() {
        val find = ProductFinder.find(scene(20, 30, 100, 130), w, h)
        assertEquals("sharp", SellerCheck.live(find, frame(sharp = 0.03f), SellerTarget.MARKETPLACE).firstProblem?.id)
        assertEquals("level", SellerCheck.live(find, frame(roll = 6f), SellerTarget.MARKETPLACE).firstProblem?.id)
        // straight down, roll doesn't matter
        assertTrue(SellerCheck.live(find, frame(roll = 6f, pitch = -88f), SellerTarget.MARKETPLACE).ready)
    }

    @Test fun cropMakesProductFill87Percent() {
        // 3000×4000 upright photo, product 1500×2000 px in the middle
        val c = SellerCheck.crop(Rect01(0.25f, 0.25f, 0.75f, 0.75f), 3000, 4000, SellerTarget.MARKETPLACE)
        assertEquals(2299, c.side)
        assertEquals(2000, c.outSize)
        assertFalse(c.tooSmall)
        assertTrue("left ${c.left}", kotlin.math.abs(c.left - (1500 - 2299 / 2)) <= 1)
        assertTrue("top ${c.top}", kotlin.math.abs(c.top - (2000 - 2299 / 2)) <= 1)
    }

    @Test fun smallPhotoIsTooSmall() {
        val c = SellerCheck.crop(Rect01(0.4f, 0.4f, 0.6f, 0.6f), 1200, 1600, SellerTarget.MARKETPLACE)
        assertTrue(c.tooSmall)
        assertEquals(c.side, c.outSize)
    }

    @Test fun freeAndProRules() {
        assertTrue(Features.presetAllowed(Preset.SELLER, pro = false))
        assertFalse(Features.presetAllowed(Preset.NIGHT, pro = false))
        assertTrue(Features.presetAllowed(Preset.NIGHT, pro = true))
        assertEquals(3, Features.listingsLeft(false, "2026-10-02", "2026-10-01", 3))
        assertEquals(1, Features.listingsLeft(false, "2026-10-02", "2026-10-02", 2))
        assertTrue(Features.listingsLeft(true, "2026-10-02", "2026-10-02", 99) > 1000)
    }

    @Test fun sellerPresetDoesNotFightBrightBackground() {
        val caps = Capabilities(evMin = -12, evMax = 12, evStep = 1f / 6f)
        val p = Planner(caps)
        // bright scene with a clipped centre: a portrait would pull exposure down, Seller Studio may not
        var plan: Plan? = null
        for (t in 0 until 20) {
            val f = Frame(Luma(0.6f, 0.3f, 0.6f, 1f, 0.3f, 0f, 0.55f, 0.8f, 0.2f), subject = RegionLuma(0.55f, 0.2f, 0f), timeMs = t * 500L)
            plan = p.plan(f, Preset.SELLER)
        }
        assertTrue("EV should go up for a white background: ${plan!!.evIndex}", plan.evIndex > 0)
    }
}
