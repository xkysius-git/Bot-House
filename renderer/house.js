/* A.I.Mon — 하우스 화면: 방 3개(침실·거실·작업실) + 홀로그램 캐릭터
 *
 * 방은 봇의 실제 상태로 정해진다.
 *   working → 작업실(work)   offline → 침실(bed)   그 외 → 거실(living)
 * 방을 옮길 때는 바닥을 걸어서 이동한다.
 *
 * 스프라이트 시트 두 형식을 모두 받는다.
 *   - 예전 형식: 32px 한 줄 (idle 0-1, walk 2-5, work 6-9, sleep 10)
 *   - 새 형식: 128px 칸, 한 줄에 동작 하나 (idle, emotion, work, sleep, walk), walk는 오른쪽을 본다
 * 방 그림은 assets/rooms/{bed,living,work}_{day,night}.png 가 있으면 그것을 쓰고,
 * 없으면 코드로 그린 임시 방을 쓴다.
 */
(function () {
  'use strict';

  const LW = 480;
  const LH = 270;
  const ROOM_W = 160;
  const WALL_H = 150;
  const LANE = 230;          // 방을 건널 때 걷는 바닥 줄
  const DRAW = 40;           // 캐릭터 표시 크기 (논리 px). 방이 주인공이라 작게 (장현님 11-27)
  const FLOAT = 10;          // 투사기 위로 떠 있는 높이
  const BOT_IDS = ['oiji', 'takuan', 'sbji', 'claude'];
  const ROOMS = ['bed', 'living', 'work'];
  const ROOM_X = { bed: 0, living: ROOM_W, work: ROOM_W * 2 };
  const OLD_ATLAS = { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7, 8, 9], sleep: [10], emotion: [0, 1] };
  const NEW_ROWS = { idle: 0, emotion: 1, work: 2, sleep: 3, walk: 4 };
  const FPS = { walk: 8, idle: 2, work: 6, sleep: 1, emotion: 6 };
  const SPOTS = {
    bed: [{ x: 28, y: 190 }, { x: 62, y: 194 }, { x: 98, y: 190 }, { x: 132, y: 194 }],
    work: [{ x: 352, y: 212 }, { x: 386, y: 218 }, { x: 420, y: 212 }, { x: 454, y: 218 }]
  };
  const LIVING_BOX = { x0: 182, x1: 298, y0: 198, y1: 236 };
  const HOLO = '#7ff6ff';
  // 방 하나씩 보기: 화면 폭에 방 하나(+양옆 조금)를 꽉 채우고, 아래 키로 방을 옮긴다
  // 기본은 집 전체(방 3개)를 한 화면에, 아래 ◀ ▶ 로 캐릭터 하나씩 클로즈업 (장현님 11-27)
  const FOCUS_ZOOM = 3;      // 클로즈업 배율 (전체 보기 대비)
  const FOCUS_AT = 0.33;     // 클로즈업한 캐릭터가 설 가로 위치 (오른쪽은 상태 카드 자리)
  const CAM_Y = { bed: 182, living: 190, work: 186 };

  const state = {
    canvas: null,
    ctx: null,
    scene: null,
    bubblesEl: null,
    onSelect: null,
    images: {},
    sheets: {},
    rooms: { day: null, night: null },
    theme: 'night',
    actors: new Map(),
    botStates: {},
    selected: null,
    view: { w: 0, h: 0, scale: 1, ox: 0, oy: 0, dpr: 1 },
    raf: null,
    lastT: 0,
    bubbleEls: new Map(),
    particles: [],
    cam: { room: 'living', x: LW / 2, y: LH / 2, follow: null }
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /* ------------------------------------------------------------ 스프라이트 시트 */
  function readSheet(img) {
    if (!img) return null;
    if (img.height < 256) {
      const cell = img.height;
      return { img, cell, rows: null, flip: false };
    }
    const cell = 128;
    const cols = Math.max(1, Math.floor(img.width / cell));
    const rows = {};
    let data = null;
    try {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      data = g.getImageData(0, 0, img.width, img.height).data;
    } catch (err) { data = null; }
    const filled = (col, row) => {
      if (!data) return true;
      for (let y = row * cell; y < (row + 1) * cell; y += 4) {
        for (let x = col * cell; x < (col + 1) * cell; x += 4) {
          if (data[(y * img.width + x) * 4 + 3] > 0) return true;
        }
      }
      return false;
    };
    for (const [anim, row] of Object.entries(NEW_ROWS)) {
      if ((row + 1) * cell > img.height) continue;
      const frames = [];
      for (let col = 0; col < cols; col += 1) if (filled(col, row)) frames.push(col);
      if (frames.length) rows[anim] = { row, frames };
    }
    return { img, cell, rows, flip: true };
  }

  function frameOf(id, anim, frame) {
    const sh = state.sheets[id];
    if (!sh) return null;
    if (!sh.rows) {
      const frames = OLD_ATLAS[anim] || OLD_ATLAS.idle;
      return { img: sh.img, sx: frames[frame % frames.length] * sh.cell, sy: 0, s: sh.cell, flip: false };
    }
    const r = sh.rows[anim] || sh.rows.idle;
    if (!r) return null;
    return { img: sh.img, sx: r.frames[frame % r.frames.length] * sh.cell, sy: r.row * sh.cell, s: sh.cell, flip: sh.flip };
  }

  function consonantCount() {
    const c = state.consonants;
    return c ? Math.floor(c.width / 128) : 0;
  }

  function emoteRows() {
    const c = state.claudeEmotes;
    return c ? Math.floor(c.height / 128) : 0;
  }

  // 피클 감정 줄: 변신 3칸을 한 번 재생한 뒤 고른 자음으로 머문다.
  // 클로드 감정: claude-emotes.png에서 고른 줄(8칸)을 반복 재생한다.
  function morphFrame(actor) {
    const e = actor.emote;
    if (!e || actor.anim !== 'emotion') return null;
    const rel = (actor.frame - e.frame0 + 120) % 120; // frame은 120에서 0으로 돌아감
    if (e.clipRow >= 0) {
      const cols = Math.max(1, Math.floor(state.claudeEmotes.width / 128));
      return { img: state.claudeEmotes, sx: (rel % cols) * 128, sy: e.clipRow * 128, s: 128, flip: true };
    }
    if (e.consonant < 0) return null;
    if (rel < 3) return frameOf(actor.def.id, 'emotion', Math.max(0, rel));
    return { img: state.consonants, sx: e.consonant * 128, sy: 0, s: 128, flip: false };
  }

  function hasEmotion(id) {
    const sh = state.sheets[id];
    return !!(sh && sh.rows && sh.rows.emotion);
  }

  function px(g, x, y, w, h, c) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  /* ------------------------------------------------------------ 방 그림 (탑뷰) */
  // 장현님 11-27: "너무 평면적" → 위에서 내려다보는 실내. 뒷벽은 위쪽 띠, 바닥이 넓게 보이고
  // 가구는 윗면 + 앞면(높이) + 그림자 + 진한 외곽선. 캐릭터 자리(SPOTS·LIVING_BOX)·램프·모니터 좌표는 그대로.
  const TOP_WALL = 56;       // 뒷벽 면이 끝나는 높이 (여기부터 바닥)
  const DOOR = { y0: 198, y1: 254 };   // 방 사이 문 (LANE 230 지나감)

  const TV = {
    night: {
      out: '#07050f', shadow: 'rgba(0,0,0,.35)', cap: '#141026', capHi: '#2a2448',
      wall: { bed: ['#24204a', '#2b2655', '#1b1838'], living: ['#33223f', '#3b2949', '#271a31'], work: ['#18293f', '#1e324b', '#122033'] },
      base: '#120e22',
      wood: ['#4f3756', '#5c4163', '#432e49', '#38273d'],
      tile: ['#22314a', '#283a56', '#1b2840'],
      rug: ['#43305e', '#523b70', '#352650', '#c0a060'],
      sky: '#0d1430', sky2: '#16204a', frame: '#4a3f72', moon: '#fff3c4',
      bedWood: ['#6b4a5c', '#573c4b', '#3f2b37'], sheet: ['#4a5aa0', '#3d4a88', '#2e3970', '#6576bd'], pillow: ['#b9c2ee', '#8e98cc'],
      sofa: ['#7a4466', '#663856', '#4f2b43', '#8c5277'],
      deskTop: ['#4a3f5c', '#574a6c'], deskFront: '#352c45', metal: ['#3d3a52', '#2b293c', '#575473'],
      mon: '#0c0a16', monEdge: '#4d4466',
      leaf: ['#2f7a5a', '#3c946d', '#225a43'], pot: ['#7a5242', '#5e3e33'],
      book: ['#7a4bd0', '#d06a4b', '#4bb0d0', '#d0b04b', '#5ac08a'],
      lampShade: '#ffd98a', lampBase: '#5c4a3a', paper: '#cfd6f0', mug: '#d06a4b', led: '#7ff6ff'
    },
    day: {
      out: '#3a2a20', shadow: 'rgba(60,35,20,.22)', cap: '#8a6c58', capHi: '#b39780',
      wall: { bed: ['#dfe6f5', '#e9eefa', '#c9d2e8'], living: ['#f4e4cf', '#f9eddc', '#e3cfb5'], work: ['#dcefea', '#e8f6f2', '#c4ddd6'] },
      base: '#9a7458',
      wood: ['#c99a6b', '#d4a777', '#b98a5d', '#a77a50'],
      tile: ['#e6ece9', '#f2f5f3', '#cdd6d2'],
      rug: ['#e8c48a', '#f0d29e', '#d9ad6c', '#c0603e'],
      sky: '#9fd6ff', sky2: '#cdeaff', frame: '#ffffff', moon: '#fff2a0',
      bedWood: ['#a5764f', '#8c623f', '#6e4b30'], sheet: ['#7a92e6', '#6a82d6', '#5a6fc0', '#98acf0'], pillow: ['#ffffff', '#dfe4f5'],
      sofa: ['#e07a5f', '#c9664d', '#a9523d', '#ec9178'],
      deskTop: ['#c49a74', '#d3ab86'], deskFront: '#a17a58', metal: ['#8c8aa0', '#706e86', '#b0aec4'],
      mon: '#1d1a28', monEdge: '#57506a',
      leaf: ['#4fae6a', '#66c07e', '#3a8c52'], pot: ['#c07a50', '#a0623e'],
      book: ['#7a4bd0', '#e0664b', '#3fa0c8', '#e0b23f', '#4fae6a'],
      lampShade: '#fff1c2', lampBase: '#8a6a4a', paper: '#ffffff', mug: '#e0664b', led: '#3fa0c8'
    }
  };

  // 같은 좌표면 늘 같은 값 (질감용 잡음)
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  // 위에서 본 물건: 윗면(w×d) + 앞면(높이 h) + 아래 그림자 + 외곽선
  function box(g, t, x, y, w, d, h, top, front, hi) {
    px(g, x + 1, y + d + h, w, 3, t.shadow);
    px(g, x - 1, y - 1, w + 2, d + h + 2, t.out);
    px(g, x, y, w, d, top);
    if (hi) px(g, x, y, w, 1, hi);
    if (h > 0) {
      px(g, x, y + d, w, h, front);
      px(g, x, y + d, w, 1, t.out);
    }
  }

  // 면에 잔무늬(디더) 찍기: 넓은 단색 면이 클로즈업에서 비어 보이지 않게
  function dither(g, x, y, w, h, c, rate) {
    for (let yy = y; yy < y + h; yy += 2) {
      for (let xx = x + (yy % 4 ? 1 : 0); xx < x + w; xx += 2) if (hash(xx, yy) < rate) px(g, xx, yy, 1, 1, c);
    }
  }

  function woodFloor(g, t, x0, y0, w, h) {
    for (let y = y0, row = 0; y < y0 + h; y += 8, row += 1) {
      const off = (row * 37) % 48;
      for (let x = x0 - off; x < x0 + w; x += 48) {
        const bx = Math.max(x0, x);
        const bw = Math.min(x0 + w, x + 48) - bx;
        const c = t.wood[Math.floor(hash(x, row) * 3)];
        px(g, bx, y, bw, 8, c);
        px(g, bx, y + 7, bw, 1, t.wood[3]);
        if (x >= x0) px(g, x, y, 1, 7, t.wood[3]);
        // 나뭇결
        const gx = bx + 6 + Math.floor(hash(row, x) * Math.max(1, bw - 18));
        if (bw > 20) px(g, gx, y + 3, 10, 1, t.wood[2]);
      }
    }
  }

  function tileFloor(g, t, x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y += 16) {
      for (let x = x0; x < x0 + w; x += 16) {
        const c = ((x - x0) / 16 + (y - y0) / 16) % 2 ? t.tile[0] : t.tile[1];
        px(g, x, y, Math.min(16, x0 + w - x), Math.min(16, y0 + h - y), c);
        px(g, x, y, Math.min(16, x0 + w - x), 1, t.tile[2]);
        px(g, x, y, 1, Math.min(16, y0 + h - y), t.tile[2]);
      }
    }
  }

  function rug(g, t, x, y, w, h) {
    px(g, x - 1, y - 1, w + 2, h + 2, t.out);
    px(g, x, y, w, h, t.rug[2]);
    px(g, x + 3, y + 3, w - 6, h - 6, t.rug[0]);
    px(g, x + 6, y + 6, w - 12, h - 12, t.rug[1]);
    dither(g, x + 6, y + 6, w - 12, h - 12, t.rug[0], 0.18);
    // 무늬: 가장자리 점선 + 가운데 마름모
    for (let i = x + 8; i < x + w - 8; i += 6) { px(g, i, y + 4, 2, 1, t.rug[3]); px(g, i, y + h - 5, 2, 1, t.rug[3]); }
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    for (let k = 0; k < 6; k += 1) {
      px(g, cx - k, cy - 6 + k, 1, 1, t.rug[3]); px(g, cx + k, cy - 6 + k, 1, 1, t.rug[3]);
      px(g, cx - k, cy + 6 - k, 1, 1, t.rug[3]); px(g, cx + k, cy + 6 - k, 1, 1, t.rug[3]);
    }
    // 술 장식
    for (let i = x + 2; i < x + w - 2; i += 4) { px(g, i, y - 3, 1, 2, t.rug[2]); px(g, i, y + h + 1, 1, 2, t.rug[2]); }
  }

  function plant(g, t, x, y) {
    box(g, t, x + 3, y + 14, 12, 6, 6, t.pot[0], t.pot[1]);
    px(g, x - 1, y - 1, 20, 17, t.out);
    px(g, x, y, 18, 15, t.leaf[2]);
    [[2, 2, 7, 6], [9, 1, 7, 6], [4, 7, 10, 6], [1, 8, 5, 5], [12, 8, 5, 5]].forEach(([a, b, c, d]) => px(g, x + a, y + b, c, d, t.leaf[0]));
    [[4, 3], [11, 2], [7, 8], [13, 10]].forEach(([a, b]) => px(g, x + a, y + b, 2, 1, t.leaf[1]));
  }

  function backWall(g, t, room, x0) {
    const [c, c2, c3] = t.wall[room];
    px(g, x0, 0, ROOM_W, TOP_WALL, c);
    for (let x = x0 + 4; x < x0 + ROOM_W; x += 10) px(g, x, 6, 1, TOP_WALL - 14, c2);
    px(g, x0, TOP_WALL - 10, ROOM_W, 1, c3);
    px(g, x0, TOP_WALL - 9, ROOM_W, 5, c2);
    px(g, x0, TOP_WALL - 4, ROOM_W, 4, t.base);
    px(g, x0, 0, ROOM_W, 5, t.cap);
    px(g, x0, 4, ROOM_W, 1, t.out);
  }

  function windowTop(g, t, x, y, w, h, theme) {
    px(g, x - 3, y - 3, w + 6, h + 6, t.out);
    px(g, x - 2, y - 2, w + 4, h + 4, t.frame);
    px(g, x, y, w, h, t.sky);
    px(g, x, y + Math.floor(h * 0.55), w, Math.ceil(h * 0.45), t.sky2);
    if (theme === 'night') {
      px(g, x + w - 10, y + 4, 5, 5, t.moon);
      px(g, x + w - 9, y + 4, 4, 3, t.sky);
      [[3, 5], [9, 12], [15, 3]].forEach(([a, b]) => { if (a < w - 12) px(g, x + a, y + b, 1, 1, '#ffffff'); });
    } else {
      px(g, x + w - 11, y + 4, 6, 6, t.moon);
      px(g, x + 3, y + h - 7, 10, 2, '#ffffff');
    }
    px(g, x + Math.floor(w / 2) - 1, y, 2, h, t.frame);
    px(g, x - 4, y + h + 2, w + 8, 2, t.frame);
  }

  function drawBedroomTop(g, t, theme) {
    const x0 = ROOM_X.bed;
    woodFloor(g, t, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, t, 'bed', x0);
    windowTop(g, t, x0 + 20, 12, 36, 24, theme);
    // 벽시계
    px(g, x0 + 99, 13, 16, 16, t.out);
    px(g, x0 + 100, 14, 14, 14, t.frame);
    px(g, x0 + 102, 16, 10, 10, theme === 'night' ? '#2b2650' : '#ffffff');
    px(g, x0 + 106, 17, 2, 5, t.out); px(g, x0 + 106, 21, 4, 1, t.out);
    // 서랍장 (왼쪽 위)
    box(g, t, x0 + 6, TOP_WALL + 4, 30, 12, 12, t.bedWood[0], t.bedWood[1], t.bedWood[0]);
    px(g, x0 + 10, TOP_WALL + 19, 8, 1, t.bedWood[2]); px(g, x0 + 24, TOP_WALL + 19, 8, 1, t.bedWood[2]);
    px(g, x0 + 12, TOP_WALL + 6, 6, 4, t.book[1]); px(g, x0 + 24, TOP_WALL + 5, 5, 5, t.paper);
    // 협탁 + 스탠드 (램프 빛 중심 137,74)
    box(g, t, x0 + 126, 64, 22, 12, 8, t.bedWood[0], t.bedWood[1]);
    px(g, x0 + 131, 62, 12, 10, t.out);
    px(g, x0 + 132, 63, 10, 8, t.lampShade);
    px(g, x0 + 132, 63, 10, 2, '#ffffff');
    // 큰 침대 (4명): 머리판 → 베개 → 이불 → 앞면
    const bx = x0 + 6, bw = 148;
    box(g, t, bx, 96, bw, 8, 6, t.bedWood[0], t.bedWood[1], t.bedWood[0]);
    px(g, bx - 1, 109, bw + 2, 96, t.out);
    px(g, bx, 110, bw, 86, t.pillow[1]);
    [16, 50, 86, 120].forEach((p) => {
      px(g, x0 + p - 1, 113, 26, 13, t.out);
      px(g, x0 + p, 114, 24, 11, t.pillow[0]);
      px(g, x0 + p, 122, 24, 3, t.pillow[1]);
    });
    px(g, bx, 134, bw, 62, t.sheet[0]);
    px(g, bx, 134, bw, 5, t.sheet[3]);
    px(g, bx, 139, bw, 1, t.sheet[2]);
    dither(g, bx, 140, bw, 50, t.sheet[1], 0.12);
    for (let x = bx + 37; x < bx + bw; x += 37) px(g, x, 140, 1, 50, t.sheet[2]);
    for (let y = 152; y < 190; y += 13) px(g, bx, y, bw, 1, t.sheet[2]);
    px(g, bx, 190, bw, 6, t.sheet[1]);
    px(g, bx, 196, bw, 8, t.bedWood[1]);
    px(g, bx, 196, bw, 1, t.out);
    px(g, bx + 1, 205, bw, 3, t.shadow);
    // 러그 + 슬리퍼
    rug(g, t, x0 + 36, 216, 88, 32);
    px(g, x0 + 50, 230, 6, 4, t.sheet[3]); px(g, x0 + 58, 231, 6, 4, t.sheet[3]);
    plant(g, t, x0 + 8, 226);
  }

  function drawLivingTop(g, t, theme) {
    const x0 = ROOM_X.living;
    woodFloor(g, t, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, t, 'living', x0);
    windowTop(g, t, x0 + 60, 10, 40, 28, theme);
    px(g, x0 + 52, 8, 7, 38, t.sofa[2]); px(g, x0 + 101, 8, 7, 38, t.sofa[2]);
    px(g, x0 + 50, 6, 60, 3, t.bedWood[2]);
    // 액자
    px(g, x0 + 15, 15, 24, 18, t.out);
    px(g, x0 + 16, 16, 22, 16, t.frame);
    px(g, x0 + 18, 18, 18, 7, t.sky2);
    px(g, x0 + 18, 25, 18, 5, t.leaf[0]);
    // 큰 러그
    rug(g, t, x0 + 14, 112, 132, 134);
    // 소파 (뒷벽에 붙여 아래를 봄): 등받이 → 방석 → 팔걸이 → 앞면
    const sx = x0 + 22, sw = 116;
    box(g, t, sx, TOP_WALL + 2, sw, 10, 8, t.sofa[0], t.sofa[1], t.sofa[3]);
    px(g, sx - 1, TOP_WALL + 19, sw + 2, 22, t.out);
    px(g, sx, TOP_WALL + 20, sw, 14, t.sofa[0]);
    px(g, sx + Math.floor(sw / 3), TOP_WALL + 20, 1, 14, t.sofa[2]);
    px(g, sx + Math.floor(sw * 2 / 3), TOP_WALL + 20, 1, 14, t.sofa[2]);
    dither(g, sx, TOP_WALL + 20, sw, 14, t.sofa[1], 0.15);
    px(g, sx, TOP_WALL + 34, sw, 6, t.sofa[1]);
    px(g, sx + 1, TOP_WALL + 41, sw, 3, t.shadow);
    box(g, t, sx - 8, TOP_WALL + 6, 8, 28, 6, t.sofa[1], t.sofa[2], t.sofa[0]);
    box(g, t, sx + sw, TOP_WALL + 6, 8, 28, 6, t.sofa[1], t.sofa[2], t.sofa[0]);
    // 쿠션
    px(g, sx + 8, TOP_WALL + 21, 14, 9, t.out); px(g, sx + 9, TOP_WALL + 22, 12, 7, t.rug[3]);
    px(g, sx + sw - 22, TOP_WALL + 21, 14, 9, t.out); px(g, sx + sw - 21, TOP_WALL + 22, 12, 7, t.pillow[0]);
    // 커피 테이블 + 머그·책
    box(g, t, x0 + 52, 136, 56, 20, 6, t.bedWood[0], t.bedWood[1], t.bedWood[0]);
    px(g, x0 + 60, 140, 12, 9, t.out); px(g, x0 + 61, 141, 10, 7, t.book[2]); px(g, x0 + 61, 141, 10, 1, t.paper);
    px(g, x0 + 92, 141, 7, 7, t.out); px(g, x0 + 93, 142, 5, 5, t.mug); px(g, x0 + 94, 143, 3, 2, '#3a2a20');
    // 화분 + 플로어 스탠드
    plant(g, t, x0 + 140, TOP_WALL + 6);
    plant(g, t, x0 + 2, 226);
    px(g, x0 + 144, 225, 10, 10, t.out); px(g, x0 + 145, 226, 8, 8, t.lampShade); px(g, x0 + 145, 226, 8, 2, '#ffffff');
    px(g, x0 + 148, 235, 2, 8, t.lampBase); px(g, x0 + 145, 243, 8, 2, t.lampBase);
  }

  function drawWorkTop(g, t, theme) {
    const x0 = ROOM_X.work;
    tileFloor(g, t, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, t, 'work', x0);
    // 책장 (뒷벽)
    px(g, x0 + 11, 7, 62, 42, t.out);
    px(g, x0 + 12, 8, 60, 40, t.bedWood[1]);
    [10, 24, 38].forEach((sy) => {
      px(g, x0 + 14, sy, 56, 12, t.bedWood[2]);
      for (let i = 0; i < 9; i += 1) {
        const h = 9 + Math.floor(hash(i, sy) * 3);
        px(g, x0 + 15 + i * 6, sy + 12 - h, 5, h, t.book[(i + sy) % 5]);
      }
      px(g, x0 + 12, sy + 12, 60, 2, t.bedWood[0]);
    });
    // A.I.Mon 포스터
    px(g, x0 + 97, 11, 42, 32, t.out);
    px(g, x0 + 98, 12, 40, 30, t.frame);
    px(g, x0 + 100, 14, 36, 26, theme === 'night' ? '#120f24' : '#2b2440');
    px(g, x0 + 106, 20, 24, 3, HOLO);
    px(g, x0 + 110, 26, 16, 2, '#ff7a59');
    px(g, x0 + 112, 31, 12, 2, '#b15ce8');
    // 서버 랙 (왼쪽 위)
    box(g, t, x0 + 6, TOP_WALL + 2, 22, 14, 34, t.metal[0], t.metal[1], t.metal[2]);
    for (let y = TOP_WALL + 20; y < TOP_WALL + 48; y += 6) { px(g, x0 + 8, y, 18, 4, t.metal[2]); px(g, x0 + 10, y + 1, 2, 2, t.led); px(g, x0 + 14, y + 1, 2, 2, hash(y, 3) > 0.5 ? '#ff7a59' : t.led); }
    plant(g, t, x0 + 138, TOP_WALL + 4);
    // 긴 책상 + 모니터 4대 (모니터 화면 좌표는 drawMonitors 와 같음: y 131~148)
    box(g, t, x0 + 8, 124, 144, 32, 10, t.deskTop[0], t.deskFront, t.deskTop[1]);
    px(g, x0 + 12, 167, 3, 8, t.deskFront); px(g, x0 + 145, 167, 3, 8, t.deskFront);
    SPOTS.work.forEach((s) => {
      const mx = s.x - 13;
      px(g, mx - 2, 128, 30, 23, t.out);
      px(g, mx - 1, 129, 28, 21, t.monEdge);
      px(g, mx + 1, 131, 24, 17, t.mon);
      px(g, mx + 2, 132, 6, 1, 'rgba(255,255,255,.15)');
      // 키보드 · 마우스
      px(g, mx + 2, 151, 20, 4, t.out); px(g, mx + 3, 152, 18, 2, t.metal[2]);
      px(g, mx + 24, 151, 3, 4, t.metal[2]);
    });
    // 바닥 케이블 + 의자 자국 없는 작업 매트
    px(g, x0 + 20, 178, 120, 1, t.metal[1]);
    rug(g, t, x0 + 20, 196, 120, 40);
    // 종이 더미
    px(g, x0 + 124, 238, 14, 10, t.out); px(g, x0 + 125, 239, 12, 8, t.paper); px(g, x0 + 127, 241, 8, 1, t.metal[0]);
  }

  // 방 사이 벽(위에서 본 벽 윗면) + 문, 바깥 벽
  function wallsTop(g, t) {
    const cap = (x, y, w, h) => { px(g, x, y, w, h, t.out); px(g, x + 1, y, w - 2, h, t.cap); px(g, x + 1, y, 1, h, t.capHi); };
    [ROOM_W, ROOM_W * 2].forEach((x) => {
      cap(x - 4, 0, 8, DOOR.y0);
      cap(x - 4, DOOR.y1, 8, LH - DOOR.y1);
      // 문턱
      px(g, x - 4, DOOR.y0, 8, DOOR.y1 - DOOR.y0, t.wood[3]);
      px(g, x - 4, DOOR.y0 + 2, 8, 1, t.out); px(g, x - 4, DOOR.y1 - 3, 8, 1, t.out);
    });
    cap(0, 0, 4, LH);
    cap(LW - 4, 0, 4, LH);
    px(g, 0, LH - 6, LW, 6, t.out);
    px(g, 0, LH - 5, LW, 5, t.cap);
    px(g, 0, LH - 5, LW, 1, t.capHi);
  }

  function buildRoom(theme) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d');
    const t = TV[theme];
    drawBedroomTop(g, t, theme);
    drawLivingTop(g, t, theme);
    drawWorkTop(g, t, theme);
    wallsTop(g, t);
    return c;
  }

  function roomImage() {
    const t = state.theme;
    const custom = state.images[`rooms_${t}`];
    if (custom) return custom;
    if (!state.rooms[t]) state.rooms[t] = buildRoom(t);
    return state.rooms[t];
  }

  async function loadCustomRooms() {
    // 오이지가 방 그림을 주면 assets/rooms/ 에 넣는다. 셋 다 있어야 쓴다.
    for (const t of ['day', 'night']) {
      const imgs = await Promise.all(ROOMS.map((r) => loadImage(`../assets/rooms/${r}_${t}.png`)));
      if (imgs.every(Boolean)) {
        const c = document.createElement('canvas');
        c.width = LW;
        c.height = LH;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        imgs.forEach((img, i) => g.drawImage(img, ROOM_X[ROOMS[i]], 0, ROOM_W, LH));
        state.images[`rooms_${t}`] = c;
      }
    }
  }

  /* ------------------------------------------------------------ 초기화 */
  async function init(opts) {
    state.canvas = opts.canvas;
    state.ctx = state.canvas.getContext('2d');
    state.scene = opts.scene;
    state.bubblesEl = opts.bubbles;
    state.onSelect = opts.onSelect;
    state.botStates = opts.bots || {};

    const sprites = await Promise.all(BOT_IDS.map((id) => loadImage(`../assets/sprites/${id}.png`)));
    BOT_IDS.forEach((id, i) => { state.sheets[id] = readSheet(sprites[i]); });
    // 피클 변신: 감정 줄 앞 3칸(힘주기 → 부글부글 → 뿅) 뒤에 자음 14개 중 하나로 정착 (128칸 가로 띠)
    state.consonants = await loadImage('../assets/sprites/oiji-consonants.png');
    // 클로드 감정: 공식 동작 여러 개(줄마다 8칸) 중 하나를 랜덤으로 재생
    state.claudeEmotes = await loadImage('../assets/sprites/claude-emotes.png');
    await loadCustomRooms();

    const now = performance.now();
    for (const bot of opts.botDefs) {
      const idx = Math.max(0, BOT_IDS.indexOf(bot.id));
      const room = roomFor(state.botStates[bot.id]);
      const spot = spotFor(room, idx, null);
      state.actors.set(bot.id, {
        def: bot,
        idx,
        x: spot.x,
        y: spot.y,
        room,
        goal: room,
        queue: [],
        anim: animFor(room),
        frame: 0,
        frameT: 0,
        restUntil: now + Math.random() * 4000,
        nextEmote: now + 3000 + Math.random() * 8000,
        emote: null,
        hop: 0,
        facing: 1,
        phase: Math.random() * Math.PI * 2,
        glitchUntil: 0,
        holo: document.createElement('canvas')
      });
      const el = document.createElement('div');
      el.className = 'bubble';
      el.hidden = true;
      state.bubblesEl.appendChild(el);
      state.bubbleEls.set(bot.id, el);
    }

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(state.scene);
    bindPointer();
    state.lastT = performance.now();
    state.raf = requestAnimationFrame(loop);
    return true;
  }

  function resize() {
    if (!state.canvas || !state.scene) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 회전 전환 중에도 정확한 크기 (transform 무시)
    const w = Math.max(1, Math.floor(state.scene.offsetWidth || state.scene.getBoundingClientRect().width));
    const h = Math.max(1, Math.floor(state.scene.offsetHeight || state.scene.getBoundingClientRect().height));
    state.canvas.width = Math.floor(w * dpr);
    state.canvas.height = Math.floor(h * dpr);
    const fit = Math.min(w / LW, h / LH);
    const scale = state.cam.follow ? fit * FOCUS_ZOOM : fit;
    state.view = { w, h, dpr, fit, scale, ox: 0, oy: 0 };
    placeCamera(true);
  }

  function placeCamera(snap, dt) {
    const v = state.view;
    if (!v.scale) return;
    const c = state.cam;
    const follow = c.follow ? state.actors.get(c.follow) : null;
    const f = snap ? 1 : Math.min(1, (dt || 0.016) * 6);
    const target = follow ? v.fit * FOCUS_ZOOM : v.fit;
    v.scale += (target - v.scale) * f;
    let tx = LW / 2;
    let ty = LH / 2;
    if (follow) {
      // 캐릭터를 화면 가운데보다 왼쪽(FOCUS_AT)에 세운다
      tx = follow.x + (0.5 - FOCUS_AT) * v.w / v.scale;
      ty = follow.y - DRAW * 0.6;
    }
    c.x += (tx - c.x) * f;
    c.y += (ty - c.y) * f;
    const ox = v.w / 2 - c.x * v.scale;
    const oy = v.h / 2 - c.y * v.scale;
    const fw = LW * v.scale;
    const fh = LH * v.scale;
    // 집이 화면보다 작으면 가운데, 크면 끝이 화면 안쪽으로 들어오지 않게.
    // 클로즈업 중에는 오른쪽 끝 캐릭터도 왼쪽에 세울 수 있게 오른쪽을 상태 카드 폭만큼 더 허용
    const minX = v.w - fw - (follow ? v.w * 0.4 : 0);
    v.ox = fw <= v.w ? (v.w - fw) / 2 : Math.min(0, Math.max(minX, ox));
    v.oy = fh <= v.h ? (v.h - fh) / 2 : Math.min(0, Math.max(v.h - fh, oy));
    paintRoomLabels();
  }

  function paintRoomLabels() {
    const box = state.scene && state.scene.querySelector('.zone-labels');
    if (!box) return;
    box.classList.remove('cam');
    box.hidden = !!state.cam.follow;
  }

  // 방 옮기기 (step = -1 왼쪽 / +1 오른쪽). 옮긴 방에 있는 첫 캐릭터 id를 돌려준다.
  function stepRoom(step) {
    const i = ROOMS.indexOf(state.cam.room);
    state.cam.room = ROOMS[(i + step + ROOMS.length) % ROOMS.length];
    paintRoomLabels();
    return botsIn(state.cam.room)[0] || null;
  }

  function botsIn(room) {
    return BOT_IDS.filter((id) => { const a = state.actors.get(id); return a && a.room === room; });
  }

  function currentRoom() { return state.cam.room; }

  // 캐릭터 클로즈업 (id) / 전체 보기 (null)
  function focusBot(id) {
    state.cam.follow = id && state.actors.has(id) ? id : null;
    paintRoomLabels();
    return state.cam.follow;
  }
  function focused() { return state.cam.follow || null; }

  function setTheme(theme) { state.theme = theme === 'day' ? 'day' : 'night'; }
  function setBots(bots) { state.botStates = bots || {}; }
  function setSelected(id) { state.selected = id; }

  /* ------------------------------------------------------------ 방 / 이동 */
  function roomFor(bs) {
    const st = bs && bs.state;
    if (st === 'working') return 'work';
    if (st === 'offline' || (bs && bs.sleeping)) return 'bed';
    return 'living';
  }

  function animFor(room) {
    if (room === 'work') return 'work';
    if (room === 'bed') return 'sleep';
    return 'idle';
  }

  function randomLivingPoint(actor) {
    const others = Array.from(state.actors.values()).filter((a) => a !== actor);
    let p = null;
    for (let tries = 0; tries < 16; tries += 1) {
      p = {
        x: LIVING_BOX.x0 + Math.random() * (LIVING_BOX.x1 - LIVING_BOX.x0),
        y: LIVING_BOX.y0 + Math.random() * (LIVING_BOX.y1 - LIVING_BOX.y0)
      };
      const far = !actor || Math.hypot(p.x - actor.x, p.y - actor.y) > 30;
      const free = others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > 26 && (!o.queue.length || Math.hypot(o.queue[o.queue.length - 1].x - p.x, o.queue[o.queue.length - 1].y - p.y) > 26));
      if (far && free) break;
    }
    return p;
  }

  function spotFor(room, idx, actor) {
    if (room === 'living') return randomLivingPoint(actor);
    return SPOTS[room][idx % 4];
  }

  function planTo(actor, room) {
    const target = spotFor(room, actor.idx, actor);
    if (Math.abs(target.x - actor.x) > 70) {
      actor.queue = [{ x: actor.x, y: LANE }, { x: target.x, y: LANE }, target];
    } else {
      actor.queue = [target];
    }
  }

  function moveAlong(actor, dt, speed) {
    const t = actor.queue[0];
    const dx = t.x - actor.x;
    const dy = t.y - actor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5) {
      actor.x = t.x;
      actor.y = t.y;
      actor.queue.shift();
      return;
    }
    const step = Math.min(dist, speed * dt);
    actor.x += (dx / dist) * step;
    actor.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.5) actor.facing = dx >= 0 ? 1 : -1;
  }

  function stepActor(actor, dt, now) {
    const bs = state.botStates[actor.def.id] || {};
    const desired = roomFor(bs);
    if (desired !== actor.goal) {
      actor.goal = desired;
      actor.emote = null;
      planTo(actor, desired);
    }

    if (actor.queue.length) {
      const crossing = actor.room !== actor.goal;
      moveAlong(actor, dt, crossing ? 42 : 22);
      actor.anim = 'walk';
      if (!actor.queue.length) {
        actor.room = actor.goal;
        actor.restUntil = now + 2500 + Math.random() * 4500;
        actor.facing = 1;
      }
      return;
    }

    if (actor.room === 'living') {
      if (actor.emote && now < actor.emote.until) {
        actor.anim = hasEmotion(actor.def.id) ? 'emotion' : 'idle';
        return;
      }
      actor.emote = null;
      actor.anim = 'idle';
      if (now > actor.nextEmote) {
        const kinds = ['heart', 'note', 'star', 'excl'];
        const morph = actor.def.id === 'oiji' && consonantCount() > 0;
        const clip = actor.def.id === 'claude' && emoteRows() > 0;
        actor.emote = {
          kind: kinds[Math.floor(Math.random() * kinds.length)], start: now,
          until: now + (morph ? 3200 : clip ? 2700 : 1800),
          consonant: morph ? Math.floor(Math.random() * consonantCount()) : -1,
          clipRow: clip ? Math.floor(Math.random() * emoteRows()) : -1,
          frame0: actor.frame
        };
        actor.hop = 1;
        actor.nextEmote = now + 7000 + Math.random() * 9000;
        return;
      }
      if (now > actor.restUntil) {
        actor.queue = [randomLivingPoint(actor)];
        actor.restUntil = now + 3000 + Math.random() * 5000;
      }
    } else {
      actor.anim = animFor(actor.room);
      if (actor.room === 'bed' && Math.random() < dt * 0.5) {
        state.particles.push({ kind: 'z', x: actor.x + 6, y: actor.y - DRAW + 4, life: 1, vx: 4, vy: -8 });
      }
      if (actor.room === 'work' && Math.random() < dt * 1.2) {
        state.particles.push({ kind: 'spark', x: actor.x + (Math.random() * 20 - 10), y: actor.y - DRAW + 2, life: 1, vx: 0, vy: -12 });
      }
    }
  }

  /* ------------------------------------------------------------ 그리기 */
  const ICONS = {
    heart: { color: '#ff6b8b', art: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] },
    note: { color: '#ffd166', art: ['..####', '..#..#', '..#..#', '###.##', '##..##'] },
    star: { color: '#fff3a0', art: ['...#...', '..###..', '#######', '.#####.', '.##.##.'] },
    excl: { color: '#7ff6ff', art: ['##', '##', '##', '..', '##'] },
    z: { color: '#b9c7ff', art: ['####', '..#.', '.#..', '####'] }
  };

  function drawIcon(g, kind, x, y, alpha) {
    const ic = ICONS[kind];
    if (!ic) return;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = ic.color;
    const w = ic.art[0].length;
    ic.art.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx += 1) {
        if (row[rx] === '#') g.fillRect(Math.round(x - w / 2 + rx), Math.round(y + ry), 1, 1);
      }
    });
    g.restore();
  }

  function drawMonitors(now) {
    const g = state.ctx;
    SPOTS.work.forEach((s, i) => {
      const id = BOT_IDS[i];
      const bs = state.botStates[id] || {};
      const actor = state.actors.get(id);
      const on = bs.state === 'working' && actor && actor.room === 'work' && !actor.queue.length;
      const mx = s.x - 12;
      if (!on) return;
      g.save();
      g.fillStyle = '#1d6f7a';
      g.fillRect(mx, 131, 24, 17);
      g.fillStyle = HOLO;
      for (let l = 0; l < 4; l += 1) {
        const w = 6 + ((Math.floor(now / 260) + l * 3 + i) % 12);
        g.globalAlpha = 0.75;
        g.fillRect(mx + 3, 134 + l * 3, Math.min(18, w), 1);
      }
      if (state.theme === 'night') {
        const glow = g.createRadialGradient(mx + 12, 140, 2, mx + 12, 140, 30);
        glow.addColorStop(0, 'rgba(127, 246, 255, .22)');
        glow.addColorStop(1, 'rgba(127, 246, 255, 0)');
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.8 + Math.sin(now / 200 + i) * 0.2;
        g.fillStyle = glow;
        g.fillRect(mx - 18, 110, 60, 60);
      }
      g.restore();
    });
  }

  function drawBedLamp(now) {
    if (state.theme !== 'night') return;
    const g = state.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grad = g.createRadialGradient(137, 74, 2, 137, 74, 46);
    grad.addColorStop(0, 'rgba(255, 210, 130, .28)');
    grad.addColorStop(1, 'rgba(255, 210, 130, 0)');
    g.fillStyle = grad;
    g.fillRect(90, 28, 94, 94);
    g.restore();
  }

  function drawProjector(actor, now) {
    const g = state.ctx;
    const x = actor.x;
    const y = actor.y;
    const dim = actor.room === 'bed' && !actor.queue.length ? 0.45 : 1;
    g.save();
    // 바닥 그림자 + 투사기 원판
    g.globalAlpha = 0.28;
    g.fillStyle = '#05040c';
    g.beginPath();
    g.ellipse(x, y + 1, 12, 3.6, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = state.theme === 'night' ? '#1a1630' : '#3a3550';
    g.beginPath();
    g.ellipse(x, y, 9, 2.8, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = HOLO;
    g.globalAlpha = (0.65 + Math.sin(now / 300 + actor.phase) * 0.2) * dim;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(x, y - 0.5, 7.5, 2.2, 0, 0, Math.PI * 2);
    g.stroke();
    // 빛기둥
    g.globalCompositeOperation = state.theme === 'night' ? 'lighter' : 'source-over';
    const top = y - DRAW - FLOAT + 4;
    const grad = g.createLinearGradient(0, y, 0, top);
    const a = (state.theme === 'night' ? 0.42 : 0.3) * dim;
    grad.addColorStop(0, `rgba(127, 246, 255, ${a})`);
    grad.addColorStop(1, 'rgba(127, 246, 255, 0)');
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - 7, y - 1);
    g.lineTo(x + 7, y - 1);
    g.lineTo(x + DRAW * 0.42, top);
    g.lineTo(x - DRAW * 0.42, top);
    g.closePath();
    g.fill();
    g.restore();
  }

  // 방 캐릭터에 홀로그램 효과를 입힐지 (꺼 둠: 효과는 홀로그램 화면 UI에만)
  const ROOM_HOLO = false;

  function holoFlicker(actor, now) {
    // 가끔 깜빡이고, 아주 가끔 가로로 어긋난다
    if (now > actor.glitchUntil && Math.random() < 0.004) actor.glitchUntil = now + 90 + Math.random() * 120;
    const glitch = now < actor.glitchUntil;
    const base = 0.86 + Math.sin(now / 70 + actor.phase) * 0.04;
    return { alpha: glitch ? 0.45 : base, glitch };
  }

  function drawHologram(actor, now) {
    const g = state.ctx;
    const v = state.view;
    const sp = morphFrame(actor) || frameOf(actor.def.id, actor.anim, actor.frame);
    if (!sp) return;
    const k = v.dpr * v.scale;
    const sleeping = actor.room === 'bed' && !actor.queue.length;
    const bob = Math.sin(now / 650 + actor.phase) * (sleeping ? 0.8 : 1.6);
    const hopY = actor.hop > 0 ? Math.sin(actor.hop * Math.PI) * 6 : 0;
    const lx = actor.x - DRAW / 2;
    const ly = actor.y - DRAW - FLOAT + bob - hopY;

    const size = Math.max(8, Math.ceil(DRAW * k));
    const c = actor.holo;
    if (c.width !== size) { c.width = size; c.height = size; }
    const h = c.getContext('2d');
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.clearRect(0, 0, size, size);
    h.imageSmoothingEnabled = false;
    if (sp.flip && actor.facing < 0) {
      h.translate(size, 0);
      h.scale(-1, 1);
    }
    h.drawImage(sp.img, sp.sx, sp.sy, sp.s, sp.s, 0, 0, size, size);
    h.setTransform(1, 0, 0, 1, 0, 0);
    if (!ROOM_HOLO) {
      // 방 캐릭터는 홀로그램 효과 없이 원래 색 그대로 (장현님 11-25: 효과는 홀로그램 화면에만)
      const px = Math.round(v.dpr * v.ox + lx * k);
      const py = Math.round(v.dpr * v.oy + ly * k);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(c, px, py);
      g.restore();
      drawActorExtras(actor, g, ly, now);
      return;
    }
    // 홀로그램 색: 원래 색을 살리고 청록빛을 얹는다
    h.globalCompositeOperation = 'source-atop';
    h.globalAlpha = sleeping ? 0.45 : 0.26;
    h.fillStyle = HOLO;
    h.fillRect(0, 0, size, size);
    // 위에서 아래로 흐르는 밝은 띠
    const band = ((now / 1600 + actor.phase) % 1.4) * size;
    h.globalAlpha = 0.35;
    h.fillStyle = '#ffffff';
    h.fillRect(0, band - size * 0.08, size, size * 0.08);
    // 주사선
    h.globalCompositeOperation = 'destination-out';
    h.globalAlpha = 0.42;
    h.fillStyle = '#000';
    const step = Math.max(2, Math.round(v.dpr * 1.5));
    const scroll = Math.floor(now / 90) % step;
    for (let y = scroll; y < size; y += step) h.fillRect(0, y, size, 1);
    h.globalCompositeOperation = 'source-over';
    h.globalAlpha = 1;

    const fl = holoFlicker(actor, now);
    const dx = Math.round(v.dpr * v.ox + lx * k);
    const dy = Math.round(v.dpr * v.oy + ly * k);
    const alpha = fl.alpha * (sleeping ? 0.6 : 1);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    // 빛 번짐
    g.globalCompositeOperation = state.theme === 'night' ? 'lighter' : 'source-over';
    g.globalAlpha = alpha * (state.theme === 'night' ? 0.55 : 0.3);
    g.filter = `blur(${Math.max(2, Math.round(3 * v.dpr))}px)`;
    g.drawImage(c, dx, dy);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = alpha;
    if (fl.glitch) {
      // 가로로 썰린 듯 어긋남
      const cut = Math.floor(size * (0.3 + Math.random() * 0.4));
      const shift = Math.round((Math.random() * 6 - 3) * v.dpr);
      g.drawImage(c, 0, 0, size, cut, dx + shift, dy, size, cut);
      g.drawImage(c, 0, cut, size, size - cut, dx - shift, dy + cut, size, size - cut);
    } else {
      g.drawImage(c, dx, dy);
    }
    g.restore();
    drawActorExtras(actor, g, ly, now);
  }

  function drawActorExtras(actor, g, ly, now) {
    if (actor.def.id === state.selected) {
      g.save();
      g.strokeStyle = 'rgba(255, 122, 89, .9)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(actor.x, actor.y, 13, 4.2, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    if (actor.emote) {
      const t = (now - actor.emote.start) / (actor.emote.until - actor.emote.start);
      drawIcon(g, actor.emote.kind, actor.x + 10, ly - 4 - t * 6, t < 0.8 ? 1 : (1 - t) * 5);
    }
  }

  function drawParticles(dt) {
    const g = state.ctx;
    state.particles = state.particles.filter((p) => p.life > 0);
    for (const p of state.particles) {
      p.life -= dt * (p.kind === 'z' ? 0.5 : 1.4);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'z') {
        drawIcon(g, 'z', p.x, p.y, Math.max(0, p.life) * 0.8);
      } else {
        g.save();
        g.globalAlpha = Math.max(0, p.life) * 0.9;
        g.fillStyle = HOLO;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 2);
        g.restore();
      }
    }
  }

  function render(now, dt) {
    const g = state.ctx;
    const v = state.view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = state.theme === 'day' ? '#b98a5d' : '#0b0913';
    g.fillRect(0, 0, state.canvas.width, state.canvas.height);

    const k = v.dpr * v.scale;
    g.setTransform(k, 0, 0, k, v.dpr * v.ox, v.dpr * v.oy);
    g.imageSmoothingEnabled = false;

    const bg = roomImage();
    // 화면 비율이 16:9가 아니면 벽·바닥 끝줄을 늘려 빈칸을 메운다
    const extraY = Math.max(0, (v.h - LH * v.scale) / 2) / v.scale;
    const extraX = Math.max(0, (v.w - LW * v.scale) / 2) / v.scale;
    if (extraY > 0) {
      g.drawImage(bg, 0, 1, LW, 1, 0, -extraY - 1, LW, extraY + 1.5);
      g.drawImage(bg, 0, LH - 2, LW, 1, 0, LH, LW, extraY + 1.5);
    }
    if (extraX > 0) {
      g.drawImage(bg, 1, 0, 1, LH, -extraX - 1, 0, extraX + 1.5, LH);
      g.drawImage(bg, LW - 2, 0, 1, LH, LW, 0, extraX + 1.5, LH);
    }
    g.drawImage(bg, 0, 0, LW, LH);
    drawBedLamp(now);
    drawMonitors(now);

    const actors = Array.from(state.actors.values()).sort((a, b) => a.y - b.y);
    if (ROOM_HOLO) for (const actor of actors) drawProjector(actor, now);
    for (const actor of actors) drawHologram(actor, now);
    drawParticles(dt);
  }

  /* ------------------------------------------------------------ 말풍선 */
  function toScreen(x, y) {
    const v = state.view;
    return { x: v.ox + x * v.scale, y: v.oy + y * v.scale };
  }

  function updateBubbles() {
    for (const actor of state.actors.values()) {
      const el = state.bubbleEls.get(actor.def.id);
      if (!el) continue;
      const bs = state.botStates[actor.def.id] || {};
      const working = bs.state === 'working';
      const offline = bs.state === 'offline';
      const selected = state.selected === actor.def.id;
      let text = '';
      if (selected) {
        if (working) text = bs.note && bs.note.length < 18 ? bs.note : '작업 중…';
        else if (offline) text = '자고 있어…';
        else text = actor.def.name;
      }
      if (!text) {
        el.hidden = true;
        continue;
      }
      const p = toScreen(actor.x, actor.y - DRAW - FLOAT - 6);
      el.hidden = false;
      el.textContent = text;
      el.className = `bubble${working ? ' work' : ''}${offline ? ' off' : ''}`;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    }
  }

  /* ------------------------------------------------------------ 루프 */
  function loop(now) {
    const dt = Math.min(0.05, (now - state.lastT) / 1000);
    state.lastT = now;
    if (state.canvas && state.canvas.offsetParent !== null) {
      for (const actor of state.actors.values()) {
        stepActor(actor, dt, now);
        if (actor.hop > 0) actor.hop = Math.max(0, actor.hop - dt * 2.2);
        const fps = FPS[actor.anim] || 2;
        actor.frameT += dt;
        if (actor.frameT >= 1 / fps) {
          actor.frameT = 0;
          actor.frame = (actor.frame + 1) % 120;
        }
      }
      placeCamera(false, dt);
      render(now, dt);
      updateBubbles();
    }
    state.raf = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------ 입력 */
  function hitTest(clientX, clientY) {
    const rect = state.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - state.view.ox) / state.view.scale;
    const y = (clientY - rect.top - state.view.oy) / state.view.scale;
    let best = null;
    let bestD = 1e9;
    for (const actor of state.actors.values()) {
      const dx = Math.abs(actor.x - x);
      const dy = y - actor.y;
      if (dx < DRAW * 0.4 && dy > -(DRAW + FLOAT + 4) && dy < 6) {
        const d = Math.hypot(dx, dy + DRAW / 2);
        if (d < bestD) { bestD = d; best = actor; }
      }
    }
    return best;
  }

  function bindPointer() {
    state.canvas.addEventListener('pointerdown', (e) => {
      const actor = hitTest(e.clientX, e.clientY);
      if (actor && state.onSelect) {
        const rect = state.canvas.getBoundingClientRect();
        state.onSelect(actor.def.id, { x: e.clientX, y: e.clientY, canvas: rect });
      }
    });
    state.canvas.addEventListener('pointermove', (e) => {
      const actor = hitTest(e.clientX, e.clientY);
      state.canvas.style.cursor = actor ? 'pointer' : 'default';
    });
  }

  function anchorOf(id) {
    const actor = state.actors.get(id);
    if (!actor) return null;
    const rect = state.canvas.getBoundingClientRect();
    if (!rect.width) return null;
    const p = toScreen(actor.x, actor.y - DRAW - FLOAT);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  window.House = { init, setBots, setTheme, setSelected, anchorOf, stepRoom, botsIn, currentRoom, focusBot, focused };
})();
