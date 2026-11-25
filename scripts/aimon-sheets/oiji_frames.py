"""Oiji (Pickle) frames built on the approved 03-oiji-bubble reference.

Oiji's first form is a colourless soap bubble (thin grey rim, faint iridescent
flecks) with two big black bar eyes - no sprout, not the green ㅍ.

Two things changed after 장현 님's 2026-11-25 09:34 feedback:

* The bubble is ~78% of the old full-cell circle (36x34 px inside the 64 grid),
  so it lines up with the 14 ㄱ~ㅎ Pickle bubbles in `oiji-14-bubbles.png`
  instead of bulging over the whole cell.  The reference PNG filled its 128
  cell edge to edge, so its silhouette is redrawn at the new size with the same
  palette / rim / eye pixels.
* Row 2 (consonant transformation) no longer flattens the official 14-bubble
  sheet into a white mask.  Each frame cuts one pastel bubble out of
  `oiji-14-bubbles.png` with its own colour, outline and rounded gloss intact,
  then only the effort acting ( `> <` eyes, strain lines, sweat, sparkles ) is
  layered on top.
"""
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
RIM = (0xC2, 0xCA, 0xDA)
RIM_IN = (0xE9, 0xEE, 0xF6)
TINT_MINT = (0xD6, 0xF0, 0xEC)
TINT_PINK = (0xF6, 0xE0, 0xEE)
TINT_LAV = (0xE0, 0xE2, 0xF6)
TINT_GOLD = (0xF7, 0xF1, 0xDC)
EYE = (0x12, 0x12, 0x16)
GLINT = (0xFF, 0xFF, 0xFF)
ZCOL = (0xA9, 0xB6, 0xC9)

PALETTE = [WHITE, RIM, RIM_IN, TINT_MINT, TINT_PINK, TINT_LAV, TINT_GOLD, EYE, GLINT]

# ------------------------------------------------------------- body geometry
# 36x34 px bubble inside the 64 logical grid (was 46x46 = a full 128 cell).
RX, RY = 17.5, 17.0
CY = 38.5
BODY = None          # filled in _build_base()
SIL = None


def _super(cx, cy, rx, ry, n=2.15):
    yy, xx = np.mgrid[0:S, 0:S]
    d = (np.abs((xx - cx) / rx) ** n + np.abs((yy - cy) / ry) ** n) ** (1.0 / n)
    return d <= 1.0


def _dilate4(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        g = cur.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ys, xs = np.where(cur)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
            g[ys2[ok], xs2[ok]] = True
        cur = g
    return cur


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


def _dot(img, x, y, col, r=1):
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + 0.2:
                xx, yy = int(round(x)) + dx, int(round(y)) + dy
                if 0 <= yy < S and 0 <= xx < S and A.mask_of(img)[yy, xx]:
                    img[yy, xx] = (*col, 255)
    return img


def _build_base():
    """Colourless soap bubble: white film, 1px grey rim, faint pastel flecks."""
    global BODY, SIL
    BODY = _super(32.0, CY, RX, RY)
    SIL = _super(32.0, CY, RX + 1.0, RY + 1.0)
    out = np.zeros((S, S, 4), np.uint8)
    A.put(out, _dilate4(BODY) & ~BODY, RIM)          # 1px outline, continuous
    A.put(out, BODY, WHITE)
    A.put(out, A.inner_band(BODY, 1, 1), RIM_IN)     # soft inner edge
    ys, xs = np.where(BODY)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:S, 0:S]
    # the lower film thickens into a soft shade that follows the bottom curve
    inner2 = _erode(BODY, 2)
    inner1 = _erode(BODY, 1)
    lens = ((xx - (x0 + w * 0.50)) / (w * 0.62)) ** 2 + ((yy - (y1 - h * 0.20)) / (h * 0.34)) ** 2 <= 1.0
    A.put(out, lens & inner2, (0xF6, 0xF8, 0xFC))
    deep = ((xx - (x0 + w * 0.50)) / (w * 0.44)) ** 2 + ((yy - (y1 - h * 0.02)) / (h * 0.20)) ** 2 <= 1.0
    A.put(out, deep & inner1, (0xEE, 0xF1, 0xFA))
    # faint iridescent streaks caught along the film (subtle at this size)
    film = _erode(BODY, 1) & ~_erode(BODY, 8)
    for (fx, fy, dx, dy, n, col) in ((x0 + w * 0.20, y0 + h * 0.32, 1, 1, 3, TINT_MINT),
                                     (x0 + w * 0.82, y0 + h * 0.52, 0, 1, 3, TINT_PINK),
                                     (x0 + w * 0.32, y0 + h * 0.88, 1, 0, 3, TINT_GOLD)):
        for i in range(n):
            px, py = int(round(fx + dx * i)), int(round(fy + dy * i))
            if 0 <= py < S and 0 <= px < S and film[py, px]:
                out[py, px] = (*col, 255)
    return out


BASE = _build_base()
EYE_CY = CY - 2.0                   # eyes sit a touch above centre
BOT = np.where(BODY)[0].max()


# ---------------------------------------------------------------- eye acting
def _nearest_fill(img, region, source):
    """Grow `source` pixels into `region` (multi-source BFS), copying colours."""
    from collections import deque
    out = img.copy()
    todo = region & ~source
    dq = deque()
    ys, xs = np.where(source)
    for y, x in zip(ys, xs):
        dq.append((y, x))
    seen = source.copy()
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if not (0 <= ny < S and 0 <= nx < S):
                continue
            if seen[ny, nx]:
                continue
            seen[ny, nx] = True
            if todo[ny, nx]:
                out[ny, nx] = out[y, x]
            dq.append((ny, nx))
    return out


def _wipe_eyes(img):
    """Clear the black bars (and their glints) back to the film around them."""
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
    body = BODY if BODY is not None else m
    region = dil & body
    source = m & ~dil
    return _nearest_fill(out, region, source)


def eyes_open(img, cx=32.0, cy=EYE_CY, gap=EYE_GAP, spr=None):
    out = img.copy()
    for i, s in enumerate(EYE_SPRS):
        spr_img = s if spr is None else spr
        w = spr_img.shape[1]
        x = int(round(cx + (-1 if i == 0 else 1) * gap - w / 2.0))
        y = int(round(cy - spr_img.shape[0] / 2.0))
        paint(out, spr_img, x, y)
    return out


def eyes_closed(img, cx=32.0, cy=EYE_CY, curved=True):
    """Eyes shut: the bars wipe away and a short lid line remains."""
    out = _wipe_eyes(img)
    body = A.mask_of(img)
    for sgn in (-1, 1):
        x0 = int(round(cx + sgn * EYE_GAP))
        y0 = int(round(cy))
        for dx in range(-2, 3):
            d = (1 if abs(dx) < 2 else 0) if curved else 0
            yy, xx = y0 + d, x0 + dx
            if 0 <= yy < S and 0 <= xx < S and body[yy, xx]:
                out[yy, xx] = (*EYE, 255)
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
        paint(out, part, x, cut)
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
        spr = left[:, ::-1] if sgn < 0 else left
        hh, ww = spr.shape
        x = int(round(x0 + sgn * gap - ww / 2.0))
        y = y0 - hh // 2
        for dy in range(hh):
            for dx in range(ww):
                if not spr[dy, dx]:
                    continue
                yy, xx = y + dy, x + dx
                if 0 <= yy < S and 0 <= xx < S:
                    out[yy, xx] = (*EYE, 255)
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
    """Row 2: the bubble tries to become a different consonant every frame."""
    key = ['ㅂ', 'ㅁ', 'ㅇ', 'ㅍ'][i]
    f = letter(key)
    ys, xs = np.where(A.mask_of(f))
    y0, y1 = ys.min(), ys.max()
    cy = y0 + (y1 - y0) * [0.43, 0.46, 0.47, 0.46][i]
    f = strain_eyes(f, cy=cy, gap=[6.0, 6.0, 7.0, 6.0][i])
    # effort: strain lines + sparkles + a sweat drop while it squeezes
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x0, x1, yb0, yb1 = xs.min(), xs.max(), ys.min(), ys.max()
    marks = {
        0: [(x0 - 2, yb0 + 5, -1, 0, 3), (x1 + 2, yb0 + 8, 1, 0, 2)],
        1: [(x0 - 2, yb0 + 7, -1, 0, 3), (x1 + 2, yb0 + 4, 1, 0, 3), (x0 + 6, yb1 + 2, 0, 1, 2)],
        2: [(x0 - 2, yb0 + 8, -1, -1, 3), (x1 + 2, yb0 + 6, 1, -1, 3), (x1 + 2, y0 + 3, 1, 0, 2)],
        3: [(x0 - 2, yb0 + 3, -1, -1, 3), (x1 + 2, yb0 + 3, 1, -1, 3),
            (x0 - 1, yb1 - 2, -1, 1, 2), (x1 + 1, yb1 - 3, 1, 1, 2)],
    }[i]
    f = strain_marks(f, marks)
    if i >= 1:
        f = sweat(f, x1 + 2, yb0 - 1)
    if i == 3:
        f = spark(f, [(x0 - 4, y0 - 3, TINT_MINT), (x1 + 4, y0 + 2, TINT_PINK)])
    elif i == 2:
        f = spark(f, [(x1 + 4, y0 - 1, TINT_LAV)])
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
