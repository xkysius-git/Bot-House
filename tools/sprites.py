"""Bot House 캐릭터 도트 스프라이트 빌더 (32x32, 11프레임).

원본 기준: docs/characters/{oiji,sbji,takuan,claude-clawd,family}.jpg (2026-11-23 장현 님 제공)
비율 기준: v1.0.1의 아담하고 통통한 SD 비율 (몸통 ~19-21px, 위쪽 여백 확보)

공통 규칙
  - 입·코 없음. 세로로 긴 검은 타원 눈 두 개 + 오른쪽 위 흰 반짝 하이라이트.
  - 실루엣은 4배 슈퍼샘플 → 커버리지 컷으로 둥글둥글하게 깎는다.
  - 외곽선 1px, 바닥은 y=29(그림자 선)에 닿게, 위쪽은 여백을 남긴다.
  - 프레임 배치: 0-1 idle, 2-5 walk, 6-9 work, 10 sleep
"""
import math
from PIL import Image, ImageDraw

S = 32
FRAMES = 11
SS = 4  # 슈퍼샘플 배율
DIRS4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


# ------------------------------------------------------------------ helpers
def _canvas():
    return Image.new("L", (S * SS, S * SS), 0)


def _mask(img):
    small = img.resize((S, S), Image.BOX)
    px = small.load()
    return {(x, y) for y in range(S) for x in range(S) if px[x, y] >= 128}


def rr_pts(cx, cy, w, h, r, ang=0.0):
    """둥근 사각형 외곽 폴리곤. 회전은 폴리곤 좌표에서 직접 한다."""
    r = max(0.5, min(r, w / 2.0, h / 2.0))
    hw, hh = w / 2.0 - r, h / 2.0 - r
    pts = []
    for sx, sy, a0 in ((1, -1, -90), (1, 1, 0), (-1, 1, 90), (-1, -1, 180)):
        ccx, ccy = hw * sx, hh * sy
        for k in range(7):
            a = math.radians(a0 + 90.0 * k / 6.0)
            pts.append((ccx + r * math.cos(a), ccy + r * math.sin(a)))
    if ang:
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        pts = [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]
    return [(cx + x, cy + y) for x, y in pts]


def _poly(d, pts):
    d.polygon([(x * SS, y * SS) for x, y in pts], fill=255)


def _disc(d, cx, cy, r):
    d.ellipse([(cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS], fill=255)


def union(*masks):
    out = set()
    for m in masks:
        out |= m
    return out


def depth_map(mask, maxd=3):
    """가장자리에서 안쪽으로의 거리(px)."""
    depth = {p: maxd + 1 for p in mask}
    for _ in range(maxd):
        changed = False
        for (x, y) in mask:
            if depth[(x, y)] == 1:
                continue
            best = depth[(x, y)]
            for dx, dy in DIRS4:
                q = (x + dx, y + dy)
                dq = depth[q] + 1 if q in mask else 1
                if dq < best:
                    best = dq
            if best != depth[(x, y)]:
                depth[(x, y)] = best
                changed = True
        if not changed:
            break
    return depth


def paint(d, mask, tones, line, cx, cy, R=9.0, lcut=-0.32, dcut=0.40,
          spec=None, spec_at=(), axis=(0.72, 1.0)):
    """1px 외곽선 + 왼쪽 위 빛, 오른쪽 아래 그늘의 부드러운 셀 셰이딩.

    가장자리 방향이 아니라 빛 축(좌상→우하) 하나로만 나누어, 표면이
    한 덩어리 쿠션처럼 보이게 한다.
    """
    if not mask:
        return
    depth = depth_map(mask, 3)
    light, base, dark = tones
    for (x, y) in sorted(mask, key=lambda p: (p[1], p[0])):
        dep = depth[(x, y)]
        if dep == 1:
            d.point((x, y), fill=line)
            continue
        t = ((x - cx) * axis[0] + (y - cy) * axis[1]) / float(R)
        if dep == 2:
            c = light if t < lcut else (dark if t > dcut else base)
        elif dep == 3 and t > dcut + 0.45:
            c = dark
        else:
            c = base
        d.point((x, y), fill=c)
    for (hx, hy) in spec_at:
        if (hx, hy) in mask and spec:
            d.point((hx, hy), fill=spec)


EYE = [".##.", "####", "####", "####", "####", "####", ".##."]  # 4x7 타원


def draw_eyes(d, cxs, cy, color="#241a2e", shine="#ffffff", closed=False, dx=0, dy=0):
    """세로로 긴 검은 타원 눈 + 오른쪽 위 반짝 하이라이트."""
    for cx in cxs:
        cx = int(round(cx)) + dx
        cy_i = int(round(cy)) + dy
        if closed:
            for x in (-2, -1, 0, 1):
                d.point((cx + x, cy_i), fill=color)
            d.point((cx - 2, cy_i + 1), fill=color)
            d.point((cx + 1, cy_i + 1), fill=color)
            continue
        for j, row in enumerate(EYE):
            for i, ch in enumerate(row):
                if ch == "#":
                    d.point((cx - 2 + i, cy_i - 3 + j), fill=color)
        d.point((cx + 1, cy_i - 2), fill=shine)


# ------------------------------------------------------------------ 실루엣
def mask_oiji(st):
    """포동포동한 네잎(ㅍ) 피클 쿠션 — 가운데가 살짝 잘록한 클로버."""
    cx, cy = 16 + st["lean"], 18.9 + st["bob"] + st["sink"]
    fat = st["fat"]
    r = 6.1 + 0.4 * fat
    off = 4.5 - 0.3 * fat
    img = _canvas()
    d = ImageDraw.Draw(img)
    for ox, oy in ((-off, -off), (off, -off), (-off, off), (off, off)):
        _disc(d, cx + ox, cy + oy, r)
    return _mask(img), cx, cy


def mask_takuan(st):
    """크림 모찌 쿠션 — 둥근 네모, 가운데 살짝 오목한 얼굴 판."""
    cx, cy = 16 + st["lean"], 18.9 + st["bob"] + st["sink"]
    fat = st["fat"]
    img = _canvas()
    d = ImageDraw.Draw(img)
    _poly(d, rr_pts(cx, cy, 20.2 + 0.8 * fat, 19.4 - 0.4 * fat, 6.8))
    return _mask(img), cx, cy


def mask_sbji(st):
    """3색 고리 펫 — 동글동글한 몸에 보라·마젠타·오렌지가 맞물린 실루엣."""
    cx, cy = 16 + st["lean"], 19.4 + st["bob"] + st["sink"]
    fat = st["fat"]
    sway = st["sway"] * 0.6
    img = _canvas()
    d = ImageDraw.Draw(img)
    _poly(d, rr_pts(cx, cy, 19.2 + 0.9 * fat, 20.0 - 0.4 * fat, 8.4))
    _disc(d, cx - 5.0 - sway, cy + 3.3, 4.4)
    _disc(d, cx + 5.2 - sway, cy + 3.1, 4.5)
    return _mask(img), cx, cy


def mask_clawd(st):
    """Clawd — 통통한 가로 몸통 + 짧은 팔 두 개 + 짧은 다리 네 개."""
    cx = 16 + st["lean"]
    cy = 18.1 + st["bob"] + st["sink"]
    fat = st["fat"]
    arm = st["arm"]
    legs = st["legs"]

    def place(w, h, r, px, py):
        out = _canvas()
        part = Image.new("L", (int(round(w * SS)), int(round(h * SS))), 0)
        _poly(ImageDraw.Draw(part), rr_pts(w / 2.0, h / 2.0, w, h, r))
        out.paste(part, (int(round(px * SS)), int(round(py * SS))))
        return _mask(out)

    bw, bh = 20.2 + 0.9 * fat, 12.8 - 0.4 * fat
    body = place(bw, bh, 4.8, cx - bw / 2.0, cy - bh / 2.0)
    arms = set()
    for sx in (-1, 1):
        arms |= place(3.8, 5.4, 1.6, cx + sx * 10.2 - 1.9, cy + 0.8 + arm - 2.7)
    # 다리: 한 덩어리 발판에 아래쪽 노치 3개를 파서 다리 네 개로 읽히게
    li = Image.new("L", (S * SS, S * SS), 0)
    ld = ImageDraw.Draw(li)
    _poly(ld, rr_pts(cx, 27.0, bw - 1.0, 6.0, 2.2))
    for nx in (-5.4, 0.0, 5.4):
        top = 27.4
        ld.rectangle([(cx + nx - 0.6) * SS, top * SS, (cx + nx + 0.6) * SS, 32 * SS], fill=0)
    legs_m = _mask(li)
    return {"body": body, "arms": arms, "legs": legs_m}, cx, cy


def states_for_frame(f):
    st = {"bob": 0.0, "lean": 0.0, "fat": 0.0, "sink": 0.0, "arm": 0.0,
          "legs": (0, 0, 0, 0), "sway": 0.0, "walk": False}
    if f == 1:
        st["bob"] = 0.5
        st["fat"] = 1.0
    elif 2 <= f <= 5:
        st["walk"] = True
        st["bob"] = [0.0, -1.0, 0.0, -1.0][f - 2]
        st["lean"] = [0.0, 1.0, 0.0, -1.0][f - 2]
        st["fat"] = [1.0, 0.0, 1.0, 0.0][f - 2]
        ph = [0, 1, 0, 1][f - 2]
        st["legs"] = tuple(-1 if (i % 2 == 0) == bool(ph) else 0 for i in range(4))
        st["sway"] = 1.0 if ph else -1.0
    elif 6 <= f <= 9:
        st["bob"] = [0.0, 0.6, 0.0, 0.6][f - 6]
        st["fat"] = [0.0, 1.0, 0.0, 1.0][f - 6]
        st["arm"] = [-1.0, 0.0, -1.0, 0.0][f - 6]
        st["sway"] = [0.0, 1.0, 0.0, 1.0][f - 6]
    elif f == 10:
        st["bob"] = 0.7
        st["fat"] = 1.0
        st["sink"] = 0.5
    return st


def _sbji_color(x, y, cx, cy):
    """얼굴은 보라, 아래쪽으로 마젠타·오렌지가 살짝 휜 경계로 맞물린다."""
    dx, dy = x - cx, y - cy
    r = math.hypot(dx, dy)
    deg = (math.degrees(math.atan2(dy, dx)) + r * 3.0) % 360.0
    if y < cy + 2.6:
        return "purple"
    if 105.0 <= deg < 205.0:
        return "pink"
    if deg >= 355.0 or deg < 105.0:
        return "orange"
    return "purple"


def build(kind, pal):
    frames = []
    for f in range(FRAMES):
        st = states_for_frame(f)
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        lean = int(round(st["lean"]))
        bob = int(round(st["bob"]))
        closed = (f == 10)

        if kind == "oiji":
            m, cx, cy = mask_oiji(st)
            paint(d, m, pal["tones"], pal["line"], cx, cy, R=8.6,
                  spec=pal.get("spec"), spec_at=((11, 12), (12, 11), (11, 11)))
            leaf, leaf_hi = pal.get("leaf", "#3FAE5F"), pal.get("leaf_hi", "#8CEBA4")
            sprout = ((15, 4, leaf_hi), (17, 4, leaf_hi), (14, 5, leaf), (15, 5, leaf_hi),
                      (16, 5, leaf), (17, 5, leaf_hi), (18, 5, leaf), (16, 6, leaf),
                      (16, 7, leaf))
            for (x, y, c) in sprout:
                d.point((x + lean, y + bob), fill=c)
            draw_eyes(d, (12.4, 19.6), 18, pal["eye"], closed=closed, dx=lean, dy=bob)

        elif kind == "takuan":
            m, cx, cy = mask_takuan(st)
            paint(d, m, pal["tones"], pal["line"], cx, cy, R=8.8,
                  spec=pal.get("spec"), spec_at=((9, 11), (10, 10)))
            feet = pal.get("feet", "#E7D6B6")
            for fx in (10, 19):
                for k in range(3):
                    d.point((fx + k + lean, 29 + bob), fill=feet)
            # 얼굴 판 (살짝 오목)
            plate_img = _canvas()
            pd = ImageDraw.Draw(plate_img)
            _poly(pd, rr_pts(cx, cy, 15.4, 14.8, 6.4))
            plate = _mask(plate_img) & m
            pdep = depth_map(plate, 2)
            for (x, y) in sorted(plate, key=lambda p: (p[1], p[0])):
                if pdep[(x, y)] == 1:
                    up = (x, y - 1) in plate
                    lf = (x - 1, y) in plate
                    dn = (x, y + 1) in plate
                    rt = (x + 1, y) in plate
                    if (dn or rt) and not (up or lf):
                        c = pal["plate_hi"]
                    elif (up or lf) and not (dn or rt):
                        c = pal["rim"]
                    else:
                        c = pal["plate"]
                    d.point((x, y), fill=c)
                else:
                    d.point((x, y), fill=pal["plate"])
            if not closed and pal.get("blush"):
                for bx in (9, 20):
                    for k in range(3):
                        d.point((bx + k + lean, 21 + bob), fill=pal["blush"])
                    d.point((bx + lean, 22 + bob), fill=pal["blush"])
                    d.point((bx + 2 + lean, 22 + bob), fill=pal["blush"])
            draw_eyes(d, (12.4, 19.6), 18, pal["eye"], closed=closed, dx=lean, dy=bob)

        elif kind == "sbji":
            m, cx, cy = mask_sbji(st)
            depth = depth_map(m, 2)
            owner = {p: _sbji_color(p[0], p[1], cx, cy) for p in m}
            for (x, y) in sorted(m, key=lambda p: (p[1], p[0])):
                name = owner[(x, y)]
                tones = pal[name]["tones"]
                if depth[(x, y)] == 1:
                    c = pal[name]["line"]
                else:
                    seam = any(owner.get((x + dx, y + dy), name) != name for dx, dy in DIRS4)
                    if seam:
                        c = tones[2]
                    else:
                        t = ((x - cx) * 0.72 + (y - cy)) / 8.6
                        c = tones[0] if t < -0.34 else (tones[2] if t > 0.42 else tones[1])
                d.point((x, y), fill=c)
            for name, pts in (("purple", ((16, 9),)), ("pink", ((9, 19),)),
                              ("orange", ((23, 21),))):
                for (hx, hy) in pts:
                    if owner.get((hx, hy)) == name:
                        d.point((hx, hy), fill=pal[name]["spec"])
            draw_eyes(d, (12.4, 19.6), 18, pal["eye"], closed=closed, dx=lean, dy=bob)

        elif kind == "clawd":
            parts, cx, cy = mask_clawd(st)
            tones = pal["tones"]
            # 다리 먼저 → 몸통 → 팔 순으로 겹쳐 그려 이음새가 자연스럽게
            legs_m = parts["legs"]
            leg_depth = depth_map(legs_m, 2)
            for (x, y) in sorted(legs_m, key=lambda p: (p[1], p[0])):
                c = pal["line"] if leg_depth[(x, y)] == 1 else (
                    tones[2] if y >= 29 else tones[1])
                d.point((x, y), fill=c)
            paint(d, parts["body"], tones, pal["line"], cx, cy, R=9.4,
                  spec=pal.get("spec"), spec_at=((9, 13), (10, 12)))
            paint(d, parts["arms"], [tones[0], tones[1], tones[2]], pal["line"], cx, cy, R=9.4,
                  lcut=-0.2, dcut=0.6)
            draw_eyes(d, (12.4, 19.6), 18, pal["eye"], closed=closed, dx=lean, dy=bob)

        frames.append(img)

    sheet = Image.new("RGBA", (S * len(frames), S), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * S, 0), fr)
    return sheet
