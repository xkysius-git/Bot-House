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

  /* ------------------------------------------------------------ 방 그림 (탑뷰, 1px 붓) */
  // 장현님 11-27: 네모로 찍지 말고 1px을 붓처럼. 모든 물건을 픽셀 단위로 그린다:
  // 둥근 모서리, 외곽선은 재질의 진한 색, 위·왼쪽 하이라이트, 아래·오른쪽 그늘, 질감(나뭇결·주름·잔무늬), 부드러운 그림자.
  // 캐릭터 자리(SPOTS·LIVING_BOX), 스탠드 빛(137,74), 모니터 화면(y 131~148) 좌표는 그대로.
  const TOP_WALL = 56;
  const DOOR = { y0: 198, y1: 254 };

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  // amt > 0 밝게, < 0 어둡게 (어두울 때는 살짝 보랏빛 쪽으로)
  function shade(c, amt) {
    const [r, g, b] = hex(c);
    const t = amt > 0 ? [255, 250, 235] : [20, 10, 40];
    const k = Math.abs(amt);
    const m = (a, z) => Math.round(a + (z - a) * k).toString(16).padStart(2, '0');
    return `#${m(r, t[0])}${m(g, t[1])}${m(b, t[2])}`;
  }
  // 재질 한 가지 → 외곽선·하이라이트·바탕·중간·그늘 5단
  function mat(c) {
    return { out: shade(c, -0.62), hi: shade(c, 0.22), base: c, mid: shade(c, -0.12), dark: shade(c, -0.28) };
  }

  function dot(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }

  function inRound(i, j, w, h, r) {
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    if (r <= 0) return true;
    const dx = i < r ? r - i - 0.5 : i >= w - r ? i - (w - r) + 0.5 : 0;
    const dy = j < r ? r - j - 0.5 : j >= h - r ? j - (h - r) + 0.5 : 0;
    return dx * dx + dy * dy <= r * r;
  }

  // 둥근 덩어리 하나를 1px씩: 외곽선 → 위·왼쪽 빛 → 아래·오른쪽 그늘 → 바탕(+질감)
  function blob(g, x, y, w, h, r, P, tex) {
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        if (!inRound(i, j, w, h, r)) continue;
        const ins = (a, b) => inRound(a, b, w, h, r);
        let c;
        if (P.out && (!ins(i - 1, j) || !ins(i + 1, j) || !ins(i, j - 1) || !ins(i, j + 1))) c = P.out;
        else if (!ins(i, j - 2) || !ins(i - 2, j)) c = P.hi;
        else if (!ins(i, j + 2) || !ins(i, j + 3)) c = P.dark;
        else if (!ins(i + 2, j)) c = P.mid;
        else c = P.base;
        if (tex && (c === P.base || c === P.mid)) c = tex(i, j, c) || c;
        dot(g, x + i, y + j, c);
      }
    }
  }

  // 물건 = 앞면(높이) 위에 윗면. 아래엔 부드러운 그림자
  function solid(g, x, y, w, d, h, r, Ptop, Pfront, tex) {
    softShadow(g, x + 1, y + d + h - 2, w, 6);
    if (h > 0) blob(g, x, y + d - r - 1, w, h + r + 1, r, Pfront);
    blob(g, x, y, w, d, r, Ptop, tex);
  }

  function softShadow(g, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const dx = (x + i + 0.5 - cx) / (w / 2), dy = (y + j + 0.5 - cy) / (h / 2);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        if (d > 0.6 && (i + j) % 2) continue; // 가장자리는 체크무늬로 흐리게
        g.fillStyle = 'rgba(8,4,20,.28)';
        g.fillRect(x + i, y + j, 1, 1);
      }
    }
  }

  function circle(g, cx, cy, rad, P) { blob(g, cx - rad, cy - rad, rad * 2, rad * 2, rad, P); }

  /* ---------- 재질 색 */
  const TC = {
    night: {
      wall: { bed: '#2b2756', living: '#3c2a4a', work: '#1f3450' }, cap: '#1a1530',
      wood: '#56395c', tile: '#263751', grout: '#141d2e',
      bedFrame: '#6e4b60', sheet: '#4b5ba6', pillow: '#c0c8f0', sofa: '#7e4669', cushion: '#a05c7e',
      rug: '#46315f', rugAccent: '#d0a860', rug2: '#2f4a6a',
      table: '#6a4b52', desk: '#4c415e', metal: '#43405a', frame: '#5a4e84',
      leaf: '#3a8a63', pot: '#8a5a46', sky: '#101a3c', sky2: '#1b2756', star: '#fff6d0',
      shade: '#ffd98a', paper: '#d6dcf4', mug: '#d06a4b', led: '#7ff6ff', mon: '#0c0a16', curtain: '#6a3456',
      book: ['#8a5ad8', '#d6704f', '#4fb6d6', '#d6b64f', '#5ac08a', '#c85a8a']
    },
    day: {
      wall: { bed: '#dde5f6', living: '#f4e2cb', work: '#d8eee8' }, cap: '#8a6c58',
      wood: '#c99a6b', tile: '#e4ebe8', grout: '#b9c4bf',
      bedFrame: '#a5764f', sheet: '#7a92e6', pillow: '#ffffff', sofa: '#e07a5f', cushion: '#f0a080',
      rug: '#e8c48a', rugAccent: '#b8583c', rug2: '#9ec8e0',
      table: '#b07c52', desk: '#c49a74', metal: '#9a98b0', frame: '#ffffff',
      leaf: '#4fae6a', pot: '#c07a50', sky: '#8fcffc', sky2: '#c6e8ff', star: '#fff2a0',
      shade: '#fff1c2', paper: '#ffffff', mug: '#e0664b', led: '#3fa0c8', mon: '#1d1a28', curtain: '#d98a6c',
      book: ['#7a4bd0', '#e0664b', '#3fa0c8', '#e0b23f', '#4fae6a', '#d0508a']
    }
  };

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
        const plankTint = (hash(seg, row) - 0.5) * 0.12;
        let c = shade(P.base, plankTint);
        if (jy === 7) c = P.out;                                    // 판자 사이 틈
        else if (ix === 0) c = P.dark;                              // 판자 끝
        else if (jy === 0) c = shade(c, 0.1);                       // 판자 윗모서리 빛
        else {
          const gy = Math.round(3.2 + Math.sin((i + seg * 13) / 6.5) * 1.6);   // 물결 나뭇결
          if (jy === gy && hash(i, row) > 0.35) c = shade(c, -0.14);
          const kx = Math.floor(hash(seg, row * 3) * 40) + 6;      // 옹이
          if (hash(row, seg) > 0.8 && Math.abs(ix - kx) <= 1 && jy >= 3 && jy <= 4) c = P.dark;
        }
        // 벽 가까이는 어둡게 (모서리 그늘)
        const ao = Math.max(0, 7 - j) / 7 * 0.35 + Math.max(0, 4 - i) / 4 * 0.2 + Math.max(0, 4 - (w - 1 - i)) / 4 * 0.2;
        if (ao > 0) c = shade(c, -ao);
        dot(g, x0 + i, y0 + j, c);
      }
    }
  }

  function tileFloor(g, C, x0, y0, w, h) {
    const P = mat(C.tile);
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const ti = i % 16, tj = j % 16;
        const alt = (Math.floor(i / 16) + Math.floor(j / 16)) % 2;
        let c = alt ? P.base : shade(P.base, -0.06);
        if (ti === 0 || tj === 0) c = C.grout;
        else if (ti === 1 || tj === 1) c = shade(c, 0.12);
        else if (ti === 15 || tj === 15) c = shade(c, -0.12);
        else if (hash(i, j) > 0.93) c = shade(c, -0.05);
        const ao = Math.max(0, 7 - j) / 7 * 0.35;
        if (ao > 0) c = shade(c, -ao);
        dot(g, x0 + i, y0 + j, c);
      }
    }
  }

  /* ---------- 벽 */
  function backWall(g, C, room, x0) {
    const P = mat(C.wall[room]);
    for (let j = 0; j < TOP_WALL; j += 1) {
      for (let i = 0; i < ROOM_W; i += 1) {
        let c;
        if (j < 4) c = C.cap;
        else if (j === 4) c = shade(C.cap, -0.5);
        else if (j < TOP_WALL - 16) {
          // 벽지: 은은한 세로줄 + 작은 꽃무늬
          c = (i % 12 === 0) ? P.mid : P.base;
          const mi = (i + (Math.floor(j / 10) % 2) * 6) % 12, mj = j % 10;
          if ((mi === 6 && (mj === 4 || mj === 6)) || (mj === 5 && (mi === 5 || mi === 7))) c = P.hi;
          if (j === 5) c = P.dark;
        } else if (j < TOP_WALL - 5) {
          // 징두리 판벽
          const pi = i % 10;
          c = pi === 0 ? P.dark : pi === 1 ? shade(P.base, 0.08) : shade(P.base, -0.08);
          if (j === TOP_WALL - 16) c = P.hi;
          if (j === TOP_WALL - 15) c = P.dark;
        } else {
          // 걸레받이
          c = j === TOP_WALL - 5 ? shade(C.cap, 0.3) : j === TOP_WALL - 1 ? shade(C.cap, -0.5) : C.cap;
        }
        dot(g, x0 + i, j, c);
      }
    }
  }

  function windowTop(g, C, x, y, w, h, theme) {
    const F = mat(C.frame);
    blob(g, x - 3, y - 3, w + 6, h + 6, 2, F);
    for (let j = 0; j < h; j += 1) {
      const k = j / h;
      for (let i = 0; i < w; i += 1) {
        let c = k < 0.55 ? C.sky : C.sky2;
        if (k >= 0.5 && k < 0.6 && (i + j) % 2) c = C.sky2;     // 하늘 경계 디더
        if ((i + j) % 11 === 0 && i - j > 2 && i - j < w - 8) c = shade(c, 0.18); // 유리 반사 사선
        dot(g, x + i, y + j, c);
      }
    }
    if (theme === 'night') {
      circle(g, x + w - 8, y + 6, 3, { out: null, hi: C.star, base: C.star, mid: C.star, dark: shade(C.star, -0.15) });
      dot(g, x + w - 9, y + 5, C.sky); dot(g, x + w - 8, y + 5, C.sky); dot(g, x + w - 9, y + 6, C.sky);
      [[3, 4], [8, 10], [14, 3], [5, 15]].forEach(([a, b]) => { if (a < w - 12) dot(g, x + a, y + b, '#ffffff'); });
    } else {
      circle(g, x + w - 8, y + 6, 3, { out: null, hi: '#ffffff', base: C.star, mid: C.star, dark: shade(C.star, -0.1) });
      [[3, h - 7], [4, h - 8], [5, h - 8], [6, h - 7], [7, h - 7], [2, h - 7]].forEach(([a, b]) => dot(g, x + a, y + b, '#ffffff'));
    }
    for (let j = 0; j < h; j += 1) { dot(g, x + Math.floor(w / 2) - 1, y + j, F.base); dot(g, x + Math.floor(w / 2), y + j, F.mid); }
    blob(g, x - 5, y + h + 1, w + 10, 4, 1, F);
  }

  function curtain(g, C, x, y, w, h) {
    const P = mat(C.curtain);
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        // 세로 주름: 사인으로 밝고 어둡게, 아래로 갈수록 살짝 퍼짐
        const s = Math.sin((i + 1) * 1.6 + j * 0.02);
        let c = s > 0.5 ? P.hi : s > -0.2 ? P.base : s > -0.7 ? P.mid : P.dark;
        if (i === 0 || i === w - 1) c = P.out;
        if (j === h - 1 && (i % 2)) continue;
        dot(g, x + i, y + j, c);
      }
    }
  }

  function plant(g, C, x, y) {
    const L = mat(C.leaf), Pt = mat(C.pot);
    softShadow(g, x + 2, y + 20, 16, 5);
    blob(g, x + 4, y + 13, 12, 9, 3, Pt);
    blob(g, x + 3, y + 12, 14, 4, 2, { ...Pt, base: Pt.hi, mid: Pt.base });
    // 잎: 기울어진 타원 여러 장
    const leaves = [[2, 2, 7, 5], [9, 0, 7, 6], [5, 5, 9, 6], [0, 7, 6, 5], [12, 6, 6, 5], [7, -2, 5, 5]];
    leaves.forEach(([a, b, lw, lh]) => blob(g, x + a, y + b, lw, lh, Math.floor(Math.min(lw, lh) / 2), L));
    [[5, 4], [12, 2], [9, 8], [3, 9], [14, 8], [9, 0]].forEach(([a, b]) => dot(g, x + a, y + b, shade(L.hi, 0.15)));
  }

  function rug(g, C, x, y, w, h, accent2) {
    const R = mat(C.rug);
    blob(g, x, y, w, h, 3, R, (i, j, c) => {
      const b = Math.min(i, j, w - 1 - i, h - 1 - j);
      if (b === 3) return R.dark;                                       // 테두리 줄
      if (b === 5 && (i + j) % 4 === 0) return C.rugAccent;            // 점선 장식
      if (b > 7) {
        // 가운데: 반복 마름모 무늬 + 잔결
        const mi = (i - 8) % 18, mj = (j - 8) % 18;
        if (Math.abs(mi - 9) + Math.abs(mj - 9) === 6) return accent2 ? C.rug2 : C.rugAccent;
        if (Math.abs(mi - 9) + Math.abs(mj - 9) === 2) return R.hi;
        if (hash(i, j) > 0.86) return R.mid;
      }
      return null;
    });
    for (let i = 3; i < w - 3; i += 3) { dot(g, x + i, y - 1, R.mid); dot(g, x + i, y - 2, R.dark); dot(g, x + i, y + h, R.mid); dot(g, x + i, y + h + 1, R.dark); }
  }

  function lampTop(g, C, cx, cy) {
    const S = mat(C.shade);
    circle(g, cx, cy, 5, { ...S, out: shade(C.shade, -0.45) });
    dot(g, cx - 2, cy - 2, '#ffffff'); dot(g, cx - 1, cy - 3, '#ffffff');
    dot(g, cx, cy, shade(C.shade, -0.25));
  }

  /* ---------- 침실 */
  function drawBedroomTop(g, C, theme) {
    const x0 = ROOM_X.bed;
    woodFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'bed', x0);
    windowTop(g, C, x0 + 20, 12, 36, 24, theme);
    // 벽시계 (둥글게)
    const F = mat(C.frame);
    circle(g, x0 + 107, 21, 7, F);
    circle(g, x0 + 107, 21, 5, { out: null, hi: theme === 'night' ? '#8a84c0' : '#ffffff', base: theme === 'night' ? '#6a64a0' : '#f4f4f8', mid: theme === 'night' ? '#6a64a0' : '#f4f4f8', dark: theme === 'night' ? '#585290' : '#e0e0ea' });
    for (let k = 0; k < 4; k += 1) dot(g, x0 + 107, 21 - k, F.out);
    for (let k = 0; k < 3; k += 1) dot(g, x0 + 107 + k, 21, F.out);
    // 서랍장 + 위 소품
    const W = mat(C.bedFrame);
    solid(g, x0 + 6, TOP_WALL + 2, 32, 12, 12, 2, W, mat(shade(C.bedFrame, -0.18)), (i, j, c) => (j % 4 === 2 && hash(i, j) > 0.4 ? shade(c, -0.08) : null));
    [[11, 21], [27, 21]].forEach(([a, b]) => { dot(g, x0 + a, TOP_WALL + b, W.hi); dot(g, x0 + a + 1, TOP_WALL + b, W.hi); });
    blob(g, x0 + 10, TOP_WALL + 4, 9, 6, 1, mat(C.book[1]));
    blob(g, x0 + 24, TOP_WALL + 3, 7, 8, 1, mat(C.frame));
    // 협탁 + 스탠드 (빛 중심 137,74)
    solid(g, x0 + 126, 64, 22, 12, 8, 2, W, mat(shade(C.bedFrame, -0.18)));
    lampTop(g, C, x0 + 137, 69);
    // 침대: 머리판 → 매트리스 → 베개 → 이불(주름·누빔) → 늘어진 이불 앞자락
    const bx = x0 + 6, bw = 148;
    solid(g, bx, 94, bw, 8, 6, 2, W, mat(shade(C.bedFrame, -0.18)));
    blob(g, bx, 106, bw, 92, 3, mat(shade(C.pillow, -0.12)));
    [16, 50, 86, 120].forEach((p) => {
      blob(g, x0 + p, 111, 25, 14, 4, mat(C.pillow), (i, j, c) => (j === 6 && i > 4 && i < 20 ? shade(c, -0.1) : null));
    });
    const S = mat(C.sheet);
    for (let j = 0; j < 66; j += 1) {
      for (let i = 0; i < bw; i += 1) {
        const top = 130 + Math.round(Math.sin(i / 9) * 1.2);   // 접힌 윗단이 물결
        const yy = 130 + j;
        if (yy < top) continue;
        const ins = (a, b) => b >= top && a >= 0 && a < bw;
        let c;
        if (!ins(i - 1, yy) || !ins(i + 1, yy)) c = S.out;
        else if (yy - top < 5) c = yy - top === 0 ? S.out : yy - top === 4 ? S.dark : S.hi;   // 접힌 단
        else {
          c = S.base;
          const sx = (i + Math.round(Math.sin(yy / 7) * 1.5)) % 37;
          if (sx === 0) c = S.dark;                              // 세로 누빔선
          if ((yy - 140) % 14 === 0) c = S.dark;                // 가로 누빔선
          if ((yy - 140) % 14 === 1 || sx === 1) c = S.hi;
          else if (hash(i, yy) > 0.9) c = S.mid;
          // 사람이 누운 자리처럼 살짝 볼록한 그늘
          const bump = Math.sin(i / 34 * Math.PI) * 0;
          if (bump) c = shade(c, bump);
        }
        dot(g, bx + i, yy, c);
      }
    }
    // 이불 앞자락: 아래 끝이 물결
    for (let i = 0; i < bw; i += 1) {
      const end = 205 + Math.round(Math.sin(i / 6) * 1.5);
      for (let yy = 196; yy <= end; yy += 1) {
        let c = yy === end ? S.out : (i % 9 < 2 ? S.dark : S.mid);
        if (i === 0 || i === bw - 1) c = S.out;
        dot(g, bx + i, yy, c);
      }
    }
    softShadow(g, bx + 4, 204, bw - 4, 7);
    // 러그 + 슬리퍼 + 화분
    rug(g, C, x0 + 36, 218, 88, 30, true);
    blob(g, x0 + 52, 230, 6, 4, 2, mat(C.cushion)); blob(g, x0 + 60, 231, 6, 4, 2, mat(C.cushion));
    plant(g, C, x0 + 9, 222);
  }

  /* ---------- 거실 */
  function drawLivingTop(g, C, theme) {
    const x0 = ROOM_X.living;
    woodFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'living', x0);
    windowTop(g, C, x0 + 60, 10, 40, 28, theme);
    curtain(g, C, x0 + 50, 7, 10, 38);
    curtain(g, C, x0 + 100, 7, 10, 38);
    blob(g, x0 + 47, 5, 66, 3, 1, mat(C.bedFrame));
    // 액자: 언덕 풍경
    const F = mat(C.frame);
    blob(g, x0 + 14, 14, 26, 20, 1, F);
    for (let j = 0; j < 14; j += 1) for (let i = 0; i < 20; i += 1) {
      const hill = 8 + Math.round(Math.sin(i / 4) * 2);
      dot(g, x0 + 17 + i, 17 + j, j > hill ? (j > hill + 3 ? shade(C.leaf, -0.2) : C.leaf) : C.sky2);
    }
    dot(g, x0 + 32, 19, C.star); dot(g, x0 + 33, 19, C.star); dot(g, x0 + 32, 20, C.star);
    // 큰 러그
    rug(g, C, x0 + 14, 112, 132, 134);
    // 소파
    const So = mat(C.sofa), Sf = mat(shade(C.sofa, -0.2)), Cu = mat(C.cushion);
    const sx = x0 + 22, sw = 116;
    softShadow(g, sx - 6, TOP_WALL + 38, sw + 12, 8);
    blob(g, sx - 2, TOP_WALL + 1, sw + 4, 14, 4, So, (i, j, c) => (j === 8 ? shade(c, -0.08) : null));    // 등받이
    blob(g, sx, TOP_WALL + 28, sw, 12, 3, Sf);                                                                // 앞면
    [0, 1, 2].forEach((k) => {
      blob(g, sx + 2 + k * 38, TOP_WALL + 13, 36, 20, 4, So, (i, j, c) => (Math.abs(i - 18) + Math.abs(j - 9) === 2 ? So.dark : null)); // 방석 + 단추
    });
    blob(g, sx - 10, TOP_WALL + 5, 12, 34, 5, So);   // 팔걸이
    blob(g, sx + sw - 2, TOP_WALL + 5, 12, 34, 5, So);
    blob(g, sx + 8, TOP_WALL + 14, 15, 12, 4, mat(C.rugAccent));   // 쿠션
    blob(g, sx + sw - 24, TOP_WALL + 14, 15, 12, 4, mat(C.pillow));
    // 커피 테이블 + 책 + 머그
    const T = mat(C.table);
    solid(g, x0 + 52, 136, 56, 20, 6, 3, T, mat(shade(C.table, -0.2)), (i, j, c) => {
      const gy = Math.round(9 + Math.sin(i / 5) * 3);
      return j === gy || j === gy + 6 ? shade(c, -0.1) : null;
    });
    blob(g, x0 + 59, 140, 14, 10, 1, mat(C.book[2]), (i, j) => (j === 1 && i > 1 && i < 12 ? C.paper : null));
    circle(g, x0 + 96, 145, 4, mat(C.mug));
    dot(g, x0 + 96, 145, '#3a2a20'); dot(g, x0 + 95, 145, '#3a2a20'); dot(g, x0 + 96, 144, '#3a2a20');
    dot(g, x0 + 101, 144, shade(C.mug, -0.5)); dot(g, x0 + 101, 145, shade(C.mug, -0.5)); dot(g, x0 + 101, 146, shade(C.mug, -0.5));
    // 화분 + 플로어 스탠드
    plant(g, C, x0 + 139, TOP_WALL + 4);
    plant(g, C, x0 + 10, 222);
    softShadow(g, x0 + 142, 240, 12, 5);
    for (let k = 0; k < 9; k += 1) dot(g, x0 + 148, 232 + k, shade(C.bedFrame, -0.3));
    blob(g, x0 + 144, 240, 9, 4, 2, mat(shade(C.bedFrame, -0.1)));
    lampTop(g, C, x0 + 148, 229);
  }

  /* ---------- 작업실 */
  function drawWorkTop(g, C, theme) {
    const x0 = ROOM_X.work;
    tileFloor(g, C, x0, TOP_WALL, ROOM_W, LH - TOP_WALL);
    backWall(g, C, 'work', x0);
    // 책장: 칸마다 책 높이·색이 다르고, 한 권은 기울어짐
    const W = mat(C.bedFrame);
    blob(g, x0 + 10, 6, 64, 44, 2, W);
    [9, 23, 37].forEach((sy, row) => {
      for (let j = 0; j < 12; j += 1) for (let i = 0; i < 58; i += 1) dot(g, x0 + 13 + i, sy + j, shade(C.bedFrame, -0.45));
      let bx = x0 + 14;
      let n = 0;
      while (bx < x0 + 68) {
        const bw = 4 + Math.floor(hash(n, row) * 3);
        const bh = 8 + Math.floor(hash(row, n) * 4);
        const col = C.book[(n + row * 2) % C.book.length];
        const B = mat(col);
        if (bx + bw > x0 + 70) break;
        if (n === 5 && row === 1) {
          for (let j = 0; j < bh; j += 1) for (let i = 0; i < bw; i += 1) dot(g, bx + i + Math.floor(j / 3), sy + 12 - bh + j, i === 0 ? B.out : i === 1 ? B.hi : B.base);
          bx += bw + 3;
        } else {
          for (let j = 0; j < bh; j += 1) for (let i = 0; i < bw; i += 1) {
            let c = i === 0 || i === bw - 1 || j === 0 ? B.out : i === 1 ? B.hi : B.base;
            if (j === 3 && i > 0 && i < bw - 1) c = B.hi;   // 책등 띠
            dot(g, bx + i, sy + 12 - bh + j, c);
          }
          bx += bw;
        }
        n += 1;
      }
      blob(g, x0 + 11, sy + 12, 62, 3, 1, W);
    });
    // A.I.Mon 포스터
    const F = mat(C.frame);
    blob(g, x0 + 96, 10, 44, 34, 2, F);
    for (let j = 0; j < 26; j += 1) for (let i = 0; i < 36; i += 1) dot(g, x0 + 100 + i, 14 + j, theme === 'night' ? '#120f24' : '#2b2440');
    for (let i = 0; i < 24; i += 1) { dot(g, x0 + 106 + i, 20, HOLO); dot(g, x0 + 106 + i, 21, shade('#7ff6ff', -0.3)); }
    for (let i = 0; i < 16; i += 1) dot(g, x0 + 110 + i, 27, '#ff7a59');
    for (let i = 0; i < 12; i += 1) dot(g, x0 + 112 + i, 32, '#b15ce8');
    // 서버 랙
    const M = mat(C.metal);
    solid(g, x0 + 6, TOP_WALL + 2, 22, 12, 34, 2, M, mat(shade(C.metal, -0.15)));
    for (let y = TOP_WALL + 18; y < TOP_WALL + 46; y += 6) {
      blob(g, x0 + 8, y, 18, 5, 1, mat(shade(C.metal, 0.1)));
      dot(g, x0 + 10, y + 2, C.led); dot(g, x0 + 13, y + 2, hash(y, 3) > 0.5 ? '#ff7a59' : C.led);
      for (let k = 16; k < 24; k += 2) dot(g, x0 + k, y + 2, M.dark);
    }
    plant(g, C, x0 + 138, TOP_WALL + 3);
    // 긴 책상
    const D = mat(C.desk);
    solid(g, x0 + 8, 124, 144, 32, 10, 3, D, mat(shade(C.desk, -0.22)), (i, j, c) => (j === 30 ? shade(c, -0.1) : hash(i, j) > 0.94 ? shade(c, 0.05) : null));
    SPOTS.work.forEach((s, n) => {
      const mx = s.x - 13;
      // 모니터: 둥근 베젤, 화면(drawMonitors 가 켜는 자리), 반사 사선, 받침
      blob(g, mx - 2, 128, 30, 23, 3, mat(shade(C.metal, -0.2)));
      for (let j = 0; j < 17; j += 1) for (let i = 0; i < 24; i += 1) {
        let c = C.mon;
        if (i - j === 3 || i - j === 4) c = shade(C.mon, 0.12);
        dot(g, mx + 1 + i, 131 + j, c);
      }
      blob(g, mx + 9, 150, 10, 3, 1, mat(shade(C.metal, -0.1)));
      // 키보드(자판 점) + 마우스 + 머그 하나
      blob(g, mx + 1, 152, 21, 5, 1, mat(C.metal), (i, j, c) => (j === 2 && i % 2 === 1 ? shade(c, -0.2) : null));
      circle(g, mx + 26, 154, 2, mat(shade(C.metal, 0.2)));
      if (n === 2) circle(g, mx - 5, 146, 3, mat(C.mug));
    });
    // 바닥 케이블 (구불구불)
    for (let i = 0; i < 118; i += 1) dot(g, x0 + 22 + i, 176 + Math.round(Math.sin(i / 8) * 2), shade(C.metal, -0.35));
    rug(g, C, x0 + 20, 196, 120, 40, true);
    // 종이 더미
    blob(g, x0 + 123, 238, 15, 11, 1, mat(C.paper), (i, j, c) => (j % 3 === 1 && i > 2 && i < 11 ? shade(c, -0.25) : null));
  }

  // 방 사이 벽(위에서 본 윗면) + 문틀, 바깥 벽
  function wallsTop(g, C) {
    const P = mat(C.cap);
    const cap = (x, y, w, h, r) => blob(g, x, y, w, h, r, P, (i, j, c) => (hash(i, j + y) > 0.9 ? P.mid : null));
    [ROOM_W, ROOM_W * 2].forEach((x) => {
      cap(x - 4, 0, 8, DOOR.y0 + 2, 2);
      cap(x - 4, DOOR.y1 - 2, 8, LH - DOOR.y1 + 2, 2);
      // 문턱 (나무)
      const T = mat(C.table);
      blob(g, x - 3, DOOR.y0 + 2, 6, DOOR.y1 - DOOR.y0 - 4, 1, T, (i, j, c) => (j % 8 === 7 ? T.dark : null));
    });
    cap(0, 0, 4, LH, 0);
    cap(LW - 4, 0, 4, LH, 0);
    cap(0, LH - 6, LW, 6, 0);
  }

  function buildRoom(theme) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d');
    const C = TC[theme];
    drawBedroomTop(g, C, theme);
    drawLivingTop(g, C, theme);
    drawWorkTop(g, C, theme);
    wallsTop(g, C);
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

  window.House = { init, setBots, setTheme, setSelected, anchorOf, stepRoom, botsIn, currentRoom, focusBot, focused, roomCanvas: buildRoom };
})();
