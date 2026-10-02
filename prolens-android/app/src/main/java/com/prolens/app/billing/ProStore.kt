package com.prolens.app.billing

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.prolens.app.Prefs

/**
 * Prolens Pro: one in-app product, bought once through Google Play.
 *
 * Create it in Play Console → Monetize → In-app products with the id [PRODUCT_ID]. Until the app is
 * on Play (and the product is active), Google Play has nothing to sell, so [buy] reports that.
 * The last answer from Play is cached in [Prefs.proOwned] so Pro works offline.
 */
object ProStore : PurchasesUpdatedListener {
    const val PRODUCT_ID = "prolens_pro_lifetime"
    const val FALLBACK_PRICE = "₹299"

    private var client: BillingClient? = null
    private var prefs: Prefs? = null
    private val main = Handler(Looper.getMainLooper())
    private val listeners = LinkedHashSet<() -> Unit>()

    @Volatile var product: ProductDetails? = null
        private set
    @Volatile var price: String = FALLBACK_PRICE
        private set

    val isPro: Boolean get() = prefs?.isPro ?: false

    fun init(ctx: Context) {
        if (prefs == null) prefs = Prefs(ctx)
        if (client != null) return
        client = BillingClient.newBuilder(ctx.applicationContext)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
        connect()
    }

    private fun connect() {
        val c = client ?: return
        if (c.isReady) { loadProduct(); queryOwned(); return }
        try {
            c.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) { loadProduct(); queryOwned() }
                }
                override fun onBillingServiceDisconnected() { }
            })
        } catch (e: Throwable) { }
    }

    /** Ask Google Play again (on app resume, or from "Restore purchase"). */
    fun refresh() = connect()

    private fun loadProduct() {
        val c = client ?: return
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()))
            .build()
        c.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                val pd = list.firstOrNull { it.productId == PRODUCT_ID }
                product = pd
                pd?.oneTimePurchaseOfferDetails?.formattedPrice?.let { price = it }
                changed()
            }
        }
    }

    private fun queryOwned() {
        val c = client ?: return
        c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) handle(purchases, fromQuery = true)
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> handle(purchases ?: emptyList(), fromQuery = false)
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> queryOwned()
            else -> { }
        }
    }

    private fun handle(purchases: List<Purchase>, fromQuery: Boolean) {
        var owned = false
        for (p in purchases) {
            if (!p.products.contains(PRODUCT_ID)) continue
            if (p.purchaseState == Purchase.PurchaseState.PURCHASED) {
                owned = true
                if (!p.isAcknowledged) {
                    // Play refunds purchases that are not acknowledged within 3 days
                    val ack = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()
                    client?.acknowledgePurchase(ack) { }
                }
            }
        }
        val pf = prefs
        if (pf != null) {
            if (fromQuery) pf.proOwned = owned else if (owned) pf.proOwned = true
        }
        changed()
    }

    /** Opens Google Play's purchase sheet. Returns a message to show when it can't, else null. */
    fun buy(activity: Activity): String? {
        val c = client ?: return "Google Play isn't available on this phone."
        val pd = product
        if (!c.isReady || pd == null) {
            connect()
            return "Prolens Pro isn't available yet. It goes on sale when the app is on Google Play."
        }
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build()))
            .build()
        val r = c.launchBillingFlow(activity, params)
        return if (r.responseCode == BillingClient.BillingResponseCode.OK) null else "Couldn't start the purchase. Please try again."
    }

    fun addListener(l: () -> Unit) { listeners += l }
    fun removeListener(l: () -> Unit) { listeners -= l }

    private fun changed() { main.post { for (l in listeners.toList()) l() } }
}
