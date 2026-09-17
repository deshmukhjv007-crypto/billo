"""Local dashboard. Stdlib http.server, localhost-ish, zero external assets.

Deliberately read-only: it renders what the last scan found and hands you the
notice files. It has no ability to submit anything anywhere, and no input field
accepts a password — there is nothing in this app for a password to unlock.
"""

from __future__ import annotations

import html
import json
import time
from pathlib import Path

from .config import Config  # noqa: F401
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import Config
from .history import History
from .report import VERDICT_LABEL, manual_links

CSS = """
:root{--bg:#0e1116;--panel:#161b22;--ink:#e6edf3;--dim:#8b949e;--bad:#f85149;--warn:#d29922;
--ok:#3fb950;--line:#262c36;--accent:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Noto Sans Devanagari,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:22px;margin:0 0 2px;letter-spacing:.2px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);margin:34px 0 10px}
.sub{color:var(--dim);font-size:13px;margin:0 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 15px}
.card .k{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim)}
.card .v{font-size:26px;font-weight:650;margin-top:4px;font-variant-numeric:tabular-nums}
.v.bad{color:var(--bad)} .v.warn{color:var(--warn)} .v.ok{color:var(--ok)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
border-radius:10px;overflow:hidden;font-size:13.5px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);background:#12161d}
tr:last-child td{border-bottom:0}
code{background:#0b0e13;border:1px solid var(--line);border-radius:5px;padding:1px 5px;
font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#a5d6ff;word-break:break-all}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;
border:1px solid var(--line);text-transform:uppercase;letter-spacing:.05em}
.pill.bad{color:var(--bad);border-color:#5a1e1e;background:#2a1215}
.pill.warn{color:var(--warn);border-color:#5c440f;background:#2a2210}
.pill.ok{color:var(--ok);border-color:#1d5128;background:#10231a}
.pill.dim{color:var(--dim)}
.note{border-left:3px solid var(--warn);background:#1a1710;padding:12px 14px;border-radius:0 8px 8px 0;
margin:0 0 20px;font-size:14px}
.note b{color:var(--warn)}
ul{margin:8px 0 0;padding-left:20px} li{margin:4px 0}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
pre{background:#0b0e13;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;
font-size:12px;line-height:1.5}
.bar{height:8px;background:#0b0e13;border-radius:99px;overflow:hidden;border:1px solid var(--line)}
.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--warn),var(--bad))}
footer{margin-top:38px;color:var(--dim);font-size:12.5px;border-top:1px solid var(--line);padding-top:14px}
"""


def _pill(verdict: str) -> str:
    cls = "ok" if verdict == "not-indexed" else (
        "dim" if verdict in ("skipped", "unverified", "no-fixture") else
        "warn" if verdict in ("profile-mirrored", "blocked-robots", "moved", "unreachable", "error")
        else "bad")
    return f'<span class="pill {cls}">{html.escape(VERDICT_LABEL.get(verdict, verdict))}</span>'


def render_page(cfg: Config, banner: str | None = None) -> str:
    hist = History(cfg.db_path)
    scan = hist.latest()
    diff = hist.diff(scan["id"]) if scan else None
    scans = hist.scans(20)
    notices = hist.notices()
    hist.close()

    counts = (scan or {}).get("counts") or {}
    actionable = [f for f in (scan or {}).get("findings", []) if f.get("actionable")]
    score = (scan or {}).get("score", 0)
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime(scan["started"])) if scan else "never"
    stale = counts.get("serving-stale", 0)
    hires = counts.get("serving-hires", 0)

    rows = []
    for f in sorted((scan or {}).get("findings", []),
                    key=lambda x: (-x.get("weight", 0), x.get("site_name", ""))):
        size = f.get("image_size") or [0, 0]
        dims = f"{size[0]}×{size[1]}" if any(size) else "—"
        next_step = (
            "<a href='/notices'>notices</a>" if f.get("actionable") else
            "<a href='/report'>verify by hand</a>"
            if f.get("verdict") in ("blocked-robots", "unverified", "profile-mirrored", "serving-unidentified", "error",
                                    "unreachable") else "—")
        meta = ("" if not f.get("meta_markers") else
                "<br><span class='pill warn'>file still carries metadata: "
                f"{html.escape(', '.join(f['meta_markers']))}</span>")
        img = (f"<code>{html.escape(f['image_url'])}</code>" if f.get("image_url") else "—")
        rows.append(
            "<tr>"
            f"<td><b>{html.escape(f.get('site_name', f.get('site_id', '')))}</b>"
            f"<br><code>{html.escape(f.get('base') or '—')}</code></td>"
            f"<td>{_pill(f.get('verdict', ''))}</td>"
            f"<td>{img}{meta}</td>"
            f"<td>{dims}</td>"
            f"<td>{next_step}</td>"
            "</tr>"
        )


    notice_rows = "".join(
        f"<tr><td>{html.escape(n['site_id'])}</td><td>{html.escape(n['kind'])}</td>"
        f"<td>{time.strftime('%Y-%m-%d', time.gmtime(n['sent_on']))}</td>"
        f"<td>{html.escape(str(n['response']))}</td>"
        f"<td>{time.strftime('%Y-%m-%d', time.gmtime(n['followup_due'])) if n['followup_due'] else '—'}</td></tr>"
        for n in notices) or "<tr><td colspan=5 style='color:var(--dim)'>nothing filed yet</td></tr>"

    scan_rows = "".join(
        f"<tr><td>{time.strftime('%Y-%m-%d %H:%M', time.localtime(s['started']))}</td>"
        f"<td>{s['score']}</td><td>{html.escape(s['source'])}</td>"
        f"<td>{html.escape(', '.join(f'{k}:{v}' for k, v in (s['counts'] or {}).items()))}</td></tr>"
        for s in scans) or "<tr><td colspan=4 style='color:var(--dim)'>no scans recorded</td></tr>"

    links = "".join(
        f"<li><a href='{html.escape(u)}' rel='noopener noreferrer'>{html.escape(lbl)}</a></li>"
        for lbl, u in manual_links(cfg.handle or "your-handle"))

    baseline = (scan or {}).get("baseline") or {}
    baseline_text = (f"{baseline.get('width', 0)}×{baseline.get('height', 0)} px"
                     if baseline else "not set")
    parts = [
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,"
        "initial-scale=1'><title>pp-watchdog · exposure for @" + html.escape(cfg.handle or "?") + "</title>",
        f"<style>{CSS}</style><div class='wrap'>",
        f"<h1>Profile picture exposure — <code>@{html.escape(cfg.handle or 'no handle')}</code></h1>",
        f"<p class='sub'>last scan {html.escape(when)} · {len((scan or {}).get('findings', []))} sites checked · "
        f"baseline {html.escape(baseline_text)}"
        f" · no Instagram credentials used, by design</p>",
        banner if banner is not None else
        "<div class='note'><b>What this dashboard cannot show you, and no tool can:</b> who opened "
        "your profile, who tapped or zoomed your picture, who screenshotted it. Instagram records no "
        "such event for you, exposes none of it in the API, and reports only one capture type anywhere "
        "on the platform (a screenshot of a View-Once / Vanish-mode DM). Anything claiming to sell you "
        "a viewer list is fabricating names and harvesting your login. This tool instead answers the "
        "question that <i>is</i> answerable: where else on the public web does my face sit, in what "
        "resolution, and who do I write to get it down.</div>",
        "<div class='grid'>",
        f"<div class='card'><div class='k'>exposure score</div><div class='v {'bad' if score > 50 else 'warn' if score > 20 else 'ok'}'>{score}</div>"
        f"<div class='bar'><i style='width:{min(100, score)}%'></i></div></div>",
        f"<div class='card'><div class='k'>sites mirroring you</div><div class='v {'bad' if len(actionable) else 'ok'}'>{len(actionable)}</div></div>",
        f"<div class='card'><div class='k'>stale pictures</div><div class='v {'warn' if stale else 'ok'}'>{stale}</div></div>",
        f"<div class='card'><div class='k'>oversized copies</div><div class='v {'bad' if hires else 'ok'}'>{hires}</div></div>",
        f"<div class='card'><div class='k'>needs browser check</div><div class='v warn'>"
        f"{counts.get('blocked-robots', 0) + counts.get('unverified', 0)}</div></div>",
        "</div>",
        "<h2>Findings</h2>",
        "<table><tr><th>site</th><th>verdict</th><th>mirrored copy</th><th>served size</th><th>next step</th></tr>"
        + ("".join(rows) or "<tr><td colspan=5 style='color:var(--dim)'>run "
                             "<code>pp-watchdog scan --history</code></td></tr>") + "</table>",
        "<h2>Movement since previous scan</h2>",
    ]
    if diff and not diff.get("first_scan"):
        for key, label in (("new_exposure", "newly exposed"), ("escalated", "escalated"),
                           ("resolved", "cleared")):
            items = diff.get(key) or []
            parts.append(f"<p>{len(items)} {label}</p>" if items else "")
    else:
        parts.append("<p class='sub'>baseline scan — diffs start once you have two scans on record.</p>")

    parts += [
        "<p><a class='pill dim' href='/demo'>see a worked example on synthetic data →</a></p>",
        "<h2>Manual searches this tool will not script</h2><ul>" + links + "</ul>",
        "<h2>Filings</h2>",
        "<table><tr><th>site</th><th>kind</th><th>sent</th><th>status</th><th>follow-up due</th></tr>"
        + notice_rows + "</table>",
        f"<p><a class='pill dim' href='/notices'>open the notice files →</a> "
        f"<code>pp-watchdog takedown</code> writes them; nothing is sent automatically.</p>",
        "<h2>Scan log</h2><table><tr><th>when</th><th>score</th><th>source</th><th>counts</th></tr>"
        + scan_rows + "</table>",
        "<footer>pp-watchdog · data dir <code>" + html.escape(str(cfg.workdir)) + "</code> · "
        "single-user defensive tool · registry drifts, so treat <code>not-indexed</code> on an "
        "unverified domain as 'unknown', not 'clean'.</footer></div>",
    ]
    return "".join(p for p in parts if p)


class Handler(BaseHTTPRequestHandler):
    cfg: Config
    root: Path = Path(".")

    def log_message(self, fmt, *args):
        return

    def _out(self, body: bytes, ctype="text/html; charset=utf-8", code=200) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
                         "base-uri 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            try:
                return self._out(render_page(self.cfg).encode())
            except Exception as exc:  # keep the preview alive with an honest error
                return self._out(f"<pre>dashboard error: {html.escape(str(exc))}\n\n"
                                f"run `pp-watchdog scan --history` first.</pre>".encode(), code=500)
        if path == "/report":
            md = self.cfg.workdir / "latest-report.md"
            if md.exists():
                return self._out(f"<style>body{{background:#0e1116;color:#e6edf3;"
                                 f"font:13px/1.6 ui-monospace,monospace;padding:24px;white-space:pre-wrap}}"
                                 f"</style><pre>{html.escape(md.read_text())}</pre>".encode())
            return self._out(b"no report yet", code=404)
        if path in ("/notices", "/notices/"):
            files = sorted(self.cfg.notices_dir.glob("*")) if self.cfg.notices_dir.exists() else []
            lis = "".join(f"<li><a href='/notices/{f.name}'>{html.escape(f.name)}</a> "
                          f"({f.stat().st_size:,} B)</li>" for f in files)
            body = ("<div class='wrap'><h1>Takedown pack</h1><ul>"
                    + (lis or "<li>nothing generated yet — run <code>pp-watchdog takedown</code></li>")
                    + "</ul></div>")
            return self._out(f"<!doctype html><meta charset='utf-8'><style>{CSS}</style>{body}".encode())
        if path.startswith("/notices/") and _safe_name(path):
            f = (self.cfg.notices_dir / path.rsplit("/", 1)[1]).resolve()
            if f.is_file() and self.cfg.notices_dir in f.parents:
                return self._out(f.read_bytes(), "text/plain; charset=utf-8")
            return self._out(b"not found", code=404)
        if path == "/demo":
            try:
                return self._out(_demo_html().encode())
            except Exception as exc:
                return self._out(f"<pre>demo run failed: {html.escape(str(exc))}</pre>".encode(), code=500)
        if path == "/healthz":
            return self._out(json.dumps({"ok": True, "handle": self.cfg.handle,
                                         "has_scan": History(self.cfg.db_path).latest() is not None}
                                        ).encode(), "application/json")
        return self._out(b"not found", code=404)


_DEMO_CACHE: dict[str, str] = {}


def _demo_html() -> str:
    """Runs the fixture scan once and renders it, clearly labelled synthetic."""
    if "html" not in _DEMO_CACHE:
        from .demo import run_demo

        root = Path("out") / "demo"
        run_demo(workdir=root, quiet=True)
        demo_cfg = Config(handle="j.v.d.7")
        demo_cfg.paths["workdir"] = str(root / "work")
        banner = ("<div class='note' style='border-color:var(--accent);background:#0d1520'>"
                  "<b style='color:var(--accent)'>SYNTHETIC DATA — this is a worked example, not "
                  "your account.</b> Six local fixture sites impersonate real mirror behaviour: one "
                  "serving your current picture, one an old one, one a bigger file than Instagram "
                  "shows, one that blocks crawlers, one that has nothing, one that mirrors your bio "
                  "text only. Read it to learn what each verdict means and what the generated notice "
                  "looks like. No network, no Instagram, no credentials.</div>")
        _DEMO_CACHE["html"] = render_page(demo_cfg, banner=banner)
    return _DEMO_CACHE["html"]


def _safe_name(path: str) -> bool:
    name = path.rsplit("/", 1)[1] if "/" in path else path
    return bool(name) and "/" not in name and "\\" not in name and ".." not in name and \
        name.endswith((".txt", ".md", ".json", ".csv"))


def serve(cfg: Config, host: str = "0.0.0.0", port: int = 8899) -> None:
    cfg.ensure_dirs()
    Handler.cfg = cfg

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    httpd = Server((host, port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
