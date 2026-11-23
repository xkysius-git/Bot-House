/* Bot House — 픽셀 하우스 캔버스 엔진 */
(function () {
  'use strict';

  const LW = 480;
  const LH = 270;
  const FRAME = 32;
  const DESK_LINE = 196; // 이 위쪽 캐릭터는 책상 뒤(가려짐), 아래쪽은 앞
  const ATLAS = { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7, 8, 9], sleep: [10] };

  const LOUNGE = [
    { x: 52, y: 246 }, { x: 92, y: 232 }, { x: 128, y: 252 }, { x: 168, y: 240 },
    { x: 190, y: 224 }, { x: 60, y: 220 }, { x: 150, y: 228 }, { x: 118, y: 214 },
    { x: 30, y: 238 }, { x: 200, y: 250 }, { x: 172, y: 214 }
  ];
  const AISLE = { x: 236, y: 226 };

  const state = {
    canvas: null,
    ctx: null,
    scene: null,
    bubblesEl: null,
    onSelect: null,
    images: {},
    theme: 'night',
    actors: new Map(),
    botStates: {},
    selected: null,
    view: { w: 0, h: 0, scale: 1, ox: 0, oy: 0, dpr: 1 },
    raf: null,
    lastT: 0,
    bubbleEls: new Map(),
    sparkles: []
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function init(opts) {
    state.canvas = opts.canvas;
    state.ctx = state.canvas.getContext('2d');
    state.scene = opts.scene;
    state.bubblesEl = opts.bubbles;
    state.onSelect = opts.onSelect;
    state.botStates = opts.bots || {};

    const [night, nightFg, day, dayFg, ...sprites] = await Promise.all([
      loadImage('../assets/room_night.png'),
      loadImage('../assets/room_night_fg.png'),
      loadImage('../assets/room_day.png'),
      loadImage('../assets/room_day_fg.png'),
      ...['oiji', 'takuan', 'sbji', 'claude'].map((id) => loadImage(`../assets/sprites/${id}.png`))
    ]);
    state.images = { night, nightFg, day, dayFg };
    ['oiji', 'takuan', 'sbji', 'claude'].forEach((id, i) => { state.images[id] = sprites[i]; });

    for (const bot of opts.botDefs) {
      state.actors.set(bot.id, {
        def: bot,
        x: bot.home.x,
        y: bot.home.y,
        mode: 'rest',
        anim: 'idle',
        frame: 0,
        frameT: 0,
        queue: [],
        restUntil: performance.now() + Math.random() * 4000,
        speed: 22,
        facing: 1
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
    const rect = state.scene.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    state.canvas.width = Math.floor(w * dpr);
    state.canvas.height = Math.floor(h * dpr);
    const scale = Math.min(w / LW, h / LH);
    state.view = {
      w, h, dpr, scale,
      ox: (w - LW * scale) / 2,
      oy: (h - LH * scale) / 2
    };
  }

  function setTheme(theme) {
    state.theme = theme === 'day' ? 'day' : 'night';
  }

  function setBots(bots) {
    state.botStates = bots || {};
  }

  function setSelected(id) {
    state.selected = id;
  }

  /* ------------------------------------------------------------ 이동 로직 */
  function pickWaypoint(actor) {
    let pick = LOUNGE[Math.floor(Math.random() * LOUNGE.length)];
    let tries = 0;
    while (Math.hypot(pick.x - actor.x, pick.y - actor.y) < 46 && tries < 8) {
      pick = LOUNGE[Math.floor(Math.random() * LOUNGE.length)];
      tries += 1;
    }
    return pick;
  }

  function sendToSeat(actor) {
    const seat = actor.def.seat;
    actor.queue = [{ x: AISLE.x, y: AISLE.y }, { x: seat.x, y: seat.y }];
    actor.mode = 'toSeat';
    actor.anim = 'walk';
    actor.speed = 34;
  }

  function sendHome(actor) {
    const home = actor.def.home;
    actor.queue = [{ x: AISLE.x - 6, y: 232 }, { x: home.x, y: home.y }];
    actor.mode = 'toSeat';
    actor.anim = 'walk';
    actor.speed = 30;
  }

  function stepActor(actor, dt, now, botState) {
    const working = botState && botState.state === 'working';
    const offline = botState && botState.state === 'offline';

    if (working && actor.mode !== 'toSeat' && actor.mode !== 'seat') sendToSeat(actor);
    if (!working && (actor.mode === 'seat' || actor.mode === 'toSeat') && actor.queue.length === 0) {
      actor.mode = 'rest';
      actor.restUntil = now + 400 + Math.random() * 900;
      actor.queue = [];
      if (actor.mode === 'rest' && actor.y < 200) {
        actor.queue = [{ x: AISLE.x, y: 226 }];
        actor.mode = 'toSeat';
      }
    }

    if (actor.mode === 'toSeat') {
      actor.speed = 34;
      if (!actor.queue.length) {
        actor.mode = 'seat';
      } else {
        const target = actor.queue[0];
        const dx = target.x - actor.x;
        const dy = target.y - actor.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          actor.x = target.x;
          actor.y = target.y;
          actor.queue.shift();
          if (!actor.queue.length) actor.mode = 'seat';
        } else {
          const step = Math.min(dist, actor.speed * dt);
          actor.x += (dx / dist) * step;
          actor.y += (dy / dist) * step;
          actor.facing = dx >= 0 ? 1 : -1;
          actor.anim = 'walk';
        }
      }
    } else if (actor.mode === 'seat') {
      actor.anim = working ? 'work' : (offline ? 'sleep' : 'idle');
    } else {
      if (actor.mode === 'rest' && now > actor.restUntil) {
        const wp = pickWaypoint(actor);
        actor.queue = [wp];
        actor.mode = 'wander';
        actor.speed = 20 + Math.random() * 8;
      }
      if (actor.mode === 'wander') {
        const target = actor.queue[0];
        if (!target) {
          actor.mode = 'rest';
          actor.restUntil = now + 1500 + Math.random() * 3500;
        } else {
          const dx = target.x - actor.x;
          const dy = target.y - actor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2) {
            actor.queue = [];
            actor.mode = 'rest';
            actor.anim = 'idle';
            actor.restUntil = now + 1800 + Math.random() * 4200;
          } else {
            const step = Math.min(dist, actor.speed * dt);
            actor.x += (dx / dist) * step;
            actor.y += (dy / dist) * step;
            actor.facing = dx >= 0 ? 1 : -1;
            actor.anim = 'walk';
          }
        }
      } else if (actor.mode === 'rest') {
        actor.anim = offline ? 'sleep' : 'idle';
      }
    }
  }

  /* ------------------------------------------------------------ 그리기 */
  function spriteFrame(botId, anim, frame) {
    const img = state.images[botId];
    if (!img) return null;
    const frames = ATLAS[anim] || ATLAS.idle;
    const idx = frames[frame % frames.length];
    return { img, sx: idx * FRAME, sy: 0, sw: FRAME, sh: FRAME };
  }

  function drawActor(actor, now) {
    const ctx = state.ctx;
    const botState = state.botStates[actor.def.id] || {};
    const sp = spriteFrame(actor.def.id, actor.anim, actor.frame);
    const x = Math.round(actor.x);
    const y = Math.round(actor.y);

    // 발밑 그림자
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#0a0714';
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 11, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (actor.def.id === state.selected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 122, 89, .85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y - 1, 14, 4.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!sp) return;
    ctx.drawImage(sp.img, sp.sx, sp.sy, sp.sw, sp.sh, x - FRAME / 2, y - FRAME + 2, FRAME, FRAME);

    if (botState.state === 'offline') {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#131020';
      ctx.drawImage(sp.img, sp.sx, sp.sy, sp.sw, sp.sh, x - FRAME / 2, y - FRAME + 2, FRAME, FRAME);
      ctx.restore();
    }

    // 작업 중 반짝임
    if (botState.state === 'working' && Math.random() < 0.06) {
      state.sparkles.push({ x: x + (Math.random() * 16 - 8), y: y - 24 - Math.random() * 4, life: 1, color: '#ffd18a' });
    }
  }

  function drawSparkles(dt) {
    const ctx = state.ctx;
    state.sparkles = state.sparkles.filter((s) => s.life > 0);
    for (const s of state.sparkles) {
      s.life -= dt * 1.6;
      s.y -= dt * 12;
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life) * 0.9;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
      ctx.restore();
    }
  }

  function drawMonitorGlow(now) {
    const ctx = state.ctx;
    if (state.theme !== 'night') return;
    const seats = ['oiji', 'takuan', 'sbji', 'claude'];
    for (const id of seats) {
      const bs = state.botStates[id] || {};
      if (bs.state !== 'working') continue;
      const actor = state.actors.get(id);
      if (!actor) continue;
      const flicker = 0.06 + Math.sin(now / 180 + actor.x) * 0.02;
      ctx.save();
      ctx.globalAlpha = flicker;
      ctx.fillStyle = '#8ef2e2';
      ctx.fillRect(actor.x - 30, 138, 60, 38);
      ctx.restore();
    }
  }

  function render(now, dt) {
    const ctx = state.ctx;
    const v = state.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0913';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

    const k = v.dpr * v.scale;
    ctx.setTransform(k, 0, 0, k, v.dpr * v.ox, v.dpr * v.oy);
    ctx.imageSmoothingEnabled = false;

    const bg = state.images[state.theme === 'day' ? 'day' : 'night'];
    const fg = state.images[state.theme === 'day' ? 'dayFg' : 'nightFg'];
    if (bg) {
      // 화면 비율이 16:9가 아니어도 방이 이어지도록 벽/바닥을 늘려 그린다
      const extraY = Math.max(0, (v.h - LH * v.scale) / 2) / v.scale;
      const extraX = Math.max(0, (v.w - LW * v.scale) / 2) / v.scale;
      if (extraY > 0) {
        ctx.drawImage(bg, 0, 1, LW, 1, 0, -extraY - 1, LW, extraY + 1.5);
        ctx.drawImage(bg, 0, LH - 2, LW, 1, 0, LH, LW, extraY + 1.5);
      }
      if (extraX > 0) {
        ctx.drawImage(bg, 1, 0, 1, LH, -extraX - 1, 0, extraX + 1.5, LH);
        ctx.drawImage(bg, LW - 2, 0, 1, LH, LW, 0, extraX + 1.5, LH);
      }
      ctx.drawImage(bg, 0, 0, LW, LH);
    }

    const actors = Array.from(state.actors.values());
    actors.sort((a, b) => a.y - b.y);
    const behind = actors.filter((a) => a.y < DESK_LINE);
    const front = actors.filter((a) => a.y >= DESK_LINE);

    for (const actor of behind) drawActor(actor, now);
    drawMonitorGlow(now);
    if (fg) ctx.drawImage(fg, 0, 0, LW, LH);
    for (const actor of front) drawActor(actor, now);
    drawSparkles(dt);
  }

  /* ------------------------------------------------------------ 버블 */
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
      if (working) text = bs.note && bs.note.length < 18 ? bs.note : '작업 중…';
      else if (offline) text = '자고 있어…';
      else if (selected) text = actor.def.name;
      if (!text) {
        el.hidden = true;
        continue;
      }
      const p = toScreen(actor.x, actor.y - 30);
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
    for (const actor of state.actors.values()) {
      const bs = state.botStates[actor.def.id] || {};
      stepActor(actor, dt, now, bs);
      const speeds = { walk: 8, idle: 2, work: 6, sleep: 1 };
      const fps = speeds[actor.anim] || 2;
      actor.frameT += dt;
      if (actor.frameT >= 1 / fps) {
        actor.frameT = 0;
        actor.frame = (actor.frame + 1) % 12;
      }
    }
    render(now, dt);
    updateBubbles();
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
      if (dx < 15 && dy > -34 && dy < 6) {
        const d = Math.hypot(dx, dy);
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
    const p = toScreen(actor.x, actor.y - 26);
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  window.House = { init, setBots, setTheme, setSelected, anchorOf };
})();
