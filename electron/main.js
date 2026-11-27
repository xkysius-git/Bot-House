'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Store } = require('./store');
const { ClaudeManager } = require('./claude-manager');
const { StatusServer } = require('./status-server');
const { BOTS, initialBotState, isBot } = require('./bots');
const { UsageMonitor } = require('./usage');
const { ExternalClaudeWatcher } = require('./external-claude');
const { TelegramChat } = require('./chat-telegram');
const { ChatLogWatch } = require('./chatlog-watch');

const ROOT = path.join(__dirname, '..');

/* 기존 설치본과 같은 설정 폴더를 쓴다.
 * 앱 이름(productName)이 Bot House → A.I.Mon으로 바뀌면 Electron의 userData 기본 경로도
 * %APPDATA%\A.I.Mon으로 옮겨가서, 설정·텔레그램 로그인·봇 상태가 사라진 것처럼 보인다.
 * 1.0.5까지 쓰던 경로를 그대로 고정해 업데이트해도 그대로 이어지게 한다. */
app.setPath('userData', path.join(app.getPath('appData'), 'Bot House'));

const WORKING_WINDOW_MS = 25000;   // 최근 25초 안에 활동이 있으면 '작업 중'
const SIGNAL_TTL_MS = 30 * 60 * 1000; // 외부에서 받은 상태는 30분 뒤 기본값으로
const HEARTBEAT_TTL_MS = 10 * 60 * 1000; // 원격 봇이 10분 넘게 신호가 없으면 오프라인
const GIST_POLL_MS = 60 * 1000;          // Gist 상태 확인 간격
const EXTERNAL_WORKING_MS = 60 * 1000;   // 다른 창 세션: 대화 기록이 1분 안에 갱신되면 '작업 중'
const CHAT_ACTIVE_MS = 3 * 60 * 1000;    // 봇이 채팅에 말하면 3분은 '작업 중'
const CHAT_TASK_MS = 30 * 60 * 1000;     // '작업 시작' 류 말은 완료 보고 전까지 최대 30분
const SLEEP_AFTER_MS = 20 * 60 * 1000;   // 20분 넘게 조용하면 침실에서 잔다
const CHATLOG_DIR_DEFAULT = process.platform === 'win32' ? 'C:/claude-telegram/chatlog' : ''; // 이 PC의 그룹 채팅 기록 폴더

let win = null;
let tray = null;
let store = null;
let manager = null;
let statusServer = null;
let statusPollTimer = null;
let usageMonitor = null;
let externalClaude = null;
let chat = null;
let chatLog = null;
let quitting = false;
let lastBotsPush = 0;

const botSignals = initialBotState();

/* --------------------------------------------------------------- 상태 계산 */
function computeBots() {
  const now = Date.now();
  const out = {};
  for (const bot of BOTS) {
    const sig = botSignals[bot.id];
    const base = { ...sig };
    if (bot.id === 'claude') {
      const c = manager ? manager.status : 'stopped';
      const connected = c === 'running' || c === 'starting';
      const ext = externalClaude ? externalClaude.snapshot() : null;
      if (!connected && ext && ext.running) {
        // 앱이 띄운 세션은 없지만 다른 창에서 켠 claude --channels 가 살아 있음
        const busy = ext.lastActivity && (now - ext.lastActivity < EXTERNAL_WORKING_MS);
        base.state = busy ? 'working' : 'idle';
        base.connected = true;
        base.connection = 'external';
        base.message = '다른 창에서 실행 중인 세션';
        base.lastActivity = ext.lastActivity || null;
        base.note = busy ? '다른 창에서 작업 중' : '다른 창에서 연결됨';
        base.source = 'external';
      } else {
        const busy = connected && manager.lastActivity && (now - manager.lastActivity < WORKING_WINDOW_MS);
        base.state = connected ? (busy ? 'working' : 'idle') : 'offline';
        base.connected = connected;
        base.connection = c;
        base.message = manager ? manager.message : '';
        base.lastActivity = busy ? manager.lastActivity : (manager.lastActivity || null);
        base.note = connected ? (busy ? '채널에서 작업 중' : '채널 연결됨') : '채널 연결 안 됨';
        base.source = 'process';
      }
    } else if (sig.source === 'url' && sig.heartbeatAt) {
      // 원격 봇: 봇이 직접 찍은 시각(heartbeatAt) 기준. 오래 신호가 없으면 오프라인.
      const age = now - sig.heartbeatAt;
      if (age > HEARTBEAT_TTL_MS) {
        base.state = 'offline';
        base.note = `신호 끊김 · 마지막 ${formatAgo(age)}`;
        base.connected = false;
      } else {
        base.connected = true;
      }
    } else if (sig.source === 'chat') {
      base.state = sig.workUntil && now < sig.workUntil ? 'working' : 'idle';
      if (base.state === 'idle' && sig.state === 'working') base.note = '휴게실에서 쉬는 중';
      base.connected = true;
    } else {
      if (sig.updatedAt && now - sig.updatedAt > SIGNAL_TTL_MS && sig.source !== 'manual') {
        base.state = 'idle';
        base.note = '휴게실에서 쉬는 중';
        base.source = 'default';
      }
      base.connected = true;
    }
    // 오래 조용하면 침실에서 잔다 (작업 중·오프라인이 아닐 때만)
    // 활동 기록이 아예 없거나(오늘 한 번도 말 안 함) 20분 넘게 조용하면 침실
    base.sleeping = base.state === 'idle' && (!base.lastActivity || now - base.lastActivity > SLEEP_AFTER_MS);
    if (base.sleeping) base.note = '침실에서 자는 중';
    out[bot.id] = base;
  }
  return out;
}

// "클로드 채널" 카드용 스냅샷. 앱이 띄운 세션이 없고 다른 창 세션이 있으면 그걸로 채운다.
function claudeSnapshot() {
  const base = manager.snapshot();
  const ext = externalClaude ? externalClaude.snapshot() : null;
  if (base.status === "running" || base.status === "starting" || !ext || !ext.running) return base;
  return {
    ...base,
    status: "running",
    message: "다른 창에서 실행 중인 세션",
    pid: ext.pids[0] || null,
    startedAt: ext.since,
    cwd: "다른 창 (터미널)",
    external: true,
    lastActivity: ext.lastActivity || base.lastActivity
  };
}

function pushBots(force = false) {
  const now = Date.now();
  if (!force && now - lastBotsPush < 180) return;
  lastBotsPush = now;
  if (win && !win.isDestroyed()) win.webContents.send('bots', computeBots());
}

function setBotState({ bot, state, note, source, usage }) {
  if (!isBot(bot)) return;
  const sig = botSignals[bot];
  if (usage && typeof usage === 'object') {
    sig.usage = {
      todayTokens: Number(usage.todayTokens ?? usage.today ?? 0) || 0,
      weekTokens: Number(usage.weekTokens ?? usage.week ?? 0) || 0,
      quotaUsedPercent: usage.quotaUsedPercent === undefined ? null : Number(usage.quotaUsedPercent),
      quotaResetsAt: usage.quotaResetsAt || null,
      note: typeof usage.note === 'string' ? usage.note.slice(0, 80) : ''
    };
    sig.usageAt = Date.now();
  }
  sig.state = state;
  sig.note = note || (state === 'working' ? '작업 중' : state === 'offline' ? '오프라인' : '휴게실에서 쉬는 중');
  sig.updatedAt = Date.now();
  sig.source = source || 'manual';
  if (state === 'working') sig.lastActivity = Date.now();
  pushBots(true);
  if (win && !win.isDestroyed()) win.webContents.send('bots', computeBots());
}

/* --------------------------------------------------------------- 상태 폴링 */
// 상태 주소가 GitHub Gist면 Gist ID를 돌려준다. (gist URL 또는 32자리 ID 그대로 입력 가능)
function gistIdFrom(url) {
  const m = url.match(/^(?:https?:\/\/gist\.github\.com\/(?:[^/]+\/)?)?([0-9a-f]{20,40})\/?$/i);
  return m ? m[1] : null;
}

function parseTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // 초 단위도 허용
  if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
  return null;
}

function formatAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

function applyRemoteSignal(id, value) {
  if (!isBot(id) || id === 'claude') return;
  const state = typeof value === 'string' ? value : value && value.state;
  if (!['idle', 'working', 'offline'].includes(state)) return;
  const now = Date.now();
  const sig = botSignals[id];
  sig.state = state;
  sig.note = (value && typeof value.note === 'string' && value.note.slice(0, 80)) || '';
  sig.updatedAt = now;
  sig.source = 'url';
  // 봇이 보낸 시각이 있으면 그걸로 생존 판단, 없으면 받은 시각. 미래 시각은 지금으로 자름.
  sig.heartbeatAt = Math.min(parseTime(value && value.updatedAt) || now, now);
  if (state === 'working') sig.lastActivity = sig.heartbeatAt;
}

const gistCache = { id: null, etag: null, files: null, fetchedAt: 0 };

// 앱 안 채팅으로 들어온 봇 메시지로 상태 추정 (Gist를 못 쓰는 봇용: 오이지·석박지 등)
const START_WORDS = /(작업\s*시작|착수|진행할게|진행하겠|시작할게|시작하겠|바로\s*진행|처리\s*중|작업\s*중)/;
const DONE_WORDS = /(완료|끝났|마쳤|마무리했|반영했|보고드립니다|정리\s*끝)/;

function applyChatSignal(msg) {
  if (!msg || !msg.isBot || !msg.username) return;
  const def = BOTS.find((b) => b.handle && b.handle.replace(/^@/, '').toLowerCase() === msg.username.toLowerCase());
  if (!def || def.id === 'claude') return;
  const sig = botSignals[def.id];
  const now = Date.now();
  const at = Math.min(msg.date || now, now);
  if (sig.lastActivity && at < sig.lastActivity) return; // 같은 메시지가 두 경로로 오거나 순서가 뒤집힌 경우
  sig.lastActivity = at;
  // Gist 신호가 살아 있으면 그게 더 정확하니 활동 시각만 갱신
  if (sig.source === 'url' && sig.heartbeatAt && now - sig.heartbeatAt < HEARTBEAT_TTL_MS) { pushBots(true); return; }
  const text = msg.text || '';
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  if (DONE_WORDS.test(text)) {
    sig.workUntil = 0;
    sig.state = 'idle';
    sig.note = `방금 보고 · ${firstLine.slice(0, 40)}`;
  } else if (START_WORDS.test(text)) {
    sig.workUntil = at + CHAT_TASK_MS;
    sig.state = 'working';
    sig.note = firstLine.slice(0, 60);
  } else {
    sig.workUntil = Math.max(sig.workUntil || 0, at + CHAT_ACTIVE_MS);
    if (sig.state !== 'working') sig.note = '채팅방에서 대화 중';
    sig.state = 'working';
  }
  sig.updatedAt = at; // 30분(SIGNAL_TTL_MS) 조용하면 기본 '쉬는 중'으로 돌아감
  sig.source = 'chat';
  pushBots(true);
}

async function pollStatusUrl() {
  const settings = store.all();
  const url = (settings.statusUrl || '').trim();
  if (!url) return;
  try {
    const gistId = gistIdFrom(url);
    if (gistId) {
      // GitHub API 무인증 한도(시간당 60회) 때문에 Gist는 60초마다만 확인. 304 응답은 한도에 안 잡힘.
      if (gistCache.id === gistId && Date.now() - gistCache.fetchedAt < GIST_POLL_MS) return;
      if (gistCache.id !== gistId) Object.assign(gistCache, { id: gistId, etag: null, files: null });
      gistCache.fetchedAt = Date.now();
      const headers = { 'User-Agent': 'A.I.Mon', Accept: 'application/vnd.github+json' };
      if (gistCache.etag) headers['If-None-Match'] = gistCache.etag;
      const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 200) {
        const data = await res.json();
        gistCache.etag = res.headers.get('etag');
        gistCache.files = data.files || {};
      } else if (res.status !== 304) {
        return;
      }
      if (!gistCache.files) return;
      // 파일 하나 = 봇 하나 (oiji.json, takuan.json, sbji.json). 서로 덮어쓰지 않게 분리.
      for (const [name, file] of Object.entries(gistCache.files)) {
        const id = name.replace(/\.json$/i, '');
        try { applyRemoteSignal(id, JSON.parse(file.content || '{}')); } catch (_) { /* 깨진 파일은 건너뜀 */ }
      }
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      const bots = data && (data.bots || data);
      if (!bots || typeof bots !== 'object') return;
      for (const [id, value] of Object.entries(bots)) applyRemoteSignal(id, value);
    }
    pushBots(true);
  } catch (_) { /* 조용히 무시 */ }
}

/* --------------------------------------------------------------- 창/트레이 */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// 창을 닫은 직후에는 외부 세션 감지 결과가 15초 늦게 갱신되므로 바로 한 번 다시 확인한다
function refreshExternal() {
  if (!externalClaude) return;
  externalClaude.scan().then(() => {
    send('claude', claudeSnapshot());
    pushBots(true);
  }).catch(() => {});
}

/* --------------------------------------------------------------- 기기 창 (작은 기기 ↔ 펼친 기기)
 * renderer가 기기 크기(논리 px)를 device.configure로 알려주고, device.setMode로 접기/펼치기.
 * 창은 가운데를 기준으로 좌우로 늘어나고 줄어든다. 배율(deviceScale)은 창 크기와 화면 확대율에 같이 곱한다.
 * 기본 크기는 오이지 디자인 기준 (한 마리 580x450, 전체 보기 940x450). 자세한 건 docs/DEVICE.md */
const device = {
  sizes: { compact: { w: 792, h: 440 }, expanded: { w: 1152, h: 440 } },
  mode: 'compact',
  anim: null
};
const DEVICE_SCALES = [
  { label: '작게', value: 0.8 },
  { label: '보통', value: 1 },
  { label: '크게', value: 1.25 },
  { label: '아주 크게', value: 1.5 }
];

function deviceScale() {
  const v = Number(store.get('deviceScale'));
  return v >= 0.4 && v <= 2 ? v : 1;
}

function deviceSize(mode = device.mode) {
  const s = deviceScale();
  const base = device.sizes[mode] || device.sizes.compact;
  return { w: Math.round(base.w * s), h: Math.round(base.h * s) };
}

function setWindowSize(w, h, centerX, centerY) {
  win.setResizable(true);
  win.setBounds({ x: Math.round(centerX - w / 2), y: Math.round(centerY - h / 2), width: w, height: h });
  win.setResizable(false);
}

// 현재 중심을 유지한 채 창 크기를 부드럽게 바꾼다 (ease-out)
function animateWindowTo(w, h, duration) {
  if (!win || win.isDestroyed()) return Promise.resolve();
  if (device.anim) { clearInterval(device.anim.timer); device.anim.resolve(); }
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (!duration || duration <= 0) { setWindowSize(w, h, cx, cy); return Promise.resolve(); }
  const from = { w: b.width, h: b.height };
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(timer); device.anim = null; return resolve(); }
      const t = Math.min(1, (Date.now() - start) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      setWindowSize(Math.round(from.w + (w - from.w) * k), Math.round(from.h + (h - from.h) * k), cx, cy);
      if (t >= 1) { clearInterval(timer); device.anim = null; resolve(); }
    }, 16);
    device.anim = { timer, resolve };
  });
}

function applyDeviceScale() {
  if (!win || win.isDestroyed()) return;
  const { w, h } = deviceSize();
  animateWindowTo(w, h, 0);
  win.webContents.setZoomFactor(deviceScale());
}

function setDeviceScale(value) {
  store.set({ deviceScale: value });
  applyDeviceScale();
  buildTrayMenu();
}

function validSize(o) {
  const w = Number(o && o.w);
  const h = Number(o && o.h);
  return w >= 160 && w <= 2400 && h >= 160 && h <= 1600 ? { w: Math.round(w), h: Math.round(h) } : null;
}

function configureDevice(payload) {
  const compact = validSize(payload && payload.compact);
  const expanded = validSize(payload && payload.expanded) || compact;
  if (!compact) return { ok: false, error: 'compact 크기가 필요해요 ({ w, h })' };
  device.sizes = { compact, expanded };
  applyDeviceScale();
  return { ok: true, mode: device.mode, scale: deviceScale() };
}

async function setDeviceMode(mode, opts = {}) {
  device.mode = mode === 'expanded' ? 'expanded' : 'compact';
  const { w, h } = deviceSize();
  const duration = Math.max(0, Math.min(1500, Number(opts.duration ?? 320)));
  await animateWindowTo(w, h, duration);
  return { ok: true, mode: device.mode };
}

function createWindow() {
  const first = deviceSize('compact');
  win = new BrowserWindow({
    // 기기 모양 그대로 바탕화면에 띄우기: 창 테두리 없음 + 투명 배경 + 크기는 renderer가 정함
    // 이동은 renderer의 -webkit-app-region: drag 영역, 닫기/숨기기는 기기 버튼
    width: first.w,
    height: first.h,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'A.I.Mon',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  // 페이지를 새로 그릴 때마다 확대율 다시 적용 (Electron은 새로고침 때 확대율이 풀릴 수 있음)
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(deviceScale()));

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (quitting) return;
    if (store.get('minimizeToTray')) {
      event.preventDefault();
      win.hide();
      if (tray && process.platform === 'win32') {
        tray.displayBalloon?.({
          title: 'A.I.Mon',
          content: '창을 닫아도 봇들은 계속 집에 있어요. 트레이에서 다시 열 수 있어요.'
        });
      }
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function trayImage() {
  const trayPath = path.join(ROOT, 'assets', 'tray.png');
  const file = fs.existsSync(trayPath) ? trayPath : path.join(ROOT, 'assets', 'icon.png');
  const img = nativeImage.createFromPath(file);
  return process.platform === 'win32' ? img.resize({ width: 16, height: 16 }) : img;
}

function buildTray() {
  try {
    tray = new Tray(trayImage());
  } catch (err) {
    console.error('[tray] 만들지 못했어요:', err.message);
    return;
  }
  tray.setToolTip('A.I.Mon — 봇들이 사는 집');
  buildTrayMenu();
  tray.on('double-click', () => showWindow());
  tray.on('click', () => showWindow());
}

function buildTrayMenu() {
  if (!tray) return;
  const current = deviceScale();
  const menu = Menu.buildFromTemplate([
    { label: 'A.I.Mon 열기', click: () => showWindow() },
    {
      label: '기기 크기',
      submenu: DEVICE_SCALES.map((o) => ({
        label: o.label,
        type: 'radio',
        checked: Math.abs(o.value - current) < 0.001,
        click: () => setDeviceScale(o.value)
      }))
    },
    { type: 'separator' },
    { label: 'Claude 채널 재연결', click: () => { manager.restart(); showWindow(); } },
    { label: 'Claude 채널 멈추기', click: () => { manager.stop(true); refreshExternal(); } },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

/* --------------------------------------------------------------- 자동 업데이트 */
const updateState = {
  status: 'idle',      // idle | checking | available | downloading | ready | none | error | dev
  version: null,
  percent: 0,
  message: '',
  checkedAt: null
};

function pushUpdate(patch) {
  Object.assign(updateState, patch, { checkedAt: Date.now() });
  send('update', { ...updateState });
  return { ...updateState };
}

function setupUpdater() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[update] electron-updater를 불러오지 못했어요:', err.message);
    pushUpdate({ status: 'error', message: '업데이트 모듈을 불러오지 못했어요' });
    return;
  }

  // 개발 실행(npm start)에서는 업데이트를 확인하지 않는다.
  if (!app.isPackaged) {
    pushUpdate({ status: 'dev', message: '개발 실행 중에는 업데이트를 확인하지 않아요' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => pushUpdate({ status: 'checking', message: '새 버전을 확인하는 중' }));
  autoUpdater.on('update-available', (info) => {
    pushUpdate({ status: 'available', version: info && info.version, percent: 0, message: '새 버전을 내려받는 중' });
  });
  autoUpdater.on('update-not-available', () => {
    pushUpdate({ status: 'none', version: app.getVersion(), percent: 0, message: '지금이 최신 버전이에요' });
  });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.max(0, Math.min(100, Math.round((p && p.percent) || 0)));
    pushUpdate({ status: 'downloading', percent, message: `새 버전을 내려받는 중 ${percent}%` });
  });
  autoUpdater.on('update-downloaded', (info) => {
    // 별도 팝업(윈도우 메시지 박스·알림 풍선) 없이 기기 화면의 '재시작' 버튼으로만 알린다.
    // 누르지 않아도 앱을 끌 때 자동 설치된다.
    pushUpdate({ status: 'ready', version: info && info.version, percent: 100, message: '새 버전 준비 완료 — 재시작하면 적용돼요' });
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  });
  autoUpdater.on('error', (err) => {
    pushUpdate({ status: 'error', message: `업데이트 확인 실패: ${err && err.message ? err.message : '알 수 없는 오류'}` });
  });

  const check = (delay) => {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        pushUpdate({ status: 'error', message: `업데이트 확인 실패: ${err && err.message ? err.message : '알 수 없는 오류'}` });
      });
    }, delay);
  };
  check(15000);                 // 앱이 뜨고 15초 뒤 한 번
  setInterval(() => check(0), 6 * 60 * 60 * 1000);  // 그 뒤 6시간마다

  updaterRef = autoUpdater;
}

let updaterRef = null;

function installUpdateNow() {
  if (!updaterRef) return { ok: false, message: '업데이트 모듈이 준비되지 않았어요' };
  quitting = true;
  try {
    updaterRef.quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    quitting = false;
    return { ok: false, message: err.message };
  }
}

/* --------------------------------------------------------------- IPC */
function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.all(),
    bots: computeBots(),
    botDefs: BOTS,
    claude: claudeSnapshot(),
    logs: manager.logBuffer.slice(-300),
    version: app.getVersion(),
    update: { ...updateState },
    statusServer: { running: statusServer.running, port: statusServer.port, error: statusServer.error },
    home: os.homedir()
  }));

  ipcMain.handle('settings:save', async (_event, patch) => {
    const before = store.all();
    const after = store.set(patch || {});
    if (before.launchAtLogin !== after.launchAtLogin) applyLoginItem(after.launchAtLogin);
    if (before.statusApiEnabled !== after.statusApiEnabled || before.statusApiPort !== after.statusApiPort) {
      statusServer.stop();
      statusServer.port = Number(after.statusApiPort) || 47820;
      if (after.statusApiEnabled) statusServer.start();
    }
    if (before.statusUrl !== after.statusUrl) {
      clearInterval(statusPollTimer);
      statusPollTimer = setInterval(pollStatusUrl, 15000);
    }
    if (['tgApiId', 'tgApiHash', 'chatId'].some((k) => before[k] !== after[k])) {
      chat.connect().catch(() => {});
    }
    send('settings', after);
    return after;
  });

  // 앱 안 채팅 (텔레그램 그룹)
  // 기기 창 접기/펼치기
  ipcMain.handle('device:configure', (_e, payload) => configureDevice(payload));
  ipcMain.handle('device:setMode', (_e, mode, opts) => setDeviceMode(mode, opts || {}));
  ipcMain.handle('device:info', () => ({ mode: device.mode, sizes: device.sizes, scale: deviceScale() }));

  ipcMain.handle('chat:status', () => chat.snapshot());
  ipcMain.handle('chat:connect', () => chat.connect());
  ipcMain.handle('chat:sendCode', (_e, phone) => chat.sendCode(phone));
  ipcMain.handle('chat:submitCode', (_e, code) => chat.submitCode(code));
  ipcMain.handle('chat:submitPassword', (_e, password) => chat.submitPassword(password));
  ipcMain.handle('chat:logout', () => chat.logout());
  ipcMain.handle('chat:history', (_e, opts) => chat.history(opts || {}));
  ipcMain.handle('chat:send', (_e, payload) => chat.send(payload || {}));

  ipcMain.handle('settings:pickDir', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Claude를 실행할 작업 폴더를 골라 주세요',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.get('workDir') || os.homedir()
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('claude:restart', async () => {
    await manager.restart();
    return claudeSnapshot();
  });
  ipcMain.handle('claude:stop', async () => {
    manager.stop(true);
    refreshExternal();
    return claudeSnapshot();
  });
  ipcMain.handle('claude:start', async () => {
    manager.attempts = 0;
    await manager.start();
    return claudeSnapshot();
  });
  ipcMain.handle('logs:get', () => manager.logBuffer.slice(-400));

  ipcMain.handle('usage:get', async (_event, force) => {
    try {
      return await usageMonitor.snapshot(!!force);
    } catch (err) {
      return { error: err.message, tools: [] };
    }
  });

  ipcMain.handle('bot:setState', (_event, payload) => {
    setBotState({ ...payload, source: 'manual' });
    return computeBots();
  });

  ipcMain.handle('window:hide', () => { if (win) win.hide(); });
  ipcMain.handle('update:get', () => ({ ...updateState }));
  ipcMain.handle('update:check', async () => {
    if (!updaterRef) return { ...updateState };
    try {
      await updaterRef.checkForUpdates();
    } catch (err) {
      pushUpdate({ status: 'error', message: `업데이트 확인 실패: ${err.message}` });
    }
    return { ...updateState };
  });
  ipcMain.handle('update:install', () => installUpdateNow());
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('shell:open', (_event, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('status:info', () => ({
    running: statusServer.running, port: statusServer.port, error: statusServer.error,
    url: `http://127.0.0.1:${statusServer.port}/status`
  }));
}

function applyLoginItem(enabled) {
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath, args: [] });
    } else if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: !!enabled });
    }
  } catch (err) {
    console.error('[login] 설정 실패:', err.message);
  }
}

/* --------------------------------------------------------------- 부팅 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    store = new Store(path.join(app.getPath('userData'), 'settings.json'));
    manager = new ClaudeManager(store, ROOT);
    usageMonitor = new UsageMonitor();
    statusServer = new StatusServer({
      port: Number(store.get('statusApiPort')) || 47820,
      getBots: () => computeBots(),
      onUpdate: (payload) => setBotState(payload)
    });

    if (store.get('statusApiEnabled')) statusServer.start();

    chat = new TelegramChat({ store, userDataDir: app.getPath('userData'), safeStorage });
    chat.on('status', (snap) => send('chat:status', snap));
    chat.on('message', (msg) => { send('chat:message', msg); applyChatSignal(msg); });
    chat.on('edited', (msg) => send('chat:edited', msg));
    chat.on('log', (line) => manager.log(line, 'warn'));

    // 이 PC의 채팅 기록으로도 봇 활동을 읽는다 (앱 채팅 로그인 없이도 상태 반영)
    chatLog = new ChatLogWatch(store.get('chatLogDir') || CHATLOG_DIR_DEFAULT);
    chatLog.on('message', applyChatSignal);
    if (chatLog.start()) manager.log('채팅 기록으로 봇 상태 읽는 중', 'info');

    manager.on('log', (entry) => send('log', entry));
    manager.on('state', () => {
      send('claude', claudeSnapshot());
      pushBots(true);
    });
    manager.on('activity', () => pushBots(true));

    applyLoginItem(store.get('launchAtLogin'));

    registerIpc();
    createWindow();
    buildTray();
    setupUpdater();

    // 활동이 끊기면 '작업 중'이 저절로 풀리도록 주기적으로 알린다.
    setInterval(() => pushBots(true), 4000);
    setInterval(async () => {
      try {
        const snap = await usageMonitor.snapshot(true);
        send('usage', snap);
      } catch (_) { /* noop */ }
    }, 60000);
    statusPollTimer = setInterval(pollStatusUrl, 15000);

    // 저장된 로그인이 있으면 채팅 자동 연결 (없으면 설정 필요/로그인 필요 상태로만 둔다)
    setTimeout(() => chat.connect().catch(() => {}), 1500);

    externalClaude = new ExternalClaudeWatcher({ onChange: () => { send("claude", claudeSnapshot()); pushBots(true); } });
    externalClaude.start();

    if (store.get('autoConnect')) {
      setTimeout(async () => {
        // 다른 창에서 이미 같은 채널을 쓰고 있으면 새로 띄우지 않는다 (같은 봇 토큰 이중 연결 → 계속 실패함)
        await externalClaude.scan();
        if (externalClaude.running) {
          manager.log('다른 창에서 Claude 채널이 이미 실행 중이라 새로 띄우지 않아요.', 'muted');
          return;
        }
        manager.start().catch(() => {});
      }, 900);
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    try { manager.dispose(); } catch (_) { /* noop */ }
    try { statusServer.stop(); } catch (_) { /* noop */ }
    try { if (externalClaude) externalClaude.stop(); } catch (_) { /* noop */ }
    try { if (chat) chat.disconnect(true); } catch (_) { /* noop */ }
    clearInterval(statusPollTimer);
  });

  app.on('window-all-closed', () => {
    if (!store || !store.get('minimizeToTray')) app.quit();
  });

  app.on('activate', () => showWindow());
}
