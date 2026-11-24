'use strict';

/**
 * 앱 안 채팅 (방식 A): 장현님 텔레그램 "사용자 계정"으로 로그인해서 봇 그룹 대화를 보여주고 보낸다.
 * 봇들은 아무것도 바꿀 필요 없고, 폰 텔레그램과 같은 대화가 그대로 보인다.
 *
 * - API ID / API Hash: https://my.telegram.org → API development tools 에서 발급, 앱 설정에 입력
 * - 로그인 세션은 Electron safeStorage(Windows DPAPI)로 암호화해서 userData/tg-session.bin 에만 저장
 *   (세션 = 계정 열쇠. 로그·채팅·repo 어디에도 출력하지 않는다)
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

let gram = null; // 필요할 때만 불러온다 (앱 시작 속도)
function lib() {
  if (!gram) {
    const { TelegramClient, Api } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { NewMessage } = require('telegram/events');
    const { EditedMessage } = require('telegram/events/EditedMessage');
    gram = { TelegramClient, Api, StringSession, NewMessage, EditedMessage };
  }
  return gram;
}

const HISTORY_LIMIT_MAX = 100;

class TelegramChat extends EventEmitter {
  /**
   * @param {{ store, userDataDir: string, safeStorage: Electron.SafeStorage }} opts
   */
  constructor({ store, userDataDir, safeStorage }) {
    super();
    this.store = store;
    this.safeStorage = safeStorage;
    this.sessionFile = path.join(userDataDir, 'tg-session.bin');
    this.client = null;
    this.status = 'off';      // off | need-config | need-login | code-sent | need-password | connecting | ready | error
    this.message = '';
    this.me = null;
    this.peer = null;
    this.names = new Map();   // senderId → { name, isBot }
    this.pending = null;      // 로그인 단계 대기 { phone, codeHash }
  }

  /* ------------------------------------------------------------ 상태 */
  snapshot() {
    return {
      status: this.status,
      message: this.message,
      me: this.me,
      chatId: this.chatId(),
      configured: this.configured(),
      phoneHint: this.pending ? maskPhone(this.pending.phone) : null
    };
  }

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.emit('status', this.snapshot());
  }

  chatId() {
    return String(this.store.get('chatId') || '').trim();
  }

  configured() {
    const s = this.store.all();
    return Boolean(Number(s.tgApiId) && String(s.tgApiHash || '').trim() && this.chatId());
  }

  /* ------------------------------------------------------------ 세션 저장 */
  loadSession() {
    try {
      const buf = fs.readFileSync(this.sessionFile);
      if (!this.safeStorage.isEncryptionAvailable()) return '';
      return this.safeStorage.decryptString(buf);
    } catch (_) {
      return '';
    }
  }

  saveSession() {
    if (!this.client) return;
    if (!this.safeStorage.isEncryptionAvailable()) {
      // 암호화를 못 하면 평문으로 남기지 않는다 (다음 실행 때 다시 로그인)
      this.emit('log', '이 PC에서 암호화 저장을 쓸 수 없어 로그인 상태를 저장하지 않아요.');
      return;
    }
    const str = this.client.session.save();
    fs.writeFileSync(this.sessionFile, this.safeStorage.encryptString(str), { mode: 0o600 });
  }

  clearSession() {
    try { fs.unlinkSync(this.sessionFile); } catch (_) { /* 없음 */ }
  }

  /* ------------------------------------------------------------ 연결 */
  async connect() {
    if (!this.configured()) return this.fail('need-config', '설정에서 텔레그램 API ID·Hash와 채팅방을 입력해 주세요.');
    if (this.client && this.status === 'ready') return this.snapshot();
    const { TelegramClient, StringSession } = lib();
    const s = this.store.all();
    this.setStatus('connecting', '텔레그램에 연결 중');
    try {
      await this.disconnect(true);
      this.client = new TelegramClient(new StringSession(this.loadSession()), Number(s.tgApiId), String(s.tgApiHash).trim(), {
        connectionRetries: 5,
        deviceModel: 'A.I.Mon',
        appVersion: 'A.I.Mon',
        systemVersion: process.platform
      });
      this.client.setLogLevel('error');
      await this.client.connect();
      if (await this.client.checkAuthorization()) {
        await this.onAuthorized();
      } else {
        this.setStatus('need-login', '전화번호로 로그인해 주세요.');
      }
    } catch (err) {
      this.setStatus('error', `연결 실패: ${err.message}`);
    }
    return this.snapshot();
  }

  async disconnect(silent = false) {
    if (this.client) {
      try { await this.client.disconnect(); } catch (_) { /* noop */ }
      try { await this.client.destroy(); } catch (_) { /* noop */ }
    }
    this.client = null;
    this.peer = null;
    if (!silent) this.setStatus('off', '연결 끊음');
  }

  /* ------------------------------------------------------------ 로그인 (전화번호 → 코드 → 2단계 비밀번호) */
  async sendCode(phone) {
    const { Api } = lib();
    if (!this.client) await this.connect();
    if (!this.client) return this.snapshot();
    phone = String(phone || '').replace(/[^\d+]/g, '');
    if (!phone) return this.fail('need-login', '전화번호를 입력해 주세요 (+82로 시작).');
    try {
      const s = this.store.all();
      const res = await this.client.invoke(new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: Number(s.tgApiId),
        apiHash: String(s.tgApiHash).trim(),
        settings: new Api.CodeSettings({})
      }));
      this.pending = { phone, codeHash: res.phoneCodeHash };
      this.setStatus('code-sent', '텔레그램 앱으로 온 로그인 코드를 입력해 주세요.');
    } catch (err) {
      this.fail('need-login', `코드 요청 실패: ${friendly(err)}`);
    }
    return this.snapshot();
  }

  async submitCode(code) {
    const { Api } = lib();
    if (!this.client || !this.pending) return this.fail('need-login', '먼저 전화번호로 코드를 받아 주세요.');
    try {
      await this.client.invoke(new Api.auth.SignIn({
        phoneNumber: this.pending.phone,
        phoneCodeHash: this.pending.codeHash,
        phoneCode: String(code || '').replace(/\D/g, '')
      }));
      this.pending = null;
      await this.onAuthorized();
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        this.setStatus('need-password', '2단계 인증 비밀번호를 입력해 주세요.');
      } else {
        this.fail('code-sent', `코드 확인 실패: ${friendly(err)}`);
      }
    }
    return this.snapshot();
  }

  async submitPassword(password) {
    const { Api } = lib();
    if (!this.client) return this.fail('need-login', '다시 로그인해 주세요.');
    try {
      const { computeCheck } = require('telegram/Password');
      const pwd = await this.client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwd, String(password || ''));
      await this.client.invoke(new Api.auth.CheckPassword({ password: check }));
      this.pending = null;
      await this.onAuthorized();
    } catch (err) {
      this.fail('need-password', `비밀번호 확인 실패: ${friendly(err)}`);
    }
    return this.snapshot();
  }

  async logout() {
    const { Api } = lib();
    try { if (this.client) await this.client.invoke(new Api.auth.LogOut()); } catch (_) { /* 이미 끊김 */ }
    this.clearSession();
    this.me = null;
    await this.disconnect(true);
    this.setStatus(this.configured() ? 'need-login' : 'need-config', '로그아웃했어요.');
    return this.snapshot();
  }

  fail(status, message) {
    this.setStatus(status, message);
    return this.snapshot();
  }

  async onAuthorized() {
    this.saveSession();
    const me = await this.client.getMe();
    this.me = { id: String(me.id), name: displayName(me) };
    this.names.set(String(me.id), { name: this.me.name, isBot: false, isMe: true });
    // 대화방 목록을 한 번 받아 두어야 숫자 ID(-100...)로 그룹을 찾을 수 있다
    await this.client.getDialogs({ limit: 200 });
    try {
      this.peer = await this.client.getInputEntity(toPeerId(this.chatId()));
    } catch (err) {
      return this.setStatus('error', `채팅방(${this.chatId()})을 찾지 못했어요. 이 계정이 그 방에 들어가 있는지 확인해 주세요.`);
    }
    this.watch();
    this.setStatus('ready', '연결됨');
  }

  /* ------------------------------------------------------------ 메시지 */
  watch() {
    const { NewMessage, EditedMessage } = lib();
    const chats = [toPeerId(this.chatId())];
    this.client.addEventHandler(async (ev) => {
      try { this.emit('message', await this.normalize(ev.message)); } catch (_) { /* 무시 */ }
    }, new NewMessage({ chats }));
    this.client.addEventHandler(async (ev) => {
      try { this.emit('edited', await this.normalize(ev.message)); } catch (_) { /* 무시 */ }
    }, new EditedMessage({ chats }));
  }

  async history({ limit = 50, beforeId = 0, topicId = null } = {}) {
    if (this.status !== 'ready') return [];
    const opts = { limit: Math.min(Math.max(Number(limit) || 50, 1), HISTORY_LIMIT_MAX) };
    if (beforeId) opts.offsetId = Number(beforeId);
    if (topicId) opts.replyTo = Number(topicId);
    const msgs = await this.client.getMessages(this.peer, opts);
    const out = [];
    for (const m of msgs) {
      if (m && m.className === 'Message') out.push(await this.normalize(m));
    }
    return out.reverse(); // 오래된 것 → 최신 순
  }

  async send({ text, topicId = null, replyToId = null } = {}) {
    if (this.status !== 'ready') throw new Error('텔레그램에 연결되지 않았어요.');
    const message = String(text || '').trim();
    if (!message) throw new Error('보낼 내용이 없어요.');
    const opts = { message };
    // 포럼 토픽에 보낼 땐 토픽 시작 메시지 ID에 답장하는 형태
    const replyTo = Number(replyToId) || Number(topicId) || null;
    if (replyTo) opts.replyTo = replyTo;
    const sent = await this.client.sendMessage(this.peer, opts);
    return this.normalize(sent);
  }

  async normalize(m) {
    const senderId = m.senderId != null ? String(m.senderId) : '';
    let who = this.names.get(senderId);
    if (!who && senderId) {
      try {
        const s = await m.getSender();
        who = { name: displayName(s), isBot: Boolean(s && s.bot), username: s && s.username ? s.username : null };
      } catch (_) {
        who = { name: '알 수 없음', isBot: false };
      }
      this.names.set(senderId, who);
    }
    const rt = m.replyTo || null;
    const topicId = rt && rt.forumTopic ? Number(rt.replyToTopId || rt.replyToMsgId) : null;
    return {
      id: m.id,
      date: (m.date || 0) * 1000,
      editDate: m.editDate ? m.editDate * 1000 : null,
      senderId,
      senderName: who ? who.name : '',
      username: who && who.username ? who.username : null,
      isBot: Boolean(who && who.isBot),
      isMe: Boolean(who && who.isMe),
      text: m.message || '',
      replyToId: rt && !(rt.forumTopic && !rt.replyToTopId) ? Number(rt.replyToMsgId) || null : null,
      topicId,
      media: m.media ? mediaKind(m.media) : null
    };
  }
}

/* ------------------------------------------------------------ 도우미 */
function displayName(e) {
  if (!e) return '';
  if (e.title) return e.title;
  return [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || String(e.id || '');
}

function toPeerId(id) {
  // "-1003722460872" 같은 문자열 ID를 GramJS가 받는 큰 정수로
  return require('telegram').helpers.returnBigInt(String(id).trim());
}

function mediaKind(media) {
  const n = media.className || '';
  if (n.includes('Photo')) return 'photo';
  if (n.includes('Document')) return 'file';
  if (n.includes('WebPage')) return null; // 링크 미리보기는 본문에 링크가 있음
  return 'media';
}

function maskPhone(p) {
  return p.length > 4 ? `${p.slice(0, 3)}****${p.slice(-2)}` : '****';
}

function friendly(err) {
  const code = err && (err.errorMessage || err.message) || '알 수 없는 오류';
  const map = {
    PHONE_NUMBER_INVALID: '전화번호 형식이 맞지 않아요 (+82...)',
    PHONE_CODE_INVALID: '코드가 맞지 않아요',
    PHONE_CODE_EXPIRED: '코드가 만료됐어요. 다시 받아 주세요',
    PASSWORD_HASH_INVALID: '비밀번호가 맞지 않아요',
    API_ID_INVALID: 'API ID/Hash가 맞지 않아요 (my.telegram.org 확인)',
    FLOOD_WAIT: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요'
  };
  const key = Object.keys(map).find((k) => String(code).startsWith(k));
  return key ? map[key] : code;
}

module.exports = { TelegramChat };
