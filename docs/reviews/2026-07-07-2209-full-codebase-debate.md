# 코드리뷰 변증 토론 — 전체 프로덕션 코드

- 일시(KST): 2026-07-07 22:09
- 대상: `src/` 전체 · `scripts/*.mjs` · `github-actions-daily.mjs` (제외: archive/·test/·docs/·index.html)
- 모델: codex=gpt-5.5 · reviewer/judge=Claude Opus (명명 서브에이전트 정식)
- 라운드: 2 (R0 독립 → R1 상호 반박, **수렴=yes** / 캡=4)
- 규모: 41파일 · 7,370 LOC

## 최종 판정 (심각도별)

### 🔴 Major (2)
- **F1 · `src/utils/GitHubPublisher.js:795` — push 실패 폴백이 상태 JSON 누락 (confirmed)**
  git push 실패 시 REST 폴백은 `index.html`만 PUT. `output/selected_papers.json`·`selected_guidelines.json`은
  워크플로 별도 커밋 스텝(`daily-review.yml`)으로만 반영되는데, GitHubPublisher push가 실패하는 상황(auth/네트워크)이면
  같은 원인으로 상태 커밋 push도 실패할 개연성이 높다. → index.html은 원격 반영되나 **상태 JSON은 로컬에만 남아,
  다음날 fresh checkout이 제외목록·가이드라인 게이트를 잃고 동일 논문 재선정**. 중복방지(코어)가 조건부로 깨짐.

- **F5 · `src/agents/FilterAnalyzerAgent.js:277` — PICO 실패를 삼켜 빈 카드 발행 (confirmed)**
  `analyzePico`가 `Promise.allSettled`로 감싸 rejected를 `_fallbackPico`로 대체하고 **throw하지 않음**.
  → PICO 전건 실패(Claude 세션 한도 429·안전필터 거부)에도 `run()`이 성공 resolve. 결과: ① 세션 리셋 노림
  **재시도 전략 미발동** ② 빈 fallback 카드(`title_ko=''`)가 그날 선정본으로 **GitHub Pages 발행**
  ③ `_saveExcludePmids`가 이 fallback PMID를 **제외목록에 영구 등록**(좋은 논문이 분석 못 된 채 소진)
  ④ 카카오도 '분석 실패' 카드를 **성공 리포트처럼 발송**. 조용한 품질 붕괴.

### 🟡 Minor (6)
- **F2 · `DataCollectorAgent.js:57,63` — api_key 로그 노출 (confirmed, major→minor 하향)**
  URL에 `api_key` 포함된 채 error/retry 로그에 실림은 사실. 단 ① Actions가 `secrets.*` 자동 마스킹
  ② Logger 파일출력은 `output/logs/`(.gitignore로 커밋 제외) ③ 로그 아티팩트 업로드 없음 ④ 키 optional·저가치
  → 실효 노출 낮음. 방어적 마스킹은 권장.
- **F4 · `docBuilder.js:23` — 월간 Doc P 항목 항상 공란 (confirmed)**
  스키마 키는 `population`인데 `pico.patient`를 읽음 → 항상 undefined → 리빙 아카이브 Doc의 'P:' 공란.
  (대시보드·ReportGenerator는 `.population`을 올바로 사용 — docBuilder에 국한)
- **F6 · `retryPipeline.js:60` — delayMs=0이면 재시도 완전 비활성 (confirmed)**
  재시도 조건이 `delayMs>0`이라 `SESSION_RETRY_DELAY_MIN=0` 설정 시 재시도가 조용히 꺼짐(설계와 반대). 기본 60분이라 기본 경로 무사.
- **F7 · `TrendReviewOrchestrator.js:124` — 제외 PMID dedup·상한 없음 (confirmed)**
  `[...existing, ...added]` 단순 병합 → 재실행 시 PMID 무한 누적, 파일 팽창.
- **F8 · `KakaoNotifier.js:168` — 메시지마다 토큰 재교환 + 회전 미반영 (confirmed)**
  2분할 메시지 시 `_accessToken` 2회 교환, 회전된 refresh_token 미저장 → 2번째 발송 실패 가능 + 중복 인증.
- **F9 · `GitHubPublisher.js:787` — 폴백 PUT의 stale 덮어쓰기 (confirmed)**
  push 실패 폴백이 stale 로컬 `updated`를 최신 원격 SHA에 PUT → 원격 선행 변경 조용히 소실 가능(F1과 같은 블록, 다른 결함).

## 기각된 주장
- **F3 · `DataCollectorAgent.js:56` — fetch 타임아웃 없어 무한 hang (rejected)**
  codex의 "무응답 시 러너 제한까지 hang" 주장은 **거짓**. Node undici 전역 fetch는 기본 `connectTimeout(~10s)`·
  `headersTimeout/bodyTimeout(~300s)` 보유 → 예외를 던져 `RetryHelper`(전부 재시도)·`CircuitBreaker`(threshold 8, OPEN 차단)가
  정상 작동. 잡도 `timeout-minutes:240` 상한. 무한 hang이 아니라 최악 요청당 ~5분 유한 지연. 명시적 짧은 timeout 부재는 trivial~minor.

## 수정방안 (우선순위) — ⚠️ 승인 게이트: 미적용
1. **PICO 실패 전파(F5)** — `FilterAnalyzerAgent.js:277` allSettled rejected 비율이 임계 초과면 throw(또는 run()이 fallback 카드 감지 시 실패 처리), fallback 카드는 제외목록 등록·발송에서 제외.
2. **폴백이 상태 JSON까지 반영(F1)** — `GitHubPublisher.js:787~801` catch에 `selected_papers.json`·`selected_guidelines.json` contents PUT 추가, 또는 워크플로 상태 커밋 스텝에도 REST 폴백.
3. **폴백 stale 덮어쓰기 방지(F9)** — PUT 전 원격 최신 index.html 재조회·재적용(merge) 또는 SHA 불일치 시 원격 기준 재빌드.
4. **api_key 로그 마스킹(F2)** — `DataCollectorAgent.js:57,63` url의 api_key 정규식 REDACTED 치환 후 로깅.
5. **카카오 토큰 캐싱·회전 반영(F8)** — `KakaoNotifier.js:168` 만료까지 access token 캐시, 새 refresh_token 저장.
6. **제외 PMID dedup·상한(F7)** — `orchestrator.js:124` Set dedup + 최근 N개 상한.
7. **월간 Doc P 키 수정(F4)** — `docBuilder.js:23` `pico.patient` → `pico.population`.
8. **재시도 delay 게이트 완화(F6)** — `retryPipeline.js:60` `delayMs>0` → `delayMs>=0`.

## 라운드 로그(요약)
- **R0** codex 4건(A1 폴백상태JSON, A2 api_key, A3 fetch타임아웃, A4 docBuilder) / Opus 5건(B1 PICO삼킴, B2 retry0, B3 dedup, B4 kakao, B5 폴백덮어쓰기) — 서로 다른 지점 포착.
- **R1** 상호 반박·수용:
  - codex가 Opus B1~B5 **전부 confirmed**.
  - Opus가 codex A1 수용, **A2 major→minor 하향**(Actions 마스킹·gitignore 근거), **A3 반박**(undici 기본 타임아웃), A4 수용.
- **심판** A2·A3 이견을 코드로 직접 확인해 settle → A2 minor 확정, A3 rejected. `new_rebuttals=0` → **수렴 종료**. 확정 8건(major 2·minor 6), 기각 1건.

> codex-debate 스킬을 **전체 프로덕션 코드**에 적용한 산출물. 실제 코드는 승인 게이트에서 정지 — 변경하지 않았습니다.
> PeterJ 보고서 검토 후 수정 착수 여부 결정 예정.
