#!/usr/bin/env python3
"""캐릭터 4종 미리보기 시트 (개발 확인용)."""
import os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprites import build

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview_chars_v5.png")

PALS = {
    "oiji": dict(
        tones=["#5CDE83", "#2EC25B", "#17913F"], line="#0C6B2E", eye="#241a2e", spec="#C8F7D6"),
    "takuan": dict(
        tones=["#F7EDD6", "#EFE1C5", "#D9C5A2"], line="#C0A782", eye="#241a2e",
        rim="#E0CFAE", plate="#F8EFDC", blush="#F2A7AE", spec="#FFFFFF"),
    "sbji": dict(
        eye="#241a2e",
        purple=dict(tones=["#9C6BF0", "#7C3FE3", "#5B24B4"], line="#46188C",
                    spec="#C9A8FF", spec_at=((16, 9),)),
        pink=dict(tones=["#FF63BD", "#F32AA0", "#C10C7A"], line="#990761",
                  spec="#FFC0E4", spec_at=((8, 15),)),
        orange=dict(tones=["#FFB067", "#FF8F3A", "#E3670F"], line="#B94E06",
                    spec="#FFD3A6", spec_at=((17, 23),)),
    ),
    "clawd": dict(
        tones=["#E99072", "#D77757", "#B45940"], line="#7C3B27", eye="#241318", spec="#F3B49C"),
}

if __name__ == "__main__":
    frames = [0, 3, 7, 10]
    scale = 8
    pad = 8
    w = len(frames) * (32 * scale + pad) + pad
    h = len(PALS) * (32 * scale + pad) + pad
    sheet = Image.new("RGB", (w, h), (34, 30, 48))
    for row, (kind, pal) in enumerate(PALS.items()):
        sprite = build(kind, pal)
        for col, f in enumerate(frames):
            fr = sprite.crop((f * 32, 0, f * 32 + 32, 32)).resize((32 * scale, 32 * scale), Image.NEAREST)
            x = pad + col * (32 * scale + pad)
            y = pad + row * (32 * scale + pad)
            sheet.paste(fr, (x, y), fr)
    sheet.save(OUT)
    print(OUT, sheet.size)
