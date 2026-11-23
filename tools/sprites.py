"""Sprite sheet builder for Bot House characters (32x32, 11 frames)."""
from PIL import Image, ImageDraw

S = 32


def silhouette(shape):
    """Union of discs so the ㅍ-like lobes stay readable at 32px."""
    m = set()

    def disc(cx, cy, r):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    m.add((x, y))

    if shape == "clover":            # 오이지 / 클로드
        for (ox, oy) in ((-5.3, -5.0), (5.3, -5.0), (-5.3, 5.0), (5.3, 5.0)):
            disc(16 + ox, 18 + oy, 6.4)
    elif shape == "square":          # 단무지
        for y in range(7, 30):
            for x in range(6, 26):
                dx, dy = abs(x - 15.5), abs(y - 18.0)
                if dx <= 9.5 and dy <= 10.0:
                    m.add((x, y))
        # round the corners
        for (cx, cy, sx, sy) in ((6, 8, 1, 1), (25, 8, -1, 1), (6, 29, 1, -1), (25, 29, -1, -1)):
            for i in range(4):
                for j in range(4):
                    if (i + j) < 3:
                        m.discard((cx + sx * i, cy + sy * j))
    elif shape == "tri":             # 석박지
        disc(18.0, 11.0, 7.4)
        disc(10.0, 19.0, 6.8)
        disc(21.0, 22.0, 6.6)
    return m


def shade(mask, x, y, tones):
    """Flat 3-tone rim shading: light top-left edge, dark bottom-right edge."""
    def out(a, b):
        return (a, b) not in mask
    if out(x - 1, y) or out(x, y - 1) or out(x - 2, y - 1) or out(x - 1, y - 2):
        return tones[0]
    if out(x + 1, y) or out(x, y + 1) or out(x + 2, y + 1) or out(x + 1, y + 2):
        return tones[2]
    return tones[1]


def build(shape, pal):
    base_mask = silhouette(shape)
    frames = []
    for f in range(11):
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        bob = 0
        lean = 0
        if f == 0:
            bob = 0
        elif f == 1:
            bob = 1
        elif 2 <= f <= 5:
            bob = [0, -1, 0, -1][f - 2]
            lean = [0, 1, 0, -1][f - 2]
        elif 6 <= f <= 9:
            bob = [0, 1, 0, 1][f - 6]
        elif f == 10:
            bob = 1

        mask = base_mask
        # body with inset outline
        for (x, y) in mask:
            edge = False
            for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) not in mask:
                    edge = True
                    break
            if edge:
                d.point((x + lean, y + bob), fill=pal["line"])
                continue
            if pal.get("petals"):
                if y < 16:
                    pts = pal["petals"][0]
                elif x < 15:
                    pts = pal["petals"][1]
                else:
                    pts = pal["petals"][2]
            else:
                pts = pal["tones"]
            d.point((x + lean, y + bob), fill=shade(mask, x, y, pts))
        # specular highlight on the upper-left lobe
        if pal.get("spec"):
            for (hx, hy) in [(9, 10), (10, 9), (10, 10), (9, 11)]:
                if (hx, hy) in mask:
                    d.point((hx + lean, hy + bob), fill=pal["spec"])
        # inset face plate (단무지)
        if shape == "square":
            for y in range(10, 27):
                for x in range(9, 23):
                    if (x, y) not in mask:
                        continue
                    edge = min(x - 9, 22 - x, y - 10, 26 - y)
                    if edge < 1:
                        continue
                    c = pal["face"] if (x < 21 and y < 25) else pal["face_dk"]
                    d.point((x + lean, y + bob), fill=c)
            # plate rim shadow
            for x in range(9, 23):
                if (x, 27) in mask:
                    d.point((x + lean, 27 + bob), fill=pal["face_dk"])

        ey = 17 + bob
        if 6 <= f <= 9:
            ey += 1
        # eyes
        if f == 10:
            for ex in (12, 20):
                for exx in (ex - 2, ex - 1, ex, ex + 1):
                    d.point((exx + lean, ey), fill=pal["eye"])
                d.point((ex - 2 + lean, ey + 1), fill=pal["eye"])
                d.point((ex + 1 + lean, ey + 1), fill=pal["eye"])
        else:
            for ex in (12, 20):
                for yy in range(ey - 2, ey + 2):
                    for xx in (ex - 1, ex, ex + 1):
                        d.point((xx + lean, yy), fill=pal["eye"])
                d.point((ex + lean, ey - 3), fill=pal["eye"])
                d.point((ex + lean, ey + 2), fill=pal["eye"])
                d.point((ex - 1 + lean, ey - 3), fill="#ffffff")
        # blush
        if pal.get("blush"):
            for bx in (7, 24):
                d.point((bx + lean, ey + 2), fill=pal["blush"])
                d.point((bx + lean, ey + 3), fill=pal["blush"])
                d.point((bx + (1 if bx < 16 else -1) + lean, ey + 3), fill=pal["blush"])
        # typing hands (visible above the desk line)
        if 6 <= f <= 9:
            hy = 26 + [0, 1, 0, 1][f - 6]
            for (hxx) in (3, 4, 26, 27):
                if pal.get("tones"):
                    d.point((hxx, hy + bob), fill=pal["tones"][0])
                    d.point((hxx, hy + 1 + bob), fill=pal["tones"][2])
        # feet while walking
        if 2 <= f <= 5:
            ph = [0, 1, 0, 1][f - 2]
            for (fx, ph2) in ((10, ph), (19, 1 - ph)):
                for xx in range(fx, fx + 4):
                    for yy in range(29 - ph2, 31):
                        d.point((xx + lean, yy + bob), fill=pal["feet"])
        # leaf (오이지)
        if pal.get("leaf"):
            for (lx, ly, c) in [(14, 5, pal["leaf"]), (15, 4, pal["leaf"]), (14, 4, pal["leaf"]),
                                (13, 3, pal["leaf_hi"]), (16, 3, pal["leaf_hi"]), (14, 3, pal["leaf_hi"])]:
                d.point((lx, ly + bob), fill=c)
        # spark (클로드)
        if pal.get("spark"):
            sy = 3 + bob
            for (sx, syy) in [(15, sy), (15, sy + 1), (15, sy + 2), (14, sy + 1), (16, sy + 1)]:
                d.point((sx, syy), fill=pal["spark"])
            d.point((15, sy + 1), fill="#ffffff")
        frames.append(img)

    sheet = Image.new("RGBA", (S * len(frames), S), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * S, 0), fr)
    return sheet
