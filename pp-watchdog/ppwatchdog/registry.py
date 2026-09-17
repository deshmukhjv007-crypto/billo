"""Registry loader: shipped defaults + user overrides, merged."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_REGISTRY = Path(__file__).parent / "data" / "registry.json"


@dataclass
class Site:
    id: str
    name: str
    base: str = ""
    profile_urls: list[str] = field(default_factory=lambda: ["/profile/{username}", "/{username}"])
    contact_paths: list[str] = field(default_factory=lambda: ["/contact", "/dmca"])
    confirmed: bool = False
    status_2026_08: str = ""
    risk: str = "medium"
    notes: str = ""
    kind: str = "mirror"  # mirror | search
    origin: str = "default"

    @property
    def usable(self) -> bool:
        return bool(self.base)

    def urls_for(self, username: str) -> list[str]:
        out = []
        for tmpl in self.profile_urls:
            path = tmpl.format(username=username)
            if tmpl.startswith(("http://", "https://")):
                out.append(tmpl.format(username=username))
            else:
                out.append(self.base.rstrip("/") + path)
        return out

    def contact_urls(self) -> list[str]:
        return [self.base.rstrip("/") + p for p in self.contact_paths] if self.base else []

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "base": self.base, "risk": self.risk,
            "confirmed": self.confirmed, "kind": self.kind, "origin": self.origin,
            "status_2026_08": self.status_2026_08, "notes": self.notes,
            "profile_urls": self.profile_urls, "contact_paths": self.contact_paths,
        }


def load_registry(user_path: str | None = None, extras: list[dict] | None = None,
                  disabled: list[str] | None = None) -> list[Site]:
    raw = json.loads(_strip_comments(Path(user_path).expanduser().read_text(encoding="utf-8"))) \
        if user_path and Path(user_path).expanduser().exists() else \
        json.loads(_strip_comments(DEFAULT_REGISTRY.read_text(encoding="utf-8")))
    sites: list[Site] = []
    for entry in raw.get("sites", []):
        sites.append(Site(**entry, origin="default"))
    by_id = {s.id: s for s in sites}
    for entry in (extras or []):
        data = {k: v for k, v in entry.items() if k in Site.__dataclass_fields__}
        sid = data.get("id") or f"custom-{len(by_id) + 1}"
        data["id"] = sid
        data["origin"] = "user"
        if sid in by_id:  # user entry overrides a default wholesale
            sites = [s for s in sites if s.id != sid]
            sites.append(Site(**data))
        else:
            sites.append(Site(**data))
            by_id[sid] = None
    skip = set(disabled or [])
    return [s for s in sites if s.id not in skip]


def site_index(sites: list[Site]) -> dict[str, Site]:
    return {s.id: s for s in sites}


def write_user_registry(path: Path, sites: list[Site]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema": 1, "sites": [s.to_dict() for s in sites]}
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _strip_comments(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
