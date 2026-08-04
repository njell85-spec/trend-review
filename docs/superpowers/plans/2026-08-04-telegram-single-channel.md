# 알림 채널 정리 — 텔레그램 단일화 (카카오 폐지)

날짜: 2026-08-04 · 결정: PeterJ("ondemand 포함 전부 보고는 텔레그램으로 정리하자")

## 왜

- 카카오 `KAKAO_REFRESH_TOKEN`이 만료(KOE322)됐고, 재발급이 폰에서 번거롭다(POST 교환 필요).
- 텔레그램은 **살아 있음을 실측 확인**(telegram-smoke run 30955539644 success, 2026-08-04).
- 텔레그램은 2026-08-01부터 병행 발송 중이라 **이미 전 지점의 대체재가 준비돼 있다**.
- 남은 구멍: **on-demand·materialize·notebooklm 리마인더는 카카오 단독**이었다(오늘 IDSA 실행 때
  알림이 안 온 이유).

## 무엇

1. **포맷 정본을 채널에서 분리** — `KakaoNotifier`의 static 빌더(`buildReportMessages`,
   `buildFailureText`)를 `src/utils/reportMessage.js`로 이동. 텍스트는 **한 글자도 바꾸지 않는다**
   (REPORT_SPEC §2 정본 유지, 회귀 테스트로 고정).
2. **모든 발송 지점을 텔레그램으로** — 데일리 성공/실패, on-demand, materialize 실패,
   verify-pages 실패, notebooklm 리마인더.
3. **카카오 제거** — `src/agents/KakaoNotifier.js` 삭제, 워크플로우 4개에서 `KAKAO_*` env 제거,
   필요한 곳에 `TELEGRAM_*` 주입 추가.
4. **문서·게이트** — REPORT_SPEC §2 제목·§4-D 개정 + §5 이력, `spec-lint` 앵커를
   `reportMessage.js`로 이전(앵커가 죽으면 CI가 빨개져야 한다).

## 불변식

- **메시지 텍스트 무변경** — §2 5줄 구조·200자 분할 로직 그대로(텔레그램은 join해서 1건 발송).
- **소프트 실패 유지** — 알림 실패가 파이프라인을 세우지 않는다.
- 데일리 코어(선정·분석·발행) 무접촉.

## 잔여(PeterJ 몫, 선택)

- GitHub Secrets의 `KAKAO_REST_API_KEY` / `KAKAO_REFRESH_TOKEN` / `KAKAO_CLIENT_SECRET`은
  코드가 안 쓰므로 방치해도 무해하다. 지우고 싶으면 Settings → Secrets에서 삭제.
- 카카오를 되살릴 일이 생기면 이 커밋을 revert하면 된다(git 히스토리에 전부 남아 있다).
