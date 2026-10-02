# Billo — Play Store Launch Checklist

Everything below, in order. Estimated total effort: ~2 evenings.

## 0. Prerequisites
- [ ] A Gmail account (developer identity — the name shown publicly on Play, e.g. your real name)
- [ ] Phone number + payment method
- [ ] A **public** privacy-policy URL (step 3 below)
- [ ] Android Studio (Hedgehog or newer) on your machine
- [ ] (Later) a test phone for the internal testing track

## 1. Google Play developer account — $25 one-time (≈ ₹2,300)
- [ ] https://play.google.com/console → pay the one-time fee → accept Developer Program Policies
- [ ] Fill: name, country (IN), address, payment method, tax info (GSTIN optional in India for small sellers — follow the prompts)

## 2. Create the app
- [ ] Play Console → **Create app**: name `Billo`, default language English, app type **App**, currency INR
- [ ] App content → **App icon**: upload `playstore/icon-512.png`
- [ ] App content → **Feature graphic**: upload `playstore/feature-graphic-1024x500.png` (already generated)
- [ ] App content → **Short description**: copy from `playstore/listing.md`
- [ ] App content → **Full description**: copy from `playstore/listing.md`
- [ ] Category: Finance (primary)
- [ ] Screenshots: phone screenshots per `playstore/listing.md` (min 2, recommended 5; 1080×1920)
- [ ] **Content rating**: complete the questionnaire (all "No" → Everyone)

## 3. Privacy policy (must be LIVE before you can submit)
- [ ] Take `playstore/privacy-policy.html`, replace `hello@billo.app` with your real email
- [ ] Host it free, e.g. GitHub Pages:
      1. New GitHub repo (public) → commit the file as `index.html`
      2. Settings → Pages → deploy from branch → done: `https://<you>.github.io/<repo>/`
- [ ] Paste the URL into Play Console → App content → Privacy policy

## 4. Data safety form
- [ ] Play Console → App content → **Data safety** → follow `playstore/data-safety.md`

## 5. In-app products (Billo Pro)
- [ ] Monetization → In-app products → create:
      | Product ID | Price | Title |
      |---|---|---|
      | `pro_monthly` | ₹79/mo | Billo Pro — Monthly |
      | `pro_annual` | ₹399/yr | Billo Pro — Yearly |
      | `pro_lifetime` | ₹699 once | Billo Pro — Lifetime |
      *(As one-time in-app products for v1. The Android project expects exactly these IDs.)*
- [ ] Link a **test card** (Monetization → test cards) and test purchases on a test device
- [ ] Add 4+ screenshots per product (reuse the Pro screen screenshot)

## 6. Build & upload the AAB
- [ ] Open `android/` in Android Studio (File → Open) — let it sync
- [ ] Create the upload keystore (one time, **keep the .keystore + password forever**):
      ```
      keytool -genkeypair -v -keystore billo-upload.keystore -alias billo \
        -keyalg RSA -keysize 2048 -validity 10000
      ```
- [ ] Put `billo-upload.keystore` in `android/` and fill `android/app/build.gradle` → `signingConfigs.release` (+ uncomment `signingConfig` in `buildTypes.release`)
- [ ] Build → **Generate Signed Bundle / APK** → Android App Bundle → release → keystore → sign
- [ ] Play Console → Production → Create new release → upload the `.aab`
- [ ] If the build fails with version/plugin errors, let Android Studio auto-apply its "Fix" suggestions — the code is version-tolerant. (Or paste the error back to me and I'll fix it.)

## 7. Test before release
- [ ] Internal testing track: add 3–5 Google accounts, send the link to your phone
- [ ] Install → run the full loop: create trip → say a bill → snap a bill (with an AI key if you have one) → settle → share card → Pro purchase with test card
- [ ] Fix anything, re-upload to the same track (replaces instantly)

## 8. Submit
- [ ] Promote → Production → fill release notes: "Just send the bills. We'll do the math. 🧾"
- [ ] **Submit for review** (1–7 days, usually 1–2)

## 9. After approval — get users (this is where the money comes from)
- [ ] Share the Play link in your real trip group chats — with the share card from a real (finished or fake) trip
- [ ] Product Hunt launch (title: "Billo — just send the bills, we do the math")
- [ ] r/india, r/IndianStreetFood (trip-cost threads), r/travel, college WhatsApp/Telegram trip groups
- [ ] "Trip calculator" / "split bill" keywords are low-competition in Play search — your name+description already target them
- [ ] v2: multi-device sync (Firebase), a WhatsApp bot number, AdMob banners on the free plan — see README

## Legal notes (not legal advice)
- Check the name "Billo" isn't trademarked in India for apps (quick search on the Indian trademark journal; Play asks you to confirm you have rights).
- You're the developer of record: the policy, the billing payouts, and app-store compliance are on you. The data-safety and privacy text provided matches the app's actual behavior — keep it that way.
