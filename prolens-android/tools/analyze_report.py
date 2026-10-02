#!/usr/bin/env python3
"""Summarise a Prolens test report (the .txt shared from Settings -> Test mode).

    python3 tools/analyze_report.py prolens_test_report_XXXX.txt
"""
import json
import sys
from collections import Counter, defaultdict


def load(path):
    events = []
    session = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            if line.startswith("# file"):
                session += 1
                continue
            if line.startswith("#"):
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            e["session"] = session
            events.append(e)
    return events


def main(path):
    ev = load(path)
    if not ev:
        print("No events found.")
        return
    by_type = Counter(e["type"] for e in ev)
    print("== Overview")
    for s in sorted({e["session"] for e in ev}):
        start = next((e["d"] for e in ev if e["session"] == s and e["type"] == "session_start"), {})
        dur = max(e["t"] for e in ev if e["session"] == s) / 1000
        print(f"session {s}: {start.get('device')} · Android {start.get('android')} · app {start.get('app')} · {dur:.0f} s")
    print("events:", dict(by_type))

    for e in ev:
        if e["type"] == "camera_ready":
            d = e["d"]
            print(f"\n== Camera ({'front' if d.get('front') else 'back'}): {d.get('summary')}")
            print(f"   EV {d.get('ev')} step {d.get('evStep')} · ISO {d.get('iso')} · manual {d.get('manual')} · "
                  f"zoom {d.get('zoom')} · night {d.get('night')} · hdr {d.get('hdr')} · flash {d.get('flash')}")

    frames = [e for e in ev if e["type"] == "frame"]
    if frames:
        fps = [f["d"].get("fps") for f in frames if f["d"].get("fps")]
        print(f"\n== Live frames: {len(frames)} snapshots, analysis rate median "
              f"{sorted(fps)[len(fps)//2] if fps else '?'} fps")
        scenes = Counter(f["d"].get("scene") for f in frames)
        tips = Counter((f["d"].get("coach") or {}).get("tip") for f in frames)
        print("   scenes:", dict(scenes))
        print("   cues:", dict(tips))
        flips = sum(1 for a, b in zip(frames, frames[1:]) if a["d"].get("scene") != b["d"].get("scene"))
        print(f"   scene changes between snapshots: {flips}")

    print("\n== Guided tests")
    starts = {}
    for e in ev:
        if e["type"] == "step_start":
            starts[(e["session"], e["d"]["step"])] = e["t"]
        if e["type"] == "step_result":
            d = e["d"]
            key = (e["session"], d["step"])
            window = [f["d"] for f in frames if f["session"] == e["session"] and starts.get(key, 0) <= f["t"] <= e["t"]]
            sc = Counter(w.get("scene") for w in window).most_common(2)
            cues = Counter((w.get("coach") or {}).get("tip") for w in window).most_common(3)
            ready = sum(1 for w in window if (w.get("coach") or {}).get("ready")) / max(1, len(window))
            fails = Counter(x for w in window for x in (w.get("seller") or {}).get("fails", []))
            evs = [((w.get("cam") or {}).get("ev"), (w.get("plan") or {}).get("mode")) for w in window]
            print(f"{d['n']:>2}. {d['step']:<12} {d['verdict'].upper():<5} {('note: ' + d['note']) if d.get('note') else ''}")
            print(f"     {len(window)} frames · scenes {sc} · cues {cues} · ready {ready:.0%}"
                  + (f" · seller fails {dict(fails)}" if fails else "")
                  + (f" · EV/mode last {evs[-1]}" if evs else ""))

    for t in ("review", "listing_made", "listing_failed", "paywall", "photo_failed", "camera_error", "review_failed", "crash"):
        items = [e for e in ev if e["type"] == t]
        if items:
            print(f"\n== {t} ({len(items)})")
            for e in items[:10]:
                print("  ", json.dumps(e["d"], ensure_ascii=False)[:400])
    shots = [e for e in ev if e["type"] == "photo_saved"]
    if shots:
        ms = sorted(e["d"]["ms"] for e in shots)
        print(f"\n== Shutter to saved: median {ms[len(ms)//2]} ms, max {ms[-1]} ms over {len(ms)} photos")


if __name__ == "__main__":
    main(sys.argv[1])
