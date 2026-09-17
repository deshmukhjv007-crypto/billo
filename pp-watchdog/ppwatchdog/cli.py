"""pp-watchdog CLI.

Read-only by default: `scan` performs one unauthenticated GET per page it
considers, obeys robots.txt, and writes only inside .pp-watchdog/.
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

from . import __version__
from .config import Config, validate_handle
from .hardening import load_items, render as render_checklist, toggle
from .history import History
from .imaging import HAVE_PIL
from .registry import Site, load_registry
from .report import manual_links, markdown, summary_lines, write_reports
from .scan import run_scan
from .scrub import audit as audit_image, scrub
from .takedown import build_pack, dispatch_log

EPILOG = """\
examples
  pp-watchdog init --handle j.v.d.7 --baseline ~/Pictures/me.jpg
  pp-watchdog scan --history
  pp-watchdog ingest --url https://imginn.com/profile/x/ --file saved.html --scan
  pp-watchdog scan --offline out/demo/work     # replay captured pages, zero network
  pp-watchdog takedown                         # write notices into .pp-watchdog/notices
  pp-watchdog links                            # manual searches it refuses to script
  pp-watchdog scrub --in new-pp.jpg            # strip EXIF/GPS before you upload
  pp-watchdog checklist                        # hardening posture
  pp-watchdog selftest                           # end-to-end against local fixtures
  pp-watchdog serve --port 8899                # local dashboard, binds 0.0.0.0

This tool cannot tell you who viewed your profile or opened your picture.
Instagram exposes no such data to anyone; see README.md.
"""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pp-watchdog",
        description="Find out which third-party Instagram mirror sites are re-hosting your "
                    "profile picture — stale copies, oversized copies, cached bios — and "
                    "generate the notices to get them removed.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="version", version=f"pp-watchdog {__version__}")
    p.add_argument("-c", "--config", help="path to pp-watchdog.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init", help="write a config file for your handle")
    init.add_argument("--handle", required=True)
    init.add_argument("--baseline", help="your own copy of the current profile picture")
    init.add_argument("--name", default="")
    init.add_argument("--email", default="")
    init.add_argument("--address", default="")
    init.add_argument("--phone", default="")
    init.add_argument("--jurisdiction", default="IN", choices=["IN", "US", "EU"])
    init.add_argument("--workdir", default=".pp-watchdog")
    init.add_argument("--force", action="store_true")

    scan = sub.add_parser("scan", help="probe the registry for your picture")
    scan.add_argument("--handle", help="override the configured handle")
    scan.add_argument("--acknowledge", action="store_true",
                      help="confirm you act for this handle with its owner's consent")
    scan.add_argument("--only", nargs="*", metavar="SITE_ID", help="restrict to these registry ids")
    scan.add_argument("--skip-search", action="store_true", help="skip search-engine entries")
    scan.add_argument("--offline", metavar="DIR", help="replay captured pages from DIR, no network")
    scan.add_argument("--captures", nargs="?", const="", metavar="DIR",
                      help="scan only what you have captured (default .pp-watchdog/captures)")
    scan.add_argument("--dry-run", action="store_true", help="print the requests, send none")
    scan.add_argument("--history", action="store_true", help="record this scan in history.sqlite3")
    scan.add_argument("--no-robots", action="store_true", help="IGNORE robots.txt (not advised)")
    scan.add_argument("--max-requests", type=int)
    scan.add_argument("--min-interval", type=float)
    scan.add_argument("--json", action="store_true", help="machine-readable output")

    ing = sub.add_parser("ingest", help="save a page you captured in a browser as scanner evidence")
    ing.add_argument("--url", required=True, help="the mirror page you looked at")
    ing.add_argument("--file", help="saved .html/.txt file, or '-' for stdin")
    ing.add_argument("--text", help="pasted text content instead of a file")
    ing.add_argument("--site", help="registry id to attach it to (default: derived from the host)")
    ing.add_argument("--by", default="manual browser capture",
                     help="how it was captured, recorded in the provenance header")
    ing.add_argument("--scan", action="store_true", help="ingest, then scan the capture dir")

    cap = sub.add_parser("captures", help="list saved evidence captures")
    cap.add_argument("action", nargs="*", default=["list"], help="'list' | 'clear'")

    sub.add_parser("links", help="manual search links for your handle")

    takedown = sub.add_parser("takedown", help="write takedown notices for actionable findings")
    takedown.add_argument("--scan", type=int, help="use this stored scan id instead of the latest")

    sent = sub.add_parser("notice-sent", help="log that you filed a notice (starts the follow-up clock)")
    sent.add_argument("site_id")
    sent.add_argument("kind", nargs="?", default="it_act")
    sent.add_argument("--note", default="")

    hist = sub.add_parser("history", help="exposures grouped by age")
    hist.add_argument("--limit", type=int, default=10)

    sub.add_parser("scans", help="list recorded scans")

    reg = sub.add_parser("registry", help="inspect or extend the mirror registry")
    reg.add_argument("action", choices=["list", "add", "disable", "export"], nargs="?", default="list")
    reg.add_argument("args", nargs="*")
    reg.add_argument("--base")
    reg.add_argument("--path", default="", help="profile URL template, e.g. /user/{username}")
    reg.add_argument("--name")

    chk = sub.add_parser("checklist", help="hardening posture")
    chk.add_argument("action", nargs="*", default=["show"],
                     help="'show' | 'done <item-id>' | 'undo <item-id>'")

    sc = sub.add_parser("scrub", help="strip EXIF/GPS from a photo before you upload it")
    sc.add_argument("--in", dest="src", required=True)
    sc.add_argument("--out", dest="dst")
    sc.add_argument("--check", action="store_true", help="only report what the file leaks")

    sub.add_parser("selftest", help="end-to-end run against local fixtures (no network)")
    sub.add_parser("config", help="show resolved config + environment sanity")
    sub.add_parser("config-audit", help="check this install stores no credentials")

    serve = sub.add_parser("serve", help="local dashboard")
    serve.add_argument("--port", type=int, default=8899)
    serve.add_argument("--host", default="0.0.0.0")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = Config.load(args.config)
    try:
        return _dispatch(args, cfg)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


def _dispatch(args, cfg: Config) -> int:
    cmd = args.cmd
    if cmd == "init":
        return _cmd_init(args, cfg)
    if cmd == "links":
        return _cmd_links(cfg)
    if cmd == "ingest":
        return _cmd_ingest(args, cfg)
    if cmd == "captures":
        return _cmd_captures(args, cfg)
    if cmd == "scrub":
        return _cmd_scrub(args)
    if cmd == "selftest":
        return _cmd_selftest()
    if cmd == "config":
        return _cmd_config(cfg)
    if cmd == "config-audit":
        return _cmd_config_audit(cfg)
    if cmd == "registry":
        return _cmd_registry(args, cfg)
    if cmd == "checklist":
        return _cmd_checklist(args, cfg)
    if cmd == "history":
        return _cmd_history(cfg, args.limit)
    if cmd == "scans":
        return _cmd_scans(cfg)
    if cmd == "notice-sent":
        return _cmd_notice_sent(args, cfg)
    if cmd == "takedown":
        return _cmd_takedown(args, cfg)
    if cmd == "serve":
        return _cmd_serve(args, cfg)
    if cmd == "scan":
        return _cmd_scan(args, cfg)
    return 2


# --------------------------------------------------------------------------- #
def _cmd_init(args, cfg: Config) -> int:
    ok, why = validate_handle(args.handle)
    if not ok:
        print(f"invalid handle: {why}", file=sys.stderr)
        return 2
    path = Path(args.config) if args.config else Path.cwd() / "pp-watchdog.json"
    if path.exists() and not args.force:
        print(f"{path} already exists. Re-run with --force to overwrite.", file=sys.stderr)
        return 2
    cfg.handle = args.handle
    cfg.display_name = args.name
    if args.baseline:
        b = Path(args.baseline).expanduser()
        if not b.exists():
            print(f"baseline file not found: {b}", file=sys.stderr)
            return 2
        cfg.baseline_image = str(b)
    cfg.contact.update({"name": args.name, "email": args.email, "address": args.address,
                        "phone": args.phone, "jurisdiction": args.jurisdiction})
    cfg.paths["workdir"] = args.workdir
    cfg.ensure_dirs()
    saved = cfg.save(path)
    print(f"wrote {saved}")
    print(f"  handle: @{cfg.handle}")
    print(f"  workdir: {cfg.workdir}")
    print(f"  baseline: {cfg.baseline_image or '(not set - step 2 of the README)'}")
    if not args.email:
        print("  ! contact.email is empty; takedown notices need a real reply address")
    print(f"\nnext: pp-watchdog scan --dry-run   (see exactly what it would request)")
    return 0


def _sites_for(cfg: Config, args) -> list[Site]:
    sites = load_registry(
        cfg.registry_file or None,
        extras=cfg.scan.get("extra_sites") or None,
        disabled=cfg.scan.get("disabled") or None,
    )
    only = getattr(args, "only", None)
    if only:
        sites = [s for s in sites if s.id in set(only)]
    if getattr(args, "skip_search", False):
        sites = [s for s in sites if s.kind != "search"]
    return sites


def _cmd_scan(args, cfg: Config) -> int:
    handle = args.handle or cfg.handle
    if not handle:
        print("no handle configured — run: pp-watchdog init --handle <your-handle>", file=sys.stderr)
        return 2
    from .policy import Policy

    if args.handle and args.handle != cfg.handle:
        policy = Policy()
        ok, why = policy.check_handle(args.handle, cfg.handle, args.acknowledge)
        if not ok:
            print(why, file=sys.stderr)
            return 3
    cfg.handle = handle
    offline = None
    source = "live"
    if getattr(args, "offline", None):
        offline = Path(args.offline).expanduser()
        source = "offline"
    elif getattr(args, "captures", None) is not None:
        offline = Path(args.captures).expanduser() if args.captures else cfg.workdir / "captures"
        source = "capture"
        if not any(offline.glob("*.html")):
            print(f"no captures in {offline} — save a page first, e.g.\n"
                  f"  pp-watchdog ingest --url https://imginn.com/profile/{handle}/ "
                  f"--file saved.html", file=sys.stderr)
            return 2
    sites = _sites_for(cfg, args)
    if offline is not None and source == "capture":
        have = {f.stem for f in offline.glob("*.html")}
        skipped = [x.id for x in sites if x.id not in have]
        sites = [x for x in sites if x.id in have]
        print(f"capture mode: {len(sites)} saved page(s) in {offline}; "
              f"{len(skipped)} registry site(s) not scanned (no capture). Zero requests sent.")
    if not sites:
        print("registry is empty after filtering", file=sys.stderr)
        return 2

    if args.dry_run:
        print(f"pp-watchdog would send {sum(min(len(s.profile_urls), 2) for s in sites)} GETs "
              f"(plus one /robots.txt per host), all unauthenticated, cookies off:\n")
        for s in sites:
            for u in s.urls_for(handle)[:2]:
                print(f"  GET {u:<74} [{s.name}]")
        print(f"\nno credentials are used. no requests were sent. baseline: "
              f"{cfg.baseline_image or '(unset)'}")
        return 0

    from .scan import load_baseline

    policy = Policy(
        min_interval=args.min_interval if args.min_interval is not None
        else cfg.network.get("min_interval_seconds", 5.0),
        max_requests=args.max_requests or cfg.network.get("max_requests_per_scan", 60),
        timeout=cfg.network.get("timeout_seconds", 12.0),
        respect_robots=cfg.network.get("respect_robots", True) and not args.no_robots,
    )
    if args.no_robots:
        print("! robots.txt enforcement disabled — mirror sites will rate-limit and block you "
              "harder than the caches you are trying to measure", file=sys.stderr)

    t0 = time.time()
    offline = None
    source = "live"
    if getattr(args, "offline", None):
        offline = Path(args.offline).expanduser()
        source = "offline"
    elif getattr(args, "captures", None) is not None:
        offline = Path(args.captures).expanduser() if args.captures else cfg.workdir / "captures"
        source = "capture"
        if not any(offline.glob("*.html")):
            print(f"no captures in {offline} — save a page first, e.g.\n"
                  f"  pp-watchdog ingest --url https://imginn.com/profile/{handle}/ "
                  f"--file saved.html", file=sys.stderr)
            return 2
    result = run_scan(cfg, sites, policy=policy, offline_dir=offline)
    diff = None
    if args.history:
        hist = History(cfg.db_path)
        scan_id = hist.save(result, source=source)
        diff = hist.diff(scan_id)
        hist.close()
    md_path, evidence = write_reports(result, diff, cfg, sites)

    if args.json:
        payload = json.loads(result.to_json())
        payload["report"] = str(md_path)
        print(json.dumps(payload, indent=2))
        return 0 if not result.actionable else 1

    print("\n".join(summary_lines(result, diff)))
    print(f"\nwrote {md_path}")
    print(f"    evidence → {evidence}")
    if result.actionable:
        print(f"\n{len(result.actionable)} site(s) to send notices to → `pp-watchdog takedown`")
    print(f"scan took {time.time() - t0:.1f}s, {len(result.policy_log)} requests")
    return 0 if not result.actionable else 1


def _cmd_links(cfg: Config) -> int:
    handle = cfg.handle
    if not handle:
        print("no handle configured", file=sys.stderr)
        return 2
    print(f"manual checks for @{handle} — open these yourself:\n")
    for label, url in manual_links(handle):
        print(f"  • {label}\n      {url}")
    print("\nWhy these are manual: scripted search-engine queries need an API key or invite a "
          "ban, and a search engine's cache of a mirror page is not proof the mirror still has "
          "your picture. Look at the page itself.")
    return 0


def _cmd_takedown(args, cfg: Config) -> int:
    from .scan import ScanResult  # noqa: F401 (kept for typing clarity)

    hist = History(cfg.db_path)
    scan_id = args.scan or (hist.scans(1)[0]["id"] if hist.scans(1) else None)
    if not scan_id:
        print("no recorded scan. run: pp-watchdog scan --history", file=sys.stderr)
        hist.close()
        return 2
    findings = hist.findings_for(scan_id)
    result = _rehydrate(cfg.handle, findings)
    if not result.actionable:
        print("this scan recorded no actionable findings — nothing to file.")
        hist.close()
        return 0
    written = build_pack(result, cfg)
    for path, kind in written[1:]:
        print(f"  {path.name}")
    print(f"\n{len(written) - 1} notice(s) + index in {cfg.notices_dir}")
    print("Read .pp-watchdog/notices/README.md before sending: filing order, registrar CC, "
          "and the browser-verification caveats matter more than the wording.")
    print("pp-watchdog does not send anything. Review each notice, then send it yourself.")
    hist.close()
    return 0


def _rehydrate(handle: str, findings: list[dict]):
    from .scan import Finding, ScanResult

    out = ScanResult(handle=handle, started=time.time(), finished=time.time())
    for d in findings:
        d = {k: v for k, v in d.items() if k in Finding.__dataclass_fields__}
        d.setdefault("page_state", "")
        out.findings.append(Finding(**d))
    return out


def _cmd_history(cfg: Config, limit: int) -> int:
    hist = History(cfg.db_path)
    scans = hist.scans(limit)
    if not scans:
        print("no scans recorded yet — run `pp-watchdog scan --history`")
        hist.close()
        return 0
    ages: dict[str, float] = {}
    for s in scans:
        for f in hist.findings_for(s["id"]):
            if f.get("actionable"):
                ages.setdefault(f["site_id"], s["started"])
    now = time.time()
    print(f"@{cfg.handle} — {len(scans)} scan(s), exposure age by site\n")
    for sid, first in sorted(ages.items(), key=lambda kv: kv[1]):
        print(f"  {sid:<20} exposed {round((now - first) / 86400, 1)}d  (first seen "
              f"{time.strftime('%Y-%m-%d', time.localtime(first))})")
    log = dispatch_log(cfg)
    if log:
        print("\nnotices:\n")
        for row in log:
            flag = "  ◷ follow-up overdue" if row.get("due_epoch") and row["due_epoch"] < time.time() else ""
            print(f"  {row['sent']:<12} {row['site']:<20} {row['kind']:<8} "
                  f"{row['status']:<10} follow-up {row['followup_due']}{flag}")
    hist.close()
    return 0


def _cmd_scans(cfg: Config) -> int:
    hist = History(cfg.db_path)
    print(f"{'id':>4}  {'when':<17} {'score':>5}  {'src':<7} counts")
    for s in hist.scans(30):
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(s["started"]))
        counts = ", ".join(f"{k}:{v}" for k, v in (s["counts"] or {}).items())
        print(f"{s['id']:>4}  {when:<17} {s['score']:>5}  {s['source']:<7} {counts[:70]}")
    hist.close()
    return 0


def _cmd_notice_sent(args, cfg: Config) -> int:
    hist = History(cfg.db_path)
    scans = hist.scans(1)
    hist.log_notice(scans[0]["id"] if scans else None, args.site_id, args.kind, args.note)
    print(f"logged: {args.site_id} / {args.kind} — follow-up reminder set for +14 days")
    hist.close()
    return 0


def _cmd_registry(args, cfg: Config) -> int:
    if args.action == "export":
        sites = load_registry(cfg.registry_file or None, extras=cfg.scan.get("extra_sites"),
                              disabled=[])
        out = cfg.workdir / "registry.json"
        cfg.ensure_dirs()
        out.write_text(json.dumps({"schema": 1, "sites": [s.to_dict() for s in sites]}, indent=2),
                       encoding="utf-8")
        print(f"wrote {out} — edit it, then set registry_file to that path")
        return 0
    if args.action == "disable" and args.args:
        for sid in args.args:
            if sid not in (cfg.scan.get("disabled") or []):
                cfg.scan.setdefault("disabled", []).append(sid)
        _autosave(cfg, args)
        print("disabled: " + ", ".join(cfg.scan["disabled"]))
        return 0
    if args.action == "add" and args.args:
        sid = args.args[0]
        base = args.base or (args.args[1] if len(args.args) > 1 else "")
        if not base:
            print("usage: pp-watchdog registry add <id> <base-url> [--path /profile/{username}]",
                  file=sys.stderr)
            return 2
        entry = {"id": sid, "name": args.name or sid, "base": base.rstrip("/"),
                 "profile_urls": [args.path] if args.path else ["/profile/{username}"],
                 "contact_paths": ["/contact"], "confirmed": True, "risk": "high",
                 "status_2026_08": "added by you on " + time.strftime("%Y-%m-%d")}
        cfg.scan.setdefault("extra_sites", []).append(entry)
        _autosave(cfg, args)
        print(f"added {sid} → {base}")
        return 0
    sites = load_registry(cfg.registry_file or None, extras=cfg.scan.get("extra_sites"),
                          disabled=cfg.scan.get("disabled") or [])
    print(f"{'id':<18} {'risk':<9} {'domain?':<9} name")
    for s in sites:
        mark = "confirmed" if s.confirmed else "UNVERIFIED"
        print(f"{s.id:<18} {s.risk:<9} {mark:<9} {s.name}  {s.base}")
        if s.status_2026_08:
            print(f"{'':<37}{s.status_2026_08[:96]}")
    print(f"\n{len(sites)} entries. Disabled: {', '.join(cfg.scan.get('disabled') or []) or 'none'}")
    print("Registry drifts: `registry add` what you find in your own manual searches, "
          "`registry disable` what has died.")
    return 0


def _autosave(cfg: Config, args) -> None:
    path = Path(args.config) if args.config else Path.cwd() / "pp-watchdog.json"
    cfg.save(path)


def _cmd_checklist(args, cfg: Config) -> int:
    hist = History(cfg.db_path)
    action = args.action or ["show"]
    if action[0] == "done" and len(action) > 1:
        toggle(hist, action[1], True)
        print(f"marked done: {action[1]}")
    elif action[0] == "undo" and len(action) > 1:
        toggle(hist, action[1], False)
        print(f"marked open: {action[1]}")
    else:
        from .hardening import with_state

        print(render_checklist(with_state(load_items(), hist), cfg.handle or "<no handle>"))
    hist.close()
    return 0


def _cmd_scrub(args) -> int:
    src = Path(args.src).expanduser()
    if not src.exists():
        print(f"not found: {src}", file=sys.stderr)
        return 2
    before = audit_image(src)
    print(f"{src.name}: {before.kind or 'unrecognised'} "
          f"{before.size[0]}x{before.size[1]}px")
    if before.leaks:
        print("  this file would leak:")
        for leak in before.leaks:
            print(f"    - {leak}")
    else:
        print("  no metadata found — safe to upload")
    if args.check:
        return 0 if not before.leaks else 1
    dst, removed = scrub(src, Path(args.dst).expanduser() if args.dst else None)
    print("\n  wrote:", dst)
    for r in removed:
        print("    removed:", r)
    print("\nUpload this file as your profile picture; mirrors can only copy what you gave them.")
    return 0


def _cmd_ingest(args, cfg: Config) -> int:
    """Turn a page you saved yourself into scanner evidence.

    Some mirrors render the profile picture only after JavaScript runs, and many
    networks block scripted access while a normal browser works fine. Rather than
    pretending to be a browser, this tool asks you to do the one thing you are
    already doing - look at the page - and save it. The provenance header it
    writes (URL, time, method, hash of the capture) is what makes the resulting
    finding defensible in a complaint, so do not strip it.
    """
    import hashlib
    import re as _re
    from urllib.parse import urlparse

    if not args.file and not args.text:
        print("pass --file saved.html (or '-' for stdin) or --text '...'", file=sys.stderr)
        return 2
    if args.file == "-":
        raw = sys.stdin.buffer.read()
    elif args.file:
        src = Path(args.file).expanduser()
        if not src.exists():
            print(f"not found: {src}", file=sys.stderr)
            return 2
        raw = src.read_bytes()
    else:
        raw = args.text.encode()
    body = raw.decode("utf-8", "replace")
    if len(body.strip()) < 40:
        print("capture is too short to be evidence (40 chars min) - save the whole page",
              file=sys.stderr)
        return 2
    host = urlparse(args.url).netloc.lower()
    site_id = args.site or (_re.sub(r"[^a-z0-9]+", "-", host.split(":")[0]).strip("-").split("-")[-1]
                           if False else _slug(host))
    cfg.ensure_dirs()
    out_dir = cfg.workdir / "captures"
    out_dir.mkdir(parents=True, exist_ok=True)
    header = (
        f"<!-- captured-url: {args.url} -->\n"
        f"<!-- captured-at: {time.strftime('%Y-%m-%dT%H:%M:%S%z')} -->\n"
        f"<!-- captured-by: {args.by} -->\n"
        f"<!-- capture-sha256: {hashlib.sha256(raw).hexdigest()} -->\n"
        f"<!-- site-id: {site_id} -->\n"
    )
    # Always add our own header when one is missing, but never duplicate a hash:
    # a page saved from a browser may already carry provenance comments, and those
    # stay below this block as part of the record.
    if "capture-sha256:" not in body[:3000]:
        body = header + body
    elif "captured-url:" not in body[:3000]:
        body = header + body
    dest = out_dir / f"{site_id}.html"
    dest.write_text(body, encoding="utf-8")
    print(f"saved {dest} ({len(body):,} bytes) as site '{site_id}'")
    from . import extract

    page = body
    cands = extract.extract_images(page, limit=3)
    state = extract.page_state(page, 200)
    print(f"  page state: {state}")
    if cands:
        print(f"  image reference found: {cands[0].url[:110]}")
        hints = extract.instagram_asset_hints(cands[0].url)
        if hints:
            print(f"  instagram asset hints: {hints}")
    claims = extract.hd_claims(page)
    if claims:
        print(f"  operator claims captured: {len(claims)}")
        for c in claims[:2]:
            print(f"     “{c[:130]}”")
    else:
        print("  no HD/download claims detected in this capture")
    known = {s.id for s in load_registry(cfg.registry_file or None,
                                          extras=cfg.scan.get("extra_sites"))}
    if site_id not in known:
        print(f"  note: '{site_id}' is not in the registry; add it with\n"
              f"        pp-watchdog registry add {site_id} https://{host} "
              f"--path /profile/{{username}}")
    if args.scan:
        ns = argparse.Namespace(handle=None, acknowledge=False, only=[site_id], skip_search=True,
                                offline=None, captures=str(out_dir), dry_run=False, no_robots=False,
                                max_requests=None, min_interval=None, history=True, json=False)
        cfg.handle = cfg.handle or site_id
        return _cmd_scan(ns, cfg)
    return 0


def _slug(host: str) -> str:
    import re as _re

    label = host.split(":")[0]
    parts = [p for p in _re.split(r"[.-]+", label) if p]
    for p in reversed(parts):
        if p not in ("www", "com", "net", "org", "io", "co", "in", "info", "app", "xyz", "site"):
            return p
    return parts[-1] if parts else "capture"


def _cmd_captures(args, cfg: Config) -> int:
    import hashlib

    out_dir = cfg.workdir / "captures"
    if args.action and args.action[0] == "clear":
        n = 0
        for f in list(out_dir.glob("*.html")):
            f.unlink()
            n += 1
        print(f"removed {n} capture(s)")
        return 0
    files = sorted(out_dir.glob("*.html")) if out_dir.exists() else []
    if not files:
        print(f"no captures yet in {out_dir}")
        print("save one from your browser (Ctrl+S, complete page, or just View Source as .html):")
        print("  pp-watchdog ingest --url <mirror-page-url> --file saved.html")
        return 0
    print(f"{len(files)} capture(s) in {out_dir}\n")
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        meta = {}
        for key in ("captured-url", "captured-at", "captured-by", "site-id"):
            i = text.find(f"{key}:")
            if i != -1:
                meta[key] = text[i + len(key) + 1:].split("-->")[0].strip()
        digest = hashlib.sha256(text.encode()).hexdigest()[:16]
        print(f"  {f.name:<24} {len(text):>9,} bytes  sha256 {digest}…")
        for k in ("captured-url", "captured-at", "captured-by"):
            if meta.get(k):
                print(f"      {k:<13} {meta[k]}")
    print("\nscan them: pp-watchdog scan --captures --history")
    return 0


def _cmd_config(cfg: Config) -> int:
    print(json.dumps({
        "handle": cfg.handle,
        "baseline_image": cfg.baseline_image,
        "baseline_resolved": str(cfg.baseline_path) if cfg.baseline_path else None,
        "config_file": cfg.source or "(none: using built-in defaults)",
        "workdir": str(cfg.workdir),
        "contact": cfg.redacted_contact(),
        "network": cfg.network,
        "cadence_days": cfg.cadence_days,
        "scan": cfg.scan,
        "environment": {"python": sys.version.split()[0], "pillow_available": HAVE_PIL},
    }, indent=2))
    if not HAVE_PIL:
        print("\nnote: without Pillow, 'is this an old photo of me?' falls back to exact file hash "
              "+ dimensions. pip install pillow for perceptual matching on re-encoded copies.",
              file=sys.stderr)
    return 0


def _cmd_config_audit(cfg: Config) -> int:
    """Look for credential *assignments*, not the word 'password' in prose.

    Reports and this README discuss passwords at length; a config or cookie jar
    would hold them as values. That distinction is the whole check.
    """
    import re

    problems: list[str] = []
    scan_targets = [cfg.workdir] + [Path(p) for p in (cfg.source, str(Path.cwd() / "pp-watchdog.json")) if p]
    scan_targets = [t for t in dict.fromkeys(scan_targets) if t.exists()]
    needle = re.compile(
        r"""(["']?(?:password|passwd|pwd|secret|api[_-]?key|authorization|bearer|"""
        r"""sessionid|csrftoken|ds_user_id|mid|ig_did)["']?\s*[:=]\s*)(?!\s*$)["\']?[^\s"',}]{3,}""",
        re.I,
    )
    hits: list[str] = []
    for target in scan_targets:
        if not target.exists():
            continue
        files = [target] if target.is_file() else list(target.rglob("*"))
        for f in files:
            if not f.is_file() or f.suffix.lower() not in (".json", ".txt", ".sqlite3", ".conf"):
                continue  # .md is narrative, not configuration
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            for m in needle.finditer(text):
                key = re.sub(r"[^a-z_]", "", m.group(1).lower())[:22]
                hits.append(f"{f.name}: possible {key} assignment - this tool has no field for that")
    if hits:
        problems += sorted(set(hits))[:10]
    if cfg.baseline_image and not cfg.baseline_path:
        problems.append(f"baseline_image points nowhere: {cfg.baseline_image}")
    if not cfg.handle:
        problems.append("no handle configured")
    if not cfg.contact.get("email"):
        problems.append("contact.email empty — notices will be unsendable")
    if not cfg.network.get("respect_robots", True):
        problems.append("respect_robots is off in config (this will get you blocked faster than "
                        "it gathers evidence)")
    print(f"pp-watchdog {__version__} credential audit")
    print(f"  config searched: {', '.join(str(p) for p in scan_targets)}")
    if problems:
        print("  findings:")
        for p in problems:
            print(f"   - {p}")
        return 1
    print("  clean: no Instagram credentials, session cookies or tokens in this install")
    return 0


def _cmd_selftest() -> int:
    from .demo import run_demo

    out = run_demo(quiet=True)
    # dumpor's fixture is a *different* picture at the same size: that is provably
    # "serving-stale" only with perceptual matching, and "serving-unidentified" without
    # Pillow. Both are correct answers; claiming stale without the evidence is not.
    expected = {
        "mollygram": {"serving-current"},
        "dumpor": {"serving-stale", "serving-unidentified"},
        "instadp": {"serving-hires"},
        "blocked-site": {"blocked-robots"},
        "gone-site": {"not-indexed"},
        "meta-only": {"profile-mirrored"},
    }
    got = out["verdicts"]
    ok = all(got.get(k) in v for k, v in expected.items())
    print("pp-watchdog selftest — scanner pipeline against local fixtures")
    print(f"  perceptual matching: {'Pillow available' if HAVE_PIL else 'OFF (no Pillow) — verdicts degrade honestly, not silently'}\n")
    for k, v in expected.items():
        mark = "ok " if got.get(k) in v else "FAIL"
        print(f"  [{mark}] {k:<14} expected {'|'.join(sorted(v)):<36} got {got.get(k)}")
    print(f"\n  notices generated: {len(out['notices'])}")
    print(f"  report: {out['report']}")
    print(f"  score: {out['score']}/100")
    print("\n  " + ("PASS — pipeline behaves as documented" if ok else
                   "FAIL — pipeline regressed; see out/demo/work/report-*.md"))
    return 0 if ok else 1


def _cmd_serve(args, cfg: Config) -> int:
    from .webui import serve

    print(f"pp-watchdog dashboard on http://{args.host}:{args.port}  "
          f"(data: {cfg.workdir}) — Ctrl-C to stop")
    print("local only; nothing is uploaded. Press Ctrl-C to stop.")
    serve(cfg, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
