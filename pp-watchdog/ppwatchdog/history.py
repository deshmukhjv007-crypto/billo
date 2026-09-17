"""Local SQLite history.

The value of this tool is the *diff*, not any single scan: a mirror you already
knew about is a nuisance; a mirror that appeared the day after you changed your
picture is a signal. Nothing leaves your machine.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .scan import ScanResult

SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  started REAL NOT NULL,
  finished REAL,
  score INTEGER,
  counts TEXT,
  baseline TEXT,
  notes TEXT,
  source TEXT DEFAULT 'live'
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL,
  site_name TEXT,
  verdict TEXT,
  url TEXT,
  image_url TEXT,
  image_sha256 TEXT,
  image_w INTEGER,
  image_h INTEGER,
  match_kind TEXT,
  match_detail TEXT,
  actionable INTEGER,
  weight INTEGER,
  status INTEGER,
  payload TEXT,
  ts REAL
);
CREATE INDEX IF NOT EXISTS idx_findings_site ON findings(site_id, ts DESC);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER,
  site_id TEXT,
  kind TEXT,
  sent_on REAL,
  response TEXT,
  followup_due REAL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS checklist (
  item_id TEXT PRIMARY KEY,
  done_on REAL,
  note TEXT
);
"""


class History:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # -- writes ------------------------------------------------------------ #
    def save(self, result: ScanResult, source: str = "live") -> int:
        cur = self.conn.execute(
            "INSERT INTO scans(handle, started, finished, score, counts, baseline, notes, source) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (result.handle, result.started, result.finished, result.score,
             json.dumps(result.counts()), json.dumps(result.baseline),
             json.dumps(result.notes), source),
        )
        scan_id = int(cur.lastrowid or 0)
        for f in result.findings:
            d = f.to_dict()
            self.conn.execute(
                "INSERT INTO findings(scan_id, site_id, site_name, verdict, url, image_url, "
                "image_sha256, image_w, image_h, match_kind, match_detail, actionable, weight, "
                "status, payload, ts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (scan_id, f.site_id, f.site_name, f.verdict, f.url, f.image_url, f.image_sha256,
                 (f.image_size or [0, 0])[0], (f.image_size or [0, 0])[1], f.match_kind,
                 f.match_detail, int(f.actionable), f.weight, f.status, json.dumps(d), f.ts),
            )
        self.conn.commit()
        return scan_id

    def log_notice(self, scan_id: int | None, site_id: str, kind: str, notes: str = "") -> None:
        now = time.time()
        self.conn.execute(
            "INSERT INTO notices(scan_id, site_id, kind, sent_on, response, followup_due, notes) "
            "VALUES(?,?,?,?,?,?,?)",
            (scan_id, site_id, kind, now, "awaiting", now + 14 * 86400, notes),
        )
        self.conn.commit()

    def set_checklist(self, item_id: str, done: bool, note: str = "") -> None:
        if done:
            self.conn.execute(
                "INSERT INTO checklist(item_id, done_on, note) VALUES(?,?,?) "
                "ON CONFLICT(item_id) DO UPDATE SET done_on=excluded.done_on, note=excluded.note",
                (item_id, time.time(), note),
            )
        else:
            self.conn.execute("DELETE FROM checklist WHERE item_id=?", (item_id,))
        self.conn.commit()

    def checklist_done(self) -> set[str]:
        return {r["item_id"] for r in self.conn.execute("SELECT item_id FROM checklist")}

    # -- reads ------------------------------------------------------------- #
    def scans(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM scans ORDER BY started DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            for key in ("counts", "baseline", "notes"):
                d[key] = json.loads(d[key] or "null")
            out.append(d)
        return out

    def findings_for(self, scan_id: int) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM findings WHERE scan_id=? ORDER BY weight DESC, site_id", (scan_id,)
        ).fetchall()
        return [json.loads(r["payload"]) for r in rows]

    def notices(self) -> list[dict]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM notices ORDER BY sent_on DESC")]

    def previous_scan_id(self, before_id: int) -> int | None:
        row = self.conn.execute(
            "SELECT id FROM scans WHERE id<? ORDER BY started DESC LIMIT 1", (before_id,)
        ).fetchone()
        return int(row["id"]) if row else None

    def first_seen(self, site_id: str, verdicts: tuple[str, ...]) -> float | None:
        marks = ",".join("?" * len(verdicts))
        row = self.conn.execute(
            f"SELECT MIN(ts) AS ts FROM findings WHERE site_id=? AND verdict IN ({marks})",
            (site_id, *verdicts),
        ).fetchone()
        return float(row["ts"]) if row and row["ts"] else None

    def latest(self) -> dict | None:
        row = self.conn.execute("SELECT * FROM scans ORDER BY started DESC LIMIT 1").fetchone()
        if not row:
            return None
        scan = dict(row)
        for key in ("counts", "baseline", "notes"):
            scan[key] = json.loads(scan[key] or "null")
        scan["findings"] = self.findings_for(scan["id"])
        return scan

    # -- analysis ---------------------------------------------------------- #
    def diff(self, scan_id: int) -> dict:
        prev = self.previous_scan_id(scan_id)
        cur = {f["site_id"]: f for f in self.findings_for(scan_id)}
        out = {"new_exposure": [], "resolved": [], "escalated": [], "de_escalated": [],
               "stale_aging": [], "first_scan": prev is None}
        if prev is None:
            out["new_exposure"] = [f for f in cur.values() if f.get("actionable")]
            return out
        old = {f["site_id"]: f for f in self.findings_for(prev)}
        for sid, f in cur.items():
            before = old.get(sid)
            if f.get("actionable") and (before is None or not before.get("actionable")):
                out["new_exposure"].append(f)
            if f.get("actionable") and before and before.get("verdict") and \
               f.get("weight", 0) > before.get("weight", 0):
                out["escalated"].append({**f, "from": before.get("verdict")})
            first = self.first_seen(sid, ("serving-stale", "serving-current", "serving-hires"))
            if f.get("actionable") and first:
                days = (time.time() - first) / 86400
                if days >= 3:
                    out["stale_aging"].append({**f, "days_exposed": round(days, 1)})
        for sid, before in old.items():
            now = cur.get(sid)
            if before.get("actionable") and (now is None or not now.get("actionable")):
                out["resolved"].append(before)
        return out

    def close(self) -> None:
        self.conn.close()
