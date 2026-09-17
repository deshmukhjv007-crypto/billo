package com.billo.app

import android.app.Activity
import android.util.Log
import android.widget.Toast
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Product
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Google Play Billing for Billo Pro (non-consumable one-time in-app products).
 *
 * Products to create in Play Console (monetization → in-app products):
 *   pro_monthly   — ₹79 / month (subscription is also fine; switch ProductType to SUBS if so)
 *   pro_annual    — ₹399 / year
 *   pro_lifetime  — ₹699 / one-time
 *
 * Notes:
 *  • The unlock is stored on-device AND restored from purchase history on launch,
 *    so users who re-install keep Pro after signing in with the same Google account.
 *  • For production you should verify the purchase token on your own backend
 *    (or use Google's offline verification) — see README-ANDROID.md.
 */
object PlayBilling {

    private const val TAG = "BilloBilling"
    private const val PREFS = "billo_prefs"
    private const val KEY_PRO = "pro_unlocked"

    private var client: BillingClient? = null

    fun isPro(activity: Activity): Boolean =
        activity.getSharedPreferences(PREFS, 0).getBoolean(KEY_PRO, false)

    fun init(activity: Activity) {
        if (client != null) return
        val c = BillingClient.newBuilder(activity.applicationContext)
            .enablePendingPurchases()
            .setListener { res ->
                if (res.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.i(TAG, "Billing ready — restoring purchases")
                    restore(activity)
                } else {
                    Log.w(TAG, "Billing not ready: " + res.debugMessage)
                }
            }
            .build()
        client = c
    }

    /** Restore a previous Pro purchase (re-install / new device with same Google account). */
    fun restore(activity: Activity) {
        val c = client ?: return
        if (isPro(activity)) {
            unlockWeb(activity)
            return
        }
        c.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        ) { res, purchases ->
            if (res.responseCode == BillingClient.BillingResponseCode.OK) {
                val bought = purchases.any { p ->
                    p.products.any { it.startsWith("pro_") } &&
                        p.purchaseState == Purchase.PurchaseState.PURCHASED
                }
                if (bought) {
                    savePro(activity)
                    Log.i(TAG, "Pro restored from purchase history")
                }
            }
        }
    }

    fun buy(activity: Activity, productId: String) {
        val c = client
        if (c == null || !c.isReady) {
            toast(activity, "Store is still connecting… try again in a few seconds.")
            return
        }
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
            )
            .build()

        c.queryProductDetailsAsync(params) { res, details ->
            if (res.responseCode != BillingClient.BillingResponseCode.OK || details.isEmpty()) {
                toast(activity, "This product isn't set up in Play Console yet — see README-ANDROID.md")
                return@queryProductDetailsAsync
            }
            val flow = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(
                    listOf(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(details[0])
                            .build()
                    )
                )
                .build()

            c.launchBillingFlow(activity, flow) { result ->
                when (result.responseCode) {
                    BillingClient.BillingResponseCode.OK -> {
                        c.queryPurchasesAsync(
                            QueryPurchasesParams.newBuilder()
                                .setProductType(BillingClient.ProductType.INAPP)
                                .build()
                        ) { _, purchases ->
                            val p = purchases.firstOrNull {
                                it.products.contains(productId) &&
                                    it.purchaseState == Purchase.PurchaseState.PURCHASED
                            }
                            if (p != null) {
                                p.acknowledgePurchaseAsync(
                                    AcknowledgePurchaseParams.newBuilder()
                                        .setPurchaseToken(p.purchaseToken)
                                        .build()
                                ) { _ -> }
                                savePro(activity)
                            }
                        }
                    }
                    BillingClient.BillingResponseCode.USER_CANCELED -> Unit // user backed out
                    else -> toast(activity, "Purchase failed: " + result.debugMessage)
                }
            }
        }
    }

    private fun savePro(activity: Activity) {
        activity.getSharedPreferences(PREFS, 0).edit().putBoolean(KEY_PRO, true).apply()
        Log.i(TAG, "Pro unlocked")
        unlockWeb(activity)
    }

    private fun unlockWeb(activity: Activity) {
        (activity as? MainActivity)?.unlockPro()
    }

    private fun toast(activity: Activity, msg: String) {
        activity.runOnUiThread { Toast.makeText(activity, msg, Toast.LENGTH_LONG).show() }
    }
}
