package com.prolens.app.diag

import com.prolens.app.core.Capabilities
import com.prolens.app.core.CoachState
import com.prolens.app.core.Frame
import com.prolens.app.core.Plan
import com.prolens.app.core.Preset
import com.prolens.app.core.ProductFind
import com.prolens.app.core.Rect01
import com.prolens.app.core.Review
import com.prolens.app.core.SellerStatus
import com.prolens.app.diag.DiagLog.num
import com.prolens.app.diag.DiagLog.obj
import org.json.JSONArray
import org.json.JSONObject

/** Turns Prolens' live state into compact JSON for the test report. */
object Snap {
    fun box(r: Rect01?): JSONArray? = r?.let { JSONArray(listOf(num(it.left), num(it.top), num(it.right), num(it.bottom))) }

    fun caps(c: Capabilities): JSONObject = obj(
        "ev" to listOf(c.evMin, c.evMax), "evStep" to c.evStep,
        "iso" to listOf(c.isoMin, c.isoMax), "expNs" to listOf(c.exposureMinNs, c.exposureMaxNs),
        "manual" to c.manualSensor, "awb" to c.awbModes.map { it.name },
        "aeRegions" to c.maxMeteringRegions, "afRegions" to c.maxFocusRegions,
        "zoom" to listOf(c.zoomMin, c.zoomMax), "flash" to c.hasFlash,
        "night" to c.nightExtension, "hdr" to c.hdrExtension,
        "focal35" to c.focal35mm, "ois" to c.ois, "fixedFocus" to c.fixedFocus
    )

    fun frame(
        f: Frame, userPreset: Preset, effective: Preset, plan: Plan, cs: CoachState,
        seller: SellerStatus?, find: ProductFind?, tipsShown: String?
    ): JSONObject {
        val l = f.luma
        val face = f.primaryFace
        val o = obj(
            "preset" to userPreset.name, "scene" to effective.name,
            "luma" to obj("mean" to l.mean, "p5" to l.p5, "p95" to l.p95, "clipHi" to l.clipHigh, "clipLo" to l.clipLow,
                "center" to l.center, "border" to l.border, "sharp" to l.sharpness),
            "tint" to f.tint.warmth,
            "faces" to f.faces.size,
            "face" to box(face?.box),
            "subject" to f.subject?.mean,
            "roll" to f.rollDeg, "pitch" to f.pitchDeg, "shake" to f.shake,
            "cam" to obj("iso" to f.camera.iso, "expNs" to f.camera.exposureNs, "ev" to f.camera.evIndex,
                "zoom" to f.camera.zoom, "front" to f.camera.front, "mode" to f.camera.mode.name),
            "plan" to obj("ev" to plan.evIndex, "mode" to plan.mode.name, "meter" to box(plan.meteringBox),
                "zoomTip" to plan.zoomSuggestion, "flash" to plan.flash.name, "backlit" to plan.backlit,
                "dark" to plan.dark, "contrast" to plan.highContrast,
                "manualIso" to plan.manualIso, "manualExpNs" to plan.manualExposureNs,
                "why" to plan.reasons),
            "coach" to obj("tip" to cs.tip?.cue?.name, "text" to tipsShown, "second" to cs.secondary?.text,
                "ready" to cs.ready, "readiness" to cs.readiness)
        )
        if (seller != null) {
            o.put("seller", obj(
                "ready" to seller.ready,
                "fails" to seller.items.filter { !it.ok }.map { it.id },
                "box" to box(find?.box), "bg" to find?.bgLevel, "bgSpread" to find?.bgSpread, "cover" to find?.coverage
            ))
        }
        return o
    }

    fun review(r: Review): JSONObject = obj(
        "score" to r.score, "grade" to r.grade,
        "parts" to r.parts.map { "${it.name} ${it.score}/${it.max}" },
        "tips" to r.tips, "praise" to r.praise
    )
}
