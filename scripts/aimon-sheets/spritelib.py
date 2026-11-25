"""Pixel-art helpers for A.I.Mon 64x64 logical sprite frames (upscaled x2 -> 128)."""
import math
import numpy as np
from PIL import Image

S = 64  # logical canvas


def hexc(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def new():
    return np.zeros((S, S, 4), np.uint8)


def put(img, mask, color, alpha=255):
    c = hexc(color) if isinstance(color, str) else color
    img[mask, 0] = c[0]
    img[mask, 1] = c[1]
    img[mask, 2] = c[2]
    img[mask, 3] = alpha


def grid():
    yy, xx = np.mgrid[0:S, 0:S]
    return xx.astype(float), yy.astype(float)


def ellipse(cx, cy, rx, ry, warp=None):
    """warp: callable(xx, yy, ang, t) -> multiplier on radius (1.0 = none)."""
    xx, yy = grid()
    dx = (xx - cx) / rx
    dy = (yy - cy) / ry
    d = np.sqrt(dx * dx + dy * dy)
    if warp is not None:
        ang = np.arctan2(yy - cy, xx - cx)
        d = d * warp(xx, yy, ang)
    return d <= 1.0


def dist(cx, cy):
    xx, yy = grid()
    return np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)


def shifted(mask, dx, dy):
    out = np.zeros_like(mask)
    ys, xs = np.where(mask)
    ys2 = ys + dy
    xs2 = xs + dx
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    out[ys2[ok], xs2[ok]] = True
    return out


def outer_ring(mask):
    """1-dot ring just outside mask (8-neighbour, no gaps on diagonals)."""
    grown = mask.copy()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                grown = grown | shifted(mask, dx, dy)
    return grown & ~mask


def inner_ring(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        nxt = cur.copy()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx or dy:
                    nxt = nxt & shifted(cur, dx, dy)
        cur = nxt
    return mask & ~cur


def band(mask, d0, d1):
    """Pixels whose depth from the mask edge is between d0 and d1 (1-based, inclusive).
    inner_ring(mask, n) is the outer n-pixel-thick edge band of mask."""
    sel = inner_ring(mask, d1)
    if d0 > 1:
        sel = sel & ~inner_ring(mask, d0 - 1)
    return sel


def dilate(mask, n=1):
    cur = mask.copy()
    for _ in range(n):
        cur = cur | shifted(cur, 1, 0) | shifted(cur, -1, 0) | shifted(cur, 0, 1) | shifted(cur, 0, -1)
    return cur


def stroke(mask_pts, w):
    """Union of discs of radius w/2 along point list -> thick rounded stroke."""
    m = np.zeros((S, S), bool)
    for (x, y) in mask_pts:
        m |= dist(x, y) <= max(0.55, w / 2.0)
    return m


def seg(x0, y0, x1, y1, step=0.25):
    n = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) / step))
    return [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]


def shear(mask, k, cy):
    """Shift rows of a mask horizontally: top leans +x, bottom -x, around cy."""
    out = np.zeros_like(mask)
    ys, xs = np.where(mask)
    xs2 = np.round(xs + k * (cy - ys)).astype(int)
    ok = (xs2 >= 0) & (xs2 < S)
    out[ys[ok], xs2[ok]] = True
    return out


def notch(mask, mx, y_bottom, w=1.6, depth=4.0):
    """Cut a small V between two feet so the silhouette reads as two of them."""
    cut = tri((mx - w, y_bottom + 2), (mx + w, y_bottom + 2), (mx, y_bottom - depth))
    return mask & ~cut


def tri(p0, p1, p2):
    """Filled triangle mask from three (x, y) points."""
    xx, yy = grid()

    def sign(ax, ay, bx, by, cx, cy):
        return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
    d1 = sign(xx, yy, p0[0], p0[1], p1[0], p1[1])
    d2 = sign(xx, yy, p1[0], p1[1], p2[0], p2[1])
    d3 = sign(xx, yy, p2[0], p2[1], p0[0], p0[1])
    neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
    pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
    return ~(neg & pos)


def lerp_col(c1, c2, t):
    a, b = hexc(c1), hexc(c2)
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def ramp(stops, t):
    """stops: list of hex colors, t in 0..1 -> interpolated color."""
    t = max(0.0, min(1.0, t))
    n = len(stops) - 1
    if n == 0:
        return hexc(stops[0])
    p = t * n
    i = min(n - 1, int(p))
    return lerp_col(stops[i], stops[i + 1], p - i)


def upscale(img, k=2):
    return np.array(Image.fromarray(img, 'RGBA').resize((S * k, S * k), Image.NEAREST))


def composite(dst, src):
    """Paint src (with alpha) over dst, in place. dst is HxWx4 uint8."""
    a = src[..., 3:4].astype(np.float32) / 255.0
    for c in range(3):
        dst[..., c] = (src[..., c].astype(np.float32) * a[..., 0] +
                       dst[..., c].astype(np.float32) * (1 - a[..., 0])).round().astype(np.uint8)
    dst[..., 3] = np.maximum(dst[..., 3], src[..., 3])


def save_preview(frames, path, scale=2, pad_bg=(245, 248, 252)):
    """frames: list of 64x64 RGBA -> horizontal strip preview on light bg."""
    k = len(frames)
    w = S * k * scale
    img = Image.new('RGB', (w, S * scale), pad_bg)
    for i, f in enumerate(frames):
        cell = Image.fromarray(upscale(f, scale), 'RGBA')
        bg = Image.new('RGB', cell.size, pad_bg)
        bg.paste(cell, (0, 0), cell)
        img.paste(bg, (i * S * scale, 0))
    img.save(path)
    return path
