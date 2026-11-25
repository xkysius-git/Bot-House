"""Oiji (Pickle) frames built on the approved 03-oiji-bubble reference.

Oiji's first form is a colourless soap bubble (thin grey rim, faint iridescent
flecks) with two black bar eyes - no sprout, not the green ㅍ.  Frames reuse the
reference pixels; the emotion row repaints the film into a different consonant
each frame, keeping the same rim / fleck treatment.
"""
import numpy as np

import anim as A
import sheetlib as L

REF = '../aimon-dot-128/03-oiji-bubble-128.png'
BASE_Y = 55

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


def _erode(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        nxt = cur.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.zeros_like(cur)
            ys, xs = np.where(cur)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < A.S) & (xs2 >= 0) & (xs2 < A.S)
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
                        if 0 <= ny < A.S and 0 <= nx < A.S and m[ny, nx]:
                            nb += 1
            if nb <= 1:
                out[y, x] = 0
    return out


def _prepare():
    base = _clean(L.load64(REF))
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
    return base, m, eyes


BASE0, M0, EYES0 = _prepare()
BASE = A.anchor(BASE0, BASE_Y)

_eye = np.zeros_like(M0)
for e in EYES0:
    _eye |= e
_ys, _xs = np.where(_eye)
EYE_CY = (_ys.min() + _ys.max()) / 2.0
EYE_CX = (_xs.min() + _xs.max()) / 2.0


def _crop(img, mask, pad=0):
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min() - pad, ys.max() + pad, xs.min() - pad, xs.max() + pad
    y0, x0 = max(0, y0), max(0, x0)
    return img[y0:y1 + 1, x0:x1 + 1].copy()


EYE_SPRS = [_crop(BASE0, e) for e in EYES0]


def paint(img, spr, x, y):
    h, w = spr.shape[:2]
    m = spr[..., 3] > 0
    ys, xs = np.where(m)
    ys2, xs2 = ys + y, xs + x
    ok = (ys2 >= 0) & (ys2 < A.S) & (xs2 >= 0) & (xs2 < A.S)
    img[ys2[ok], xs2[ok]] = spr[ys[ok], xs[ok]]
    return img


def strain_eyes(img, cx=EYE_CX, cy=EYE_CY, gap=6):
    """`> <` - eyes screwed shut with effort while it transforms."""
    out = img.copy()
    idx = A.nearest_index(out, PALETTE)
    A.put(out, (idx == 7) | (idx == 8), WHITE)
    x0, y0 = int(round(cx)), int(round(cy))
    chev = [(0, -2), (1, -1), (2, 0), (1, 1), (0, 2)]
    for sgn in (-1, 1):                    # -1 = left '<', +1 = right '>'
        ex = x0 + sgn * gap
        for (dx, dy) in chev:
            x = ex + sgn * dx
            for t in (0, 1):               # two dots thick so it reads at 128px
                xx = x + sgn * t
                if 0 <= y0 + dy < A.S and 0 <= xx < A.S:
                    out[y0 + dy, xx] = (*EYE, 255)
    return out


def strain_marks(img, spots, col=(0xB9, 0xC6, 0xDA)):
    """Short effort lines just outside the silhouette."""
    out = img.copy()
    for (x, y, dx, dy, n) in spots:
        for i in range(n):
            xx, yy = int(round(x + dx * i)), int(round(y + dy * i))
            if 0 <= yy < A.S and 0 <= xx < A.S and out[yy, xx, 3] == 0:
                out[yy, xx] = (*col, 255)
    return out


def sweat(img, x, y, col=(0x9F, 0xCB, 0xE8)):
    """A little teardrop of effort."""
    out = img.copy()
    for (dx, dy) in ((0, 0), (0, 1), (1, 1), (0, 2), (-1, 2), (1, 2)):
        xx, yy = x + dx, y + dy
        if 0 <= yy < A.S and 0 <= xx < A.S:
            out[yy, xx] = (*col, 255)
    return out


def with_eyes(img, cx=EYE_CX, cy=EYE_CY, closed=False, curved=True):
    out = img.copy()
    if closed:
        # wipe the open eyes first (fill with film white), then a closed lid
        idx = A.nearest_index(out, PALETTE)
        A.put(out, idx == 7, WHITE)
        A.put(out, idx == 8, WHITE)
        for sgn in (-1, 1):
            x0 = int(round(cx + sgn * 5.5))
            y0 = int(round(cy))
            for dx in range(-2, 3):
                d = (1 if abs(dx) < 2 else 0) if curved else 0
                if 0 <= y0 + d < A.S and 0 <= x0 + dx < A.S:
                    out[y0 + d, x0 + dx] = (*EYE, 255)
        return out
    for i, spr in enumerate(EYE_SPRS):
        w = spr.shape[1]
        x = int(round(cx + (-1 if i == 0 else 1) * 5.5 - w / 2.0))
        y = int(round(cy - spr.shape[0] / 2.0))
        paint(out, spr, x, y)
    return out


def film(mask, cy_ratio=0.72):
    """Paint a silhouette as soap film: white body, grey rim, pastel flecks."""
    out = np.zeros((A.S, A.S, 4), np.uint8)
    A.put(out, mask, WHITE)
    inner = A.ring(mask)
    A.put(out, inner, RIM)
    A.put(out, A.inner_band(mask, 1, 1), RIM_IN)
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    # the lower film thickens into a soft lavender shade that follows the rim
    low = yy > y0 + h * 0.62
    A.put(out, A.inner_band(mask, 2, 4) & low, (0xF1, 0xF3, 0xFA))
    A.put(out, A.inner_band(mask, 1, 2) & (yy > y0 + h * 0.80), TINT_LAV)
    # faint iridescent flecks caught in the film
    for (fx, fy, col) in ((x0 + w * 0.22, y0 + h * 0.30, TINT_MINT),
                          (x0 + w * 0.80, y0 + h * 0.62, TINT_PINK),
                          (x0 + w * 0.34, y0 + h * 0.88, TINT_GOLD)):
        m = ((xx - fx) / max(1.2, w * 0.07)) ** 2 + ((yy - fy) / max(1.0, h * 0.05)) ** 2 <= 1.0
        A.put(out, m & mask, col)
    # corner glint
    g = ((xx - (x0 + w * 0.24)) / max(1.0, w * 0.10)) ** 2 + \
        ((yy - (y0 + h * 0.16)) / max(1.0, h * 0.08)) ** 2 <= 1.0
    A.put(out, g & mask, GLINT)
    return out


def ell(cx, cy, rx, ry, n=2.0):
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    if n == 2.0:
        return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0
    return (np.abs((xx - cx) / rx) ** n + np.abs((yy - cy) / ry) ** n) ** (1.0 / n) <= 1.0


def rect(x0, y0, x1, y1):
    m = np.zeros((A.S, A.S), bool)
    m[y0:y1 + 1, x0:x1 + 1] = True
    return m


def rrect(x0, y0, x1, y1, r=5):
    """Soft capsule-ish rectangle: a bubble squeezed, not a hard block."""
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    m = rect(x0 + r, y0, x1 - r, y1) | rect(x0, y0 + r, x1, y1 - r)
    for (cx, cy) in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        m |= (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    return m


def narrow_eyes(img, keep=0.55):
    out = img.copy()
    idx = A.nearest_index(out, PALETTE)
    eyem = idx == 7
    ys = np.where(eyem)[0]
    if not len(ys):
        return out
    cut = ys.max() - int(round((ys.max() - ys.min()) * keep))
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    A.put(out, eyem & (yy <= cut), WHITE)
    A.put(out, eyem & (yy == cut), EYE)
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


def spark(img, pts):
    out = img.copy()
    for (x, y, c) in pts:
        A.put(out, _sq(x, y, 1), SPARK)
        A.put(out, _sq(x, y, 0), c)
    return out


def _sq(x, y, r):
    m = np.zeros((A.S, A.S), bool)
    m[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1] = True
    return m



# ------------------------------------------------------- consonant shapes
_14 = '../aimon-dot-128/oiji-14-bubbles.png'
_CS = [(108, 333), (387, 613), (669, 890), (954, 1174), (1234, 1464)]
_RS = [(92, 304), (377, 595), (666, 886)]
_CELLS = {'ㅁ': (0, 4), 'ㅂ': (1, 0), 'ㅇ': (1, 2), 'ㅍ': (2, 2)}


def _load_letter(key):
    """Silhouette of one official bubble consonant from oiji-14-bubbles.png."""
    from PIL import Image
    from collections import deque
    im = Image.open(_14).convert('RGB')
    a = np.array(im).astype(int)
    bg = np.array([253, 253, 253])
    ri, ci = _CELLS[key]
    r0, r1 = _RS[ri]
    c0, c1 = _CS[ci]
    sub = a[max(0, r0 - 8):r1 + 9, max(0, c0 - 8):c1 + 9]
    h, w, _ = sub.shape
    close = np.abs(sub - bg).sum(2) < 60
    outside = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        dq.append((0, x))
        dq.append((h - 1, x))
    for y in range(h):
        dq.append((y, 0))
        dq.append((y, w - 1))
    while dq:
        y, x = dq.popleft()
        if outside[y, x] or not close[y, x]:
            continue
        outside[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not outside[ny, nx]:
                dq.append((ny, nx))
    m = ~outside
    ys, xs = np.where(m)
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def letter_mask(key, w=46, h=46, cx=32, bottom=51):
    """Scaled silhouette placed bottom-centre in the 64 grid."""
    from PIL import Image
    src = _load_letter(key)
    sh, sw = src.shape
    k = min(w / sw, h / sh)
    tw, th = max(1, int(round(sw * k))), max(1, int(round(sh * k)))
    small = np.array(Image.fromarray((src * 255).astype(np.uint8)).resize((tw, th), Image.NEAREST)) > 127
    out = np.zeros((A.S, A.S), bool)
    x0 = int(round(cx - tw / 2.0))
    y0 = int(round(bottom - th))
    ys, xs = np.where(small)
    ys2, xs2 = ys + y0, xs + x0
    ok = (ys2 >= 0) & (ys2 < A.S) & (xs2 >= 0) & (xs2 < A.S)
    out[ys2[ok], xs2[ok]] = True
    return out


# ------------------------------------------------------------------- rows
def idle(i):
    f = BASE
    if i == 1:
        f = A.squash(f, 0.955, BASE_Y)
        f = A.shift(f, 0, 1)
    elif i == 2:
        f = A.squash(f, 1.02, BASE_Y)
    elif i == 3:
        f = A.squash(f, 0.985, BASE_Y)
        m = A.mask_of(f)
        bot = np.where(m)[0].max()
        f = with_eyes(f, cy=EYE_CY + (bot - np.where(M0)[0].max()), closed=True, curved=False)
    return A.anchor(f, BASE_Y)


def emotion(i):
    """Row 2: the bubble tries to become a different consonant every frame."""
    key = ['ㅂ', 'ㅁ', 'ㅇ', 'ㅍ'][i]
    m = letter_mask(key)
    f = film(m)
    ys = np.where(A.mask_of(f))[0]
    y0 = ys.min()
    f = A.shift(f, 0, BASE_Y - ys.max())
    cy = y0 + (ys.max() - y0) * [0.40, 0.46, 0.48, 0.46][i]
    f = strain_eyes(f, cy=cy, gap=[6, 6, 7, 6][i])
    # effort: strain lines + sparkles + a sweat drop while it squeezes
    b = A.mask_of(f)
    ys, xs = np.where(b)
    x0, x1, yb0, yb1 = xs.min(), xs.max(), ys.min(), ys.max()
    marks = {
        0: [(x0 - 2, yb0 + 6, -1, 0, 3), (x1 + 2, yb0 + 9, 1, 0, 2)],
        1: [(x0 - 2, yb0 + 8, -1, 0, 3), (x1 + 2, yb0 + 5, 1, 0, 3), (x0 + 6, yb1 + 2, 0, 1, 2)],
        2: [(x0 - 2, yb0 + 10, -1, -1, 3), (x1 + 2, yb0 + 8, 1, -1, 3), (x1 + 2, y0 + 4, 1, 0, 2)],
        3: [(x0 - 2, yb0 + 4, -1, -1, 3), (x1 + 2, yb0 + 4, 1, -1, 3),
            (x0 - 1, yb1 - 2, -1, 1, 2), (x1 + 1, yb1 - 3, 1, 1, 2)],
    }[i]
    f = strain_marks(f, marks)
    if i >= 1:
        f = sweat(f, x1 + 2, yb0 - 1)
    if i == 3:
        f = spark(f, [(x0 - 4, y0 - 2, TINT_MINT), (x1 + 4, y0 + 2, TINT_PINK)])
    elif i == 2:
        f = spark(f, [(x1 + 4, y0, TINT_LAV)])
    return A.anchor(f, BASE_Y)


def work(i):
    """Row 3: leans into the job, eyes narrow, pixel sparks fly."""
    f = A.shear(BASE, [0.04, 0.07, 0.09, 0.06][i], BASE_Y)
    f = A.squash(f, [1.0, 0.98, 1.0, 0.99][i], BASE_Y)
    m = A.mask_of(f)
    bot = np.where(m)[0].max()
    dy = bot - np.where(M0)[0].max()
    f = narrow_eyes(f)
    f = spark(f, {0: [(50, 40, TINT_MINT)],
                  1: [(52, 36, TINT_MINT), (47, 45, TINT_PINK)],
                  2: [(53, 33, TINT_PINK), (50, 40, TINT_LAV), (45, 47, TINT_MINT)],
                  3: [(51, 37, TINT_LAV), (46, 45, TINT_PINK)]}[i])
    return A.anchor(f, BASE_Y)


def sleep(i):
    """Row 4: settles low, eyes shut, Z climbing."""
    f = A.squash(BASE, [0.88, 0.90, 0.87, 0.895][i], BASE_Y)
    f = A.wave(f, 0.8, 0.25, i * 1.1, base=34, spread=0.9)
    m = A.mask_of(f)
    bot = np.where(m)[0].max()
    f = with_eyes(f, cy=EYE_CY + (bot - np.where(M0)[0].max()), closed=True)
    f = zeds(f, [1, 2, 2, 3][i], y0=[34, 30, 28, 26][i], x0=[45, 45, 46, 46][i])
    return A.anchor(f, BASE_Y)


def walk(i):
    """Row 5: no feet - oiji drifts through the air, bobbing to the right."""
    bob = [-3, 0, -4, -1][i]
    tilt = [0.075, 0.115, 0.045, 0.095][i]
    f = A.shift(BASE, 2, bob)
    f = A.shear(f, tilt, BASE_Y + 10)
    f = A.squash(f, [1.01, 0.985, 1.02, 0.99][i], BASE_Y - 4)
    return A.anchor(f, BASE_Y - 3)


def rows():
    return [[idle(i) for i in range(4)], [emotion(i) for i in range(4)],
            [work(i) for i in range(4)], [sleep(i) for i in range(4)],
            [walk(i) for i in range(4)]]
