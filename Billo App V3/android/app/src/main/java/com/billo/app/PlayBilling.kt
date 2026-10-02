package com.billo.app

import android.app.Activity
import android.content.Context
import android.util.Log
import android.widget.Toast
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.lang.ref.WeakReference

/**
 * Google Play Billing (library 7.x) for Billo Pro — one-time in-app products.
 *
 * Products to create in Play Console (Monetize → In-app products):
 *   pro_monthly, pro_annual, pro_lifetime   (any product id starting with "pro_" unlocks Pro)
 *
 * The unlock is saved on the phone and re-checked with Google Play on every launch,
 * so people who re-install keep Pro when they use the same Google account.
 */
object PlayBilling : PurchasesUpdatedListener {

    private const val TAG = "BilloBilling"
    private const val PREFS = "billo_prefs"
    private const val KEY_PRO = "pro_unlocked"

    private var client: BillingClient? = null
    private var appCtx: Context? = null
    private var activityRef: WeakReference<Activity>? = null

    fun isPro(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, 0).getBoolean(KEY_PRO, false)

    fun init(activity: Activity) {
        activityRef = WeakReference(activity)
        appCtx = activity.applicationContext
        if (client == null) {
            client = BillingClient.newBuilder(activity.applicationContext)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build()
        }
        connect { restore() }
    }

    private fun connect(then: () -> Unit) {
        val c = client ?: return
        if (c.isReady) { then(); return }
        try {
            c.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) then()
                    else Log.w(TAG, "Billing not ready: " + result.debugMessage)
                }

                override fun onBillingServiceDisconnected() {}
            })
        } catch (e: Throwable) {
            Log.w(TAG, "Billing connect failed", e)
        }
    }

    /** Restore an earlier Pro purchase (re-install / new phone with the same Google account). */
    fun restore() {
        val ctx = appCtx ?: return
        if (isPro(ctx)) { unlockWeb(); return }
        val c = client ?: return
        c.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        ) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) handle(purchases)
        }
    }

    fun buy(activity: Activity, productId: String) {
        activityRef = WeakReference(activity)
        val c = client
        if (c == null) {
            toast(activity, "Google Play isn't available on this phone.")
            return
        }
        connect {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(
                    listOf(
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(productId)
                            .setProductType(BillingClient.ProductType.INAPP)
                            .build()
                    )
                )
                .build()
            c.queryProductDetailsAsync(params) { result, details ->
                val pd = details.firstOrNull()
                if (result.responseCode != BillingClient.BillingResponseCode.OK || pd == null) {
                    toast(activity, "Billo Pro isn't on sale yet. It goes live when Billo is on Google Play.")
                    return@queryProductDetailsAsync
                }
                val flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build())
                    )
                    .build()
                activity.runOnUiThread {
                    val r = c.launchBillingFlow(activity, flow)
                    if (r.responseCode != BillingClient.BillingResponseCode.OK) {
                        toast(activity, "Couldn't start the purchase. Please try again.")
                    }
                }
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> handle(purchases ?: emptyList())
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> restore()
            BillingClient.BillingResponseCode.USER_CANCELED -> Unit
            else -> activityRef?.get()?.let { toast(it, "Purchase failed: " + result.debugMessage) }
        }
    }

    private fun handle(purchases: List<Purchase>) {
        var owned = false
        for (p in purchases) {
            if (p.products.none { it.startsWith("pro_") }) continue
            if (p.purchaseState != Purchase.PurchaseState.PURCHASED) continue
            owned = true
            if (!p.isAcknowledged) {
                // Google refunds purchases that aren't acknowledged within 3 days
                val ack = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
                client?.acknowledgePurchase(ack) { }
            }
        }
        if (owned) savePro()
    }

    private fun savePro() {
        val ctx = appCtx ?: return
        ctx.getSharedPreferences(PREFS, 0).edit().putBoolean(KEY_PRO, true).apply()
        Log.i(TAG, "Pro unlocked")
        unlockWeb()
    }

    private fun unlockWeb() {
        val a = activityRef?.get() as? MainActivity ?: return
        a.runOnUiThread { a.unlockPro() }
    }

    private fun toast(activity: Activity, msg: String) {
        activity.runOnUiThread { Toast.makeText(activity, msg, Toast.LENGTH_LONG).show() }
    }
}
