"""Hardening checklist: the part of privacy defence that is not a scanner."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

from .history import History

CHECKLIST = Path(__file__).parent / "data" / "checklist.json"
SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass
class Item:
    id: str
    title: str
    why: str
    how: list[str]
    severity: str = "medium"
    automatable: bool = False
    tool: str = ""
    done: bool = False
    done_on: float | None = None


def load_items() -> list[Item]:
    raw = json.loads(CHECKLIST.read_text(encoding="utf-8"))
    return [Item(**entry) for entry in raw]


def with_state(items: list[Item], history: History) -> list[Item]:
    done = history.checklist_done()
    for it in items:
        if it.id in done:
            it.done = True
    return items


def score(items: list[Item]) -> tuple[int, dict]:
    """Weighted posture score: unaddressed criticals cost far more than tidy wins."""
    weight = {"critical": 30, "high": 18, "medium": 8, "low": 3}
    total = sum(weight.get(i.severity, 5) for i in items)
    done = sum(weight.get(i.severity, 5) for i in items if i.done)
    open_criticals = [i.title for i in items if not i.done and i.severity == "critical"]
    return round(100 * done / total) if total else 100, {
        "total_weight": total, "earned": done, "open_criticals": open_criticals,
    }


def render(items: list[Item], handle: str) -> str:
    pct, meta = score(items)
    L = [f"# Hardening posture — @{handle}", ""]
    L.append(f"`{pct}/100` · {sum(1 for i in items if i.done)}/{len(items)} items confirmed")
    if meta["open_criticals"]:
        L.append("")
        L.append("**Unresolved criticals:**")
        for t in meta["open_criticals"]:
            L.append(f"- {t}")
    L.append("")
    for it in sorted(items, key=lambda i: (i.done, SEV_RANK.get(i.severity, 9), i.title)):
        mark = "x" if it.done else " "
        L.append(f"- [{mark}] **{it.title}** _(severity {it.severity})_")
        L.append(f"      why: {it.why}")
        L.append("      do:")
        for step in it.how:
            L.append(f"        - {step}")
        if it.tool:
            L.append(f"      tool: `pp-watchdog {it.tool}`")
        L.append(f"      mark done: `pp-watchdog checklist done {it.id}`")
    L.append("")
    L.append("Score notes: this is posture, not safety. Nothing here proves nobody looked at your "
             "profile — nothing can. It measures how much of your picture and account surface is "
             "still easy to reach.")
    return "\n".join(L) + "\n"


def toggle(history: History, item_id: str, done: bool, note: str = "") -> None:
    ids = {i.id for i in load_items()}
    if item_id not in ids:
        raise SystemExit(f"unknown checklist item '{item_id}'. Known: {', '.join(sorted(ids))}")
    history.set_checklist(item_id, done, note or time.strftime("toggled %Y-%m-%d"))
