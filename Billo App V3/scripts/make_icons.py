#!/usr/bin/env python3
"""Generate all Billo launcher / store / PWA icons (deterministic, PIL-only).
Usage: python3 scripts/make_icons.py
Icon = deep-indigo gradient tile + radial glows + bold ₹ + mint underline bar.
No text in the icon (besides ₹), so rebranding the name never needs new icons.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
if not os.path.exists(FONT):
    FONT = None

TOP = (25, 21, 71)        # #191547
BOTTOM = (10, 12, 34)     # #0A0C22
MINT = (52, 211, 153)
VIOLET = (139, 124, 255)
BG_FLAT = (20, 16, 58)    # #14103A adaptive background


def vgrad(size):
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        c = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    return img


def glow(img, cx, cy, r, color, peak):
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    steps = 48
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = int(peak * (1 - i / steps) ** 2)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color + (a,))
    img.alpha_composite(ov)


def motif(img, size, rupee_frac, bar=True):
    """Draw ₹ (+ mint bar) centered on `img` (an RGBA layer of `size`px)."""
    d = ImageDraw.Draw(img)
    px = int(size * rupee_frac)
    font = ImageFont.truetype(FONT, px) if FONT else ImageFont.load_default()
    ch = "₹"
    bb = d.textbbox((0, 0), ch, font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    x = (size - w) // 2 - bb[0] - int(size * 0.015)
    y = (size - h) // 2 - bb[1] - int(size * 0.03)
    d.text((x + int(size * 0.014), y + int(size * 0.022)), ch, font=font, fill=(0, 0, 0, 100))
    d.text((x, y), ch, font=font, fill=(255, 255, 255, 255))
    if bar:
        bw, bh = size * 0.30, size * 0.042
        bx, by = (size - bw) / 2, y + h + int(size * 0.055)
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh / 2, fill=MINT + (255,))


def rounded(size, radius, bg):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=bg + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    return img


def full_square(size):
    return Image.new("RGBA", (size, size), BG_FLAT + (255,))


def circle(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, size - 1, size - 1], fill=BG_FLAT + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    img.putalpha(mask)
    return img


def out(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


def build(size, path, kind):
    """kind: legacy (rounded) | round (circle) | maskable (full bleed, smaller motif)
       | foreground (transparent, motif only) | store (solid square)"""
    if kind == "legacy":
        g = vgrad(size)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255)
        out_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out_img.paste(g, (0, 0), mask)
        out_img.putalpha(mask)
        g2 = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow(out_img, size * 0.95, size * 0.97, size * 0.72, MINT, 70)
        glow(out_img, size * 0.05, size * 0.03, size * 0.62, VIOLET, 85)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        motif(layer, size, 0.56)
        out_img = Image.composite(out_img, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)
        out_img.alpha_composite(layer)
        out(path, out_img)
    elif kind == "round":
        g = vgrad(size)
        base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        base.paste(g, (0, 0), mask)
        base.putalpha(mask)
        glow(base, size * 0.95, size * 0.97, size * 0.72, MINT, 70)
        glow(base, size * 0.05, size * 0.03, size * 0.62, VIOLET, 85)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        motif(layer, size, 0.52)
        base.alpha_composite(layer)
        out(path, base)
    elif kind == "maskable":
        g = vgrad(size)
        glow(g, size * 0.95, size * 0.97, size * 0.72, MINT, 70)
        glow(g, size * 0.05, size * 0.03, size * 0.62, VIOLET, 85)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        motif(layer, size, 0.44)  # stays inside the 66% safe zone
        g.alpha_composite(layer)
        out(path, g)
    elif kind == "foreground":
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow(layer, size * 0.95, size * 0.97, size * 0.72, MINT, 70)
        glow(layer, size * 0.05, size * 0.03, size * 0.62, VIOLET, 85)
        m = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        motif(m, size, 0.50)
        layer.alpha_composite(m)
        out(path, layer)
    elif kind == "store":
        g = vgrad(size)
        g = g.convert("RGBA")
        glow(g, size * 0.95, size * 0.97, size * 0.72, MINT, 70)
        glow(g, size * 0.05, size * 0.03, size * 0.62, VIOLET, 85)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        motif(layer, size, 0.56)
        g.alpha_composite(layer)
        out(path, g)


A = os.path.join(ROOT, "app", "icons")
M = os.path.join(ROOT, "android", "app", "src", "main", "res")
P = os.path.join(ROOT, "playstore")

# PWA
build(192, os.path.join(A, "icon-192.png"), "legacy")
build(512, os.path.join(A, "icon-512.png"), "legacy")
build(192, os.path.join(A, "maskable-192.png"), "maskable")
build(512, os.path.join(A, "maskable-512.png"), "maskable")

# Android legacy + round
for d, s in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    build(s, os.path.join(M, f"mipmap-{d}", "ic_launcher.png"), "legacy")
    build(s, os.path.join(M, f"mipmap-{d}", "ic_launcher_round.png"), "round")

# Adaptive foreground (432px, content in safe zone)
build(432, os.path.join(M, "mipmap-xxxhdpi", "ic_launcher_foreground.png"), "foreground")

# Play Store 512 (no alpha)
build(512, os.path.join(P, "icon-512.png"), "store")
print("done")
