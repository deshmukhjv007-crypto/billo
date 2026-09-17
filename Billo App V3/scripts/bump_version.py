#!/usr/bin/env python3
"""Bump the Billo version everywhere in one shot.
Usage: python3 scripts/bump_version.py 1.2.0
Updates: app/index.html (APP.version), app/sw.js (cache V),
         android/app/build.gradle (versionName) and prints a summary.
Then: git add -A && git commit -m "v1.2.0: ..." && git tag v1.2.0
"""
import re
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch(path, pattern, replacement, label):
    p = os.path.join(ROOT, path)
    with open(p, encoding="utf-8") as f:
        src = f.read()
    new, n = re.subn(pattern, replacement, src, count=1)
    if n != 1:
        print(f"  ✗ {label}: pattern not found in {path}")
        return False
    with open(p, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"  ✓ {label} → {os.path.basename(path)}")
    return True


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        print("usage: python3 scripts/bump_version.py X.Y.Z")
        sys.exit(1)
    v = sys.argv[1]
    print(f"Bumping Billo to v{v}")
    ok = True
    ok &= patch("app/index.html", r"(version: ')[0-9]+\.[0-9]+\.[0-9]+'", rf"\g<1>{v}'", "app version")
    ok &= patch("app/sw.js", r"(const V = 'billo-)[0-9]+\.[0-9]+\.[0-9](')", rf"\g<1>{v}\g<2>", "service worker cache")
    ok &= patch("android/app/build.gradle", r'(versionName ")[0-9]+\.[0-9]+\.[0-9](")', rf"\g<1>{v}\g<2>", "android versionName")
    if not ok:
        sys.exit(1)
    print("Done. Now add an entry to CHANGELOG.md, then:")
    print(f'  git add -A && git commit -m "v{v}: ..." && git tag v{v}')


if __name__ == "__main__":
    main()
