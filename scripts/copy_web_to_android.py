#!/usr/bin/env python3
"""Copy the web app (app/) into the Android shell's assets (android/app/src/main/assets/www/).
Run after every change to app/ — including pasting your Firebase config into app/sync/config.js —
and before building the APK/AAB:  python3 scripts/copy_web_to_android.py"""
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "app")
DST = os.path.join(ROOT, "android", "app", "src", "main", "assets", "www")
SKIP = {".DS_Store"}

n = 0
for base, dirs, files in os.walk(SRC):
    rel = os.path.relpath(base, SRC)
    os.makedirs(os.path.join(DST, rel), exist_ok=True)
    for f in files:
        if f in SKIP or f.endswith(".bak"):
            continue
        shutil.copy2(os.path.join(base, f), os.path.join(DST, rel, f))
        n += 1
print(f"copied {n} files → {os.path.relpath(DST, ROOT)}")
