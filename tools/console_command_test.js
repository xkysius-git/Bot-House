// A.I.Mon — Windows 콘솔 창 명령(windowConsoleCommand) 점검
// 실행: node tools/console_command_test.js
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { windowsConsoleCommand, consoleLaunchPlan } = require('../electron/claude-manager');

const cmd = 'C:\\Users\\XKY\\AppData\\Roaming\\npm\\claude.cmd';
const args = ['--channels', 'plugin:telegram@claude-plugins-official'];
const command = windowsConsoleCommand(cmd, args);

// 1) MCP_TIMEOUT=90000이 claude 실행 전에 설정되어야 한다 (기본 30초로는 채널 연결이 끊김)
assert.match(command, /set "MCP_TIMEOUT=90000"/, 'MCP_TIMEOUT=90000 설정이 없음');
assert.ok(command.indexOf('set "MCP_TIMEOUT=90000"') < command.indexOf(`"${cmd}"`),
  'MCP_TIMEOUT은 claude 실행보다 먼저 설정되어야 함');

// 2) 창 제목·코드페이지·실행 인용부호
assert.ok(command.startsWith('title A.I.Mon Claude Channel'), `창 제목: ${command}`);
assert.ok(command.includes('chcp 65001>nul'), 'UTF-8 코드페이지 설정이 없음');
assert.ok(command.includes(`"${cmd}" "--channels"`), '경로/인자 인용이 잘못됨');

console.log('· windowsConsoleCommand: MCP_TIMEOUT·제목·인자 OK');
console.log('  ', command);

// 3) PowerShell 실행 계획: 최소화 창으로 띄우고 /d /s /k로 claude를 넘긴다
const plan = consoleLaunchPlan('C:\\Windows\\System32\\cmd.exe', command, 'C:\\Users\\XKY\\projects');
assert.equal(plan.argumentLine, `/d /s /k "${command}"`);
assert.ok(plan.script.includes('-WindowStyle Minimized'), '최소화 실행이 아님');
assert.ok(plan.script.includes("'C:\\Users\\XKY\\projects'"), '작업 폴더가 없음');
assert.ok(plan.script.includes('PID'), 'PID 출력이 없음');
console.log('· consoleLaunchPlan: 최소화 실행 계획 OK');

// 4) MCP_TIMEOUT 환경변수를 직접 준 경우 그 값을 존중한다
const out = execFileSync(process.execPath, ['-e',
  "const {windowsConsoleCommand}=require('./electron/claude-manager');" +
  "process.stdout.write(windowsConsoleCommand('claude', []));"
], { cwd: path.join(__dirname, '..'), env: { ...process.env, MCP_TIMEOUT: '120000' }, encoding: 'utf8' });
assert.match(out, /set "MCP_TIMEOUT=120000"/, `환경변수 우선 적용 실패: ${out}`);
console.log('· MCP_TIMEOUT 환경변수 우선 적용 OK');

// 5) Windows Terminal: 배치 파일에 MCP_TIMEOUT·폴더·실행이 순서대로 들어가야 한다
const { launcherScript, wtLaunchPlan, LAUNCHER_NAME } = require('../electron/claude-manager');
const bat = launcherScript(cmd, args, 'C:\\claude-telegram');
const lines = bat.split('\r\n');
assert.ok(lines.includes('cd /d "C:\\claude-telegram"'), `작업 폴더 이동이 없음: ${bat}`);
assert.ok(lines.indexOf('set "MCP_TIMEOUT=90000"') < lines.indexOf(`"${cmd}" "--channels" "${args[1]}"`),
  'MCP_TIMEOUT은 claude 실행보다 먼저 설정되어야 함');
console.log('· launcherScript: 배치 파일 OK');

// 6) wt.exe 실행 계획: 새 창·고정 제목·최소화, 배치 파일을 cmd /k로 넘긴다
const launcher = `C:\\Temp\\${LAUNCHER_NAME}`;
const wtPlan = wtLaunchPlan('C:\\wt.exe', 'C:\\Windows\\System32\\cmd.exe', launcher);
assert.ok(wtPlan.argumentLine.startsWith('-w new new-tab --title "A.I.Mon Claude Channel" --suppressApplicationTitle'),
  `wt 인자: ${wtPlan.argumentLine}`);
assert.ok(wtPlan.argumentLine.endsWith(`/d /k "${launcher}"`), `배치 파일 전달: ${wtPlan.argumentLine}`);
assert.ok(wtPlan.script.includes('-WindowStyle Minimized'), 'wt 최소화 실행이 아님');
console.log('· wtLaunchPlan: Windows Terminal 실행 계획 OK');

console.log('\n콘솔 명령 점검 통과');
