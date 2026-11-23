'use strict';

const http = require('node:http');
const { isBot } = require('./bots');

/**
 * 봇들이 자기 상태를 알려줄 수 있는 아주 작은 로컬 API.
 *   127.0.0.1:47820/status          GET  → 전체 상태
 *   127.0.0.1:47820/status          POST → { "bot": "oiji", "state": "working", "note": "가계부 정리",
 *                                             "usage": { "todayTokens": 182000, "weekTokens": 940000 } }
 * 텔레그램 getUpdates를 쓰지 않으므로 오이지 봇 토큰과 충돌하지 않는다.
 */
class StatusServer {
  constructor({ getBots, onUpdate, port }) {
    this.getBots = getBots;
    this.onUpdate = onUpdate;
    this.port = port;
    this.server = null;
    this.running = false;
    this.error = '';
  }

  start() {
    if (this.running) return;
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on('error', (err) => {
      this.error = err.code === 'EADDRINUSE'
        ? `포트 ${this.port}을(를) 이미 다른 프로그램이 쓰고 있어요.`
        : err.message;
      this.running = false;
    });
    this.server.listen(this.port, '127.0.0.1', () => {
      this.running = true;
      this.error = '';
    });
  }

  stop() {
    if (!this.server) return;
    try { this.server.close(); } catch (_) { /* noop */ }
    this.server = null;
    this.running = false;
  }

  handle(req, res) {
    const send = (code, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      });
      res.end(payload);
    };

    if (req.method === 'OPTIONS') {
      send(204, {});
      return;
    }

    const url = (req.url || '/').split('?')[0];
    if (url === '/status' && req.method === 'GET') {
      send(200, { ok: true, bots: this.getBots(), at: Date.now() });
      return;
    }
    if (url === '/status' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 8000) req.destroy();
      });
      req.on('end', () => {
        let data;
        try {
          data = JSON.parse(body || '{}');
        } catch (_) {
          send(400, { ok: false, error: 'JSON 형식이 아니에요' });
          return;
        }
        const bot = String(data.bot || '');
        if (!isBot(bot)) {
          send(400, { ok: false, error: `알 수 없는 봇이에요: ${bot}` });
          return;
        }
        const state = String(data.state || 'idle');
        if (!['idle', 'working', 'offline'].includes(state)) {
          send(400, { ok: false, error: 'state는 idle / working / offline 중 하나여야 해요' });
          return;
        }
        const note = typeof data.note === 'string' ? data.note.slice(0, 120) : '';
        this.onUpdate({ bot, state, note, usage: data.usage, source: 'api' });
        send(200, { ok: true, bot, state });
      });
      return;
    }
    if (url === '/health') {
      send(200, { ok: true, uptime: process.uptime() });
      return;
    }
    send(404, { ok: false, error: 'not found' });
  }
}

module.exports = { StatusServer };
