'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

// 창이 테두리 없는 투명 창이라는 표시. renderer CSS에서 html.frameless 일 때 바깥 배경을 투명으로.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('frameless');
});

function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(handler, { channel, wrapped });
  return () => {
    const entry = listeners.get(handler);
    if (entry) ipcRenderer.removeListener(entry.channel, entry.wrapped);
    listeners.delete(handler);
  };
}

contextBridge.exposeInMainWorld('botHouse', {
  init: () => ipcRenderer.invoke('app:init'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickDir: () => ipcRenderer.invoke('settings:pickDir'),
  restartClaude: () => ipcRenderer.invoke('claude:restart'),
  stopClaude: () => ipcRenderer.invoke('claude:stop'),
  startClaude: () => ipcRenderer.invoke('claude:start'),
  setBotState: (payload) => ipcRenderer.invoke('bot:setState', payload),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  getUsage: (force) => ipcRenderer.invoke('usage:get', !!force),
  statusInfo: () => ipcRenderer.invoke('status:info'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  onBots: (handler) => on('bots', handler),
  onClaude: (handler) => on('claude', handler),
  onLog: (handler) => on('log', handler),
  onSettings: (handler) => on('settings', handler),
  onUsage: (handler) => on('usage', handler),
  onUpdate: (handler) => on('update', handler),
  // 기기 창 접기/펼치기 — docs/DEVICE.md 참고
  // 간단 버전: setWindowMode('compact' | 'wide', { duration })
  setWindowMode: (mode, opts) => ipcRenderer.invoke('device:setMode', mode === 'wide' ? 'expanded' : mode, opts),
  device: {
    configure: (sizes) => ipcRenderer.invoke('device:configure', sizes),
    setMode: (mode, opts) => ipcRenderer.invoke('device:setMode', mode, opts),
    info: () => ipcRenderer.invoke('device:info')
  },
  // 앱 안 채팅 (텔레그램 그룹) — docs/CHAT.md 참고
  chat: {
    status: () => ipcRenderer.invoke('chat:status'),
    connect: () => ipcRenderer.invoke('chat:connect'),
    sendCode: (phone) => ipcRenderer.invoke('chat:sendCode', phone),
    submitCode: (code) => ipcRenderer.invoke('chat:submitCode', code),
    submitPassword: (password) => ipcRenderer.invoke('chat:submitPassword', password),
    logout: () => ipcRenderer.invoke('chat:logout'),
    history: (opts) => ipcRenderer.invoke('chat:history', opts),
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    onStatus: (handler) => on('chat:status', handler),
    onMessage: (handler) => on('chat:message', handler),
    onEdited: (handler) => on('chat:edited', handler)
  },
  platform: process.platform
});
