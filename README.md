# Bot House

봇들이 사는 집. Windows용 데스크톱 앱으로, 앱을 켜면 픽셀 하우스에 봇 캐릭터들이 돌아다니고, Claude Code 텔레그램 채널이 자동으로 연결됩니다.

![house](docs/house.png)

## 무엇을 하나요

- **픽셀 하우스** — 왼쪽은 휴게실(소파·러그·창문), 오른쪽은 작업실(책상·모니터·서버랙). 노는 봇은 휴게실을 거닐고, 일하는 봇은 자기 책상으로 걸어가 앉습니다. 책상 위 말풍선으로 누가 무엇을 하는지 바로 보입니다.
- **Claude 채널 자동 연결** — 앱을 켜면 `claude --channels plugin:telegram@claude-plugins-official`을 백그라운드로 실행합니다. 끊기면 자동 재시도(최대 5회)하고, 로그 패널에서 실시간 출력을 볼 수 있습니다.
- **봇 상태** — 클로드는 실행 중인 프로세스와 `~/.claude/projects` 세션 기록으로 실제 작업 여부를 감지합니다. 오이지·단무지·석박지는 상태 API로 신호를 받습니다.
- **토큰 사용량 대시보드** — 이 PC에 있는 AI 도구의 세션 기록에서 오늘/이번 주 토큰을 직접 합산합니다(Claude Code, Codex CLI 등). 원격 봇은 API로 받은 값만 표시하고, 없으면 '신호 대기'로 정직하게 표시합니다.
- **트레이 상주** — 창을 닫아도 트레이에서 계속 돌아갑니다. 트레이 메뉴: 열기 / Claude 재연결 / 채널 멈추기 / 종료.

## 설치

1. Releases에서 `BotHouse-1.0.0-x64-setup.exe`(설치본) 또는 `BotHouse-1.0.0-portable.exe`(설치 없이 실행)를 받습니다.
2. 실행하면 창이 열리고, Claude CLI가 있으면 채널 연결을 시도합니다.
3. Claude CLI가 없다면 설정에서 실행 경로를 지정할 수 있습니다.

## 설정 항목

| 항목 | 설명 |
| --- | --- |
| Claude를 실행할 폴더 | 채널이 실행될 작업 폴더. 비우면 사용자 폴더 |
| 앱을 켜면 자동 연결 | 실행 시 채널 자동 시작 |
| 끊기면 자동 재연결 | 종료 감지 시 지수 백오프로 재시도 |
| 창을 닫으면 트레이로 숨기기 | X를 눌러도 종료하지 않음 |
| 윈도우 시작할 때 같이 실행 | 로그인 시 자동 실행 |
| 화면 테마 | 밤 / 낮 |
| Claude 실행 명령 · 채널 인자 | 자동 탐색 실패 시 직접 지정 |

## 봇 상태 API

텔레그램 `getUpdates`는 쓰지 않습니다(피클 서버의 오프셋과 충돌). 대신 로컬 API로 상태와 사용량을 받습니다.

```bash
# 전체 상태
curl http://127.0.0.1:47820/status

# 봇 상태 알리기 (오이지가 작업을 시작할 때)
curl -X POST http://127.0.0.1:47820/status \
  -H "Content-Type: application/json" \
  -d '{"bot":"oiji","state":"working","note":"가계부 정리"}'

# 토큰 사용량까지 함께
curl -X POST http://127.0.0.1:47820/status \
  -H "Content-Type: application/json" \
  -d '{"bot":"takuan","state":"idle","usage":{"todayTokens":182000,"weekTokens":940000}}'
```

`state`는 `idle` / `working` / `offline` 중 하나입니다. 설정의 '상태 주소'에 JSON URL을 넣으면 주기적으로 읽어 옵니다.

## 토큰 사용량은 어디서 오나요

- **Claude Code**: `~/.claude/projects/**/*.jsonl`의 assistant 메시지 `usage` 필드(input/output/cache)를 날짜별로 합산.
- **쿼터**: `~/.claude/.credentials.json`의 OAuth 토큰으로 Claude 사용량 조회를 시도하고, 안 되면 로컬 합산만 표시합니다.
- **Codex CLI**: `~/.codex/sessions/**/*.jsonl`의 `token_count` 이벤트에서 세션별 누적 토큰을 읽음.
- **Gemini CLI**: `~/.gemini`에 기록이 있으면 표시, 형식을 아직 읽지 못하면 그렇다고 표시.
- **원격 봇**: 이 PC에서 셀 수 없으므로 상태 API로 받은 값만 표시. 없으면 '신호 대기'.

숫자는 지어내지 않습니다. 읽지 못하면 읽지 못했다고 표시합니다.

## 개발

```bash
npm install
npm start          # 전자 실행
npm run dist       # Windows 설치본 + 포터블 빌드 (dist/)
```

픽셀 아트는 `tools/gen_art.py`(배경·스프라이트)와 `tools/sprites.py`(캐릭터)로 생성합니다. 결과물은 `assets/`에 커밋되어 있습니다.

UI만 빠르게 확인하려면 `renderer/index.html`을 브라우저로 열면 됩니다(가짜 상태로 동작하는 미리보기 모드).

## 참고

- 이 앱은 사용자의 PC에서만 동작합니다. 원격 봇의 상태/사용량은 각 봇이 API로 알려줘야 보입니다.
- Claude CLI 로그인은 미리 되어 있어야 합니다(`claude` 실행 후 `/login`).
