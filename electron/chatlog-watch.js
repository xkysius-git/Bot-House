'use strict';

/**
 * 이 PC에 쌓이는 그룹 채팅 기록(chat-YYYY-MM-DD-*.jsonl, 한 줄 = 메시지 하나)을 읽어
 * 봇이 언제 말했는지 알려준다. 앱 안 채팅에 로그인하지 않아도 오이지·단무지·석박지 상태를 추정할 수 있다.
 * 폴더가 없으면 아무것도 하지 않는다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SCAN_MS = 4000;
const FILE_RE = /^chat-\d{4}-\d{2}-\d{2}.*\.jsonl$/;

class ChatLogWatch extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = null;
    this.offset = 0;
    this.timer = null;
  }

  start() {
    if (!this.dir || !fs.existsSync(this.dir)) return false;
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_MS);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  newest() {
    try {
      const files = fs.readdirSync(this.dir).filter((f) => FILE_RE.test(f)).sort();
      return files.length ? path.join(this.dir, files[files.length - 1]) : null;
    } catch {
      return null;
    }
  }

  scan() {
    const file = this.newest();
    if (!file) return;
    if (file !== this.file) { this.file = file; this.offset = 0; }
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < this.offset) this.offset = 0;
    if (size === this.offset) return;
    let chunk;
    try {
      const fd = fs.openSync(file, 'r');
      chunk = Buffer.alloc(size - this.offset);
      fs.readSync(fd, chunk, 0, chunk.length, this.offset);
      fs.closeSync(fd);
    } catch {
      return;
    }
    // 끝까지 안 쓰인 줄은 다음 번에 (글자가 중간에 잘리지 않게 바이트 단위로 자른다)
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return;
    this.offset += end + 1;
    for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (!m || !m.is_bot || !m.from) continue;
      this.emit('message', { isBot: true, username: String(m.from), text: String(m.text || ''), date: Date.parse(m.time) || Date.now() });
    }
  }
}

module.exports = { ChatLogWatch };
