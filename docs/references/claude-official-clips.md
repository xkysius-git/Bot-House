# Claude 공식 마스코트(Clawd) 애니메이션 클립 조사

조사일: 2026-11-25 · 조사자: 오이지(피클 개인비서) · 범위: X(@claudeai), Instagram(@claudeai)

## 요약

| # | 클립(동작) | 게시일 | 원본 링크 | 대표 캡처 |
|---|---|---|---|---|
| 01 | 깃발 흔들기(Flag Waver) — 격자 깃발 들고 손 흔들기 | 2026-02-07 | https://x.com/claudeai/status/2019833113418035237 | `clips/clip-01-flag.png` |
| 02 | 걷기·살피기(Walking Claude) — 터미널 창 뒤에서 걷고 살피는 클립 | 2026-02-25 | https://x.com/claudeai/status/2026418433911603668 | `clips/clip-02-walking.png` |
| 03 | 콘페티 환호(Confetti Claude) — 발 구르며 콘페티 터뜨리기 | 2026-03-15 | https://x.com/claudeai/status/2032911276226257206 | `clips/clip-03-confetti.png` |
| 04 | 덤벨 운동(Gym Claude) — 덤벨 컬 | (원본 미확인) | (미확인) | (캡처 없음) |

Codrops 역설계 글(Tympanus, 2026-05-05)이 "원본"으로 링크한 X 글 4건 중 실제로 마스코트 애니메이션이 붙은 글은 위 01~03이고, 네 번째 링크
`https://x.com/claudeai/status/1993030562345537692`(2025-11-25, Claude Opus 4.5 발표 스레드)에는 마스코트 클립이 없다(본문은 벤치마크 표 이미지, 스레드 내 영상은 개발자 플랫폼 기능 소개 1:34 영상). 따라서 Gym 클립의 원본 게시물은 이번 조사에서 특정하지 못했다.

## 1) 깃발 흔들기 — 2026-02-07

- 게시물: "Announcing Built with Opus 4.6: a Claude Code virtual hackathon…" (조회 104.1만)
- 링크: https://x.com/claudeai/status/2019833113418035237
- 화면: 베이지 배경에 마스코트가 서 있고, 머리 위로 흑백 격자(체커) 깃발이 펄럭인다. 왼쪽에는 코드 에디터 창이 겹쳐 있다. 캡처 프레임에서 눈은 기본 네모 눈(가로로 긴 두 개의 검은 사각형).
- 포즈 순서(Codrops 분석 기준): ①깃발이 축 늘어져 있다가 ②공기를 받아 들리며 ③완전히 펴진 뒤 ④~⑫ 12프레임 루프로 흔들기. 첫 재생은 12프레임 전부, 이후 루프는 4프레임부터(깃발이 이미 공중에 있는 상태).
- 몸: 발은 고정, 상체만 깃발 반대 방향으로 sway(프레임별 ±5px), 오른손은 깃발이 나가는 반대로 당겨 손목에 붙어 있게(프레임별 0~-18px), 왼손은 특정 프레임에서 4px 내려간다.
- 캡처: `clips/clip-01-flag.png`

## 2) 걷기·살피기 — 2026-02-25

- 게시물: "New in Claude Code: Remote Control… while you take a walk or join a meeting" (조회 1,016.5만)
- 링크: https://x.com/claudeai/status/2026418433911603668
- 화면: 마스코트가 코드 터미널 창 뒤쪽에 서 있고, 오른쪽에 폰 화면 목업이 떠 있다. 캡처 프레임에서 눈은 기본 네모 눈.
- 포즈 순서(Codrops 분석 기준, GSAP 연속 트윈): ①좌우로 살피기(몸 기울기 -3°, 눈 x -3, 다리 4개가 각각 -7~-9° 회전·scaleY 1.15~1.35로 지면을 밀며 늘어남) ②점프 준비 크라우치 0.1초(몸 y+8, 양손 y+10) ③포물선 점프(상승 sine.out, 하강 power3.in, 수평 이동 power1.inOut) ④착지 후 손이 0.05초 오버슈트 뒤 정착 ⑤걷기(다리 축을 발→엉덩이로 전환) ⑥아래 보기 ⑦크라우치 ⑧반대편으로 도약.
- 캡처: `clips/clip-02-walking.png`

## 3) 콘페티 환호 — 2026-03-15

- 게시물: "A small thank you to everyone using Claude: We're doubling usage outside our peak hours…" (조회 1,278.5만)
- 링크: https://x.com/claudeai/status/2032911276226257206
- 화면: 마스코트가 발을 구르고, 머리 위로 색색의 콘페티 픽셀이 터진다. 아래에 터미널 창("> whatever you've been putting off — now's a good time."). 캡처 프레임에서 눈은 기본 네모 눈.
- 포즈 순서(Codrops 분석 기준): 캐릭터 8프레임 스톰프 125ms 루프 — 좌로 기울기 → 위로 뻗기 → 우로 기울기 → 다시 위로 뻗기. 콘페티는 별도 8스프라이트로 위로 솟았다가 흩어지며 사라짐. 첫 burst는 손이 가장 높이 올라간 프레임1에서 1프레임 지연으로, 두 번째 burst는 반대쪽 스톰프(6프레임 지연)에서 좌우 반전해 터진다.
- 캡처: `clips/clip-03-confetti.png`

## 4) 덤벨 운동 — 원본 미확인

- Codrops 분석에는 "Gym Claude"로 소개: 36장을 그려 48비트로 재생(13~24 프레임이 두 번 재생되어 2세트), 컬 정점에서 270ms 정지, 세트 사이 400ms, 마지막 프레임 1.5초 정지.
- 원본 X/인스타 게시물: 이번 조사에서 찾지 못함(위 4번째 링크는 마스코트 클립이 아니었음). 확인되는 대로 보강 필요.

## 눈 표정 정리

- 네 클립 공통으로 캡처된 프레임에서는 **기본 네모 눈**(가로로 긴 검은 사각형 두 개)만 확인했다.
- Codrops 분석 글에는 눈 모양 자체의 프레임별 변화(^ ^, ∪ ∪ 등)는 설명돼 있지 않다. 눈 x좌표 이동(살피기 시 -3px)만 언급된다. 슬로모(0.3x) 프레임 전수 확인은 이번 조사에서 하지 못했으므로, `^ ^`·`∪ ∪` 같은 변형 표정은 **미확인**으로 남긴다.

## 조사 방법과 한계

- X: 각 게시물을 비로그인 상태로 열어 본문·게시일·조회수·영상 첫 프레임을 확인하고 캡처했다. 영상 재생·프레임 스텝은 하지 않았으므로 "포즈 순서"는 Codrops 역설계 글의 프레임 분석을 근거로 적었고, 캡처는 영상 정지 프레임 1장이다.
- `xsearch`로 `from:claudeai mascot`을 검색했으나 결과 0건(공개 검색 인덱스 한계).
- Instagram(@claudeai): 이번 회차에서 접근·확인하지 못했다(로그인 벽). 인스타 릴스 목록은 미확인 상태다.
- 따라서 "전수"가 아니라 **X에서 확인된 3개 클립 + Codrops가 분석한 4번째(Gym)**까지가 이번 조사의 범위다.

## 참고

- Codrops 역설계 글: https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/
- 재현 데모(작성자 Ayoto): https://ayotomcs.me/claude-mascot
- 원본 애니메이션 제작자 언급: Designer Boy(@ayotomcs) — 2026-03-24 X 글
