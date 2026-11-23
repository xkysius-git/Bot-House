# 앱 안 채팅 (방식 A)

장현님 **텔레그램 사용자 계정**으로 로그인해서 봇 그룹 대화를 앱 안에서 보고 보낸다.
봇들은 바꿀 것 없음. 폰 텔레그램과 같은 대화가 양쪽에 보인다.

## 장현님 준비 (한 번만)

1. https://my.telegram.org 로그인 → **API development tools** → 앱 하나 생성 (이름 아무거나, 예: Bot House)
2. 나온 **api_id**(숫자)와 **api_hash**를 Bot House 설정에 입력 (채팅에 붙여넣지 말 것)
3. 채팅 화면에서 전화번호(+82...) → 텔레그램으로 온 코드 → (2단계 인증 켜져 있으면) 비밀번호
4. 로그인 상태는 이 PC에만 암호화(DPAPI)해서 저장. 끊으려면 채팅 화면의 로그아웃, 또는 폰 텔레그램 → 설정 → 기기 → "Bot House" 세션 종료

## 렌더러 API (`window.botHouse.chat`) — 오이지용

| 호출 | 설명 |
|---|---|
| `status()` | 현재 상태 스냅샷 |
| `connect()` | 연결 (저장된 로그인 있으면 자동 `ready`) |
| `sendCode(phone)` | 로그인 코드 요청 → `code-sent` |
| `submitCode(code)` | 코드 확인 → `ready` 또는 `need-password` |
| `submitPassword(pw)` | 2단계 비밀번호 → `ready` |
| `logout()` | 로그아웃 + 저장된 세션 삭제 |
| `history({ limit, beforeId, topicId })` | 과거 메시지 (오래된 것 → 최신). `beforeId`로 위로 더 불러오기, `topicId`로 토픽만 |
| `send({ text, topicId, replyToId })` | 보내기. 토픽에 보내려면 `topicId` (예: 브리핑 595) |
| `onStatus(fn)` / `onMessage(fn)` / `onEdited(fn)` | 실시간 이벤트. 해제 함수 반환 |

상태(`status`) 값: `need-config` 설정 필요 · `need-login` 전화번호 입력 · `code-sent` 코드 입력 · `need-password` 비밀번호 입력 · `connecting` · `ready` · `error` · `off`
스냅샷: `{ status, message, me: { id, name }, chatId, configured, phoneHint }` — `message`는 그대로 화면에 보여주면 되는 한국어 문장.

메시지 형태:

```js
{ id, date /*ms*/, editDate, senderId, senderName, username, isBot, isMe,
  text, replyToId, topicId /*포럼 토픽, 일반은 null*/, media /*'photo'|'file'|'media'|null*/ }
```

봇 구분은 `username`으로: `xky_oiji_bot`, `xky_takuan_bot`, `xky_sbji_bot`, `xky_claude_bot` → 캐릭터 아바타 연결.

## 설정 키 (settings.json)

`tgApiId`, `tgApiHash`, `chatId`(기본 `-1003722460872`). 바꾸면 자동 재연결.

## 아직 안 되는 것 (다음 단계)

- 사진/파일 미리보기 (지금은 `media` 종류만)
- 메시지 삭제/수정 반영, 읽음 표시
