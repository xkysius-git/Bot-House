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
  const DRAW = 52;           // 캐릭터 표시 크기 (논리 px)
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
  const CAM_VIEW_W = ROOM_W + 48;
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
    cam: { room: 'living', x: ROOM_X.living + ROOM_W / 2, y: 190 }
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

  /* ------------------------------------------------------------ 임시 방 그림 */
  const PAL = {
    night: {
      bed: { wall: '#1c1a3c', wall2: '#232048' }, living: { wall: '#2a1d36', wall2: '#33233f' }, work: { wall: '#16263a', wall2: '#1b2e45' },
      floor: '#2a2140', floor2: '#231b37', base: '#0f0b1f', pillar: '#120e24', pillar2: '#1d1735',
      sky: '#0d1430', sky2: '#16204a', frame: '#3b3160', glass: 'rgba(120,160,255,.08)',
      wood: '#4a3350', wood2: '#3a2742', cloth: '#3d4a8a', cloth2: '#2f3a70', pillow: '#a7b2e6',
      sofa: '#6a3c5a', sofa2: '#552e48', rug: '#3a2850', rug2: '#47325f', leaf: '#2f7a5a', leaf2: '#235c44', pot: '#6a4a3a',
      desk: '#3a3148', desk2: '#2b2438', mon: '#0e0c18', monEdge: '#4a4060', shelf: '#3a2d4c', book: ['#7a4bd0', '#d06a4b', '#4bb0d0', '#d0b04b'],
      lamp: '#ffd98a'
    },
    day: {
      bed: { wall: '#dfe6f5', wall2: '#e9eefa' }, living: { wall: '#f4e4cf', wall2: '#f8ecdc' }, work: { wall: '#dcefea', wall2: '#e6f5f1' },
      floor: '#c99a6b', floor2: '#b98a5d', base: '#8a6244', pillar: '#a98a70', pillar2: '#c4a88e',
      sky: '#9fd6ff', sky2: '#cdeaff', frame: '#ffffff', glass: 'rgba(255,255,255,.15)',
      wood: '#9a6a48', wood2: '#83573a', cloth: '#7a92e6', cloth2: '#6177c8', pillow: '#ffffff',
      sofa: '#e07a5f', sofa2: '#c4654c', rug: '#e8c48a', rug2: '#d9ad6c', leaf: '#4fae6a', leaf2: '#3a8c52', pot: '#b0704a',
      desk: '#b48a66', desk2: '#987052', mon: '#1d1a28', monEdge: '#57506a', shelf: '#a07a58', book: ['#7a4bd0', '#e0664b', '#3fa0c8', '#e0b23f'],
      lamp: '#fff1c2'
    }
  };

  function px(g, x, y, w, h, c) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  function drawWindow(g, p, x, y, w, h, theme) {
    px(g, x - 2, y - 2, w + 4, h + 4, p.frame);
    px(g, x, y, w, h, p.sky);
    px(g, x, y + Math.floor(h * 0.55), w, Math.ceil(h * 0.45), p.sky2);
    if (theme === 'night') {
      px(g, x + w - 12, y + 5, 6, 6, '#fff3c4');
      px(g, x + w - 10, y + 5, 4, 4, p.sky);
      [[4, 6], [10, 14], [17, 4], [6, 20]].forEach(([sx, sy]) => { if (sx < w - 14) px(g, x + sx, y + sy, 1, 1, '#ffffff'); });
    } else {
      px(g, x + w - 13, y + 5, 7, 7, '#fff2a0');
      px(g, x + 3, y + h - 8, 12, 3, '#ffffff');
      px(g, x + 6, y + h - 10, 6, 2, '#ffffff');
    }
    px(g, x + Math.floor(w / 2) - 1, y, 2, h, p.frame);
    px(g, x, y + Math.floor(h / 2) - 1, w, 2, p.frame);
    px(g, x - 4, y + h + 2, w + 8, 3, p.frame);
  }

  function drawBedroom(g, p, theme) {
    const x0 = ROOM_X.bed;
    drawWindow(g, p, x0 + 22, 34, 38, 34, theme);
    // 벽 시계
    px(g, x0 + 104, 36, 16, 16, p.frame);
    px(g, x0 + 106, 38, 12, 12, theme === 'night' ? '#2b2650' : '#ffffff');
    px(g, x0 + 111, 40, 2, 5, p.base);
    px(g, x0 + 111, 44, 5, 2, p.base);
    // 벽등
    px(g, x0 + 132, 78, 10, 4, p.wood);
    px(g, x0 + 134, 70, 6, 8, p.lamp);
    // 큰 침대 (베개 4개)
    px(g, x0 + 8, 140, 144, 22, p.wood);
    px(g, x0 + 8, 140, 144, 3, p.wood2);
    px(g, x0 + 6, 160, 148, 34, p.cloth);
    px(g, x0 + 6, 184, 148, 10, p.cloth2);
    px(g, x0 + 6, 194, 148, 6, p.wood2);
    [16, 50, 86, 120].forEach((bx) => {
      px(g, x0 + bx, 162, 24, 9, p.pillow);
      px(g, x0 + bx, 169, 24, 2, p.cloth2);
    });
  }

  function drawLiving(g, p, theme) {
    const x0 = ROOM_X.living;
    drawWindow(g, p, x0 + 58, 26, 44, 38, theme);
    // 커튼
    px(g, x0 + 50, 22, 8, 50, p.sofa2);
    px(g, x0 + 102, 22, 8, 50, p.sofa2);
    px(g, x0 + 48, 20, 64, 3, p.wood2);
    // 액자
    px(g, x0 + 14, 46, 22, 16, p.frame);
    px(g, x0 + 16, 48, 18, 12, p.leaf);
    px(g, x0 + 16, 54, 18, 6, p.cloth);
    // 소파 (벽에 붙임)
    px(g, x0 + 22, 118, 116, 20, p.sofa);
    px(g, x0 + 22, 118, 116, 3, p.sofa2);
    px(g, x0 + 16, 130, 128, 26, p.sofa);
    px(g, x0 + 16, 148, 128, 8, p.sofa2);
    px(g, x0 + 14, 124, 10, 32, p.sofa2);
    px(g, x0 + 136, 124, 10, 32, p.sofa2);
    px(g, x0 + 22, 156, 4, 4, p.base);
    px(g, x0 + 134, 156, 4, 4, p.base);
    // 화분
    px(g, x0 + 146, 132, 10, 22, p.pot);
    px(g, x0 + 142, 108, 18, 24, p.leaf);
    px(g, x0 + 146, 104, 10, 8, p.leaf2);
    px(g, x0 + 140, 118, 6, 8, p.leaf2);
    // 러그
    px(g, x0 + 18, 196, 124, 58, p.rug);
    px(g, x0 + 22, 200, 116, 50, p.rug2);
    px(g, x0 + 26, 204, 108, 42, p.rug);
  }

  function drawWorkroom(g, p, theme) {
    const x0 = ROOM_X.work;
    // 선반 + 책
    px(g, x0 + 18, 54, 60, 4, p.shelf);
    for (let i = 0; i < 9; i += 1) px(g, x0 + 22 + i * 6, 38 + (i % 3), 5, 16 - (i % 3), p.book[i % 4]);
    // A.I.Mon 포스터
    px(g, x0 + 98, 26, 40, 30, p.frame);
    px(g, x0 + 100, 28, 36, 26, theme === 'night' ? '#120f24' : '#2b2440');
    px(g, x0 + 106, 34, 24, 3, HOLO);
    px(g, x0 + 110, 40, 16, 2, '#ff7a59');
    px(g, x0 + 112, 45, 12, 2, '#b15ce8');
    // 긴 책상 + 모니터 4대
    px(g, x0 + 8, 156, 144, 8, p.desk);
    px(g, x0 + 8, 164, 144, 18, p.desk2);
    px(g, x0 + 12, 182, 4, 14, p.desk2);
    px(g, x0 + 144, 182, 4, 14, p.desk2);
    SPOTS.work.forEach((s) => {
      const mx = s.x - 13;
      px(g, mx - 1, 129, 28, 21, p.monEdge);
      px(g, mx + 1, 131, 24, 17, p.mon);
      px(g, mx + 11, 150, 4, 6, p.monEdge);
      px(g, mx + 7, 154, 12, 2, p.monEdge);
    });
  }

  function buildRoom(theme) {
    const c = document.createElement('canvas');
    c.width = LW;
    c.height = LH;
    const g = c.getContext('2d');
    const p = PAL[theme];
    for (const room of ROOMS) {
      const x0 = ROOM_X[room];
      px(g, x0, 0, ROOM_W, WALL_H, p[room].wall);
      for (let y = 8; y < WALL_H; y += 16) px(g, x0, y, ROOM_W, 1, p[room].wall2);
    }
    // 바닥 판자
    px(g, 0, WALL_H, LW, LH - WALL_H, p.floor);
    for (let y = WALL_H + 10; y < LH; y += 12) px(g, 0, y, LW, 1, p.floor2);
    for (let y = WALL_H, row = 0; y < LH; y += 12, row += 1) {
      for (let x = (row % 2) * 24; x < LW; x += 48) px(g, x, y, 1, 12, p.floor2);
    }
    px(g, 0, WALL_H - 4, LW, 4, p.base);
    // 방 사이 기둥 (문틀)
    [ROOM_W, ROOM_W * 2].forEach((x) => {
      px(g, x - 3, 0, 6, WALL_H, p.pillar);
      px(g, x - 1, 0, 2, WALL_H, p.pillar2);
    });
    drawBedroom(g, p, theme);
    drawLiving(g, p, theme);
    drawWorkroom(g, p, theme);
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
    const scale = Math.max(w / CAM_VIEW_W, h / LH);
    state.view = { w, h, dpr, scale, ox: 0, oy: 0 };
    placeCamera(true);
  }

  function placeCamera(snap, dt) {
    const v = state.view;
    if (!v.scale) return;
    const c = state.cam;
    const tx = ROOM_X[c.room] + ROOM_W / 2;
    const ty = CAM_Y[c.room] || 190;
    const f = snap ? 1 : Math.min(1, (dt || 0.016) * 7);
    c.x += (tx - c.x) * f;
    c.y += (ty - c.y) * f;
    const ox = v.w / 2 - c.x * v.scale;
    const oy = v.h / 2 - c.y * v.scale;
    v.ox = Math.min(0, Math.max(v.w - LW * v.scale, ox));
    v.oy = Math.min(0, Math.max(v.h - LH * v.scale, oy));
    paintRoomLabels();
  }

  function paintRoomLabels() {
    const box = state.scene && state.scene.querySelector('.zone-labels');
    if (!box) return;
    box.classList.add('cam');
    box.querySelectorAll('.zone-label').forEach((el, i) => el.classList.toggle('cur', ROOMS[i] === state.cam.room));
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

  window.House = { init, setBots, setTheme, setSelected, anchorOf, stepRoom, botsIn, currentRoom };
})();
