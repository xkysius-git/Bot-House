"""Bot House 캐릭터 도트 스프라이트 빌더 (32x32, 11프레임).

원본 기준: docs/characters/{oiji,sbji,takuan,claude-clawd,family}.jpg (2026-11-23 장현 님 제공)

공통 규칙
  - 입·코 없음. 세로로 긴 검은 타원 눈 두 개 + 오른쪽 위 흰 하이라이트 1px.
  - 프레임 배치: 0-1 idle, 2-5 walk, 6-9 work, 10 sleep
"""
from PIL import Image, ImageDraw

S = 32
FRAMES = 11


# ------------------------------------------------------------------ helpers
def _mask_from_img(img, cx, cy):
    """이미지(흰색=채움)를 32 그리드 픽셀 집합으로. (cx, cy)에 중심을 맞춘다."""
    w, h = img.size
    px = img.load()
    ox = int(round(cx - (w - 1) / 2))
    oy = int(round(cy - (h - 1) / 2))
    out = set()
    for y in range(h):
        for x in range(w):
            if px[x, y] > 110:
                out.add((ox + x, oy + y))
    return out


def rounded(w, h, r):
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    return img


def block(w, h, r, cx, cy, angle=0):
    """둥근 모서리 블록을 cx,cy 중심에 놓고(필요하면 회전) 픽셀 집합으로."""
    img = rounded(w, h, r)
    if angle:
        pad = 12
        canvas = Image.new("L", (w + pad * 2, h + pad * 2), 0)
        canvas.paste(img, (pad, pad))
        canvas = canvas.rotate(angle, resample=Image.BILINEAR, center=(canvas.width // 2, canvas.height // 2))
        canvas = canvas.point(lambda v: 255 if v > 120 else 0)
        img = canvas
    return _mask_from_img(img, cx, cy)


def disc(m, cx, cy, r):
    for y in range(int(cy - r - 1), int(cy + r + 2)):
        for x in range(int(cx - r - 1), int(cx + r + 2)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                m.add((x, y))


def rect(m, x0, x1, y0, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            m.add((x, y))


# ------------------------------------------------------------------ 실루엣
def mask_oiji(st):
    """네 귀퉁이가 둥글게 튀어나온 네잎(ㅍ) 실루엣."""
    m = set()
    bob = st["bob"]
    lean = st["lean"]
    disc(m, 16 + lean, 17.5 + bob, 6.4)
    for ox, oy in ((-5.4, -5.2), (5.4, -5.2), (-5.4, 5.2), (5.4, 5.2)):
        disc(m, 16 + ox + lean, 17.5 + oy + bob, 6.5)
    return {"body": m}


def mask_takuan(st):
    """크림색 둥근 네모 쿠션. 가운데 살짝 오목한 얼굴 판."""
    bob = st["bob"]
    lean = st["lean"]
    lift = st.get("lift", 0)
    m = block(22, 23, 7, 16 + lean, 18 + bob - lift)
    return {"body": m}


def mask_sbji(st):
    """K-EXAONE 심볼: 위 보라 · 왼쪽 마젠타 · 아래 오렌지 블록이 고리처럼 물린 형태."""
    bob = st["bob"]
    lean = st["lean"]
    sway = st.get("sway", 0)
    purple = block(15, 17, 5, 17.0 + lean, 11.5 + bob, angle=-12)
    pink = block(14, 17, 5, 9.5 + lean, 18.0 + bob, angle=-6)
    orange = block(21, 9, 4, 19.0 + lean + sway, 23.5 + bob, angle=12)
    return {"purple": purple, "pink": pink, "orange": orange}


def mask_clawd(st):
    """Clawd: 가로로 넓은 네모 몸 + 양옆 작은 네모 팔 + 다리 네 개(가운데 비움)."""
    bob = st["bob"]
    arm_dy = st.get("arm", 0)
    leg_lift = st.get("legs", (0, 0, 0, 0))
    m = set()
    rect(m, 6, 25, 7 + bob, 22 + bob)          # 몸통
    # 모서리 1px 라운딩
    for (cx, cy) in ((6, 7 + bob), (25, 7 + bob), (6, 22 + bob), (25, 22 + bob)):
        m.discard((cx, cy))
    rect(m, 3, 5, 13 + bob + arm_dy, 18 + bob + arm_dy)     # 왼팔
    rect(m, 26, 28, 13 + bob + arm_dy, 18 + bob + arm_dy)   # 오른팔
    for i, (x0, x1) in enumerate(((8, 10), (13, 15), (17, 19), (22, 24))):
        rect(m, x0, x1, 23 + bob, 29 + bob - leg_lift[i])
    return {"body": m}


def states_for_frame(f, kind):
    """프레임 → (bob, lean, ...) 애니메이션 상태."""
    st = {"bob": 0, "lean": 0, "walk": False, "lift": 0, "arm": 0, "legs": (0, 0, 0, 0), "sway": 0}
    if f == 1:
        st["bob"] = 1
    elif 2 <= f <= 5:
        st["walk"] = True
        st["bob"] = [0, -1, 0, -1][f - 2]
        st["lean"] = [0, 1, 0, -1][f - 2]
        ph = [0, 1, 0, 1][f - 2]
        st["legs"] = tuple(ph if i % 2 == 0 else 1 - ph for i in range(4))
        st["lift"] = 1 if f % 2 else 0
        st["sway"] = 1 if ph else -1
    elif 6 <= f <= 9:
        st["bob"] = [0, 1, 0, 1][f - 6]
        st["arm"] = [-1, 0, -1, 0][f - 6]
        st["sway"] = [0, 1, 0, 1][f - 6]
    elif f == 10:
        st["bob"] = 1
    return st


# ------------------------------------------------------------------ 그리기
def rim(mask, x, y, tones):
    def out(a, b):
        return (a, b) not in mask

    if out(x - 1, y) or out(x, y - 1) or out(x - 2, y - 1) or out(x - 1, y - 2):
        return tones[0]
    if out(x + 1, y) or out(x, y + 1) or out(x + 2, y + 1) or out(x + 1, y + 2):
        return tones[2]
    return tones[1]


def paint_layer(d, mask, tones, line, lean=0, bob=0, spec=None, spec_at=()):
    for (x, y) in sorted(mask, key=lambda p: (p[1], p[0])):
        edge = any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        d.point((x + lean, y + bob), fill=line if edge else rim(mask, x, y, tones))
    for (hx, hy) in spec_at:
        if (hx, hy) in mask and spec:
            d.point((hx + lean, hy + bob), fill=spec)


EYE = [".###", "####", "####", "####", "####", ".###"]  # 4x6 타원


def draw_eyes(d, cx_list, cy, lean, bob, color="#241a2e", shine="#ffffff", closed=False):
    """세로로 긴 검은 타원 눈 + 오른쪽 위 흰 하이라이트."""
    for cx in cx_list:
        if closed:
            for x in range(-2, 2):
                d.point((cx + x + lean, cy + bob), fill=color)
            d.point((cx - 2 + lean, cy + 1 + bob), fill=color)
            d.point((cx + 1 + lean, cy + 1 + bob), fill=color)
            continue
        for j, row in enumerate(EYE):
            for i, ch in enumerate(row):
                if ch == "#":
                    d.point((cx - 2 + i + lean, cy - 3 + j + bob), fill=color)
        d.point((cx + lean, cy - 2 + bob), fill=shine)


def build(kind, pal):
    frames = []
    for f in range(FRAMES):
        st = states_for_frame(f, kind)
        img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        lean, bob = st["lean"], st["bob"]
        eye_closed = (f == 10)

        if kind == "oiji":
            m = mask_oiji(st)["body"]
            paint_layer(d, m, pal["tones"], pal["line"], spec=pal.get("spec"),
                        spec_at=((9, 10), (10, 9)))
            draw_eyes(d, (12, 20), 17, lean, bob, color=pal["eye"], closed=eye_closed)

        elif kind == "takuan":
            m = mask_takuan(st)["body"]
            paint_layer(d, m, pal["tones"], pal["line"], lean, bob, spec=pal.get("spec"),
                        spec_at=((9, 10), (10, 9)))
            # 오목하게 들어간 얼굴 판: 판 둘레 1px 그림자 + 안쪽은 살짝만 밝게
            cx, cy = 16 + lean, 18 + bob - st["lift"]
            body = lambda x, y: (x - lean, y - bob + st["lift"]) in m
            plate = block(14, 13, 4, cx, cy)
            ring = set()
            for (x, y) in plate:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                    q = (x + dx, y + dy)
                    if q not in plate:
                        ring.add(q)
            for (x, y) in sorted(ring, key=lambda p: (p[1], p[0])):
                if body(x, y):
                    d.point((x, y), fill=pal["rim"])
            for (x, y) in sorted(plate, key=lambda p: (p[1], p[0])):
                if body(x, y):
                    d.point((x, y), fill=pal["plate"])
            draw_eyes(d, (12, 20), 17, lean, bob, color=pal["eye"], closed=eye_closed)
            if not eye_closed and pal.get("blush"):
                for bx in (9, 21):
                    d.point((bx + lean, 22 + bob), fill=pal["blush"])
                    d.point((bx + 1 + lean, 22 + bob), fill=pal["blush"])
                    d.point((bx + lean, 23 + bob), fill=pal["blush"])

        elif kind == "sbji":
            layers = mask_sbji(st)
            order = ("purple", "pink", "orange")
            union = set()
            owner = {}
            for name in order:
                union |= layers[name]
                for p in layers[name]:
                    owner[p] = name
            # 한 덩어리 실루엣에 세 블록 색을 인레이 — 이음매는 1px 음영
            for (x, y) in sorted(union, key=lambda p: (p[1], p[0])):
                name = owner[(x, y)]
                tones = pal[name]["tones"]
                nbrs = {(x - 1, y): (x - 1, y), (x + 1, y): (x + 1, y),
                        (x, y - 1): (x, y - 1), (x, y + 1): (x, y + 1)}
                if any(p not in union for p in nbrs):
                    c = rim(union, x, y, tones)
                else:
                    c = tones[1]
                    if owner.get((x - 1, y)) != name or owner.get((x, y - 1)) != name:
                        c = tones[0]
                    if owner.get((x + 1, y)) != name or owner.get((x, y + 1)) != name:
                        c = tones[2]
                d.point((x + lean, y + bob), fill=c)
            # 바깥 라인
            for (x, y) in sorted(union, key=lambda p: (p[1], p[0])):
                if any(p not in union for p in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                    d.point((x + lean, y + bob), fill=pal[owner[(x, y)]]["line"])
            for name in order:
                for (hx, hy) in pal[name].get("spec_at", ()):
                    if owner.get((hx, hy)) == name:
                        d.point((hx + lean, hy + bob), fill=pal[name]["spec"])
            draw_eyes(d, (12, 19), 16, lean, bob, color=pal["eye"], closed=eye_closed)

        elif kind == "clawd":
            m = mask_clawd(st)["body"]
            paint_layer(d, m, pal["tones"], pal["line"], spec=pal.get("spec"),
                        spec_at=((8, 9), (9, 8)))
            # 팔이 몸통과 만나는 자리에 이음선
            for x in (6, 25):
                for y in range(14 + bob, 18 + bob):
                    if (x, y - bob) in m:
                        d.point((x, y), fill=pal["tones"][2])
            draw_eyes(d, (12.5, 19.5), 14, 0, bob, color=pal["eye"], closed=eye_closed)

        # 작업 중 — 앞쪽에 작은 손 (Clawd는 다리가 이미 있으니 생략)
        if 6 <= f <= 9 and kind in ("oiji", "takuan"):
            hy = 27 + [0, 1, 0, 1][f - 6]
            for hxx in (9, 22):
                d.point((hxx, hy), fill=pal["tones"][0])
                d.point((hxx + 1, hy), fill=pal["tones"][0])
                d.point((hxx, hy + 1), fill=pal["tones"][2])
                d.point((hxx + 1, hy + 1), fill=pal["tones"][2])

        frames.append(img)

    sheet = Image.new("RGBA", (S * len(frames), S), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sheet.paste(fr, (i * S, 0), fr)
    return sheet
