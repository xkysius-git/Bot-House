"""Oiji (Pickle) frames - body rebuilt from the approved concept #3.

장현 님이 고른 기본 몸은 `docs/characters/oiji-bubble-concept3-agy.jpg`
(청록·보라·분홍·연노랑 오로라 유막 + 밝은 하늘색 1px 외곽선 + 좌상단·우하단
흰 글로스 + 속이 비쳐 보이는 유리 음영).  이 파일은 그 시안을 64x64 도트로
다시 그린다.  규격상 알파는 0/255 만 쓸 수 있으므로 "비침"은 반투명이 아니라
시안처럼 어두운 유리 내부 음영으로 표현한다 (배경 #14161E 위에서도 입체가 산다).

Claw.D 지시 (2026-11-25):
* 시안 3번 아래쪽의 움푹 파인 부분은 없애고 더 동글고 말랑한 실루엣으로.
* 눈은 흰 외곽선 없는 꽉 찬 검은 세로 눈 (상단 흰 2x2 하이라이트).

5줄: 1 대기 / 2 감정(ㅍ 변신) / 3 작업 / 4 잠 / 5 부유.
"""
import math
import os
from collections import deque

import numpy as np
from PIL import Image

import anim as A

S = 64
BASE_Y = 55
CX, CY = 32.0, 37.0          # body centre in the 64 grid
RX, RY = 21.0, 18.5          # 43 x 39 px bubble (was 36 x 34 - too small)

HERE = os.path.dirname(os.path.abspath(__file__))


def _asset(name):
    """Find a reference PNG in the repo checkout or the workspace copy."""
    for rel in (('..', '..', 'docs', 'characters'),
                ('..', 'aimon-dot-128'),
                ('..', '..', 'aimon-dot-128'),
                ('..', '..', '..', 'work', 'aimon-dot-128')):
        p = os.path.abspath(os.path.join(HERE, *rel, name))
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


# ------------------------------------------------------------------ palette
# outer keyline: pale sky blue, brighter on the lit upper-left
OUT_HI = (0xEE, 0xF6, 0xFF)
OUT = (0xC8, 0xDC, 0xFA)
OUT_LOW = (0x9F, 0xB8, 0xE8)

# aurora film (sampled from concept #3)
AUR_TEAL = (0x36, 0xA9, 0xBE)
AUR_MINT = (0x5F, 0xE2, 0xCE)
AUR_CYAN = (0x83, 0xDF, 0xF7)
AUR_LAV = (0xA9, 0x9B, 0xF2)
AUR_VIOL = (0x7F, 0x6B, 0xD4)
AUR_PINK = (0xFF, 0xA4, 0xD9)
AUR_ROSE = (0xE5, 0x8E, 0xE0)
AUR_GOLD = (0xFF, 0xE7, 0xA2)

# glass interior, light lower-left -> dark upper-right (sampled from #3)
IN_PALE = (0xD2, 0xE0, 0xF0)
IN_HI = (0xC2, 0xD3, 0xE6)
IN_GLOW = (0xAC, 0xBE, 0xD3)
IN_LIT = (0x95, 0xAA, 0xC0)
IN_MID = (0x7C, 0x91, 0xA9)
IN_DIM = (0x59, 0x6D, 0x85)
IN_DARK = (0x33, 0x42, 0x56)

WHITE = (0xFF, 0xFF, 0xFF)
EYE = (0x0C, 0x0D, 0x13)
ZCOL = (0xA9, 0xB6, 0xC9)
SPARK = (0xB6, 0xC4, 0xDA)
HALO = (0x9E, 0xB2, 0xC8)

PALETTE = [OUT_HI, OUT, OUT_LOW, AUR_TEAL, AUR_MINT, AUR_CYAN, AUR_LAV,
           AUR_VIOL, AUR_PINK, AUR_ROSE, AUR_GOLD, IN_PALE, IN_HI, IN_GLOW,
           IN_LIT, IN_MID, IN_DIM, IN_DARK, WHITE, EYE]

TINTS = (AUR_MINT, AUR_PINK, AUR_LAV, AUR_CYAN, AUR_GOLD)


# -------------------------------------------------------------- body shapes
def _field(cx, cy, rx, ry, n=2.05, wob=0.0, phase=0.0, organic=1.0):
    """Normalised bubble distance; <= 1 is inside.

    `organic` scales the small harmonics that keep the outline hand-made
    rather than a perfect circle (concept #3 is lumpy at soft zoom).
    """
    yy, xx = np.mgrid[0:S, 0:S]
    d = (np.abs((xx - cx) / rx) ** n + np.abs((yy - cy) / ry) ** n) ** (1.0 / n)
    th = np.arctan2(cy - yy, xx - cx)
    org = (0.012 * np.sin(2.0 * th + 0.6 + phase * 0.7)
           + 0.008 * np.cos(3.0 * th - 0.4 - phase * 0.4)
           + 0.004 * np.sin(5.0 * th + phase))
    if wob:
        org = org + wob * np.sin(3.0 * th + phase)
    return d / (1.0 + organic * org)


def _inside(cx, cy, rx, ry, wob=0.0, phase=0.0, organic=1.0):
    return _field(cx, cy, rx, ry, wob=wob, phase=phase, organic=organic) <= 1.0


def _erode4(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        nxt = cur.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.zeros_like(cur)
            ys, xs = np.where(cur)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
            sh[ys2[ok], xs2[ok]] = True
            nxt &= sh
        cur = nxt
    return cur


def _depth(mask, d):
    """Pixels exactly d steps inside the mask edge (1 = the edge itself)."""
    if d <= 1:
        return mask & ~_erode4(mask, 1)
    return _erode4(mask, d - 1) & ~_erode4(mask, d)


def _angle(cx, cy):
    yy, xx = np.mgrid[0:S, 0:S]
    return np.degrees(np.arctan2(cy - yy, xx - cx)) % 360.0


def _in_arc(ang, lo, hi):
    if lo <= hi:
        return (ang >= lo) & (ang <= hi)
    return (ang >= lo) | (ang <= hi)


# aurora gradient sequence around the film
_AUR_SEQ = (AUR_TEAL, AUR_MINT, AUR_CYAN, AUR_LAV, AUR_VIOL,
            AUR_ROSE, AUR_PINK, AUR_GOLD, AUR_MINT, AUR_TEAL)


def _aurora_color(frac):
    """Smooth aurora spectrum lookup for frac in [0,1)."""
    n = len(_AUR_SEQ)
    k = frac * n
    i = int(math.floor(k)) % n
    j = (i + 1) % n
    t = k - math.floor(k)
    # snap toward the nearer entry: keeps the dot palette flat
    a, b = _AUR_SEQ[i], _AUR_SEQ[j]
    return a if t < 0.5 else b


def bubble(cx=CX, cy=CY, rx=RX, ry=RY, wob=0.0, phase=0.0, flow=0.0,
           organic=1.0, dots=True):
    """Concept #3 bubble: aurora rim, dark glass interior, white glints."""
    out = np.zeros((S, S, 4), np.uint8)
    body = _inside(cx, cy, rx, ry, wob=wob, phase=phase, organic=organic)
    ang = _angle(cx, cy)
    yy, xx = np.mgrid[0:S, 0:S]
    nx, ny = (xx - cx) / rx, (yy - cy) / ry

    # ---- glass interior: a light pool at the lower-left, dark upper-right
    # curved bands centred on the light pool: reads as glass, not stripes
    d = np.sqrt(((nx + 0.55) * 0.72) ** 2 + ((ny - 0.45) * 0.95) ** 2)
    b = (0.94 - 0.60 * d - 0.10 * nx
         + 0.006 * np.sin(2.4 * nx + 1.2 * ny + flow))
    interior = np.empty((S, S, 3), np.uint8)
    interior[:] = IN_DARK
    for lim, col in ((0.24, IN_DIM), (0.38, IN_MID), (0.50, IN_LIT),
                     (0.62, IN_GLOW), (0.74, IN_HI), (0.92, IN_PALE)):
        interior[b >= lim] = col
    out[body, :3] = interior[body]
    out[body, 3] = 255

    # ---- aurora film: two rings all round, a thicker pastel band low / left
    ring1 = _depth(body, 1)
    ring2 = _depth(body, 2)
    ring3 = _depth(body, 3) & _in_arc(ang, 180, 342) if rx >= 15 else ring2
    ring4 = _depth(body, 4) & _in_arc(ang, 212, 310) if rx >= 17 else ring2
    film = ring1 | ring2 | ring3 | ring4
    frac = (ang / 360.0
            + 0.16 * nx - 0.10 * ny          # diagonal drift, like the concept
            + flow)
    fsel = film
    # vectorised spectrum: pick the nearer of the two neighbouring entries
    n = len(_AUR_SEQ)
    kf = (frac % 1.0) * n
    i0 = np.floor(kf).astype(int) % n
    pick_next = (kf - np.floor(kf)) >= 0.5
    seq = np.array(_AUR_SEQ, np.uint8)
    idx = np.where(pick_next, (i0 + 1) % n, i0)
    colors = seq[idx]
    out[fsel, :3] = colors[fsel]
    out[fsel, 3] = 255

    # ---- outer keyline: pale blue, a touch deeper along the bottom-left
    edge = _depth(body, 1)
    out[edge, :3] = OUT
    out[edge & _in_arc(ang, 95, 175), :3] = OUT_HI
    out[edge & _in_arc(ang, 250, 320), :3] = OUT_LOW
    out[edge, 3] = 255

    # ---- inner shadow: one soft line just under the film, upper-right
    sh = _depth(body, 3) & _in_arc(ang, 286, 62)
    out[sh, :3] = IN_DARK

    # ---- faint aurora tint bleeding into the glass low on the left
    tint = _depth(body, 5) & _in_arc(ang, 214, 268)
    tcol = np.where((np.sin(np.radians(ang - 214)) > 0.45)[..., None],
                    np.array(AUR_MINT, np.uint8), np.array(AUR_PINK, np.uint8))
    out[tint, :3] = tcol[tint]

    # ---- white gloss: a solid 2px arc hugging the upper-left rim, plus flecks
    if rx >= 17:
        for a in range(106, 172, 2):
            rad = math.radians(a)
            gx = int(round(cx + (rx - 3.0) * math.cos(rad)))
            gy = int(round(cy - (ry - 2.8) * math.sin(rad)))
            for ddx, ddy in ((0, 0), (1, 0), (0, 1)):
                px, py = gx + ddx, gy + ddy
                if 0 <= py < S and 0 <= px < S and body[py, px]:
                    out[py, px] = (*WHITE, 255)
        # small 1px flecks below the gloss (concept #3's dots)
        for a in (112, 126, 142, 158):
            gx = int(round(cx + (rx - 6.0) * math.cos(math.radians(a))))
            gy = int(round(cy - (ry - 5.6) * math.sin(math.radians(a))))
            if 0 <= gy < S and 0 <= gx < S and body[gy, gx]:
                out[gy, gx] = (*WHITE, 255)
    else:
        # small bubble: a single 2x3 glint instead of a full swoosh
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1), (0, 2)):
            gx = int(round(cx - rx * 0.45)) + dx
            gy = int(round(cy - ry * 0.55)) + dy
            if 0 <= gy < S and 0 <= gx < S and body[gy, gx]:
                out[gy, gx] = (*WHITE, 255)
    # small square glint at the top, like the concept's floating white 2x2
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        gx, gy = int(round(cx - rx * 0.34)) + dx, int(round(cy - ry * 0.82)) + dy
        if 0 <= gy < S and 0 <= gx < S and body[gy, gx]:
            out[gy, gx] = (*WHITE, 255)

    # lower-right: a clean 2px diagonal streak + a fleck (concept #3)
    if rx >= 17:
        sx0, sy0 = int(round(cx + rx * 0.40)), int(round(cy + ry * 0.46))
        for i in range(5):
            for k in (0, 1):
                gx, gy = sx0 + i + k, sy0 - i
                if 0 <= gy < S and 0 <= gx < S and body[gy, gx]:
                    out[gy, gx] = (*WHITE, 255)
        gx, gy = sx0 + 3, sy0 + 2
        if 0 <= gy < S and 0 <= gx < S and body[gy, gx]:
            out[gy, gx] = (*WHITE, 255)

    if dots and rx > 14:
        # aurora flecks sitting on the film, top-left and right
        for a, r, c in ((140, 1.02, AUR_MINT), (35, 1.02, AUR_PINK),
                        (200, 1.03, AUR_CYAN)):
            gx = int(round(cx + rx * r * math.cos(math.radians(a))))
            gy = int(round(cy - ry * r * math.sin(math.radians(a))))
            if 0 <= gy < S and 0 <= gx < S and not out[gy, gx, 3]:
                out[gy, gx] = (*c, 255)
    return out


BODY = _inside(CX, CY, RX, RY)
SIL = _inside(CX, CY, RX + 1.0, RY + 1.0)
BASE = bubble()

EXE_CY = CY - 0.5
EXE_GAP = 6.0
EYE_W, EYE_H = 6, 11


# ------------------------------------------------------------------- eyes
def _paint(img, spr, x, y):
    h, w = spr.shape[:2]
    m = spr[..., 3] > 0
    ys, xs = np.where(m)
    ys2, xs2 = ys + y, xs + x
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    img[ys2[ok], xs2[ok]] = spr[ys[ok], xs[ok]]
    return img


def _eye_pill(w=EYE_W, h=EYE_H, glint=True):
    """Solid black vertical eye, rounded top/bottom, 2x2 white highlight."""
    spr = np.zeros((h, w, 4), np.uint8)
    spr[1:h - 1, :] = (*EYE, 255)
    spr[0, 1:w - 1] = (*EYE, 255)
    spr[h - 1, 1:w - 1] = (*EYE, 255)
    if w >= 5:
        spr[0, 1] = (*EYE, 255)
        spr[0, w - 2] = (*EYE, 255)
    if glint:
        spr[1, 1] = (*WHITE, 255)
        spr[1, 2] = (*WHITE, 255)
        spr[2, 1] = (*WHITE, 255)
        spr[2, 2] = (*WHITE, 255)
    return spr


def eyes_open(img, cx=CX, cy=EXE_CY, gap=EXE_GAP, glint=True, w=EYE_W, h=EYE_H):
    out = img.copy()
    spr = _eye_pill(w, h, glint=glint)
    for sgn in (-1, 1):
        x = int(round(cx + sgn * gap - w / 2.0))
        y = int(round(cy - h / 2.0))
        _paint(out, spr, x, y)
    return out


def eyes_closed(img, cx=CX, cy=EXE_CY, gap=EXE_GAP, curved=True):
    """`⌣ ⌣` - a 5px lid curve, no bars left."""
    out = img.copy()
    lid = np.zeros((2, 7, 4), np.uint8)
    for i, d in ((0, 0), (1, 0), (2, 1), (3, 1), (4, 1), (5, 0), (6, 0)):
        lid[d, i] = (*EYE, 255)
    if not curved:
        for i in range(7):
            lid[0, i] = (*EYE, 255)
            lid[1, i] = 0
    for sgn in (-1, 1):
        x = int(round(cx + sgn * gap - 3.5))
        y = int(round(cy - 1))
        _paint(out, lid, x, y)
    return out


def eyes_narrow(img, cx=CX, cy=EXE_CY, gap=EXE_GAP, keep=0.42):
    """Half-lidded: the bottom slice of the pill, lid flattened."""
    out = img.copy()
    h = max(3, int(round(EYE_H * keep)))
    spr = _eye_pill(EYE_W, h, glint=False)
    for i in range(EYE_W):
        spr[0, i] = (*EYE, 255)
    for sgn in (-1, 1):
        x = int(round(cx + sgn * gap - EYE_W / 2.0))
        y = int(round(cy - 1 - h / 2.0)) + 1
        _paint(out, spr, x, y)
    return out


# 4x7 chevron, 2 dots thick, so `> <` still reads at 128px
_CHEV = ["...##",
         "...##",
         "..##.",
         "##...",
         "..##.",
         "...##",
         "...##"]


def strain_eyes(img, cx=CX, cy=EXE_CY, gap=6.0):
    """`> <` - eyes screwed shut with effort while it transforms."""
    out = img.copy()
    base = np.array([[c == '#' for c in row] for row in _CHEV])
    for sgn in (-1, 1):
        arr = base[:, ::-1] if sgn < 0 else base
        spr = np.zeros(arr.shape + (4,), np.uint8)
        spr[arr] = (*EYE, 255)
        hh, ww = arr.shape
        x = int(round(cx + sgn * gap - ww / 2.0))
        y = int(round(cy - hh // 2.0))
        _paint(out, spr, x, y)
    return out


# ---------------------------------------------------------------- effects
def strain_marks(img, spots, col=HALO):
    out = img.copy()
    m = A.mask_of(out)
    for (x, y, dx, dy, n) in spots:
        for i in range(n):
            xx, yy = int(round(x + dx * i)), int(round(y + dy * i))
            if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
                out[yy, xx] = (*col, 255)
    return out


def sweat(img, x, y, col=(0x8F, 0xC3, 0xE4)):
    out = img.copy()
    m = A.mask_of(out)
    for (dx, dy) in ((1, 0), (0, 1), (1, 1), (1, 2)):
        xx, yy = x + dx, y + dy
        if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
            out[yy, xx] = (*col, 255)
    return out


def zeds(img, count, y0=30, x0=46):
    out = img.copy()
    m = A.mask_of(out)
    for k in range(count):
        x, y = x0 + k * 4, y0 - k * 8
        for _ in range(8):
            if not m[max(0, y - 1):y + 6, max(0, x - 1):x + 7].any():
                break
            x += 3
            y -= 2
            if x > S - 9:
                break
        x = min(S - 9, max(2, x))
        y = min(S - 7, max(2, y))
        A.zed(out, x, y, ZCOL)
    return out


def spark(img, pts):
    """A four-point pixel twinkle: pastel core, grey arms."""
    out = img.copy()
    m = A.mask_of(out)
    for (x, y, c) in pts:
        for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            xx, yy = x + dx, y + dy
            if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
                out[yy, xx] = (*SPARK, 255)
        if 0 <= y < S and 0 <= x < S and not m[y, x]:
            out[y, x] = (*c, 255)
    return out


def _drop(img, x0, y0, r=1, col=AUR_CYAN):
    out = img.copy()
    m = A.mask_of(out)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if r - 0.7 <= math.hypot(dx, dy) <= r + 0.25:
                x, y = x0 + dx, y0 + dy
                if 0 <= y < S and 0 <= x < S and not m[y, x]:
                    out[y, x] = (*col, 255)
    if r >= 2:
        x, y = x0 - 1, y0 - 1
        if 0 <= y < S and 0 <= x < S and not m[y, x]:
            out[y, x] = (*WHITE, 255)
    return out


def burst(img, cx, cy, r, rays=3):
    out = img.copy()
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        for i in range(rays):
            rr = r + 2.0 + i
            x = int(round(cx + rr * math.cos(a)))
            y = int(round(cy - rr * math.sin(a)))
            if 0 <= y < S and 0 <= x < S and not out[y, x, 3]:
                out[y, x] = (*(WHITE if i < 2 else AUR_MINT), 255)
    for sx, sy, c in ((-1, -1, AUR_MINT), (1, -1, AUR_PINK),
                      (-1, 1, AUR_LAV), (1, 1, WHITE)):
        x = int(round(cx + sx * (r + 3) * 0.80))
        y = int(round(cy + sy * (r + 3) * 0.80))
        out = _star(out, x, y, c)
    return out


def _star(img, x, y, c, arms=2):
    out = img.copy()
    m = A.mask_of(out)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        for i in range(1, arms + 1):
            xx, yy = x + dx * i, y + dy * i
            if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
                out[yy, xx] = (*SPARK, 255)
    if 0 <= y < S and 0 <= x < S and not m[y, x]:
        out[y, x] = (*c, 255)
    return out


# ------------------------------------------------- pastel bubbles for row 2
_14 = _asset('oiji-14-bubbles.png')
_CS = [(108, 333), (387, 613), (669, 890), (954, 1174), (1234, 1464)]
_RS = [(92, 304), (377, 595), (666, 886)]
# official sheet order is ㄱㄴㄷㄹㅁ / ㅂㅅㅇㅈㅊ / ㅋㅌㅍㅎ
_CELLS = {'ㅂ': (1, 0), 'ㅁ': (0, 4), 'ㅇ': (1, 2), 'ㅍ': (2, 2)}

# outline / shade / body / light / gloss sampled from oiji-14-bubbles.png
_PAL = {
    'ㅂ': [(57, 136, 249), (136, 183, 246), (183, 214, 253), (204, 226, 253), (234, 244, 254)],
    'ㅁ': [(73, 156, 250), (142, 191, 243), (209, 231, 253), (229, 241, 253), (241, 248, 255)],
    'ㅇ': [(217, 132, 250), (234, 181, 250), (245, 214, 253), (247, 229, 253), (252, 243, 255)],
    'ㅍ': [(22, 221, 84), (106, 222, 143), (187, 248, 206), (209, 251, 223), (233, 253, 239)],
}

ROW2_W = 37


def _crop_letter(key, pad=4):
    a = np.array(Image.open(_14).convert('RGB')).astype(np.int16)
    ri, ci = _CELLS[key]
    r0, r1 = _RS[ri]
    c0, c1 = _CS[ci]
    return a[max(0, r0 - pad):r1 + pad + 1, max(0, c0 - pad):c1 + pad + 1]


def _letter_rgba(key, w=ROW2_W):
    """One pastel bubble cut out of the official sheet, eyes removed."""
    a = _crop_letter(key)
    h, wd, _ = a.shape
    close = np.abs(a - 255).sum(2) < 20
    outside = np.zeros((h, wd), bool)
    dq = deque()
    for x in range(wd):
        dq += [(0, x), (h - 1, x)]
    for y in range(h):
        dq += [(y, 0), (y, wd - 1)]
    while dq:
        y, x = dq.popleft()
        if outside[y, x] or not close[y, x]:
            continue
        outside[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < wd and not outside[ny, nx]:
                dq.append((ny, nx))
    m = ~outside
    ys, xs = np.where(m)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    # erase the sheet's own eyes so only our `> <` acting shows
    rgb = a.copy()
    hh, ww = rgb.shape[:2]
    dark = m & (rgb.sum(2) < 330)
    grown = dark.copy()
    for _ in range(2):
        g = grown.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = np.where(grown)
                y2, x2 = yy + dy, xx + dx
                ok = (y2 >= 0) & (y2 < hh) & (x2 >= 0) & (x2 < ww)
                g[y2[ok], x2[ok]] = True
        grown = g & m
    for y in range(hh):
        row = np.where(m[y] & ~grown[y])[0]
        if not len(row):
            continue
        for x in np.where(grown[y])[0]:
            rgb[y, x] = rgb[y, row[np.abs(row - x).argmin()]]

    h0, w0 = m.shape
    th = max(1, int(round(h0 * w / w0)))
    small = np.array(Image.fromarray(rgb.astype(np.uint8)).resize((w, th), Image.BOX)).astype(np.int16)
    alpha = np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((w, th), Image.BOX))
    keep = alpha > 150

    pal = np.array(_PAL[key], np.int16)
    d = ((small[:, :, None, :] - pal[None, None, :, :]).astype(np.int32) ** 2).sum(3)
    qi = d.argmin(2)
    out = np.zeros((th, w, 4), np.uint8)
    out[keep, :3] = pal[qi][keep].astype(np.uint8)
    out[keep, 3] = 255

    # one clean pixel of outline all the way round
    edge = np.zeros_like(keep)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.zeros_like(keep)
        yy, xx = np.where(keep)
        y2, x2 = yy + dy, xx + dx
        ok = (y2 >= 0) & (y2 < th) & (x2 >= 0) & (x2 < w)
        sh[y2[ok], x2[ok]] = True
        edge |= keep & ~sh
    out[edge, :3] = pal[0].astype(np.uint8)
    return out


_LETTERS = {}


def letter(key, w=ROW2_W):
    """Pastel bubble placed bottom-centre in the 64 grid."""
    if (key, w) not in _LETTERS:
        spr = _letter_rgba(key, w)
        h, ww = spr.shape[:2]
        canvas = np.zeros((S, S, 4), np.uint8)
        x0 = int(round(32 - ww / 2.0))
        y0 = BASE_Y - h + 1
        canvas[y0:y0 + h, x0:x0 + ww] = spr
        _LETTERS[(key, w)] = canvas
    return _LETTERS[(key, w)]


# ------------------------------------------------------------------- rows
def idle(i):
    """Row 1: round aurora bubble, solid black eyes, blink, soft slosh."""
    if i == 3:
        f = bubble(flow=0.03 * 3, wob=0.012, phase=3 * 1.1)
        f = eyes_closed(f, curved=True)
        f = A.squash(f, 0.98, BASE_Y)
    else:
        cy = [EXE_CY, EXE_CY + 1, EXE_CY - 1][i]
        f = bubble(flow=0.03 * i, wob=0.012, phase=i * 1.1)
        f = eyes_open(f, cy=cy)
        f = A.squash(f, [1.0, 0.965, 1.015][i], BASE_Y)
    return A.anchor(f, BASE_Y)


def emotion(i):
    """Row 2: squeeze small -> boil over -> the ㅍ catches with a 뿅! -> pastel ㅍ."""
    if i == 0:
        # 힘 주며 작아짐
        f = bubble(32.0, CY + 1.0, 15.0, 13.2, flow=0.02, dots=False)
        f = A.anchor(f, BASE_Y)
        f = strain_eyes(f, cy=BASE_Y - 13.0, gap=5.5)
        f = strain_marks(f, [(10, 34, -1, 0, 3), (53, 38, 1, 0, 3)])
        f = _drop(f, 45, 22, 1, AUR_LAV)
        f = _drop(f, 17, 45, 1, AUR_CYAN)
        f = _drop(f, 49, 43, 1, AUR_PINK)
        return f
    if i == 1:
        # 더 쪼그라들며 부글부글
        f = bubble(32.0, CY + 1.5, 12.8, 11.0, wob=0.05, phase=1.6, flow=0.05,
                   dots=False)
        f = A.anchor(f, BASE_Y)
        f = strain_eyes(f, cy=BASE_Y - 11.0, gap=4.8)
        for x, y, r, c in ((17, 29, 1, AUR_CYAN), (46, 24, 1, AUR_MINT),
                           (50, 33, 2, AUR_LAV), (14, 38, 1, AUR_PINK),
                           (38, 15, 1, AUR_VIOL), (27, 12, 1, AUR_CYAN)):
            f = _drop(f, x, y, r, c)
        f = strain_marks(f, [(9, 47, -1, 1, 2), (54, 47, 1, 1, 2)])
        return f
    if i == 2:
        # 형태를 갖추며 뿅!
        f = letter('ㅍ', 28).copy()
        f = A.anchor(f, BASE_Y)
        ys, xs = np.where(A.mask_of(f))
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        f = strain_eyes(f, cx=cx, cy=cy + 1.0, gap=4.5)
        f = burst(f, cx, cy, max(x1 - x0, y1 - y0) / 2.0)
        return f
    # 완성: pastel ㅍ bubble with clear eyes
    f = letter('ㅍ', 38).copy()
    f = A.anchor(f, BASE_Y)
    ys, xs = np.where(A.mask_of(f))
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    f = eyes_open(f, cx=(x0 + x1) / 2.0, cy=(y0 + y1) / 2.0 + 0.5, gap=6.0,
                  w=5, h=9)
    f = spark(f, [(x0 - 3, y0 + 2, AUR_MINT), (x1 + 3, y0 + 6, AUR_PINK),
                  (x0 + 2, y1 + 3, AUR_LAV)])
    return A.anchor(f, BASE_Y)


def work(i):
    """Row 3: leans hard into the job, eyes squeezed flat, pixel sparks fly."""
    f = bubble(flow=0.06 * i, phase=i * 0.9, wob=0.018)
    f = eyes_narrow(f, keep=0.36, gap=5.0, cy=EXE_CY + 1)
    f = A.shift(f, [1, 3, 4, 2][i], [0, 1, 1, -1][i])
    f = A.shear(f, [0.13, 0.21, 0.25, 0.17][i], BASE_Y)
    f = A.squash(f, [0.97, 0.92, 0.90, 0.95][i], BASE_Y)
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x0, x1, y0 = xs.min(), xs.max(), ys.min()
    # a bigger twinkle cluster on the working side, changing every frame
    f = _star(f, x1 + 3, y0 + 9, AUR_MINT, arms=2)
    f = _star(f, x1 + 2, y0 + 18, AUR_PINK, arms=1)
    if i >= 1:
        f = _star(f, x0 - 3, y0 + 12, AUR_CYAN, arms=2)
    if i == 2:
        f = _star(f, x1 + 6, y0 + 14, WHITE, arms=1)
        f = sweat(f, x0 - 2, y0 + 26, (0x9F, 0xD8, 0xF2))
    if i == 3:
        f = _star(f, x0 - 4, y0 + 6, AUR_LAV, arms=1)
    return A.anchor(f, BASE_Y)


def sleep(i):
    """Row 4: settles low, eyes shut, Z climbing."""
    f = bubble(flow=0.02 * i, wob=0.015, phase=i * 0.7)
    f = A.squash(f, [0.90, 0.92, 0.89, 0.915][i], BASE_Y)
    f = eyes_closed(f, cy=EXE_CY + 2, curved=True)
    f = A.wave(f, 0.8, 0.25, i * 1.1, base=34, spread=0.9)
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x1, y0 = xs.max(), ys.min()
    f = zeds(f, [1, 2, 2, 3][i], y0=[y0 - 1, y0 - 3, y0 - 6, y0 - 8][i],
             x0=[x1 - 2, x1 - 3, x1 - 2, x1 - 3][i])
    return A.anchor(f, BASE_Y)


def walk(i):
    """Row 5: no feet - drifts through the air, bobbing to the right."""
    bob = [-3, 0, -4, -1][i]
    tilt = [0.10, 0.15, 0.07, 0.12][i]
    f = bubble(flow=0.07 * i, wob=0.02, phase=i * 1.3)
    f = eyes_open(f)
    f = A.shift(f, 2, bob)
    f = A.shear(f, tilt, BASE_Y + 10)
    f = A.squash(f, [1.01, 0.985, 1.02, 0.99][i], BASE_Y - 4)
    return A.anchor(f, BASE_Y - 3)


def rows():
    return [[idle(i) for i in range(4)], [emotion(i) for i in range(4)],
            [work(i) for i in range(4)], [sleep(i) for i in range(4)],
            [walk(i) for i in range(4)]]
