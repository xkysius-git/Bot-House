"""Takuan / Jolly (Muse) frames built on the approved 06-takuan-jolly-128 ref.

Cream mochi blob: face plate, two dot eyes, pink cross cheeks, stubby arms and
two feet.  Every frame is the reference put through a short pipeline of
pixel-safe transforms; a 1-pixel probe rides the same pipeline so the face can
be redrawn at exactly the right spot (the dot eyes must not be squashed).
"""
import numpy as np

import anim as A
import sheetlib as L

REF = '../aimon-dot-128/06-takuan-jolly-128.png'
BASE_Y = 55

OUT = (0x55, 0x29, 0x03)
BODY = (0xFE, 0xEE, 0xC9)
FACE = (0xFE, 0xF2, 0xDA)
SHADE = (0xE8, 0xC9, 0x92)
DARK = (0xD4, 0xAA, 0x6C)
EYE = (0x0A, 0x05, 0x03)
CHEEK = (0xF8, 0xB0, 0xA0)
CHEEK_HOT = (0xF5, 0x72, 0x72)
WHITE = (0xFF, 0xFF, 0xE0)

PALETTE = [OUT, BODY, FACE, SHADE, DARK, EYE, CHEEK, WHITE]


# ---------------------------------------------------------------- reference
def _prepare():
    base = A.quantize(L.load64(REF), PALETTE)
    return base


BASE0 = _prepare()
M0 = A.mask_of(BASE0)
_ys, _xs = np.where(M0)
CX0 = (_xs.min() + _xs.max()) / 2.0

# eye / cheek layout measured off the reference
EYE_CY = 20.0
EYE_DX = 6.0
CHEEK_CY = 23.0
CHEEK_DX = 7.0
PLATE_CY = 17.5

PROBE_Y = int(round(EYE_CY))
PROBE_X = int(round(CX0))

BASE = A.anchor(BASE0, BASE_Y)
PROBE = np.zeros((A.S, A.S, 4), np.uint8)
PROBE[PROBE_Y, PROBE_X] = (*WHITE, 255)


def run(img, ops):
    for name, args in ops:
        fn = getattr(A, name)
        img = fn(img, *args)
    return img


def face_spot(probe):
    """Where the probe pixel ended up -> (cx, cy)."""
    ys, xs = np.where(probe[..., 3] > 0)
    if not len(ys):
        return CX0, EYE_CY
    return float(xs.mean()), float(ys.mean())


# ------------------------------------------------------------------- face
def _fill(img, mask, col):
    A.put(img, mask, col)


def set_face(img, cx, cy, eyes='open', blush=1, drop=0):
    """Erase the reference eyes/cheeks and draw the pose's face."""
    out = img.copy()
    idx = A.nearest_index(out, PALETTE)
    body_m = A.mask_of(out)
    A.put(out, (idx == 5) | (idx == 6), FACE)

    ex = int(round(cx))
    ey = int(round(cy)) + drop

    def dot(x, y, col=EYE):
        if 0 <= y < A.S and 0 <= x < A.S:
            out[y, x] = (*col, 255)

    for sgn in (-1, 1):
        x = ex + int(round(sgn * EYE_DX))
        if eyes == 'open':
            for dx in (-1, 0):
                for dy in (-1, 0, 1):
                    dot(x + dx, ey + dy)
        elif eyes == 'narrow':
            for dx in (-1, 0, 1):
                dot(x + dx, ey + 1)
        elif eyes == 'wide':
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1, 2):
                    if abs(dx) == 1 and dy in (-1, 2):
                        continue
                    dot(x + dx, ey + dy)
            dot(x, ey + 2, WHITE)
        elif eyes == 'half':
            for dx in (-1, 0, 1):
                dot(x + dx, ey + 1)
            for dx in (-1, 0):
                dot(x + dx, ey + 2)
        elif eyes in ('closed', 'blink'):
            for dx in (-2, -1, 0, 1, 2):
                dot(x + dx, ey + 1)
            dot(x - 2, ey, EYE)
            dot(x + 2, ey, EYE)

    if blush > 0:
        cy2 = int(round(cy)) + 4
        for sgn in (-1, 1):
            x = ex + int(round(sgn * (CHEEK_DX + (1 if blush > 1 else 0))))
            col = CHEEK_HOT if blush > 1 else CHEEK
            r = 1 if blush == 1 else 2
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if abs(dx) + abs(dy) <= r + (0 if blush > 1 else 1):
                        if 0 <= cy2 + dy < A.S and 0 <= x + dx < A.S:
                            out[cy2 + dy, x + dx] = (*col, 255)
    return out


# ------------------------------------------------------------------ effects
def feet(img, x1, lift1, x2, lift2):
    out = img.copy()
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    for (x, lift) in ((x1, lift1), (x2, lift2)):
        cy = 55 - lift
        m = ((xx - x) / 3.6) ** 2 + ((yy - cy) / 2.4) ** 2 <= 1.0
        A.put(out, m, BODY)
        A.put(out, m & (yy >= cy + 1), SHADE)
        A.put(out, A.ring(m) & ~A.mask_of(img), OUT)
    return out


def zeds(img, count, y0=30, x0=44, color=(0xC9, 0xA9, 0x74)):
    out = img.copy()
    m = A.mask_of(out)
    for k in range(count):
        x, y = x0 + k * 3, y0 - k * 7
        for _ in range(8):
            if not m[max(0, y - 1):y + 6, max(0, x - 1):x + 7].any():
                break
            x += 3
            y -= 2
        A.zed(out, x, y, color)
    return out


def blocks(img, pts, col=WHITE, edge=DARK):
    out = img.copy()
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    for (x, y) in pts:
        m = np.zeros((A.S, A.S), bool)
        m[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
        A.put(out, m, col)
        A.put(out, m & (yy > y), edge)
    return out


def belly(img, k, pivot=31):
    """Rows below pivot spread out (belly pulled)."""
    out = np.zeros_like(img)
    for y in range(A.S):
        sy = y if y <= pivot else pivot + (y - pivot) / k
        sy = int(round(sy))
        if 0 <= sy < A.S:
            out[y] = img[sy]
    return out


def frame(ops, eyes='open', blush=1, drop=0, extra=None):
    f = run(BASE, ops)
    p = run(PROBE, ops)
    cx, cy = face_spot(p)
    f = set_face(f, cx, cy, eyes=eyes, blush=blush, drop=drop)
    if extra:
        f = extra(f)
    return A.anchor(f, BASE_Y)


# ------------------------------------------------------------------- rows
def idle(i):
    if i == 0:
        return frame([])
    if i == 1:
        return frame([('squash', (0.965, BASE_Y)), ('shift', (0, 1))])
    if i == 2:
        return frame([('squash', (1.02, BASE_Y))])
    return frame([('squash', (0.985, BASE_Y))], eyes='blink')


def emotion(i):
    """Row 2: belly stretched, snaps back, cheeks burn."""
    if i == 0:      # grab the belly - it sags
        return frame([('belly', (1.10, 35))], eyes='half')
    if i == 1:      # stretched to the limit
        return frame([('belly', (1.18, 34))], eyes='half')
    if i == 2:      # snap - bounces up, eyes pop
        return frame([('squash', (0.90, BASE_Y)), ('shift', (0, -1))], eyes='wide')
    # embarrassed: cheeks burn, eyes shut
    return frame([('squash', (0.97, BASE_Y))], eyes='closed', blush=2, drop=-1)


A.belly = belly
A.xsquash = lambda img, k, cx: np.array(
    [img[:, min(A.S - 1, max(0, int(round(cx + (x - cx) / k))))] for x in range(A.S)]
).transpose(1, 0, 2)


def work(i):
    """Row 3: leans in, eyes narrowed, small pixels stacking up."""
    ops = [('shear', ([0.03, 0.05, 0.07, 0.045][i], BASE_Y)),
           ('squash', ([1.0, 0.985, 1.0, 0.99][i], BASE_Y))]
    pts = {0: [(49, 41)], 1: [(51, 38), (47, 45)],
           2: [(52, 34), (49, 41), (45, 47)],
           3: [(50, 39), (46, 46)]}[i]
    return frame(ops, eyes='half', extra=lambda f: blocks(f, pts))


def sleep(i):
    """Row 4: flat and low, eyes shut, Z drifting up."""
    ops = [('squash', ([0.86, 0.885, 0.85, 0.875][i], BASE_Y)),
           ('wave', (0.7, 0.25, i * 1.1, 36, 0.8))]
    return frame(ops, eyes='closed', drop=0,
                 extra=lambda f: zeds(f, [1, 2, 2, 3][i], y0=[34, 30, 28, 26][i],
                                      x0=[45, 45, 46, 46][i]))


def walk(i):
    """Row 5: three-quarter right profile, feet stepping."""
    dy, lean, fx1, fx2, l1, l2 = [(0.0, 0.00, 36, 26, 0, 1),
                                  (1.0, 0.02, 34, 25, 1, 0),
                                  (-1.0, 0.03, 38, 27, 0, 0),
                                  (0.5, 0.02, 35, 26, 1, 1)][i]
    ops = [('xsquash', (0.80, 32.0)),
           ('shear', (0.030 + lean, BASE_Y)),
           ('shift', (0, dy))]
    return frame(ops, eyes='open', extra=lambda f: feet(f, fx1, l1, fx2, l2))


def rows():
    return [[idle(i) for i in range(4)], [emotion(i) for i in range(4)],
            [work(i) for i in range(4)], [sleep(i) for i in range(4)],
            [walk(i) for i in range(4)]]
