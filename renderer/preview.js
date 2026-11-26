/* Bot House — 브라우저 미리보기용 가짜 연결 (Electron 밖에서 열었을 때만 동작) */
(function () {
  'use strict';
  if (window.botHouse) return;

  // 브라우저에서는 기기 창(580×450 ↔ 940×450)을 화면 가운데 띄운다
  document.documentElement.classList.add('preview');
  document.documentElement.dataset.win = 'compact';

  const BOTS = [
    { id: 'oiji', name: '오이지', role: '피클 · 메인 비서', handle: '@xky_oiji_bot', color: '#3FBF6A', seat: { x: 268, y: 178 }, home: { x: 92, y: 240 }, tagline: '일정 · 루틴' },
    { id: 'takuan', name: '단무지', role: '뮤즈 · 석박지 관리', handle: '@xky_takuan_bot', color: '#F2E3CB', seat: { x: 336, y: 178 }, home: { x: 148, y: 252 }, tagline: '더블체크 · IA' },
    { id: 'sbji', name: '석박지', role: 'K-EXAONE 두뇌', handle: '@xky_sbji_bot', color: '#B15CE8', seat: { x: 400, y: 178 }, home: { x: 186, y: 238 }, tagline: '조사 · 분석' },
    { id: 'claude', name: '클로드', role: 'Claude Code · 채널', handle: '@xky_claude_bot', color: '#E07A5F', seat: { x: 448, y: 178 }, home: { x: 120, y: 230 }, tagline: '작업 실행' }
  ];

  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') || 'live';
  window.__PREVIEW_VIEW__ = params.get('view') || '';

  let bots = {
    oiji: { state: 'idle', note: '휴게실에서 쉬는 중', lastActivity: Date.now() - 1000 * 60 * 12, connected: true },
    takuan: { state: 'idle', note: '침실에서 자는 중', lastActivity: Date.now() - 1000 * 60 * 34, connected: true, sleeping: true },
    sbji: { state: demo === 'idle' ? 'idle' : 'working', note: demo === 'idle' ? '휴게실에서 쉬는 중' : '카톡 대화록 분석', lastActivity: Date.now() - 1000 * 40, connected: true },
    claude: { state: demo === 'idle' ? 'idle' : 'working', note: demo === 'idle' ? '채널 연결됨' : '여수 하프 훈련표 정리', lastActivity: Date.now() - 1000 * 12, connected: true, connection: 'running' }
  };

  const listeners = { bots: [], claude: [], log: [], settings: [], usage: [], update: [] };

  let update = { status: 'none', version: '1.0.1', percent: 0, message: '지금이 최신 버전이에요' };

  const claude = {
    status: 'running', message: '연결됨', pid: 8420, startedAt: Date.now() - 1000 * 60 * 74,
    cwd: 'C:\\Users\\XKY\\projects', command: 'claude --channels plugin:telegram@claude-plugins-official',
    attempts: 0, lastActivity: Date.now() - 12000
  };

  const logs = [
    { t: Date.now() - 42000, line: 'Claude Code 채널을 시작합니다', level: 'info' },
    { t: Date.now() - 41000, line: 'telegram 채널 연결됨 · @xky_claude_bot', level: 'info' },
    { t: Date.now() - 30000, line: '메시지 수신: “여수 하프 훈련표 정리해줘”', level: 'info' },
    { t: Date.now() - 12000, line: '작업 중 · 파일 3개 편집', level: 'muted' }
  ];

  const settings = {
    workDir: 'C:\\Users\\XKY\\projects', autoConnect: true, autoReconnect: true, minimizeToTray: true,
    launchAtLogin: false, theme: params.get('theme') === 'day' ? 'day' : 'night', claudeCommand: 'claude',
    claudeArgs: '--channels plugin:telegram@claude-plugins-official',
    statusApiEnabled: true, statusApiPort: 47820, statusUrl: ''
  };

  window.PreviewBridge = {
    init: async () => ({
      settings, bots, claude, logs, version: '1.0.1', botDefs: BOTS, update,
      statusServer: { running: true, port: 47820, error: '' },
      home: 'C:\\Users\\XKY'
    }),
    saveSettings: async (patch) => { Object.assign(settings, patch); listeners.settings.forEach((f) => f(settings)); return settings; },
    pickDir: async () => 'C:\\Users\\XKY\\projects',
    restartClaude: async () => { claude.status = 'running'; claude.startedAt = Date.now(); listeners.claude.forEach((f) => f(claude)); return claude; },
    stopClaude: async () => { claude.status = 'stopped'; listeners.claude.forEach((f) => f(claude)); return claude; },
    startClaude: async () => { claude.status = 'running'; listeners.claude.forEach((f) => f(claude)); return claude; },
    setBotState: async ({ bot, state: st, note }) => {
      bots[bot] = { ...bots[bot], state: st, note: note || (st === 'working' ? '작업 중' : '휴게실에서 쉬는 중'), lastActivity: Date.now() };
      listeners.bots.forEach((f) => f(bots));
      return bots;
    },
    getLogs: async () => logs,
    getUsage: async () => window.__USAGE__ || { updatedAt: Date.now(), tools: [], days: [] },
    onUsage: (f) => { listeners.usage.push(f); return () => {}; },
    statusInfo: async () => ({ running: true, port: 47820, error: '', url: 'http://127.0.0.1:47820/status' }),
    getUpdate: async () => update,
    checkUpdate: async () => update,
    installUpdate: async () => ({ ok: false, message: '미리보기에서는 적용되지 않아요' }),
    onUpdate: (f) => { listeners.update.push(f); return () => {}; },
    // B모드 "치킹!" 변신: 미리보기 창 컨테이너 폭을 580 ↔ 940px로 바꾼다
    setWindowMode: async (mode) => {
      document.documentElement.dataset.win = mode === 'wide' ? 'wide' : 'compact';
      return mode;
    },
    hideWindow: async () => {},
    quit: async () => {},
    openExternal: async () => {},
    onBots: (f) => { listeners.bots.push(f); return () => {}; },
    onClaude: (f) => { listeners.claude.push(f); return () => {}; },
    onLog: (f) => { listeners.log.push(f); return () => {}; },
    onSettings: (f) => { listeners.settings.push(f); return () => {}; },
    platform: 'win32'
  };

  // 데모: 방 3개 확인용 (작업실 2, 거실 1, 침실 1)
  if (demo === 'rooms') {
    bots.takuan = { ...bots.takuan, state: 'offline', note: '' };
  }

  // 데모: 새 버전 알림 UI 확인용
  if (params.get('demo') === 'update') {
    update = { status: 'ready', version: '1.0.2', percent: 100, message: '새 버전 준비 완료 — 재시작하면 적용돼요' };
  }

  // 데모: 주기적으로 상태를 바꿔 캐릭터가 움직이는 모습을 보여준다
  if (params.get('demo') === 'live') {
    let flip = false;
    setInterval(() => {
      flip = !flip;
      const target = flip ? 'sbji' : 'claude';
      bots[target] = { ...bots[target], state: flip ? 'working' : 'idle', note: flip ? '카톡 대화록 분석' : '휴게실에서 쉬는 중', lastActivity: Date.now() };
      listeners.bots.forEach((f) => f(bots));
    }, 9000);
  }
})();
