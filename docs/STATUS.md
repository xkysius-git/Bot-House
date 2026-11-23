# 봇 상태 연동

Bot House가 각 봇의 실제 상태(작업 중 / 쉬는 중 / 오프라인)를 표시하는 방법.

## 클로드 (이 PC)

자동이에요. 설정할 것 없음.

- Windows에서는 앱이 `claude --channels`를 **최소화된 실제 콘솔 창**으로 띄웁니다 (v1.0.5부터). Claude Code는 TTY가 있어야 채널이 붙어서, 보이지 않는 파이프로는 바로 끝나 버립니다. 창 제목은 `BotHouse Claude Channel`이고 작업 표시줄에 내려가 있습니다. 창을 열면 실시간 출력·오류를 그대로 볼 수 있습니다.
- 앱의 로그 탭에는 "최소화된 터미널 창으로 Claude 채널을 실행했어요 (PID …)"처럼 실행·연결·끊김 기록이 남습니다. 채널이 살아 있는지는 명령줄에 `--channels`가 들어간 claude/node 프로세스를 주기적으로 확인해서 판단합니다(6~8초 간격, 확인 실패 시 이전 상태 유지).
- 채널이 사라지면 창은 닫지 않고 두고 상태만 `끊김`으로 바꿉니다(마지막 출력 확인용). 60초 넘게 돌다가 끊긴 경우에만 15초 뒤 한 번 더 띄우고(최대 3회), 시작 직후 실패면 재시도하지 않습니다.
- 앱이 직접 띄운 `claude --channels` 세션이 있으면 그 상태를 씁니다.
- 없으면 **다른 창에서 켠** `claude --channels` 프로세스를 15초마다 찾아서 "다른 창에서 연결됨"으로 표시합니다.
- 대화 기록(`~/.claude/projects/**/*.jsonl`)이 1분 안에 갱신됐으면 "작업 중".
- 앱을 켤 때 다른 창 세션이 이미 있으면 앱은 claude를 새로 띄우지 않습니다. (같은 봇 토큰으로 두 개가 붙으면 서로 끊겨서 계속 실패함)

## 원격 봇 (오이지 · 단무지 · 석박지)

원격 서버에서 도는 봇은 PC의 `127.0.0.1:47820`에 닿을 수 없어서, **GitHub Gist 하나**를 상태판으로 씁니다.

### 1. 준비 (한 번만)

1. https://gist.github.com 에서 Secret gist 생성. 파일 3개: `oiji.json`, `takuan.json`, `sbji.json` (내용은 `{}`)
2. 토큰 만들기: GitHub → Settings → Developer settings → Personal access tokens (classic) → 권한 **gist만** 체크
3. 토큰은 각 봇 서버의 환경변수/Secrets에만 넣기 (채팅·커밋 금지)
4. Bot House 설정 → 고급 설정 → **상태 주소**에 gist URL 입력 (예: `https://gist.github.com/xkysius-git/<ID>`)

### 2. 봇이 보내는 신호

봇마다 **자기 파일만** 수정합니다. 서로 덮어쓰지 않아요.

```bash
curl -s -X PATCH "https://api.github.com/gists/$GIST_ID" \
  -H "Authorization: Bearer $GIST_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"files\":{\"oiji.json\":{\"content\":\"{\\\"state\\\":\\\"working\\\",\\\"note\\\":\\\"가계부 정리\\\",\\\"updatedAt\\\":$(date +%s)}\"}}}"
```

파일 내용 형식:

```json
{ "state": "working", "note": "가계부 정리", "updatedAt": 1795412863 }
```

| 필드 | 값 |
|---|---|
| `state` | `working` / `idle` / `offline` |
| `note` | 화면에 보일 한 줄 (80자까지) |
| `updatedAt` | 보낸 시각. 유닉스 초·밀리초 또는 ISO 문자열 |

### 3. 언제 보내나

- 작업 시작 → `working`, 작업 끝 → `idle`
- 살아 있다는 신호: **5분마다** 현재 상태로 한 번 (내용 그대로, `updatedAt`만 갱신)
- 정상 종료 시 → `offline`

`updatedAt`이 **10분** 넘게 갱신 안 되면 앱이 자동으로 "신호 끊김 · N분 전"으로 오프라인 처리해요.
석박지처럼 필요할 때만 불리는 봇은 호출될 때 `working`, 끝나면 `idle`만 보내도 됩니다 (그 사이엔 오프라인으로 보이는 게 정상).

### 참고

- 앱은 Gist를 **60초마다** 확인합니다 (GitHub 무인증 한도 때문. 변경 없으면 304로 한도 소모 없음).
- 상태 주소에 Gist 대신 일반 JSON URL(`{"bots":{"oiji":{"state":"idle"}}}`)을 넣어도 됩니다.
