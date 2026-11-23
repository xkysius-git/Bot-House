'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { Store } = require('./store');
const { ClaudeManager } = require('./claude-manager');
const { StatusServer } = require('./status-server');
const { BOTS, initialBotState, isBot } = require('./bots');
const { UsageMonitor } = require('./usage');

const ROOT = path.join(__dirname, '..');
const WORKING_WINDOW_MS = 25000;   // 최근 25초 안에 활동이 있으면 '작업 중'
const SIGNAL_TTL_MS = 30 * 60 * 1000; // 외부에서 받은 상태는 30분 뒤 기본값으로

let win = null;
let tray = null;
let store = null;
let manager = null;
let statusServer = null;
let statusPollTimer = null;
let usageMonitor = null;
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
      const busy = connected && manager.lastActivity && (now - manager.lastActivity < WORKING_WINDOW_MS);
      base.state = connected ? (busy ? 'working' : 'idle') : 'offline';
      base.connected = connected;
      base.connection = c;
      base.message = manager ? manager.message : '';
      base.lastActivity = busy ? manager.lastActivity : (manager.lastActivity || null);
      base.note = connected ? (busy ? '채널에서 작업 중' : '채널 연결됨') : '채널 연결 안 됨';
      base.source = 'process';
    } else {
      if (sig.updatedAt && now - sig.updatedAt > SIGNAL_TTL_MS && sig.source !== 'manual') {
        base.state = 'idle';
        base.note = '휴게실에서 쉬는 중';
        base.source = 'default';
      }
      base.connected = true;
    }
    out[bot.id] = base;
  }
  return out;
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
async function pollStatusUrl() {
  const settings = store.all();
  const url = (settings.statusUrl || '').trim();
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    const bots = data && (data.bots || data);
    if (!bots || typeof bots !== 'object') return;
    for (const [id, value] of Object.entries(bots)) {
      if (!isBot(id) || id === 'claude') continue;
      const state = typeof value === 'string' ? value : value && value.state;
      if (!['idle', 'working', 'offline'].includes(state)) continue;
      const note = (value && value.note) || '';
      const sig = botSignals[id];
      sig.state = state;
      sig.note = note || sig.note;
      sig.updatedAt = Date.now();
      sig.source = 'url';
      if (state === 'working') sig.lastActivity = Date.now();
    }
    pushBots(true);
  } catch (_) { /* 조용히 무시 */ }
}

/* --------------------------------------------------------------- 창/트레이 */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#14111f',
    title: 'Bot House',
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
          title: 'Bot House',
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
  tray.setToolTip('Bot House — 봇들이 사는 집');
  const menu = Menu.buildFromTemplate([
    { label: 'Bot House 열기', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Claude 채널 재연결', click: () => { manager.restart(); showWindow(); } },
    { label: 'Claude 채널 멈추기', click: () => manager.stop(true) },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
  tray.on('click', () => showWindow());
}

/* --------------------------------------------------------------- IPC */
function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.all(),
    bots: computeBots(),
    botDefs: BOTS,
    claude: manager.snapshot(),
    logs: manager.logBuffer.slice(-300),
    version: app.getVersion(),
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
    send('settings', after);
    return after;
  });

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
    return manager.snapshot();
  });
  ipcMain.handle('claude:stop', async () => {
    manager.stop(true);
    return manager.snapshot();
  });
  ipcMain.handle('claude:start', async () => {
    manager.attempts = 0;
    await manager.start();
    return manager.snapshot();
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

    manager.on('log', (entry) => send('log', entry));
    manager.on('state', () => {
      send('claude', manager.snapshot());
      pushBots(true);
    });
    manager.on('activity', () => pushBots(true));

    applyLoginItem(store.get('launchAtLogin'));

    registerIpc();
    createWindow();
    buildTray();

    // 활동이 끊기면 '작업 중'이 저절로 풀리도록 주기적으로 알린다.
    setInterval(() => pushBots(true), 4000);
    setInterval(async () => {
      try {
        const snap = await usageMonitor.snapshot(true);
        send('usage', snap);
      } catch (_) { /* noop */ }
    }, 60000);
    statusPollTimer = setInterval(pollStatusUrl, 15000);

    if (store.get('autoConnect')) {
      setTimeout(() => manager.start().catch(() => {}), 900);
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    try { manager.dispose(); } catch (_) { /* noop */ }
    try { statusServer.stop(); } catch (_) { /* noop */ }
    clearInterval(statusPollTimer);
  });

  app.on('window-all-closed', () => {
    if (!store || !store.get('minimizeToTray')) app.quit();
  });

  app.on('activate', () => showWindow());
}
