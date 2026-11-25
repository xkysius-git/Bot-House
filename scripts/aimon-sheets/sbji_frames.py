"""Seokbakji (EXAONE) frames built on the approved 04-sbji-128 reference.

The reference is flattened to a 2-tone palette per cloth so all five rows keep
its look.  The cloth colour boundaries are stored as a family map, which lets
the emotion row slide the seams (colour ripples) while the silhouette waves.
"""
import numpy as np

import anim as A
import sheetlib as L

REF = '../aimon-dot-128/04-sbji-128.png'
BASE_Y = 55

OUT = (0x20, 0x0A, 0x2E)
FACE = (0x3B, 0x3E, 0x59)
FACE_D = (0x29, 0x2D, 0x36)
LED = (0x5C, 0xEB, 0xFF)
LED_HI = (0xE6, 0xFE, 0xFF)
LED_SOFT = (0x7F, 0xE3, 0xF2)

PUR = [(0x66, 0x5D, 0xDA), (0x8B, 0x84, 0xEE), (0x4E, 0x43, 0xB4)]
MAG = [(0xDE, 0x2A, 0x66), (0xFD, 0x67, 0xA0), (0x86, 0x14, 0x3B)]
ORG = [(0xFA, 0x6A, 0x0F), (0xFE, 0xAF, 0x54), (0xC9, 0x56, 0x0C)]
FAMS = {1: PUR, 2: MAG, 3: ORG}

CLOTH = PUR + MAG + ORG
PALETTE = [OUT, FACE, FACE_D, LED, LED_HI, LED_SOFT] + CLOTH
FAMILY_OF_COLOR = ([0] * 6) + [1, 1, 1, 2, 2, 2, 3, 3, 3]

# indices: 0 outline, 1 face, 2 face-dark, 3..5 LED shades, 6..14 cloth


def _build():
    base = A.quantize(L.load64(REF), PALETTE)
    idx = A.nearest_index(base, PALETTE)

    # --- LED eyes: keep the two bars, everything bluish else becomes face
    led = np.isin(idx, [3, 4, 5])
    eye = np.zeros_like(led)
    ys, xs = np.where(idx == 3)
    for y, x in zip(ys, xs):
        eye[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
    eye &= led
    base[led & ~eye] = (*FACE, 255)

    # --- drop isolated single pixels (the reference has soft dithered edges)
    for _ in range(2):
        idx = A.nearest_index(base, PALETTE)
        flat = idx
        out = base.copy()
        ys, xs = np.where(idx >= 0)
        for y, x in zip(ys, xs):
            nb = [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx)]
            vals = [flat[ny, nx] for ny, nx in nb if 0 <= ny < A.S and 0 <= nx < A.S and flat[ny, nx] >= 0]
            if not vals:
                continue
            if all(v != flat[y, x] for v in vals):
                out[y, x] = (*PALETTE[max(set(vals), key=vals.count)], 255)
        base = out

    base = A.anchor(base, BASE_Y)
    return base


BASE = _build()
M = A.mask_of(BASE)
BI = A.nearest_index(BASE, PALETTE)
FAM = np.where(BI >= 0, np.array(FAMILY_OF_COLOR + [0])[np.clip(BI, 0, 9)], 0)
TONE = np.where(BI >= 6, (BI - 6) % 3, 0)
LED_M = np.isin(BI, [3, 4, 5])
FACE_M = np.isin(BI, [1, 2])

_comps = sorted(A.components(M), key=lambda c: c.sum())
_main = max(_comps, key=lambda c: c.sum())
_tufts = [c for c in _comps if c is not _main and c.sum() > 6]
TUFT_L = np.zeros((A.S, A.S), bool)
TUFT_R = np.zeros((A.S, A.S), bool)
for _c in _tufts:
    _xs = np.where(_c)[1].mean()
    if _xs < 20:
        TUFT_L |= _c
    elif _xs > 42:
        TUFT_R |= _c


def paint_fam(fam, tone, fam_map=None):
    """Build an image from a family/tone map; 0 keeps transparent."""
    img = np.zeros((A.S, A.S, 4), np.uint8)
    src = FAM if fam_map is None else fam_map
    for f, pal in FAMS.items():
        for t in range(3):
            sel = (src == f) & (tone == t)
            A.put(img, sel, pal[t])
    return img


def cloth_from_map(fam_src, tone, bright=0.0):
    """Repaint the cloth of BASE using a (possibly shifted) family map."""
    out = BASE.copy()
    for f, pal in FAMS.items():
        for t in range(3):
            sel = (fam_src == f) & (FAM > 0) & M
            if t != 0:
                sel = sel & (TONE == t)
            col = pal[t]
            if bright and t == 1:
                col = tuple(int(v + (255 - v) * bright) for v in col)
            A.put(out, sel, col)
    return out


def family_ripple(phase, amp=2.4, freq=0.42):
    """Slide the cloth seams sideways in a wave (colour ripple)."""
    out = FAM.copy()
    for y in range(A.S):
        dx = int(round(amp * np.sin(freq * (y - 20) + phase)))
        if dx:
            row = np.zeros(A.S, np.int8)
            if dx > 0:
                row[dx:] = FAM[y, :A.S - dx]
            else:
                row[:A.S + dx] = FAM[y, -dx:]
            out[y] = row
    return out


def _led_mask(img):
    return np.isin(A.nearest_index(img, PALETTE), [3, 4, 5])


def blink(src=None):
    out = (BASE if src is None else src).copy()
    led = _led_mask(out)
    ys, xs = np.where(led)
    cy = int(np.median(ys))
    A.put(out, led, FACE)
    for x in sorted(set(xs)):
        if cy < A.S:
            out[cy, x] = (*LED_SOFT, 255)
    return out


def led_off(src=None):
    """Power off: the LED bars go out completely - no eyes while asleep."""
    out = (BASE if src is None else src).copy()
    idx = A.nearest_index(out, PALETTE)
    rgb = out[..., :3].astype(np.int32)
    bluish = (rgb[..., 2] - rgb[..., 0] > 30) & (rgb[..., 2] > 90)
    A.put(out, _led_mask(out) | (bluish & np.isin(idx, [1, 2, 3, 4, 5])), FACE)
    return out


def led_glow(src=None, spread=1):
    out = (BASE if src is None else src).copy()
    led = _led_mask(out)
    ys, xs = np.where(led)
    glow = np.zeros_like(LED_M)
    for dx in range(-spread, spread + 1):
        for dy in range(-spread, spread + 1):
            if not (dx or dy):
                continue
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < A.S) & (xs2 >= 0) & (xs2 < A.S)
            glow[ys2[ok], xs2[ok]] = True
    A.put(out, glow & ~led & (A.nearest_index(out, PALETTE) <= 2), (0x2A, 0x74, 0x8A))
    A.put(out, led, LED)
    A.put(out, led & (np.arange(A.S)[None, :] < xs.mean()), LED_HI)
    return out


def _tufts_of(img):
    m = A.mask_of(img)
    comps = A.components(m)
    if not comps:
        return None, None
    main = max(comps, key=lambda c: c.sum())
    left = np.zeros_like(m)
    right = np.zeros_like(m)
    for c in comps:
        if c is main or c.sum() <= 6:
            continue
        cx = np.where(c)[1].mean()
        if cx < 24:
            left |= c
        elif cx > 40:
            right |= c
    return left, right


def flare_tufts(img, dxl, dxr, dyl=0, dyr=0):
    """Shift the side tufts outward (they are detached, so no body smear)."""
    out = img.copy()
    L, R = _tufts_of(img)
    for mask, dx, dy in ((L, dxl, dyl), (R, dxr, dyr)):
        if mask is None or (dx == 0 and dy == 0):
            continue
        sel = mask & A.mask_of(img)
        ys, xs = np.where(sel)
        ys2, xs2 = ys + dy, xs + dx
        ok = (ys2 >= 0) & (ys2 < A.S) & (xs2 >= 0) & (xs2 < A.S)
        out[ys2[ok], xs2[ok]] = img[ys[ok], xs[ok]]
    return out


def _ell(cx, cy, rx, ry):
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def feet(img, x1, lift1, x2, lift2):
    out = img.copy()
    for (x, lift) in ((x1, lift1), (x2, lift2)):
        cy = 54 - lift
        m = _ell(x, cy, 3.2, 2.2) & ~A.mask_of(out)
        m = _ell(x, cy, 3.2, 2.2)
        A.put(out, m, ORG[0])
        yy, xx = np.mgrid[0:A.S, 0:A.S]
        A.put(out, m & (yy <= cy - 1), ORG[1])
        A.put(out, m & (yy >= cy + 1), ORG[2])
        A.put(out, A.ring(m) & ~(A.mask_of(img)), OUT)
    return out


def xsquash(img, k, cx):
    out = np.zeros_like(img)
    for x in range(A.S):
        sx = int(round(cx + (x - cx) / k))
        if 0 <= sx < A.S:
            out[:, x] = img[:, sx]
    return out


# ------------------------------------------------------------------- rows
def idle(i):
    f = BASE
    if i == 1:
        f = A.squash(f, 0.965, BASE_Y)
        f = flare_tufts(f, -1, 1)
    elif i == 2:
        f = A.wave(f, 1.0, 0.30, 0.6, base=30, spread=1.0)
    elif i == 3:
        f = A.squash(f, 0.985, BASE_Y)
        f = blink(f)
    return A.anchor(f, BASE_Y)


def sheen(img, phase, front=0.36, back=0.14, freq=0.42):
    """Iridescent light band sweeping over the cloth (일렁임)."""
    out = img.copy()
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    t = np.sin((xx * 0.55 + yy * 0.85) * freq - phase)
    cloth = M & (FAM > 0)
    hi = cloth & (t > 0.70)
    lo = cloth & (t < -0.86)
    px = out[..., :3].astype(np.int16)
    px[hi] = (px[hi] + (255 - px[hi]) * front).astype(np.int16)
    px[lo] = (px[lo] * (1 - back)).astype(np.int16)
    out[..., :3] = np.clip(px, 0, 255).astype(np.uint8)
    return out


def billow(img, n=1):
    """Grow the silhouette by n dots (cloth puffing out)."""
    out = img.copy()
    m = A.mask_of(img)
    grow = m
    for _ in range(n):
        grow = grow | A.ring(grow)
    add = grow & ~m
    ys, xs = np.where(A.ring(m))
    for y, x in zip(ys, xs):
        if not add[y, x]:
            continue
        # take the colour of the nearest body pixel
        for dy, dx in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < A.S and 0 <= nx < A.S and m[ny, nx]:
                col = img[ny, nx, :3]
                if tuple(col) == OUT:
                    continue
                out[y, x] = (*col, 255)
                break
    return out


NEXT = {1: 2, 2: 3, 3: 1}


def hue_wave(img, phase, amount=0.55, freq=0.34):
    """Cloth colours flow toward the next cloth colour in a travelling wave."""
    out = img.copy()
    yy, xx = np.mgrid[0:A.S, 0:A.S]
    s = 0.5 + 0.5 * np.sin((xx * 0.34 + yy * 0.78) * freq - phase)
    w = (s * amount)
    px = out[..., :3].astype(np.float32)
    for f, nxt in NEXT.items():
        for t in range(3):
            sel = (FAM == f) & (TONE == t) & (FAM > 0)
            if not sel.any():
                continue
            src = np.array(FAMS[f][t], np.float32)
            dst = np.array(FAMS[nxt][t], np.float32)
            ww = w[sel][:, None]
            px[sel] = src * (1 - ww) + dst * ww
    out[..., :3] = np.clip(px, 0, 255).astype(np.uint8)
    return out


def hem_sway(img, phase, amp=2.0):
    """Only the lower hem sways sideways."""
    out = img.copy()
    for y in range(38, A.S):
        dx = int(round(amp * (y - 38) / 12.0 * np.sin(phase + (y - 38) * 0.25)))
        if dx:
            row = np.zeros((A.S, 4), np.uint8)
            if dx > 0:
                row[dx:] = img[y, :A.S - dx]
            else:
                row[:A.S + dx] = img[y, -dx:]
            out[y] = row
    return out


def emotion(i):
    """Row 2: the cloth ripples - colour flows and the hem sways."""
    ph = [0.0, 1.6, 3.2, 4.6][i]
    f = A.squash(BASE, [1.04, 0.97, 1.06, 0.98][i], BASE_Y)
    f = hue_wave(f, ph, amount=[0.65, 0.45, 0.70, 0.55][i], freq=0.42)
    f = sheen(f, ph + 1.0, front=[0.34, 0.24, 0.38, 0.26][i])
    f = hem_sway(f, ph, amp=[1.0, 1.5, 1.5, 1.0][i])
    f = flare_tufts(f, [-1, -2, -1, -2][i], [1, 2, 2, 1][i], [0, -1, 0, -1][i], [0, -1, 1, 0][i])
    return A.anchor(f, BASE_Y)


def work(i):
    """Row 3: LEDs flare, lean forward, data pixels rise."""
    f = A.shear(BASE, [0.030, 0.055, 0.070, 0.045][i], BASE_Y)
    f = A.squash(f, [1.0, 0.985, 1.0, 0.99][i], BASE_Y)
    if i % 2 == 1:
        f = led_glow(f, 1)
    for (x, y) in {0: [(49, 43)], 1: [(51, 40), (47, 46)],
                   2: [(52, 37), (49, 43), (45, 47)],
                   3: [(50, 41), (47, 46)]}[i]:
        m = np.zeros((A.S, A.S), bool)
        m[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
        A.put(f, m, LED)
        A.put(f, m & (np.mgrid[0:A.S, 0:A.S][0] >= y) & (np.mgrid[0:A.S, 0:A.S][1] <= x), LED_HI)
    return A.anchor(f, BASE_Y)


def zeds(img, count, y0=30, x0=44, color=(0x9C, 0x8F, 0xC0)):
    """Draw 1-3 Z glyphs climbing up-right, nudged into empty pixels."""
    out = img.copy()
    m = A.mask_of(out)
    for k in range(count):
        x, y = x0 + k * 3, y0 - k * 7
        for _ in range(8):
            area = m[max(0, y - 1):y + 6, max(0, x - 1):x + 7]
            if not area.any():
                break
            x += 3
            y -= 2
        A.zed(out, x, y, color)
    return out


def sleep(i):
    """Row 4: settled low, LEDs closed, Z drifting up."""
    f = A.squash(BASE, [0.88, 0.905, 0.87, 0.895][i], BASE_Y)
    f = A.wave(f, 0.8, 0.22, i * 1.1, base=34, spread=1.0)
    f = led_off(f)
    f = zeds(f, [1, 2, 2, 3][i], y0=[34, 30, 28, 26][i], x0=[45, 45, 46, 46][i])
    return A.anchor(f, BASE_Y)


def walk(i):
    """Row 5: no feet - the cloth body drifts right through the air."""
    bob = [-3, 0, -4, -1][i]
    tilt = [0.050, 0.085, 0.025, 0.065][i]
    f = A.shift(BASE, 2, bob)
    f = A.shear(f, tilt, BASE_Y + 10)
    f = A.squash(f, [1.01, 0.985, 1.02, 0.99][i], BASE_Y - 4)
    f = xsquash(f, 0.92, 32.0)
    f = flare_tufts(f, -1, 0)          # tufts trail behind the drift
    return A.anchor(f, BASE_Y - 3)


def rows():
    return [[idle(i) for i in range(4)], [emotion(i) for i in range(4)],
            [work(i) for i in range(4)], [sleep(i) for i in range(4)],
            [walk(i) for i in range(4)]]
