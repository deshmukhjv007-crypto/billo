"""Human-facing rendering: Markdown/terminal reports and the manual-search links."""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import quote

from .registry import Site
from .scan import ScanResult

VERDICT_LABEL = {
    "serving-hires": "SERVING A LARGER COPY THAN INSTAGRAM SHOWS",
    "serving-stale": "SERVING AN OLD PICTURE OF YOU",
    "serving-current": "SERVING YOUR CURRENT PICTURE",
    "serving-unidentified": "SERVING A COPY THAT CANNOT BE IDENTIFIED (verify by eye)",
    "profile-mirrored": "PROFILE MIRRORED (image not independently retrieved)",
    "login-wall": "WANTS YOUR LOGIN — DO NOT COMPLY",
    "refused": "REFUSED OUR REQUEST",
    "blocked-robots": "BLOCKS CRAWLERS — CHECK BY HAND",
    "moved": "MOVED / REBRANDED",
    "not-indexed": "no cached copy found",
    "unreachable": "unreachable",
    "error": "error",
    "skipped": "skipped by policy",
    "unverified": "not verifiable by this tool",
    "no-fixture": "no offline fixture",
    "empty-response": "empty response",
}
BAD_FIRST = ["serving-hires", "serving-stale", "serving-current", "serving-unidentified",
             "profile-mirrored",
             "login-wall", "refused", "blocked-robots", "moved", "unverified", "error",
             "unreachable", "skipped"]


def _bar(score: int) -> str:
    filled = round(score / 10)
    return "[" + "#" * filled + "." * (10 - filled) + f"] {score}/100"


def summary_lines(result: ScanResult, diff: dict | None) -> list[str]:
    lines = [
        f"@{result.handle} — exposure scan {time.strftime('%Y-%m-%d %H:%M', time.localtime(result.started))}",
        f"score {_bar(result.score)}   sites checked: {len(result.findings)}   "
        f"requests sent: {len(result.policy_log)}",
        "",
    ]
    counts = result.counts()
    lines.append("  verdicts: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    if result.actionable:
        lines.append("")
        lines.append("  ACTIONABLE:")
        for f in result.actionable:
            size = f"{f.image_size[0]}x{f.image_size[1]}" if f.image_size and any(f.image_size) else "n/a"
            lines.append(
                f"    {VERDICT_LABEL.get(f.verdict, f.verdict):<58} {f.site_name:<26} {size}"
            )
    else:
        lines.append("")
        lines.append("  No mirror produced evidence of serving your picture on this run.")
    if diff and not diff.get("first_scan"):
        bits = []
        for key, label in (("new_exposure", "new exposures"), ("escalated", "escalated"),
                           ("resolved", "resolved"), ("stale_aging", "aged >3d")):
            n = len(diff.get(key, []))
            if n:
                bits.append(f"{n} {label}")
        lines.append("")
        lines.append("  since last scan: " + (", ".join(bits) if bits else "no change"))
    for n in result.notes:
        lines.append(f"  note: {n}")
    return lines


def markdown(result: ScanResult, diff: dict | None, cfg, sites: list[Site]) -> str:
    L = [f"# Profile picture exposure report — `@{result.handle}`", ""]
    L.append(f"- scanned: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(result.started))}")
    L.append(f"- sites in registry: {len(sites)} · probed: {len(result.findings)} · "
             f"HTTP requests: {len(result.policy_log)}")
    L.append(f"- exposure score: `{result.score}/100`")
    if result.baseline:
        b = result.baseline
        L.append(f"- baseline image: `{b.get('path')}` · {b.get('width')}x{b.get('height')} px · "
                 f"sha256 `{(b.get('sha256') or '')[:16]}…`")
    else:
        L.append("- baseline image: **not set** — set `baseline_image` to enable stale/current matching")
    L.append("")
    L.append("## What this tool cannot tell you")
    L.append("")
    L.append(
        "No row below, and no tool that exists, can name a person who opened your profile or "
        "your profile picture. Instagram exposes no viewer data to users or to the Graph API, "
        "profile-picture views/zooms/screenshots are not logged for you, and the only capture "
        "the platform ever reports is a screenshot of a View-Once or Vanish-mode DM. Anything "
        "claiming otherwise is fabricating names from your follower list and fishing for your "
        "password. Treat such an offer as an attack, not a feature.")
    L.append("")
    L.append("## Findings")
    L.append("")
    L.append("| verdict | site | image seen | dims | match | evidence |")
    L.append("|---|---|---|---|---|---|")
    ordered = sorted(result.findings, key=lambda f: (
        BAD_FIRST.index(f.verdict) if f.verdict in BAD_FIRST else 99, f.site_name))
    for f in ordered:
        dims = f"{f.image_size[0]}x{f.image_size[1]}" if f.image_size and any(f.image_size) else "—"
        ev = f"`{f.url}`" if f.url else "—"
        L.append(f"| **{VERDICT_LABEL.get(f.verdict, f.verdict)}** | {f.site_name} | "
                 f"{f.image_url or '—'} | {dims} | {f.match_kind or '—'} | {ev} |")
    L.append("")

    if result.actionable:
        L.append("## Takedown targets")
        L.append("")
        for f in result.actionable:
            L.append(f"### {f.site_name}")
            L.append(f"- page: {f.url}")
            if f.image_url:
                L.append(f"- copy: {f.image_url}")
            if f.image_sha256:
                L.append(f"- served file sha256: `{f.image_sha256}`")
            if f.match_detail:
                L.append(f"- why it matters: {f.match_detail}")
            if f.meta_markers:
                L.append(f"- ⚠️ the mirrored file still carries: {', '.join(f.meta_markers)}")
            L.append(f"- abuse addresses harvested this run: "
                     + (", ".join(f"<{c}>" for c in f.abuse_contacts) if f.abuse_contacts
                        else "none — check their footer / whois before sending"))
            if f.notes:
                L.append(f"- scanner note: {f.notes}")
            if f.evidence_snippet:
                L.append(f"- captured markup: `{f.evidence_snippet[:300]}`")
            L.append("")
        L.append("Generate the notices with `pp-watchdog takedown` (writes to "
                 f"`{cfg.notices_dir}`).")
    else:
        L.append("## Takedown targets\n\nNone this run.")

    if diff and not diff.get("first_scan"):
        L.append("")
        L.append("## Change since previous scan")
        for key, label in (("new_exposure", "Newly exposed"), ("escalated", "Escalated"),
                           ("resolved", "Now clear"), ("stale_aging", "Still up after 3+ days")):
            items = diff.get(key) or []
            if not items:
                continue
            L.append(f"### {label} ({len(items)})")
            for it in items:
                extra = ""
                if key == "escalated":
                    extra = f" (was `{it.get('from')}`)"
                if key == "stale_aging":
                    extra = f" (up {it.get('days_exposed')}d)"
                L.append(f"- {it.get('site_name')}: `{it.get('verdict')}`{extra}")
    L.append("")
    L.append("## Registry coverage warning")
    unverified = [s for s in sites if not s.confirmed]
    L.append(f"{len(unverified)} of {len(sites)} registry entries carry unverified domains or "
             "conflicting 2026 status reports (" +
             (", ".join(s.name for s in unverified) if unverified else "none") +
             "). A `not-indexed` verdict on one of those means 'the page we guessed did not show "
             "your image', not 'nobody has your image'. These services re-brand every few months; "
             "run `pp-watchdog registry list` and prune.")
    L.append("")
    L.append("## Manual searches (this tool will not script these for you)")
    for label, url in manual_links(result.handle):
        L.append(f"- [{label}]({url})")
    L.append("")
    L.append("---")
    L.append(f"evidence dir: `{cfg.evidence_dir}` · history: `{cfg.db_path}` · "
             "everything local; no Instagram credentials used or needed")
    return "\n".join(L) + "\n"


def manual_links(handle: str) -> list[tuple[str, str]]:
    h = quote(handle)
    return [
        ("Google Images — your handle + profile photo", f"https://www.google.com/search?tbm=isch&q=%22{h}%22+instagram+profile+photo"),
        ("Google — mirror sites indexing you", f"https://www.google.com/search?q=%22{h}%22+instagram+(viewer+OR+download+OR+stories)"),
        ("Bing Images", f"https://www.bing.com/images/search?q=instagram+profile+{h}"),
        ("reverse image search (upload your own file to verify your face is not elsewhere)", "https://lens.google.com/uploadbyurl"),
        ("Yandex Images — strongest face matching of the free engines", "https://yandex.com/images/"),
        ("Instagram: manage authorised apps", "https://www.instagram.com/accounts/manage_access/"),
        ("Instagram: report IP infringement", "https://help.instagram.com/contact/278619070935757"),
        ("Instagram: report a counterfeit account", "https://help.instagram.com/contact/636276399721841"),
        ("India cyber-crime portal", "https://cybercrime.gov.in"),
        ("Domain abuse lookup for whichever site you complain to", "https://lookup.icann.org/"),
    ]


def write_reports(result: ScanResult, diff: dict | None, cfg, sites: list[Site]) -> list[Path]:
    cfg.ensure_dirs()
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(result.started))
    md = cfg.workdir / f"report-{stamp}.md"
    md.write_text(markdown(result, diff, cfg, sites), encoding="utf-8")
    (cfg.workdir / f"scan-{stamp}.json").write_text(result.to_json(), encoding="utf-8")
    # keep a 'latest' pointer for the web UI and for scripts
    (cfg.workdir / "latest-report.md").write_text(md.read_text(encoding="utf-8"), encoding="utf-8")
    (cfg.workdir / "latest-scan.json").write_text(result.to_json(), encoding="utf-8")
    evidence = cfg.evidence_dir / stamp
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "policy-log.json").write_text(json.dumps(result.policy_log, indent=2), encoding="utf-8")
    for f in result.findings:
        if f.actionable:
            (evidence / f"{f.site_id}.json").write_text(json.dumps(f.to_dict(), indent=2), encoding="utf-8")
    return [md, evidence]
