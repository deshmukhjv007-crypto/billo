"""The scan: for each registry site, ask "do you have my picture, and which one?"

Verdicts, worst first:
  serving-hires     they expose a bigger copy than Instagram itself displays
  serving-stale     they have an old profile picture you already replaced
  serving-current   they have your live picture (cached, unauthorised copy)
  profile-mirrored  your bio/name/post metadata is mirrored, image not found
  blocked-robots    they refuse crawlers; needs a manual browser check
  refused           403/429/451 - hostile or legally blocked
  login-wall        they want credentials; never comply with that
  moved             301 to another domain (brand churn; follow it once, manually)
  not-indexed       good news: nothing cached for you
  unreachable / error
Every verdict carries evidence: URL, HTTP status, timestamps, and a copy of the
text snippet that justified it, so a takedown notice is never a bare claim.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from . import extract, imaging
from .config import Config
from .net import fetch
from .policy import Policy
from .registry import Site

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

VERDICT_WEIGHT = {
    "serving-hires": 34,
    "serving-stale": 26,
    "serving-current": 14,
    "serving-unidentified": 18,
    "profile-mirrored": 8,
    "login-wall": 5,
    "refused": 4,
    "blocked-robots": 3,
    "moved": 3,
    "unreachable": 1,
    "error": 1,
    "empty-response": 1,
    "not-indexed": 0,
}
ACTIONABLE = {"serving-hires", "serving-stale", "serving-current", "serving-unidentified",
             "profile-mirrored"}


@dataclass
class Finding:
    site_id: str
    site_name: str
    base: str
    url: str
    verdict: str
    page_state: str
    status: int = 0
    latency_ms: int = 0
    image_url: str = ""
    image_sha256: str = ""
    image_size: list[int] = field(default_factory=list)
    match_kind: str = ""
    match_detail: str = ""
    meta_markers: list[str] = field(default_factory=list)
    evidence_snippet: str = ""
    abuse_contacts: list[str] = field(default_factory=list)
    notes: str = ""
    ts: float = field(default_factory=time.time)

    @property
    def weight(self) -> int:
        return VERDICT_WEIGHT.get(self.verdict, 0)

    @property
    def actionable(self) -> bool:
        return self.verdict in ACTIONABLE

    def to_dict(self) -> dict:
        d = asdict(self)
        d["actionable"] = self.actionable
        d["weight"] = self.weight
        return d


@dataclass
class ScanResult:
    handle: str
    started: float
    finished: float = 0.0
    findings: list[Finding] = field(default_factory=list)
    baseline: dict = field(default_factory=dict)
    policy_log: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def score(self) -> int:
        return min(100, sum(f.weight for f in self.findings))

    @property
    def actionable(self) -> list[Finding]:
        return sorted([f for f in self.findings if f.actionable], key=lambda f: -f.weight)

    def counts(self) -> dict:
        out: dict[str, int] = {}
        for f in self.findings:
            out[f.verdict] = out.get(f.verdict, 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    def to_json(self) -> str:
        return json.dumps(
            {
                "handle": self.handle,
                "started": self.started,
                "finished": self.finished,
                "score": self.score,
                "baseline": self.baseline,
                "counts": self.counts(),
                "notes": self.notes,
                "policy": {"requests": len(self.policy_log), "log": self.policy_log},
                "findings": [f.to_dict() for f in self.findings],
            },
            indent=2,
        )


def load_baseline(cfg: Config) -> tuple[imaging.Fingerprint | None, list[str]]:
    notes: list[str] = []
    path = cfg.baseline_path
    if path is None:
        notes.append(
            "no baseline image configured - verdicts like 'stale' vs 'current' "
            "need `baseline_image` in pp-watchdog.json (see README step 2)"
        )
        return None, notes
    data = path.read_bytes()
    fp = imaging.fingerprint(data)
    if not fp.has_image:
        notes.append(f"baseline {path.name} could not be decoded as an image: {fp.error}")
        return None, notes
    return fp, notes


def run_scan(cfg: Config, sites: list[Site], *, policy: Policy | None = None,
             offline_dir: Path | None = None) -> ScanResult:
    policy = policy or Policy(
        min_interval=cfg.network.get("min_interval_seconds", 5.0),
        max_requests=cfg.network.get("max_requests_per_scan", 60),
        timeout=cfg.network.get("timeout_seconds", 12.0),
        respect_robots=cfg.network.get("respect_robots", True),
    )
    baseline, notes = load_baseline(cfg)
    result = ScanResult(handle=cfg.handle, started=time.time(), baseline=(
        {"path": str(cfg.baseline_path), **baseline.to_dict()} if baseline else {}), notes=notes)
    if offline_dir:
        result.notes.append(f"offline mode: reading captured pages from {offline_dir}")

    for site in sites:
        if not site.usable and not offline_dir:
            result.findings.append(Finding(
                site_id=site.id, site_name=site.name, base="", url="",
                verdict="unverified", page_state="no-base-domain",
                notes="registry entry has no confirmed domain; `pp-watchdog registry add "
                      f"{site.id} https://the-live-domain`",
            ))
            continue
        finding = _probe_site(cfg, site, policy, baseline, result, offline_dir)
        result.findings.append(finding)

    result.finished = time.time()
    result.policy_log = list(policy.log)
    if policy.requests_used >= policy.max_requests:
        result.notes.append(
            f"request budget ({policy.max_requests}) hit mid-scan; later sites were not probed. "
            "Raise network.max_requests_per_scan or use --only."
        )
    return result


def _probe_site(cfg: Config, site: Site, policy: Policy, baseline, result: ScanResult,
                offline_dir: Path | None) -> Finding:
    urls = site.urls_for(cfg.handle)
    candidates: list[extract.ImageCandidate] = []
    page_state = "empty"
    tried: list[str] = []
    status = 0
    latency = 0
    snippet = ""
    last_url = urls[0] if urls else ""

    for url in urls[:2]:  # never cascade more than two paths per site
        last_url = url
        tried.append(url)
        if offline_dir:
            resp = _offline_response(offline_dir, site, url, cfg.handle)
            if resp is None:
                return Finding(site_id=site.id, site_name=site.name, base=site.base, url=url,
                               verdict="no-fixture", page_state="offline",
                               notes=f"no captured page for {site.id} in {offline_dir}")
        else:
            allowed, why = policy.gate(url)
            if not allowed:
                verdict = "blocked-robots" if "robots" in why else "skipped"
                return Finding(site_id=site.id, site_name=site.name, base=site.base, url=url,
                               verdict=verdict, page_state="gated", notes=why)
            resp = fetch(url, ua=policy.user_agent, timeout=policy.timeout)
            policy.note(url, resp.status, resp.error)

        page = resp.text()
        status, latency = resp.status, resp.elapsed_ms
        page_state = extract.page_state(page, status, resp.error, resp.location)
        if resp.redirected:
            snippet = f"Location: {resp.location}"
            return Finding(site_id=site.id, site_name=site.name, base=site.base, url=url,
                           verdict="moved", page_state=page_state, status=status,
                           latency_ms=latency, evidence_snippet=snippet[:400],
                           notes=f"redirect target: {resp.location}")
        if page_state == "not-indexed":
            continue  # maybe the second path template works
        candidates = extract.extract_images(page, limit=cfg.network.get("extract_images_per_site", 3))
        snippet = (candidates[0].context if candidates else page[:280]).strip()
        break

    if page_state == "not-indexed":
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="not-indexed", page_state=page_state, status=status,
                       latency_ms=latency, notes="no cached copy found for this handle")
    if page_state in ("unreachable", "error"):
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="unreachable" if status == 0 else "error", page_state=page_state,
                       status=status, latency_ms=latency, evidence_snippet=snippet[:400])
    if page_state == "refused":
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="refused", page_state=page_state, status=status, latency_ms=latency)
    if page_state == "login-wall":
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="login-wall", page_state=page_state, status=status, latency_ms=latency,
                       notes="this service wants credentials; pp-watchdog will never supply them")

    contacts = _discover_contacts(cfg, site, policy, offline_dir) if not offline_dir else []

    if not candidates:
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="profile-mirrored", page_state=page_state, status=status,
                       latency_ms=latency, evidence_snippet=snippet[:400],
                       abuse_contacts=contacts,
                       notes="page served your profile, but no image URL was extractable from "
                             "the markup - verify in a browser before asserting it in a notice")

    best = candidates[0]
    img = _fetch_image(cfg, best.url, policy, offline_dir)
    if img is None:
        return Finding(site_id=site.id, site_name=site.name, base=site.base, url=tried[-1],
                       verdict="profile-mirrored", page_state=page_state, status=status,
                       latency_ms=latency, image_url=best.url, evidence_snippet=best.context[:400],
                       abuse_contacts=contacts, notes="image URL present but not retrievable")
    cmp = imaging.compare(baseline, img)
    if cmp.kind == "exact" or cmp.kind == "same-photo":
        verdict = "serving-hires" if cmp.bigger else "serving-current"
    elif cmp.kind == "different-photo":
        verdict = "serving-hires" if cmp.bigger else "serving-stale"
    else:  # unidentifiable
        verdict = "serving-hires" if cmp.bigger else "serving-unidentified"
    return Finding(
        site_id=site.id, site_name=site.name, base=site.base, url=tried[-1], verdict=verdict,
        page_state=page_state, status=status, latency_ms=latency, image_url=best.url,
        image_sha256=img.sha256, image_size=[img.width, img.height], match_kind=cmp.kind,
        match_detail=cmp.detail, meta_markers=img.meta_markers,
        evidence_snippet=best.context[:400], abuse_contacts=contacts,
        notes=f"found via '{best.how}'" + (" · looks like a direct Instagram CDN URL" if best.ig_cdn else ""),
    )


def _bigger(a: imaging.Fingerprint, b: imaging.Fingerprint | None) -> bool:
    if b is None or not b.has_image or not a.has_image:
        return False
    return (a.width * a.height) > (b.width * b.height)


def _fetch_image(cfg: Config, url: str, policy: Policy, offline_dir: Path | None):
    host = urlparse(url).netloc.lower()
    if offline_dir:
        cand = offline_dir / "images" / f"{host}{urlparse(url).path}".replace("/", "_")
        if cand.exists():
            return imaging.fingerprint(cand.read_bytes())
        return None
    allowed, _ = policy.gate(url)
    if not allowed:
        return None
    resp = fetch(url, ua=policy.user_agent, timeout=policy.timeout, max_bytes=8_000_000)
    policy.note(url, resp.status, resp.error)
    if not resp.ok:
        return None
    return imaging.fingerprint(resp.body)


def _discover_contacts(cfg: Config, site: Site, policy: Policy, offline_dir: Path | None) -> list[str]:
    """Harvest abuse/copyright contacts from the operator's own pages."""
    found: list[str] = []
    for url in site.contact_urls()[:1]:
        allowed, _ = policy.gate(url)
        if not allowed:
            continue
        resp = fetch(url, ua=policy.user_agent, timeout=policy.timeout, max_bytes=300_000)
        policy.note(url, resp.status, resp.error)
        if not resp.ok:
            continue
        for m in EMAIL_RE.finditer(resp.text(200_000)):
            mail = m.group(0).lower()
            if any(bad in mail for bad in ("example.", "sentry", "wixpress", "@2x", ".png", ".jpg")):
                continue
            if mail not in found:
                found.append(mail)
        if len(found) >= 3:
            break
    return found


def _offline_response(offline_dir: Path, site: Site, url: str, handle: str):
    from .net import Response

    for cand in (
        offline_dir / f"{site.id}.html",
        offline_dir / f"{site.id}.json",
        offline_dir / f"{site.id}-{handle}.html",
    ):
        if cand.exists():
            return Response(url=url, status=200, body=cand.read_bytes(),
                            headers={"content-type": "text/html"})
    return None
