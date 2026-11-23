#!/usr/bin/env python3
"""캐릭터 4종 미리보기 시트 (개발 확인용)."""
import os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprites import build
from gen_art import CHARS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview_chars_v5.png")

if __name__ == "__main__":
    frames = [0, 3, 7, 10]
    scale = 8
    pad = 8
    w = len(frames) * (32 * scale + pad) + pad
    h = len(CHARS) * (32 * scale + pad) + pad
    sheet = Image.new("RGB", (w, h), (34, 30, 48))
    for row, (name, cfg) in enumerate(CHARS.items()):
        sprite = build(cfg["kind"], cfg["pal"])
        for col, f in enumerate(frames):
            fr = sprite.crop((f * 32, 0, f * 32 + 32, 32)).resize((32 * scale, 32 * scale), Image.NEAREST)
            x = pad + col * (32 * scale + pad)
            y = pad + row * (32 * scale + pad)
            sheet.paste(fr, (x, y), fr)
    sheet.save(OUT)
    print(OUT, sheet.size)
