"""Assemble the 512x640 sprite sheets from 64x64 logical frames.

    python3 build_sheets.py <outdir> [name ...]

`name` is one of oiji / sbji / takuan (default: all three).  Each sheet is
4 cols x 5 rows of 128x128 cells, upscaled with NEAREST so the 1-dot outline
stays crisp.  Run previews.py afterwards for the dark-background check.
"""
import os
import sys

import numpy as np
from PIL import Image

import anim as A

CELL = 128
COLS, ROWS = 4, 5
MODULES = {'oiji': 'oiji_frames', 'sbji': 'sbji_frames', 'takuan': 'takuan_frames'}


def build(rows, out_path):
    sheet = np.zeros((CELL * ROWS, CELL * COLS, 4), np.uint8)
    for r, frames in enumerate(rows):
        assert len(frames) == COLS, (r, len(frames))
        for c, f in enumerate(frames):
            assert f.shape == (64, 64, 4), f.shape
            big = A.upscale(f, CELL // 64)
            sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = big
    Image.fromarray(sheet, 'RGBA').save(out_path)
    return out_path


def main(argv):
    outdir = argv[1] if len(argv) > 1 else '.'
    names = argv[2:] or list(MODULES)
    for name in names:
        mod = __import__(MODULES[name])
        p = build(mod.rows(), os.path.join(outdir, f'{name}-sheet-512x640.png'))
        a = np.array(Image.open(p))[..., 3]
        print(p, f'{a.shape[1]}x{a.shape[0]}',
              'transparent px:', int((a == 0).sum()), '/', a.size,
              'partial alpha px:', int(((a > 0) & (a < 255)).sum()))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
