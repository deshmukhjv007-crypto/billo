"""Offline end-to-end demo against local fixture sites.

Why this exists: Instagram blocks unauthenticated scripted access from most IPs,
and this sandbox has no route to instagram.com at all — so a tool like this is
otherwise impossible to *verify*. `pp-watchdog demo` runs the real scanner, real
robots gate, real rate limiter, real HTTP fetch, real image comparison, real
notice generator against a local HTTP server that impersonates four mirror sites
with four different outcomes. If the pipeline is right here, it is right out there.

Nothing in this module touches the public internet.
"""

from __future__ import annotations

import json
import shutil
import socket
import struct
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import Config
from .history import History
from .registry import Site
from .report import markdown, summary_lines, write_reports
from .scan import run_scan
from .takedown import build_pack
from .policy import Policy


def make_png(width: int, height: int, pattern: int, sample_base: int = 0) -> bytes:
    """Deterministic in-memory PNG: no Pillow needed to build fixtures.

    sample_base renders the same composition onto a bigger canvas, i.e. a genuine
    upscale of the source - which is what a mirror grabbing your *original* file
    actually gives you. Without it the fixture would be a different photo, and the
    scanner would be right to call it stale.
    """
    rows = bytearray()
    for y in range(height):
        rows += b"\x00"
        for x in range(width):
            sx = x * sample_base // width if sample_base else x
            sy = y * sample_base // height if sample_base else y
            r = ((sx * 7 + sy * 3 + pattern * 40) % 256)
            g = ((sx * 3 + sy * 11 + pattern * 90) % 256)
            b = ((sx + sy + pattern * 30) % 256)
            # a shape so perceptual hashing has something to lock onto
            if (sx // 8 + sy // 8 + pattern) % 4 == 0:
                r = g = b = 235
            rows += bytes((r, g, b))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(rows), 6))
            + chunk(b"IEND", b""))


SITES = [
    # (prefix, site id, name, behaviour)
    ("mollygram", "mollygram", "Mollygram", "current"),
    ("dumpor", "dumpor", "Dumpor", "stale"),
    ("instadp", "instadp", "InstaDP", "hires"),
    ("blocked", "blocked-site", "RobotsBlocked Viewer", "robots"),
    ("gone", "gone-site", "Dead Viewer", "404"),
    ("mirr", "meta-only", "Bio Mirror", "text-only"),
]

PAGE_TMPL = """<html><head><meta property="og:image" content="{root}/media/{img}"></head>
<body><h1>{name} &mdash; anonymous Instagram viewer</h1>
<img src="{root}/media/{img}" alt="profile picture of {username}">
<script>var user = {{"username":"{username}","full_name":"Demo User",
"profile_pic_url":"{root}/media/{img}"}};</script>
<a href="{root}/media/{img}" download>Download full size profile picture</a>
</body></html>"""

TEXT_ONLY_PAGE = """<html><body><h1>{name}</h1>
<div class="profile">username={username} &middot; biography=demo bio &middot; followers=812</div>
<img src="/static/logo.png">
</body></html>"""

ROBOTS = """User-agent: *
Disallow: /blocked/
Allow: /
"""

IMG_FOR = {"current": "current.png", "stale": "stale.png", "hires": "hires_1080x1080.png"}


class Fixture(BaseHTTPRequestHandler):
    """Serves the whole fake mirror estate on one host.

    One host means one robots.txt, so the disallowed site is disallowed by path
    (``/blocked/``), which is exactly how a real host would gate a subtree.
    """

    server_version = "pp-watchdog-demo/1.0"
    root: Path = Path(".")
    robots: str = ROBOTS

    def log_message(self, fmt, *args):  # quiet
        return

    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _root_base(self) -> str:
        return "http://" + (self.headers.get("Host") or "127.0.0.1")

    def do_GET(self):  # noqa: N802
        try:
            self._route()
        except Exception as exc:  # never let a fixture bug look like a real finding
            self._send(500, f"demo fixture error: {exc}".encode())

    def _route(self):
        parts = [q for q in self.path.split("?")[0].split("/") if q]
        if not parts:
            return self._send(200, b"<html><body>pp-watchdog demo fixture server</body></html>")
        if parts[0] == "robots.txt":
            return self._send(200, self.robots.encode(), "text/plain")
        if parts[0] == "media":
            img = self.root / "media" / parts[-1]
            if img.is_file():
                return self._send(200, img.read_bytes(), "image/png")
            return self._send(404, b"no such fixture image")
        if parts[-1] in ("contact", "dmca", "contact-us"):
            body = ("<html><body>abuse@demo-mirror.invalid "
                    "(.invalid per RFC 2606 - this tool sends no mail)</body></html>")
            return self._send(200, body.encode())
        prefix = parts[0]
        site = next((x for x in SITES if x[0] == prefix), None)
        if site is None:
            return self._send(404, b"unknown fixture site")
        _, _sid, name, behaviour = site
        if len(parts) < 3:
            return self._send(404, b"expected /<site>/profile/<username>")
        username = parts[2]
        if behaviour == "404":
            return self._send(404, f"<html><body>User not found: {username}</body></html>".encode())
        if behaviour == "text-only":
            page = TEXT_ONLY_PAGE.replace("{name}", name).replace("{username}", username)
            return self._send(200, page.encode())
        page = PAGE_TMPL.format(root=self._root_base(), img=IMG_FOR[behaviour], name=name,
                                username=username)
        return self._send(200, page.encode())


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def build_fixtures(root: Path, handle: str) -> None:
    media = root / "media"
    media.mkdir(parents=True, exist_ok=True)
    (root / "baseline.png").write_bytes(make_png(320, 320, 1))
    shutil.copyfile(root / "baseline.png", media / "current.png")
    (media / "stale.png").write_bytes(make_png(320, 320, 5))
    # same photograph as the baseline, upscaled: the "they have the original file" case
    (media / "hires_1080x1080.png").write_bytes(make_png(1080, 1080, 1, sample_base=320))


def run_demo(handle: str = "j.v.d.7", workdir: Path | None = None, quiet: bool = False) -> dict:
    root = Path(workdir or (Path.cwd() / "out" / "demo"))
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    build_fixtures(root, handle)

    port = _free_port()
    Fixture.root = root
    server = ThreadingHTTPServer(("127.0.0.1", port), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    cfg = Config(handle=handle, display_name="DEMO (fixture data, not your account)",
                 baseline_image=str(root / "baseline.png"))
    cfg.paths["workdir"] = str(root / "work")
    cfg.contact.update({"name": "Demo Owner", "email": "demo@example.invalid",
                        "address": "1 Demo Street", "phone": "+00-000-0000", "jurisdiction": "IN"})
    cfg.ensure_dirs()

    sites = [
        Site(id=sid, name=f"{name} [demo]", base=f"{base}/{prefix}",
             profile_urls=["/profile/{username}"], contact_paths=["/contact"],
             confirmed=True, risk="high",
             notes="synthetic fixture; behaviour=" + behaviour)
        for prefix, sid, name, behaviour in SITES
    ]
    policy = Policy(min_interval=0.0, max_requests=60, timeout=6.0, respect_robots=True,
                    allow_hosts=[f"127.0.0.1:{port}"])
    try:
        result = run_scan(cfg, sites, policy=policy)
        hist = History(cfg.db_path)
        scan_id = hist.save(result, source="demo")
        diff = hist.diff(scan_id)
        md_path, evidence = write_reports(result, diff, cfg, sites)
        notices = build_pack(result, cfg)
        hist.close()
    finally:
        server.shutdown()
        server.server_close()

    lines = [
        "pp-watchdog DEMO — local fixture mirrors, synthetic data, no network egress",
        "=" * 78,
        *summary_lines(result, diff),
        "",
        f"report:   {md_path}",
        f"evidence: {evidence}",
        f"notices:  {', '.join(str(p.name) for p, _ in notices)}",
    ]
    if not quiet:
        print("\n".join(lines))
    return {
        "score": result.score,
        "counts": result.counts(),
        "verdicts": {f.site_id: f.verdict for f in result.findings},
        "actionable": [f.site_id for f in result.actionable],
        "notices": [str(p) for p, _ in notices],
        "report": str(md_path),
    }


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps(run_demo(), indent=2, default=str))
