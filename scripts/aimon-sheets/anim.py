"""Pixel-safe animation helpers for the A.I.Mon sprite sheets.

Everything works on 64x64 RGBA logical frames and keeps pixels crisp:
vertical squash/stretch moves whole rows (no resampling), sway/lean shifts
whole rows horizontally, so the 1-dot outlines survive.
"""
import math
import numpy as np
from PIL import Image

S = 64


# ---------------------------------------------------------------- geometry
def rowmap(img, fn):
    """Rebuild img so that destination row y reads source row fn(y)."""
    out = np.zeros_like(img)
    for y in range(S):
        sy = int(round(fn(y)))
        if 0 <= sy < S:
            out[y] = img[sy]
    return out


def squash(img, k, pivot_row):
    """k<1 squashes toward pivot_row, k>1 stretches. Rows only."""
    def fn(y):
        return pivot_row + (y - pivot_row) / k
    return rowmap(img, fn)


def shear(img, k, pivot_row=0.0):
    """Rows shift horizontally, linearly with distance above pivot."""
    out = np.zeros_like(img)
    for y in range(S):
        dx = int(round(k * (pivot_row - y)))
        if dx == 0:
            out[y] = img[y]
        else:
            row = np.zeros((S, 4), np.uint8)
            if dx > 0:
                row[dx:] = img[y, :S - dx]
            else:
                row[:S + dx] = img[y, -dx:]
            out[y] = row
    return out


def wave(img, amp, freq, phase, base=32.0, spread=0.0):
    """Flag-like horizontal ripple: dx = amp * sin(freq*(y-base) + phase)."""
    out = np.zeros_like(img)
    for y in range(S):
        t = (y - base) / 32.0 if spread else 1.0
        dx = int(round(amp * math.sin(freq * (y - base) + phase) * t))
        if dx == 0:
            out[y] = img[y]
        else:
            row = np.zeros((S, 4), np.uint8)
            if dx > 0:
                row[dx:] = img[y, :S - dx]
            else:
                row[:S + dx] = img[y, -dx:]
            out[y] = row
    return out


def shift(img, dx=0, dy=0):
    """Whole-image integer translate."""
    if dx == 0 and dy == 0:
        return img.copy()
    out = np.zeros_like(img)
    ys, xs = np.where(img[..., 3] > 0)
    dy, dx = int(round(dy)), int(round(dx))
    ys2, xs2 = ys + dy, xs + dx
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    out[ys2[ok], xs2[ok]] = img[ys[ok], xs[ok]]
    return out


def shift_region(img, mask, dx, dy):
    """Move the pixels inside mask by (dx,dy); vacated pixels become empty."""
    out = img.copy()
    sel = mask & (img[..., 3] > 0)
    out[sel] = 0
    ys, xs = np.where(sel)
    ys2, xs2 = ys + dy, xs + dx
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    # write in an order that does not clobber itself: copy from a snapshot
    src = img[ys[ok], xs[ok]]
    out[ys2[ok], xs2[ok]] = src
    return out


def wobble(img, ax, fx, phx, ay, fy, phy):
    """Smooth 2D ripple: rows sway sideways, columns bow vertically."""
    yy, xx = np.mgrid[0:S, 0:S]
    sx = np.round(xx + ax * np.sin(fy * yy + phx)).astype(int)
    sy = np.round(yy + ay * np.sin(fx * xx + phy)).astype(int)
    ok = (sx >= 0) & (sx < S) & (sy >= 0) & (sy < S)
    out = np.zeros_like(img)
    out[ok] = img[sy[ok], sx[ok]]
    return out


def components(mask):
    """4-connected components of a boolean mask -> list of boolean masks."""
    seen = np.zeros_like(mask)
    out = []
    for sy in range(S):
        for sx in range(S):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            comp = np.zeros_like(mask)
            stack = [(sy, sx)]
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                comp[y, x] = True
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < S and 0 <= nx < S and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append(comp)
    return out


def _unused(img):
    return img.copy()


# ------------------------------------------------------------------ masks
def mask_of(img):
    return img[..., 3] > 0


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max(), ys.max()


def ring(mask):
    """1-dot ring just outside mask."""
    g = mask.copy()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                s = np.zeros_like(mask)
                ys, xs = np.where(mask)
                ys2, xs2 = ys + dy, xs + dx
                ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
                s[ys2[ok], xs2[ok]] = True
                g |= s
    return g & ~mask


def inner_band(mask, d0, d1):
    """Pixels whose depth from the mask edge is between d0 and d1."""
    cur = mask.copy()
    for _ in range(d1):
        nxt = cur.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sh = np.zeros_like(cur)
            ys, xs = np.where(cur)
            ys2, xs2 = ys + dy, xs + dx
            ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
            sh[ys2[ok], xs2[ok]] = True
            nxt &= sh
        cur = nxt
    sel = cur
    if d0 > 1:
        cur2 = mask.copy()
        for _ in range(d0 - 1):
            nxt = cur2.copy()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                sh = np.zeros_like(cur2)
                ys, xs = np.where(cur2)
                ys2, xs2 = ys + dy, xs + dx
                ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
                sh[ys2[ok], xs2[ok]] = True
                nxt &= sh
            cur2 = nxt
        sel = sel & ~cur2
    return mask & ~sel


def anchor(img, base_y=55, cx=32.0):
    """Pin the lowest pixel to base_y and centre the main body on cx.

    Effects (sparkles, Z, feet) must not drag the body sideways, so the
    horizontal centre comes from the largest connected component.
    """
    m = mask_of(img)
    if not m.any():
        return img
    ys, xs = np.where(m)
    comps = components(m)
    main = max(comps, key=lambda c: c.sum()) if comps else m
    mys, mxs = np.where(main)
    dx = int(round(cx - (mxs.min() + mxs.max()) / 2.0))
    dy = base_y - ys.max()
    out = np.zeros_like(img)
    ys2, xs2 = ys + dy, xs + dx
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    out[ys2[ok], xs2[ok]] = img[ys[ok], xs[ok]]
    return out


# ------------------------------------------------------------------ paint
def put(img, mask, color, alpha=255):
    img[mask, 0] = color[0]
    img[mask, 1] = color[1]
    img[mask, 2] = color[2]
    img[mask, 3] = alpha
    return img


def quantize(img, palette):
    """Snap every opaque pixel to the nearest palette colour (flat 2-tone look)."""
    pal = np.array(palette, np.int32)
    out = img.copy()
    m = mask_of(img)
    px = img[..., :3][m].astype(np.int32)
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(2)
    out[..., :3][m] = pal[d.argmin(1)].astype(np.uint8)
    return out


def nearest_index(img, palette):
    """Index of the nearest palette colour for each opaque pixel (-1 elsewhere)."""
    pal = np.array(palette, np.int32)
    idx = np.full((S, S), -1, np.int32)
    m = mask_of(img)
    px = img[..., :3][m].astype(np.int32)
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(2)
    idx[m] = d.argmin(1)
    return idx


def swap_palette(img, palette, order):
    """Recolour by palette family: pixel of family i becomes family order[i]."""
    idx = nearest_index(img, palette)
    out = img.copy()
    pal = np.array(palette, np.uint8)
    for i, j in enumerate(order):
        sel = idx == i
        out[..., :3][sel] = pal[j]
    return out


# ----------------------------------------------------------------- effects
def zed(img, x, y, color, thick=1):
    """Pixel 'Z': 5 wide, 5 tall."""
    x, y = int(x), int(y)
    for i in range(5):
        img[y, x + i] = (*color, 255)
    for i in range(5):
        img[y + 4, x + i] = (*color, 255)
    for i in range(1, 4):
        img[y + i, x + 4 - i] = (*color, 255)
    return img


def dot(img, x, y, color, r=0.0):
    if r <= 0.5:
        if 0 <= y < S and 0 <= x < S:
            img[int(y), int(x)] = (*color, 255)
    else:
        for yy in range(int(y - r), int(y + r) + 1):
            for xx in range(int(x - r), int(x + r) + 1):
                if 0 <= yy < S and 0 <= xx < S and (xx - x) ** 2 + (yy - y) ** 2 <= r * r:
                    img[yy, xx] = (*color, 255)
    return img


def sparkle(img, x, y, color):
    for (dx, dy) in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        if 0 <= y + dy < S and 0 <= x + dx < S:
            img[y + dy, x + dx] = (*color, 255)
    return img


# ------------------------------------------------------------ sheet output
def upscale(img, k=2):
    return np.array(Image.fromarray(img, 'RGBA').resize((S * k, S * k), Image.NEAREST))


def build_sheet(rows, path):
    cell, cols = 128, 4
    nrows = len(rows)
    sheet = np.zeros((cell * nrows, cell * cols, 4), np.uint8)
    for r, frames in enumerate(rows):
        assert len(frames) == cols, (r, len(frames))
        for c, f in enumerate(frames):
            assert f.shape == (S, S, 4), f.shape
            sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = upscale(f, 2)
    Image.fromarray(sheet, 'RGBA').save(path)
    return path


def preview(sheet_path, out_path, bg=(20, 22, 30), scale=2, labels=None):
    sheet = Image.open(sheet_path).convert('RGBA')
    w, h = sheet.size
    back = Image.new('RGBA', (w, h), bg + (255,))
    back.alpha_composite(sheet)
    back = back.convert('RGB')
    if scale != 1:
        back = back.resize((w * scale, h * scale), Image.NEAREST)
    back.save(out_path)
    return out_path
