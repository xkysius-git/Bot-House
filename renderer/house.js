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

  /* ------------------------------------------------------------ 방 그림 (3/4 탑뷰, 손으로 찍은 도트) */
  // 장현님 11-27 + 레퍼런스(Penzilla 레트로 실내, LimeZu Modern Interiors):
  // 뒷벽을 높게 두고 키 큰 가구(침대 머리판·소파 등받이·책장·서버 랙)는 벽 앞에 세워 앞면이 보이게.
  // 소품은 도형이 아니라 1px씩 손으로 찍은 도안(SPR)으로, 실루엣은 불규칙하게, 그늘은 색을 틀어서.
  // 캐릭터 자리(SPOTS·LIVING_BOX), 스탠드 빛(137,74), 모니터 화면(y 131~148) 좌표는 그대로.
  const TOP_WALL = 92;
  const DOOR = { y0: 198, y1: 254 };

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  // 밝게는 따뜻한 크림색 쪽으로, 어둡게는 보랏빛 쪽으로 (색을 틀어서 그늘)
  function shade(c, amt) {
    const [r, g, b] = hex(c);
    const t = amt > 0 ? [255, 244, 214] : [36, 18, 64];
    const k = Math.abs(amt);
    const m = (a, z) => Math.round(a + (z - a) * k).toString(16).padStart(2, '0');
    return `#${m(r, t[0])}${m(g, t[1])}${m(b, t[2])}`;
  }
  function mat(c) { return { out: shade(c, -0.66), hi: shade(c, 0.24), base: c, mid: shade(c, -0.13), dark: shade(c, -0.3) }; }
  function dot(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }

  // 손으로 찍은 도안: 글자 하나 = 1px. '.' 은 투명
  function sprite(g, x, y, rows, pal, flip) {
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i += 1) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (!c) continue;
        dot(g, x + (flip ? w - 1 - i : i), y + j, c);
      }
    });
  }

  function softShadow(g, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      const dx = (x + i + 0.5 - cx) / (w / 2), dy = (y + j + 0.5 - cy) / (h / 2);
      const d = dx * dx + dy * dy;
      if (d > 1 || (d > 0.55 && (i + j) % 2)) continue;
      g.fillStyle = 'rgba(30,8,50,.28)';
      g.fillRect(x + i, y + j, 1, 1);
    }
  }

  // 모양 마스크(함수)로 덩어리를 칠한다: 외곽선·위 빛·아래 그늘을 마스크 기준으로 자동
  function mass(g, x, y, w, h, inside, P, tex) {
    const ins = (i, j) => i >= 0 && j >= 0 && i < w && j < h && inside(i, j);
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      if (!ins(i, j)) continue;
      let c;
      if (!ins(i - 1, j) || !ins(i + 1, j) || !ins(i, j - 1) || !ins(i, j + 1)) c = P.out;
      else if (!ins(i, j - 2)) c = P.hi;
      else if (!ins(i, j + 2)) c = P.dark;
      else if (!ins(i - 2, j)) c = shade(P.base, 0.08);
      else if (!ins(i + 2, j)) c = P.mid;
      else c = P.base;
      if (tex && c !== P.out) c = tex(i, j, c) || c;
      dot(g, x + i, y + j, c);
    }
  }
  // 모서리가 살짝 둥글고 가장자리가 조금 울퉁불퉁한 사각 마스크 (천·쿠션·러그용)
  const softRect = (w, h, r, wob) => (i, j) => {
    const e = wob ? Math.round((hash(i * 3, j * 5) - 0.5) * wob) : 0;
    const dx = i < r ? r - i - 0.5 : i >= w - r ? i - (w - r) + 0.5 : 0;
    const dy = j < r ? r - j - 0.5 : j >= h - r ? j - (h - r) + 0.5 : 0;
    if (dx * dx + dy * dy > r * r) return false;
    if (wob && (i === 0 || i === w - 1 || j === h - 1) && e > 0) return false;
    return true;
  };

  /* ---------- 재질 색 (밤 / 낮) */
  const TC = {
    night: {
      wall: { bed: '#2e2a5c', living: '#40294d', work: '#203755' }, panel: '#4a3456', cap: '#1a1530',
      wood: '#5a3b5c', tile: '#283a55', grout: '#141d2e',
      frameWood: '#7a5068', sheet: '#4f60b0', sheet2: '#d8c070', pillow: '#c8cff4', sofa: '#8a4870', cushion: '#c06a8a',
      rug: '#4a3266', rugA: '#d6a858', rugB: '#5a86b0',
      desk: '#56476a', metal: '#4a4664', frame: '#5e5290',
      leaf: '#3f9468', leaf2: '#2f6e86', pot: '#9a5e44', pot2: '#5d5a8c',
      sky: '#101a3c', sky2: '#1c2a5c', star: '#fff6d0',
      shadeLamp: '#ffd98a', paper: '#d6dcf4', mug: '#d06a4b', tea: '#e8e0f0', led: '#7ff6ff', mon: '#0c0a16',
      curtain: '#7a3a60',
      book: ['#8a5ad8', '#d6704f', '#4fb6d6', '#d6b64f', '#5ac08a', '#c85a8a']
    },
    day: {
      wall: { bed: '#dde5f6', living: '#f4e2cb', work: '#d8eee8' }, panel: '#c89a70', cap: '#8a6c58',
      wood: '#c99a6b', tile: '#e4ebe8', grout: '#b9c4bf',
      frameWood: '#a8744c', sheet: '#7a92e6', sheet2: '#f0d070', pillow: '#ffffff', sofa: '#e07a5f', cushion: '#f4b070',
      rug: '#e8c48a', rugA: '#b8583c', rugB: '#4f86b8',
      desk: '#c49a74', metal: '#9a98b0', frame: '#ffffff',
      leaf: '#4fae6a', leaf2: '#3f9a9a', pot: '#c07a50', pot2: '#8a86c0',
      sky: '#8fcffc', sky2: '#c6e8ff', star: '#fff2a0',
      shadeLamp: '#fff1c2', paper: '#ffffff', mug: '#e0664b', tea: '#ffffff', led: '#3fa0c8', mon: '#1d1a28',
      curtain: '#d98a6c',
      book: ['#7a4bd0', '#e0664b', '#3fa0c8', '#e0b23f', '#4fae6a', '#d0508a']
    }
  };

  /* ---------- 손으로 찍은 소품 도안 */
  // o 외곽선, L 밝은 잎, l 잎, d 짙은 잎, P 화분 빛, p 화분, q 화분 그늘
  const SPR = {
    bush: [
      '.....oo...oo.......',
      '....oLlo.oLlo..oo..',
      '..ooLlllooLllooLlo.',
      '.oLLlllddolllolldo.',
      'oLllldddoLLlllddo..',
      'oLlldddoLllllldddo.',
      '.oddddoLllldddddo..',
      '.ooodoLlllddoooLlo.',
      'oLLlloLlddddoLLllo.',
      'oLllldoddddoLlllddo',
      '.olldddooooLlllddo.',
      '..oddo..oLlllddo...',
      '...oo..oLllddoo....',
      '.......oddddo......',
      '....oooooooooo.....',
      '....oPPPPPPPPo.....',
      '....opppppppqo.....',
      '.....oppppppqo.....',
      '.....oppppppqo.....',
      '......oqqqqqo......',
      '.......ooooo.......'
    ],
    tall: [
      '......oo.........',
      '.....oLlo...oo...',
      '..oo.oLldo.oLlo..',
      '.oLlooLldooLlldo.',
      '.oLlldoLdoLllddo.',
      '..oddooLdoLddoo..',
      '...oo.oLdoddo....',
      '.oo...oLdoo..oo..',
      'oLloo.oLdo.ooLlo.',
      'oLlldooLdooLllddo',
      '.oddddoLdoLlddoo.',
      '..oooo.oLdoddo...',
      '.......oLdooo....',
      '....ooooooooooo..',
      '....oPPPPPPPPPo..',
      '....oppppppppqo..',
      '.....opppppppqo..',
      '.....oppppppqqo..',
      '......oqqqqqqo...',
      '.......oooooo....'
    ],
    cactus: [
      '....oo....',
      '...oLlo...',
      '.o.oLlo.o.',
      'oLooLlooLo',
      'oLloLloLlo',
      '.oddLllddo',
      '...oLldo..',
      '...oLldo..',
      '.oooooooo.',
      '.oPPPPPPo.',
      '.oppppppo.',
      '..oppppo..',
      '..oooooo..'
    ],
    // Y 갓 빛, y 갓, b 받침, B 받침 빛
    tableLamp: [
      '...oooo...',
      '..oYYYYo..',
      '.oYYyyyyo.',
      '.oYyyyyyo.',
      'oYyyyyyyyo',
      'oooooooooo',
      '....ob....',
      '....ob....',
      '...oBbbo..',
      '..oBbbbbo.',
      '..oooooo..'
    ],
    floorLamp: [
      '..oooooo..',
      '.oYYYYYYo.',
      'oYYyyyyyyo',
      'oYyyyyyyyo',
      'oooooooooo',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '....ob....',
      '...oBbo...',
      '.ooBbbboo.',
      '.oooooooo.'
    ],
    // F 테 빛, f 테, w 판, k 바늘
    clock: [
      '....oooooo....',
      '..ooFFFFFFoo..',
      '.oFFwwwwwwffo.',
      '.oFwwwwkwwwfo.',
      'oFwwwwwkwwwwfo',
      'oFwkwwwkwwwkfo',
      'oFwwwwwkkkwwfo',
      'oFwwwwwwwwwwfo',
      'oFwkwwwwwwwkfo',
      'oFwwwwwwwwwwfo',
      '.ofwwwwkwwwfo.',
      '.offwwwwwwffo.',
      '..oofffffoo...',
      '....oooooo....'
    ],
    // T 주전자 빛, t 주전자, s 그늘
    teapot: [
      '....oo.....',
      '...oTTo....',
      '.ooTTTToo..',
      'oTTTttttto.',
      'oTttttttsoo',
      'oTttttttsoTo',
      '.otttttsso.',
      '..ossssso..',
      '...ooooo...'
    ],
    mug: [
      '.ooooo..',
      'oMMMMMo.',
      'oMmmmmooo',
      'oMmmmmo.o',
      'oMmmmmooo',
      '.ommmo..',
      '..ooo...'
    ],
    // 벽등: 갓 + 벽 받침
    sconce: [
      '...ooooo...',
      '..oYYYYYo..',
      '.oYYyyyyyo.',
      'oYyyyyyyyyo',
      'ooooooooooo',
      '....obbo...',
      '....oBBo...',
      '....oooo...'
    ],
    slippers: [
      '.ooo..ooo.',
      'oSSso oSSso',
      'oSsso oSsso',
      'oSsso oSsso',
      '.ooo...ooo.'
    ]
  };

  function leafPal(C, which) {
    const L = mat(which === 2 ? C.leaf2 : C.leaf);
    const P = mat(which === 2 ? C.pot2 : C.pot);
    return { o: L.out, L: L.hi, l: L.base, d: L.dark, P: P.hi, p: P.base, q: P.dark };
  }
  function lampPal(C, base) {
    const Y = mat(C.shadeLamp);
    const B = mat(base);
    return { o: shade(C.shadeLamp, -0.62), Y: '#ffffff', y: C.shadeLamp, b: B.base, B: B.hi };
  }

  /* ---------- 바닥 */
  function woodFloor(g, C, x0, y0, w, h) {
    const P = mat(C.wood);
    for (let j = 0; j < h; j += 1) {
      const row = Math.floor(j / 8);
      const jy = j % 8;
      const off = Math.floor(hash(row, 7) * 48);
      for (let i = 0; i < w; i += 1) {
        const seg = Math.floor((i + off) / 52);
        const ix = (i + off) % 52;
        let c = shade(P.base, (hash(seg, row) - 0.5) * 0.14);
        if (jy === 7) c = P.out;
        else if (ix === 0) c = P.dark;
        else if (jy === 0) c = shade(c, 0.1);
        else {
          const gy = Math.round(3.2 + Math.sin((i + seg * 13) / 6.5) * 1.6);
          if (jy === gy && hash(i, row) > 0.35) c = shade(c, -0.15);
        }
        const ao = Math.max(0, 9 - j) / 9 * 0.4 + Math.max(0, 4 - i) / 4 * 0.2 + Math.max(0, 4 - (w - 1 - i)) / 4 * 0.2;
        if (ao > 0) c = shade(c, -ao);
        dot(g, x0 + i, y0 + j, c);
      }
    }
  }

  function tileFloor(g, C, x0, y0, w, h) {
    const P = mat(C.tile);
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      const ti = i % 16, tj = j % 16;
      let c = (Math.floor(i / 16) + Math.floor(j / 16)) % 2 ? P.base : shade(P.base, -0.06);
      if (ti === 0 || tj === 0) c = C.grout;
      else if (ti === 1 || tj === 1) c = shade(c, 0.12);
      else if (ti === 15 || tj === 15) c = shade(c, -0.12);
      else if (hash(i, j) > 0.93) c = shade(c, -0.05);
      const ao = Math.max(0, 9 - j) / 9 * 0.4;
      if (ao > 0) c = shade(c, -ao);
      dot(g, x0 + i, y0 + j, c);
    }
  }

  /* ---------- 높은 뒷벽: 벽지 + 징두리 판벽 + 걸레받이 */
  function backWall(g, C, room, x0) {
    const P = mat(C.wall[room]);
    const W = mat(C.panel);
    const panelTop = TOP_WALL - 30;
    for (let j = 0; j < TOP_WALL; j += 1) for (let i = 0; i < ROOM_W; i += 1) {
      let c;
      if (j < 4) c = C.cap;
      else if (j === 4) c = shade(C.cap, -0.5);
      else if (j < panelTop) {
        c = (i % 14 === 0) ? P.mid : P.base;
        const mi = (i + (Math.floor(j / 12) % 2) * 7) % 14, mj = j % 12;
        if ((mi === 7 && (mj === 5 || mj === 7)) || (mj === 6 && (mi === 6 || mi === 8))) c = P.hi;
        if (j < 8) c = shade(c, -0.15);
      } else if (j === panelTop) c = W.hi;
      else if (j === panelTop + 1) c = W.out;
      else if (j < TOP_WALL - 5) {
        const pi = i % 12;
        c = pi === 0 ? W.dark : pi === 1 ? W.hi : W.base;
        if (j === panelTop + 2) c = W.dark;
        if (hash(i, j) > 0.92 && pi > 2) c = W.mid;
      } else c = j === TOP_WALL - 5 ? shade(C.cap, 0.3) : j === TOP_WALL - 1 ? shade(C.cap, -0.5) : C.cap;
      dot(g, x0 + i, j, c);
    }
  }

  function windowWall(g, C, x, y, w, h, theme) {
    const F = mat(C.frame);
    mass(g, x - 3, y - 3, w + 6, h + 6, softRect(w + 6, h + 6, 2, 0), F);
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
      const k = j / h;
      let c = k < 0.55 ? C.sky : C.sky2;
      if (k >= 0.5 && k < 0.6 && (i + j) % 2) c = C.sky2;
      if ((i + j) % 13 === 0 && i - j > 2) c = shade(c, 0.16);
      dot(g, x + i, y + j, c);
    }
    if (theme === 'night') {
      [[w - 9, 4], [w - 8, 4], [w - 7, 5], [w - 7, 6], [w - 7, 7], [w - 8, 8], [w - 9, 8], [w - 10, 7]].forEach(([a, b]) => dot(g, x + a, y + b, C.star));
      [[3, 5], [9, 11], [15, 3], [6, 16], [20, 8]].forEach(([a, b]) => { if (a < w - 12) dot(g, x + a, y + b, '#ffffff'); });
    } else {
      [[w - 9, 4], [w - 8, 4], [w - 10, 5], [w - 7, 5], [w - 10, 6], [w - 7, 6], [w - 9, 7], [w - 8, 7]].forEach(([a, b]) => dot(g, x + a, y + b, C.star));
      for (let i = 0; i < 9; i += 1) { dot(g, x + 3 + i, y + h - 8, '#ffffff'); if (i > 1 && i < 7) dot(g, x + 3 + i, y + h - 9, '#ffffff'); }
    }
    for (let j = 0; j < h; j += 1) { dot(g, x + Math.floor(w / 2) - 1, y + j, F.base); dot(g, x + Math.floor(w / 2), y + j, F.mid); }
    mass(g, x - 6, y + h + 1, w + 12, 5, softRect(w + 12, 5, 1, 0), F);
  }

  // 커튼: 세로 주름 + 아래가 살짝 퍼지고 끝이 물결
  function curtain(g, C, x, y, w, h, flip) {
    const P = mat(C.curtain);
    for (let j = 0; j < h; j += 1) {
      const spread = Math.floor(j / h * 3);
      for (let i = -spread; i < w; i += 1) {
        const ii = flip ? w - 1 - i : i;
        if (j === h - 1 && (i + spread) % 3 === 0) continue;
        const s = Math.sin((i + spread + 1) * 1.5);
        let c = s > 0.55 ? P.hi : s > -0.15 ? P.base : s > -0.7 ? P.mid : P.dark;
        if (i === -spread || i === w - 1 || j === h - 1) c = P.out;
        dot(g, x + ii, y + j, c);
      }
    }
  }

  function picture(g, C, x, y, w, h) {
    const F = mat(C.frameWood);
    mass(g, x, y, w, h, softRect(w, h, 1, 0), F);
    for (let j = 0; j < h - 6; j += 1) for (let i = 0; i < w - 6; i += 1) {
      const hill = Math.floor((h - 6) * 0.55) + Math.round(Math.sin(i / 3.5) * 2);
      dot(g, x + 3 + i, y + 3 + j, j > hill ? (j > hill + 2 ? shade(C.leaf, -0.25) : C.leaf) : (j < 3 ? C.sky : C.sky2));
    }
  }

  function stripedRug(g, C, x, y, w, h) {
    const R = mat(C.rug);
    mass(g, x, y, w, h, softRect(w, h, 3, 2), R, (i, j, c) => {
      const b = Math.min(i, j, w - 1 - i, h - 1 - j);
      if (b === 3) return R.dark;
      if (b > 4) {
        const band = Math.floor((j - 5) / 6) % 4;
        if (band === 1) return (i + j) % 2 ? C.rugA : shade(C.rugA, -0.1);
        if (band === 3) return C.rugB;
        if ((j - 5) % 6 === 0) return R.mid;
      }
      if (hash(i, j) > 0.9) return R.mid;
      return null;
    });
    const F = shade(C.rug, 0.15);
    for (let i = 3; i < w - 3; i += 2) { dot(g, x + i, y - 1, F); dot(g, x + i, y + h, F); if (hash(i, 9) > 0.5) dot(g, x + i, y + h + 1, F); }
  }

  /* ---------- 침실 */
  function drawBedroom3(g, C, theme) {
    const x0 = ROOM_X.bed;
    woodFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'bed', x0);
    windowWall(g, C, x0 + 16, 14, 34, 28, theme);
    curtain(g, C, x0 + 9, 10, 7, 40, false);
    curtain(g, C, x0 + 50, 10, 7, 40, true);
    sprite(g, x0 + 92, 14, SPR.clock, (() => { const F = mat(C.frameWood); return { o: F.out, F: F.hi, f: F.base, w: theme === 'night' ? '#cfc8ea' : '#ffffff', k: F.out }; })());
    // 벽등 (스탠드 빛 중심 137,74)
    sprite(g, x0 + 132, 40, SPR.sconce, lampPal(C, C.frameWood));
    // 침대: 벽 앞에 세운 머리판(앞면) → 매트리스 → 베개 → 구겨진 이불 → 발판
    const bx = x0 + 6, bw = 148;
    const Fw = mat(C.frameWood);
    mass(g, bx, 62, bw, 40, (i, j) => {
      const arch = 6 - Math.round(Math.sin(i / bw * Math.PI) * 6);   // 위가 둥근 아치
      return j >= arch;
    }, Fw, (i, j, c) => {
      const arch = 6 - Math.round(Math.sin(i / bw * Math.PI) * 6);
      if (j - arch < 4) return j - arch === 1 ? '#ffffff' && Fw.hi : Fw.hi;           // 위 난간
      if (j - arch === 4) return Fw.dark;
      const pi = (i - 4) % 37;
      if (j > 12 && j < 34 && pi > 3 && pi < 33) {                                         // 안쪽 판
        if (j === 13 || pi === 4) return Fw.dark;
        if (j === 33 || pi === 32) return Fw.hi;
        return shade(Fw.base, -0.06);
      }
      return null;
    });
    // 매트리스 윗면
    mass(g, bx + 2, 98, bw - 4, 100, softRect(bw - 4, 100, 3, 0), mat(shade(C.pillow, -0.1)));
    // 베개 4개: 가운데가 눌린 불규칙 모양
    [14, 49, 85, 119].forEach((p, n) => {
      const pw = 27, ph = 15;
      mass(g, x0 + p, 101 + (n % 2), pw, ph, (i, j) => {
        const nx = (i - pw / 2) / (pw / 2), ny = (j - ph / 2) / (ph / 2);
        const pinch = 1 - 0.18 * Math.cos(nx * Math.PI);
        return nx * nx * nx * nx + (ny / pinch) * (ny / pinch) <= 1.0;
      }, mat(C.pillow), (i, j, c) => (j === 7 && i > 6 && i < 20 && hash(i, n) > 0.3 ? shade(c, -0.12) : null));
    });
    // 이불: 위 끝이 접혀 물결, 몸 굴곡처럼 불룩한 주름, 가장자리는 늘어짐
    const S = mat(C.sheet);
    const topY = (i) => 124 + Math.round(Math.sin(i / 11) * 2 + Math.sin(i / 4.3) * 0.8);
    for (let i = 0; i < bw; i += 1) {
      const t = topY(i);
      const bottom = 207 + Math.round(Math.sin(i / 7) * 1.5);
      for (let yy = t; yy <= bottom; yy += 1) {
        const j = yy - t;
        let c;
        if (i === 0 || i === bw - 1 || yy === t || yy === bottom) c = S.out;
        else if (j < 6) c = j === 5 ? S.dark : j === 1 ? '#ffffff' : (theme === 'night' ? shade(C.sheet2, -0.2) : C.sheet2);   // 접힌 윗단 (다른 색 안감)
        else if (yy > 196) c = (i % 11 < 3) ? S.dark : S.mid;      // 앞으로 늘어진 자락
        else {
          // 사람 4명 누운 자리의 불룩함 + 그 사이 골
          let L = 0, dLy = 0;
          for (let k = 0; k < 4; k += 1) {
            const cx = 22 + k * 35, cy = 160;
            const e = Math.exp(-((i - cx) * (i - cx)) / 130 - ((yy - cy) * (yy - cy)) / 380);
            L += e; dLy += e * (-(yy - cy) / 190);
          }
          c = S.base;
          if (dLy > 0.06) c = S.hi;                    // 불룩한 위쪽 = 빛
          else if (L > 0.55) c = shade(S.base, 0.08);
          else if (dLy < -0.05) c = dLy < -0.12 ? S.dark : S.mid;   // 아래쪽 = 그늘
          if (L < 0.12 && Math.abs(Math.sin(i / 5 + yy / 17)) < 0.18) c = S.dark;   // 사이 골 주름
          if (i < 4 || i > bw - 5) c = S.dark;          // 양옆으로 넘어가는 자락
          if (hash(i, yy) > 0.94) c = shade(c, -0.08);
        }
        dot(g, bx + i, yy, c);
      }
    }
    softShadow(g, bx + 4, 205, bw - 4, 8);
    // 러그 + 슬리퍼 + 화분 + 책 더미
    stripedRug(g, C, x0 + 34, 218, 92, 30);
    const Sl = mat(C.cushion);
    sprite(g, x0 + 52, 228, SPR.slippers, { o: Sl.out, S: Sl.hi, s: Sl.base });
    sprite(g, x0 + 4, 222, SPR.bush, leafPal(C, 1));
    sprite(g, x0 + 134, 236, SPR.cactus, leafPal(C, 2));
  }

  /* ---------- 거실 */
  function drawLiving3(g, C, theme) {
    const x0 = ROOM_X.living;
    woodFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'living', x0);
    windowWall(g, C, x0 + 62, 12, 36, 28, theme);
    curtain(g, C, x0 + 54, 8, 8, 44, false);
    curtain(g, C, x0 + 98, 8, 8, 44, true);
    picture(g, C, x0 + 14, 16, 26, 20);
    picture(g, C, x0 + 116, 20, 18, 14);
    // 소파: 벽 앞에 세운 등받이(앞면) + 방석 3개(윗면) + 둥근 팔걸이 + 앞면 + 처진 쿠션
    const So = mat(C.sofa);
    const sx = x0 + 16, sw = 128;
    softShadow(g, sx - 2, 128, sw + 4, 8);
    mass(g, sx + 6, 70, sw - 12, 34, (i, j) => j >= 3 - Math.round(Math.sin(i / (sw - 12) * Math.PI) * 3), So,
      (i, j, c) => (j === 16 ? So.mid : (i % 38 === 19 && j > 6 && j < 26) ? So.dark : null));   // 등받이 누빔
    [0, 1, 2].forEach((k) => mass(g, sx + 9 + k * 37, 98, 37, 22, softRect(37, 22, 5, 0), So,
      (i, j, c) => (j === 16 ? So.mid : (Math.abs(i - 18) + Math.abs(j - 8) === 1 ? So.dark : null))));
    mass(g, sx + 8, 118, sw - 16, 9, softRect(sw - 16, 9, 2, 0), mat(shade(C.sofa, -0.2)));
    mass(g, sx - 2, 86, 14, 42, softRect(14, 42, 6, 0), So);
    mass(g, sx + sw - 12, 86, 14, 42, softRect(14, 42, 6, 0), So);
    const Cu = mat(C.cushion);
    mass(g, sx + 14, 86, 17, 16, (i, j) => { const nx = (i - 8) / 8.5, ny = (j - 8) / 8; return Math.abs(nx) ** 3 + Math.abs(ny) ** 3 <= 1; }, Cu,
      (i, j, c) => (i === j || i === j + 1 ? shade(c, -0.12) : null));
    mass(g, sx + sw - 32, 87, 16, 15, (i, j) => { const nx = (i - 8) / 8, ny = (j - 7.5) / 7.5; return Math.abs(nx) ** 3 + Math.abs(ny) ** 3 <= 1; }, mat(C.pillow));
    // 옆 탁자 + 스탠드
    const T = mat(C.frameWood);
    mass(g, x0 + 142, 104, 15, 18, softRect(15, 18, 2, 0), T, (i, j) => (j === 6 ? T.out : j === 7 ? T.dark : null));
    sprite(g, x0 + 145, 92, SPR.tableLamp, lampPal(C, C.frameWood));
    // 줄무늬 러그 + 커피 테이블 + 찻주전자·머그·책
    stripedRug(g, C, x0 + 16, 140, 128, 104);
    softShadow(g, x0 + 48, 178, 64, 6);
    mass(g, x0 + 46, 150, 68, 26, softRect(68, 26, 4, 0), T, (i, j, c) => {
      if (j >= 20) return j === 20 ? T.out : T.dark;              // 앞면
      const gy = Math.round(9 + Math.sin(i / 6) * 3);
      return j === gy || j === gy + 6 ? shade(c, -0.1) : null;
    });
    const Tp = mat(C.tea);
    sprite(g, x0 + 54, 150, SPR.teapot, { o: Tp.out, T: '#ffffff', t: C.tea, s: Tp.dark });
    const M = mat(C.mug);
    sprite(g, x0 + 70, 157, SPR.mug, { o: M.out, M: M.hi, m: M.base });
    const B = mat(C.book[2]);
    mass(g, x0 + 88, 154, 16, 11, softRect(16, 11, 1, 0), B, (i, j) => (j === 2 && i > 1 && i < 14 ? C.paper : null));
    mass(g, x0 + 90, 151, 13, 6, softRect(13, 6, 1, 0), mat(C.book[0]));
    // 큰 화분 + 플로어 스탠드
    sprite(g, x0 + 2, 214, SPR.tall, leafPal(C, 1));
    sprite(g, x0 + 140, 222, SPR.floorLamp, lampPal(C, C.frameWood));
  }

  /* ---------- 작업실 */
  function drawWork3(g, C, theme) {
    const x0 = ROOM_X.work;
    tileFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'work', x0);
    // 벽 앞에 세운 책장: 앞면이 다 보이게, 칸마다 책 높이·색이 다르고 기울어진 책·작은 화분
    const W = mat(C.frameWood);
    softShadow(g, x0 + 8, 96, 66, 6);
    mass(g, x0 + 8, 14, 64, 86, softRect(64, 86, 2, 0), W);
    [18, 38, 58, 78].forEach((sy, row) => {
      for (let j = 0; j < 16; j += 1) for (let i = 0; i < 56; i += 1) dot(g, x0 + 12 + i, sy + j, shade(C.frameWood, -0.5 - (j < 3 ? 0.1 : 0)));
      let bx = x0 + 13;
      let n = 0;
      while (bx < x0 + 64) {
        if (row === 2 && n === 3) {                                   // 작은 선인장
          sprite(g, bx, sy + 3, SPR.cactus, leafPal(C, 1));
          bx += 11; n += 1; continue;
        }
        const bw = 3 + Math.floor(hash(n, row) * 3);
        const bh = 9 + Math.floor(hash(row, n) * 5);
        if (bx + bw > x0 + 67) break;
        const Bk = mat(C.book[(n * 2 + row) % C.book.length]);
        const lean = row === 1 && n === 4;
        for (let j = 0; j < bh; j += 1) for (let i = 0; i < bw; i += 1) {
          let c = i === 0 || i === bw - 1 || j === 0 ? Bk.out : i === 1 ? Bk.hi : Bk.base;
          if ((j === 3 || j === bh - 3) && i > 0 && i < bw - 1) c = Bk.hi;
          dot(g, bx + i + (lean ? Math.floor((bh - j) / 4) : 0), sy + 16 - bh + j, c);
        }
        bx += bw + (lean ? 3 : 0);
        n += 1;
      }
      mass(g, x0 + 9, sy + 15, 62, 4, softRect(62, 4, 1, 0), W);
    });
    // 포스터
    const F = mat(C.frame);
    mass(g, x0 + 96, 14, 42, 32, softRect(42, 32, 1, 0), F);
    for (let j = 0; j < 24; j += 1) for (let i = 0; i < 34; i += 1) dot(g, x0 + 100 + i, 18 + j, theme === 'night' ? '#120f24' : '#2b2440');
    for (let i = 0; i < 22; i += 1) { dot(g, x0 + 106 + i, 24, HOLO); dot(g, x0 + 106 + i, 25, shade('#7ff6ff', -0.35)); }
    for (let i = 0; i < 16; i += 1) dot(g, x0 + 109 + i, 31, '#ff7a59');
    for (let i = 0; i < 10; i += 1) dot(g, x0 + 112 + i, 36, '#b15ce8');
    // 서버 랙 (벽 앞, 앞면에 LED)
    const Mt = mat(C.metal);
    softShadow(g, x0 + 132, 110, 24, 5);
    mass(g, x0 + 132, 52, 24, 60, softRect(24, 60, 2, 0), Mt);
    for (let y = 58; y < 106; y += 7) {
      mass(g, x0 + 134, y, 20, 6, softRect(20, 6, 1, 0), mat(shade(C.metal, 0.12)));
      dot(g, x0 + 137, y + 3, C.led); dot(g, x0 + 140, y + 3, hash(y, 3) > 0.5 ? '#ff7a59' : C.led);
      for (let k = 144; k < 152; k += 2) dot(g, x0 + k, y + 3, Mt.dark);
    }
    sprite(g, x0 + 112, 98, SPR.bush, leafPal(C, 2));
    // 긴 책상 (앞면 + 다리) + 모니터 4대 (drawMonitors 가 켜는 화면 자리 그대로)
    const D = mat(C.desk);
    softShadow(g, x0 + 8, 172, 144, 6);
    mass(g, x0 + 8, 124, 144, 42, softRect(144, 42, 3, 0), D, (i, j, c) => {
      if (j >= 32) return j === 32 ? D.out : (i % 48 === 24 ? D.out : D.dark);   // 앞면 + 서랍 칸
      return hash(i, j) > 0.95 ? shade(c, 0.05) : null;
    });
    SPOTS.work.forEach((s, n) => {
      const mx = s.x - 13;
      mass(g, mx - 2, 128, 30, 23, softRect(30, 23, 3, 0), mat(shade(C.metal, -0.22)));
      for (let j = 0; j < 17; j += 1) for (let i = 0; i < 24; i += 1) {
        let c = C.mon;
        if (i - j === 3 || i - j === 4) c = shade(C.mon, 0.12);
        dot(g, mx + 1 + i, 131 + j, c);
      }
      mass(g, mx + 9, 150, 10, 3, softRect(10, 3, 1, 0), mat(shade(C.metal, -0.1)));
      mass(g, mx + 1, 152, 21, 5, softRect(21, 5, 1, 0), mat(C.metal), (i, j, c) => (j === 2 && i % 2 === 1 ? shade(c, -0.2) : null));
      if (n === 1) { const Mg = mat(C.mug); sprite(g, mx + 24, 146, SPR.mug, { o: Mg.out, M: Mg.hi, m: Mg.base }); }
    });
    // 바닥 케이블 · 러그 · 종이 더미
    for (let i = 0; i < 118; i += 1) dot(g, x0 + 22 + i, 180 + Math.round(Math.sin(i / 8) * 2), shade(C.metal, -0.4));
    stripedRug(g, C, x0 + 20, 196, 120, 40);
    mass(g, x0 + 124, 240, 15, 10, softRect(15, 10, 1, 1), mat(C.paper), (i, j, c) => (j % 3 === 1 && i > 2 && i < 11 ? shade(c, -0.25) : null));
    mass(g, x0 + 126, 237, 13, 6, softRect(13, 6, 1, 1), mat(C.paper));
  }

  // 방 사이 벽(위에서 본 윗면) + 나무 문턱, 바깥 벽
  function walls3(g, C) {
    const P = mat(C.cap);
    const cap = (x, y, w, h) => mass(g, x, y, w, h, softRect(w, h, 2, 0), P, (i, j) => (hash(i, j + y) > 0.9 ? P.mid : null));
    [ROOM_W, ROOM_W * 2].forEach((x) => {
      cap(x - 4, 0, 8, DOOR.y0 + 2);
      cap(x - 4, DOOR.y1 - 2, 8, LH - DOOR.y1 + 2);
      const T = mat(C.frameWood);
      mass(g, x - 3, DOOR.y0 + 2, 6, DOOR.y1 - DOOR.y0 - 4, softRect(6, DOOR.y1 - DOOR.y0 - 4, 1, 0), T, (i, j) => (j % 8 === 7 ? T.dark : null));
    });
    for (let j = 0; j < LH; j += 1) for (let i = 0; i < 4; i += 1) { dot(g, i, j, i === 3 ? P.out : P.base); dot(g, LW - 1 - i, j, i === 3 ? P.out : P.base); }
    for (let j = 0; j < 6; j += 1) for (let i = 0; i < LW; i += 1) dot(g, i, LH - 6 + j, j === 0 ? P.out : j === 1 ? P.hi : P.base);
  }

  function buildRoom(theme) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d');
    const C = TC[theme];
    drawBedroom3(g, C, theme);
    drawLiving3(g, C, theme);
    drawWork3(g, C, theme);
    walls3(g, C);
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
    const grad = g.createRadialGradient(137, 46, 2, 137, 46, 46);
    grad.addColorStop(0, 'rgba(255, 210, 130, .28)');
    grad.addColorStop(1, 'rgba(255, 210, 130, 0)');
    g.fillStyle = grad;
    g.fillRect(90, 0, 94, 94);
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

  window.House = { init, setBots, setTheme, setSelected, anchorOf, stepRoom, botsIn, currentRoom, focusBot, focused, roomCanvas: buildRoom };
})();
