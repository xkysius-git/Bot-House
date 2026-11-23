#!/usr/bin/env python3
"""Compose static previews for visual review."""
import json, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets")
atlas = json.load(open(os.path.join(A, "sprites", "atlas.json")))


def frame(name, anim, idx):
    sheet = Image.open(os.path.join(A, "sprites", f"{name}.png")).convert("RGBA")
    f = atlas[name][anim][idx % len(atlas[name][anim])]
    s = atlas[name]["frameSize"]
    return sheet.crop((f * s, 0, f * s + s, s))


def scene(mode="night", out="preview_scene.png", seated=True):
    bg = Image.open(os.path.join(A, f"room_{mode}.png")).convert("RGBA")
    fg = Image.open(os.path.join(A, f"room_{mode}_fg.png")).convert("RGBA")
    plac = [
        ("oiji", "walk", 0, (62, 240)),
        ("takuan", "idle", 0, (150, 246)),
        ("sbji", "work", 1, (400, 178)),
        ("claude", "work", 0, (448, 178)),
    ] if seated else []
    for name, anim, i, (x, y) in plac:
        fr = frame(name, anim, i)
        bg.alpha_composite(fr, (x - 15, y - 30))
    bg.alpha_composite(fg, (0, 0))
    bg.resize((bg.width * 2, bg.height * 2), Image.NEAREST).save(os.path.join(ROOT, "tools", out))


def sprites():
    names = ["oiji", "takuan", "sbji", "claude"]
    pad = 8
    cw, ch = 32 * 4, 32 * 4
    strip = Image.new("RGBA", (cw * 11, (ch + pad) * len(names)), (26, 22, 38, 255))
    for k, name in enumerate(names):
        sheet = Image.open(os.path.join(A, "sprites", f"{name}.png")).convert("RGBA")
        big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
        strip.alpha_composite(big, (0, k * (ch + pad)))
    strip.save(os.path.join(ROOT, "tools", "preview_sprites.png"))


scene("night", "preview_scene.png")
scene("day", "preview_scene_day.png")
sprites()
print("previews ok")
