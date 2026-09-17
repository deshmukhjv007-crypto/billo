"""Pull profile-picture URLs and mirror evidence out of arbitrary HTML/JSON.

Mirror sites churn constantly -- brands die, 301 to new domains, change their
markup every few weeks. So rather than brittle per-site DOM selectors, we scan
the fetched page for anything that *looks like* a profile image and let the
caller decide. A generic extractor keeps the tool useful after the site redesigns.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass

_IMG_EXT = r"(?:jpe?g|png|webp|gif)"

_CDN_URL = re.compile(
    r"""https?://[^\s"'<>\\)]+?""" + r"(?:" + _IMG_EXT + r")" + r"""(?:\?[^\s"'<>\\)]*)?""",
    re.IGNORECASE,
)
_PROFILE_PIC_KEY = re.compile(
    r"""["']?(profile_?pic(?:_url)?|imageurl|img_url|avatar(?:_url)?|pic_?url)["']?"""
    r"""\s*[:=]\s*["']([^"']+)["']""",
    re.IGNORECASE,
)
_META_OG = re.compile(
    r"""<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']""",
    re.IGNORECASE,
)
_NOT_FOUND = re.compile(
    r"""(?:user|profile|page|account|record|result)\s+(?:was\s+)?not\s+found"""
    r"""|\bnot\s+found\b"""
    r"""|error\s*404|404\s*(?:error|not\s*found)"""
    r"""|user\s+does\s+not\s+exist"""
    r"""|couldn'?t\s+find\s+(?:this|the)\s*(?:user|profile)"""
    r"""|no\s+such\s+user|no\s+results?\s+(?:found|available)"""
    r"""|isn'?t\s+available""",
    re.IGNORECASE,
)
# 2026 reality: several mirrors answer HTTP 200 with a "Not Found" body, so the page
# text is authoritative and the status code is not. Short apologies ("We are sorry")
# are treated as not-found only on small pages, where there is no content to misread.
_APOLOGY = re.compile(r"\bwe\s+are\s+sorry\b|\bsorry,?\s+nothing\s+found\b", re.IGNORECASE)

_LOGIN_WALL = re.compile(
    r"""(log\s*in\s+to\s+(?:continue|view)|sign\s*in\s+(?:required|to\s+view)|"""
    r"""enter\s+your\s+instagram\s+password|unlock\s+with\s+an\s+account)""",
    re.IGNORECASE,
)
_IG_HOSTS = re.compile(r"(cdninstagram\.com|instagram\.com|fbcdn\.net|scontent[.\w-]*\.instagram)", re.I)
_SIZE_SUFFIX = re.compile(r"_(\d{2,4})x(\d{2,4})|/(\d{3,4})/|(\d{3,4})x(\d{3,4})", re.I)


@dataclass
class ImageCandidate:
    url: str
    how: str            # which rule found it
    ig_cdn: bool        # looks like it came straight off Instagram's CDN
    claimed_size: tuple[int, int] | None = None
    context: str = ""   # a short snippet around the hit, for the evidence file

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "how": self.how,
            "ig_cdn": self.ig_cdn,
            "claimed_size": list(self.claimed_size) if self.claimed_size else None,
            "context": self.context,
        }


def _unescape(value: str) -> str:
    return (
        value.replace("\\/", "/")
        .replace("\\u0026", "&")
        .replace("\\u002F", "/")
        .replace("&amp;", "&")
    )


def claimed_dimensions(url: str) -> tuple[int, int] | None:
    m = _SIZE_SUFFIX.search(url)
    if not m:
        return None
    if m.group(1) and m.group(2):
        return int(m.group(1)), int(m.group(2))
    if m.group(3):
        n = int(m.group(3))
        return n, n
    if m.group(4) and m.group(5):
        return int(m.group(4)), int(m.group(5))
    return None


def extract_images(page: str, *, limit: int = 12) -> list[ImageCandidate]:
    """Ordered, de-duplicated image candidates, best evidence first."""
    seen: dict[str, ImageCandidate] = {}

    def add(url: str, how: str, start: int = 0) -> None:
        url = _unescape(url.strip())
        if not url.lower().startswith(("http://", "https://")):
            return
        # Skip obvious UI furniture so the report is readable.
        low = url.lower()
        if any(s in low for s in ("logo", "favicon", "icon-", "/ads/", "sprite", "placeholder", ".svg")):
            return
        if url in seen:
            return
        # anchor the snippet to a tag/line boundary so evidence reads as markup, not mid-word
        left = page.rfind("<", 0, start)
        left = left if left != -1 and left > start - 160 else max(0, start - 60)
        ctx = re.sub(r"\s+", " ", page[left : start + 140]).strip()
        seen[url] = ImageCandidate(
            url=url, how=how, ig_cdn=bool(_IG_HOSTS.search(url)),
            claimed_size=claimed_dimensions(url), context=ctx[:220],
        )

    for m in _PROFILE_PIC_KEY.finditer(page):
        add(m.group(2), m.group(1), m.start())
    for m in _META_OG.finditer(page):
        add(m.group(1), "og:image", m.start())
    for m in _CDN_URL.finditer(page):
        add(m.group(0), "url-pattern", m.start())

    ranked = sorted(
        seen.values(),
        key=lambda c: (not c.ig_cdn, c.how != "profile_pic_url", c.how != "og:image"),
    )
    return ranked[:limit]


def json_blob(page: str) -> dict | None:
    """Some mirrors answer JSON on the same URL; try to parse it."""
    stripped = page.strip()
    if not stripped.startswith(("{", "[")):
        return None
    try:
        obj = json.loads(stripped)
    except Exception:
        return None
    return obj if isinstance(obj, dict) else {"_list": obj}


def page_state(page: str, status: int, error: str = "", location: str = "") -> str:
    """Classify what the mirror actually said about this profile."""
    if error and not status:
        return "unreachable"
    if status in (404, 410):
        return "not-indexed"
    if status in (301, 302, 303, 307, 308) and location:
        return "moved"
    if status in (401, 403, 429, 451, 503):
        return "refused"
    if _LOGIN_WALL.search(page):
        return "login-wall"
    if _NOT_FOUND.search(page):
        return "not-indexed"
    if len(page) < 4000 and _APOLOGY.search(page):
        return "not-indexed"
    if status and status >= 500:
        return "error"
    if page:
        return "served"
    return "empty"


# --------------------------------------------------------------------------- #
# Mirror-side claims, Instagram's own asset labels, and handle attribution
# --------------------------------------------------------------------------- #
_HD_CLAIM_PATTERNS = (
    r"full[\s-]?size\s+(?:hd\s+)?(?:instagram\s+)?profile\s+picture",
    r"download[^\n]{0,40}profile\s+picture[^\n]{0,30}(?:hd|full\s+size|original|highest)",
    r"(?:hd|full[\s-]size)\s+profile\s+(?:picture|pic|dp)",
    r"\bhd\s+(?:profile|dp|picture)\b",
    r"download\s+(?:hd\s+picture|all\s+media)",
    r"original\s+image\s+file[^\n]{0,60}(?:servers|highest)",
    r"highest\s+available\s+resolution",
    r"zoom[\s-]in[^\n]{0,40}(?:hd|full\s+size|picture|image)",
    r"profile\s+picture[^\n]{0,40}even\s+for\s+private\s+accounts",
    r"(?:never|no)[^\n]{0,30}notification[^\n]{0,60}(?:view|visit|download)",
)
_HD_CLAIMS_RE = re.compile("(" + "|".join(_HD_CLAIM_PATTERNS) + ")", re.IGNORECASE)
_VARIANT_RE = re.compile(r"dst-\w+_s(\d{2,4})x(\d{2,4})", re.I)
_EFG_RE = re.compile(r"(?:[?&]|%3F|26)(?:_nc_)?efg=([A-Za-z0-9_%+\-]+)")
_ASSET_TOKEN = re.compile(r"(profile_pic[\w.]*?)\.(\d{3,4})(?:\.(\w{1,4}))?", re.I)

_QUOTES = {"display": "displayed at", "vencode_tag": "source asset tag",
           "source_asset": "source asset", "source_px": "source pixels"}


def hd_claims(page: str, *, limit: int = 4) -> list[str]:
    """Sentences where a mirror advertises what it can do with a profile picture.

    These are the operator's own words, quoted into the takedown notice: they turn
    "I think you are hosting my photo" into "your own page says you serve the
    full-resolution original, including for private accounts, and that the owner
    never hears about it".
    """
    text = re.sub(r"<[^>]+>", " ", page)
    # markdown links -> anchor text, so "[HD Profile](https://…)" reads as a claim
    # about HD profiles instead of a URL blob with the word in it
    text = re.sub(r"\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]", r"\1", text)
    text = re.sub(r"\s+", " ", _unescape(text))
    out: list[str] = []
    for m in _HD_CLAIMS_RE.finditer(text):
        floor = max(0, m.start() - 120)
        ceil = min(len(text), m.end() + 140)
        s = text.rfind(". ", 0, m.start())
        start = floor if s < floor else s + 2
        e = text.find(". ", m.end())
        end = ceil if e == -1 or e > ceil else e + 1
        quote = text[start:end]
        quote = re.sub(r"[!*`\[\]<>|]+", " ", quote.replace("#", " "))
        quote = " ".join(quote.split()).strip(" -.\u00b7")
        if "http" in quote.lower() or quote.count("%") > 3:
            continue  # URL debris, not a sentence
        if len(quote.split()) < 4 or len(quote) < 24:
            continue  # a label, not a sentence
        if len(quote) > 16 and not any(quote in x for x in out):
            out.append(quote[:320])
        if len(out) >= limit:
            break
    return out


_WRAPPABLE = re.compile(r"[?&]([a-z_]{1,6})=([A-Za-z0-9_%+/\-]{24,})")


def _b64_to_text(token: str) -> str:
    for cand in {token, token.replace("%3D", "=").rstrip("=")}:
        pad = cand + "=" * (-len(cand) % 4)
        try:
            raw = base64.urlsafe_b64decode(pad)
        except Exception:
            continue
        if raw[:4] == b"http":
            try:
                return raw.decode("utf-8", "ignore")
            except Exception:
                return ""
    return ""


def instagram_asset_hints(url: str, *, _depth: int = 0) -> dict:
    """Decode Instagram's own CDN parameters that the mirror leaked into the URL.

    ``stp=dst-jpg_s150x150`` is the thumbnail Instagram displays. The base64
    ``efg`` parameter carries a ``vencode_tag`` naming the *source* asset, e.g.
    ``profile_pic.www.1080.C3`` - a 1080px original that this service can reach.
    The gap between display size and source asset is the most useful sentence in
    any complaint about a profile picture, because it is Instagram's own metadata
    rather than our inference.
    """
    hints: dict = {}
    url = _unescape(url)
    disp = _VARIANT_RE.search(url)
    if disp:
        hints["display"] = disp.group(1) + "x" + disp.group(2)
    for m in _EFG_RE.finditer(url):
        token = m.group(1)
        for candidate in {token, token.replace("%3D", "=").rstrip("=")}:
            pad = candidate + "=" * (-len(candidate) % 4)
            try:
                decoded = json.loads(base64.urlsafe_b64decode(pad))
            except Exception:
                continue
            tag = ""
            if isinstance(decoded, dict):
                tag = str(decoded.get("vencode_tag") or decoded.get("vendor_tag") or "")
            if tag:
                hints["vencode_tag"] = tag
                asset = _ASSET_TOKEN.search(tag)
                if asset:
                    hints["source_asset"] = asset.group(0)
                    hints["source_px"] = int(asset.group(2))
            break
        if "vencode_tag" in hints:
            break
    # Many proxies do not rewrite the source URL, they base64-wrap it and fetch it
    # lazily. Decoding it back proves their "copy" is literally your Instagram asset,
    # which is a far better thing to put in a complaint than an inference.
    if _depth < 1:
        for m in _WRAPPABLE.finditer(url):
            inner = _b64_to_text(m.group(2))
            if inner.startswith("http") and ("instagram" in inner or "cdninsta" in inner):
                hints["wrapped_source_url"] = inner.split("?")[0][:160]
                hints["wrapped_via"] = m.group(1)
                deeper = instagram_asset_hints(inner, _depth=_depth + 1)
                for k, v in deeper.items():
                    hints.setdefault(k, v)
                break
    return hints


def mentions_handle(page: str, handle: str) -> bool:
    """Is this handle actually named in the rendered content, not just in our notes?

    Captures carry provenance comments that repeat the source URL, and the URL
    contains the handle. If that counted, an empty search shell would be reported
    as a confirmed mirror of someone's profile - so comments and script blobs are
    stripped before matching.
    """
    if not handle:
        return False
    body = re.sub(r"<!--.*?-->", " ", page[:200_000], flags=re.S)
    body = re.sub(r"<script[^>]*>.*?</script>", " ", body, flags=re.S | re.I)
    if handle in body:
        return True
    return ("@" + handle) in body or ("%40" + handle) in body.lower()
