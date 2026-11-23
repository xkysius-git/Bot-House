'use strict';

/**
 * 앱이 직접 띄우지 않은 claude 채널 세션(다른 터미널에서 `claude --channels ...`)을 감지한다.
 * - 생존: 명령줄에 --channels 가 들어간 claude 프로세스가 있는지 (Windows는 CIM, 그 외는 ps)
 * - 활동: ~/.claude/projects/ 아래 대화 기록(.jsonl)이 최근에 갱신됐는지
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCAN_INTERVAL_MS = 15000;

function listChannelProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='claude.exe' or Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -match '--channels' } | ForEach-Object { $_.ProcessId }";
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { windowsHide: true, timeout: 10000 }, (err, stdout) => {
          if (err) return resolve(null); // 확인 실패 = 모름 (끊김으로 보지 않음)
          resolve(stdout.split(/\r?\n/).map((s) => Number(s.trim())).filter(Boolean));
        });
    } else {
      execFile('ps', ['-axo', 'pid=,command='], { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.split('\n')
          .filter((l) => /\bclaude\b/.test(l) && /--channels/.test(l))
          .map((l) => Number(l.trim().split(/\s+/)[0])).filter(Boolean));
      });
    }
  });
}

// 가장 최근에 갱신된 대화 기록 시각. 프로젝트 폴더 1단계만 본다 (가벼움 유지).
function latestTranscriptMtime() {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let latest = 0;
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return 0; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const m = fs.statSync(path.join(dir, f)).mtimeMs;
        if (m > latest) latest = m;
      } catch (_) { /* 지워진 파일 */ }
    }
  }
  return latest;
}

class ExternalClaudeWatcher {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.pids = [];
    this.running = false;
    this.lastActivity = null;
    this.checkedAt = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async scan() {
    const pids = await listChannelProcesses();
    if (pids === null) return; // 확인 실패 시 이전 값 유지
    // 앱이 직접 띄운 세션이 살아 있으면 main.js가 그쪽 상태를 우선 쓰므로 여기선 구분하지 않는다.
    const running = pids.length > 0;
    const mtime = running ? latestTranscriptMtime() : 0;
    const changed = running !== this.running || (mtime && mtime !== this.lastActivity);
    this.pids = pids;
    this.running = running;
    if (mtime) this.lastActivity = mtime;
    this.checkedAt = Date.now();
    if (changed) this.onChange(this.snapshot());
  }

  snapshot() {
    return { running: this.running, pids: this.pids, lastActivity: this.lastActivity, checkedAt: this.checkedAt };
  }
}

module.exports = { ExternalClaudeWatcher };
