# Profile picture exposure report — `@j.v.d.7`

- scanned: 2026-09-17 14:05:51
- sites in registry: 6 · probed: 6 · HTTP requests: 13
- exposure score: `85/100`
- baseline image: `/home/user/billo/pp-watchdog/out/demo/baseline.png` · 320x320 px · sha256 `b1e66a55833e1dcf…`

## What this tool cannot tell you

No row below, and no tool that exists, can name a person who opened your profile or your profile picture. Instagram exposes no viewer data to users or to the Graph API, profile-picture views/zooms/screenshots are not logged for you, and the only capture the platform ever reports is a screenshot of a View-Once or Vanish-mode DM. Anything claiming otherwise is fabricating names from your follower list and fishing for your password. Treat such an offer as an attack, not a feature.

## Findings

| verdict | site | image seen | dims | match | evidence |
|---|---|---|---|---|---|
| **SERVING A LARGER COPY THAN INSTAGRAM SHOWS** | InstaDP [demo] | http://127.0.0.1:40665/media/hires_1080x1080.png | 1080x1080 | same-photo | `http://127.0.0.1:40665/instadp/profile/j.v.d.7` |
| **SERVING AN OLD PICTURE OF YOU** | Dumpor [demo] | http://127.0.0.1:40665/media/stale.png | 320x320 | different-photo | `http://127.0.0.1:40665/dumpor/profile/j.v.d.7` |
| **SERVING YOUR CURRENT PICTURE** | Mollygram [demo] | http://127.0.0.1:40665/media/current.png | 320x320 | exact | `http://127.0.0.1:40665/mollygram/profile/j.v.d.7` |
| **PROFILE MIRRORED (image not independently retrieved)** | Bio Mirror [demo] | — | — | — | `http://127.0.0.1:40665/mirr/profile/j.v.d.7` |
| **BLOCKS CRAWLERS — CHECK BY HAND** | RobotsBlocked Viewer [demo] | — | — | — | `http://127.0.0.1:40665/blocked/profile/j.v.d.7` |
| **no cached copy found** | Dead Viewer [demo] | — | — | — | `http://127.0.0.1:40665/gone/profile/j.v.d.7` |

## Takedown targets

### InstaDP [demo]
- page: http://127.0.0.1:40665/instadp/profile/j.v.d.7
- copy: http://127.0.0.1:40665/media/hires_1080x1080.png
- served file sha256: `969e411a5b032560acaa77be20dfe8a770f65f41d439caddfd8657038bc2bb53`
- why it matters: dHash distance 0/64: the same photograph, re-encoded, served at 1080x1080 vs your 320x320
- abuse addresses harvested this run: <abuse@demo-mirror.invalid>
- scanner note: found via 'profile_pic_url'
- captured markup: `<script>var user = {"username":"j.v.d.7","full_name":"Demo User", "profile_pic_url":"http://127.0.0.1:40665/media/hires_1080x1080.png"};</script> <a href="http://127.0.0.1:40665/media/hires_1080x1080.png" d`

### Dumpor [demo]
- page: http://127.0.0.1:40665/dumpor/profile/j.v.d.7
- copy: http://127.0.0.1:40665/media/stale.png
- served file sha256: `dd165632efcc38fadeabd0daf69101478a17297809f9671c3504aa443ad75b62`
- why it matters: dHash distance 42/64: a different photograph — this is an older picture of you
- abuse addresses harvested this run: <abuse@demo-mirror.invalid>
- scanner note: found via 'profile_pic_url'
- captured markup: `<script>var user = {"username":"j.v.d.7","full_name":"Demo User", "profile_pic_url":"http://127.0.0.1:40665/media/stale.png"};</script> <a href="http://127.0.0.1:40665/media/stale.png" download>Download ful`

### Mollygram [demo]
- page: http://127.0.0.1:40665/mollygram/profile/j.v.d.7
- copy: http://127.0.0.1:40665/media/current.png
- served file sha256: `b1e66a55833e1dcf5b9b4d527ca89da816cb3e2fe4c98c0f4c076366fa8891b9`
- why it matters: byte-identical copy of the file you uploaded
- abuse addresses harvested this run: <abuse@demo-mirror.invalid>
- scanner note: found via 'profile_pic_url'
- captured markup: `<script>var user = {"username":"j.v.d.7","full_name":"Demo User", "profile_pic_url":"http://127.0.0.1:40665/media/current.png"};</script> <a href="http://127.0.0.1:40665/media/current.png" download>Download`

### Bio Mirror [demo]
- page: http://127.0.0.1:40665/mirr/profile/j.v.d.7
- abuse addresses harvested this run: <abuse@demo-mirror.invalid>
- scanner note: page served your profile, but no image URL was extractable from the markup - verify in a browser before asserting it in a notice
- captured markup: `<html><body><h1>Bio Mirror</h1>
<div class="profile">username=j.v.d.7 &middot; biography=demo bio &middot; followers=812</div>
<img src="/static/logo.png">
</body></html>`

Generate the notices with `pp-watchdog takedown` (writes to `/home/user/billo/pp-watchdog/out/demo/work/notices`).

## Registry coverage warning
0 of 6 registry entries carry unverified domains or conflicting 2026 status reports (none). A `not-indexed` verdict on one of those means 'the page we guessed did not show your image', not 'nobody has your image'. These services re-brand every few months; run `pp-watchdog registry list` and prune.

## Manual searches (this tool will not script these for you)
- [Google Images — your handle + profile photo](https://www.google.com/search?tbm=isch&q=%22j.v.d.7%22+instagram+profile+photo)
- [Google — mirror sites indexing you](https://www.google.com/search?q=%22j.v.d.7%22+instagram+(viewer+OR+download+OR+stories))
- [Bing Images](https://www.bing.com/images/search?q=instagram+profile+j.v.d.7)
- [reverse image search (upload your own file to verify your face is not elsewhere)](https://lens.google.com/uploadbyurl)
- [Yandex Images — strongest face matching of the free engines](https://yandex.com/images/)
- [Instagram: manage authorised apps](https://www.instagram.com/accounts/manage_access/)
- [Instagram: report IP infringement](https://help.instagram.com/contact/278619070935757)
- [Instagram: report a counterfeit account](https://help.instagram.com/contact/636276399721841)
- [India cyber-crime portal](https://cybercrime.gov.in)
- [Domain abuse lookup for whichever site you complain to](https://lookup.icann.org/)

---
evidence dir: `/home/user/billo/pp-watchdog/out/demo/work/evidence` · history: `/home/user/billo/pp-watchdog/out/demo/work/history.sqlite3` · everything local; no Instagram credentials used or needed
