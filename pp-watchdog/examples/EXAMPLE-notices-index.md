# Takedown pack — `@j.v.d.7`

Generated 2026-09-17 14:05 · 4 site(s) with actionable evidence.
Primary route for your configured jurisdiction (IN): **Information Technology Act, 2000 § 79(2)(b) read with the IT Rules, 2021 Rule 3(2)(b) — intermediary takedown notice**.

## InstaDP [demo]
- verdict: `serving-hires` · page `http://127.0.0.1:40665/instadp/profile/j.v.d.7`
- copy: `http://127.0.0.1:40665/media/hires_1080x1080.png`
- served resolution: 1080x1080 px · dHash distance 0/64: the same photograph, re-encoded, served at 1080x1080 vs your 320x320
- abuse addresses harvested this run: `abuse@demo-mirror.invalid`
- files: `instadp--it_act.txt`, `instadp--dmca.txt`

## Dumpor [demo]
- verdict: `serving-stale` · page `http://127.0.0.1:40665/dumpor/profile/j.v.d.7`
- copy: `http://127.0.0.1:40665/media/stale.png`
- served resolution: 320x320 px · dHash distance 42/64: a different photograph — this is an older picture of you
- abuse addresses harvested this run: `abuse@demo-mirror.invalid`
- files: `dumpor--it_act.txt`, `dumpor--dmca.txt`

## Mollygram [demo]
- verdict: `serving-current` · page `http://127.0.0.1:40665/mollygram/profile/j.v.d.7`
- copy: `http://127.0.0.1:40665/media/current.png`
- served resolution: 320x320 px · byte-identical copy of the file you uploaded
- abuse addresses harvested this run: `abuse@demo-mirror.invalid`
- files: `mollygram--it_act.txt`, `mollygram--dmca.txt`

## Bio Mirror [demo]
- verdict: `profile-mirrored` · page `http://127.0.0.1:40665/mirr/profile/j.v.d.7`
- abuse addresses harvested this run: `abuse@demo-mirror.invalid`
  ⚠️ image not independently retrieved — verify in a browser before sending
- files: `meta-only--it_act.txt`, `meta-only--dmca.txt`


## Instagram-side reports

Instagram's own channels are the only route that can reduce what the platform serves to
logged-out visitors, which is what the mirrors are feeding on in the first place.

Report intellectual property (your photograph):
https://help.instagram.com/contact/278619070935757 Report a counterfeit or impersonating
account: https://help.instagram.com/contact/636276399721841 Privacy concern about your
own data: https://help.instagram.com/contact/634636280114108 Revoke any third-party app
that already has account access: https://www.instagram.com/accounts/manage_access/

Suggested wording:

"A third-party service, InstaDP [demo] (http://127.0.0.1:40665/instadp/profile/j.v.d.7),
reproduces my Instagram profile photograph and my handle without my licence, and offers
it for anonymous viewing and download. I am the author and the subject of the
photograph. I request that Instagram (a) treat this as unauthorised reproduction of my
image under its Terms, and (b) confirm whether high-resolution variants of my profile
picture are being served to unauthenticated requests for my handle while this is under
review."

Attach the file you originally uploaded, its SHA-256
(969e411a5b032560acaa77be20dfe8a770f65f41d439caddfd8657038bc2bb53), and a dated
screenshot of InstaDP [demo]'s page showing your image.

Expectation-setting, because it matters: Instagram can act against the service and can
restrict what logged-out visitors see. It will not tell you who viewed your profile, and
no appeal, form, or purchased tool changes that. Any promise otherwise is a credential-
phishing attempt.

---

## Filing order that actually works

1. **Screenshot before you write.** Capture each page with URL bar and date visible. Some
   mirrors swap their cache the moment a complaint is in the air, and a notice you cannot
   evidence is a notice they will ignore.
2. **Send to the abuse address, and CC the registrar.** Look the domain up at
   https://lookup.icann.org/ and copy the registrar's abuse contact. For unbranded viewer
   sites, registrar pressure moves faster than their inbox.
3. **One site per email, one URL per notice.** `§512(c)(3)` and IT Rule 3(2)(b) both require
   specific identification; a bulk "delete everything of mine" letter is rejected as vague.
4. **Log the send:** `pp-watchdog notice-sent <site_id> <kind>`. The +14 day follow-up is
   what actually gets these actioned — first notices from individuals are routinely shelved.
5. **Then change your profile picture.** Their copy becomes the stale one, every downstream
   reuse starts pointing at a photo of you that no longer exists, and it is the fastest lever
   you have while the paperwork works.
6. **Keep receipts.** `.pp-watchdog/` is the whole record; do not delete it until a matter is
   closed, and back it up somewhere that is not the same cloud as your Instagram login.
