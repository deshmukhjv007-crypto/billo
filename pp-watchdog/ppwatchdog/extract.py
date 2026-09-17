"""Pull profile-picture URLs and mirror evidence out of arbitrary HTML/JSON.

Mirror sites churn constantly -- brands die, 301 to new domains, change their
markup every few weeks. So rather than brittle per-site DOM selectors, we scan
the fetched page for anything that *looks like* a profile image and let the
caller decide. A generic extractor keeps the tool useful after the site redesigns.
"""

from __future__ import annotations

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
    r"""(user\s*(?:not\s*found|does\s*not\s*exist)|profile\s*not\s*found|"""
    r"""couldn'?t\s*find\s*(?:this|the)\s*(?:user|profile)|no\s+such\s+user|"""
    r"""isn'?t\s+available|404\s*[-–:]\s*not\s*found|page\s+not\s+found)""",
    re.IGNORECASE,
)
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
    if status and status >= 500:
        return "error"
    if page:
        return "served"
    return "empty"
