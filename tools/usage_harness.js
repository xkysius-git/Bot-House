const { UsageMonitor } = require('../electron/usage.js');
const path = require('path');
(async () => {
  process.env.BOTHOUSE_CLAUDE_DIR = path.join(__dirname, 'fixtures', 'claude-projects');
  process.env.BOTHOUSE_CODEX_DIR = path.join(__dirname, 'fixtures', 'codex-sessions');
  process.env.BOTHOUSE_GEMINI_DIR = path.join(__dirname, 'fixtures', 'no-gemini');
  const m = new UsageMonitor({ home: '/home/nonexistent' });
  const snap = await m.snapshot(true);
  console.log(JSON.stringify(snap, null, 2));
})();
