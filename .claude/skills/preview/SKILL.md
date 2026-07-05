---
name: preview
description: Use BEFORE pushing any change to the dashboard (index.html / GitHubPublisher.js) or Kakao message format (KakaoNotifier.js) - renders phone/tablet screenshots and a Kakao message format preview so PeterJ (mobile-only user) can approve before push
---

# /preview — push 전 모바일 미리보기

PeterJ는 모바일 전용 사용자다. UI·포맷 변경을 push 후에야 실물로 확인하게 하면
"실물 확인 → 재지시 → 재푸시" 왕복이 생긴다(실측: 2026-07-03 하루 UI 왕복 PR 8개).
push 전에 보여주고 승인받는 것이 이 스킬의 목적이다.

## 절차 (체크리스트)

1. playwright 확인: `node -e "require.resolve('playwright')"` —
   실패 시 `npm i --no-save playwright` (CI 의존성에 넣지 않는다).
   데스크탑처럼 브라우저가 없는 환경이면 `npx playwright install chromium`도 필요
   (리모트 환경은 /opt/pw-browsers 프리설치라 불필요 — 스크립트가 자동 사용).
2. `node scripts/preview.mjs` 실행 (아무 cwd에서나 가능) → **2배 해상도(레티나)**
   폰(390px)·태블릿(800px) 스크린샷을 세로로 **조각 분할** 저장:
   `output/preview-phone-1.png`, `-2.png` … / `output/preview-tablet-1.png` …
   (짧으면 인덱스 없이 `preview-phone.png`) + 카톡 메시지 **포맷** 미리보기 텍스트.
3. **생성된 조각을 순서대로 모두** PeterJ에게 이미지로 전송한다(파일 전송 도구 사용).
   긴 1장이 아니라 조각으로 보내는 이유: 폰에서 클릭하면 다운스케일돼 글자가
   깨져 승인이 어렵다(PeterJ 피드백, 2026-07-05). 각 조각은 확대해도 선명하다.
4. **승인을 받은 뒤에만 commit·push.** 수정 요청 시 반영 후 1~3 반복.

## 한계 (정직 고지)

- 카톡 미리보기는 상태파일(output/selected_papers.json) 기준이라 **제목이 80자
  절단·저널 미저장** — 실발송의 한글 제목·저널명·200자 초과 시 1/2건 분할 여부는
  다를 수 있다. 5줄 구조와 링크 위치(마지막 메시지) 확인용으로 쓴다.
- 이메일(NotificationAgent)은 REPORT_SPEC §4-D에 따라 **현재 사용 안 함**이므로
  이 스킬의 대상이 아니다(향후 사용 시 이메일 HTML 렌더를 추가할 것).

## 주의

- `index.html`(배포 산출물)과 `src/utils/GitHubPublisher.js`(생성기)는 이중
  관리다 — 둘 다 반영했는지 확인하고 `npm run spec-lint`도 함께 실행한다.
- `output/preview-*.png`는 커밋하지 않는다(.gitignore의 output/* 규칙이 처리).
