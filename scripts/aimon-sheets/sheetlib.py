"""Build sprite-sheet frames from the approved 128px reference sprites.

The reference PNGs in `07_128px_도트/` are clean 2x upscales of a 64x64 logical
grid painted on a near-white backdrop.  We pull that 64x64 grid back out
(nearest-neighbour), lift the character off the backdrop with a border flood
fill, and then animate it from that base so every frame keeps the approved
look (1-dot outline, soft 2-tone shading, exact palette).
"""
import numpy as np
from PIL import Image
from collections import Counter

S = 64
BG_TOL = 34          # colour distance that still counts as backdrop
BASE_Y = 57          # every frame's lowest pixel sits here


def load64(path):
    """128px reference -> 64x64 RGBA with the backdrop lifted out."""
    im = Image.open(path).convert('RGBA')
    if im.size != (S, S):
        im = im.resize((S, S), Image.NEAREST)
    a = np.array(im)
    rgb = a[..., :3].astype(np.int32)

    # backdrop colour = most common colour on the outer border
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = Counter(map(tuple, border)).most_common(1)[0][0]
    bg = np.array(bg, np.int32)

    close = np.abs(rgb - bg).sum(2) < BG_TOL
    # flood fill from the edges over "close" pixels
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


def mask_of(img):
    return img[..., 3] > 0


def shift(img, dx=0, dy=0):
    out = np.zeros_like(img)
    ys, xs = np.where(img[..., 3] > 0)
    ys2, xs2 = ys + dy, xs + dx
    ok = (ys2 >= 0) & (ys2 < S) & (xs2 >= 0) & (xs2 < S)
    out[ys2[ok], xs2[ok]] = img[ys[ok], xs[ok]]
    return out


def scale(img, sx=1.0, sy=1.0, cx=32, bottom=64):
    """Nearest-neighbour squash/stretch anchored on (cx, bottom)."""
    w, h = max(1, round(S * sx)), max(1, round(S * sy))
    im = Image.fromarray(img, 'RGBA').resize((w, h), Image.NEAREST)
    big = np.zeros((S, S, 4), np.uint8)
    x0 = int(round(cx - cx * sx))
    y0 = int(round(bottom - bottom * sy))
    # clip into canvas
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(S, x0 + w), min(S, y0 + h)
    if sx1 > sx0 and sy1 > sy0:
        big[sy0:sy1, sx0:sx1] = im.crop((sx0 - x0, sy0 - y0, sx1 - x0, sy1 - y0)).__array__()
    return big


def anchor_bottom(img, base_y=BASE_Y):
    m = mask_of(img)
    ys = np.where(m)[0]
    if len(ys) == 0:
        return img
    return shift(img, 0, base_y - ys.max())


def anchor_center_x(img, cx=32.0):
    m = mask_of(img)
    ys, xs = np.where(m)
    if len(xs) == 0:
        return img
    mid = (xs.min() + xs.max()) / 2.0
    return shift(img, int(round(cx - mid)), 0)


def colors(img, min_count=6):
    a = img[img[..., 3] > 0]
    return Counter(map(tuple, a)).most_common(24)


def nearest_palette(img, palette):
    """Map every opaque pixel to the nearest palette entry (keeps pixel art flat)."""
    pal = np.array(palette, np.int32)
    out = img.copy()
    m = img[..., 3] > 0
    px = img[..., :3][m].astype(np.int32)
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(2)
    idx = d.argmin(1)
    out[..., :3][m] = pal[idx]
    return out


def darken(c, k=0.72):
    return tuple(int(round(v * k)) for v in c[:3])


def lighten(c, k=0.22):
    return tuple(int(round(v + (255 - v) * k)) for v in c[:3])


def blend(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))


def paint(img, mask, color, alpha=255):
    img[mask, 0] = color[0]
    img[mask, 1] = color[1]
    img[mask, 2] = color[2]
    img[mask, 3] = alpha
    return img


def upscale(img, k=2):
    return np.array(Image.fromarray(img, 'RGBA').resize((S * k, S * k), Image.NEAREST))


def recolor(img, fn):
    """Apply fn(rgb) -> rgb to every opaque pixel."""
    out = img.copy()
    m = img[..., 3] > 0
    px = img[..., :3][m]
    res = np.array([fn(tuple(p)) for p in px], np.uint8)
    out[..., :3][m] = res
    return out


def hue_shift(img, fn, amount):
    """Blend each pixel toward fn(pixel)."""
    out = img.copy()
    m = img[..., 3] > 0
    px = img[..., :3][m]
    tgt = np.array([fn(tuple(p)) for p in px], np.uint8)
    out[..., :3][m] = (px.astype(np.float32) * (1 - amount) + tgt.astype(np.float32) * amount).round().astype(np.uint8)
    return out


def add_sprite(dst, src):
    """Paste src over dst (binary alpha, src wins where opaque)."""
    m = src[..., 3] > 0
    dst[m] = src[m]
    return dst


def save_strip(frames, path, scale=3, bg=(22, 24, 32)):
    w = S * len(frames)
    strip = np.zeros((S, w, 4), np.uint8)
    for i, f in enumerate(frames):
        strip[:, i * S:(i + 1) * S] = f
    im = Image.fromarray(strip, 'RGBA')
    back = Image.new('RGBA', (w, S), bg + (255,))
    back.alpha_composite(im)
    back = back.convert('RGB').resize((w * scale, S * scale), Image.NEAREST)
    back.save(path)
    return path
