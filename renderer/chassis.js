/* Bot House — 디지바이스 섀시(SVG 벡터) 생성기
   창 크기(580×450 ↔ 940×450)에 맞춰 실루엣·링 베젤·범퍼·윙·안테나를 베지어로 다시 깎는다.
   바깥 네 모서리는 완전 투명: 몸통 실루엣 밖은 아무것도 칠하지 않는다. */
(function () {
  'use strict';

  const stage = document.getElementById('stage');
  const base = document.getElementById('chassisBase');
  const ring = document.getElementById('chassisRing');
  if (!stage || !base || !ring) return;

  const NS = 'http://www.w3.org/2000/svg';
  const R2 = (n) => Math.round(n * 100) / 100;
  const pt = (x, y) => `${R2(x)} ${R2(y)}`;

  /* ---------------------------------------------------------------- 기하 */
  function geom(W, H) {
    const w2 = W / 2, cy = H / 2;
    const ringHh = Math.min(178, cy - 18);
    const ringHw = Math.max(ringHh + 4, w2 - 100);
    const band = 20;
    return {
      W, H, w2, cy, ringHh, ringHw, band,
      innerHw: ringHw - band, innerHh: ringHh - band,
      earRx: 70, earRy: 118, earX: 76,   // 윙(귀) 타원
      padX: 76, padR: 64,                // D-패드 중심 반지름
      abX: W - 76,                       // A · B · C 중심 x
      topY: cy - 196, botY: cy + 196
    };
  }

  /* 몸통 실루엣 — 오른쪽 반을 짓고 왼쪽은 좌우 대칭으로 미러링 */
  function bodyPath(g) {
    const { w2, cy, W } = g;
    const top = g.topY, bot = g.botY;
    const ex = W - g.earX;             // 오른쪽 귀 중심
    const rx = g.earRx, ry = g.earRy;
    const K = 0.5523;
    const segs = [];
    const add = (...v) => segs.push(v);
    // 윗면
    add(w2 + 76, top - 3, w2 + 114, top + 2, w2 + 142, top + 9);
    // 사선 어깨
    add(w2 + 170, top + 18, w2 + 188, top + 48, w2 + 198, cy - 142);
    // 어깨 → 윙(귀) 위
    add(w2 + 208, cy - 134, ex - 16, cy - ry - 6, ex, cy - ry);
    // 귀 위쪽 사분원
    add(ex + rx * K, cy - ry, ex + rx, cy - ry * K, ex + rx, cy);
    // 귀 아래쪽 사분원
    add(ex + rx, cy + ry * K, ex + rx * K, cy + ry, ex, cy + ry);
    // 귀 → 아래 어깨
    add(ex - 16, cy + ry + 6, w2 + 208, cy + 134, w2 + 198, cy + 142);
    // 사선 아래 어깨 → 아랫면
    add(w2 + 188, bot - 48, w2 + 170, bot - 18, w2 + 142, bot - 9);
    add(w2 + 114, bot - 2, w2 + 76, bot + 3, w2, bot);

    let d = `M ${pt(w2, top)}`;
    for (const s of segs) d += ` C ${pt(s[0], s[1])} ${pt(s[2], s[3])} ${pt(s[4], s[5])}`;
    // 거울 반대편 (아래 → 위)
    for (let i = segs.length - 1; i >= 0; i -= 1) {
      const s = segs[i];
      const prev = i === 0 ? [w2, top] : [segs[i - 1][4], segs[i - 1][5]];
      d += ` C ${pt(2 * w2 - s[2], s[3])} ${pt(2 * w2 - s[0], s[1])} ${pt(2 * w2 - prev[0], prev[1])}`;
    }
    return d + ' Z';
  }

  /* 범퍼(요철 클립) 블록 */
  function tabPath(cx, baseY, w, h, dir) {
    const hw = w / 2, hw2 = hw - 7, y1 = baseY + dir * h;
    const r = 9;
    return [
      `M ${pt(cx - hw, baseY)}`,
      `C ${pt(cx - hw - 4, baseY + dir * h * 0.55)} ${pt(cx - hw2 - 3, y1 - dir * (r + 4))} ${pt(cx - hw2, y1 + dir * r)}`,
      `Q ${pt(cx - hw2, y1)} ${pt(cx - hw2 + r, y1)}`,
      `L ${pt(cx + hw2 - r, y1)}`,
      `Q ${pt(cx + hw2, y1)} ${pt(cx + hw2, y1 + dir * r)}`,
      `C ${pt(cx + hw2 + 3, y1 - dir * (r + 4))} ${pt(cx + hw + 4, baseY + dir * h * 0.55)} ${pt(cx + hw, baseY)}`,
      'Z'
    ].join(' ');
  }

  /* 스타디움(링) — 좌우 반원 + 곧은 구간 */
  function stadium(cx, cy, hw, hh) {
    const r = Math.min(hh, hw);
    const s = cx - hw + r, e = cx + hw - r;
    return `M ${pt(s, cy - r)} L ${pt(e, cy - r)} A ${R2(r)} ${R2(r)} 0 0 1 ${pt(e, cy + r)} ` +
           `L ${pt(s, cy + r)} A ${R2(r)} ${R2(r)} 0 0 1 ${pt(s, cy - r)} Z`;
  }

  /* 둥근 사각 창 (액정 베젤 구멍) */
  function rrect(cx, cy, hw, hh, r) {
    const k = 0.5523;
    const x = cx - hw, y = cy - hh, w = hw * 2, h = hh * 2;
    const rr = Math.min(r, hw, hh);
    return `M ${pt(x + rr, y)} L ${pt(x + w - rr, y)} ` +
      `C ${pt(x + w - rr + rr * k, y)} ${pt(x + w, y + rr - rr * k)} ${pt(x + w, y + rr)} ` +
      `L ${pt(x + w, y + h - rr)} ` +
      `C ${pt(x + w, y + h - rr + rr * k)} ${pt(x + w - rr + rr * k, y + h)} ${pt(x + w - rr, y + h)} ` +
      `L ${pt(x + rr, y + h)} ` +
      `C ${pt(x + rr - rr * k, y + h)} ${pt(x, y + h - rr + rr * k)} ${pt(x, y + h - rr)} ` +
      `L ${pt(x, y + rr)} ` +
      `C ${pt(x, y + rr - rr * k)} ${pt(x + rr - rr * k, y)} ${pt(x + rr, y)} Z`;
  }

  /* 스타디움 둘레 위의 점 + 바깥 법선 */
  function stadiumAt(cx, cy, hw, hh, t) {
    const r = Math.min(hh, hw);
    const S = 2 * (hw - r), A = Math.PI * r, P = 2 * S + 2 * A;
    let d = ((t % 1) + 1) % 1 * P;
    const x0 = cx - hw + r;
    if (d < S) return { x: x0 + d, y: cy - r, nx: 0, ny: -1 };
    d -= S;
    if (d < A) {
      const a = -Math.PI / 2 + (d / A) * Math.PI;
      const ex = cx + hw - r;
      return { x: ex + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= A;
    if (d < S) return { x: cx + hw - r - d, y: cy + r, nx: 0, ny: 1 };
    d -= S;
    const a = Math.PI / 2 + (d / A) * Math.PI;
    const ex = cx - hw + r;
    return { x: ex + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  }

  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /* ---------------------------------------------------------------- defs */
  function buildDefs() {
    const defs = el('defs', {}, base);

    // 몸통 재질
    const bg = el('linearGradient', { id: 'csBody', x1: '12%', y1: '0%', x2: '78%', y2: '100%' }, defs);
    el('stop', { offset: '0%', class: 'cs-b1' }, bg);
    el('stop', { offset: '38%', class: 'cs-b2' }, bg);
    el('stop', { offset: '72%', class: 'cs-b3' }, bg);
    el('stop', { offset: '100%', class: 'cs-b4' }, bg);

    // 범퍼 재질 (조금 더 밝은 상판)
    const tg = el('linearGradient', { id: 'csTab', x1: '22%', y1: '0%', x2: '70%', y2: '100%' }, defs);
    el('stop', { offset: '0%', class: 'cs-t1' }, tg);
    el('stop', { offset: '55%', class: 'cs-t2' }, tg);
    el('stop', { offset: '100%', class: 'cs-t3' }, tg);

    // 윙·패드 보스
    const wg = el('radialGradient', { id: 'csBoss', cx: '38%', cy: '26%', r: '86%' }, defs);
    el('stop', { offset: '0%', class: 'cs-s1' }, wg);
    el('stop', { offset: '58%', class: 'cs-s2' }, wg);
    el('stop', { offset: '100%', class: 'cs-s3' }, wg);

    // 유리 광택
    const gl = el('radialGradient', { id: 'csGloss', cx: '50%', cy: '50%', r: '50%' }, defs);
    el('stop', { offset: '0%', class: 'cs-g1' }, gl);
    el('stop', { offset: '60%', class: 'cs-g2' }, gl);
    el('stop', { offset: '100%', class: 'cs-g3' }, gl);

    // 베젤 금속
    const rg = el('linearGradient', { id: 'csBezel', x1: '8%', y1: '4%', x2: '86%', y2: '96%' }, defs);
    el('stop', { offset: '0%', class: 'cs-r1' }, rg);
    el('stop', { offset: '16%', class: 'cs-r2' }, rg);
    el('stop', { offset: '38%', class: 'cs-r3' }, rg);
    el('stop', { offset: '62%', class: 'cs-r4' }, rg);
    el('stop', { offset: '84%', class: 'cs-r5' }, rg);
    el('stop', { offset: '100%', class: 'cs-r2' }, rg);

    // 범프 광택(상단 하이라이트)
    const hg = el('linearGradient', { id: 'csSheen', x1: '0%', y1: '0%', x2: '0%', y2: '100%' }, defs);
    el('stop', { offset: '0%', class: 'cs-h1' }, hg);
    el('stop', { offset: '55%', class: 'cs-h2' }, hg);
    el('stop', { offset: '100%', class: 'cs-h3' }, hg);

    // 3D 베벨 (모서리 챔퍼: 좌상단 하이라이트 → 우하단 음영)
    const bev = el('linearGradient', { id: 'csBevel', x1: '8%', y1: '0%', x2: '78%', y2: '100%' }, defs);
    el('stop', { offset: '0%', class: 'cs-bv1' }, bev);
    el('stop', { offset: '38%', class: 'cs-bv2' }, bev);
    el('stop', { offset: '62%', class: 'cs-bv3' }, bev);
    el('stop', { offset: '100%', class: 'cs-bv4' }, bev);

    const clip = el('clipPath', { id: 'csClip' }, defs);
    el('path', { id: 'csClipPath', d: '' }, clip);

    const rdefs = el('defs', {}, ring);
    const rg2 = el('linearGradient', { id: 'csRingMetal', x1: '10%', y1: '0%', x2: '84%', y2: '100%' }, rdefs);
    el('stop', { offset: '0%', class: 'cs-r1' }, rg2);
    el('stop', { offset: '18%', class: 'cs-r2' }, rg2);
    el('stop', { offset: '40%', class: 'cs-r3' }, rg2);
    el('stop', { offset: '64%', class: 'cs-r4' }, rg2);
    el('stop', { offset: '86%', class: 'cs-r5' }, rg2);
    el('stop', { offset: '100%', class: 'cs-r2' }, rg2);
    const ig = el('radialGradient', { id: 'csInnerShadow', cx: '50%', cy: '42%', r: '62%' }, rdefs);
    el('stop', { offset: '0%', class: 'cs-i1' }, ig);
    el('stop', { offset: '100%', class: 'cs-i2' }, ig);
  }

  /* ---------------------------------------------------------------- 그리기 */
  function drawBase(g) {
    const { W, H, w2, cy, ringHw, ringHh, innerHw, innerHh } = g;
    const body = bodyPath(g);

    base.setAttribute('viewBox', `0 0 ${W} ${H}`);
    base.textContent = '';
    buildDefs();
    base.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const clipPath = base.querySelector('#csClipPath');
    if (clipPath) clipPath.setAttribute('d', body);

    // 그림자 (실루엣을 따라 퍼지는 소프트 섀도)
    el('path', { d: body, class: 'cs-shadow' }, base);

    // 몸통
    el('path', { d: body, class: 'cs-body' }, base);

    // 3D 베벨: 안쪽으로 한 겹 들어간 챔퍼 면
    const bevG = el('g', { transform: `translate(${w2} ${cy}) scale(.972) translate(${-w2} ${-cy})` }, base);
    el('path', { d: body, class: 'cs-bevel' }, bevG);
    const bevG2 = el('g', { transform: `translate(${w2} ${cy}) scale(.94) translate(${-w2} ${-cy})` }, base);
    el('path', { d: body, class: 'cs-bevel2' }, bevG2);

    // 몸통 안쪽 하이라이트/음영
    const g1 = el('g', { 'clip-path': 'url(#csClip)' }, base);
    el('path', { d: body, class: 'cs-rimlight' }, g1);
    el('ellipse', { cx: w2 - W * 0.06, cy: cy - 150, rx: W * 0.3, ry: 96, class: 'cs-gloss' }, g1);
    el('ellipse', { cx: w2, cy: cy + 176, rx: W * 0.38, ry: 70, class: 'cs-shade' }, g1);
    el('ellipse', { cx: w2, cy: cy + 8, rx: 168, ry: 150, class: 'cs-seat-shadow' }, g1);

    // 범퍼 블록 4개
    const tabW = 86, tabH = 40;
    for (const dx of [-106, 106]) {
      el('path', { d: tabPath(w2 + dx, g.topY + 12, tabW, tabH, -1), class: 'cs-tab' }, base);
      el('path', { d: tabPath(w2 + dx, g.topY + 12, tabW, tabH, -1), class: 'cs-tab-line' }, base);
      el('path', { d: tabPath(w2 + dx, g.botY - 12, tabW, tabH, 1), class: 'cs-tab' }, base);
      el('path', { d: tabPath(w2 + dx, g.botY - 12, tabW, tabH, 1), class: 'cs-tab-line' }, base);
    }

    // 안테나 (좌상단 굵은 검은 안테나)
    const ax = 142, ay = 66, tx = 113, ty = 16, half = 6.4;
    const dx = tx - ax, dy = ty - ay, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    el('path', {
      d: `M ${pt(ax + nx * half, ay + ny * half)} L ${pt(tx + nx * half * 0.8, ty + ny * half * 0.8)} ` +
         `Q ${pt(tx + nx * 8, ty + ny * 8 - 4)} ${pt(tx + nx * 2, ty + ny * 2 - 8)} ` +
         `Q ${pt(tx - nx * 4, ty - ny * 4 - 9)} ${pt(tx - nx * half * 0.8, ty - ny * half * 0.8)} ` +
         `L ${pt(ax - nx * half, ay - ny * half)} Q ${pt(ax, ay + 7)} ${pt(ax + nx * half, ay + ny * half)} Z`,
      class: 'cs-antenna'
    }, base);
    for (let i = 1; i <= 4; i += 1) {
      const t = 0.2 + i * 0.17;
      const cx1 = ax + dx * t, cy1 = ay + dy * t;
      el('path', { d: `M ${pt(cx1 + nx * half * 0.9, cy1 + ny * half * 0.9)} L ${pt(cx1 - nx * half * 0.9, cy1 - ny * half * 0.9)}`, class: 'cs-antenna-ridge' }, base);
    }
    el('ellipse', { cx: ax, cy: ay + 4, rx: half + 3.4, ry: 4.2, class: 'cs-antenna-collar' }, base);

    // 나사·이음선
    el('path', { d: `M ${pt(w2 - ringHw - 6, cy)} l 0 0`, class: 'cs-seam' }, base);

    // 왼쪽 윙: D-패드 보스
    el('circle', { cx: g.padX, cy, r: g.padR + 3, class: 'cs-boss' }, base);
    el('circle', { cx: g.padX, cy, r: g.padR + 3, class: 'cs-boss-rim' }, base);

    // 오른쪽 윙: A · B · C 보스 그림자
    for (const [yy, rx, ry] of [[cy - 75, 50, 31], [cy - 9, 50, 31]]) {
      el('ellipse', { cx: g.abX, cy: yy, rx, ry, class: 'cs-well' }, base);
    }
    el('circle', { cx: g.abX, cy: cy + 58, r: 32, class: 'cs-well' }, base);

    // 링 홈(베젤이 앉을 자리)
    el('path', { d: stadium(w2, cy, ringHw + 4, ringHh + 4), class: 'cs-ringseat' }, base);
  }

  function drawRing(g) {
    const { W, H, w2, cy, ringHw, ringHh, innerHw, innerHh } = g;
    ring.setAttribute('viewBox', `0 0 ${W} ${H}`);
    ring.textContent = '';
    const rdefs = el('defs', {}, ring);
    const rg2 = el('linearGradient', { id: 'csRingMetal', x1: '10%', y1: '0%', x2: '84%', y2: '100%' }, rdefs);
    ['cs-r1', 'cs-r2', 'cs-r3', 'cs-r4', 'cs-r5', 'cs-r2'].forEach((c, i, a) => {
      el('stop', { offset: `${i * 20}%`, class: c }, rg2);
    });
    const clip = el('clipPath', { id: 'csRingClip' }, rdefs);
    el('path', { d: stadium(w2, cy, ringHw, ringHh) }, clip);

    // 베젤 밴드 (가운데 구멍은 비워 액정이 보이게)
    el('path', {
      d: `${stadium(w2, cy, ringHw, ringHh)} ${rrect(w2, cy, g.holeHw, g.holeHh, g.holeR)}`,
      'fill-rule': 'evenodd', class: 'cs-ring'
    }, ring);

    const g2 = el('g', { 'clip-path': 'url(#csRingClip)' }, ring);
    // 밴드 위 광택과 음영
    el('path', { d: stadium(w2, cy, ringHw, ringHh), class: 'cs-ring-sheen' }, g2);
    el('path', { d: stadium(w2, cy, ringHw - 5, ringHh - 5), class: 'cs-ring-inner' }, g2);

    // 각인: 이중 점선 링
    el('path', { d: stadium(w2, cy, (ringHw + innerHw) / 2 + 2, (ringHh + innerHh) / 2 + 2), class: 'cs-etch-dash' }, ring);
    el('path', { d: rrect(w2, cy, g.holeHw + 9, g.holeHh + 9, g.holeR + 6), class: 'cs-etch-line' }, ring);

    // 각인: 둘레 눈금
    const ticksG = el('g', { class: 'cs-ticks' }, ring);
    const N = 40;
    for (let i = 0; i < N; i += 1) {
      const p = stadiumAt(w2, cy, (ringHw + innerHw) / 2, (ringHh + innerHh) / 2, i / N);
      const long = i % 5 === 0;
      const len = long ? 6.5 : 4;
      el('path', {
        d: `M ${pt(p.x, p.y)} l ${R2(-p.nx * len)} ${R2(-p.ny * len)}`,
        class: long ? 'cs-tick long' : 'cs-tick'
      }, ticksG);
    }

    // 각인: 네 방향 나사 노치
    for (const t of [0.125, 0.375, 0.625, 0.875]) {
      const p = stadiumAt(w2, cy, (ringHw + innerHw) / 2, (ringHh + innerHh) / 2, t);
      el('circle', { cx: p.x, cy: p.y, r: 4.6, class: 'cs-screw' }, ring);
      el('path', {
        d: `M ${pt(p.x - 2.6, p.y - 2.6)} L ${pt(p.x + 2.6, p.y + 2.6)}`, class: 'cs-screw-cut'
      }, ring);
    }

    // 링 안쪽 그림자 (액정 테두리)
    el('path', { d: rrect(w2, cy, g.holeHw + 2, g.holeHh + 2, g.holeR + 1), class: 'cs-ring-lip' }, ring);
    el('path', { d: rrect(w2, cy, g.holeHw + 0.5, g.holeHh + 0.5, g.holeR), class: 'cs-ring-lip2' }, ring);
  }

  /* 액정 크기: 링 구멍 안에서 화면비 유지 */
  function fitScreen(g) {
    let w = Math.min(560, 2 * g.innerHw - 60);
    let h = 254;
    if (g.W < 620) { w = Math.min(260, 2 * g.innerHw - 56); h = 254; }
    const prev = document.documentElement.style.getPropertyValue('--lcd-w');
    if (prev !== `${R2(w)}px`) document.documentElement.style.setProperty('--lcd-w', `${R2(w)}px`);
    document.documentElement.style.setProperty('--lcd-h', `${R2(h)}px`);
    return { w, h };
  }

  let lastW = 0, lastH = 0;
  function render(force) {
    const W = Math.round(stage.getBoundingClientRect().width);
    const H = Math.round(stage.getBoundingClientRect().height) || 450;
    if (!force && W === lastW && H === lastH) return;
    lastW = W; lastH = H;
    const g = geom(W, H);
    const lcd = fitScreen(g);
    g.holeHw = lcd.w / 2 + 9;
    g.holeHh = lcd.h / 2 + 9;
    g.holeR = 32;
    drawBase(g);
    drawRing(g);
    document.documentElement.style.setProperty('--ring-h', `${R2(g.ringHh)}px`);
    window.__CHASSIS = { g, lcd };
  }

  render(true);
  if (window.ResizeObserver) {
    new ResizeObserver(() => render(false)).observe(stage);
  } else {
    window.addEventListener('resize', () => render(false));
  }

  /* 검수용: 액정 중심과 링 중심의 오차 */
  window.__CHASSIS_CHECK__ = function () {
    const g = window.__CHASSIS && window.__CHASSIS.g;
    const lcdEl = document.getElementById('lcdScreen');
    if (!g || !lcdEl) return null;
    const r = lcdEl.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const cx = r.left - s.left + r.width / 2;
    const cyv = r.top - s.top + r.height / 2;
    return {
      width: g.W,
      lcd: [+r.width.toFixed(1), +r.height.toFixed(1)],
      dx: +(cx - g.w2).toFixed(2),
      dy: +(cyv - g.cy).toFixed(2),
      ring: [g.ringHw * 2, g.ringHh * 2]
    };
  };
})();
