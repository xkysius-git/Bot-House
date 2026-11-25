"""Assemble the 512x640 sprite sheets from 64x64 logical frames."""
import numpy as np
from PIL import Image

import oiji_frames as O
import sbji_frames as B
from spritelib import upscale

CELL = 128
COLS, ROWS = 4, 5


def build(rows, out_path):
    sheet = np.zeros((CELL * ROWS, CELL * COLS, 4), np.uint8)
    for r, frames in enumerate(rows):
        assert len(frames) == COLS, (r, len(frames))
        for c, f in enumerate(frames):
            assert f.shape == (64, 64, 4), f.shape
            big = upscale(f, CELL // 64)
            sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = big
    Image.fromarray(sheet, 'RGBA').save(out_path)
    return out_path, sheet


def oiji_rows():
    return [
        [O.oiji_idle(i) for i in range(4)],
        [O.oiji_emotion(i) for i in range(4)],
        [O.oiji_work(i) for i in range(4)],
        [O.oiji_sleep(i) for i in range(4)],
        [O.oiji_walk(i) for i in range(4)],
    ]


def sbji_rows():
    return [
        [B.sbji_idle(i) for i in range(4)],
        [B.sbji_emotion(i) for i in range(4)],
        [B.sbji_work(i) for i in range(4)],
        [B.sbji_sleep(i) for i in range(4)],
        [B.sbji_walk(i) for i in range(4)],
    ]


if __name__ == '__main__':
    p1, s1 = build(oiji_rows(), 'oiji-sheet-512x640.png')
    p2, s2 = build(sbji_rows(), 'sbji-sheet-512x640.png')
    for p, s in ((p1, s1), (p2, s2)):
        a = s[..., 3]
        print(p, s.shape, 'transparent px:', (a == 0).sum(), '/', a.size,
              'partial alpha px:', ((a > 0) & (a < 255)).sum())
