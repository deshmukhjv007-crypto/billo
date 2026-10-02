#!/usr/bin/env python3
"""Billo Play Store feature graphic — 1024x500, matches the launcher icon style."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

W, H = 1024, 500
BG_TOP = (10, 12, 34)
BG_BOT = (24, 20, 66)
MINT = (52, 211, 153)
VIOLET = (139, 124, 255)
CARD = (19, 26, 43)
DIM = (138, 148, 168)
TEXT = (242, 245, 250)

img = Image.new("RGBA", (W, H))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / (H - 1)
    c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
    d.line([(0, y), (W, y)], fill=c + (255,))


def glow(cx, cy, r, color, peak):
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    steps = 48
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = int(peak * (1 - i / steps) ** 2)
        od.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color + (a,))
    img.alpha_composite(ov)


glow(-60, -80, 540, VIOLET, 115)
glow(W + 40, H + 60, 560, MINT, 85)

# ---- logo tile (left) ----
tx, ty, ts = 72, 170, 160
d.rounded_rectangle([tx, ty, tx + ts, ty + ts], radius=40, fill=(124, 92, 255, 255))
f = ImageFont.truetype(FONT_B, 100)
ch = "₹"
bb = d.textbbox((0, 0), ch, font=f)
cw, chh = bb[2] - bb[0], bb[3] - bb[1]
d.text((tx + (ts - cw) / 2 - bb[0] + 3, ty + (ts - chh) / 2 - bb[1] + 6), ch, font=f, fill=(0, 0, 0, 90))
d.text((tx + (ts - cw) / 2 - bb[0], ty + (ts - chh) / 2 - bb[1] - 6), ch, font=f, fill=(255, 255, 255, 255))
bw, bh = 58, 11
d.rounded_rectangle([tx + (ts - bw) / 2, ty + ts * 0.815, tx + (ts - bw) / 2 + bw, ty + ts * 0.815 + bh], radius=6, fill=MINT + (255,))

# ---- wordmark + tagline ----
fw = ImageFont.truetype(FONT_B, 104)
d.text((272, 158), "billo", font=fw, fill=(255, 255, 255, 255))
wd = d.textbbox((0, 0), "billo", font=fw)
d.text((272 + (wd[2] - wd[0]), 158), ".", font=fw, fill=MINT + (255,))
ft = ImageFont.truetype(FONT_R, 32)
d.text((274, 292), "Just send the bills.", font=ft, fill=DIM + (255,))
d.text((274, 338), "We'll do the math.", font=ft, fill=DIM + (255,))

# ---- summary card mock (right) ----
cx0, cy0, cw2, ch2 = 660, 110, 320, 280
d.rounded_rectangle([cx0, cy0, cx0 + cw2, cy0 + ch2], radius=24, fill=CARD + (255,))
d.rounded_rectangle([cx0, cy0, cx0 + cw2, cy0 + ch2], radius=24, outline=(255, 255, 255, 34), width=2)
fh = ImageFont.truetype(FONT_B, 30)
fd = ImageFont.truetype(FONT_R, 21)
fm = ImageFont.truetype(FONT_B, 24)
fr = ImageFont.truetype(FONT_R, 24)
d.text((cx0 + 24, cy0 + 24), "Manali Trip", font=fh, fill=TEXT + (255,))
d.text((cx0 + 24, cy0 + 74), "₹47,280 · ₹9,456/person", font=fd, fill=DIM + (255,))
d.line([(cx0 + 24, cy0 + 122), (cx0 + cw2 - 24, cy0 + 122)], fill=(255, 255, 255, 30), width=2)
rows = [("Rahul → Jay", "₹1,820"), ("Amit → Jay", "₹940"), ("Priya → Rahul", "₹360")]
y = cy0 + 146
for name, amt in rows:
    d.text((cx0 + 24, y), name, font=fr, fill=TEXT + (230,))
    bb2 = d.textbbox((0, 0), amt, font=fm)
    d.text((cx0 + cw2 - 24 - (bb2[2] - bb2[0]), y - 1), amt, font=fm, fill=MINT + (255,))
    y += 44

out = img.convert("RGB")
path = os.path.join(ROOT, "playstore", "feature-graphic-1024x500.png")
out.save(path)
print("wrote", os.path.relpath(path, ROOT), out.size)
