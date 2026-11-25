"""Dark-background previews for the sprite sheets (sheet + 3-character line-up)."""
import sys
from PIL import Image

LABEL_H = 0


def preview(sheet_path, out_path, bg=(21, 23, 31), scale=2):
    sheet = Image.open(sheet_path).convert('RGBA')
    w, h = sheet.size
    back = Image.new('RGBA', (w, h), bg + (255,))
    back.alpha_composite(sheet)
    back = back.convert('RGB').resize((w * scale, h * scale), Image.NEAREST)
    back.save(out_path)
    return out_path


def lineup(paths, out_path, bg=(21, 23, 31), scale=1):
    ims = [Image.open(p).convert('RGBA') for p in paths]
    w = sum(i.size[0] for i in ims)
    h = max(i.size[1] for i in ims)
    back = Image.new('RGBA', (w, h), bg + (255,))
    x = 0
    for im in ims:
        back.alpha_composite(im, (x, 0))
        x += im.size[0]
    back = back.convert('RGB')
    if scale != 1:
        back = back.resize((int(w * scale), int(h * scale)), Image.NEAREST)
    back.save(out_path)
    return out_path


if __name__ == '__main__':
    src = 'work/BotHouse/assets/sprites'
    names = ['oiji', 'sbji', 'takuan']
    made = []
    for n in names:
        p = f'{src}/{n}-sheet-512x640.png'
        try:
            open(p, 'rb').close()
        except FileNotFoundError:
            continue
        made.append(preview(p, f'{src}/{n}-sheet-preview-dark.png'))
    if made:
        lineup(made, f'{src}/all-sheets-preview-dark.png')
    print('\n'.join(made))
