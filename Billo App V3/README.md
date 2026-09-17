# Billo — "Just send the bills. We'll do the math."

A complete, shippable v1 of the group-trip money app from your brief:
receipts in, math out — **Photo/Say → Confirm → Done**, with a ledger engine,
settlement optimizer, WhatsApp share card, English + हिंदी, and a Pro paywall
wired to Google Play Billing.

```
/home/user
├── app/                        ← THE PRODUCT (self-contained PWA, also the Android asset bundle)
│   ├── index.html              ← entire app: UI + ledger engine + AI inbox parser + share-card renderer
│   ├── manifest.webmanifest    ← PWA install
│   ├── sw.js                   ← offline cache
│   └── icons/                  ← PWA icons (192/512 + maskable)
├── android/                    ← Android Studio project (WebView shell + Play Billing)
│   ├── app/src/main/java/com/billo/app/
│   │   ├── MainActivity.kt     ← WebView + photo picker + share
│   │   ├── BilloWebBridge.kt   ← window.Billo { shareText, openExternal, isPro, buyPro }
│   │   └── PlayBilling.kt      ← Google Play Billing v7 (pro_monthly/annual/lifetime)
│   ├── app/src/main/assets/www/← copy of the app (what the WebView loads)
│   └── … (gradle, manifest, res, icons)
├── playstore/                  ← store kit
│   ├── listing.md              ← name, short/full description, screenshots plan
│   ├── icon-512.png            ← store icon (generated)
│   ├── privacy-policy.html     ← host this (GitHub Pages) and paste URL into Play Console
│   ├── data-safety.md          ← exact answers for the Data Safety form
│   └── launch-checklist.md     ← the 9 steps to go live
├── scripts/
│   └── make_icons.py           ← regenerate every icon (python3 scripts/make_icons.py)
├── test/
│   └── logic_test.js           ← 62 unit tests for the money math + parser (node test/logic_test.js)
└── README-ANDROID.md           ← build the AAB, step by step
```

---

## Try it right now
The live preview at the top of this chat **is the app** (served from `app/`).
On your phone it gets the camera, the native share sheet and installability.

Web-only notes:
- **Snap it** works with your camera or your photo library, and **reads the bill
  automatically with zero setup** — on-device OCR (Tesseract WASM, ~7 MB, bundled
  in `app/ocr/`) runs entirely on the phone; the photo never leaves the device.
  Optionally add a vision key (Settings → AI bill-reading, any OpenAI-compatible
  endpoint, default `gpt-4o-mini`) for higher accuracy — the cloud model is tried
  first when present, with on-device OCR as automatic fallback. **Say it** also
  parses 100% on-device, and Quick is two taps.
- The data never leaves the phone (localStorage). Settings → Backup = export/import JSON.

## What's implemented (vs. your spec)

| Spec item | Status |
|---|---|
| Photo/Say → Confirm → Done | ✅ all three entry modes; one confirm card |
| "Paid ₹800 cab for me and Rahul" inbox | ✅ on-device parser (Hinglish included: *sirf mere liye petrol 500*, *maine paid*, names, "for X and Y", "for everyone") |
| AI extraction (who paid / what / amount / who's in) | ✅ **zero-config**: on-device OCR (no key, no network, photo never leaves phone); optional cloud vision endpoint (user's own key) for higher accuracy |
| Progressive participant learning (your Level 2) | ✅ after 3+ similar bills, Billo pre-suggests the usual group + "Based on past bills" |
| Running balances (Rahul owes Jay ₹1,240) | ✅ paise-exact ledger, per-person board |
| Fewest-possible settlements | ✅ greedy debt-graph reduction (≤ n−1 payments), one-tap "mark paid", undo |
| Beautiful WhatsApp share card | ✅ 1080×1350 canvas card (totals, per-person, settlements, store CTA) + formatted text |
| Viral loop | ✅ invite link with trip code + share card that pitches the app |
| Free core / paid money movement | ✅ free plan = everything; Pro = receipt archive, 12 currencies, any AI endpoint, clean cards — via **real Play Billing** in the Android build |
| Zero manual bookkeeping | ✅ no categories-to-choose, no re-typing amounts; confirm-only interaction |

## The money (honest version)
- **v1 revenue = Billo Pro unlocks** (₹79/mo, ₹399/yr, ₹699/lifetime) — the billing
  flow, restore-on-launch, and product IDs are already coded. You must create the
  three products in Play Console (checklist step 5) and test with a linked test card.
- **v2 revenue** (when you have users): AdMob on the free plan (needs a small native
  addition — say the word and I'll add it), group collection for Airbnbs, trip bookings.
- The growth engine is the share card + WhatsApp invites. One trip = 5 installs.

## Ship it (30-second version)
1. `README-ANDROID.md` → build the AAB in Android Studio (needs Android Studio on your machine).
2. `playstore/launch-checklist.md` → $25 fee, listing copy, live privacy policy, data-safety form, Pro products, upload, internal test, submit.
That's the whole path. Everything else is already done.

## v2 roadmap (when the v1 numbers are in)
1. **Multi-device sync** — the one thing a no-backend build can't do: today one person
   (the trip leader) runs the books and exports a backup to sync. A ~100-line Firebase
   Realtime add-on (optional, user-supplied project config, same privacy posture) makes
   every member live-synced. This is the upgrade that turns a "one phone's app" into a group product.
2. **Real WhatsApp bot** — a dedicated number/link per group (WhatsApp Cloud API) so bills
   can be sent *without opening the app at all*.
3. **Server-side AI** — your own backend calling gpt-4o-mini (≈ fractions of a paisa per bill)
   so users never manage keys; Pro = priority/accurate lane.
4. **Group collection & bookings** — "collect ₹3,000 for the Airbnb", activity links.
5. **AdMob** on the free plan, once you have volume.

## Rebranding
The name lives in one JS constant (`APP = { name: "Billo", … }` in `app/index.html`),
`android/.../strings.xml`, and the manifest. The icon has no name in it (₹ motif),
so a rename is: 3 text edits + rebuild. If you pick a different name from your list
(SplitSnap, Settle, TabSplit…), tell me and I'll regenerate everything in one pass.

## Quality gates already passed
- `node --check` on the app script ✅
- 62/62 unit tests: paise-exact splitting, ledger invariants (nets sum to 0; flows
  always settle to zero), parser cases, learning, share text, formatting ✅
  → run anytime: `node test/logic_test.js`
