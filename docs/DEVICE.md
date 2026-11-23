# 작은 기기 + "치킹!" 변신 (장현님 확정 방향, 2026-11-23)

## 컨셉

- **평소 (compact)**: 손바닥만 한 세로 기기. 작은 정사각형 액정에 펫 한 마리. 큼직한 버튼.
- **B 누르면 (expanded)**: "치킹!" 소리와 함께 양옆 그립이 밀려나며 가로로 펼쳐짐 → 양쪽 액정이 열리고 4마리 한 줄.
- **B 다시**: "철컥" 하고 접힘.
- 사용량·설정·채팅은 버튼으로 들어가는 메뉴 화면.

## 비율 (레퍼런스: 장현님이 보낸 핸드헬드 펫 기기 사진)

- 액정: 기기 앞면 폭의 약 40%, 정사각형, 두꺼운 베젤
- 버튼: 하나가 액정 폭의 1/3~1/2, 손가락으로 누를 만큼 큼직
- 몸체: 투톤 (흰색 + 포인트 색, 예: 오이지 풀색), 위쪽 작은 안테나, 옆면 그립 홈
- **주의**: 실제 제품(반다이 디지바이스 등) 실루엣·문양·로고를 그대로 따라 그리지 않는다. 특징만 가져온 Bot House 오리지널 모양. (repo 공개)

## 역할

- 오이지: 기기 외형·액정 화면·변신 모션 (renderer/)
- CL: 창 크기/접기·펼치기 애니메이션 (electron/), 효과음 합성 (renderer/sfx.js)

## API (renderer에서)

```js
// 1) 시작할 때 기기 크기(논리 px) 알려주기 — 이 크기로 창이 바뀜. 예시 크기, 오이지가 디자인에 맞게 결정
await botHouse.device.configure({ compact: { w: 380, h: 520 }, expanded: { w: 1000, h: 520 } });

// 2) 변신: 창이 가운데 기준으로 부드럽게 넓어짐 (duration ms, 기본 320)
Sfx.play('expand');
await botHouse.device.setMode('expanded', { duration: 320 });
//   CSS 변신 모션은 이 시간에 맞춰서

// 3) 접기
Sfx.play('collapse');
await botHouse.device.setMode('compact');

botHouse.device.info(); // { mode, sizes, scale }
```

- 창은 테두리 없는 투명 창. 기기 바깥은 투명하게 (`html.frameless`).
- 배율: 트레이 → 기기 크기 (작게 0.8 / 보통 1 / 크게 1.25 / 아주 크게 1.5). 창 크기와 화면 확대율에 같이 곱해지므로 renderer는 배율 신경 쓸 필요 없음.
- 기본 크기: 한 마리 580x450, 전체 보기 940x450 (오이지 디자인). 바꾸려면 `configure`. 간단 버전 `botHouse.setWindowMode("compact" | "wide")`도 있음.

## 효과음

`renderer/sfx.js` (index.html에 `<script src="sfx.js"></script>` 추가 필요). Web Audio로 직접 합성해서 저작권 문제 없음.
`Sfx.play('expand' | 'collapse' | 'click')`, `Sfx.setEnabled(settings.soundOn)`.
