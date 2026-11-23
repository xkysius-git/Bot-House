"""Sprite sheet builder for Bot House characters (32x32, 11 frames)."""
from PIL import Image, ImageDraw

S = 32

# --- 클로드 고유 픽셀 마스코트(Clawd) 치수 ---------------------------------
CL_BODY = (4, 27, 12, 25)      # left, right, top, bottom — 가로로 넓은 직사각형 몸통
CL_ARM = ((2, 3), (28, 29))    # 양옆에 붙은 짧은 팔
CL_ARM_T, CL_ARM_B = 18, 21
CL_LEGS = ((5, 8), (11, 14), (17, 20), (23, 26))   # 아래 짧은 다리 네 개(두 쌍)
CL_LEG_T, CL_LEG_B = 26, 29
CL_EYES = ((10, 12), (19, 21))                     # 네모 눈 두 개
CL_EYE_T, CL_EYE_B = 15, 17


def clawd_mask(arm_dy=0, leg_lift=(0, 0, 0, 0)):
    """Clawd 실루엣: 넓은 몸통 + 양옆 팔 + 네 다리."""
    l, r, t, b = CL_BODY
    m = {(x, y) for y in range(t, b + 1) for x in range(l, r + 1)}
    # 모서리 2px 라운딩
    for (cx, cy, sx, sy) in ((l, t, 1, 1), (r, t, -1, 1), (l, b, 1, -1), (r, b, -1, -1)):
        for i in range(2):
            for j in range(2):
                if i + j < 2:
                    m.discard((cx + sx * i, cy + sy * j))
    for (x0, x1) in CL_ARM:
        for y in range(CL_ARM_T + arm_dy, CL_ARM_B + arm_dy + 1):
            for x in range(x0, x1 + 1):
                m.add((x, y))
    for i, (x0, x1) in enumerate(CL_LEGS):
        for y in range(CL_LEG_T, CL_LEG_B + 1 - leg_lift[i]):
            for x in range(x0, x1 + 1):
                m.add((x, y))
    return m


def clawd_tone(x, y, tones):
    """몸통은 좌상단 밝고 우하단 어둡게, 다리는 아래로 갈수록 어둡게."""
    l, r, t, b = CL_BODY
    light, base, dark = tones
    if y >= CL_LEG_T:
        return dark if y >= CL_LEG_B - 1 else base
    if y <= t + 1 or x <= l + 1:
        return light
    if y >= b or x >= r - 1:
        return dark
    return base


def build_clawd(pal):
    """클로드 캐릭터(Clawd) 시트. 프레임 배치는 다른 캐릭터와 같다."""
    tones = pal["tones"]
    line = pal["line"]
    eye = pal["eye"]
    frames = []
    for f in range(11):
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        bob = 0
        lean = 0
        arm_dy = 0
        leg_lift = (0, 0, 0, 0)
        if f == 0:
            pass
        elif f == 1:
            bob = 1
        elif 2 <= f <= 5:
            bob = [0, -1, 0, -1][f - 2]
            lean = [0, 1, 0, -1][f - 2]
            ph = [0, 1, 0, 1][f - 2]
            leg_lift = [ph if i % 2 == 0 else 1 - ph for i in range(4)]
        elif 6 <= f <= 9:
            bob = [0, 1, 0, 1][f - 6]
            arm_dy = [-1, 0, -1, 0][f - 6]
        elif f == 10:
            bob = 1

        mask = clawd_mask(arm_dy=arm_dy, leg_lift=tuple(leg_lift))
        for (x, y) in sorted(mask, key=lambda p: (p[1], p[0])):
            edge = any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            d.point((x + lean, y + bob), fill=line if edge else clawd_tone(x, y, tones))

        # 팔이 몸통과 이어지는 자리에 어두운 이음선을 넣어 팔로 읽히게 한다
        blink = [0, 1, 0, 1][f - 6] if 6 <= f <= 9 else 0
        for x in (CL_BODY[0], CL_BODY[1]):
            for y in range(CL_ARM_T + arm_dy + 1, CL_ARM_B + arm_dy):
                if (x, y) in mask:
                    d.point((x + lean, y + bob), fill=tones[2] if blink == 0 else tones[1])

        # 눈: 네모. 자는 동안에는 감은 선
        for (ex0, ex1) in CL_EYES:
            if f == 10:
                for x in range(ex0 - 1, ex1 + 2):
                    d.point((x + lean, CL_EYE_B + bob), fill=eye)
            else:
                for y in range(CL_EYE_T, CL_EYE_B + 1):
                    for x in range(ex0, ex1 + 1):
                        d.point((x + lean, y + bob), fill=eye)

        if pal.get("spec"):
            # 몸통 위쪽에 아주 옅은 하이라이트
            for (hx, hy) in ((7, CL_BODY[2] + 1), (8, CL_BODY[2] + 1), (7, CL_BODY[2] + 2)):
                if (hx, hy) in mask:
                    d.point((hx + lean, hy + bob), fill=pal["spec"])
        frames.append(img)

    sheet = Image.new("RGBA", (S * len(frames), S), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * S, 0), fr)
    return sheet


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
