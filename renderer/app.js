/* Bot House — 화면 조립과 상태 표시 */
(function () {
  'use strict';

  const bridge = window.botHouse || window.PreviewBridge;

  const el = (id) => document.getElementById(id);

  const app = {
    settings: {},
    bots: {},
    botDefs: [],
    claude: {},
    logs: [],
    selected: null,
    avatarFrame: 0,
    statusServer: {},
    popBot: null,
    usage: null,
    update: {},
    view: 'tamagotchi',
    sheet: null,
    careIdx: 0,
    focus: 'tabs',   // 'tabs' = 상단 탭 줄, 'view' = 화면 안
    settingIdx: 0
  };

  const BOT_IDS = ['oiji', 'takuan', 'sbji', 'claude'];
  const VIEWS = ['tamagotchi', 'house', 'usage', 'settings'];
  // 홀로그램 UI 상단 탭 순서 (← →): ROOM · CHARACTERS · USAGE · SETTINGS
  const TABS = ['house', 'tamagotchi', 'usage', 'settings'];
  const TAB_OF = { house: 'room', tamagotchi: 'characters', usage: 'usage', settings: 'settings' };
  // SETTINGS 탭에서 ← → 로 고르고 ✓ 로 누르는 줄
  const SETTING_ROWS = ['claudeRestart', 'claudeLog', 'settingsBtn', 'updateRow'];
  const CARE = ['pet', 'snack', 'cheer', 'sleep'];

  const stateLabel = {
    working: '작업 중',
    idle: '쉬는 중',
    offline: '오프라인'
  };

  function timeAgo(ts) {
    if (!ts) return '-';
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    return `${Math.floor(hr / 24)}일 전`;
  }

  function elapsed(ts) {
    if (!ts) return '-';
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금 연결';
    if (min < 60) return `${min}분째 연결`;
    const hr = Math.floor(min / 60);
    const rest = min % 60;
    return `${hr}시간 ${rest}분째`;
  }

  function setAvatar(node, id, anim = 'idle') {
    if (!node) return;
    node.dataset.bot = id;
    node.dataset.anim = anim;
    node.style.backgroundImage = `url('../assets/sprites/${id}.png')`;
  }

  // 시트 크기를 한 번 읽어 둔다: 높이 256 이상이면 새 시트(128칸 4열 × 5행), 아니면 예전 32px 한 줄.
  const sheetDims = {};
  function sheetDim(id) {
    if (!sheetDims[id]) {
      sheetDims[id] = { w: 0, h: 0 };
      const img = new Image();
      img.onload = () => { sheetDims[id] = { w: img.width, h: img.height }; };
      img.src = `../assets/sprites/${id}.png`;
    }
    return sheetDims[id];
  }

  function paintAvatars() {
    const frames = { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7, 8, 9], sleep: [10] };
    const gridRows = { idle: 0, emotion: 1, work: 2, sleep: 3, walk: 4 };
    app.avatarFrame += 1;
    document.querySelectorAll('.avatar').forEach((node) => {
      const id = node.dataset.bot;
      if (!id) return;
      const src = `url('../assets/sprites/${id}.png')`;
      if (node.style.backgroundImage !== src) node.style.backgroundImage = src;
      const st = (app.bots[id] && app.bots[id].state) || 'idle';
      const anim = st === 'working' ? 'work' : st === 'offline' ? 'sleep' : 'idle';
      const step = Math.floor(app.avatarFrame / (anim === 'work' ? 3 : 6));
      const size = Math.round(node.getBoundingClientRect().width) || 40;
      const dim = sheetDim(id);
      if (dim.h >= 256) {
        const k = size / 128;
        const cols = Math.min(4, Math.max(1, Math.floor(dim.w / 128))); // 아바타는 대기·작업·잠만 → 4칸
        node.style.backgroundSize = `${dim.w * k}px ${dim.h * k}px`;
        node.style.backgroundPosition = `${-(step % cols) * size}px ${-gridRows[anim] * size}px`;
      } else {
        const list = frames[anim];
        const idx = list[step % list.length];
        node.style.backgroundSize = `${size * 11}px ${size}px`;
        node.style.backgroundPosition = `${-idx * size}px 0`;
      }
    });
  }

  /* -------------------------------------------------- 상태 표시 */
  function renderStatusBar() {
    const bar = el('statusbar');
    bar.innerHTML = '';
    for (const id of BOT_IDS) {
      const def = app.botDefs.find((b) => b.id === id) || { name: id, role: '' };
      const st = app.bots[id] || { state: 'idle' };
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `status-chip ${st.state}${app.selected === id ? ' active' : ''}`;
      chip.dataset.bot = id;
      chip.innerHTML = `
        <span class="avatar chip-avatar" data-bot="${id}"></span>
        <span class="meta">
          <span class="name">${def.name}</span>
          <span class="state">${stateLabel[st.state] || '쉬는 중'}${st.state === 'working' && st.note ? ' · ' + st.note : ''}</span>
        </span>
        <span class="led"></span>`;
      chip.addEventListener('click', () => openPopover(id));
      bar.appendChild(chip);
      setAvatar(chip.querySelector('.avatar'), id);
    }
    paintAvatars();
  }

  function renderBotList() {
    const list = el('botList');
    list.innerHTML = '';
    for (const id of BOT_IDS) {
      const def = app.botDefs.find((b) => b.id === id) || { name: id, role: '' };
      const st = app.bots[id] || { state: 'idle' };
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `bot-row${app.selected === id ? ' active' : ''}`;
      row.innerHTML = `
        <span class="avatar" data-bot="${id}"></span>
        <span class="info">
          <span class="line1">
            <span class="name">${def.name}</span>
            <span class="pill ${st.state}">${stateLabel[st.state] || '쉬는 중'}</span>
          </span>
          <span class="note">${st.note || def.role || ''}</span>
        </span>
        <span class="when">${timeAgo(st.lastActivity)}</span>`;
      if (row.querySelector('.when').textContent === '-') row.querySelector('.when').textContent = '';
      row.addEventListener('click', () => openPopover(id));
      list.appendChild(row);
      setAvatar(row.querySelector('.avatar'), id);
    }
    paintAvatars();
  }

  const CLAUDE_CHIP = {
    running: ['연결됨', 'running'],
    starting: ['연결 중', 'retrying'],
    retrying: ['다시 연결 중', 'retrying'],
    exited: ['끊김', 'exited'],
    error: ['오류', 'error'],
    stopped: ['멈춤', 'stopped']
  };

  function renderClaudeCard() {
    const c = app.claude || {};
    const label = CLAUDE_CHIP[c.status] || ['확인 중', 'stopped'];
    const chip = el('claudeChip');
    const working = c.status === 'running' && app.bots.claude && app.bots.claude.state === 'working';
    chip.textContent = working ? '작업 중' : label[0];
    chip.className = 'chip ' + (working ? 'working' : label[1]);
    el('claudeSub').textContent = c.message || (c.status === 'running' ? '채널이 켜져 있어요' : '연결되지 않았어요');
    el('claudeCwd').textContent = c.cwd || '-';
    el('claudeCwd').title = c.cwd || '';
    el('claudeUptime').textContent = c.status === 'running' ? elapsed(c.startedAt) : '-';

    const pulse = el('logPulse');
    pulse.className = 'pulse' + (c.status === 'running' ? (working ? ' work' : ' on') : '');

    const led = el('shellLed');
    if (led) led.classList.toggle('off', !(c.status === 'running'));
  }

  function renderAll() {
    renderStatusBar();
    renderBotList();
    renderClaudeCard();
    renderUpdate();
    if (window.Tama) window.Tama.setBots(app.bots);
  }

  /* 업데이트 -------------------------------------------------- */
  function updateText(u) {
    const st = u.status || 'idle';
    if (st === 'dev') return '개발 실행 중에는 확인하지 않아요';
    if (st === 'checking') return '확인하는 중';
    if (st === 'available' || st === 'downloading') return u.message || `내려받는 중 ${u.percent || 0}%`;
    if (st === 'ready') return '재시작하면 적용돼요';
    if (st === 'none') return '지금이 최신 버전';
    if (st === 'error') return u.message || '확인하지 못했어요';
    return '확인 전';
  }

  function renderUpdate() {
    const u = app.update || {};
    const btn = el('updateBtn');
    const status = el('updateStatus');
    const rowState = el('updateRowState');
    const text = updateText(u);
    if (status) status.value = text;
    if (rowState) rowState.textContent = text;
    if (!btn) return;
    const show = u.status === 'available' || u.status === 'downloading' || u.status === 'ready';
    btn.hidden = !show;
    if (!show) return;
    el('updateLabel').textContent = u.status === 'ready' ? '재시작' : `새 버전 ${u.percent || 0}%`;
    btn.title = u.status === 'ready' ? '눌러서 재시작하고 새 버전을 적용해요' : '새 버전을 내려받는 중이에요';
    btn.classList.toggle('ready', u.status === 'ready');
  }

  /* -------------------------------------------------- 로그 */
  function appendLog(entry) {
    app.logs.push(entry);
    if (app.logs.length > 500) app.logs.shift();
    const body = el('logBody');
    if (!body || body.closest('[hidden]')) return;
    const line = document.createElement('div');
    line.className = `l-${entry.level || 'info'}`;
    const t = new Date(entry.t || Date.now());
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    line.textContent = `${hh}:${mm}:${ss}  ${entry.line}`;
    body.appendChild(line);
    while (body.childElementCount > 400) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
  }

  function renderLogBody() {
    const body = el('logBody');
    body.innerHTML = '';
    for (const entry of app.logs.slice(-300)) {
      const line = document.createElement('div');
      line.className = `l-${entry.level || 'info'}`;
      const t = new Date(entry.t || Date.now());
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const ss = String(t.getSeconds()).padStart(2, '0');
      line.textContent = `${hh}:${mm}:${ss}  ${entry.line}`;
      body.appendChild(line);
    }
    body.scrollTop = body.scrollHeight;
  }

  /* -------------------------------------------------- 액정 시트 */
  const SHEETS = { menu: 'menuSheet', care: 'careSheet', log: 'logPanel' };

  function openSheet(name) {
    closeSheet();
    const node = el(SHEETS[name]);
    if (!node) return;
    app.sheet = name;
    node.hidden = false;
    const body = node.querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
    if (name === 'log') renderLogBody();
    if (name === 'care') {
      const id = window.Tama ? window.Tama.focusId() : 'oiji';
      const def = app.botDefs.find((b) => b.id === id) || { name: '오이지', role: '' };
      const title = el('careTitle');
      if (title) title.textContent = `${def.name} 돌보기`;
      el('careName').textContent = def.name;
      const st = app.bots[id] || { state: 'idle' };
      el('careState').textContent = `${stateLabel[st.state] || '쉬는 중'}${st.note ? ' · ' + st.note : ''}`;
      setAvatar(el('careAvatar'), id);
      paintCareSelection();
    }
    if (window.Tama) window.Tama.setVisible(false);
  }

  function closeSheet() {
    Object.values(SHEETS).forEach((id) => { const n = el(id); if (n) n.hidden = true; });
    app.sheet = null;
    if (window.Tama) window.Tama.setVisible(app.view === 'tamagotchi');
  }

  function toggleSheet(name) {
    if (app.sheet === name) closeSheet();
    else openSheet(name);
  }

  function paintCareSelection() {
    document.querySelectorAll('#tamaControls .tama-btn').forEach((b, i) => {
      b.classList.toggle('sel', i === app.careIdx);
    });
  }

  function moveCare(step) {
    app.careIdx = (app.careIdx + step + CARE.length) % CARE.length;
    paintCareSelection();
  }

  function runCare() {
    const act = CARE[app.careIdx];
    const btn = document.querySelector(`#tamaControls .tama-btn[data-act="${act}"]`);
    if (btn) {
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 160);
    }
    // 액정을 닫아 반응(하트·간식·꽃가루)이 보이게 한다
    closeSheet();
    if (window.Tama) window.Tama.act(act);
  }

  /* -------------------------------------------------- 캐릭터 팝오버 */
  function openPopover(id) {
    app.selected = id;
    app.popBot = id;
    window.House.setSelected(id);
    renderAll();

    const def = app.botDefs.find((b) => b.id === id) || { name: id, role: '', handle: '' };
    const st = app.bots[id] || { state: 'idle' };
    el('popName').textContent = def.name;
    el('popRole').textContent = `${def.role || ''} · ${def.handle || ''}`;
    el('popState').textContent = stateLabel[st.state] || '쉬는 중';
    el('popLast').textContent = timeAgo(st.lastActivity);
    el('popNote').textContent = st.note || '-';
    setAvatar(el('popAvatar'), id);

    const toggle = el('popToggle');
    toggle.textContent = st.state === 'working' ? '테스트: 대기로 표시' : '테스트: 작업 중으로 표시';
    toggle.dataset.bot = id;

    const popLog = el('popLog');
    if (id === 'claude') {
      popLog.hidden = false;
      popLog.textContent = app.logs.slice(-3).map((l) => l.line).join('\n') || '아직 기록이 없어요.';
    } else {
      popLog.hidden = true;
    }

    const pop = el('popover');
    pop.hidden = false;
    const anchor = (app.view === 'tamagotchi' && window.Tama ? window.Tama.anchorOf(id) : null)
      || window.House.anchorOf(id)
      || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = pop.getBoundingClientRect();
    const left = Math.min(Math.max(12, anchor.x - rect.width / 2), window.innerWidth - rect.width - 12);
    const top = Math.min(Math.max(12, anchor.y - rect.height - 14), window.innerHeight - rect.height - 12);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function closePopover() {
    el('popover').hidden = true;
    app.selected = null;
    app.popBot = null;
    window.House.setSelected(null);
    renderAll();
  }

  /* -------------------------------------------------- 설정 */
  function fillSettings() {
    const s = app.settings;
    el('workDir').value = s.workDir || '';
    el('autoConnect').checked = !!s.autoConnect;
    el('autoReconnect').checked = !!s.autoReconnect;
    el('minimizeToTray').checked = !!s.minimizeToTray;
    el('launchAtLogin').checked = !!s.launchAtLogin;
    el('claudeCommand').value = s.claudeCommand || '';
    el('claudeArgs').value = s.claudeArgs || '';
    el('statusApiEnabled').checked = !!s.statusApiEnabled;
    el('statusUrl').value = s.statusUrl || '';
    setThemeButtons(s.theme);
    el('apiDesc').innerHTML = `봇들이 <code>http://127.0.0.1:${s.statusApiPort || 47820}/status</code>로 상태를 알려줄 수 있어요.`;
  }

  function setThemeButtons(theme) {
    document.querySelectorAll('#themeSeg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.theme === theme);
    });
  }

  function applyTheme(theme) {
    const mode = theme === 'day' ? 'day' : 'night';
    document.body.className = `theme-${mode}`;
    el('themeLabel').textContent = mode === 'day' ? '낮' : '밤';
    window.House.setTheme(mode);
    if (window.Tama) window.Tama.setTheme(mode);
  }

  async function saveSettings() {
    const patch = {
      workDir: el('workDir').value.trim(),
      autoConnect: el('autoConnect').checked,
      autoReconnect: el('autoReconnect').checked,
      minimizeToTray: el('minimizeToTray').checked,
      launchAtLogin: el('launchAtLogin').checked,
      claudeCommand: el('claudeCommand').value.trim() || 'claude',
      claudeArgs: el('claudeArgs').value.trim(),
      statusApiEnabled: el('statusApiEnabled').checked,
      statusUrl: el('statusUrl').value.trim(),
      theme: app.settings.theme
    };
    app.settings = await bridge.saveSettings(patch);
    el('saveState').textContent = '저장했어요';
    setTimeout(() => { el('saveState').textContent = ''; }, 1800);
    applyTheme(app.settings.theme);
  }

  /* -------------------------------------------------- 사용량 대시보드 */
  const TOOL_COLORS = { claude: '#ff7a59', codex: '#7bd1a8', gemini: '#8ab4ff' };
  const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  }

  function fmtFull(n) {
    return (Number(n) || 0).toLocaleString('ko-KR');
  }

  function fmtReset(iso) {
    if (!iso) return '';
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    const diff = t.getTime() - Date.now();
    const day = DAY_LABEL[t.getDay()];
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    if (diff < 0) return `${day} ${hh}:${mm} 지남`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}분 뒤 리셋`;
    return `${day} ${hh}:${mm} 리셋`;
  }

  function barsHtml(tool) {
    const days = tool.days || [];
    const max = Math.max(...days.map((d) => d.total), 1);
    return `<div class="bars">${days.map((d, i) => {
      const date = new Date(`${d.date}T00:00:00`);
      const label = DAY_LABEL[date.getDay()] || '';
      const h = Math.max(2, Math.round((d.total / max) * 32));
      const today = i === days.length - 1 ? ' today' : '';
      return `<div class="bar${today}" title="${d.date} · ${fmtFull(d.total)} 토큰"><i style="height:${h}px"></i><span>${label}</span></div>`;
    }).join('')}</div>`;
  }

  function localToolCard(tool) {
    const color = TOOL_COLORS[tool.id] || '#ff7a59';
    const installed = tool.installed;
    const hasData = installed && (tool.today.total > 0 || tool.week.total > 0);
    const status = !installed ? ['없음', 'offline'] : hasData ? ['기록 있음', 'idle'] : ['기록 없음', 'offline'];
    const quota = tool.quota || {};

    let quotaHtml = '';
    if (tool.id === 'claude') {
      if (quota.available) {
        const w = quota.weekly;
        const pctUsed = w && w.usedPercent !== null ? w.usedPercent : null;
        const left = pctUsed === null ? null : Math.max(0, 100 - pctUsed);
        const cls = left === null ? '' : left < 15 ? 'danger' : left < 35 ? 'warn' : '';
        quotaHtml = `
          <div class="quota">
            <div class="row1">
              <span>${quota.plan ? quota.plan.toUpperCase() + ' · ' : ''}주간 쿼터 ${left === null ? '-' : left + '% 남음'}</span>
              <span>${fmtReset(w && w.resetsAt)}</span>
            </div>
            <div class="track"><div class="fill ${cls}" style="width:${left === null ? 0 : left}%"></div></div>
          </div>`;
      } else {
        quotaHtml = `<div class="quota"><div class="row1"><span>${quota.reason || '쿼터 정보를 받지 못했어요'}</span><span>로컬 기록 기준</span></div></div>`;
      }
    }

    return `
      <article class="usage-card">
        <header>
          <span class="tool-dot" style="background:${color}"></span>
          <h3>${tool.name}</h3>
          <span class="pill ${status[1]}">${status[0]}</span>
        </header>
        ${installed
          ? `<div class="big"><strong>${fmtTokens(tool.today.total)}</strong><span>오늘 · ${fmtFull(tool.today.total)} 토큰</span></div>
             ${barsHtml(tool)}
             <dl>
               <div><dt>이번 주</dt><dd>${fmtTokens(tool.week.total)}</dd></div>
               <div><dt>세션</dt><dd>${tool.sessions || 0}</dd></div>
               <div><dt>최근</dt><dd>${tool.lastActivity ? timeAgo(tool.lastActivity) : '-'}</dd></div>
             </dl>
             ${quotaHtml}`
          : `<p class="empty">${tool.reason || '설치되어 있지 않거나 기록이 없어요'}<br><span style="opacity:.7">${tool.source || ''}</span></p>`}
      </article>`;
  }

  function remoteCard(botId) {
    const def = app.botDefs.find((b) => b.id === botId) || { name: botId };
    const st = app.bots[botId] || {};
    const usage = st.usage;
    const has = usage && (usage.todayTokens > 0 || usage.weekTokens > 0);
    const status = has ? ['수신 중', 'idle'] : ['신호 대기', 'offline'];
    return `
      <article class="usage-card">
        <header>
          <span class="avatar chip-avatar" data-bot="${botId}"></span>
          <h3>${def.name}</h3>
          <span class="pill ${status[1]}">${status[0]}</span>
        </header>
        ${has
          ? `<div class="big"><strong>${fmtTokens(usage.todayTokens)}</strong><span>오늘</span></div>
             <dl>
               <div><dt>이번 주</dt><dd>${fmtTokens(usage.weekTokens)}</dd></div>
               <div><dt>수신</dt><dd>${st.usageAt ? timeAgo(st.usageAt) : '-'}</dd></div>
             </dl>`
          : `<dl>
               <div><dt>지금</dt><dd>${stateLabel[st.state] || '쉬는 중'}</dd></div>
               <div><dt>마지막 응답</dt><dd>${timeAgo(st.lastActivity)}</dd></div>
               <div><dt>토큰</dt><dd>앱에서 확인</dd></div>
             </dl>
             <p class="empty" style="margin-top:4px">${botId === 'sbji' ? '단무지가 API로 부르는 모델이라 따로 세지 않아요.' : `사용량 조회 API가 없어 ${def.name} 앱에서만 볼 수 있어요.`}</p>`}
      </article>`;
  }

  function renderUsage(u) {
    app.usage = u;
    const grid = el('usageGrid');
    if (!u || u.error || !u.tools) {
      grid.innerHTML = `<article class="usage-card"><p class="empty">사용량을 읽지 못했어요${u && u.error ? ` · ${u.error}` : ''}</p></article>`;
      return;
    }
    const tools = u.tools;
    const todaySum = tools.reduce((acc, t) => acc + (t.installed ? t.today.total : 0), 0);
    const weekSum = tools.reduce((acc, t) => acc + (t.installed ? t.week.total : 0), 0);
    el('usageToday').textContent = fmtFull(todaySum);
    el('usageWeek').textContent = fmtTokens(weekSum);
    el('usageUpdated').textContent = u.updatedAt ? timeAgo(u.updatedAt) : '-';
    el('tokenToday').textContent = `오늘 ${fmtTokens(todaySum)}`;

    grid.innerHTML = [
      ...tools.map(localToolCard),
      ...['oiji', 'takuan', 'sbji'].map(remoteCard)
    ].join('');

    grid.querySelectorAll('.avatar').forEach((node) => setAvatar(node, node.dataset.bot));
    paintAvatars();

    const localNames = tools.filter((t) => t.installed).map((t) => t.name).join(' · ');
    el('usageNote').textContent = localNames
      ? `이 PC의 세션 기록(${localNames})에서 직접 합산했어요. 원격 봇은 로컬에서 셀 수 없어 상태 API로 받은 값만 표시해요.`
      : '이 PC에서 AI 도구의 세션 기록을 찾지 못했어요. 도구를 설치하고 한 번 사용하면 여기에 쌓여요.';
  }

  async function loadUsage(force = false) {
    try {
      const u = await bridge.getUsage(force);
      renderUsage(u);
    } catch (err) {
      renderUsage({ error: err.message });
    }
  }

  /* -------------------------------------------------- 화면 전환 */
  function switchView(view) {
    const prev = app.view;
    app.view = VIEWS.includes(view) ? view : 'tamagotchi';
    // 홀로그램 화면: 카드 스택이 넘어가듯 회전 (장현님 11-25)
    const body = document.querySelector('.lcd-body');
    if (body && prev && prev !== app.view && document.documentElement.classList.contains('ui-holo')) {
      const dir = TABS.indexOf(app.view) >= TABS.indexOf(prev) ? 'next' : 'prev';
      body.classList.remove('card-next', 'card-prev');
      void body.offsetWidth;
      body.classList.add(`card-${dir}`);
      const scr = document.querySelector('.screen');
      if (scr) { scr.classList.remove('stack-next', 'stack-prev'); void scr.offsetWidth; scr.classList.add(`stack-${dir}`); }
      setTimeout(() => { body.classList.remove(`card-${dir}`); if (scr) scr.classList.remove(`stack-${dir}`); }, 460);
    }
    document.querySelectorAll('#viewSwitch button').forEach((b) => {
      b.classList.toggle('on', b.dataset.view === app.view);
    });
    el('tamaView').hidden = app.view !== 'tamagotchi';
    el('tamaModes').hidden = app.view !== 'tamagotchi';
    el('sceneHolder').hidden = app.view !== 'house';
    el('usageView').hidden = app.view !== 'usage';
    if (app.sheet) closeSheet();
    if (window.Tama) window.Tama.setVisible(app.view === 'tamagotchi');
    if (app.view === 'usage') loadUsage(false);
    else if (app.view === 'house') window.House.setSelected(app.selected);
    else if (app.view === 'settings') { openSheet('menu'); paintSettingSel(); }
    document.querySelectorAll('#holoTabs .holo-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === TAB_OF[app.view]);
    });
  }

  /* -------------------------------------------------- 홀로그램 UI: ← ✓ → 3버튼 조작 (docs/UI_CONTROLS.md) */
  function setFocus(where) {
    app.focus = where;
    document.documentElement.dataset.focus = where;
  }

  function stepTab(step) {
    const i = Math.max(0, TABS.indexOf(app.view));
    switchView(TABS[(i + step + TABS.length) % TABS.length]);
  }

  function paintSettingSel() {
    SETTING_ROWS.forEach((id, i) => {
      const n = el(id);
      if (n) n.classList.toggle('kbd-sel', app.view === 'settings' && app.focus === 'view' && i === app.settingIdx);
    });
  }

  function stepRoomBot(step) {
    const i = BOT_IDS.indexOf(app.selected);
    const next = BOT_IDS[(i + step + BOT_IDS.length) % BOT_IDS.length];
    app.selected = next;
    window.House.setSelected(next);
    renderAll();
  }

  function holoMove(step) {
    if (app.focus === 'tabs') { stepTab(step); return; }
    const care = app.sheet === 'care';
    if (app.view === 'tamagotchi') { if (care) moveCare(step); else stepBot(step); }
    else if (app.view === 'house') { if (!el('popover').hidden) closePopover(); stepRoomBot(step); }
    else if (app.view === 'usage') pageStep(step);
    else if (app.view === 'settings') {
      if (app.sheet !== 'menu') return;
      app.settingIdx = (app.settingIdx + step + SETTING_ROWS.length) % SETTING_ROWS.length;
      paintSettingSel();
      const n = el(SETTING_ROWS[app.settingIdx]);
      if (n) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function holoOk() {
    if (app.focus === 'tabs') { setFocus('view'); paintSettingSel(); return; }
    if (app.view === 'tamagotchi') { if (app.sheet === 'care') runCare(); else openSheet('care'); }
    else if (app.view === 'house') openPopover(app.selected || BOT_IDS[0]);
    else if (app.view === 'usage') loadUsage(true);
    else if (app.view === 'settings') {
      if (app.sheet !== 'menu') { openSheet('menu'); return; }
      const n = el(SETTING_ROWS[app.settingIdx]);
      if (n) n.click();
    }
  }

  // 뒤로: 열린 창(설정 창 → 팝오버 → 액정 시트)부터 닫고, 없으면 탭 줄로
  function holoBack() {
    if (!el('settingsModal').hidden) { el('settingsModal').hidden = true; return; }
    if (!el('popover').hidden) { closePopover(); return; }
    if (app.sheet && app.view !== 'settings') { closeSheet(); return; }
    if (app.sheet === 'log') { openSheet('menu'); return; }
    setFocus('tabs');
    paintSettingSel();
  }

  function bindHoloKeys() {
    const ok = document.querySelector('.holo-key.ok');
    document.querySelectorAll('.holo-key[data-hkey="L"], .holo-key[data-hkey="R"]').forEach((k) => {
      k.addEventListener('click', () => {
        if (window.Sfx) window.Sfx.play('click');
        holoMove(k.dataset.hkey === 'L' ? -1 : 1);
      });
    });
    if (!ok) return;
    let timer = null;
    let held = false;
    ok.addEventListener('pointerdown', () => {
      held = false;
      ok.classList.add('down');
      timer = setTimeout(() => { held = true; ok.classList.add('hold'); holoBack(); }, 600);
    });
    const end = (run) => {
      clearTimeout(timer);
      ok.classList.remove('down', 'hold');
      if (run && !held) holoOk();
      held = false;
    };
    ok.addEventListener('pointerup', () => end(true));
    ok.addEventListener('pointerleave', () => end(false));
    ok.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });

    el('holoTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.holo-tab');
      if (!btn) return;
      const view = TABS.find((v) => TAB_OF[v] === btn.dataset.tab);
      switchView(view);
      setFocus('view');
      paintSettingSel();
    });
  }

  // 홀로그램 글리치: 몇 초마다 화면이 가로로 살짝 어긋났다 돌아온다 (캐릭터 홀로그램과 같은 느낌)
  function startGlitch() {
    const screen = el('screenWrap');
    if (!screen || !document.documentElement.classList.contains('ui-holo')) return;
    const once = () => {
      const dir = Math.random() < 0.5 ? -1 : 1;
      screen.style.setProperty('--glitch-x', `${dir * (2 + Math.random() * 4)}px`);
      screen.style.setProperty('--slice-y', `${10 + Math.random() * 75}%`);
      screen.style.setProperty('--slice-h', `${3 + Math.random() * 9}%`);
      screen.classList.add('glitch');
      setTimeout(() => screen.classList.remove('glitch'), 70 + Math.random() * 90);
    };
    const loop = () => {
      once();
      if (Math.random() < 0.35) setTimeout(once, 160);
      setTimeout(loop, 2200 + Math.random() * 4200);
    };
    setTimeout(loop, 1500);
  }

  function stepView(step) {
    const i = VIEWS.indexOf(app.view);
    switchView(VIEWS[(i + step + VIEWS.length) % VIEWS.length]);
  }

  /* -------------------------------------------- 화면 단위 넘기기 (D-패드 위·아래, 휠) */
  function isScroller(node) {
    if (!node || node.nodeType !== 1 || node.hidden) return false;
    const oy = getComputedStyle(node).overflowY;
    return (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2;
  }

  function scrollerIn(root) {
    if (!root || root.hidden) return null;
    if (isScroller(root)) return root;
    for (const node of root.querySelectorAll('*')) {
      if (node.offsetParent !== null && isScroller(node)) return node;
    }
    return null;
  }

  // 지금 보이는 패널에서 넘길 수 있는 목록: 열린 시트가 먼저, 없으면 현재 화면
  function activeScroller() {
    if (app.sheet) {
      const sheet = Array.from(document.querySelectorAll('.sheet')).find((s) => !s.hidden);
      return scrollerIn(sheet);
    }
    const views = { tamagotchi: 'tamaView', house: 'sceneHolder', usage: 'usageView' };
    return scrollerIn(el(views[app.view]));
  }

  // 한 번에 한 화면씩 (윗줄 조금 겹쳐서 어디까지 봤는지 이어지게)
  function pageBy(sc, dir) {
    const max = sc.scrollHeight - sc.clientHeight;
    const atEdge = dir > 0 ? sc.scrollTop >= max - 2 : sc.scrollTop <= 2;
    if (atEdge) return false;
    sc.scrollBy({ top: dir * Math.max(40, sc.clientHeight - 20), behavior: 'smooth' });
    return true;
  }

  // 위·아래: 넘길 게 남았으면 한 화면 넘기고, 끝이면 다음 화면(홈·집·사용량)으로
  function pageStep(dir) {
    const sc = activeScroller();
    if (sc && pageBy(sc, dir)) return;
    stepView(dir);
  }

  let wheelLock = 0;
  function onWheel(e) {
    if (!e.deltaY || e.ctrlKey) return;
    let node = e.target;
    while (node && node !== document.body && !isScroller(node)) node = node.parentElement;
    if (!node || node === document.body) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 380;
    pageBy(node, e.deltaY > 0 ? 1 : -1);
  }

  function stepBot(step) {
    if (!window.Tama) return;
    const i = BOT_IDS.indexOf(window.Tama.focusId());
    window.Tama.focus(BOT_IDS[(i + step + BOT_IDS.length) % BOT_IDS.length]);
  }

  function toggleTamaMode() {
    if (app.view !== 'tamagotchi') switchView('tamagotchi');
    const on = document.querySelector('.tama-mode.on');
    const next = on && on.dataset.mode === 'all' ? 'focus' : 'all';
    window.Tama.setMode(next);
  }

  /* -------------------------------------------------- 창 모드 ("치킹!" 변신) */
  let morphTimer = null;
  const WIN_MS = 320;

  function applyWindowMode(mode, animate = false) {
    const name = mode === 'all' ? 'wide' : 'compact';
    if (document.documentElement.dataset.win === name && !animate) return;
    document.documentElement.dataset.win = name;
    if (bridge.setWindowMode) {
      try { bridge.setWindowMode(name, { duration: WIN_MS }); } catch (_) { /* 미리보기에서는 창이 없어요 */ }
    }
    if (!animate) return;
    if (window.Sfx) window.Sfx.play(name === 'wide' ? 'expand' : 'collapse');
    const device = el('device');
    device.classList.remove('morph');
    void device.offsetWidth; // 애니메이션 재시작
    device.classList.add('morph');
    clearTimeout(morphTimer);
    morphTimer = setTimeout(() => device.classList.remove('morph'), 780);
  }

  function tickClock() {
    const node = el('lcdClock');
    if (!node) return;
    const d = new Date();
    node.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /* -------------------------------------------------- 이벤트 */
  function bind() {
    el('themeBtn').addEventListener('click', async () => {
      const next = app.settings.theme === 'day' ? 'night' : 'day';
      app.settings = await bridge.saveSettings({ theme: next });
      applyTheme(next);
      setThemeButtons(next);
    });

    el('viewSwitch').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (btn) switchView(btn.dataset.view);
    });

    el('tokenChip').addEventListener('click', () => switchView('usage'));
    el('usageRefresh').addEventListener('click', async () => {
      el('usageRefresh').disabled = true;
      await loadUsage(true);
      el('usageRefresh').disabled = false;
    });

    // 창 컨트롤
    el('winMin').addEventListener('click', () => bridge.hideWindow());
    // × = 트레이로 숨기기 (설정에서 끈 경우에만 종료). 완전 종료는 메뉴의 '앱 종료'나 트레이 메뉴에서.
    el('winClose').addEventListener('click', () => {
      if (app.settings.minimizeToTray === false) bridge.quit();
      else bridge.hideWindow();
    });

    // 물리 버튼 (D-패드 + A·B)
    document.querySelectorAll('.dbtn, .ab-key').forEach((key) => {
      key.addEventListener('click', () => {
        const k = key.dataset.key;
        const care = app.sheet === 'care';
        if (k === 'UP') pageStep(-1);
        else if (k === 'DOWN') pageStep(1);
        else if (k === 'LEFT') { if (care) moveCare(-1); else stepBot(-1); }
        else if (k === 'RIGHT') { if (care) moveCare(1); else stepBot(1); }
        else if (k === 'A') { if (care) runCare(); else openSheet('care'); }
        else if (k === 'C') toggleSheet('menu');
        else if (k === 'B') { if (app.sheet) closeSheet(); else toggleTamaMode(); }
      });
    });

    // 메뉴 시트
    el('menuClose').addEventListener('click', () => { if (app.view === 'settings') { switchView('tamagotchi'); setFocus('tabs'); } else closeSheet(); });
    el('careClose').addEventListener('click', closeSheet);

    el('settingsBtn').addEventListener('click', () => {
      fillSettings();
      el('settingsModal').hidden = false;
    });
    el('settingsClose').addEventListener('click', () => { el('settingsModal').hidden = true; });
    el('settingsModal').addEventListener('click', (e) => {
      if (e.target === el('settingsModal')) el('settingsModal').hidden = true;
    });
    el('settingsSave').addEventListener('click', saveSettings);
    el('pickDir').addEventListener('click', async () => {
      const dir = await bridge.pickDir();
      if (dir) el('workDir').value = dir;
    });
    document.querySelectorAll('#themeSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        app.settings.theme = b.dataset.theme;
        setThemeButtons(b.dataset.theme);
        applyTheme(b.dataset.theme);
      });
    });

    el('hideBtn').addEventListener('click', () => bridge.hideWindow());
    el('quitBtn').addEventListener('click', () => bridge.quit());

    el('logBtn').addEventListener('click', () => openSheet('log'));
    el('logClose').addEventListener('click', closeSheet);
    el('logClear').addEventListener('click', () => {
      app.logs = [];
      el('logBody').innerHTML = '';
    });
    el('logRestart').addEventListener('click', async () => {
      el('logRestart').disabled = true;
      await bridge.restartClaude();
      el('logRestart').disabled = false;
    });
    el('claudeLog').addEventListener('click', () => openSheet('log'));
    el('claudeRestart').addEventListener('click', async () => {
      const btn = el('claudeRestart');
      btn.disabled = true;
      btn.textContent = '다시 연결 중…';
      await bridge.restartClaude();
      setTimeout(() => { btn.disabled = false; btn.textContent = '재연결'; }, 1200);
    });

    const checkUpdate = async () => {
      if (!bridge.checkUpdate) return;
      app.update = { status: 'checking' };
      renderUpdate();
      app.update = await bridge.checkUpdate();
      renderUpdate();
    };
    el('updateBtn').addEventListener('click', async () => {
      if ((app.update || {}).status === 'ready') {
        if (bridge.installUpdate) await bridge.installUpdate();
      } else {
        await checkUpdate();
      }
    });
    el('updateRow').addEventListener('click', checkUpdate);
    el('updateCheck').addEventListener('click', checkUpdate);

    el('popClose').addEventListener('click', closePopover);
    el('popToggle').addEventListener('click', async () => {
      const id = el('popToggle').dataset.bot;
      const st = app.bots[id] || {};
      const next = st.state === 'working' ? 'idle' : 'working';
      app.bots = await bridge.setBotState({ bot: id, state: next, note: next === 'working' ? '테스트 작업 중' : '' });
      renderAll();
      openPopover(id);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { holoBack(); return; }
      if (e.target && e.target.tagName === 'INPUT') return;
      // 홀로그램 3버튼과 같은 키: ← → = 이동, Enter = ✓
      if (el('settingsModal').hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        holoMove(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (el('settingsModal').hidden && e.key === 'Enter') {
        e.preventDefault();
        holoOk();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
        if (!el('settingsModal').hidden) return;
        e.preventDefault();
        pageStep(e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1);
        return;
      }
      if (app.view !== 'tamagotchi' || app.sheet) return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= 4) window.Tama.focus(BOT_IDS[idx - 1]);
      else if (e.key === 'ArrowLeft') stepBot(-1);
      else if (e.key === 'ArrowRight') stepBot(1);
      else if (e.key === 'ArrowUp') stepView(-1);
      else if (e.key === 'ArrowDown') stepView(1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        window.Tama.act('pet');
      }
    });

    // 휠도 한 줄씩이 아니라 한 화면씩 (설정 창은 그대로 일반 스크롤)
    el('screenWrap').addEventListener('wheel', onWheel, { passive: false });

    document.addEventListener('tama-mode', (e) => {
      applyWindowMode((e.detail || {}).mode, true);
    });

    document.addEventListener('tama-focus', (e) => {
      if (app.sheet !== 'care') return;
      const id = (e.detail || {}).id;
      const def = app.botDefs.find((b) => b.id === id) || { name: '오이지' };
      const st = app.bots[id] || { state: 'idle' };
      el('careTitle').textContent = `${def.name} 돌보기`;
      el('careName').textContent = def.name;
      el('careState').textContent = `${stateLabel[st.state] || '쉬는 중'}${st.note ? ' · ' + st.note : ''}`;
      setAvatar(el('careAvatar'), id);
    });

    document.addEventListener('click', (e) => {
      const pop = el('popover');
      if (pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (e.target.closest('.status-chip') || e.target.closest('.bot-row')) return;
      if (e.target.closest('#scene')) return;
      closePopover();
    });
  }

  async function boot() {
    const init = await bridge.init();
    app.settings = init.settings || {};
    app.bots = init.bots || {};
    app.botDefs = init.botDefs || [];
    app.claude = init.claude || {};
    app.logs = init.logs || [];
    app.statusServer = init.statusServer || {};
    app.update = init.update || {};

    applyTheme(app.settings.theme || 'night');
    if (window.Sfx) window.Sfx.setEnabled(app.settings.soundOn !== false);
    tickClock();
    setInterval(tickClock, 15000);

    await window.House.init({
      canvas: el('house'),
      scene: el('scene'),
      bubbles: el('bubbles'),
      bots: app.bots,
      botDefs: app.botDefs,
      onSelect: (id) => openPopover(id)
    });
    await window.Tama.init({
      canvas: el('tamaStage'),
      screen: el('tamaScreen'),
      bots: app.bots,
      botDefs: app.botDefs,
      theme: app.settings.theme || 'night'
    });
    bind();
    bindHoloKeys();
    setFocus('tabs');
    switchView(window.__PREVIEW_VIEW__ || app.view);
    startGlitch();
    applyWindowMode('focus', false);
    renderAll();
    setInterval(renderClaudeCard, 5000);
    setInterval(paintAvatars, 140);
    setInterval(() => { if (app.selected) renderAll(); }, 30000);

    bridge.onBots((bots) => { app.bots = bots; window.House.setBots(bots); renderAll(); });
    bridge.onClaude((claude) => { app.claude = claude; renderClaudeCard(); });
    bridge.onLog((entry) => appendLog(entry));
    bridge.onSettings((settings) => { app.settings = settings; applyTheme(settings.theme); });
    bridge.onUsage((u) => { if (app.view === 'usage') renderUsage(u); });
    if (bridge.onUpdate) bridge.onUpdate((u) => { app.update = u; renderUpdate(); });
    loadUsage(false);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();

/* 물리 버튼 누름 애니: 누르는 동안 .down, 놓을 때 .pop (마우스·터치·키보드 공통) */
(function () {
  const SEL = '.holo-key, .hb-top, .rail-switch, .win-btn.close';
  const release = (b) => {
    if (!b.classList.contains('down')) return;
    b.classList.remove('down');
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    setTimeout(() => b.classList.remove('pop'), 180);
  };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest(SEL);
    if (b) b.classList.add('down');
  });
  document.addEventListener('pointerup', () => document.querySelectorAll(SEL).forEach(release));
  document.addEventListener('pointercancel', () => document.querySelectorAll(SEL).forEach(release));
})();

/* 레이어 기기 (장현님 11-26): 오이지 아트 크롭 레이어. 색 4종은 기기 우클릭으로 바꾸고 기억 */
(function () {
  const root = document.documentElement, KEY = 'aimon.deviceColor', COLORS = ['gunmetal', 'obsidian', 'arctic', 'cobalt'];
  let c = 'gunmetal';
  try { const s = localStorage.getItem(KEY); if (COLORS.includes(s)) c = s; } catch (e) { /* 저장소 없으면 기본색 */ }
  root.classList.add('dev-art');
  root.dataset.dev = c;
  const nextColor = () => {
    c = COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];
    root.dataset.dev = c;
    try { localStorage.setItem(KEY, c); } catch (err) { /* 무시 */ }
  };
  // 윗면 버튼: 짧게 = 기본 동작, 길게(0.6초) = 보조 동작
  document.querySelectorAll('.hb-top').forEach((b) => {
    let timer = 0, long = false;
    b.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => {
      long = true;
      if (b.dataset.act === 'power') { const q = document.getElementById('winClose'); if (q) q.click(); }
      else nextColor();
    }, 600); });
    const cancel = () => clearTimeout(timer);
    b.addEventListener('pointerleave', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('click', () => {
      clearTimeout(timer);
      if (long) return;
      if (b.dataset.act === 'power') root.classList.toggle('holo-off');
      else { const t = document.getElementById('themeBtn'); if (t) t.click(); }
    });
  });
  // 기기 LCD: 홀로그램 탭과 같이 바뀌는 아이콘·이름·쪽 점
  const tabs = [...document.querySelectorAll('#holoTabs .holo-tab')];
  const icon = document.getElementById('hbLcdIcon'), label = document.getElementById('hbLcdLabel'), dots = document.getElementById('hbLcdDots');
  const LCD_NAME = { room: 'ROOM', characters: 'MONS', usage: 'USAGE', settings: 'SETUP' };
  const paintLcd = () => {
    const i = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
    const t = tabs[i];
    if (!t || !icon) return;
    const svg = t.querySelector('svg').outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    icon.style.setProperty('--lcd-icon', 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")');
    icon.dataset.tab = t.dataset.tab;
    label.textContent = LCD_NAME[t.dataset.tab] || t.dataset.tab.toUpperCase();
    dots.innerHTML = tabs.map((_, k) => '<i' + (k === i ? ' class="on"' : '') + '></i>').join('');
  };
  paintLcd();
  tabs.forEach((t) => new MutationObserver(paintLcd).observe(t, { attributes: true, attributeFilter: ['class'] }));
  const base = document.getElementById('holoBase');
  if (base) base.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    c = COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];
    root.dataset.dev = c;
    try { localStorage.setItem(KEY, c); } catch (err) { /* 무시 */ }
  });
})();
