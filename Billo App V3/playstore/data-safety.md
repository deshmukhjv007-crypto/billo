# Billo — Data Safety Form Answers (Play Console)

Fill the "Data safety" form in Play Console exactly like this. Keep it in sync with the privacy policy.

## 1. "Does your app or you (as developer) collect or share any user data?"

**Use:** "We don't collect or share data" — EXCEPT for the two disclosures below, which you must add under "Data shared with third parties":

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
  → "Users can delete all app data in-app (Settings → Erase everything)."
- **Do you let users delete data or account?**
  → "All data is on-device; users delete it via in-app erase or by uninstalling."

## 3. SDKs / libraries disclosure

- Declared SDKs: **Google Play Billing** (in-app products).
- Do NOT declare any analytics/ads SDKs — v1 ships without them. If you add AdMob later, update this form before the next release.

## 4. Target audience

- Not specifically directed at children under 13.

## 5. Verification screenshots (Play may ask)

Screenshot of: Settings → AI bill-reading section showing the toggle OFF by default, and the note that photos go only to the user-configured endpoint.
