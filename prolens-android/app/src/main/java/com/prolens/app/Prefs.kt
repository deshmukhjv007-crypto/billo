package com.prolens.app

import android.content.Context
import android.content.SharedPreferences
import com.prolens.app.core.Features
import com.prolens.app.core.SellerTarget
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The user's settings and what they own, kept on the phone. */
class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.applicationContext.getSharedPreferences("prolens", Context.MODE_PRIVATE)

    private fun flag(key: String, def: Boolean) = sp.getBoolean(key, def)
    private fun put(key: String, v: Boolean) { sp.edit().putBoolean(key, v).apply() }

    var onboarded: Boolean get() = flag("onboarded", false); set(v) = put("onboarded", v)
    var grid: Boolean get() = flag("grid", true); set(v) = put("grid", v)
    var tips: Boolean get() = flag("tips", true); set(v) = put("tips", v)
    var haptics: Boolean get() = flag("haptics", true); set(v) = put("haptics", v)
    var autoReview: Boolean get() = flag("autoReview", true); set(v) = put("autoReview", v)
    /** true = save into the phone's main Camera album, false = a separate "Prolens" album. */
    var saveToCamera: Boolean get() = flag("saveToCamera", true); set(v) = put("saveToCamera", v)

    var sellerTarget: SellerTarget
        get() = try { SellerTarget.valueOf(sp.getString("sellerTarget", null) ?: SellerTarget.MARKETPLACE.name) } catch (e: Exception) { SellerTarget.MARKETPLACE }
        set(v) { sp.edit().putString("sellerTarget", v.name).apply() }

    /** Last known answer from Google Play: does this account own Pro? */
    var proOwned: Boolean get() = flag("proOwned", false); set(v) = put("proOwned", v)
    /** Test switch, honoured only in debug builds. */
    var debugPro: Boolean get() = flag("debugPro", false); set(v) = put("debugPro", v)
    val isPro: Boolean get() = proOwned || (BuildConfig.DEBUG && debugPro)

    /** Test mode: record how Prolens behaves (see diag/DiagLog). */
    var testMode: Boolean get() = flag("testMode", false); set(v) = put("testMode", v)
    var testStep: Int get() = sp.getInt("testStep", 0); set(v) { sp.edit().putInt("testStep", v).apply() }

    val albumPath: String get() = if (saveToCamera) "DCIM/Camera" else "Pictures/Prolens"

    // ---- free listing images per day
    private fun today() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    fun listingsLeft(): Int = Features.listingsLeft(isPro, today(), sp.getString("listingDay", null), sp.getInt("listingCount", 0))
    fun countListing() {
        val t = today()
        val n = if (sp.getString("listingDay", null) == t) sp.getInt("listingCount", 0) else 0
        sp.edit().putString("listingDay", t).putInt("listingCount", n + 1).apply()
    }
}
