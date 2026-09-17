"""End-to-end + unit tests. No network, no Instagram, no fixtures on disk needed."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


from ppwatchdog import extract, imaging, scrub  # noqa: E402
from ppwatchdog.config import Config, validate_handle  # noqa: E402
from ppwatchdog.demo import SITES, build_fixtures, make_png  # noqa: E402
from ppwatchdog.history import History  # noqa: E402
from ppwatchdog.policy import Policy  # noqa: E402
from ppwatchdog.registry import Site  # noqa: E402
from ppwatchdog.scan import run_scan  # noqa: E402
from ppwatchdog.takedown import notice_text  # noqa: E402


# --------------------------------------------------------------------------- #
def test_handle_validation():
    assert validate_handle("j.v.d.7")[0], validate_handle("j.v.d.7")[1]
    for bad in ("@j.v.d.7", "", "has space", ".lead", "trail.", "double..period", "x" * 40):
        assert not validate_handle(bad)[0], bad
    ok, why = validate_handle("valid_name.1")
    assert ok, why


def test_png_writer_and_size_roundtrip():
    data = make_png(64, 32, 3)
    assert imaging.image_size(data) == (64, 32)
    fp = imaging.fingerprint(data)
    assert fp.has_image and len(fp.sha256) == 64
    assert not fp.error


def test_match_verdict_kinds():
    a = make_png(320, 320, 1)
    b = make_png(320, 320, 9)          # different photo, same size
    c = make_png(1080, 1080, 1, sample_base=320)  # the same photo, upscaled
    fa, fb, fc = (imaging.fingerprint(x) for x in (a, b, c))
    assert imaging.compare(fa, fa).kind == "exact"
    assert imaging.compare(fa, fc).bigger is True
    assert imaging.compare(fa, fb).bigger is False
    # no baseline -> must refuse to judge, never invent a match
    cmp = imaging.compare(None, fb)
    assert cmp.kind == "unidentifiable" and not cmp.confirmed
    assert "baseline" in cmp.detail
    if imaging.HAVE_PIL:
        assert imaging.compare(fa, fb).kind == "different-photo"
        assert imaging.compare(fa, fc).kind == "same-photo"
    else:
        assert imaging.compare(fa, fb).kind == "unidentifiable"


def test_extractors():
    page = """<html><head>
    <meta property="og:image" content="https://cdninst.example/x/a_320x320.jpg?e=1">
    </head><body><script>var u = {"username":"j.v.d.7",
    "profile_pic_url":"https:\\/\\/cdninstagram.com\\/p\\/b.jpg\\u0026tk=1"};</script>
    <img src="https://cdninst.example/x/c.png"><img src="/static/logo.png"></body></html>"""
    cands = extract.extract_images(page)
    urls = [c.url for c in cands]
    assert "https://cdninstagram.com/p/b.jpg&tk=1" in urls, urls
    assert cands[0].how == "profile_pic_url"
    assert not any("logo" in u for u in urls)
    assert extract.claimed_dimensions("https://x/y_320x320.jpg") == (320, 320)


def test_page_state():
    assert extract.page_state("<html>User not found</html>", 200) == "not-indexed"
    assert extract.page_state("", 404) == "not-indexed"
    assert extract.page_state("<b>Log in to continue</b>", 200) == "login-wall"
    assert extract.page_state("x", 451) == "refused"
    assert extract.page_state("x", 0, "URLError: refused") == "unreachable"
    assert extract.page_state("<p>hello</p>", 200) == "served"


def test_rate_limiter_blocks_second_hit_same_host():
    p = Policy(min_interval=30, max_requests=10, respect_robots=False)
    p.note("https://a.test/profile/x", 200)
    ok, why = p.gate("https://a.test/profile/y")
    assert not ok and "rate limit" in why
    assert p.gate("https://b.test/profile/y")[0]


def test_request_budget_is_hard():
    p = Policy(min_interval=0, max_requests=1, respect_robots=False)
    p.note("https://a.test/1", 200)
    ok, why = p.gate("https://b.test/2")
    assert not ok and "budget" in why


def test_consent_guard_refuses_other_peoples_handles():
    p = Policy()
    ok, why = p.check_handle("somebody.else", "j.v.d.7", acknowledged=False)
    assert not ok and "not the handle this install belongs to" in why
    assert p.check_handle("j.v.d.7", "j.v.d.7", False)[0]
    assert p.check_handle("somebody.else", "j.v.d.7", True)[0]


def test_robots_disallow_gates_without_fetching():
    # 127.0.0.1 is unreachable here in a way that is deterministic: nothing
    # listens, so robots preflight fails and we must degrade to "allow" rather
    # than to inventing a blocked verdict.
    p = Policy(min_interval=0, max_requests=5, respect_robots=True, timeout=0.2,
               allow_hosts=["127.0.0.1:9"])
    allowed, why = p.gate("http://127.0.0.1:9/x")
    assert allowed, why
    assert p.requests_used == 1  # the robots preflight was counted honestly


def test_scrub_strips_png_text_chunks(tmp_path):
    import struct
    import zlib

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
           + chunk(b"tEXt", b"Author\x00some name") + chunk(b"eXIf", b"\x00" * 12)
           + chunk(b"IDAT", zlib.compress(b"\x00" * 72)) + chunk(b"IEND", b""))
    src = tmp_path / "in.png"
    src.write_bytes(png)
    assert any("PNG tEXt" in leak or "PNG eXIf" in leak for leak in scrub.audit(src).leaks)
    dst, removed = scrub.scrub(src)
    assert dst.exists() and dst.stat().st_size < src.stat().st_size
    assert not scrub.audit(dst).dirty
    assert imaging.image_size(dst.read_bytes()) == (8, 8)  # pixels untouched


def test_config_roundtrip(tmp_path):
    cfg = Config(handle="j.v.d.7")
    cfg.contact["email"] = "me@example.invalid"
    p = cfg.save(tmp_path / "pp-watchdog.json")
    raw = json.loads(p.read_text())
    assert "password" not in json.dumps(raw)  # no credential fields exist at all
    back = Config.load(p)
    assert back.handle == "j.v.d.7" and back.contact["email"] == "me@example.invalid"
    assert back.network["respect_robots"] is True
    assert back.redacted_contact()["phone"].startswith("<MISSING")


def test_end_to_end_scan_against_local_fixtures(tmp_path):
    from ppwatchdog.demo import Fixture, _free_port
    from http.server import ThreadingHTTPServer
    import threading

    root = tmp_path / "demo"
    root.mkdir()
    build_fixtures(root, "j.v.d.7")
    Fixture.root = root  # class default robots.txt disallows /blocked/ by path
    port = _free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Fixture)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        cfg = Config(handle="j.v.d.7", baseline_image=str(root / "baseline.png"))
        cfg.contact.update({"name": "Test Owner", "email": "me@example.invalid",
                            "address": "1 Test St", "phone": "+91-000-000", "jurisdiction": "IN"})
        cfg.paths["workdir"] = str(tmp_path / "work")
        cfg.ensure_dirs()
        sites = [Site(id=sid, name=name, base=f"http://127.0.0.1:{port}/{prefix}",
                      profile_urls=["/profile/{username}"], contact_paths=["/contact"],
                      confirmed=True, risk="high")
                 for prefix, sid, name, _ in SITES]
        policy = Policy(min_interval=0.0, max_requests=40, timeout=6.0, respect_robots=True,
                        allow_hosts=[f"127.0.0.1:{port}"])
        result = run_scan(cfg, sites, policy=policy)
        got = {f.site_id: f.verdict for f in result.findings}
        assert got["mollygram"] == "serving-current", got
        assert got["dumpor"] in ("serving-stale", "serving-unidentified"), got
        assert got["instadp"] in ("serving-hires", "serving-current"), got
        assert got["blocked-site"] == "blocked-robots", got
        assert got["gone-site"] == "not-indexed", got
        assert got["meta-only"] == "profile-mirrored", got
        assert result.score > 0 and len(result.actionable) >= 3
        assert all(f.url.startswith("http://127.0.0.1") for f in result.findings)

        # notices must contain the six §512 elements and the evidence URLs
        text = notice_text(result.actionable[0], cfg.redacted_contact(), "j.v.d.7", "dmca")
        for needle in ("good-faith", "penalty of perjury", "IDENTIFICATION OF THE COPYRIGHTED WORK",
                       "http://127.0.0.1", "/profile/j.v.d.7", "me@"):
            assert needle.lower() in text.lower(), needle

        hist = History(cfg.db_path)
        scan_id = hist.save(result)
        diff = hist.diff(scan_id)
        assert diff["first_scan"] and len(diff["new_exposure"]) == len(result.actionable)
        # second identical scan -> nothing new, and exposure ages are tracked
        result2 = run_scan(cfg, sites, policy=policy)
        sid2 = hist.save(result2)
        assert hist.diff(sid2)["new_exposure"] == []
        hist.close()
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_offline_replay_is_inert(tmp_path):
    """`--offline` must make zero HTTP requests: no listener is running at all."""
    root = tmp_path / "cap"
    root.mkdir()
    (root / "mollygram.html").write_text(
        json.dumps({"username": "j.v.d.7", "profile_pic_url": "http://127.0.0.1:1/x.png"}))
    cfg = Config(handle="j.v.d.7")
    cfg.paths["workdir"] = str(tmp_path / "w")
    cfg.ensure_dirs()
    site = Site(id="mollygram", name="Mollygram", base="https://mollygram.invalid",
                profile_urls=["/profile/{username}"], confirmed=True)
    result = run_scan(cfg, [site], offline_dir=root)
    assert result.findings[0].verdict in ("profile-mirrored", "not-indexed")
    assert not result.policy_log  # offline replayed pages, sent nothing


def test_report_markdown_states_the_limit(tmp_path):
    from ppwatchdog.report import markdown

    cfg = Config(handle="j.v.d.7")
    cfg.paths["workdir"] = str(tmp_path)
    cfg.ensure_dirs()
    result = run_scan(cfg, [], policy=Policy(min_interval=0, respect_robots=False))
    text = markdown(result, None, cfg, [])
    for phrase in ("cannot tell you", "profile picture", "Graph API", "Vanish"):
        assert phrase.lower() in text.lower(), phrase


def _synthetic_jpeg() -> bytes:
    """Structurally valid JPEG carrying EXIF + a comment, built by hand."""
    import struct as _s

    def seg(marker, payload):
        return bytes([0xFF, marker]) + _s.pack(">H", len(payload) + 2) + payload

    out = b"\xff\xd8"
    out += seg(0xE0, b"JFIF\x00\x01\x01\x00\x48\x00\x48\x00\x00")
    out += seg(0xE1, b"Exif\x00\x00" + b"GPSLatitude 20.9123 Make:Nikon")
    out += seg(0xFE, b"shot-by-secretname")
    out += seg(0xDB, b"\x00" + b"\x01" * 32)
    out += seg(0xC0, b"\x08" + _s.pack(">HHB", 40, 60, 3) + b"\x01\x11\x00")
    out += b"\xff\xda" + _s.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00" + b"\x00" * 16
    return out + b"\xff\xd9"


def test_scrub_strips_jpeg_exif_and_gps(tmp_path):
    src = tmp_path / "in.jpg"
    src.write_bytes(_synthetic_jpeg())
    before = scrub.audit(src)
    assert before.kind == "jpeg" and before.dirty
    assert any("EXIF" in leak for leak in before.leaks)
    assert any("GPS" in leak for leak in before.leaks)
    dst, removed = scrub.scrub(src)
    assert dst.exists() and dst.stat().st_size < src.stat().st_size
    after = scrub.audit(dst)
    assert not after.dirty, after.leaks
    assert after.size == before.size  # pixels/geometry untouched
    assert any("0xE1" in m for m in removed), removed
    assert removed  # and it reports what it removed


# --------------------------------------------------------------------------- #
# Zero-dependency runner: `python3 tests/test_watchdog.py` works with no pytest.
# --------------------------------------------------------------------------- #
def _run_all() -> int:  # pragma: no cover
    import inspect
    import tempfile
    import traceback

    failures = 0
    for name, fn in sorted(globals().items()):
        if not (name.startswith("test_") and callable(fn)):
            continue
        params = inspect.signature(fn).parameters
        try:
            if "tmp_path" in params:
                with tempfile.TemporaryDirectory() as d:
                    fn(Path(d))
            else:
                fn()
            print(f"  ok    {name}")
        except Exception:
            failures += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(("\n%d failure(s)" % failures) if failures else "\nall green")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
