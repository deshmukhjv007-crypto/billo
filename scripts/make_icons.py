#!/usr/bin/env python3
"""Generate all Billo launcher / store / PWA icons (deterministic, PIL-only).
Usage: python3 scripts/make_icons.py
Icon (v1.3 "Receipt" look) = rust tile + a paper receipt with a torn bottom edge,
a bold typewriter ₹ and two dotted "line items". No name in the icon, so a rebrand
never needs new icons. Font: IBM Plex Mono Bold (OFL), scripts/assets/.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "scripts", "assets", "plexmono-700-rupee.ttf")

ACCENT = (184, 67, 11)    # #B8430B
PAPER = (255, 253, 247)   # #FFFDF7
INK = (28, 26, 23)        # #1C1A17
RULE = (138, 129, 115)    # #8A8173
SS = 4                    # supersample for smooth edges


def receipt(size, scale):
    """Transparent layer: the receipt motif, `scale` = receipt width / icon size."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = S * scale
    h = w * 1.18
    x0, y0 = (S - w) / 2, (S - h) / 2 - S * 0.01
    x1, y1 = x0 + w, y0 + h
    d.rectangle([x0, y0, x1, y1], fill=PAPER + (255,))
    # torn (scalloped) bottom edge: bites out of the paper
    n = 6
    r = w / n / 2
    for i in range(n):
        cx = x0 + r + i * 2 * r
        d.ellipse([cx - r, y1 - r * 0.55, cx + r, y1 + r * 1.45], fill=(0, 0, 0, 0))
    # ₹
    font = ImageFont.truetype(FONT, int(w * 0.62))
    bb = d.textbbox((0, 0), "₹", font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx = (S - tw) / 2 - bb[0]
    ty = y0 + h * 0.13 - bb[1]
    d.text((tx, ty), "₹", font=font, fill=INK + (255,))
    # two dotted line items
    ly = ty + bb[1] + th + h * 0.1
    for k in range(2):
        yy = ly + k * h * 0.12
        dot = w * 0.035
        xx = x0 + w * 0.16
        while xx < x1 - w * 0.36:
            d.ellipse([xx, yy, xx + dot, yy + dot], fill=RULE + (255,))
            xx += dot * 2.2
        d.rectangle([x1 - w * 0.3, yy - dot * 0.3, x1 - w * 0.16, yy + dot * 1.3], fill=INK + (255,))
    return img.resize((size, size), Image.LANCZOS)


def tile(size, shape, scale):
    base = Image.new("RGBA", (size, size), ACCENT + (255,))
    base.alpha_composite(receipt(size, scale))
    if shape == "square":
        return base
    mask = Image.new("L", (size * SS, size * SS), 0)
    md = ImageDraw.Draw(mask)
    if shape == "rounded":
        md.rounded_rectangle([0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * 0.225), fill=255)
    else:
        md.ellipse([0, 0, size * SS - 1, size * SS - 1], fill=255)
    base.putalpha(mask.resize((size, size), Image.LANCZOS))
    return base


def out(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


A = os.path.join(ROOT, "app", "icons")
M = os.path.join(ROOT, "android", "app", "src", "main", "res")
P = os.path.join(ROOT, "playstore")

# PWA
out(os.path.join(A, "icon-192.png"), tile(192, "rounded", 0.5))
out(os.path.join(A, "icon-512.png"), tile(512, "rounded", 0.5))
out(os.path.join(A, "maskable-192.png"), tile(192, "square", 0.4))   # inside the 66% safe zone
out(os.path.join(A, "maskable-512.png"), tile(512, "square", 0.4))

# Android legacy + round
for d, s in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    out(os.path.join(M, f"mipmap-{d}", "ic_launcher.png"), tile(s, "rounded", 0.5))
    out(os.path.join(M, f"mipmap-{d}", "ic_launcher_round.png"), tile(s, "circle", 0.48))

# Adaptive foreground: opaque, full-bleed rust so it looks right whatever
# ic_launcher_background is set to; motif sized for the 66% safe zone.
out(os.path.join(M, "mipmap-xxxhdpi", "ic_launcher_foreground.png"), tile(432, "square", 0.36))

# Play Store 512 (no alpha)
out(os.path.join(P, "icon-512.png"), tile(512, "square", 0.5).convert("RGB"))
print("done")
