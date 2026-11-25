"""Oiji (Pickle) frames built on the approved 03-oiji-bubble reference.

Oiji's first form is a soap bubble with two big black bar eyes - no sprout,
not the green ㅍ.

What 장현 님's 2026-11-25 09:34 and 10:05 feedback settled:

* The bubble is ~78% of the old full-cell circle (36x34 px inside the 64 grid),
  so it lines up with the 14 ㄱ~ㅎ Pickle bubbles in `oiji-14-bubbles.png`.
* It has to read as a bubble, not a white ball: the middle is hollow (alpha 0,
  the room shows straight through), and only a 1px iridescent rim, a white
  gloss blob on the upper left and a faint reflection on the lower right are
  painted.  That still satisfies the #5 check - alpha is only ever 0 or 255.
* Row 2 is the transformation beat: shrink with effort -> boil and wobble ->
  the ㅍ shape catches with a `뿅!` burst -> the finished pastel ㅍ bubble with
  clear eyes and a sparkle.  The letter itself is cut out of
  `oiji-14-bubbles.png` with its own colour, outline and gloss intact.
* The black eyes get a 1px pale keyline: the room can be the dark LCD
  (`#12102a`), where bare black eyes on a hollow bubble would disappear.
"""
import math
import os

import numpy as np
from PIL import Image

import anim as A

S = 64
BASE_Y = 55

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


WHITE = (0xFD, 0xFD, 0xFE)
RIM = (0x93, 0xA3, 0xBE)          # rim base: reads on both the cream and the dark LCD
RIM_TOP = (0xB9, 0xC2, 0xE2)      # pale lavender at the crown
RIM_HI = (0xD7, 0xDD, 0xF2)       # where the light hits (upper left)
RIM_MINT = (0x9C, 0xCB, 0xC7)
RIM_SKY = (0x9B, 0xB6, 0xDA)
RIM_PINK = (0xCC, 0xB0, 0xC8)
RIM_LAV = (0xB6, 0xBC, 0xE0)
REFL = (0xD3, 0xDE, 0xF0)         # faint reflection on the lower right
HALO = (0xAE, 0xBA, 0xCF)         # keyline under the black eyes
TINT_MINT = (0xD6, 0xF0, 0xEC)
TINT_PINK = (0xF6, 0xE0, 0xEE)
TINT_LAV = (0xE0, 0xE2, 0xF6)
TINT_GOLD = (0xF7, 0xF1, 0xDC)
EYE = (0x12, 0x12, 0x16)
GLINT = (0xFF, 0xFF, 0xFF)
ZCOL = (0xA9, 0xB6, 0xC9)

PALETTE = [WHITE, RIM, REFL, TINT_MINT, TINT_PINK, TINT_LAV, TINT_GOLD, EYE, GLINT]

# ------------------------------------------------------------- body geometry
# 36x34 px bubble inside the 64 logical grid (was 46x46 = a full 128 cell).
RX, RY = 17.5, 17.0
CY = 38.5
BODY = None          # filled in _build_base()
SIL = None


def _field(cx, cy, rx, ry, n=2.15, wob=0.0, phase=0.0):
    """Normalised superellipse distance; <= 1 is inside the bubble.

    `wob` ripples the radius three times round the rim, which is what makes the
    frame-2 silhouette look like it is boiling.
    """
    yy, xx = np.mgrid[0:S, 0:S]
    d = (np.abs((xx - cx) / rx) ** n + np.abs((yy - cy) / ry) ** n) ** (1.0 / n)
    if wob:
        th = np.arctan2(cy - yy, xx - cx)
        d = d / (1.0 + wob * np.sin(3.0 * th + phase))
    return d


def _super(cx, cy, rx, ry, n=2.15):
    return _field(cx, cy, rx, ry, n) <= 1.0


def _erode8(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        nxt = cur.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                sh = np.zeros_like(cur)
                ys, xs = np.where(cur)
                ys2, xs2 = ys + dy, xs + dx
                ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
                sh[ys2[ok], xs2[ok]] = True
                nxt &= sh
        cur = nxt
    return cur


def _band(mask, d0, d1):
    """Pixels whose depth from the edge is d0..d1 (1 = the outer ring itself)."""
    inner = mask if d0 <= 1 else _erode8(mask, d0 - 1)
    return inner & ~_erode8(mask, d1)


def _angle_map(cx, cy):
    """Compass angle per pixel: 0 = right, 90 = up, 180 = left, 270 = down."""
    yy, xx = np.mgrid[0:S, 0:S]
    return np.degrees(np.arctan2(cy - yy, xx - cx)) % 360.0


def _in_arc(ang, lo, hi):
    if lo <= hi:
        return (ang >= lo) & (ang <= hi)
    return (ang >= lo) | (ang <= hi)


def _arc_pts(cx, cy, rx, ry, a0, a1):
    """1px-wide points along an ellipse arc (degrees, 90 = up)."""
    pts = []
    n = max(8, int(abs(a1 - a0) * 1.6))
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        x = int(round(cx + rx * math.cos(a)))
        y = int(round(cy - ry * math.sin(a)))
        if not pts or pts[-1] != (x, y):
            pts.append((x, y))
    return pts


def _erode(mask, n=1):
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


def _clean(img, passes=2):
    """Drop isolated single pixels left by the reference's soft edges."""
    out = img.copy()
    for _ in range(passes):
        m = A.mask_of(out)
        ys, xs = np.where(m)
        for y, x in zip(ys, xs):
            nb = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy or dx:
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < S and 0 <= nx < S and m[ny, nx]:
                            nb += 1
            if nb <= 1:
                out[y, x] = 0
    return out


def _crop(img, mask, pad=0):
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min() - pad, ys.max() + pad, xs.min() - pad, xs.max() + pad
    y0, x0 = max(0, y0), max(0, x0)
    return img[y0:y1 + 1, x0:x1 + 1].copy()


def paint(img, spr, x, y):
    h, w = spr.shape[:2]
    m = spr[..., 3] > 0
    ys, xs = np.where(m)
    ys2, xs2 = ys + y, xs + x
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    img[ys2[ok], xs2[ok]] = spr[ys[ok], xs[ok]]
    return img


def _eye_sprites():
    """The approved 5x11 bar eye (with its 2x2 glint) pulled from the reference."""
    base = _clean(_load64(_asset('03-oiji-bubble-128.png')))
    m = A.mask_of(base)
    interior = _erode(m, 2)
    idx = A.nearest_index(base, PALETTE)
    eyem = m & interior & (idx == 7)
    eyes = []
    for c in A.components(eyem):
        ys = np.where(c)[0]
        if ys.max() - ys.min() >= 6 and c.sum() >= 10:
            eyes.append(c)
    eyes.sort(key=lambda c: np.where(c)[1].mean())
    return [_crop(base, e) for e in eyes]


def _load64(path):
    """128px reference -> 64x64 RGBA with the backdrop lifted out."""
    im = Image.open(path).convert('RGBA')
    if im.size != (S, S):
        im = im.resize((S, S), Image.NEAREST)
    a = np.array(im)
    rgb = a[..., :3].astype(np.int32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    from collections import Counter
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0], np.int32)
    close = np.abs(rgb - bg).sum(2) < 34
    seen = np.zeros((S, S), bool)
    stack = []
    for x in range(S):
        stack += [(0, x), (S - 1, x)]
    for y in range(S):
        stack += [(y, 0), (y, S - 1)]
    while stack:
        y, x = stack.pop()
        if seen[y, x] or not close[y, x]:
            continue
        seen[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < S and 0 <= nx < S and not seen[ny, nx]:
                stack.append((ny, nx))
    out = np.array(im)
    out[..., 3] = np.where(seen, 0, 255)
    return out


EYE_SPRS = _eye_sprites()
EYE_H, EYE_W = EYE_SPRS[0].shape[:2]
EYE_GAP = 5.0                       # eye pair = 5 + 5 + 5 = 15 of 36 px (42%)


def bubble(cx=32.0, cy=CY, rx=RX, ry=RY, wob=0.0, phase=0.0, dots=True):
    """A see-through soap bubble: hollow middle, thin iridescent rim, glints.

    Only the rim (1px, with a 2nd px along the lower right), the white gloss blob
    on the upper left and a faint reflection are opaque.  Everything else stays
    alpha 0 so the room shows straight through the film.
    """
    out = np.zeros((S, S, 4), np.uint8)
    body = _field(cx, cy, rx, ry, wob=wob, phase=phase) <= 1.0
    rim = body & ~_erode(body, 1)      # 4-connected: the 1px ring stays unbroken
    ang = _angle_map(cx, cy)

    # iridescent rim: pale lavender crown, mint left, sky bottom, pink lower right
    col = np.empty((S, S, 3), float)
    col[:] = RIM
    for centre, tint, w in ((92, RIM_TOP, 0.85), (158, RIM_HI, 0.7),
                            (208, RIM_MINT, 0.7), (268, RIM_SKY, 0.85),
                            (320, RIM_PINK, 0.5), (14, RIM_LAV, 0.75)):
        c = np.clip(np.cos(np.radians(ang - centre)), 0.0, None) ** 2 * w
        col = col * (1 - c[..., None]) + np.array(tint, float) * c[..., None]
    out[rim, :3] = col[rim].round().astype(np.uint8)
    out[rim, 3] = 255

    # the film thickens along the lower right where the light bends through it
    thick = _band(body, 2, 2) & _in_arc(ang, 288, 24)
    out[thick, :3] = REFL
    out[thick, 3] = 255

    # upper-left gloss: a small rounded white blob hugging the rim, plus one fleck
    gx = int(round(cx - rx * 0.68))
    gy = int(round(cy - ry * 0.68))
    for dx, dy in ((1, 0), (0, 0), (0, 1), (1, 1), (0, 2)):
        x, y = gx + dx, gy + dy
        if 0 <= y < S and 0 <= x < S and not out[y, x, 3]:
            out[y, x] = (*GLINT, 255)
    x, y = int(round(cx - rx * 0.86)), int(round(cy - ry * 0.42))
    if 0 <= y < S and 0 <= x < S and not out[y, x, 3]:
        out[y, x] = (*GLINT, 255)

    if dots and rx > 12:
        # two 1px flecks caught on the film, well away from the hollow middle
        for x, y, c in ((cx - rx * 0.30, cy - ry * 0.86, TINT_MINT),
                        (cx + rx * 0.92, cy + ry * 0.36, TINT_PINK)):
            yy, xx = int(round(y)), int(round(x))
            if 0 <= yy < S and 0 <= xx < S and not out[yy, xx, 3]:
                out[yy, xx] = (*c, 255)
    return out


def _build_base():
    global BODY, SIL
    BODY = _super(32.0, CY, RX, RY)
    SIL = _super(32.0, CY, RX + 1.0, RY + 1.0)
    return bubble()


BASE = _build_base()
EYE_CY = CY - 2.0                   # eyes sit a touch above centre
BOT = np.where(BODY)[0].max()


# ---------------------------------------------------------------- eye acting
def _wipe_eyes(img):
    """Lift the black bars, their glint and the keyline back out of the film.

    The middle of the bubble is hollow now, so wiping means clearing to alpha 0:
    there is no white film left to grow back over the old eyes.
    """
    out = img.copy()
    m = A.mask_of(out)
    dark = m & (out[..., :3].astype(np.int16).sum(2) < 320)
    dil = dark.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ys, xs = np.where(dark)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
            dil[ys2[ok], xs2[ok]] = True
    out[dil] = 0
    return out


def _keyline(spr):
    """1px pale keyline under an eye shape so black still reads on the dark LCD."""
    h, w = spr.shape[:2]
    big = np.zeros((h + 2, w + 2, 4), np.uint8)
    big[1:-1, 1:-1] = spr
    m = A.mask_of(big)
    grow = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ys, xs = np.where(m)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < h + 2) & (xs2 >= 0) & (xs2 < w + 2)
            grow[ys2[ok], xs2[ok]] = True
    big[grow & ~m] = (*HALO, 255)
    return big


def eyes_open(img, cx=32.0, cy=EYE_CY, gap=EYE_GAP, spr=None):
    out = img.copy()
    for i, s in enumerate(EYE_SPRS):
        spr_img = s if spr is None else spr
        w = spr_img.shape[1]
        x = int(round(cx + (-1 if i == 0 else 1) * gap - w / 2.0))
        y = int(round(cy - spr_img.shape[0] / 2.0))
        paint(out, _keyline(spr_img), x - 1, y - 1)
    return out


def eyes_closed(img, cx=32.0, cy=EYE_CY, curved=True):
    """Eyes shut: the bars wipe away and a short lid line remains."""
    out = _wipe_eyes(img)
    lid = np.zeros((2, 5, 4), np.uint8)
    for i in range(5):
        d = 1 if (curved and abs(i - 2) < 2) else 0
        lid[d, i] = (*EYE, 255)
    spr = _keyline(lid)
    for sgn in (-1, 1):
        x = int(round(cx + sgn * EYE_GAP)) - 2
        y = int(round(cy))
        paint(out, spr, x - 1, y - 1)
    return out


def eyes_narrow(img, cx=32.0, cy=EYE_CY, keep=0.55):
    """Half-lidded: only the bottom part of the bar eye stays."""
    out = _wipe_eyes(img)
    top = int(round(cy - EYE_H / 2.0))
    cut = top + int(round(EYE_H * (1.0 - keep))) - 1
    for i, sp in enumerate(EYE_SPRS):
        part = sp[cut - top:, :].copy()
        # soften the lid: round off the two bottom corners
        for sx in (0, part.shape[1] - 1):
            part[-1, sx] = 0
        x = int(round(cx + (-1 if i == 0 else 1) * EYE_GAP - part.shape[1] / 2.0))
        paint(out, _keyline(part), x - 1, cut - 1)
    return out


# 4x7 chevron, 2 dots thick, so `> <` still reads at 128px
_CHEV = ["...##",
         "...##",
         "..##.",
         "##...",
         "..##.",
         "...##",
         "...##"]


def strain_eyes(img, cx=32.0, cy=EYE_CY, gap=6.0):
    """`> <` - eyes screwed shut with effort while it transforms."""
    out = _wipe_eyes(img)
    x0, y0 = int(round(cx)), int(round(cy))
    left = np.array([[c == '#' for c in row] for row in _CHEV])
    for sgn in (-1, 1):                    # -1 = left eye '>', +1 = right '<'
        arr = left[:, ::-1] if sgn < 0 else left
        spr = np.zeros(arr.shape + (4,), np.uint8)
        spr[arr] = (*EYE, 255)
        hh, ww = arr.shape
        x = int(round(x0 + sgn * gap - ww / 2.0))
        y = y0 - hh // 2
        paint(out, _keyline(spr), x - 1, y - 1)
    return out


def strain_marks(img, spots, col=(0x9F, 0xB0, 0xC8)):
    """Short effort lines just outside the silhouette."""
    out = img.copy()
    m = A.mask_of(out)
    for (x, y, dx, dy, n) in spots:
        for i in range(n):
            xx, yy = int(round(x + dx * i)), int(round(y + dy * i))
            if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
                out[yy, xx] = (*col, 255)
    return out


def sweat(img, x, y, col=(0x8F, 0xC3, 0xE4)):
    """A little teardrop: one dot on top, two dots below."""
    out = img.copy()
    m = A.mask_of(out)
    for (dx, dy) in ((1, 0), (0, 1), (1, 1), (1, 2)):
        xx, yy = x + dx, y + dy
        if 0 <= yy < S and 0 <= xx < S and not m[yy, xx]:
            out[yy, xx] = (*col, 255)
    return out


def zeds(img, count, y0=32, x0=45):
    out = img.copy()
    m = A.mask_of(out)
    for k in range(count):
        x, y = x0 + k * 3, y0 - k * 7
        for _ in range(8):
            if not m[max(0, y - 1):y + 6, max(0, x - 1):x + 7].any():
                break
            x += 3
            y -= 2
        A.zed(out, x, y, ZCOL)
    return out


SPARK = (0xB6, 0xC4, 0xDA)


def _sq(x, y, r):
    m = np.zeros((S, S), bool)
    m[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1] = True
    return m


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


def _drop(img, x0, y0, r=1, col=RIM_SKY):
    """A tiny hollow droplet: 1px ring, one white fleck when it is 3px wide."""
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
            out[y, x] = (*GLINT, 255)
    return out


def burst(img, cx, cy, r, rays=5):
    """The `뿅!` moment: rays off the silhouette plus four pastel twinkles."""
    out = img.copy()
    for k in range(8):
        a = math.radians(k * 45 + 22.5)
        for i in range(rays):
            rr = r + 1.5 + i
            x = int(round(cx + rr * math.cos(a)))
            y = int(round(cy - rr * math.sin(a)))
            if 0 <= y < S and 0 <= x < S and not out[y, x, 3]:
                out[y, x] = (*(GLINT if i < 2 else SPARK), 255)
    for sx, sy, c in ((-1, -1, TINT_MINT), (1, -1, TINT_PINK),
                      (-1, 1, TINT_LAV), (1, 1, GLINT)):
        x = int(round(cx + sx * (r + 2) * 0.78))
        y = int(round(cy + sy * (r + 2) * 0.78))
        out = _star(out, x, y, c)
    return out


def _star(img, x, y, c, arms=2):
    """A pastel-centred star with `arms`-long grey rays."""
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

# colours sampled straight out of oiji-14-bubbles.png:
# outline / shade / body / light / gloss
_PAL = {
    'ㅂ': [(57, 136, 249), (136, 183, 246), (183, 214, 253), (204, 226, 253), (234, 244, 254)],
    'ㅁ': [(73, 156, 250), (142, 191, 243), (209, 231, 253), (229, 241, 253), (241, 248, 255)],
    'ㅇ': [(217, 132, 250), (234, 181, 250), (245, 214, 253), (247, 229, 253), (252, 243, 255)],
    'ㅍ': [(22, 221, 84), (106, 222, 143), (187, 248, 206), (209, 251, 223), (233, 253, 239)],
}

ROW2_W = 36          # same body width as the colourless bubble


def _crop_letter(key, pad=4):
    a = np.array(Image.open(_14).convert('RGB')).astype(np.int16)
    ri, ci = _CELLS[key]
    r0, r1 = _RS[ri]
    c0, c1 = _CS[ci]
    return a[max(0, r0 - pad):r1 + pad + 1, max(0, c0 - pad):c1 + pad + 1]


def _letter_rgba(key, w=ROW2_W):
    """One pastel bubble cut out of the official sheet, eyes removed."""
    from collections import deque
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
    if i == 3:
        f = eyes_closed(BASE, curved=False)
        f = A.squash(f, 0.985, BASE_Y)
    else:
        cy = [EYE_CY, EYE_CY + 1, EYE_CY - 1][i]
        f = eyes_open(BASE, cy=cy)
        f = A.squash(f, [1.0, 0.955, 1.02][i], BASE_Y + (1 if i == 1 else 0))
    return A.anchor(f, BASE_Y)


def emotion(i):
    """Row 2: squeeze small -> boil over -> the ㅍ catches with a 뿅! -> pastel ㅍ."""
    if i == 0:
        # 힘 주며 작아짐: the bubble pinches in, a few droplets shaken loose
        f = bubble(32.0, CY, 13.4, 11.9, dots=False)
        f = A.anchor(f, BASE_Y)
        f = strain_eyes(f, cy=BASE_Y - 11.9 - 2.0, gap=5.0)
        f = strain_marks(f, [(15, 32, -1, 0, 3), (49, 36, 1, 0, 3)])
        f = _drop(f, 44, 24, 1, RIM_LAV)
        f = _drop(f, 19, 45, 1, RIM_SKY)
        f = _drop(f, 48, 42, 1, RIM_PINK)
        return f
    if i == 1:
        # 더 쪼그라들며 부글부글: lumpy rim, bubbles boiling up all around
        f = bubble(32.0, CY, 11.6, 9.6, wob=0.16, phase=0.7, dots=False)
        f = A.anchor(f, BASE_Y)
        f = strain_eyes(f, cy=BASE_Y - 9.6 - 2.0, gap=4.5)
        for x, y, r, c in ((17, 29, 1, RIM_SKY), (46, 25, 1, RIM_MINT),
                           (50, 34, 2, RIM_LAV), (14, 39, 1, RIM_PINK),
                           (38, 16, 1, RIM_TOP), (27, 13, 1, RIM_SKY)):
            f = _drop(f, x, y, r, c)
        f = strain_marks(f, [(11, 47, -1, 1, 2), (53, 47, 1, 1, 2)])
        return f
    if i == 2:
        # 형태를 갖추며 뿅!: the ㅍ catches and the burst goes off around it
        f = letter('ㅍ', 27).copy()
        f = A.anchor(f, BASE_Y)
        ys, xs = np.where(A.mask_of(f))
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        f = strain_eyes(f, cx=cx, cy=cy + 1.0, gap=4.5)
        f = burst(f, cx, cy, max(x1 - x0, y1 - y0) / 2.0)
        return f
    # 완성: the pastel ㅍ bubble, clear eyes, a sparkle or two
    f = letter('ㅍ', 36).copy()
    f = A.anchor(f, BASE_Y)
    ys, xs = np.where(A.mask_of(f))
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    f = eyes_open(f, cx=(x0 + x1) / 2.0, cy=(y0 + y1) / 2.0 + 0.5, gap=6.0)
    f = spark(f, [(x0 - 3, y0 + 2, TINT_MINT), (x1 + 3, y0 + 6, TINT_PINK),
                  (x0 + 2, y1 + 3, TINT_LAV)])
    return A.anchor(f, BASE_Y)


def work(i):
    """Row 3: leans into the job, eyes narrow, pixel sparks fly outside."""
    f = eyes_narrow(BASE)
    f = A.shear(f, [0.04, 0.07, 0.09, 0.06][i], BASE_Y)
    f = A.squash(f, [1.0, 0.98, 1.0, 0.99][i], BASE_Y)
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x0, x1, y0 = xs.min(), xs.max(), ys.min()
    f = spark(f, {0: [(x1 + 2, y0 + 12, TINT_MINT)],
                  1: [(x1 + 2, y0 + 8, TINT_MINT), (x1 + 3, y0 + 16, TINT_PINK)],
                  2: [(x0 - 3, y0 + 10, TINT_PINK), (x1 + 3, y0 + 7, TINT_LAV),
                      (x1 + 2, y0 + 18, TINT_MINT)],
                  3: [(x0 - 3, y0 + 6, TINT_LAV), (x1 + 2, y0 + 14, TINT_PINK)]}[i])
    return A.anchor(f, BASE_Y)


def sleep(i):
    """Row 4: settles low, eyes shut, Z climbing."""
    f = eyes_closed(BASE, cy=EYE_CY + 1, curved=True)
    f = A.squash(f, [0.88, 0.90, 0.87, 0.895][i], BASE_Y)
    f = A.wave(f, 0.8, 0.25, i * 1.1, base=34, spread=0.9)
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x1, y0 = xs.max(), ys.min()
    f = zeds(f, [1, 2, 2, 3][i], y0=[y0 - 2, y0 - 5, y0 - 7, y0 - 9][i],
             x0=[x1 - 3, x1 - 3, x1 - 2, x1 - 2][i])
    return A.anchor(f, BASE_Y)


def walk(i):
    """Row 5: no feet - oiji drifts through the air, bobbing to the right."""
    bob = [-3, 0, -4, -1][i]
    tilt = [0.075, 0.115, 0.045, 0.095][i]
    f = eyes_open(BASE)
    f = A.shift(f, 2, bob)
    f = A.shear(f, tilt, BASE_Y + 10)
    f = A.squash(f, [1.01, 0.985, 1.02, 0.99][i], BASE_Y - 4)
    return A.anchor(f, BASE_Y - 3)


def rows():
    return [[idle(i) for i in range(4)], [emotion(i) for i in range(4)],
            [work(i) for i in range(4)], [sleep(i) for i in range(4)],
            [walk(i) for i in range(4)]]
