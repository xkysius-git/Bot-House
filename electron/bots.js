'use strict';

/**
 * 봇 4인방 정의와 상태 헬퍼.
 * 좌석 좌표는 하우스 캔버스(480x270) 기준이며, 책상 앞자리와 맞춰져 있다.
 */
const BOTS = [
  {
    id: 'oiji',
    name: '오이지',
    role: '피클 · 메인 비서',
    handle: '@xky_oiji_bot',
    color: '#3FBF6A',
    seat: { x: 268, y: 178 },
    home: { x: 92, y: 240 },
    tagline: '일정 · 루틴'
  },
  {
    id: 'takuan',
    name: '단무지',
    role: '뮤즈 · 석박지 관리',
    handle: '@xky_takuan_bot',
    color: '#F2E3CB',
    seat: { x: 336, y: 178 },
    home: { x: 148, y: 252 },
    tagline: '더블체크 · IA'
  },
  {
    id: 'sbji',
    name: '석박지',
    role: 'K-EXAONE 두뇌',
    handle: '@xky_sbji_bot',
    color: '#B15CE8',
    seat: { x: 400, y: 178 },
    home: { x: 186, y: 238 },
    tagline: '조사 · 분석'
  },
  {
    id: 'claude',
    name: '클로드',
    role: 'Claude Code · 채널',
    handle: '@xky_claude_bot',
    color: '#E07A5F',
    seat: { x: 448, y: 178 },
    home: { x: 120, y: 230 },
    tagline: '작업 실행'
  }
];

const STATES = ['idle', 'working', 'offline'];

function initialBotState() {
  const out = {};
  for (const bot of BOTS) {
    out[bot.id] = {
      state: bot.id === 'claude' ? 'offline' : 'idle',
      note: '',
      lastActivity: null,
      source: 'default',
      usage: null,
      usageAt: null,
      updatedAt: Date.now()
    };
  }
  return out;
}

function isBot(id) {
  return BOTS.some((b) => b.id === id);
}

module.exports = { BOTS, STATES, initialBotState, isBot };
