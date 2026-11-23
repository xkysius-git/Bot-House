#!/usr/bin/env python3
"""Bot House pixel art generator (deterministic).

Outputs
  assets/room_<mode>.png      background layer (wall, floor, decor, monitors)
  assets/room_<mode>_fg.png   foreground layer (desk bodies) drawn over characters
  assets/sprites/<bot>.png    horizontal sprite sheet, 32x32 frames
  assets/sprites/atlas.json   animation frame indices
  assets/icon.png             app icon
"""
import json, os
from PIL import Image, ImageDraw

W, H = 480, 270
S = 32
FLOOR = 152
ZONE = 242
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(os.path.join(OUT, "sprites"), exist_ok=True)

PAL = {
    "night": dict(
        wall="#332b47", wall_lo="#2c2439", wall_hi="#3b3253", wall_line="#292138",
        molding="#241d34", skirt="#1e1830",
        floor="#4d3d37", floor2="#57453e", seam="#3b2e29", seam_hi="#63504a",
        tile="#3a3648", tile2="#413d52", tile_line="#2e2b3b",
        wood="#7d5741", wood_hi="#96694e", wood_dk="#5c4030", wood_dk2="#47301f",
        rug="#6b4152", rug2="#7e4f60", rug_edge="#4a2c3a",
        sofa="#3e6b66", sofa_hi="#4f847d", sofa_dk="#2d504c",
        plant="#4e8a5c", plant_hi="#6cb27a", plant_dk="#376b44",
        pot="#8a5a44", pot_hi="#a76f54",
        metal="#5c6076", metal_hi="#7b8099", metal_dk="#3b3f52",
        screen="#161329", screen_hi="#221e38",
        glow="#54d8c6", glow2="#9bf4e6",
        accent="#ff7a59", accent_dk="#c2563d", accent_hi="#ffa287",
        sky="#121a34", sky2="#1d2a4d", star="#e8eeff", moon="#f7eeca",
        lamp="#ffd18a", lamp_hi="#ffe9c2", lamp_dk="#c9974f",
        paper="#ece5d4", paper_dk="#cbc2ac",
        shadow="#221c33",
    ),
    "day": dict(
        wall="#d8ccbd", wall_lo="#cdc0b1", wall_hi="#e3d8cb", wall_line="#c2b4a4",
        molding="#b6a795", skirt="#a1907d",
        floor="#b07e52", floor2="#bb8a5c", seam="#93603c", seam_hi="#c99a6b",
        tile="#ddd5c9", tile2="#e7e0d5", tile_line="#c6bcae",
        wood="#b57e55", wood_hi="#cd946a", wood_dk="#8c5d3c", wood_dk2="#6f4930",
        rug="#cf8b93", rug2="#dda0a7", rug_edge="#ab6b74",
        sofa="#5f8f87", sofa_hi="#79aba2", sofa_dk="#49726b",
        plant="#69a86f", plant_hi="#8bca90", plant_dk="#4d8a56",
        pot="#b47c5a", pot_hi="#c9946e",
        metal="#8f93a6", metal_hi="#adb1c2", metal_dk="#6b6f83",
        screen="#2b2a44", screen_hi="#3b3960",
        glow="#2fbfae", glow2="#6fe0d2",
        accent="#e0663f", accent_dk="#b34c2c", accent_hi="#f08a66",
        sky="#8ec9e8", sky2="#bde0f2", star="#ffffff", moon="#fff6d8",
        lamp="#ffe3b0", lamp_hi="#fff4dc", lamp_dk="#d8b273",
        paper="#fbf6e9", paper_dk="#ddd5c4",
        shadow="#9a8e7e",
    ),
}


def rect(d, x0, y0, x1, y1, c):
    if x1 >= x0 and y1 >= y0:
        d.rectangle([x0, y0, x1, y1], fill=c)


def vgrad(d, x0, y0, x1, y1, c0, c1):
    h = max(1, y1 - y0)
    for y in range(y0, y1 + 1):
        t = (y - y0) / h
        c = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
        rect(d, x0, y, x1, y, c)


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def shade(d, x0, y0, x1, y1, base, hi=None, dk=None):
    rect(d, x0, y0, x1, y1, base)
    if hi:
        rect(d, x0, y0, x1, y0, hi)
        rect(d, x0, y0, x0, y1, hi)
    if dk:
        rect(d, x0, y1, x1, y1, dk)
        rect(d, x1, y0, x1, y1, dk)


# ------------------------------------------------------------------ room bg
def draw_bg(p, mode):
    img = Image.new("RGB", (W, H), p["wall"])
    d = ImageDraw.Draw(img)

    # wall
    vgrad(d, 0, 0, W - 1, FLOOR - 26, hx(p["wall_lo"]), hx(p["wall_hi"]))
    for x in range(0, W, 24):
        rect(d, x, 0, x, FLOOR - 27, p["wall_line"])
    rect(d, 0, 0, W - 1, 5, p["molding"])
    rect(d, 0, 6, W - 1, 6, p["wall_hi"])
    # wainscot
    rect(d, 0, FLOOR - 26, W - 1, FLOOR - 5, p["wall_lo"])
    rect(d, 0, FLOOR - 26, W - 1, FLOOR - 25, p["molding"])
    for x in range(6, W, 18):
        rect(d, x, FLOOR - 24, x, FLOOR - 7, p["wall_line"])
    # skirting
    rect(d, 0, FLOOR - 5, W - 1, FLOOR - 1, p["skirt"])
    rect(d, 0, FLOOR - 5, W - 1, FLOOR - 5, p["molding"])

    # floor: wood (living) / tile (work)
    for y in range(FLOOR, H):
        rect(d, 0, y, ZONE - 1, y, p["floor"] if y < 214 else p["floor2"])
    rows = list(range(FLOOR, H, 9))
    for i, y in enumerate(rows):
        rect(d, 0, y, ZONE - 1, y, p["seam"])
        rect(d, 0, y + 1, ZONE - 1, y + 1, p["seam_hi"])
        for x in range((i % 2) * 17, ZONE, 34):
            rect(d, x, y + 1, x, min(H - 1, y + 8), p["seam"])
    for y in range(FLOOR, H, 12):
        for x in range(ZONE, W, 24):
            off = 12 if (y // 12) % 2 else 0
            col = p["tile"] if ((x // 24) + (y // 12)) % 2 == 0 else p["tile2"]
            rect(d, x + off, y, min(W - 1, x + off + 23), min(H - 1, y + 11), col)
    for y in range(FLOOR, H, 12):
        rect(d, ZONE, y, W - 1, y, p["tile_line"])
    for x in range(ZONE, W, 24):
        rect(d, x, FLOOR, x, H - 1, p["tile_line"])
    # transition strip
    rect(d, ZONE - 3, FLOOR, ZONE - 1, H - 1, p["wood_dk2"])
    rect(d, ZONE, FLOOR, ZONE + 1, H - 1, p["shadow"])

    # ---------- living room
    # window
    wx0, wy0, wx1, wy1 = 30, 20, 106, 96
    rect(d, wx0 - 5, wy0 - 5, wx1 + 5, wy1 + 6, p["wood_dk"])
    rect(d, wx0 - 3, wy0 - 3, wx1 + 3, wy1 + 4, p["wood"])
    rect(d, wx0 - 3, wy0 - 3, wx1 + 3, wy0 - 2, p["wood_hi"])
    vgrad(d, wx0, wy0, wx1, wy1, hx(p["sky"]), hx(p["sky2"]))
    if mode == "night":
        for (sx, sy) in [(40, 30), (52, 40), (68, 28), (86, 34), (96, 48), (44, 56), (60, 62),
                         (78, 58), (92, 70), (50, 78), (72, 84), (98, 86)]:
            d.point((sx, sy), fill=p["star"])
        d.ellipse([wx0 + 42, wy0 + 10, wx0 + 62, wy0 + 30], fill=p["moon"])
        d.ellipse([wx0 + 47, wy0 + 10, wx0 + 67, wy0 + 30], fill=p["sky2"])
        # far rooftops
        for (rx, rw, rh) in [(wx0 + 4, 18, 10), (wx0 + 24, 14, 14), (wx0 + 42, 20, 8)]:
            rect(d, rx, wy1 - rh, rx + rw, wy1, p["molding"])
            for k in range(rx + 3, rx + rw, 5):
                rect(d, k, wy1 - rh + 3, k + 1, wy1 - rh + 4, p["lamp"])
    else:
        d.ellipse([wx0 + 8, wy0 + 16, wx0 + 30, wy0 + 28], fill="#ffffff")
        d.ellipse([wx0 + 18, wy0 + 12, wx0 + 38, wy0 + 26], fill="#ffffff")
        d.ellipse([wx0 + 54, wy0 + 40, wx0 + 78, wy0 + 52], fill="#eef7fd")
        rect(d, wx0, wy1 - 16, wx1, wy1, p["plant"])
        rect(d, wx0, wy1 - 18, wx1, wy1 - 16, p["plant_hi"])
    # mullions
    rect(d, (wx0 + wx1) // 2, wy0, (wx0 + wx1) // 2 + 1, wy1, p["wood"])
    rect(d, wx0, (wy0 + wy1) // 2, wx1, (wy0 + wy1) // 2 + 1, p["wood"])
    # sill
    rect(d, wx0 - 8, wy1 + 5, wx1 + 8, wy1 + 9, p["wood_hi"])
    rect(d, wx0 - 8, wy1 + 8, wx1 + 8, wy1 + 9, p["wood_dk"])
    # curtain rod + curtains
    rect(d, wx0 - 12, wy0 - 10, wx1 + 12, wy0 - 8, p["metal_dk"])
    for (cx, flip) in [(wx0 - 12, 1), (wx1 + 4, -1)]:
        rect(d, cx, wy0 - 8, cx + 8, wy1 + 4, p["accent_dk"])
        rect(d, cx + 1, wy0 - 8, cx + 3, wy1 + 4, p["accent"])
        rect(d, cx + 5, wy0 - 8, cx + 6, wy1 + 2, p["accent_dk"])

    # picture frames
    fx, fy = 122, 34
    rect(d, fx - 2, fy - 2, fx + 30, fy + 26, p["wood_dk"])
    rect(d, fx - 1, fy - 1, fx + 29, fy + 25, p["paper_dk"])
    rect(d, fx, fy, fx + 28, fy + 24, p["paper"])
    d.polygon([(fx + 1, fy + 19), (fx + 10, fy + 7), (fx + 18, fy + 19)], fill=p["metal_dk"])
    d.polygon([(fx + 12, fy + 19), (fx + 20, fy + 10), (fx + 27, fy + 19)], fill=p["plant"])
    d.ellipse([fx + 5, fy + 4, fx + 11, fy + 10], fill=p["lamp"])
    rect(d, fx + 1, fy + 19, fx + 27, fy + 23, p["plant_dk"])

    # wall shelf with books + plant
    sx0, sy0 = 160, 44
    for row in (0, 14):
        rect(d, sx0, sy0 + row, sx0 + 68, sy0 + row + 2, p["wood_dk"])
        rect(d, sx0, sy0 + row, sx0 + 68, sy0 + row, p["wood_hi"])
        for i, bx in enumerate(range(sx0 + 4, sx0 + 56, 6)):
            hh = 8 + ((i * 7) % 6)
            col = [p["accent"], p["glow"], p["lamp"], p["plant"], p["metal_hi"], p["paper_dk"]][i % 6]
            rect(d, bx, sy0 + row - hh, bx + 4, sy0 + row - 1, col)
            rect(d, bx, sy0 + row - hh, bx + 4, sy0 + row - hh, p["paper"])
    rect(d, sx0 + 58, sy0 + 4, sx0 + 66, sy0 + 13, p["pot"])
    d.ellipse([sx0 + 55, sy0 - 4, sx0 + 69, sy0 + 7], fill=p["plant"])
    d.ellipse([sx0 + 57, sy0 - 2, sx0 + 65, sy0 + 4], fill=p["plant_hi"])

    # sofa
    fx0 = 18
    sy = FLOOR
    rect(d, fx0 - 5, sy + 8, fx0 + 97, sy + 46, p["sofa_dk"])          # outer
    rect(d, fx0 - 3, sy + 4, fx0 + 95, sy + 34, p["sofa"])             # back
    rect(d, fx0 - 3, sy + 4, fx0 + 95, sy + 6, p["sofa_hi"])
    for cx in range(fx0 + 2, fx0 + 92, 30):                            # back cushions
        rect(d, cx, sy + 8, cx + 27, sy + 26, p["sofa_hi"])
        rect(d, cx, sy + 25, cx + 27, sy + 26, p["sofa_dk"])
    rect(d, fx0 - 3, sy + 27, fx0 + 95, sy + 40, p["sofa"])            # seat
    rect(d, fx0 - 3, sy + 27, fx0 + 95, sy + 28, p["sofa_dk"])
    rect(d, fx0 - 7, sy + 10, fx0 - 1, sy + 44, p["sofa"])             # arms
    rect(d, fx0 + 89, sy + 10, fx0 + 101, sy + 44, p["sofa"])
    rect(d, fx0 - 7, sy + 10, fx0 - 1, sy + 11, p["sofa_hi"])
    rect(d, fx0 + 89, sy + 10, fx0 + 101, sy + 11, p["sofa_hi"])
    for lx in (fx0 + 4, fx0 + 84):                                     # legs
        rect(d, lx, sy + 45, lx + 3, sy + 50, p["wood_dk2"])
    rect(d, fx0 + 8, sy + 12, fx0 + 24, sy + 24, p["accent"])          # cushions
    rect(d, fx0 + 8, sy + 12, fx0 + 24, sy + 13, p["accent_hi"])
    rect(d, fx0 + 66, sy + 14, fx0 + 80, sy + 27, p["rug2"])
    rect(d, fx0 + 66, sy + 14, fx0 + 80, sy + 15, p["paper_dk"])

    # rug
    rx0, ry0, rx1, ry1 = 8, 196, 216, 264
    d.ellipse([rx0, ry0, rx1, ry1], fill=p["rug_edge"])
    d.ellipse([rx0 + 3, ry0 + 3, rx1 - 3, ry1 - 3], fill=p["rug"])
    d.ellipse([rx0 + 10, ry0 + 8, rx1 - 10, ry1 - 6], fill=p["rug2"])
    d.ellipse([rx0 + 16, ry0 + 12, rx1 - 16, ry1 - 10], fill=p["rug"])
    for x in range(rx0 + 26, rx1 - 24, 16):
        d.point((x, ry0 + 16), fill=p["rug_edge"])
        d.point((x + 8, ry1 - 12), fill=p["rug_edge"])

    # coffee table
    tx, ty = 118, 206
    rect(d, tx, ty, tx + 62, ty + 6, p["wood"])
    rect(d, tx, ty, tx + 62, ty, p["wood_hi"])
    rect(d, tx + 1, ty + 7, tx + 61, ty + 9, p["wood_dk"])
    for lx in (tx + 4, tx + 55):
        rect(d, lx, ty + 10, lx + 3, ty + 22, p["wood_dk2"])

    # mug + book on table
    rect(d, tx + 7, ty - 5, tx + 12, ty - 1, p["paper"])
    rect(d, tx + 13, ty - 4, tx + 15, ty - 2, p["paper_dk"])
    rect(d, tx + 30, ty - 3, tx + 48, ty - 1, p["accent"])
    rect(d, tx + 30, ty - 4, tx + 48, ty - 4, p["paper"])

    # floor lamp
    lx = 8
    rect(d, lx, 112, lx + 2, 200, p["metal_dk"])
    rect(d, lx - 7, 200, lx + 9, 204, p["metal_dk"])
    d.polygon([(lx - 11, 114), (lx + 13, 114), (lx + 9, 96), (lx - 7, 96)], fill=p["lamp_dk"])
    d.polygon([(lx - 10, 113), (lx + 12, 113), (lx + 8, 98), (lx - 6, 98)], fill=p["lamp"])
    d.polygon([(lx - 10, 113), (lx + 12, 113), (lx - 6, 108), (lx, 108)], fill=p["lamp_hi"])

    # plant between zones
    plx, ply = 196, FLOOR - 6
    rect(d, plx, ply + 22, plx + 24, ply + 46, p["pot"])
    rect(d, plx, ply + 22, plx + 24, ply + 24, p["pot_hi"])
    rect(d, plx - 2, ply + 21, plx + 26, ply + 23, p["wood_dk2"])
    for (ox, oy, rw, rh) in [(6, 8, 16, 12), (16, 2, 16, 14), (11, 14, 14, 10), (2, 16, 12, 10)]:
        d.ellipse([plx + ox - rw // 2, ply + oy - rh, plx + ox + rw // 2, ply + oy], fill=p["plant"])
    for (ox, oy, rw, rh) in [(7, 8, 9, 7), (16, 4, 9, 8), (12, 14, 7, 6)]:
        d.ellipse([plx + ox - rw // 2, ply + oy - rh, plx + ox + rw // 2, ply + oy], fill=p["plant_hi"])
    rect(d, plx + 11, ply + 4, plx + 12, ply + 22, p["plant_dk"])

    # partition post + hanging plant
    px_, py_ = ZONE - 8, 96
    rect(d, px_, py_, px_ + 5, FLOOR - 2, p["wood_dk"])
    rect(d, px_, py_, px_ + 1, FLOOR - 2, p["wood_hi"])
    rect(d, px_ - 3, py_ + 16, px_ + 9, py_ + 19, p["wood_dk2"])
    rect(d, px_ - 3, FLOOR - 5, px_ + 9, FLOOR - 2, p["wood_dk2"])

    # ---------- work zone
    # pegboard / notes
    pgx, pgy = 258, 28
    rect(d, pgx, pgy, pgx + 70, pgy + 58, p["wood_dk2"])
    rect(d, pgx + 2, pgy + 2, pgx + 68, pgy + 56, p["wall_line"])
    notes = [(8, 8, p["paper"]), (26, 6, p["accent"]), (46, 10, p["glow2"]), (12, 30, p["lamp"]),
             (34, 34, p["paper_dk"]), (52, 30, p["paper"])]
    for i, (nx, ny, nc) in enumerate(notes):
        rect(d, pgx + nx, pgy + ny, pgx + nx + 14, pgy + ny + 12, nc)
        for k in range(3):
            rect(d, pgx + nx + 2, pgy + ny + 3 + k * 3, pgx + nx + 11, pgy + ny + 3 + k * 3, p["metal_dk"])

    # neon "BOT HOUSE" sign
    sgx, sgy = 380, 46
    rect(d, sgx - 4, sgy - 4, sgx + 30, sgy + 16, p["molding"])
    for i, ch in enumerate("WORK"):
        draw_tiny_letter(d, sgx + 2 + i * 6, sgy + 3, ch, p["glow"])
    rect(d, sgx - 4, sgy + 16, sgx + 30, sgy + 17, p["accent_dk"])

    # clock
    clx, cly = 300, 96
    d.ellipse([clx, cly, clx + 16, cly + 16], fill=p["metal_dk"])
    d.ellipse([clx + 1, cly + 1, clx + 15, cly + 15], fill=p["paper"])
    rect(d, clx + 8, cly + 4, clx + 8, cly + 8, p["metal_dk"])
    rect(d, clx + 8, cly + 8, clx + 12, cly + 8, p["accent"])

    # server rack (wall mounted, right end)
    rkx, rky = 432, 30
    rect(d, rkx - 2, rky - 2, rkx + 36, rky + 74, p["metal_dk"])
    rect(d, rkx, rky, rkx + 34, rky + 72, p["metal"])
    for i in range(5):
        yy = rky + 5 + i * 14
        rect(d, rkx + 3, yy, rkx + 31, yy + 11, p["metal_dk"])
        rect(d, rkx + 3, yy, rkx + 31, yy, p["metal_hi"])
        for j in range(4):
            d.point((rkx + 6 + j * 4, yy + 7), fill=p["glow"] if (i + j) % 3 else p["accent"])
        rect(d, rkx + 24, yy + 4, rkx + 29, yy + 5, p["metal_hi"])

    # hanging lamps over desks
    for hx_ in (288, 356, 424):
        rect(d, hx_, 0, hx_ + 1, 104, p["metal_dk"])
        d.polygon([(hx_ - 9, 116), (hx_ + 10, 116), (hx_ + 5, 104), (hx_ - 4, 104)], fill=p["lamp_dk"])
        d.polygon([(hx_ - 8, 115), (hx_ + 9, 115), (hx_ + 4, 105), (hx_ - 3, 105)], fill=p["lamp"])
        d.polygon([(hx_ - 8, 115), (hx_ + 9, 115), (hx_ - 3, 110), (hx_ + 4, 110)], fill=p["lamp_hi"])

    # monitors on the desk (bases hidden by desk front in fg layer)
    def monitor(x, mw, mh, color, base=171):
        y = base - mh
        rect(d, x - 1, y - 1, x + mw, y + mh, p["metal_dk"])
        rect(d, x, y, x + mw - 1, y + mh - 1, p["screen"])
        for i in range(4):
            w_ = mw - 8 - (i % 3) * 4
            c = color if i % 2 == 0 else p["metal"]
            rect(d, x + 3, y + 4 + i * 4, x + 3 + w_, y + 4 + i * 4, c)
        rect(d, x + mw // 2 - 2, y + mh, x + mw // 2 + 2, y + mh + 2, p["metal_dk"])

    monitor(250, 32, 24, p["glow"])
    monitor(286, 18, 16, p["accent"])
    monitor(310, 38, 26, p["glow"])
    monitor(352, 20, 16, p["lamp"])
    monitor(378, 28, 24, p["glow"])
    monitor(410, 26, 20, p["accent"])
    monitor(444, 22, 28, p["glow2"], base=171)

    # claude terminal (tall, on desk right end)
    ctx = 396
    # keyboard + papers on desk surface handled in fg

    # floor mat under the desks
    rect(d, 246, 200, 470, 226, p["shadow"])
    rect(d, 249, 201, 467, 224, p["tile2"])
    rect(d, 249, 201, 467, 201, p["tile_line"])
    for x in range(252, 466, 10):
        d.point((x, 202), fill=p["tile_line"])
        d.point((x + 4, 223), fill=p["tile_line"])

    # floor props in the work zone
    # cable tray / shadow under desk
    rect(d, 250, 198, 468, 202, p["shadow"])
    # waste bin
    rect(d, 246, 214, 258, 232, p["metal_dk"])
    rect(d, 247, 214, 257, 215, p["metal_hi"])
    # cardboard box + spare monitor leaning
    rect(d, 452, 216, 470, 236, p["wood_dk2"])
    rect(d, 452, 216, 470, 217, p["wood_dk"])
    rect(d, 460, 216, 461, 236, p["wood_dk"])
    # a small floor plant in the corner
    rect(d, 236, 240, 246, 252, p["pot"])
    d.ellipse([231, 226, 251, 244], fill=p["plant"])
    d.ellipse([233, 228, 243, 238], fill=p["plant_hi"])

    # light pools
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    if mode == "night":
        for hx_ in (288, 356, 424):
            for i in range(4):
                a = 9 - i * 2
                gd.ellipse([hx_ - 26 - i * 5, 118 + i * 5, hx_ + 27 + i * 5, 140 + i * 5],
                           fill=(255, 209, 138, a))
        gd.ellipse([6, 96, 30, 124], fill=(255, 209, 138, 26))
        # window moon beam
        gd.polygon([(30, 100), (106, 100), (150, 210), (0, 210)], fill=(180, 200, 255, 12))
    else:
        gd.polygon([(30, 100), (106, 100), (160, 220), (-10, 220)], fill=(255, 246, 214, 26))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    return img


# ------------------------------------------------------------------ room fg
def draw_fg(p, mode):
    fg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    # desk: surface band + front panel
    dx0, dx1 = 248, 470
    top, bot = 172, 196
    rect(d, dx0 - 2, top - 2, dx1 + 2, top + 6, (0, 0, 0, 0))
    # surface
    rect(d, dx0, top, dx1, top + 7, p["wood"])
    rect(d, dx0, top, dx1, top, p["wood_hi"])
    rect(d, dx0, top + 6, dx1, top + 7, p["wood_hi"])
    # front
    rect(d, dx0, top + 8, dx1, bot, p["wood_dk"])
    rect(d, dx0, top + 8, dx1, top + 9, p["wood"])
    for x in range(dx0 + 4, dx1, 22):
        rect(d, x, top + 10, x, bot - 3, p["wood_dk2"])
    for (name, sx) in (("oiji", 268), ("takuan", 334), ("sbji", 400), ("claude", 448)):
        rect(d, sx - 18, top + 13, sx + 18, bot - 4, p["wood_dk2"])
        rect(d, sx - 18, top + 13, sx + 18, top + 14, p["wood"])
        rect(d, sx - 18, bot - 4, sx + 18, bot - 4, p["wood_dk2"])
        rect(d, sx - 5, top + 18, sx + 5, top + 19, p["metal_hi"])
    # desk edge shadow
    rect(d, dx0, bot, dx1, bot + 1, p["shadow"])
    # legs
    for lx in (dx0 + 3, dx1 - 6):
        rect(d, lx, bot, lx + 3, 210, p["wood_dk2"])
    # desk mats + name plates per seat
    seats = [("oiji", 268, p["plant"]), ("takuan", 336, p["paper_dk"]),
             ("sbji", 400, p["accent"]), ("claude", 448, p["accent_hi"])]
    for (name, sx, col) in seats:
        rect(d, sx - 16, top + 1, sx + 16, top + 4, col)
        rect(d, sx - 16, top + 1, sx + 16, top + 1, p["paper"])
        rect(d, sx - 16, top + 4, sx + 16, top + 4, p["shadow"])
    # keyboard halves peeking above the desk edge
    for sx in (268, 336, 400, 448):
        rect(d, sx - 10, top - 6, sx + 10, top - 2, p["metal_dk"])
        rect(d, sx - 10, top - 6, sx + 10, top - 6, p["metal_hi"])
    # mug + notes
    rect(d, dx0 + 150, top - 6, dx0 + 156, top - 1, p["paper"])
    rect(d, dx0 + 157, top - 5, dx0 + 159, top - 3, p["paper_dk"])
    rect(d, dx0 + 190, top - 4, dx0 + 206, top - 1, p["paper"])

    # stool in front of each desk (drawn under characters' feet line)
    for sx in (268, 336, 400, 448):
        pass
    return fg


def draw_tiny_letter(d, x, y, ch, color):
    F = {
        "W": ["10001", "10001", "10001", "10101", "10101", "01010"],
        "O": ["01110", "10001", "10001", "10001", "10001", "01110"],
        "R": ["11110", "10001", "10001", "11110", "10100", "10010"],
        "K": ["10001", "10010", "10100", "11000", "10100", "10010"],
    }[ch]
    for j, row in enumerate(F):
        for i, c in enumerate(row):
            if c == "1":
                d.point((x + i, y + j), fill=color)


def draw_text5(d, x, y, text, color):
    FONT = {
        "A": ["01110", "10001", "11111", "10001", "10001"],
        "B": ["11110", "10001", "11110", "10001", "11110"],
        "C": ["01111", "10000", "10000", "10000", "01111"],
        "D": ["11110", "10001", "10001", "10001", "11110"],
        "E": ["11111", "10000", "11110", "10000", "11111"],
        "F": ["11111", "10000", "11110", "10000", "10000"],
        "G": ["01111", "10000", "10011", "10001", "01110"],
        "H": ["10001", "10001", "11111", "10001", "10001"],
        "I": ["111", "010", "010", "010", "111"],
        "J": ["00111", "00010", "00010", "10010", "01100"],
        "K": ["10001", "10010", "11100", "10010", "10001"],
        "L": ["10000", "10000", "10000", "10000", "11111"],
        "M": ["10001", "11011", "10101", "10001", "10001"],
        "N": ["10001", "11001", "10101", "10011", "10001"],
        "O": ["01110", "10001", "10001", "10001", "01110"],
        "P": ["11110", "10001", "11110", "10000", "10000"],
        "Q": ["01110", "10001", "10101", "10010", "01101"],
        "R": ["11110", "10001", "11110", "10010", "10001"],
        "S": ["01111", "10000", "01110", "00001", "11110"],
        "T": ["11111", "00100", "00100", "00100", "00100"],
        "U": ["10001", "10001", "10001", "10001", "01110"],
        "V": ["10001", "10001", "10001", "01010", "00100"],
        "W": ["10001", "10001", "10101", "11011", "10001"],
        "X": ["10001", "01010", "00100", "01010", "10001"],
        "Y": ["10001", "01010", "00100", "00100", "00100"],
        "Z": ["11111", "00010", "00100", "01000", "11111"],
        " ": ["000", "000", "000", "000", "000"],
    }
    cx = x
    for ch in text:
        rows = FONT.get(ch, FONT[" "])
        for j, row in enumerate(rows):
            for i, c in enumerate(row):
                if c == "1":
                    d.point((cx + i, y + j), fill=color)
        cx += len(rows[0]) + 1


# ------------------------------------------------------------------ sprites
from sprites import build as build_sprite

# 원본 레퍼런스: docs/characters/*.jpg (2026-11-23 장현 님 제공)
CHARS = {
    "oiji": dict(kind="oiji", pal=dict(
        tones=["#5CDE83", "#2EC25B", "#17913F"], line="#0C6B2E", eye="#241a2e", spec="#C8F7D6")),
    "takuan": dict(kind="takuan", pal=dict(
        tones=["#F7EDD6", "#EFE1C5", "#D9C5A2"], line="#C0A782", eye="#241a2e",
        rim="#E0CFAE", plate="#F8EFDC", blush="#F2A7AE", spec="#FFFFFF")),
    "sbji": dict(kind="sbji", pal=dict(
        eye="#241a2e",
        purple=dict(tones=["#9C6BF0", "#7C3FE3", "#5B24B4"], line="#46188C",
                    spec="#C9A8FF", spec_at=((16, 9),)),
        pink=dict(tones=["#FF63BD", "#F32AA0", "#C10C7A"], line="#990761",
                  spec="#FFC0E4", spec_at=((8, 15),)),
        orange=dict(tones=["#FFB067", "#FF8F3A", "#E3670F"], line="#B94E06",
                    spec="#FFD3A6", spec_at=((17, 23),)))),
    "claude": dict(kind="clawd", pal=dict(
        tones=["#E99072", "#D77757", "#B45940"], line="#7C3B27", eye="#241318", spec="#F3B49C")),
}

if __name__ == "__main__":
    for mode in ("night", "day"):
        p = PAL[mode]
        draw_bg(p, mode).save(os.path.join(OUT, f"room_{mode}.png"))
        draw_fg(p, mode).save(os.path.join(OUT, f"room_{mode}_fg.png"))

    atlas = {}
    for name, cfg in CHARS.items():
        sheet = build_sprite(cfg["kind"], cfg["pal"])
        sheet.save(os.path.join(OUT, "sprites", f"{name}.png"))
        atlas[name] = {"frameSize": S, "idle": [0, 1], "walk": [2, 3, 4, 5],
                       "work": [6, 7, 8, 9], "sleep": [10]}
    json.dump(atlas, open(os.path.join(OUT, "sprites", "atlas.json"), "w"), indent=2)

    # 아이콘 — 다마고치 기기 앞면: 액정 안에 오이지와 클로드
    icon = Image.new("RGB", (512, 512), "#efe6dc")
    di = ImageDraw.Draw(icon)
    di.rounded_rectangle([0, 0, 511, 511], radius=118, fill="#cfd9e8")
    di.rounded_rectangle([10, 10, 501, 501], radius=110, fill="#e7eef8")
    di.rounded_rectangle([96, 62, 416, 392], radius=66, fill="#b9c6da")
    di.rounded_rectangle([114, 80, 398, 374], radius=50, fill="#161334")
    # 액정 속 잔디와 봇 두 마리
    di.rectangle([114, 296, 398, 374], fill="#2f2a55")
    di.rectangle([114, 296, 398, 302], fill="#3d3768")
    k = 4
    spr_o = build_sprite(CHARS["oiji"]["kind"], CHARS["oiji"]["pal"]).crop((0, 0, S, S)).resize((S * k, S * k), Image.NEAREST)
    spr_c = build_sprite(CHARS["claude"]["kind"], CHARS["claude"]["pal"]).crop((0, 0, S, S)).resize((S * k, S * k), Image.NEAREST)
    icon.paste(spr_o, (150, 348 - 30 * k), spr_o)
    icon.paste(spr_c, (250, 348 - 30 * k), spr_c)
    # 물리 버튼 A · B · C
    for i, col in enumerate(("#ff8f6b", "#ffd166", "#7bd1a8")):
        cx = 176 + i * 80
        di.ellipse([cx - 26, 424, cx + 26, 476], fill="#aebbd0")
        di.ellipse([cx - 20, 430, cx + 20, 470], fill=col)
        di.ellipse([cx - 12, 436, cx + 4, 452], fill="#ffffff")
    icon.save(os.path.join(OUT, "icon.png"))
    icon.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "tray.png"))
    print("ok")
