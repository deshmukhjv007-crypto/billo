"""Minimal, boring HTTP client: GET only, size-capped, no cookies, no JS.

Nothing here logs you in anywhere, sends no body, and stores nothing about you.
That is on purpose -- the whole point of this tool is that it needs no
Instagram credentials of any kind. If a service requires a login to show your
own picture mirrored, this tool cannot and will not help you look.
"""

from __future__ import annotations

import gzip
import ssl
import time
import zlib
from dataclasses import dataclass, field
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import BaseHandler, Request, build_opener, HTTPSHandler


@dataclass
class Response:
    url: str
    status: int = 0
    body: bytes = field(default=b"", repr=False)
    headers: dict[str, str] = field(default_factory=dict)
    error: str = ""
    truncated: bool = False
    elapsed_ms: int = 0

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and not self.error

    @property
    def redirected(self) -> bool:
        return self.status in (301, 302, 303, 307, 308)

    @property
    def location(self) -> str:
        return self.headers.get("location", "")

    @property
    def not_found(self) -> bool:
        return self.status in (404, 410)

    @property
    def blocked(self) -> bool:
        return self.status in (401, 403, 429, 451, 503)

    def text(self, limit: int = 400_000) -> str:
        return self.body[:limit].decode("utf-8", "replace")


class _StopRedirect(BaseHandler):
    """Surface redirects as evidence instead of silently following them."""

    def http_error_301(self, req, fp, code, msg, headers):  # noqa: D102
        return self._stop(req, fp, code, msg, headers)

    http_error_302 = http_error_303 = http_error_307 = http_error_308 = http_error_301

    @staticmethod
    def _stop(req, fp, code, msg, headers):
        if fp:
            fp.close()
        raise HTTPError(req.full_url, code, msg, headers, None)


def fetch(
    url: str,
    *,
    ua: str,
    timeout: float = 12.0,
    max_bytes: int = 1_500_000,
    insecure: bool = False,
) -> Response:
    started = time.monotonic()
    parts = urlparse(url)
    scheme = parts.scheme or "https"
    # A handle with spaces or unicode would otherwise raise; quote defensively.
    url = parts._replace(scheme=scheme, path=quote(parts.path, safe="/%")).geturl()
    req = Request(
        url,
        headers={
            "User-Agent": ua,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        },
    )
    ctx = ssl.create_default_context()
    if insecure:  # localhost demo fixtures only
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    opener = build_opener(_StopRedirect(), HTTPSHandler(context=ctx))
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read(max_bytes)
            truncated = resp.read(1) != b""
            headers = {k.lower(): str(v) for k, v in resp.headers.items()}
            status = resp.getcode() or 0
    except HTTPError as exc:
        body = b""
        try:
            if exc.fp:
                body = exc.fp.read(8192)
        except Exception:
            body = b""
        headers = {k.lower(): str(v) for k, v in (exc.headers.items() if exc.headers else [])}
        return Response(
            url=url, status=exc.code, body=body, headers=headers, error=f"HTTP {exc.code}",
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )
    except (URLError, OSError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        return Response(
            url=url, status=0, error=f"{type(exc).__name__}: {reason}",
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )
    body = _maybe_decompress(raw, headers.get("content-encoding", ""))
    return Response(
        url=url, status=status, body=body, headers=headers, truncated=truncated,
        elapsed_ms=int((time.monotonic() - started) * 1000),
    )


def _maybe_decompress(data: bytes, encoding: str) -> bytes:
    if not data:
        return data
    try:
        if "gzip" in encoding:
            return gzip.decompress(data)
        if "deflate" in encoding:
            return zlib.decompress(data)
    except Exception:
        return data
    return data
