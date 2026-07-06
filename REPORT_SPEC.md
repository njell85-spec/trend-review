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

## 1-B. On-demand 수동 디깅 (직접 지정 분석)

자동 데일리 선정과 **별개의 예외 경로**. PeterJ가 지정한 논문(PMID/DOI)·가이드라인을
같은 분석 → 대시보드 → 카톡 → 아카이브 경로에 태운다.
- 입구: 대시보드 "직접 지정" 위젯(`GitHubPublisher._onDemandWidget`, 멱등 주입) →
  브라우저에서 `on-demand.yml`을 workflow_dispatch로 직접 호출. **Fine-grained PAT**
  (이 저장소 actions:write 한정)는 사용자 브라우저 localStorage에만 저장 — 페이지 소스·저장소에 없음.
  백업 입구: Actions 수동 실행.
- 실행: `scripts/on-demand.mjs`(DOI→PMID 해석 후 기존 부품 재사용). **"하루 1편" 카운트 밖의 예외**이며,
  같은 날 데일리 섹션·표를 건드리지 않는다(자체 섹션 키 `YYYY-MM-DD-m-<pmid>`).
- 카드에 **"직접 지정" 배지**(주황) 표기 · 지정 PMID는 제외목록 등록으로 이후 자동 선정과 중복 방지.
- 소프트 성격: 분석 실패 시 대시보드 미변경. Secrets 미설정 시 아카이브만 스킵.

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
- **3층 자동 수집 구조(2026-07-06 개정 — PeterJ 확정)**: ① **분석 Doc** = 월별 리빙 Google Doc
  (`Trend Review — YYYY-MM`) 매일 재생성(HTML→Doc, NotebookLM Drive 자동 동기화 반영)
  ② **전문 Doc** = `Trend Review 전문 — YYYY-MM`(plain text)에 pmid당 1회 append —
  OA는 확보 본문 텍스트, **페이월이면 권위 웹 레퍼런스(dossier) 본문을 수집**해 수록
  ③ **원문 PDF**(OA 확보 시) `trend-review/YYYY-MM/` 적재(보관용 — Doc이 소스 역할).
- **수집 원칙**: 비공개 아카이브층은 수집 확대(사적 이용 복제 범위, 입수는 합법 경로만).
  단 **수집 본문은 Drive 비공개 Doc으로만** — 공개 repo에 커밋 금지. 공개 발신물(§4-F)은
  재구성 원칙 유지. 근거 도시에(출처 목록)는 분석 Doc에 병존.
- **NotebookLM 소스 등록 자동화**: `notebooklm-sync.yml`(매월 1일 09:00 KST)이
  notebooklm-py(비공식)로 새 달 Doc 2개를 노트북에 자동 등록. 실패·미설정 시 **카톡
  리마인더 폴백**(Doc 링크 포함). Variables `NOTEBOOKLM_NOTEBOOK_ID` + Secret
  `NOTEBOOKLM_AUTH_STATE` 필요 — 미설정 시 리마인더만(소프트).
- 모듈: `src/agents/ArchiveAgent.js` + `src/utils/googleAuth.js`(env 우선)·`docBuilder.js`·
  `fulltextDoc.js`·`webRefText.js`, `scripts/notebooklm-{register.py,remind.mjs}`.
  `github-actions-daily.mjs`가 카카오 발송 뒤 호출 — **실패해도 파이프라인 성공(소프트 실패)**.
- 상태 파일: `output/analysis_archive.json`(항목 + Drive docId/folderId/pdfFileId) —
  워크플로우 "Commit daily state" 스텝이 커밋. gitignore 예외 필수(spec-lint 강제).
- Secrets: `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`GOOGLE_REFRESH_TOKEN`
  (스코프 `drive.file`+`youtube.upload` 고정). 적재 루트 폴더 `trend-review`는 **앱이
  자동 생성**(find-or-create) — `drive.file` 스코프는 수동 생성 폴더 접근이 불가하므로
  Variables `GOOGLE_DRIVE_FOLDER_ID`는 선택(접근 불가 ID면 자동 폴백)이며 기본 미설정.
  발급: 데스크탑 데이 `scripts/google-auth-setup.mjs` (`docs/desktop-day-guide.md`).
  `credentials.json`·`google_token.json`은 gitignore 필수(spec-lint 강제). 미설정 시 단계만 건너뜀.

## 4-F. Phase 3 — YouTube 영상 (무인 · 승인 게이트 후 활성)

설계 스펙: `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md`
- **기본 일 2편(영어 우선 전략, PeterJ 확정 2026-07-06)**: 중간폼(3~5분, 1920×1080) +
  숏폼(**≤60초**, 1080×1920), 영어 내레이션 + 영어 자막 — **자막은 번인**
  (captions API는 `youtube.force-ssl` 스코프가 추가로 필요해 미사용, SRT는 보존).
  한국어판 추가는 `VIDEO_LANGS=en,ko` 설정만으로 확장(대본은 항상 양 언어 생성됨).
- **스크립트 수치는 리포트 값만** — 프롬프트에 "절대 새로운 수치를 만들지 마라" 규칙 고정
  (`src/utils/videoScript.js`, spec-lint가 문구 존재를 강제). 차트는 검증 수치 재구성만
  (`ChartRenderer`), 수치 불충분 시 차트 생략. **논문 원문 그림·표 이미지 미사용.**
- **업로드는 `privacyStatus: 'private'` 고정**(공개 전환은 API 심사 후 별도 결정, spec-lint 강제).
  제목·설명에 PubMed·DOI·대시보드 링크. 채널 = 전용 브랜드 채널.
- **레퍼런스 전 채널 병기(PeterJ 확정 2026-07-06)**: 웹 리서치는 저명·공식 사이트 우선(4-B)이고,
  분석에 쓴 참조는 **링크째** 대시보드·분석 Doc·전문 Doc뿐 아니라 **영상 설명·마지막 슬라이드·
  카드뉴스 마지막 장에도 표기**해 어느 산출물에서든 원 출처로 들어가 확인할 수 있게 한다.
  (영상·카드 반영은 R5 품질 개선에서 구현 — 현재는 PubMed 링크만 표기됨.)
- 모듈: `src/agents/VideoAgent.js` + `videoScript`·`videoRender`·`tts`·`ChartRenderer`.
  편별 독립 소프트 실패. 상태 `output/video_log.json`(중복 업로드 방지, gitignore 예외 필수).
- **활성 스위치**: Variables `ENABLE_VIDEO=true` — 샘플 승인(모바일 시청, /preview 원칙) 전에는
  기본 비활성. 샘플 생성: `scripts/video-sample.mjs` (업로드 없음).
- Secrets: `GOOGLE_TTS_API_KEY` (+ 4-E의 GOOGLE_* 공용). 쿼터: 업로드 2건 = 3,200/10,000 (언어 확장 시 4건 = 6,400).

## 4-G. 대시보드 큐레이션 — 삭제·자료화 버튼 + 자료화 상태 (R4)

운영 모드(PeterJ 확정 2026-07-06): 데일리(+필요 시 on-demand)로 페이지를 구성하고,
PeterJ가 페이지에서 **선별 큐레이션**한다. 전역 자동 영상화(`ENABLE_VIDEO`)는 계속
기본 비활성 — **자료화 버튼이 승격 경로**다.

- **표시 위치(양쪽 동일 상태)**: 각 카드 하단(상태 칩 + 🗑 삭제 + 🎬 자료화 버튼)과
  누적 아카이브 표(자료화 컬럼 + 관리 컬럼). 렌더는 `CURATION_BLOCK`(버전 마커,
  `src/utils/curation.js`) 클라이언트 스크립트 1개가 담당하며 **단일 상태 파일**
  `output/curation_state.json`(gitignore 예외, spec-lint 강제)을 그린다 —
  두 위치 불일치는 구조적으로 불가능.
- **삭제** = 대시보드 표시 제거만(`curate-remove.yml` → 섹션·표 행 제거 + 통계 재계산 +
  숨김 목록 기록). Drive Doc·아카이브·재선정 방지 목록은 유지. 발행 경로는 숨김 목록의
  섹션 재출현을 방어한다(`GitHubPublisher._applyCuration`).
- **자료화** = 카드뉴스·영상 생성 + YouTube **비공개** 업로드까지 한 번에
  (`materialize.yml` → `scripts/materialize.mjs` → VideoAgent, privacyStatus private
  고정이 안전망). 재실행 안전: `video_log.json`이 업로드된 편을 건너뛰므로 부분 실패 후
  재클릭하면 나머지만 만든다. 실패 시 빨간 run + 카톡 알림.
- **인증·경합**: 버튼은 기존 Fine-grained PAT(localStorage, on-demand 위젯과 공용)로
  workflow_dispatch. 실행 전 확인 대화 1회. 데일리 커밋과의 경합은 push 실패 시 최신
  main 위에 멱등 재적용(재시도 3회)으로 처리 — daily-review.yml은 건드리지 않는다
  (데일리 코어 무영향 불변식). 클릭 직후 반영 지연(2~5분)은 클릭한 브라우저의
  "⏳ 요청됨" 로컬 표시로 완화.

## 4-C. 자동화(GitHub Actions) 인증

분석 LLM 호출은 **claude CLI(구독)** 우선, 없으면 **Anthropic API** 폴백.
- 워크플로우가 `npm i -g @anthropic-ai/claude-code`로 CLI 설치.
- 저장소 Secrets 중 **하나** 필요: `CLAUDE_CODE_OAUTH_TOKEN`(구독, 무비용 — 로컬에서 `claude setup-token`으로 발급) **또는** `ANTHROPIC_API_KEY`(API 과금).

## 5. 변경 이력

- 2026-07-06 (R4 큐레이션): §4-G 신설 — 삭제·자료화 버튼 + 자료화 상태 표시를
  카드·누적 표 양쪽에(단일 상태 파일 `curation_state.json`, 클라이언트 블록 렌더).
  삭제=표시 제거만, 자료화=선별 승격(비공개 업로드), spec-lint 앵커(5e) 추가.

- 2026-07-06 (R3 아카이브 자동화): 4-E 개정 — 전문 Doc(b′: OA 본문 텍스트 append) +
  페이월 권위 웹 레퍼런스 본문 수집(c) + notebooklm-sync.yml(월 1일 소스 자동 등록,
  실패 시 카톡 리마인더 폴백). 비공개층 수집 확대 확정(공개 발신물 재구성 원칙 유지),
  수집 본문은 Drive 비공개 Doc 한정(공개 repo 커밋 금지).

- 2026-07-06 (전체 재검토 실버그 보완): ① Drive 적재 루트 폴더 자동 생성 폴백
  (`drive.file` 스코프는 수동 생성 폴더 접근 불가 — 데스크탑 데이 가이드 6-b 함정 제거),
  ② 아카이브 항목을 Drive 작업 전에 선저장(폴더/PDF 실패 시 날짜 영구 결번 방지),
  ③ On-demand 위젯 버전 마커 + 구버전 블록 교체(증분 패치 페이지에 위젯 수정 반영),
  ④ on-demand.yml 입력을 env 경유로(셸 인젝션 심층 방어), ⑤ 영상 재실행 시 업로드
  로그 선확인(LLM·TTS 재지출 방지) + 영어 단일 기본에서 거짓 "일부 실패" 경고 수정,
  ⑥ TTS API 키를 URL 쿼리 → 헤더로.

- 2026-07-05 (Phase 2 선작업): 4-E 신설 — Drive 아카이브(월별 리빙 Doc + OA PDF)·NotebookLM
  하이브리드 연동, ArchiveAgent·googleAuth·docBuilder 추가, 상태파일 `analysis_archive.json`
  gitignore 예외 + 시크릿 파일 무시 규칙을 spec-lint로 강제. Secrets 미설정 시 소프트 스킵.
- 2026-07-06: 발신 전략 확정 — 영어 단일 버전 우선(일 2편, `VIDEO_LANGS`로 확장 가능),
  유튜브 비공개 인큐베이터 → 품질 도달 시 인스타 개시(프로 계정은 비공개 불가 확인).
  Phase 구조 재명명: Curate & Brief / Archive / Produce / Publish.
- 2026-07-05 (Phase 3 선작업): 4-F 신설 — 영상 4편(중간폼·숏폼 × ko·en) 파이프라인
  (VideoAgent·videoScript·videoRender·tts·ChartRenderer). 수치 생성 금지·비공개 고정을
  spec-lint로 강제, ENABLE_VIDEO 스위치(샘플 승인 전 비활성), 자막 번인 + SRT 보존.

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
