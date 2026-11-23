'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  workDir: '',
  autoConnect: true,
  autoReconnect: true,
  minimizeToTray: true,
  launchAtLogin: false,
  theme: 'night',
  claudeCommand: 'claude',
  claudeArgs: '--channels plugin:telegram@claude-plugins-official',
  statusApiEnabled: true,
  statusApiPort: 47820,
  statusUrl: '',
  // 앱 안 채팅 (텔레그램 사용자 계정). API ID/Hash는 my.telegram.org 에서 발급
  tgApiId: '',
  tgApiHash: '',
  chatId: '-1003722460872'
};

class Store {
  constructor(filePath) {
    this.file = filePath;
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data = { ...DEFAULTS, ...parsed };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[store] settings read failed:', err.message);
      }
    }
    return this.data;
  }

  all() {
    return { ...this.data };
  }

  get(key) {
    return this.data[key];
  }

  set(patch) {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      if (key in DEFAULTS) clean[key] = value;
    }
    this.data = { ...this.data, ...clean };
    this.save();
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[store] settings write failed:', err.message);
    }
  }
}

module.exports = { Store, DEFAULTS };
