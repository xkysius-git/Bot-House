'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

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
  platform: process.platform
});
