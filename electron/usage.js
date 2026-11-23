'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

/**
 * 로컬 AI 도구의 토큰 사용량을 세션 기록에서 직접 합산한다.
 * 없는 값은 만들지 않고, 못 읽으면 못 읽었다고 돌려준다.
 */

const DAY = 24 * 60 * 60 * 1000;

function homeDir() {
  return process.env.BOTHOUSE_HOME || os.homedir();
}

function dateKey(ts, tzOffsetMin) {
  const d = new Date(ts - (tzOffsetMin || 0) * 60000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyTotals() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

function addTotals(target, part) {
  target.input += part.input || 0;
  target.output += part.output || 0;
  target.cacheWrite += part.cacheWrite || 0;
  target.cacheRead += part.cacheRead || 0;
  target.total = target.input + target.output + target.cacheWrite + target.cacheRead;
  return target;
}

async function eachLine(file, onObject) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{') continue;
      let obj;
      try { obj = JSON.parse(trimmed); } catch (_) { continue; }
      onObject(obj);
    }
  } catch (_) {
    // 읽을 수 없는 파일은 건너뛴다
  } finally {
    rl.close();
    stream.close();
  }
}

function collectFiles(root, ext, maxFiles = 4000, maxSize = 64 * 1024 * 1024) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const stack = [root];
  let guard = 0;
  while (stack.length && out.length < maxFiles && guard < 20000) {
    guard += 1;
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(ext)) {
        try {
          const st = fs.statSync(full);
          if (st.size > 0 && st.size < maxSize) out.push({ file: full, size: st.size, mtimeMs: st.mtimeMs });
        } catch (_) { /* noop */ }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------ Claude Code */
function claudeUsageFromObj(obj, acc, seen) {
  const usage = obj && obj.message && obj.message.usage;
  if (!usage) return false;
  const id = obj.message.id || obj.uuid || '';
  if (id) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  const part = {
    input: Number(usage.input_tokens) || 0,
    output: Number(usage.output_tokens) || 0,
    cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
    cacheRead: Number(usage.cache_read_input_tokens) || 0
  };
  const ts = Date.parse(obj.timestamp || obj.created_at || '') || acc.lastTs;
  if (ts) acc.lastTs = Math.max(acc.lastTs, ts);
  const key = localDateKey(ts || Date.now());
  if (!acc.days[key]) acc.days[key] = emptyTotals();
  addTotals(acc.days[key], part);
  acc.messages += 1;
  acc.model = (obj.message && obj.message.model) || acc.model;
  return true;
}

/* ------------------------------------------------------------ Codex CLI */
function codexUsageFromObj(obj, acc) {
  const payload = obj && obj.payload;
  if (!payload) return false;
  const isCount = payload.type === 'token_count';
  const info = payload.info || payload;
  let usage = null;

  if (isCount) {
    usage = (info && (info.total_token_usage || info.usage)) || null;
  } else if (payload.type === 'event_msg' && payload.usage) {
    usage = payload.usage;
  } else if (payload.usage && (payload.usage.input_tokens || payload.usage.total_tokens)) {
    usage = payload.usage;
  }
  if (!usage) return false;

  const input = Number(usage.input_tokens ?? usage.input ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.output ?? 0) || 0;
  const cached = Number(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? usage.total ?? 0) || (input + output);

  // 누적치를 보고 있는 경우가 많으므로 파일별 마지막 값을 쓴다
  acc.last = {
    input, output, cacheRead: cached, cacheWrite: 0, total: Math.max(total, input + output)
  };
  const ts = Date.parse(obj.timestamp || payload.timestamp || '') || acc.lastTs;
  if (ts) { acc.lastTs = Math.max(acc.lastTs, ts); acc.lastTsExact = ts || acc.lastTsExact; }
  return true;
}

/* ------------------------------------------------------------ 공용 수집 */
class UsageMonitor {
  constructor(options = {}) {
    this.home = options.home || homeDir();
    this.cache = new Map();      // file → { size, mtimeMs, result }
    this.lastSnapshot = null;
    this.lastScan = 0;
    this.scanning = null;
  }

  dirs() {
    const env = process.env;
    return {
      claude: env.BOTHOUSE_CLAUDE_DIR || path.join(this.home, '.claude', 'projects'),
      codex: env.BOTHOUSE_CODEX_DIR || path.join(this.home, '.codex', 'sessions'),
      codexAlt: path.join(this.home, '.codex', 'log'),
      gemini: env.BOTHOUSE_GEMINI_DIR || path.join(this.home, '.gemini', 'tmp'),
      credentials: path.join(this.home, '.claude', '.credentials.json')
    };
  }

  dayList(count = 7) {
    const days = [];
    const now = Date.now();
    for (let i = count - 1; i >= 0; i -= 1) {
      const ts = now - i * DAY;
      days.push({ key: localDateKey(ts), ts });
    }
    return days;
  }

  summarize(daysMap, days) {
    const today = daysMap[days[days.length - 1].key] || emptyTotals();
    const week = emptyTotals();
    for (const d of days) {
      const v = daysMap[d.key];
      if (v) addTotals(week, v);
    }
    return {
      today: { ...today },
      week: { ...week },
      days: days.map((d) => ({ date: d.key, total: (daysMap[d.key] || emptyTotals()).total }))
    };
  }

  async scanClaude(dir, days) {
    const files = collectFiles(dir, '.jsonl');
    const perDay = {};
    let sessionCount = 0;
    let lastActivity = 0;
    let model = '';
    let parsedFiles = 0;

    for (const info of files) {
      const cached = this.cache.get(info.file);
      let result;
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        result = cached.result;
      } else {
        const acc = { days: {}, messages: 0, lastTs: 0, model: '' };
        const seen = new Set();
        await eachLine(info.file, (obj) => claudeUsageFromObj(obj, acc, seen));
        result = {
          days: acc.days,
          messages: acc.messages,
          lastTs: acc.lastTs || info.mtimeMs,
          model: acc.model
        };
        this.cache.set(info.file, { size: info.size, mtimeMs: info.mtimeMs, result });
      }
      parsedFiles += 1;
      if (result.messages) sessionCount += 1;
      for (const [key, totals] of Object.entries(result.days)) {
        if (!perDay[key]) perDay[key] = emptyTotals();
        addTotals(perDay[key], totals);
      }
      if (result.lastTs > lastActivity) { lastActivity = result.lastTs; model = result.model || model; }
    }

    const summary = this.summarize(perDay, days);
    const installed = fs.existsSync(dir);
    return {
      id: 'claude',
      name: 'Claude Code',
      installed,
      source: dir.replace(this.home, '~'),
      files: parsedFiles,
      sessions: sessionCount,
      model,
      lastActivity: lastActivity || null,
      ...summary
    };
  }

  async scanCodex(dirs, days) {
    const roots = [dirs.codex, dirs.codexAlt].filter((p) => p && fs.existsSync(p));
    if (!roots.length) {
      return {
        id: 'codex', name: 'Codex CLI', installed: false, source: '~/.codex',
        reason: '설치되어 있지 않거나 기록이 없어요',
        today: emptyTotals(), week: emptyTotals(), days: days.map((d) => ({ date: d.key, total: 0 })),
        sessions: 0, lastActivity: null
      };
    }

    const files = [];
    for (const root of roots) files.push(...collectFiles(root, '.jsonl', 2000));
    const perDay = {};
    let lastActivity = 0;
    let sessions = 0;

    for (const info of files) {
      const cached = this.cache.get(info.file);
      let result;
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        result = cached.result;
      } else {
        const acc = { last: null, lastTs: 0 };
        await eachLine(info.file, (obj) => codexUsageFromObj(obj, acc));
        result = acc.last ? { totals: acc.last, ts: acc.lastTs || info.mtimeMs } : null;
        this.cache.set(info.file, { size: info.size, mtimeMs: info.mtimeMs, result });
      }
      if (!result) continue;
      sessions += 1;
      const key = localDateKey(result.ts);
      if (!perDay[key]) perDay[key] = emptyTotals();
      addTotals(perDay[key], result.totals);
      if (result.ts > lastActivity) lastActivity = result.ts;
    }

    const summary = this.summarize(perDay, days);
    return {
      id: 'codex',
      name: 'Codex CLI',
      installed: true,
      source: roots[0].replace(this.home, '~'),
      sessions,
      files: files.length,
      lastActivity: lastActivity || null,
      ...summary
    };
  }

  scanGemini(dirs, days) {
    const root = dirs.gemini;
    const installed = fs.existsSync(root);
    const base = {
      id: 'gemini', name: 'Gemini CLI', installed, source: '~/.gemini',
      today: emptyTotals(), week: emptyTotals(),
      days: days.map((d) => ({ date: d.key, total: 0 })),
      sessions: 0, lastActivity: null
    };
    if (!installed) {
      return { ...base, reason: '설치되어 있지 않거나 기록이 없어요' };
    }
    // Gemini CLI는 채팅 JSON에 토큰 수를 남기지만 형식이 바뀌어 왔다. 읽히지 않으면 숨기지 않고 알린다.
    const files = collectFiles(root, '.json', 500);
    return {
      ...base,
      files: files.length,
      reason: files.length ? '이 형식의 기록은 아직 읽지 못해요' : '기록이 없어요'
    };
  }

  async claudeQuota(dirs) {
    const file = dirs.credentials;
    if (!fs.existsSync(file)) {
      return { available: false, reason: '인증 파일이 없어요', plan: '' };
    }
    let creds;
    try {
      creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return { available: false, reason: '인증 파일을 읽지 못했어요', plan: '' };
    }
    const oauth = creds.claudeAiOauth || creds.oauth || {};
    const token = oauth.accessToken || oauth.access_token || '';
    const plan = oauth.subscriptionType || oauth.subscription || '';
    if (!token) return { available: false, reason: '로그인 정보가 없어요', plan };

    try {
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) {
        return { available: false, reason: `쿼터를 받지 못했어요 (${res.status})`, plan };
      }
      const data = await res.json();
      const pick = (key, label) => {
        const node = data[key];
        if (!node) return null;
        let util = node.utilization;
        if (typeof util !== 'number') util = null;
        if (util !== null && util <= 1) util = util * 100;
        return {
          label,
          usedPercent: util === null ? null : Math.round(util),
          resetsAt: node.resets_at || node.resetsAt || null
        };
      };
      const fiveHour = pick('five_hour', '5시간');
      const weekly = pick('seven_day', '주간');
      if (!fiveHour && !weekly) {
        return { available: false, reason: '쿼터 정보를 찾지 못했어요', plan };
      }
      return { available: true, plan, fiveHour, weekly };
    } catch (_) {
      return { available: false, reason: '쿼터 조회에 실패했어요', plan };
    }
  }

  async snapshot(force = false) {
    const now = Date.now();
    if (!force && this.lastSnapshot && now - this.lastScan < 20000) return this.lastSnapshot;
    if (this.scanning) return this.scanning;
    const dirs = this.dirs();
    const days = this.dayList(7);
    this.scanning = (async () => {
      const [claude, codex] = await Promise.all([
        this.scanClaude(dirs.claude, days),
        this.scanCodex(dirs, days)
      ]);
      const gemini = this.scanGemini(dirs, days);
      const quota = await this.claudeQuota(dirs);
      claude.quota = quota;
      const snapshot = {
        updatedAt: Date.now(),
        home: this.home,
        tools: [claude, codex, gemini],
        days: days.map((d) => d.key)
      };
      this.lastSnapshot = snapshot;
      this.lastScan = Date.now();
      this.scanning = null;
      return snapshot;
    })();
    return this.scanning;
  }
}

module.exports = { UsageMonitor, emptyTotals };
