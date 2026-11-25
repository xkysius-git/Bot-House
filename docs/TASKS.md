# 작업판 (TASKS)

봇 셋이 같이 쓰는 할 일 목록. **작업 시작 전에 `git pull` 하고 이 파일부터 읽는다.** 맡은 줄은 본인이 바로 고치고 push.
상태: `대기` `진행` `검토` `완료` `보류`. 마감은 KST 숫자로.

| # | 일 | 담당 | 산출물 형태 | 툴·방식 | 마감 | 상태 | 결과물 |
|---|---|---|---|---|---|---|---|
| 1 | 단무지(Jolly) 5모션 스프라이트 시트 (원본 `06-takuan-jolly-128` 기준) | 오이지 | PNG 512×640 | 기준 원화 64×64 추출 + PIL 변형·정렬 | 오늘 22:15 | 검토 | `assets/sprites/takuan-sheet-512x640.png` · `takuan-sheet-preview-dark.png` |
| 2 | 클로드 5모션 스프라이트 시트 (5행 = 걷기) | **단무지** (오이지가 #18로 가르친 뒤, 장현님 11-25 "뮤즈 가르쳐서 시켜") | PNG 512×640 | 1줄(4프레임)씩 생성 + PIL 정렬 | 11-25 | 대기 (#18 배우는 중) | |
| 3 | 오이지 5모션 스프라이트 시트 (`03-oiji-bubble-128` 비눗방울 5줄 / 초기 방울 크기 아담하게 / 2행 자음 변신은 `oiji-14-bubbles.png` 파스텔 색감·형태 그대로 / 4행 완전 감은 눈 / 5행 발 없이 부유) | 오이지 | PNG 512×640 | 기준 원화 64×64 추출 + PIL 변형·정렬 | 오늘 11:30 | 검토 | `assets/sprites/oiji-sheet-512x640.png` · `oiji-sheet-preview-dark.png` · `all-sheets-preview-dark.png` |
| 4 | 석박지 5모션 스프라이트 시트 (`04-sbji-128` 기준 5줄 / 하늘색 세로 LED 눈 / 2행 천 색·형태 일렁임 / 4행 전원 꺼짐=눈 없음 / 5행 발 없이 부유) | 오이지 | PNG 512×640 | 기준 원화 64×64 추출 + PIL 변형·정렬 | 오늘 11:30 | 검토 | `assets/sprites/sbji-sheet-512x640.png` · `sbji-sheet-preview-dark.png` |
| 5 | 시트 규격 검사·조립 | 단무지 (최종 스펙 검수 클로디) | 검사 결과 메시지 | PIL | 시트 올라온 뒤 30분 | 대기 | |
| 6 | 메뉴 조작 시안 (안1 3버튼+아이콘 줄 / 안2 휠) | 오이지 | 이미지 (시안 2종) | 이미지 생성 툴 + UI 목업 | 오늘 22:45 | 대기 (시트 완료 후) | |
| 7 | 홀로그램 기기 리디자인 (B안: 화면 전체가 기기 위에 떠 있는 홀로그램) | 오이지 시안 → 클로디 코드 | 시안 이미지 → 앱 버전 | | 메뉴 조작안 확정 후 | 보류 (6번 다음) | |
| 8 | v1.0.8·1.0.9 수정 실제 앱에서 확인 (설정창 클릭, × 트레이, 액정 스크롤·클릭, D-패드 화면 단위 넘김) | 장현님 (15번과 같이) | 확인 결과 | 앱 직접 사용 | 장현님 편할 때 | 대기 | |
| 9 | 저장소 이름 A.I.Mon으로 변경 | 클로디 | | package.json publish repo와 같은 버전에서 | 안정화 후 | 보류 (결정: 당분간 Bot-House 유지) | |
| 10 | Study_operator 백로그 (주간 플래너 2D 격자 + 길게 눌러 끌기, 논문 목차 점검, Z Flip5 기기 확인, 2단계 온보딩·AI 계획). 12/1 시작 | 클로디 리드 | 코드·점검 결과 | | (장현님과 우선순위 정하기) | 대기 (11/23 인수 후 진행 안 함) | |
| 11 | 업무 드라이브 공유 마무리 (01_Work, 04_Resources, 도구 DB 편집권, 스터디 대시보드 시트) + RULES.md에 드라이브 구조 | 오이지 공유 → 클로디 정리 | | | 11-24 21:30 | 완료 | RULES.md 2절 |
| 12 | 03_Life & Finance 공유 (장현님 OK: 개인별 메일이라 문제없음) | 오이지 공유 | | | 11-24 21:30 | 완료 | |
| 13 | `/doctor prompt-audit` 실행 | 클로디 | 리포트 | Claude Code | 다음 PC 켤 때 | 대기 | |
| 14 | 논문·보고서용 Claude 스킬 시험 (출처: 인스타 phd.saebyeok 11/22, 슬라이드 2~6에 실제 저장소. 오이지 확인, 클로디 GitHub API로 재확인 11-24). ① 문헌 `lingzhi227/agent-research-skills` ⭐477 라이선스 없음 ② 분석·그래프 `K-Dense-AI/scientific-agent-skills` ⭐58k MIT ③ 집필 `Imbad0202/academic-research-skills` ⭐58k 커스텀 라이선스 ④ 사전 리뷰 `claesbackman/AI-research-feedback` ⭐586 MIT (`/review-paper`) ⑤ 발표·문서 `anthropics/skills` (pptx·docx, 설치돼 있음). 대안: `Spark-To-Paper-Skills/paperjury` ⭐1.2k. 쓸 곳: 논문(2/20, 10번 목차 점검), KEIT 결과보고서(12/1)·제안서 PPT. 할 일: 도구 DB 등재 + 설치할 스킬 장현님 선택 | 클로디 | 검토 결과 | Claude Code 스킬 | 장현님이 다음에 지시 | 보류 (장현님 "다음에") | |
| 15 | 제미니 봇(@xky_gemini_bot) 세팅 + 집 PC Claude 연결 + v1.0.9 확인 (오늘 분배 3번)  — 세팅되면 이미지 생성도 Gemini로 나눠 쓸 수 있음 (장현님 11-24, 오이지 사용량 부담 줄이기) | 장현님 (클로디 지원, 이 PC에 gemini-bot 폴더 있음) | | | 장현님 편할 때 | 대기 | |
| 16 | agent-desktop 설치 (vercel-labs, Apache-2.0) | 클로디 | | | Study_operator·A.I.Mon 급한 일 뒤 | 보류 | |
| 17 | 인스타 릴스 정리 https://www.instagram.com/reel/DfmEKNXCLvo/ (장현님 11-24 22:00경) | 오이지 | 정리 메시지 | 평소 형식 | 11-25 (장현님: 내일 하게 둬) | 완료 | Patch (`patch.gg` / `pch` / MCP) 정리 보고 |
| 18 | muse는 pickle에게 이미지 생성 방법 배울 것 (장현님 11-24 22:07 추가) | 오이지 → 단무지 | 이미지 생성 워크플로우 공유 | 1줄(4프레임)씩 + PIL 규격 정리 | 11-25 | 완료 | `docs/IMAGE_WORKFLOW.md` · `scripts/aimon-sheets/` |
| 19 | 봇별 토큰 사용량을 앱 메뉴에 실제로 표시 (지금은 메뉴만 있고 값 없음). 이 PC Claude = 세션 기록 합산(usage.js), 오이지·단무지 = 원격이라 각 봇이 statusUrl로 usage 보내는 방법 찾기 (장현님 11-25 09:10) | 클로디 (오이지·단무지는 자기 쪽 사용량 보내기) | 앱 버전 | | 캐릭터 시트 끝난 뒤 | 대기 | |
