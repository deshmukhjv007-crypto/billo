# Live sync — setup (about 15 minutes, free)

Live sync lets everyone in a trip add bills from their own phone and see the same balances.
It runs on **your own Firebase project** (Google). Until you paste a config into
`app/sync/config.js`, the app behaves exactly as before: fully offline, sync hidden.

## How it works (so you know what you're turning on)

- **No accounts.** Each install signs in with Firebase *Anonymous Auth* — a random ID, no name,
  email or phone number. It survives app restarts; it's lost if the app is uninstalled.
- **Per trip, opt-in.** A trip is only uploaded when someone taps **Turn on live sync** on it
  (or joins one with a code). Other trips never leave the phone.
- **Join codes.** Syncing a trip gives it a code like `GOA-7K2Q-X9MB` (8 random characters,
  ~850 billion combinations). Anyone with the code can join — it's the invitation.
- **Offline first.** Every phone keeps its full copy. Bills added offline are queued and sent
  when the phone is back online; the header shows `LIVE`, `SAVING` or `OFFLINE · SAVED HERE`.
- **Merging.** Each bill and payment is its own document. Two people editing different bills
  at the same time both win; editing the *same* bill at the same time, the last save wins.
  Deletes sync too.
- **Never uploaded:** receipt photos, the AI key, settings, or trips that aren't shared.
  `firebase/firestore.rules` rejects any bill that carries a photo.

Data layout in Firestore:

```
codes/{GOA-7K2Q-X9MB}            → { tripId }                 (lookup only — can't be listed)
trips/{tripId}                   → name, emoji, currency, budget, members{…}, uids[…]
trips/{tripId}/expenses/{id}     → one bill      (deleted: true = removed)
trips/{tripId}/payments/{id}     → one settle-up payment
```

Only phones whose anonymous ID is in `trips/{tripId}.uids` can read or write that trip.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> → **Add project** → name it e.g. `billo-app`.
   Google Analytics: **off** (the app doesn't use it, and it would change your data-safety answers).
2. The free **Spark** plan is enough to start: 50,000 reads / 20,000 writes per day and 1 GB of
   storage. A trip with 4 people and 60 bills is roughly 1,000 reads over its lifetime.

## 2. Turn on Anonymous sign-in

**Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**

## 3. Create the database

**Build → Firestore Database → Create database** →
- Location: **asia-south1 (Mumbai)** — closest to your users, and it can't be changed later.
- Start in **production mode** (the rules in step 5 replace the default "deny everything").

## 4. Register the web app and paste its config

1. **Project settings (⚙) → General → Your apps → Web (`</>`)** → nickname `billo-web` →
   *don't* tick Firebase Hosting → **Register app**.
2. Copy the `firebaseConfig = { … }` object it shows.
3. Open `app/sync/config.js` and replace `window.BILLO_FIREBASE_CONFIG = null;` with:

   ```js
   window.BILLO_FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "billo-app.firebaseapp.com",
     projectId: "billo-app",
     storageBucket: "billo-app.firebasestorage.app",
     messagingSenderId: "…",
     appId: "1:…:web:…"
   };
   ```
   These values identify your project; they are not secrets. Security comes from the rules.
4. Copy the web app into the Android shell: `python3 scripts/copy_web_to_android.py`
5. Bump the version so installed PWAs pick up the new config: `python3 scripts/bump_version.py 1.4.1`

## 5. Deploy the security rules

You need Node.js 20+ on your computer.

```bash
cd "Billo App V3/firebase"
npm install
npx firebase login
npx firebase use --add          # pick billo-app, alias "default"
npm run deploy                  # uploads firestore.rules
```

Optional but recommended — run the rules tests first (needs Java 11+; it starts a local emulator):

```bash
npm test
```

## 6. Lock the API key to your app (5 minutes, do it before launch)

Google Cloud console → **APIs & Services → Credentials** → the key named *Browser key (auto created
by Firebase)* → **Application restrictions: Websites** → add:

- `https://appassets.androidplatform.net/*` (the Android app loads from this address)
- your web domain if you host the PWA, e.g. `https://billo.app/*`

**API restrictions:** restrict to *Identity Toolkit API*, *Token Service API* and *Cloud Firestore API*.

Later, when you have users: add **Firebase App Check** (Play Integrity) to stop scripted abuse of
the join-code lookup.

## 7. Try it

1. Build and install on two phones (or one phone + the PWA in Chrome).
2. Phone A: create a trip with a friend's name → **Turn on live sync** → share the invite.
3. Phone B: **Join a trip** → type the code → pick your name.
4. Add a bill on either phone; it appears on the other in about a second. Put one phone in
   airplane mode, add a bill, turn it off again — it syncs.

## Local development without a Firebase project

- `node test/sync_test.js` — 3-phone sync, offline queues, 25-seed convergence fuzz (no network).
- `node test/sync_e2e.js` — two real browsers syncing through a fake Firestore
  (`test/fake-sync-server.js`); needs Playwright.
- Against the Firebase emulators: add `emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] }`
  to the config object and run `npx firebase emulators:start --only auth,firestore` in `firebase/`.

## Updating the Firebase SDK

The SDK is bundled into `app/sync/firebase.js` (loaded only when sync is used, cached for offline).
To update: `cd firebase && npm install firebase@latest && npm run build`, then copy to Android.
Keep `app/sync/firebase.js.LEGAL.txt` — it carries the SDK's licence notices.

## Deleting a shared trip (data requests)

The rules don't let the app hard-delete trips. When someone emails a deletion request with a trip
code: Firestore console → `codes/{CODE}` → note `tripId` → delete `trips/{tripId}` (with its
`expenses` and `payments` subcollections) and the `codes/{CODE}` doc.
