# Trend Review — 데일리 리포트 규격 (Single Source of Truth)

> 매일 파이프라인 실행 및 카카오톡/이메일 리포트 작성 시 **반드시 이 규격을 따른다.**
> "또 반영이 안 됐다"는 문제를 막기 위한 단일 기준 문서.

## 1. 스크리닝·선정 방침 (확정안 = 1번 방안)

| 항목 | 값 | 코드 위치 |
|------|-----|-----------|
| 검색 윈도우 | **최근 6개월 (180일)** | `searchDays: 180` (orchestrator 호출부) |
| 스크리닝 규모 | **최대 300편** | `MAX_PAPERS=300` / `DataCollectorAgent.maxPapers` |
| 일일 선정 수 | **하루 1편** | `topN: 1` / `TOP_N=1` |
| 선정·분석 모델 | **Claude Opus (`claude-opus-4-8`)** | `FilterAnalyzerAgent.model` + `LLMClient --model` |
| 중복 방지 | 기존 선정 PMID 제외 | `output/selected_papers.json` |

- 검색 → 스크리닝(최대 300편 스코어링) → **임상 적용성 최고 1편 선정** → 전문 PICO 분석.
- 절대 "Top 3 / 최근 30일 / 40~50편" 같은 옛 표현을 쓰지 않는다.

## 2. 카카오톡 리포트 포맷 (PlayMCP MemoChat)

```
[trend-review]
{YYYY-MM-DD}
{논문 제목}
{저널} · #{PMID}
📊 https://njell85-spec.github.io/trend-review/
```

- **핵심만**: 헤더 / 날짜 / 제목 / 저널·PMID / 링크. 스크리닝 설명·점수·evidenceLevel·
  LLM 경로·메달(🥇) 등 부가 정보는 **넣지 않는다** (PeterJ 요청, 2026-07-03).
- **링크는 매 발송마다 반드시 포함**. 카톡이 자동 링크화하도록 `https://` 포함.
- 200자를 넘으면 **제목을 자르지 말고 2개 메시지로 분할**(① 헤더+날짜+제목 ② 저널·PMID+링크),
  링크는 항상 **마지막 메시지**에 둔다. 구현: `KakaoNotifier.buildReportMessages`.

## 3. 이메일 리포트 (`NotificationAgent`)

- 부제: "최근 6개월(180일) … · Claude Opus"
- 본문: "PubMed 최근 6개월 논문 **최대 300편**을 스크리닝하여 … **오늘의 1편**을 선정"
- PICO 카드: **1편만** 렌더 (`slice(0, 1)`).

## 4. 웹 대시보드 (`GitHubPublisher` → index.html)

- 헤더 부제: `… · PubMed 180-day window · 1 paper/day`
- Papers 통계: 실제 논문 카드 수 기준(하루 1편 → Days == Papers).
- 푸터: `… · PubMed 최근 6개월 · 1편/일`
- 전 섹션 동일 타이포그래피(폰트 크기 스케일 `text-[12~18px]`) 유지 — 단일 빌더(`_buildTodaySection`)만 사용.
- **배포 검증 게이트**: push 성공 ≠ 사이트 반영. 파이프라인 잡 종료 후 별도
  `verify-pages` 잡이 `scripts/verify-pages-deploy.mjs` 로 **원격 main HEAD**
  (API 폴백 배포까지 포함) 의 Pages 배포 완료를 확인하고, 실패 시 자동 재실행
  (새 attempt 기준 최대 3회), 끝내 실패하면 카카오 실패 알림 + 워크플로우 실패.
  잡을 분리한 이유: 재실행용 `actions: write` 토큰을 LLM 파이프라인 잡에 주지
  않기 위한 권한 분리. 한계(의도된 트레이드오프): 카카오 리포트는 배포 검증
  전에 발송되므로, 배포 실패 시 링크가 자동 복구(수 분)까지 잠시 전날 데이터를
  보일 수 있다 — 복구 불가면 실패 알림이 뒤따른다.
  (근거: 2026-07-05 GitHub 측 일시 오류로 배포만 실패 → 카톡 링크가 전날 데이터 노출.)

## 4-B. 1편 심층 분석 — 본문 확보 & 권위 보강 정책

선정된 **1편만** 다음 순서로 근거를 모아 PICO 분석한다 (셀렉/스크리닝은 초록 기준 유지).

1. **본문(PMC)** — PubMed Central 오픈액세스(PMCID) → 전문.
2. **본문(OA)** — Unpaywall(DOI) 합법 오픈액세스 → 전문.
3. **초록 + 레지스트리** — 본문이 페이월이면 **ClinicalTrials.gov(NCT)** 구조화 레지스트리(API 키 불필요)로 설계·적격기준·정확한 결과지표·게시된 수치를 보강. (메타분석 등 임상시험이 아니면 NCT가 없어 이 단계는 건너뜀)
4. **초록 + 웹보강** — 본문·레지스트리가 모두 없으면 PICO 분석 단계에서 **WebSearch/WebFetch로 권위 소스(저널 공식 페이지·PubMed·PMC·발행처)만** 확인해 초록에 빠진 수치를 보강. 사용한 페이지는 카드 출처에 명시.
5. 위 모두 실패 시 **초록만**.

원칙(환각 배제):
- 수치는 **초록·확보 본문·권위 레지스트리·확인된 권위 웹페이지에 명시된 값만** 사용. 추론/계산/타 연구 인용 금지. 우선순위 본문 > 레지스트리 > 웹 > 초록.
- 각 카드에 **근거 배지**(`본문(PMC)`/`본문(OA)`/`초록 + 레지스트리`/`초록 + 웹보강`/`초록만`)와 **참조 링크(PubMed·DOI·레지스트리·웹)** 표기.
- 웹 보강은 **권위 도메인 한정 + 출처 명시**일 때만. 못 찾으면 억지로 채우지 말고 초록만 사용.

구현: `FullTextAgent._augment()`(레지스트리), `FilterAnalyzerAgent`(프롬프트 규칙 + `_provenance()` 배지/출처), `GitHubPublisher`(배지·출처 박스 렌더).

## 4-D. 카카오 나챗방 발송 (무인)

데일리 리포트는 **카카오 일반 REST API "나에게 보내기"** 로 발송 (MCP/세션 불필요 → Actions에서 무인).
- 모듈: `src/agents/KakaoNotifier.js` (`github-actions-daily.mjs`가 배포 후 호출, 실패해도 파이프라인 성공).
- 엔드포인트: `/v2/api/talk/memo/default/send` (text 템플릿 + 링크 버튼).
- Secrets: `KAKAO_REST_API_KEY`, `KAKAO_REFRESH_TOKEN`(필수), `KAKAO_CLIENT_SECRET`(앱 설정 시).
- refresh 토큰은 매 실행 시 access 토큰으로 갱신. 카카오가 refresh를 회전시키면 로그 경고 → secret 갱신.
- 미설정 시 발송만 건너뜀(파이프라인 정상).
- **이메일(Gmail)은 사용하지 않음(PeterJ 확정, 2026-07-05)** — 알림은 카카오 단일 채널.
- **Google Drive 업로드**는 현재 미사용이나 **phase2/3 연동 대비 인프라를 보존**한다
  (`NotificationAgent`, `ENABLE_DRIVE=true` 게이트, 기본 비활성). Gmail 관련 코드는 제거됨.

## 4-E. Phase 2 — Drive 아카이브 + NotebookLM (무인)

설계 스펙: `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md`
- **하이브리드 구조**: ① 자동층 = **월별 리빙 Google Doc**(`Trend Review — YYYY-MM`)을 매일 재생성
  (HTML→Doc 변환, NotebookLM Drive 자동 동기화가 반영) ② 보강층 = **원문 PDF**(OA 확보 시)를
  `trend-review/YYYY-MM/`에 적재, NotebookLM 소스 추가는 주 1회 수동(기본 주기).
- 자료는 **자체 문서만** — 타인 PPT/PDF 파일 수집 금지. 페이월이면 웹보강(4-B) 근거를
  **근거 도시에** 섹션으로 Doc에 구조화.
- 모듈: `src/agents/ArchiveAgent.js` + `src/utils/googleAuth.js`(env 우선)·`docBuilder.js`.
  `github-actions-daily.mjs`가 카카오 발송 뒤 호출 — **실패해도 파이프라인 성공(소프트 실패)**.
- 상태 파일: `output/analysis_archive.json`(항목 + Drive docId/folderId/pdfFileId) —
  워크플로우 "Commit daily state" 스텝이 커밋. gitignore 예외 필수(spec-lint 강제).
- Secrets: `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`GOOGLE_REFRESH_TOKEN`
  (스코프 `drive.file`+`youtube.upload` 고정). Variables: `GOOGLE_DRIVE_FOLDER_ID`.
  발급: 데스크탑 데이 `scripts/google-auth-setup.mjs` (`docs/desktop-day-guide.md`).
  `credentials.json`·`google_token.json`은 gitignore 필수(spec-lint 강제). 미설정 시 단계만 건너뜀.

## 4-C. 자동화(GitHub Actions) 인증

분석 LLM 호출은 **claude CLI(구독)** 우선, 없으면 **Anthropic API** 폴백.
- 워크플로우가 `npm i -g @anthropic-ai/claude-code`로 CLI 설치.
- 저장소 Secrets 중 **하나** 필요: `CLAUDE_CODE_OAUTH_TOKEN`(구독, 무비용 — 로컬에서 `claude setup-token`으로 발급) **또는** `ANTHROPIC_API_KEY`(API 과금).

## 5. 변경 이력

- 2026-07-05 (Phase 2 선작업): 4-E 신설 — Drive 아카이브(월별 리빙 Doc + OA PDF)·NotebookLM
  하이브리드 연동, ArchiveAgent·googleAuth·docBuilder 추가, 상태파일 `analysis_archive.json`
  gitignore 예외 + 시크릿 파일 무시 규칙을 spec-lint로 강제. Secrets 미설정 시 소프트 스킵.

- 2026-07-05: 코드 리뷰 후속 보완. 가이드 카드 NEW 뱃지 강등 버그 수정(과거 카드 잔존),
  이메일(Gmail) 발송 코드 제거(카카오 단일 채널 확정) + Drive 업로드는 phase2/3 대비
  보존(`ENABLE_DRIVE` 게이트), 표 PMID 중복제거가 가이드 행도 포함, esc() 작은따옴표
  방어, 주석/데드코드/매직넘버 정리, 개발용 `compare-providers.mjs` 를 `archive/` 로 이동.

- 2026-07-05: Pages 배포 검증 게이트 추가(`scripts/verify-pages-deploy.mjs` +
  daily-review.yml `verify-pages` 잡). GitHub 측 일시 오류로 Pages 배포만 실패해
  대시보드가 전날 데이터에 머문 장애의 재발 방지 — 배포 실패 자동 재실행 +
  실패 가시화. 운영 경로에 `scripts/verify-pages-deploy.mjs` 포함.

- 2026-07-02: 전면 코드 리뷰 반영.
  보안(토큰 로그 노출 차단·대시보드 XSS·이메일 이스케이프), 날짜 KST 통일(`src/utils/dates.js`),
  제외목록을 publish 전에 저장(중복 선정 방지), 체크포인트 병합·resume 수리,
  FullText 재시도/실패 미캐시/근거배지 수정, PICO 캐시 키에 본문 상태 포함,
  검증 정규식·MeSH 교정, LLM API 타임아웃·CLI 비동기화, Kakao 토큰 회전 알림 +
  `-402(talk_message 미동의)` 안내, Actions job summary 로 소프트 실패 가시화.
  일회성 스크립트·디자인 시안은 `archive/` 로 이동 (운영 경로는
  daily-review.yml → github-actions-daily.mjs → src/ 만).

- 2026-06-29: 1번 방안(6개월/300편/1편·Opus) 전 채널 일괄 반영.
  Opus 모델이 실제 CLI 호출까지 전달되도록 `LLMClient`에 `--model` 추가.
- 2026-06-29: Sky 파스텔 디자인으로 전면 교체, 과거 아카이브 리셋(오늘부터 시작).
  1편 분석에 ClinicalTrials.gov 레지스트리 보강 + 근거배지/출처 표기 정식 반영.
  Actions 자동화 복구(claude CLI 설치 + OAuth 토큰/API 키 폴백).
