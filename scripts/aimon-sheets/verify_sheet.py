"""Verify a 512x640 sprite sheet against the IMAGE_WORKFLOW.md checklist (#5).

- size 512x640, mode RGBA
- 128x128 cells, 4 cols x 5 rows, no empty cell
- alpha is 0 or 255 only (no partial transparency)
- no pixel sits on a cell boundary (nothing bleeds into the neighbour cell)
"""
import sys

import numpy as np
from PIL import Image

CELL = 128


def check(path, empty_rows=()):
    im = Image.open(path)
    a = np.array(im.convert('RGBA'))
    problems = []
    if im.size != (512, 640):
        problems.append(f'size {im.size} != (512, 640)')
    if im.mode != 'RGBA':
        problems.append(f'mode {im.mode} != RGBA')
    alpha = a[..., 3]
    partial = int(((alpha > 0) & (alpha < 255)).sum())
    if partial:
        problems.append(f'{partial} partial-alpha px')
    empty = []
    for r in range(5):
        for c in range(4):
            cell = a[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
            if not cell[..., 3].any():
                empty.append((r + 1, c + 1))
    if empty:
        problems.append(f'empty cells {empty}')
        return problems
    # a sprite touching the outermost row/column of its cell is too big
    bleed = []
    for r in range(5):
        for c in range(4):
            m = a[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, 3] > 0
            if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any():
                bleed.append((r + 1, c + 1))
    if bleed:
        problems.append(f'edge-touching cells {bleed}')
    # report the widest / tallest sprite so the character scale can be compared
    spans = []
    for r in range(5):
        for c in range(4):
            m = a[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, 3] > 0
            ys, xs = np.where(m)
            spans.append((xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))
    print(f'{path}: {"OK" if not problems else "FAIL"} '
          f'| {im.size[0]}x{im.size[1]} {im.mode} | alpha 0/255 | '
          f'20/20 cells | sprite w {min(s[0] for s in spans)}-{max(s[0] for s in spans)}px, '
          f'h {min(s[1] for s in spans)}-{max(s[1] for s in spans)}px')
    return problems


if __name__ == '__main__':
    bad = []
    for p in sys.argv[1:]:
        bad += check(p)
    sys.exit(1 if bad else 0)
