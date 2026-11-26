/* Bot House — 다마고치 케어 스테이지
   봇 상태는 기존 상태(IPC)를 그대로 쓰고, 쓰다듬기·간식·응원·재우기는
   이 화면에서만 쓰는 케어 수치(localStorage)로 다룬다. */
(function () {
  'use strict';

  const W = 192;                       // 액정 논리 가로 (px)
  const BOT_IDS = ['oiji', 'takuan', 'sbji', 'claude'];
  const ATLAS = { idle: [0, 1], work: [6, 7, 8, 9], sleep: [10], walk: [2, 3, 4, 5] };
  const CARE_KEY = 'bothouse.care.v1';
  const HUD_TICK = 300;
  const STATE_TEXT = { working: '작업 중', idle: '쉬는 중', offline: '오프라인' };

  const LINES = {
    pet: {
      oiji: ['히히, 기분 좋아', '또 해줘', '간지러워'],
      takuan: ['음, 딱 좋아', '한 번 더', '그렇지'],
      sbji: ['또 쓰다듬어', '좋은데', '음…'],
      claude: ['삐– 좋아', '통통', '또 눌러줘']
    },
    snack: {
      oiji: ['잘 먹을게', '오이 맛있다', '냠냠'],
      takuan: ['이건 좀 짜', '고마워', '냠'],
      sbji: ['배고팠어', '맛있다', '더 줘'],
      claude: ['삐삐, 냠', '고마워', '한 입 더']
    },
    cheer: {
      oiji: ['힘낼게!', '할 수 있어', '고마워!'],
      takuan: ['덕분에 살았어', '간다!', '좋아'],
      sbji: ['집중될 것 같아', '힘난다', '고마워'],
      claude: ['삐– 힘낼게', '좋아, 간다', '파이팅']
    },
    sleep: {
      oiji: ['쿨쿨…', '잠깐만 잘게'],
      takuan: ['푹 자고 올게', '잘 자'],
      sbji: ['충전할게', '쿨…'],
      claude: ['삐… 잘게', '쿨쿨']
    },
    wake: {
      oiji: ['잘 잤어!', '개운해'],
      takuan: ['일어났어', '좋은 아침'],
      sbji: ['충전 완료', '일어났어'],
      claude: ['삐! 일어남', '준비됐어']
    },
    hungry: ['배고픈데…', '간식 시간?', '출출해']
  };

  const state = {
    canvas: null, ctx: null, screen: null, ro: null,
    bots: {}, defs: [],
    theme: 'night', focus: 'oiji', mode: 'focus',
    care: {}, effects: [],
    hop: { t: 1, dur: 0.8 },
    chewing: 0,
    bubble: null, bubbleUntil: 0,
    visible: true,
    view: { w: 1, h: 1, s: 1, lh: 108, dpr: 1 },
    last: 0, lastHud: 0, nextNag: 0,
    slotEls: {}, cellEls: {}, meterEls: {}, faceEls: [],
    nodes: {}
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ------------------------------------------------------- 케어 수치 */
  function defaultCare() {
    return { energy: 76, mood: 72, sleeping: false, updatedAt: Date.now() };
  }

  function loadCare() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CARE_KEY) || 'null'); } catch (err) { saved = null; }
    const now = Date.now();
    state.care = {};
    for (const id of BOT_IDS) {
      const base = defaultCare();
      const prev = saved && saved[id];
      if (prev && typeof prev.energy === 'number') {
        Object.assign(base, {
          energy: clamp(prev.energy, 0, 100),
          mood: clamp(Number(prev.mood) || 70, 0, 100),
          sleeping: !!prev.sleeping,
          updatedAt: Number(prev.updatedAt) || now
        });
        // 앱을 꺼 둔 동안의 시간만큼 천천히 흘려보낸다 (최대 12시간)
        const mins = clamp((now - base.updatedAt) / 60000, 0, 720);
        base.energy = clamp(base.energy - mins * (base.sleeping ? -5 : 0.22), 0, 100);
        base.mood = clamp(base.mood - mins * 0.08, 0, 100);
      }
      if (!state.bots[id] || state.bots[id].state !== 'working') {
        // 작업 중이 아닌 봇이 잠들어 있던 상태는 그대로 살린다
        base.sleeping = !!base.sleeping;
      }
      base.updatedAt = now;
      state.care[id] = base;
    }
  }

  function persist() {
    try {
      const out = {};
      for (const id of BOT_IDS) {
        const c = state.care[id];
        if (!c) continue;
        out[id] = { energy: Math.round(c.energy * 10) / 10, mood: Math.round(c.mood * 10) / 10, sleeping: !!c.sleeping, updatedAt: Date.now() };
      }
      localStorage.setItem(CARE_KEY, JSON.stringify(out));
    } catch (err) { /* 저장소를 못 쓰면 이번 실행 동안만 유지 */ }
  }

  function careOf(id) {
    if (!state.care[id]) state.care[id] = defaultCare();
    return state.care[id];
  }

  function botState(id) {
    const b = state.bots[id];
    return (b && b.state) || 'idle';
  }

  function lookOf(id) {
    const st = botState(id);
    if (st === 'working') return 'work';
    if (careOf(id).sleeping) return 'sleep';
    if (st === 'offline') return 'offline';
    return 'idle';
  }

  function metrics(id) {
    const c = careOf(id);
    const st = botState(id);
    const b = state.bots[id] || {};
    const last = b.lastActivity ? Number(b.lastActivity) : 0;
    const mins = last ? (Date.now() - last) / 60000 : null;
    const cond = clamp(Math.round(c.energy * 0.55 + c.mood * 0.45 - (st === 'offline' ? 8 : 0)), 0, 100);
    let act;
    if (st === 'working') act = mins !== null && mins < 2 ? 96 : 88;
    else if (st === 'idle') act = mins === null ? 44 : mins < 10 ? 68 : mins < 60 ? 54 : 36;
    else act = 10;
    return { cond, energy: Math.round(c.energy), act, tokens: (b.usage && b.usage.todayTokens) || null };
  }

  function tickCare(dt) {
    const perMin = dt / 60;
    for (const id of BOT_IDS) {
      const c = careOf(id);
      const st = botState(id);
      const look = lookOf(id);
      if (look === 'sleep') {
        c.energy = clamp(c.energy + 7 * perMin, 0, 100);
        c.mood = clamp(c.mood + 1.2 * perMin, 0, 100);
        if (c.energy >= 99.5 && c.sleeping) {
          c.sleeping = false;
          setBubble(id === state.focus ? rnd(LINES.wake[id]) : null, 2.2);
        }
      } else if (look === 'work') {
        c.energy = clamp(c.energy - 1.5 * perMin, 0, 100);
        c.mood = clamp(c.mood - 0.5 * perMin, 0, 100);
      } else if (st === 'offline') {
        c.energy = clamp(c.energy - 0.1 * perMin, 0, 100);
        c.mood = clamp(c.mood - 0.25 * perMin, 0, 100);
      } else {
        c.energy = clamp(c.energy - 0.45 * perMin, 0, 100);
        c.mood = clamp(c.mood - 0.14 * perMin, 0, 100);
      }
      if (c.sleeping && st === 'working') c.sleeping = false;
    }
  }

  /* ------------------------------------------------------- 말풍선 / 반응 */
  function setBubble(text, sec) {
    if (!text) { state.bubble = null; state.bubbleUntil = 0; return; }
    state.bubble = text;
    state.bubbleUntil = performance.now() + (sec || 2.4) * 1000;
  }

  function hop() {
    state.hop.t = 0;
  }

  function push(effect) {
    state.effects.push(effect);
    if (state.effects.length > 120) state.effects.shift();
  }

  function geom() {
    const ground = groundY();
    const sp = spriteSize();
    const feet = ground + 2;
    return { cx: cxOf(), feet, sp, top: feet - sp, head: feet - sp * 0.76, ground };
  }

  function hearts(n) {
    const g = geom();
    for (let i = 0; i < n; i += 1) {
      push({
        type: 'heart',
        x: g.cx + (Math.random() * 22 - 11),
        y: g.top + 6 + Math.random() * 8,
        vx: Math.random() * 10 - 5,
        vy: -8 - Math.random() * 7,
        life: 1,
        size: Math.random() < 0.35 ? 2 : 1
      });
    }
  }

  function sparkles(n) {
    const g = geom();
    for (let i = 0; i < n; i += 1) {
      push({
        type: 'spark',
        x: g.cx + (Math.random() * 62 - 31),
        y: g.top - 2 + Math.random() * 34,
        vx: Math.random() * 12 - 6,
        vy: Math.random() * 8 - 4,
        life: 1
      });
    }
  }

  function confetti(n) {
    const g = geom();
    const cols = ['#ff8f6b', '#ffd166', '#7bd1a8', '#8ab4ff', '#f39ad1'];
    for (let i = 0; i < n; i += 1) {
      push({
        type: 'confetti',
        x: g.cx + (Math.random() * 90 - 45),
        y: g.top - 10 - Math.random() * 34,
        vx: Math.random() * 14 - 7,
        vy: 26 + Math.random() * 26,
        life: 1,
        color: cols[i % cols.length]
      });
    }
  }

  function food() {
    const g = geom();
    push({ type: 'food', x: g.cx, y0: g.head - 10, y1: g.feet - 1, t: 0, life: 1 });
  }

  function sweatOnce() {
    const g = geom();
    push({ type: 'sweat', x: g.cx + g.sp * 0.24, y: g.head + 4, vx: 6, vy: 26, life: 1 });
  }

  /* ------------------------------------------------------- 동작 */
  function act(kind) {
    const id = state.focus;
    if (!id) return;
    const c = careOf(id);
    const st = botState(id);

    if (kind === 'pet') {
      c.mood = clamp(c.mood + 10, 0, 100);
      c.energy = clamp(c.energy + 1, 0, 100);
      hop(); hearts(5);
      setBubble(rnd(LINES.pet[id] || LINES.pet.oiji));
    } else if (kind === 'snack') {
      if (c.energy >= 98) { setBubble('배불러', 1.8); hop(); hearts(2); return; }
      c.energy = clamp(c.energy + 14, 0, 100);
      c.mood = clamp(c.mood + 6, 0, 100);
      state.chewing = 2.2;
      food(); hop();
      setBubble(rnd(LINES.snack[id] || LINES.snack.oiji));
    } else if (kind === 'cheer') {
      c.mood = clamp(c.mood + 14, 0, 100);
      c.energy = clamp(c.energy + 2, 0, 100);
      hop(); confetti(16); sparkles(6);
      setBubble(rnd(LINES.cheer[id] || LINES.cheer.oiji));
    } else if (kind === 'sleep') {
      if (st === 'working') { setBubble('아직 작업 중이야', 1.8); return; }
      if (c.sleeping) {
        c.sleeping = false;
        setBubble(rnd(LINES.wake[id] || LINES.wake.oiji));
      } else if (c.energy > 88) {
        setBubble('아직 안 졸려', 1.8); hop();
      } else {
        c.sleeping = true;
        setBubble(rnd(LINES.sleep[id] || LINES.sleep.oiji));
      }
    }
    persist();
    state.lastHud = 0;
    renderHud();
  }

  function focus(id) {
    if (!BOT_IDS.includes(id) || state.focus === id) {
      if (state.mode === 'focus') return;
    }
    state.focus = id;
    state.effects = [];
    setBubble(null);
    if (state.mode !== 'focus') setMode('focus');
    paintSelection();
    document.dispatchEvent(new CustomEvent('tama-focus', { detail: { id } }));
    state.lastHud = 0;
    renderHud();
  }

  function setMode(mode) {
    state.mode = mode === 'all' ? 'all' : 'focus';
    state.nodes.focus.hidden = state.mode !== 'focus';
    state.nodes.quad.hidden = state.mode !== 'all';
    document.querySelectorAll('.tama-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    state.effects = [];
    setBubble(null);
    state.lastHud = 0;
    renderHud();
    resize();
    document.dispatchEvent(new CustomEvent('tama-mode', { detail: { mode: state.mode } }));
  }

  /* ------------------------------------------------------- DOM 구성 */
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function defOf(id) {
    return state.defs.find((b) => b.id === id) || { id, name: id, role: '' };
  }

  function buildMeters() {
    const box = state.nodes.meters;
    box.innerHTML = '';
    const rows = [['cond', '컨디션'], ['energy', '에너지'], ['act', '활동']];
    for (const [key, label] of rows) {
      const row = el('div', 'tama-meter');
      row.innerHTML = `<span class="m-label">${label}</span><span class="m-track"></span><b class="m-val">-</b>`;
      const track = row.querySelector('.m-track');
      for (let i = 0; i < 10; i += 1) track.appendChild(el('i'));
      box.appendChild(row);
      state.meterEls[key] = { row, track, val: row.querySelector('.m-val'), segs: Array.from(track.children) };
    }
  }

  function buildSlots() {
    const box = state.nodes.slots;
    box.innerHTML = '';
    state.slotEls = {};
    for (const id of BOT_IDS) {
      const def = defOf(id);
      const btn = el('button', 'tama-slot');
      btn.type = 'button';
      btn.dataset.bot = id;
      btn.innerHTML = `
        <span class="tama-face" data-bot="${id}"></span>
        <span class="slot-meta">
          <span class="slot-name">${def.name}</span>
          <span class="slot-state"><i class="dot"></i><span class="slot-state-text">-</span></span>
        </span>`;
      btn.addEventListener('click', () => focus(id));
      box.appendChild(btn);
      state.slotEls[id] = {
        btn,
        dot: btn.querySelector('.dot'),
        text: btn.querySelector('.slot-state-text'),
        face: btn.querySelector('.tama-face')
      };
    }
  }

  function buildQuad() {
    const box = state.nodes.quad;
    box.innerHTML = '';
    state.cellEls = {};
    for (const id of BOT_IDS) {
      const def = defOf(id);
      const cell = el('button', 'tama-cell');
      cell.type = 'button';
      cell.dataset.bot = id;
      const stars = Array.from({ length: 7 }, (_, i) => {
        const left = 6 + Math.random() * 84;
        const top = 8 + Math.random() * 44;
        return `<i class="${i < 2 ? 'big' : ''}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%"></i>`;
      }).join('');
      cell.innerHTML = `
        <div class="cell-sky"><span class="cell-stars">${stars}</span></div>
        <div class="cell-ground"></div>
        <span class="cell-orb"></span>
        <span class="tama-face" data-bot="${id}"></span>
        <div class="cell-head">
          <span class="cell-name">${def.name}</span>
          <span class="pill">-</span>
        </div>
        <div class="cell-scrim"></div>
        <div class="cell-meters">
          <span class="cm"><b>컨디션</b><i class="cm-track"><u></u></i></span>
          <span class="cm"><b>에너지</b><i class="cm-track"><u></u></i></span>
        </div>`;
      cell.addEventListener('click', () => { focus(id); });
      box.appendChild(cell);
      state.cellEls[id] = {
        cell,
        face: cell.querySelector('.tama-face'),
        pill: cell.querySelector('.pill'),
        cond: cell.querySelectorAll('.cm-track u')[0],
        energy: cell.querySelectorAll('.cm-track u')[1]
      };
    }
  }

  function bindDom() {
    document.querySelectorAll('.tama-mode').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });
    document.querySelectorAll('#tamaControls .tama-btn').forEach((b) => {
      b.addEventListener('click', () => act(b.dataset.act));
    });
    state.canvas.addEventListener('pointerdown', (e) => {
      if (state.mode !== 'focus') return;
      const p = hit(e);
      if (p) { hop(); act('pet'); }
    });
    state.canvas.addEventListener('pointermove', (e) => {
      state.canvas.style.cursor = state.mode === 'focus' && hit(e) ? 'pointer' : 'default';
    });
  }

  function hit(e) {
    const rect = state.canvas.getBoundingClientRect();
    const v = state.view;
    const x = (e.clientX - rect.left) / v.s;
    const y = (e.clientY - rect.top) / v.s;
    const ground = groundY();
    const sp = spriteSize();
    return Math.abs(x - cxOf()) < sp * 0.7 && y > ground - sp && y < ground + 6;
  }

  /* ------------------------------------------------------- 렌더 */
  function resize() {
    if (!state.canvas || !state.screen) return;
    // 화면 전환 회전(transform) 중에 재면 찌그러진 크기가 잡혀 캐릭터가 안 보임 → transform 영향 없는 레이아웃 크기 사용
    const w = Math.max(1, Math.round(state.screen.offsetWidth || state.screen.getBoundingClientRect().width));
    const h = Math.max(1, Math.round(state.screen.offsetHeight || state.screen.getBoundingClientRect().height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    state.canvas.width = Math.round(w * dpr);
    state.canvas.height = Math.round(h * dpr);
    // 한 논리 픽셀이 정확히 정수 개의 장치 픽셀에 놓이도록 배율을 맞춘다 (윈도우 배율에서도 도트가 뭉개지지 않게)
    const dev = Math.max(1, Math.floor((w * dpr) / W));
    const s = dev / dpr;
    state.view = { w, h, s, lw: w / s, lh: h / s, dpr };
  }

  function cxOf() {
    return Math.round(state.view.lw / 2);
  }

  function groundY() {
    // 아래쪽 미니 게이지에 발이 가리지 않게 기존보다 살짝 위에 세운다
    return Math.round(state.view.lh - clamp(state.view.lh * 0.2, 20, 38));
  }

  function spriteSize() {
    const lh = state.view.lh;
    // 액정에 비해 너무 크지 않게 (장현님 피드백: 1.0.3은 너무 큼)
    if (lh > 210) return 80;
    if (lh > 92) return 52;
    return 32;
  }

  function starField() {
    const out = [];
    let seed = 7;
    for (let i = 0; i < 30; i += 1) {
      seed = (seed * 9301 + 49297) % 233280;
      const x = Math.round((seed / 233280) * 230);
      seed = (seed * 9301 + 49297) % 233280;
      const y = Math.round((seed / 233280) * 96);
      out.push({ x, y, p: (i % 5) / 5 });
    }
    return out;
  }
  const STARS = starField();

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  function lerpHex(a, b, t) {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function drawSky(ctx, now) {
    const ground = groundY();
    const day = state.theme === 'day';
    const top = day ? '#bfe3f2' : '#150f34';
    const mid = day ? '#d9f0f8' : '#241c52';
    const bot = day ? '#f0f9fc' : '#332a66';
    for (let y = 0; y < ground; y += 1) {
      const t = y / Math.max(1, ground);
      const color = t < 0.55 ? lerpHex(top, mid, t / 0.55) : lerpHex(mid, bot, (t - 0.55) / 0.45);
      px(ctx, 0, y, state.view.lw + 1, 1, color);
    }

    if (day) {
      // 해 — 도트 원 + 짧은 햇살
      const sx = Math.round(state.view.lw - 48), sy = 60;
      sunArt().forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] === '#') px(ctx, sx - 4 + rx, sy - 4 + ry, 1, 1, '#ffd168');
        }
      });
      px(ctx, sx - 2, sy - 3, 4, 2, '#fff0b8');
      for (const [dx, dy] of [[0, -7], [0, 7], [-7, 0], [7, 0]]) {
        px(ctx, sx + dx, sy + dy, dy === 0 ? 2 : 1, dx === 0 ? 2 : 1, '#ffd168');
      }
      for (const [dx, dy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        px(ctx, sx + dx, sy + dy, 1, 1, 'rgba(255,209,104,.55)');
      }
      // 구름
      for (let i = 0; i < 3; i += 1) {
        const scale = i === 1 ? 1 : 0.7;
        const cxl = ((i * 78 + now * (2.2 + i * 0.7)) % (state.view.lw + 90)) - 55;
        const cy = 18 + i * 21;
        cloudArt().forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx += 1) {
            if (row[rx] === '#') px(ctx, cxl + rx * scale, cy + ry * scale, scale, scale, '#ffffff');
          }
        });
        px(ctx, cxl + 2 * scale, cy + 6 * scale, 10 * scale, 2 * scale, 'rgba(206,232,245,.85)');
      }
    } else {
      for (const st of STARS) {
        if (st.y > ground - 12) continue;
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(now * 1.1 + st.p * 6.28));
        ctx.save();
        ctx.globalAlpha = 0.32 + tw * 0.62;
        px(ctx, st.x, st.y, 1, 1, '#fff8d8');
        if (st.p > 0.62) {
          px(ctx, st.x - 1, st.y, 3, 1, 'rgba(255,248,216,.55)');
          px(ctx, st.x, st.y - 1, 1, 3, 'rgba(255,248,216,.55)');
        }
        ctx.restore();
      }
      // 달
      const mx = Math.round(state.view.lw - 54), my = 56;
      ctx.save();
      for (let a = 0; a < 16; a += 1) {
        if (a % 2) continue;
        const ang = (a / 16) * Math.PI * 2;
        const hx = mx + 4 + Math.cos(ang) * 14;
        const hy = my + 5 + Math.sin(ang) * 14;
        ctx.globalAlpha = 0.3;
        px(ctx, hx, hy, 1, 1, '#fff2c2');
      }
      ctx.restore();
      moonArt().forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] === '#') px(ctx, mx + rx, my + ry, 1, 1, '#ffeeb0');
        }
      });
      px(ctx, mx + 1, my + 3, 2, 1, '#fff8d6');
      px(ctx, mx + 1, my + 6, 1, 2, '#fff8d6');
      px(ctx, mx + 3, my + 1, 1, 1, '#fff8d6');
    }
  }

  const ART = {
    moon: [
      '....##...',
      '..####...',
      '.####....',
      '####.....',
      '###......',
      '###......',
      '####.....',
      '.####....',
      '..####...',
      '....##...'
    ],
    sun: [
      '...###...',
      '..#####..',
      '.#######.',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
      '...###...'
    ],
    cloud: [
      '....####......',
      '..########....',
      '.##########...',
      '############..',
      '##############',
      '.############.',
      '..###..###....'
    ]
  };
  const moonArt = () => ART.moon;
  const sunArt = () => ART.sun;
  const cloudArt = () => ART.cloud; 

  function drawHouse(ctx, baseY) {
    const day = state.theme === 'day';
    const x = Math.round(cxOf() + 50);
    const w = 18;
    const h = 10;
    // 지붕 — 아래로 갈수록 넓어지는 계단 지붕
    for (let i = 0; i < 6; i += 1) {
      px(ctx, x - 4 + i, baseY - h - 6 + i, w + 8 - i * 2, 1, day ? '#cf7358' : '#5c4e8c');
    }
    px(ctx, x - 4, baseY - h, w + 8, 1, day ? '#b85f46' : '#4d4179');
    // 몸체
    px(ctx, x, baseY - h, w, h, day ? '#f0e4d2' : '#443c68');
    px(ctx, x, baseY - h, w, 1, day ? '#faf1e2' : '#4d4573');
    // 창문 (밤에는 불이 켜짐)
    px(ctx, x + 3, baseY - 7, 3, 3, day ? '#9fc6e6' : '#ffd479');
    if (!day) px(ctx, x + 3, baseY - 6, 3, 1, '#ffe9ad');
    // 문
    px(ctx, x + 11, baseY - 5, 3, 5, day ? '#9c6650' : '#2c2649');
    // 굴뚝
    px(ctx, x + 12, baseY - h - 4, 2, 4, day ? '#c26a52' : '#4a416f');
  }

  function drawGround(ctx) {
    const lh = state.view.lh;
    const ground = groundY();
    const day = state.theme === 'day';
    const lw = state.view.lw;
    px(ctx, 0, ground, lw + 1, lh - ground, day ? '#a9d07c' : '#3d3669');
    px(ctx, 0, ground, lw + 1, 2, day ? '#bde08e' : '#4b4380');
    px(ctx, 0, ground + 10, lw + 1, lh - ground - 10, day ? '#9cc46f' : '#352f5e');
    for (let i = 0; i < 34; i += 1) {
      const x = (i * 41 + 13) % Math.max(1, lw);
      const y = ground + 4 + ((i * 17) % Math.max(6, Math.round(lh - ground - 8)));
      px(ctx, x, y, 1, 1, day ? 'rgba(80,110,50,.35)' : 'rgba(160,150,220,.22)');
    }
    // 바닥 풀
    for (let i = 0; i < 10; i += 1) {
      const x = (i * 29 + 7) % Math.max(1, lw);
      px(ctx, x, ground - 2, 1, 2, day ? '#8fbb60' : '#4f4788');
    }
    drawHouse(ctx, ground + 1);
  }

  function spriteImg(id) {
    return state.images && state.images[id];
  }

  // 새 시트(512×640, 128칸 4열 × 5행: 대기/감정/작업/잠/걷기)와 예전 32px 한 줄 시트를 모두 읽는다.
  const GRID_ROWS = { idle: 0, emotion: 1, work: 2, sleep: 3, walk: 4 };
  const GRID_CELL = 128;
  function isGrid(img) { return !!img && img.height >= 256; }
  function cellOf(img, anim, step) {
    if (isGrid(img)) {
      // 감정 줄만 8칸까지 쓸 수 있고, 대기·작업·잠·걷기는 4칸 (시트가 8열이어도 앞 4칸만)
      const all = Math.max(1, Math.floor(img.width / GRID_CELL));
      const cols = anim === 'emotion' ? all : Math.min(4, all);
      const row = GRID_ROWS[anim] !== undefined ? GRID_ROWS[anim] : 0;
      return { sx: (step % cols) * GRID_CELL, sy: row * GRID_CELL, s: GRID_CELL, grid: true };
    }
    const frames = ATLAS[anim] || ATLAS.idle;
    return { sx: frames[step % frames.length] * 32, sy: 0, s: 32, grid: false };
  }

  const HEART_ART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  const Z_ART = ['#####', '...#.', '..#..', '.#...', '#####'];

  function drawArt(ctx, art, x, y, scale, color) {
    const sc = Math.max(1, Math.round(scale));
    for (let ry = 0; ry < art.length; ry += 1) {
      const row = art[ry];
      for (let rx = 0; rx < row.length; rx += 1) {
        if (row[rx] === '#') px(ctx, x + rx * sc, y + ry * sc, sc, sc, color);
      }
    }
  }

  function drawCharacter(ctx, now, dt) {
    const id = state.focus;
    const img = spriteImg(id);
    const look = lookOf(id);
    const g = geom();
    const sp = g.sp;
    const feet = g.feet;
    const step = Math.floor(now * (look === 'work' ? 10 : 2.4));

    let anim = 'idle';
    if (look === 'work') anim = 'work';
    else if (look === 'sleep' || look === 'offline') anim = 'sleep';
    const cell = cellOf(img, anim, step);
    const grid = cell.grid;

    const bob = look === 'idle' ? Math.round(Math.sin(now * 2.2)) : 0;
    if (state.hop.t < state.hop.dur) state.hop.t += dt;
    const hp = clamp(state.hop.t / state.hop.dur, 0, 1);
    const hopY = -Math.round(Math.sin(hp * Math.PI) * 14);

    const cx = g.cx;
    const y = feet - sp + bob + hopY;

    // 그림자
    ctx.save();
    ctx.globalAlpha = 0.22;
    const shCol = state.theme === 'day' ? '#3c4a2c' : '#0d0a1c';
    const rx = Math.round(sp * 0.3);
    const ry = Math.max(2, Math.round(sp * 0.07));
    for (let dy = -ry; dy <= ry; dy += 1) {
      const t = 1 - (dy * dy) / (ry * ry);
      const w = Math.round(rx * Math.sqrt(Math.max(0, t)));
      px(ctx, cx - w, feet + dy - 1, w * 2, 1, shCol);
    }
    ctx.restore();

    // 작업 중 — 작은 키보드 (새 시트는 작업 동작이 그림에 있으니 키보드는 예전 시트에만)
    if (look === 'work' && !grid) {
      const kw = Math.round(sp * 0.5);
      const kx = Math.round(cx - kw / 2);
      const ky = feet - 6;
      px(ctx, kx, ky, kw, 5, state.theme === 'day' ? '#4a4470' : '#3b3560');
      px(ctx, kx, ky, kw, 1, state.theme === 'day' ? '#6f68a2' : '#5b5388');
      for (let r = 0; r < 2; r += 1) {
        for (let i = 0; i < Math.floor(kw / 3); i += 1) {
          const on = ((i + r) % 3 === 0) ? 'rgba(255,214,140,.85)' : 'rgba(190,184,230,.75)';
          px(ctx, kx + 2 + i * 3, ky + 2 + r * 2, 2, 1, on);
        }
      }
      if (!state.lastSweat || now - state.lastSweat > 0.85) { state.lastSweat = now; sweatOnce(); }
      if (!state.lastSpark || now - state.lastSpark > 1.6) { state.lastSpark = now; sparkles(1); }
    }

    if (img) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (look === 'offline') ctx.globalAlpha = 0.66;
      if (state.chewing > 0 && Math.random() < 0.55) {
        ctx.translate(0, Math.random() < 0.5 ? -1 : 0);
      }
      ctx.drawImage(img, cell.sx, cell.sy, cell.s, cell.s, Math.round(cx - sp / 2), Math.round(y), sp, sp);
      ctx.restore();
    }

    // 잠자는 모습 — 이불 덮기 (새 시트는 잠 동작·Z가 그림에 있음)
    if ((look === 'sleep' || look === 'offline') && !grid) {
      const day = state.theme === 'day';
      const bw = Math.round(sp * 0.74);
      const bh = Math.round(sp * 0.26);
      const bx = Math.round(cx - bw / 2);
      const by = feet - bh;
      const body = day ? '#8d98d8' : '#57609f';
      const fold = day ? '#b4bfef' : '#7a83c6';
      const line = day ? '#7b86c8' : '#4b538f';
      // 이불
      px(ctx, bx, by, bw, bh, body);
      px(ctx, bx, by, bw, 3, fold);
      for (let i = 0; i < Math.floor(bw / 6); i += 1) {
        px(ctx, bx + 3 + i * 6, by + 4, 1, bh - 5, line);
      }
      for (let i = 0; i < Math.floor(bw / 4); i += 1) {
        px(ctx, bx + 2 + i * 4, by - 1, 2, 1, fold);
      }
      px(ctx, bx, by + bh - 1, bw, 1, line);
      px(ctx, bx, by, 1, bh, line);
      px(ctx, bx + bw - 1, by, 1, bh, line);
    }

    // Zzz
    if ((look === 'sleep' || look === 'offline') && !grid) {
      const ph = (now * 0.42) % 1;
      const c = state.theme === 'day' ? '#5a6bb0' : '#d5d9ff';
      for (let k = 0; k < 3; k += 1) {
        const kp = (ph + k * 0.33) % 1;
        const zx = cx + sp * 0.3 + k * 4 + kp * 3;
        const zy = y + sp * 0.2 - kp * (sp * 0.4) + k * 3;
        ctx.save();
        ctx.globalAlpha = 0.85 * (1 - kp);
        drawArt(ctx, Z_ART, Math.round(zx), Math.round(zy), k === 1 ? 2 : 1, c);
        ctx.restore();
      }
    }
    return { cx, feet, sp, top: y };
  }

  function drawEffects(ctx, now, dt) {
    const list = state.effects;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const e = list[i];
      if (e.type === 'heart') {
        e.life -= dt * 0.62;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        ctx.save();
        ctx.globalAlpha = clamp(e.life, 0, 1);
        drawArt(ctx, HEART_ART, Math.round(e.x), Math.round(e.y), e.size, '#ff7a8f');
        drawArt(ctx, HEART_ART, Math.round(e.x) - 1, Math.round(e.y) - 1, e.size, 'rgba(255,190,200,.75)');
        drawArt(ctx, HEART_ART, Math.round(e.x), Math.round(e.y), e.size, '#ff6f86');
        ctx.restore();
      } else if (e.type === 'spark') {
        e.life -= dt * 1.05;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        ctx.save();
        ctx.globalAlpha = clamp(e.life, 0, 1);
        const c = e.life > 0.55 ? '#ffe08a' : '#fff6d8';
        px(ctx, e.x, e.y, 1, 3, c);
        px(ctx, e.x - 1, e.y + 1, 3, 1, c);
        ctx.restore();
      } else if (e.type === 'confetti') {
        e.life -= dt * 0.42;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        ctx.save();
        ctx.globalAlpha = clamp(e.life, 0, 1);
        px(ctx, e.x, e.y, 2, 2, e.color);
        ctx.restore();
      } else if (e.type === 'food') {
        if (e.t < 1) {
          e.t = Math.min(1, e.t + dt / 0.5);
          const y = e.y0 + (e.y1 - e.y0) * (e.t * e.t);
          px(ctx, e.x - 4, y, 8, 5, '#e8c98a');
          px(ctx, e.x - 4, y, 8, 1, '#f8e8bd');
          px(ctx, e.x - 2, y + 2, 4, 2, '#c99f63');
        } else {
          e.life -= dt * 0.9;
          if (e.life > 0.25) {
            px(ctx, e.x - 4, e.y1 - 5, 8, 5, '#e8c98a');
            px(ctx, e.x - 4, e.y1 - 5, 8, 1, '#f8e8bd');
            px(ctx, e.x - 2, e.y1 - 3, 4, 2, '#c99f63');
          }
        }
      } else if (e.type === 'sweat') {
        e.life -= dt * 0.55;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        ctx.save();
        ctx.globalAlpha = clamp(e.life, 0, 1) * 0.95;
        px(ctx, e.x, e.y, 2, 2, '#8fe1ff');
        px(ctx, e.x + 0.5, e.y + 2, 1, 1, '#c9f2ff');
        ctx.restore();
      }
      if (e.life <= 0) list.splice(i, 1);
    }
  }

  function draw(now, dt) {
    const ctx = state.ctx;
    const v = state.view;
    if (!ctx) return;
    ctx.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, v.lw, v.lh);
    drawSky(ctx, now);
    drawGround(ctx);
    drawCharacter(ctx, now, dt);
    drawEffects(ctx, now, dt);
  }

  /* ------------------------------------------------------- HUD */
  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const min = Math.floor(Math.max(0, Date.now() - ts) / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    return `${Math.floor(hr / 24)}일 전`;
  }

  function levelCls(v) {
    return v >= 60 ? 'lv-ok' : v >= 30 ? 'lv-warn' : 'lv-low';
  }

  function paintMeter(key, value) {
    const m = state.meterEls[key];
    if (!m) return;
    const on = Math.round(clamp(value, 0, 100) / 10);
    m.segs.forEach((seg, i) => { seg.className = i < on ? 'on' : ''; });
    m.track.className = `m-track ${levelCls(value)}`;
    m.val.textContent = `${Math.round(value)}%`;
  }

  function paintFace(node, id, look, size) {
    if (!node) return;
    const anim = look === 'work' ? 'work' : look === 'sleep' || look === 'offline' ? 'sleep' : 'idle';
    const speed = look === 'work' ? 0.16 : 0.42;
    const step = Math.floor(performance.now() / 1000 / speed);
    const img = spriteImg(id);
    const cell = cellOf(img, anim, step);
    node.style.backgroundImage = `url('../assets/sprites/${id}.png')`;
    if (cell.grid) {
      const k = size / cell.s;
      node.style.backgroundSize = `${img.width * k}px ${img.height * k}px`;
      node.style.backgroundPosition = `${-cell.sx * k}px ${-cell.sy * k}px`;
    } else {
      node.style.backgroundSize = `${size * 11}px ${size}px`;
      node.style.backgroundPosition = `${-(cell.sx / 32) * size}px 0`;
    }
  }

  function paintSelection() {
    for (const id of BOT_IDS) {
      const s = state.slotEls[id];
      if (!s) continue;
      s.btn.classList.toggle('on', id === state.focus);
      s.btn.classList.toggle('is-working', botState(id) === 'working');
      s.btn.classList.toggle('is-offline', botState(id) === 'offline');
    }
  }

  function renderHud() {
    if (!state.nodes.name) return;
    const id = state.focus;
    const def = defOf(id);
    const b = state.bots[id] || {};
    const st = botState(id);
    const look = lookOf(id);
    const m = metrics(id);

    state.nodes.name.textContent = def.name;
    state.nodes.role.textContent = def.role || '';
    const stText = look === 'sleep' && st !== 'offline' ? '자는 중' : STATE_TEXT[st] || '쉬는 중';
    state.nodes.state.textContent = stText;
    state.nodes.state.className = `tama-state ${look === 'sleep' ? 'sleeping' : st}`;

    const bits = [];
    const ago = timeAgo(b.lastActivity);
    if (ago) bits.push(`마지막 활동 ${ago}`);
    else bits.push('기록 없음');
    if (m.tokens) bits.push(`오늘 ${fmtTokens(m.tokens)} 토큰`);
    if (look === 'work' && b.note) bits.push(b.note);
    else if (look !== 'work' && b.note && b.note.length < 22) bits.push(b.note);
    state.nodes.meta.textContent = bits.join(' · ');

    paintMeter('cond', m.cond);
    paintMeter('energy', m.energy);
    paintMeter('act', m.act);

    for (const bid of BOT_IDS) {
      const s = state.slotEls[bid];
      if (!s) continue;
      const bst = botState(bid);
      const blook = lookOf(bid);
      s.text.textContent = blook === 'sleep' && bst !== 'offline' ? '자는 중' : STATE_TEXT[bst] || '쉬는 중';
      s.dot.className = `dot ${blook === 'sleep' ? 'sleeping' : bst}`;
      paintFace(s.face, bid, blook, 34);
      const cell = state.cellEls[bid];
      if (cell) {
        const cm = metrics(bid);
        cell.pill.textContent = blook === 'sleep' && bst !== 'offline' ? '자는 중' : STATE_TEXT[bst] || '쉬는 중';
        cell.pill.className = `pill ${blook === 'sleep' ? 'idle' : bst}`;
        cell.cond.style.width = `${cm.cond}%`;
        cell.cond.className = levelCls(cm.cond);
        cell.energy.style.width = `${cm.energy}%`;
        cell.energy.className = levelCls(cm.energy);
        cell.cell.classList.toggle('on', bid === state.focus);
        cell.cell.classList.toggle('is-working', bst === 'working');
        cell.cell.classList.toggle('is-sleeping', blook === 'sleep' || blook === 'offline');
        paintFace(cell.face, bid, blook, 96);
      }
    }
    paintSelection();

    // 잠자기 버튼 문구
    const sleepBtn = document.querySelector('#tamaControls .tama-btn[data-act="sleep"] .tama-btn-label');
    const c = careOf(id);
    if (sleepBtn) sleepBtn.textContent = c.sleeping ? '깨우기' : '재우기';
    const sleepWrap = document.querySelector('#tamaControls .tama-btn[data-act="sleep"]');
    if (sleepWrap) {
      sleepWrap.disabled = st === 'working';
      sleepWrap.title = st === 'working' ? '작업이 끝나면 재울 수 있어요' : '';
    }

    // 말풍선
    const bubble = state.nodes.bubble;
    if (!bubble) return;
    let text = state.bubble;
    const expired = state.bubbleUntil && performance.now() > state.bubbleUntil;
    if (expired) { state.bubble = null; text = null; }
    if (!text) {
      if (look === 'work') text = b.note && b.note.length < 20 ? b.note : '작업 중…';
      else if (look === 'sleep') text = '쿨쿨…';
      else if (look === 'offline') text = '자고 있어…';
      else if (performance.now() > state.nextNag && m.energy < 25) {
        text = rnd(LINES.hungry);
        state.nextNag = performance.now() + 50000;
        state.bubbleUntil = performance.now() + 2600;
      }
    }
    if (!text) { bubble.hidden = true; return; }
    bubble.hidden = false;
    bubble.textContent = text;
    const v = state.view;
    const sp = spriteSize();
    const ground = groundY();
    const top = (ground - sp * 0.88) * v.s - 10;
    bubble.style.left = `${cxOf() * v.s}px`;
    bubble.style.top = `${Math.max(36, top)}px`;
    bubble.className = `tama-bubble${look === 'work' ? ' work' : ''}${look === 'sleep' || look === 'offline' ? ' off' : ''}`;
  }

  /* ------------------------------------------------------- 루프 */
  function loop(now) {
    const dt = Math.min(0.08, Math.max(0, (now - state.last) / 1000));
    state.last = now;
    if (state.chewing > 0) state.chewing = Math.max(0, state.chewing - dt);
    tickCare(dt);
    if (state.visible && state.mode === 'focus') draw(now / 1000, dt);
    if (now - state.lastHud > HUD_TICK) {
      state.lastHud = now;
      renderHud();
    }
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------- 공개 API */
  async function init(opts) {
    state.canvas = opts.canvas;
    state.ctx = state.canvas.getContext('2d');
    state.screen = opts.screen;
    state.defs = opts.botDefs || [];
    state.bots = opts.bots || {};
    state.theme = opts.theme === 'day' ? 'day' : 'night';
    state.focus = opts.focus || 'oiji';

    state.nodes = {
      name: document.getElementById('tamaName'),
      role: document.getElementById('tamaRole'),
      state: document.getElementById('tamaState'),
      meta: document.getElementById('tamaMeta'),
      bubble: document.getElementById('tamaBubble'),
      meters: document.getElementById('tamaMeters'),
      slots: document.getElementById('tamaSlots'),
      quad: document.getElementById('tamaQuad'),
      focus: document.getElementById('tamaFocus')
    };

    state.images = {};
    await Promise.all(BOT_IDS.map((id) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { state.images[id] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = `../assets/sprites/${id}.png`;
    })));

    loadCare();
    buildMeters();
    buildSlots();
    buildQuad();
    bindDom();
    resize();
    if (window.ResizeObserver) {
      state.ro = new ResizeObserver(() => resize());
      state.ro.observe(state.screen);
    }
    document.querySelectorAll('.tama-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'focus'));
    state.nodes.quad.hidden = true;
    state.last = performance.now();
    renderHud();
    requestAnimationFrame(loop);
    return true;
  }

  function setBots(bots) {
    state.bots = bots || {};
    state.lastHud = 0;
  }

  function setTheme(theme) {
    state.theme = theme === 'day' ? 'day' : 'night';
  }

  function setVisible(v) {
    state.visible = !!v;
    if (v) { state.lastHud = 0; resize(); }
  }

  function anchorOf(id) {
    if (state.mode === 'all' && state.cellEls && state.cellEls[id]) {
      const r = state.cellEls[id].cell.getBoundingClientRect();
      if (r.width) return { x: r.left + r.width / 2, y: r.top + 30 };
    }
    const scr = state.screen && state.screen.getBoundingClientRect();
    if (state.mode === 'focus' && scr && scr.width) {
      return { x: scr.left + scr.width / 2, y: scr.top + scr.height * 0.42 };
    }
    const slot = state.slotEls[id];
    if (!slot) return null;
    const r = slot.btn.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top };
  }

  function focusId() { return state.focus; }

  window.Tama = { init, setBots, setTheme, setVisible, anchorOf, focus, act, setMode, focusId };
})();
