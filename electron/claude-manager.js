'use strict';

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { listChannelProcesses } = require('./external-claude');

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

const IS_WIN = process.platform === 'win32';
const CONSOLE_TITLE = 'A.I.Mon Claude Channel';
// 1.0.5까지 쓰던 창 제목. 업데이트 후에도 옛 창이 남아 있으면 정리할 수 있게 함께 본다.
const LEGACY_CONSOLE_TITLES = ['BotHouse Claude Channel'];
// MCP(텔레그램 채널) 첫 연결 제한시간. 기본 30초는 Windows 콘솔 창에서 빠듯해서 90초로 늘린다.
const DEFAULT_MCP_TIMEOUT = '90000';
const MCP_TIMEOUT = process.env.MCP_TIMEOUT || DEFAULT_MCP_TIMEOUT;
const WINDOW_POLL_MS = 8000;          // 창 모드에서 채널이 살아 있는지 확인하는 간격
const WINDOW_START_TIMEOUT_MS = 12000; // 창을 띄운 뒤 이만큼 지나도 채널이 안 보이면 오류로 본다

/** PowerShell 작은따옴표 문자열 리터럴 (안에서는 ' 를 '' 로 쓴다) */
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * cmd.exe에 넘길 명령 한 줄. 창을 띄우자마자 UTF-8 코드페이지와 창 제목을 잡고 claude를 실행한다.
 * claude가 끝난 뒤에도 창을 닫지 않으려고 /k로 띄우므로, 오류가 나면 창에서 그대로 볼 수 있다.
 * MCP_TIMEOUT을 먼저 넣어 두어 텔레그램 채널의 30초 연결 제한에 걸리지 않게 한다.
 */
function windowsConsoleCommand(cmdPath, args) {
  const quoted = [`"${cmdPath}"`, ...args.map((a) => `"${a}"`)].join(' ');
  return [
    `title ${CONSOLE_TITLE}`,
    'chcp 65001>nul',
    `set "MCP_TIMEOUT=${MCP_TIMEOUT}"`,
    quoted
  ].join(' & ');
}

function runPowerShell(script, timeout = 25000) {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout },
      (err, stdout, stderr) => {
        const out = String(stdout || '');
        if (err) {
          const first = String(stderr || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
          return resolve({ ok: false, stdout: out, error: first || err.message });
        }
        resolve({ ok: true, stdout: out, stderr: String(stderr || '') });
      });
  });
}

/**
 * 실제 콘솔 창을 최소화 상태로 띄운다 (=작업 표시줄에 내려가 있음).
 * Start-Process -PassThru 로 cmd.exe의 PID를 받아 오므로 멈출 때 트리째 정리할 수 있다.
 * ok는 "창 띄우기 자체를 실패하지 않았는지"이고, pid는 확인 못 하면 null이다.
 */
function consoleLaunchPlan(comspec, command, cwd) {
  const argumentLine = `/d /s /k "${command}"`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$p = Start-Process -FilePath ${psLiteral(comspec)} -ArgumentList ${psLiteral(argumentLine)} -WorkingDirectory ${psLiteral(cwd)} -WindowStyle Minimized -PassThru`,
    "if ($p -and $p.Id) { Write-Output ('PID=' + $p.Id) }",
    // -WindowStyle 이 무시되는 콘솔 호스트(Windows Terminal 등)를 위해 한 번 더 접는다. 실패해도 그냥 둔다.
    'try {',
    `  Add-Type -Namespace BotHouse -Name Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);' -ErrorAction Stop`,
    '  for ($i = 0; $i -lt 16; $i++) {',
    '    $proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue',
    '    if ($proc -and $proc.MainWindowHandle -ne 0) { [BotHouse.Win32]::ShowWindowAsync($proc.MainWindowHandle, 6) | Out-Null; break }',
    '    Start-Sleep -Milliseconds 150',
    '  }',
    '} catch { }'
  ].join("\n");
  return { argumentLine, script };
}

async function launchMinimizedConsole(comspec, command, cwd) {
  const { script } = consoleLaunchPlan(comspec, command, cwd);
  const res = await runPowerShell(script);
  const m = /PID=(\d+)/.exec(res.stdout || '');
  // 창은 떴는데 뒷부분(최소화 보조)에서 오류가 난 경우도 PID가 있으면 성공으로 본다.
  if (m) return { ok: true, pid: Number(m[1]), error: '' };
  if (!res.ok) return { ok: false, pid: null, error: res.error || '알 수 없는 오류' };
  return { ok: true, pid: null, error: '' };
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
    this.windowMode = false;   // Windows: 최소화된 콘솔 창으로 띄운 세션
    this.windowTimer = null;
    this.claudePid = null;
    this.checking = false;
    // 테스트에서 바꿔 끼울 수 있게 메서드로 들고 있는다
    this.listChannels = listChannelProcesses;
    this.launchConsole = launchMinimizedConsole;
  }

  snapshot() {
    const settings = this.store.all();
    return {
      status: this.status,
      message: this.message,
      pid: this.child ? (this.child.pid || null) : null,
      claudePid: this.claudePid,
      console: this.windowMode,
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
    if (this.child && (this.status === 'running' || this.status === 'starting' || this.status === 'retrying')) {
      this.log('이미 연결되어 있어요. 새로 연결하려면 재연결을 눌러 주세요.', 'warn');
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.manualStop = false;
    // 창 모드에서 채널만 끝나고 콘솔 창이 남아 있으면 정리하고 새로 띄운다.
    if (this.child) this.closeConsole();

    const settings = this.store.all();
    const cwd = settings.workDir && fs.existsSync(settings.workDir) ? settings.workDir : os.homedir();
    const args = (settings.claudeArgs || '').split(/\s+/).filter(Boolean);

    this.setStatus('starting');
    this.log('Claude 채널을 시작합니다.', 'info');

    let cmdPath;
    try {
      cmdPath = await this.resolveCommand();
    } catch (err) {
      cmdPath = settings.claudeCommand || 'claude';
    }
    this.resolved = cmdPath;

    if (IS_WIN) {
      await this.startInConsole(cmdPath, args, cwd);
      return;
    }

    this.log(`실행: ${cmdPath} ${args.join(' ')}`, 'muted');
    this.log(`폴더: ${cwd}`, 'muted');

    const env = {
      ...process.env,
      MCP_TIMEOUT,
      PYTHONIOENCODING: 'utf-8',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb'
    };

    try {
      this.child = spawn(cmdPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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

  /* ------------------------------------------- Windows: 최소화된 실제 콘솔 창 */
  async startInConsole(cmdPath, args, cwd) {
    if (this.status !== 'starting') this.setStatus('starting');
    this.log(`실행: ${cmdPath} ${args.join(' ')}`, 'muted');
    this.log(`폴더: ${cwd}`, 'muted');

    // 다른 창에서 이미 채널을 쓰고 있으면 새로 띄우지 않는다 (같은 봇 토큰 이중 연결 → 계속 실패)
    const existing = await this.listChannels();
    if (existing && existing.length) {
      this.windowMode = false;
      this.log(`다른 창에서 Claude 채널이 이미 실행 중이에요 (PID ${existing[0]}). 새로 띄우지 않았어요.`, 'muted');
      this.setStatus('stopped', '다른 창에서 실행 중인 세션');
      return;
    }

    const command = windowsConsoleCommand(cmdPath, args);
    const launched = await this.launchConsole(process.env.ComSpec || 'cmd.exe', command, cwd);

    if (launched.ok) {
      // PID를 못 받아도 창은 떠 있으므로 제목으로 정리할 수 있게 둔다.
      this.child = { pid: launched.pid || null, window: true };
    } else {
      this.log(`최소화 창을 띄우지 못했어요: ${launched.error}`, 'warn');
      if (!this.spawnConsoleDirect(cmdPath, args, cwd)) {
        this.setStatus('error', '터미널 창을 띄우지 못했어요. 설정에서 Claude 경로를 확인해 주세요.');
        return;
      }
      this.log('최소화는 못 했지만 콘솔 창으로 실행했어요. 작업 표시줄에서 확인해 주세요.', 'warn');
    }

    this.windowMode = true;
    this.startedAt = Date.now();
    this.lastOutput = Date.now();
    this.log(`최소화된 터미널 창으로 Claude 채널을 실행했어요 (PID ${(this.child && this.child.pid) || '확인 안 됨'}). 작업 표시줄에 내려가 있어요.`, 'info');
    this.startWindowWatch();
    this.startActivityWatch();
    this.emitState();
  }

  // PowerShell을 쓸 수 없는 환경의 마지막 수단: 콘솔 창을 그대로 띄운다 (최소화는 보장 못 함)
  spawnConsoleDirect(cmdPath, args, cwd) {
    try {
      const command = windowsConsoleCommand(cmdPath, args);
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/k', `"${command}"`], {
        cwd,
        env: { ...process.env },
        stdio: 'ignore',
        windowsHide: false
      });
      child.on('error', (err) => {
        this.child = null;
        this.log(`실행 실패: ${err.message}`, 'error');
        this.setStatus('error', err.code === 'ENOENT'
          ? 'claude 실행 파일을 찾지 못했어요. 설정에서 경로를 확인해 주세요.'
          : err.message);
      });
      child.on('exit', (code) => this.onConsoleExit(code));
      this.child = child;
      return child;
    } catch (err) {
      this.log(`실행 실패: ${err.message}`, 'error');
      return null;
    }
  }

  startWindowWatch() {
    clearInterval(this.windowTimer);
    this.windowTimer = setInterval(() => this.checkConsole(), WINDOW_POLL_MS);
    if (this.windowTimer.unref) this.windowTimer.unref();
    setTimeout(() => this.checkConsole(), 2500);
  }

  /*
   * 창 모드의 생존 확인. Start-Process로 띄운 세션은 프로세스 핸들이 없으므로
   * 명령줄에 --channels가 들어간 claude/node 프로세스가 있는지로 판단한다.
   * (확인에 실패한 경우(null)는 모르는 것이라 상태를 바꾸지 않는다)
   */
  async checkConsole() {
    if (!this.windowMode || this.manualStop || this.checking) return;
    this.checking = true;
    try {
      const pids = await this.listChannels();
      if (pids === null) return;
      if (pids.length) {
        this.claudePid = pids[0];
        if (this.status === 'starting' || this.status === 'retrying') {
          this.setStatus('running', '최소화된 터미널 창에서 실행 중');
          this.log(`Claude 채널이 터미널 창에서 연결됐어요 (PID ${pids[0]}).`, 'info');
        }
        return;
      }

      if (this.status === 'starting') {
        if (Date.now() - (this.startedAt || 0) < WINDOW_START_TIMEOUT_MS) return; // 아직 뜨는 중일 수 있음
        this.stopWindowWatch();
        this.setStatus('error', '터미널 창에서 Claude가 시작되지 않았어요. 창을 열어 오류를 확인해 주세요.');
        this.log('터미널 창을 열어 오류를 확인해 주세요. 창은 닫지 않고 두었어요.', 'error');
        return;
      }

      if (this.status === 'running') this.onConsoleGone();
    } finally {
      this.checking = false;
    }
  }

  // 채널 프로세스가 사라졌을 때 (창은 열어 둔 채로 마지막 출력을 볼 수 있게 남긴다)
  onConsoleGone(code = null) {
    this.stopWindowWatch();
    this.claudePid = null;
    this.lastExit = { code, signal: null, at: Date.now() };
    if (this.manualStop) {
      this.setStatus('stopped', '직접 멈췄어요');
      return;
    }
    const settings = this.store.all();
    const ranFor = Date.now() - (this.startedAt || Date.now());
    // 오래 돌다가 끊긴 경우에만 한 번 더 띄운다. 시작 직후 실패면 창을 열어 보라고 남긴다.
    if (settings.autoReconnect && ranFor > 60000 && this.attempts < 3) {
      this.attempts += 1;
      const delay = 15000;
      this.setStatus('retrying', `${Math.round(delay / 1000)}초 뒤 터미널 창을 다시 띄워요 (${this.attempts}/3)`);
      this.log('채널이 끝나서 잠시 뒤 터미널 창을 다시 띄웁니다.', 'warn');
      this.closeConsole();
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.start();
      }, delay);
      return;
    }
    this.setStatus('exited', '터미널 창에서 채널이 끝났어요');
    this.log('터미널 창에서 Claude 채널이 끝났어요. 창을 열면 마지막 출력을 볼 수 있어요. 재연결 버튼으로 다시 띄울 수 있어요.', 'warn');
  }

  // 콘솔을 직접 띄운 경우(cmd가 자식)에는 그 프로세스가 끝나면 채널도 끝난 것이다
  onConsoleExit(code) {
    this.child = null;
    this.stopWindowWatch();
    this.onConsoleGone(code === undefined ? null : code);
  }

  stopWindowWatch() {
    clearInterval(this.windowTimer);
    this.windowTimer = null;
  }

  killTree(pid) {
    if (!pid) return;
    if (IS_WIN) {
      try {
        execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
      } catch (_) { /* noop */ }
      return;
    }
    try { process.kill(pid, 'SIGTERM'); } catch (_) { /* noop */ }
  }

  // PID를 못 받았을 때를 위한 안전망: 우리 창 제목(옛 제목 포함)을 가진 콘솔을 트리째 닫는다
  killConsoleWindows() {
    if (!IS_WIN) return;
    for (const title of [CONSOLE_TITLE, ...LEGACY_CONSOLE_TITLES]) {
      try {
        execFile('taskkill', ['/FI', `WINDOWTITLE eq ${title}`, '/T', '/F'], { windowsHide: true }, () => {});
      } catch (_) { /* noop */ }
    }
  }

  // 남아 있는 콘솔 창을 닫고 창 모드 상태를 비운다
  closeConsole() {
    const child = this.child;
    this.child = null;
    this.claudePid = null;
    this.stopWindowWatch();
    if (IS_WIN) {
      if (child && child.pid) this.killTree(child.pid);
      this.killConsoleWindows();
    } else if (child && child.kill) {
      try { child.kill('SIGTERM'); } catch (_) { /* noop */ }
    }
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
    this.stopWindowWatch();
    const child = this.child;
    const wasWindow = this.windowMode;
    this.child = null;
    this.claudePid = null;
    this.windowMode = false;
    if (!child && !wasWindow) {
      // 앱을 다시 켜서 남아 있는 창을 물려받은 경우: 제목이 우리 것인 창만 닫는다
      if (IS_WIN) this.killConsoleWindows();
      this.setStatus('stopped', '');
      return;
    }
    this.log('채널을 정리하는 중…', 'muted');
    try {
      if (IS_WIN) {
        if (child && child.pid) this.killTree(child.pid);
        this.killConsoleWindows();
      } else if (child && child.kill) {
        try { child.kill('SIGTERM'); } catch (_) { /* noop */ }
        setTimeout(() => {
          try { if (child.exitCode === null) child.kill('SIGKILL'); } catch (_) { /* noop */ }
        }, 2500);
      }
    } catch (err) {
      this.log(`정리 실패: ${err.message}`, 'warn');
    }
    if (wasWindow) this.log('터미널 창을 닫았어요.', 'muted');
    this.setStatus('stopped', '직접 멈췄어요');
  }

  async restart() {
    this.attempts = 0;
    this.stop(true);
    // taskkill로 정리한 프로세스가 목록에서 빠질 때까지 잠깐 기다린다 (중복 판단 방지)
    await new Promise((r) => setTimeout(r, 1500));
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
    // Windows 콘솔 창으로 띄운 채널은 앱을 끄거나 업데이트해도 살려 둔다.
    // 앱이 다시 켜지면 --channels 프로세스를 찾아 그대로 이어 붙는다 (새로 띄우지 않음).
    // 채널을 끄고 싶을 때는 'Claude 채널 멈추기'나 재연결 버튼이 창을 닫는다.
    if (this.windowMode) {
      this.manualStop = true;
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.stopWindowWatch();
      return;
    }
    this.stop(false);
  }
}

module.exports = { ClaudeManager, windowsConsoleCommand, consoleLaunchPlan, launchMinimizedConsole };
