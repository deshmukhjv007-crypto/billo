"""Config handling: defaults < file < env < CLI flags.

Nothing here talks to the network and nothing is uploaded anywhere. The config
file lives on your disk; there is no account, no telemetry, no update pinger.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
VALID_HINT = (
    "Instagram handles are 1-30 characters: letters, numbers, periods and "
    "underscores. No spaces, no leading/trailing period, no consecutive periods, "
    "and the @ belongs to the URL, not the handle."
)

DEFAULT_FILENAME = "pp-watchdog.json"


def validate_handle(handle: str) -> tuple[bool, str]:
    if not handle:
        return False, "empty handle"
    if handle.startswith("@"):
        return False, "drop the leading '@' - store the bare handle"
    if not HANDLE_RE.match(handle):
        return False, VALID_HINT
    if handle.startswith(".") or handle.endswith("."):
        return False, "a handle cannot start or end with a period"
    if ".." in handle:
        return False, "handles cannot contain consecutive periods"
    if "_" in handle and "." in handle and re.search(r"_[.]|[.]_", handle):
        return False, "Instagram does not allow an underscore directly beside a period"
    return True, ""


@dataclass
class Config:
    # who this install belongs to
    handle: str = ""
    display_name: str = ""

    # your evidence: the file you actually uploaded to Instagram, ideally.
    # A screenshot is fine; it just weakens exact-hash matching.
    baseline_image: str = ""

    # identity fields used only inside generated legal notices
    contact: dict = field(default_factory=lambda: {
        "name": "", "email": "", "address": "", "phone": "", "jurisdiction": "IN",
    })

    paths: dict = field(default_factory=lambda: {
        "workdir": ".pp-watchdog",
    })

    network: dict = field(default_factory=lambda: {
        "respect_robots": True,
        "min_interval_seconds": 5.0,
        "max_requests_per_scan": 60,
        "timeout_seconds": 12.0,
        "extract_images_per_site": 3,
    })

    scan: dict = field(default_factory=lambda: {
        "stale_grace_days": 3,          # how long after a PP change you allow caches to refresh
        "takedown_after_stale_days": 5, # then start sending notices
        "disabled": [],                 # site ids to skip
        "extra_sites": [],              # your own additions: {id,name,base,profile_urls,contact_paths}
    })

    cadence_days: int = 14
    registry_file: str = ""
    source: str = ""  # which file this was loaded from, for audit + display
    notes: str = ""

    # ---------------------------------------------------------------- #
    @property
    def workdir(self) -> Path:
        return Path(self.paths.get("workdir", ".pp-watchdog")).expanduser()

    @property
    def db_path(self) -> Path:
        return self.workdir / "history.sqlite3"

    @property
    def evidence_dir(self) -> Path:
        return self.workdir / "evidence"

    @property
    def notices_dir(self) -> Path:
        return self.workdir / "notices"

    @property
    def baseline_path(self) -> Path | None:
        if not self.baseline_image:
            return None
        p = Path(self.baseline_image).expanduser()
        return p if p.exists() else None

    def ensure_dirs(self) -> None:
        for d in (self.workdir, self.evidence_dir, self.notices_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- #
    @classmethod
    def load(cls, path: str | os.PathLike | None = None) -> "Config":
        candidates = []
        if path:
            candidates.append(Path(path).expanduser())
        else:
            env = os.environ.get("PP_WATCHDOG_CONFIG")
            if env:
                candidates.append(Path(env).expanduser())
            cwd = Path.cwd() / DEFAULT_FILENAME
            candidates.append(cwd)
            candidates.append(Path.home() / ".config" / "pp-watchdog" / DEFAULT_FILENAME)
        for cand in candidates:
            if cand.exists():
                raw = json.loads(cand.read_text(encoding="utf-8"))
                cfg = cls.from_dict(raw)
                cfg.source = str(cand)
                return cfg
        return cls()

    @classmethod
    def from_dict(cls, raw: dict) -> "Config":
        known = set(asdict(cls()).keys())
        kwargs = {}
        for k, v in raw.items():
            if k not in known:
                continue
            kwargs[k] = v
        cfg = cls(**kwargs)
        # merge nested dicts so partial files keep defaults
        base = cls()
        for name in ("contact", "paths", "network", "scan"):
            merged = dict(getattr(base, name))
            merged.update(kwargs.get(name) or {})
            setattr(cfg, name, merged)
        return cfg

    def save(self, path: str | os.PathLike) -> Path:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return p

    def redacted_contact(self) -> dict:
        c = dict(self.contact)
        for key in ("email", "phone", "address"):
            if c.get(key):
                c[key] = c[key]
            else:
                c[key] = f"<MISSING: fill contact.{key} before sending notices>"
        return c
