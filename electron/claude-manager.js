'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g; // eslint-disable-line no-control-regex
const NOISE = [
  /^Active code page/i
];

/** 사람이 읽는 한 줄로 다듬는다. */
function cleanLine(raw) {
  let line = String(raw).replace(ANSI, '').replace(/\r/g, '');
  line = line.replace(/^\s+/, '').replace(/\s+$/, '');
  if (!line) return '';
  if (NOISE.some((re) => re.test(line))) return '';
  return line;
}

function which(cmd, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
  });
}

class ClaudeManager extends EventEmitter {
  constructor(store, appPath) {
    super();
    this.store = store;
    this.appPath = appPath;
    this.child = null;
    this.status = 'stopped';
    this.message = '';
    this.startedAt = null;
    this.lastExit = null;
    this.attempts = 0;
    this.retryTimer = null;
    this.manualStop = false;
    this.resolved = '';
    this.logBuffer = [];
    this.lastOutput = 0;
    this.activityTimer = null;
    this.watchDir = path.join(os.homedir(), '.claude', 'projects');
    this.lastActivity = 0;
    this.recentFiles = new Map();
  }

  snapshot() {
    const settings = this.store.all();
    return {
      status: this.status,
      message: this.message,
      pid: this.child ? this.child.pid : null,
      startedAt: this.startedAt,
      cwd: settings.workDir || os.homedir(),
      command: `${settings.claudeCommand} ${settings.claudeArgs}`.trim(),
      resolved: this.resolved,
      attempts: this.attempts,
      lastExit: this.lastExit,
      lastActivity: this.lastActivity
    };
  }

  emitState() {
    this.emit('state', this.snapshot());
  }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.emitState();
  }

  log(line, level = 'info') {
    const entry = { t: Date.now(), line, level };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 800) this.logBuffer.shift();
    this.emit('log', entry);
  }

  pushActivity(source = 'output') {
    const now = Date.now();
    if (now - this.lastActivity < 900) return;
    this.lastActivity = now;
    this.emit('activity', { at: now, source });
  }

  async resolveCommand() {
    const settings = this.store.all();
    const configured = (settings.claudeCommand || 'claude').trim();
    const candidates = [];

    if (configured && configured !== 'claude' && fs.existsSync(configured)) {
      candidates.push(configured);
    }
    const found = await which(path.basename(configured.replace(/^"|"$/g, '')));
    candidates.push(...found);

    if (process.platform === 'win32') {
      const home = os.homedir();
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const guesses = [
        path.join(appData, 'npm', 'claude.cmd'),
        path.join(localApp, 'Programs', 'claude', 'claude.exe'),
        path.join(localApp, 'Microsoft', 'WindowsApps', 'claude.exe'),
        path.join(home, '.claude', 'local', 'claude.exe'),
        path.join(home, '.claude', 'local', 'claude.cmd'),
        path.join(home, '.local', 'bin', 'claude.exe')
      ];
      for (const guess of guesses) {
        if (fs.existsSync(guess)) candidates.push(guess);
      }
    } else {
      candidates.push('/usr/local/bin/claude', '/opt/homebrew/bin/claude',
        path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'));
      for (const guess of candidates.slice()) {
        if (!fs.existsSync(guess)) continue;
      }
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (fs.existsSync(candidate)) return candidate;
    }
    // 마지막 수단: PATH에 있다고 가정하고 이름 그대로 실행
    return configured || 'claude';
  }

  async start() {
    if (this.child) {
      this.log('이미 연결되어 있어요. 새로 연결하려면 재연결을 눌러 주세요.', 'warn');
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.manualStop = false;
    const settings = this.store.all();
    const cwd = settings.workDir && fs.existsSync(settings.workDir) ? settings.workDir : os.homedir();
    const args = (settings.claudeArgs || '').split(/\s+/).filter(Boolean);

    this.setStatus('starting');
    this.log(`Claude 채널을 시작합니다 · ${this.status === 'starting' ? '준비 중' : ''}`, 'info');

    let cmdPath;
    try {
      cmdPath = await this.resolveCommand();
    } catch (err) {
      cmdPath = settings.claudeCommand || 'claude';
    }
    this.resolved = cmdPath;
    this.log(`실행: ${cmdPath} ${args.join(' ')}`, 'muted');
    this.log(`폴더: ${cwd}`, 'muted');

    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb'
    };

    try {
      const isWin = process.platform === 'win32';
      if (isWin) {
        const quoted = `"${cmdPath}" ${args.map((a) => `"${a}"`).join(' ')}`.trim();
        const line = `chcp 65001>nul & ${quoted}`;
        this.child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
          cwd,
          env,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } else {
        this.child = spawn(cmdPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      }
    } catch (err) {
      this.setStatus('error', `실행하지 못했어요: ${err.message}`);
      this.log(`실행 실패: ${err.message}`, 'error');
      this.scheduleRetry();
      return;
    }

    this.startedAt = Date.now();
    this.lastOutput = Date.now();
    const child = this.child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk, 'out'));
    child.stderr.on('data', (chunk) => this.onData(chunk, 'err'));

    child.on('error', (err) => {
      this.log(`오류: ${err.message}`, 'error');
      this.setStatus('error', err.code === 'ENOENT'
        ? 'claude 실행 파일을 찾지 못했어요. 설정에서 경로를 확인해 주세요.'
        : err.message);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.lastExit = { code, signal, at: Date.now() };
      this.attemptsFromExit();
      if (this.manualStop) {
        this.setStatus('stopped', '직접 멈췄어요');
        this.log('Claude 채널을 멈췄어요.', 'muted');
      } else {
        this.setStatus('exited', `연결이 끊겼어요 (코드 ${code ?? '-'})`);
        this.log(`채널이 종료됐어요 (코드 ${code ?? '-'})`, 'error');
        this.scheduleRetry();
      }
      this.emitState();
    });

    // 첫 출력이 없어도 살아 있으면 연결된 것으로 본다.
    setTimeout(() => {
      if (this.child && this.status === 'starting') {
        this.setStatus('running', '연결됨');
      }
    }, 1800);

    this.startActivityWatch();
    this.emitState();
  }

  onData(chunk, source) {
    const text = String(chunk);
    const parts = text.split(/\r?\n/);
    for (const part of parts) {
      const line = cleanLine(part);
      if (!line) continue;
      this.log(line, source === 'err' ? 'warn' : 'info');
      this.pushActivity('log');
      if (this.status === 'starting' || this.status === 'exited' || this.status === 'error') {
        this.setStatus('running', '연결됨');
      }
    }
    this.lastOutput = Date.now();
  }

  attemptsFromExit() {
    if (this.manualStop) return;
    this.attempts += 1;
  }

  scheduleRetry() {
    const settings = this.store.all();
    if (this.manualStop) return;
    if (!settings.autoReconnect) {
      this.log('자동 재연결이 꺼져 있어요. 재연결 버튼으로 다시 시작할 수 있어요.', 'muted');
      return;
    }
    if (this.attempts >= 5) {
      this.setStatus('error', '여러 번 다시 시도했지만 연결되지 않았어요. 로그를 확인해 주세요.');
      this.log('재시도를 멈췄어요 (5회). 로그를 확인해 주세요.', 'error');
      return;
    }
    const delay = Math.min(30000, 3000 * Math.pow(2, Math.max(0, this.attempts - 1)));
    this.setStatus('retrying', `${Math.round(delay / 1000)}초 뒤 다시 연결해요 (${this.attempts}/5)`);
    this.log(`${Math.round(delay / 1000)}초 뒤 다시 연결합니다.`, 'muted');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start();
    }, delay);
  }

  stop(manual = true) {
    this.manualStop = manual;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const child = this.child;
    if (!child) {
      this.setStatus('stopped', '');
      return;
    }
    this.log('채널을 정리하는 중…', 'muted');
    try {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (this.child) {
            try { this.child.kill('SIGKILL'); } catch (_) { /* noop */ }
          }
        }, 2500);
      }
    } catch (err) {
      this.log(`정리 실패: ${err.message}`, 'warn');
    }
    this.child = null;
    this.setStatus('stopped', '직접 멈췄어요');
  }

  async restart() {
    this.attempts = 0;
    this.stop(true);
    await new Promise((r) => setTimeout(r, 600));
    this.manualStop = false;
    await this.start();
  }

  /* Claude Code가 남기는 세션 기록을 보고 "지금 작업 중"인지 판단한다. */
  startActivityWatch() {
    if (this.activityTimer) return;
    const tick = () => {
      try {
        if (!fs.existsSync(this.watchDir)) return;
        const stack = [this.watchDir];
        let guard = 0;
        while (stack.length && guard < 400) {
          guard += 1;
          const dir = stack.pop();
          let entries = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              stack.push(full);
            } else if (entry.name.endsWith('.jsonl')) {
              let stat;
              try { stat = fs.statSync(full); } catch (_) { continue; }
              const prev = this.recentFiles.get(full) || 0;
              if (stat.mtimeMs > prev + 5) {
                this.recentFiles.set(full, stat.mtimeMs);
                if (Date.now() - stat.mtimeMs < 12000) this.pushActivity('session');
              }
            }
          }
        }
      } catch (_) { /* 감시는 조용히 넘어간다 */ }
    };
    this.activityTimer = setInterval(tick, 2500);
    if (this.activityTimer.unref) this.activityTimer.unref();
    tick();
  }

  dispose() {
    clearInterval(this.activityTimer);
    this.activityTimer = null;
    this.stop(false);
  }
}

module.exports = { ClaudeManager };
