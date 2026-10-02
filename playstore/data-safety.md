# Billo — Data Safety Form Answers (Play Console)

Fill the "Data safety" form in Play Console exactly like this. Keep it in sync with the privacy policy.

## 1. "Does your app or you (as developer) collect or share any user data?"

**Use: "Yes"** — since v1.4 (live sync), trips a user *chooses* to share are stored on your Firebase project. Declare the rows below.

### Data collected (live sync — only for trips the user turns sync on for, or joins)

| Data type (Play category) | What exactly | Optional? | Purpose | Ephemeral? |
|---|---|---|---|---|
| **Personal info → Name** | Names the trip lists people under (user-typed, may be nicknames) | Yes — only if sync is turned on | App functionality | No |
| **Financial info → Other financial info** | Bill amounts, descriptions, who paid/owes, settle-up payments, UPI IDs users add | Yes | App functionality | No |
| **App activity → Other user-generated content** | The text typed to add a bill, trip name | Yes | App functionality | No |
| **Device or other IDs** | Firebase Anonymous Auth user ID (random, per install) | Yes | App functionality, security (who may read a trip) | No |

- Is data encrypted in transit? **Yes** (HTTPS / Firestore).
- Can users request deletion? **Yes** — "Leave trip" in-app + email request for server deletion (see privacy policy §3). Put your support email in the form.
- Is any of it *shared* with third parties? **No** — Google Firebase is your service provider (processor), which Play does not count as sharing.
- Photos: still **not** collected — receipt photos never leave the phone, and `firebase/firestore.rules` rejects any bill that carries one.

### Data shared with third parties (declare these two rows)

### Data shared with third parties (declare these two rows)

> **Default behavior (state this in the form's description field if asked):** bill photos are read **on-device** by a bundled OCR engine and are never uploaded anywhere. The disclosure below covers only the *optional* cloud-AI path.

| Data type | Shared with | Purpose | Required? | Can be revoked? |
|---|---|---|---|---|
| **Photos you choose to upload** (bill/receipt images) — *optional cloud AI only* | *The AI provider the user configures* (user-supplied API key, e.g. OpenAI) | To extract expense details (amount, merchant, category) from the bill | No — off by default; on-device OCR is the default and the user must enable cloud AI and provide their own key | Yes — user can turn the feature off in Settings at any time |
| **In-app purchase information** | Google (Play Billing) | To process Billo Pro purchases | Yes, for Pro only | N/A — governed by Google's policy |

> Wording for the free-text "purpose" field (row 1):
> "When the user enables optional AI bill-reading and enters their own API key, bill photos are sent from the user's device directly to the user-configured AI endpoint to extract expense fields. Billo does not receive, store, or process these photos."

## 2. App protections

- **Do you offer protections or processes to help users safeguard their data?**
  → "Shared trips are readable only by phones that joined with the trip code (enforced by Firestore security rules). Users can delete all on-device data in-app (Settings → Erase everything)."
- **Do you let users delete data or account?**
  → "No accounts. On-device data: in-app erase or uninstall. Shared trips: Leave trip in-app, and deletion of the trip on our server on request by email."

## 3. SDKs / libraries disclosure

- Declared SDKs: **Google Play Billing** (in-app products), **Firebase Authentication (anonymous)** and **Cloud Firestore** (live sync).
- Do NOT declare any analytics/ads SDKs — v1 ships without them. If you add AdMob later, update this form before the next release.

## 4. Target audience

- Not specifically directed at children under 13.

## 5. Verification screenshots (Play may ask)

Screenshot of: Settings → AI bill-reading section showing the toggle OFF by default, and the note that photos go only to the user-configured endpoint.
