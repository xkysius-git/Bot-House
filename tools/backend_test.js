// Bot House 백엔드 자체 점검 (Electron 없이 main 프로세스 모듈만 검사)
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store');
const { StatusServer } = require('../electron/status-server');
const { ClaudeManager } = require('../electron/claude-manager');
const { initialBotState } = require('../electron/bots');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bothouse-test-'));
const log = (...a) => console.log('·', ...a);

async function testStore() {
  const file = path.join(tmp, 'settings.json');
  const store = new Store(file);
  assert.equal(store.get('autoConnect'), true);
  store.set({ workDir: 'C:\\Users\\XKY\\projects', minimizeToTray: false, bogus: 1 });
  const again = new Store(file);
  assert.equal(again.get('workDir'), 'C:\\Users\\XKY\\projects');
  assert.equal(again.get('minimizeToTray'), false);
  assert.equal(again.get('bogus'), undefined);
  log('store 저장/불러오기 OK');
  return again;
}

async function testStatusServer() {
  let last = null;
  const server = new StatusServer({
    port: 47831,
    getBots: () => initialBotState(),
    onUpdate: (payload) => { last = payload; }
  });
  server.start();
  await new Promise((r) => setTimeout(r, 300));

  const post = await fetch('http://127.0.0.1:47831/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot: 'oiji', state: 'working', note: '가계부 정리',
      usage: { todayTokens: 182000, weekTokens: 940000 }
    })
  });
  assert.equal(post.status, 200);
  const body = await post.json();
  assert.equal(body.ok, true);
  assert.equal(last.bot, 'oiji');
  assert.equal(last.state, 'working');
  assert.equal(last.usage.todayTokens, 182000);

  const bad = await fetch('http://127.0.0.1:47831/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot: 'nobody', state: 'working' })
  });
  assert.equal(bad.status, 400);

  const get = await fetch('http://127.0.0.1:47831/status');
  const snapshot = await get.json();
  assert.equal(snapshot.ok, true);
  assert.ok(snapshot.bots.oiji);
  server.stop();
  log('상태 API POST/GET/검증 OK');
}

async function testClaudeManager() {
  const store = new Store(path.join(tmp, 'settings2.json'));
  const fake = path.join(tmp, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.sh');
  fs.writeFileSync(fake, '#!/bin/sh\necho "telegram 채널 연결됨"\necho "working on task"\nsleep 30\n', { mode: 0o755 });
  store.set({ claudeCommand: fake, autoReconnect: true, claudeArgs: '' });

  const manager = new ClaudeManager(store, tmp);
  const states = [];
  manager.on('state', (s) => states.push(s.status));
  manager.start();
  await new Promise((r) => setTimeout(r, 2600));
  assert.ok(['starting', 'running'].includes(manager.status), `status=${manager.status}`);
  const hasLine = manager.logBuffer.some((l) => l.line.includes('텔레그램') || l.line.includes('telegram'));
  assert.ok(hasLine, '로그에 채널 출력이 잡혀야 함');
  assert.ok(manager.lastActivity > 0, '활동 시각이 기록되어야 함');

  manager.stop(true);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(manager.status, 'stopped');
  log('클로드 실행/로그/활동감지/정지 OK', JSON.stringify(states.slice(0, 5)));
  manager.dispose();
}

(async () => {
  await testStore();
  await testStatusServer();
  await testClaudeManager();
  console.log('\n백엔드 점검 통과');
})().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
