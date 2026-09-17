# README-ANDROID — build the Billo AAB

This project is a **standard Gradle Android app** (no Capacitor, no extra tooling).
It needs one thing from you: **Android Studio on your machine**. Everything else is in the repo.

## 1. Install Android Studio
- https://developer.android.com/studio (Hedgehog or newer)
- Let it install the Android SDK (API 35) + platform tools.

## 2. Open the project
- File → Open → select the `android/` folder.
- Wait for Gradle sync (first sync downloads dependencies, ~2 min).
- If Studio suggests version updates, let it — the code is written against
  AGP 8.7.3 / Kotlin 2.0.21 / billing 7.1.1 / compileSdk 35 (all current as of Sept 2026).

## 3. Create the upload keystore (one time)
In a terminal, inside `android/`:
```bash
keytool -genkeypair -v -keystore billo-upload.keystore -alias billo \
  -keyalg RSA -keysize 2048 -validity 10000
```
- Choose a password, **write it down, and keep the .keystore file forever**
  (you need it to update the app later).
- Fill in `app/build.gradle`:
```groovy
signingConfigs {
    release {
        storeFile file('../billo-upload.keystore')
        storePassword 'YOUR_PASSWORD'
        keyAlias 'billo'
        keyPassword 'YOUR_PASSWORD'
    }
}
```
- And uncomment `signingConfig signingConfigs.release` in `buildTypes.release`.

## 4. Build the AAB
- **Build → Generate Signed Bundle / APK…**
- Select **Android App Bundle (.aab)** → `release` → your keystore → credentials
- Finish → the file lands at `android/app/release/app-release.aab`

> First time, Play may complain "app signing key not set": Play Console takes over
> the release key automatically (App Signing) — accept it in
> Play Console → Setup → App Integrity → App signing.

## 5. Smoke test before uploading (optional but smart)
- Run the `release` build on your phone (plug in, USB debugging) — or install the
  debug build: just press ▶ (Debug).
- Test loop: new trip → say a bill → confirm → settle → share → Pro button.
- Pro button on a build without Play Console products will toast
  *"product isn't set up in Play Console yet"* — that's expected until you create
  `pro_monthly` / `pro_annual` / `pro_lifetime` (checklist step 5). With a linked
  test card + test account, the real flow works from the internal testing track.

## 6. Upload
Play Console → Production → Create new release → choose the AAB →
release notes "Just send the bills. We'll do the math. 🧾" →
save as draft → internal testing track first (checklist step 7) → production.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Gradle sync: "compileSdk 35 not found" | SDK Manager → install "Android 15 (Vanilla Ice Cream)" platform |
| "SDK location not found" | Create `android/local.properties` with `sdk.dir=/path/to/Android/Sdk` (Studio usually does this) |
| Billing compile error on a newer billing version | Pin `com.android.billingclient:billing:7.1.1` in `app/build.gradle` |
| Camera doesn't open on "Snap it" | Works on API 24+; if a phone misbehaves, the gallery path always works |
| Anything else | Paste the error here and I'll fix it |

## What the native layer does (and doesn't)
- **Does:** WebView shell (assets/www), file/camera picker for bill photos, Android
  share sheet (WhatsApp), external links (Play Store, privacy), Play Billing for Pro.
- **Doesn't:** no ads SDK, no analytics, no network calls of its own — the app's only
  network use is the user-configured AI endpoint and Google Play. This matches the
  Data Safety form exactly.
