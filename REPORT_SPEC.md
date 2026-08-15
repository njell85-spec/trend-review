# Trend Review — 데일리 리포트 규격 (Single Source of Truth)

> 매일 파이프라인 실행 및 텔레그램 리포트 작성 시 **반드시 이 규격을 따른다.**
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
같은 분석 → 대시보드 → 텔레그램 → 아카이브 경로에 태운다.
- 입구: 대시보드 "직접 지정" 위젯(`GitHubPublisher._onDemandWidget`, 멱등 주입) →
  브라우저에서 `on-demand.yml`을 workflow_dispatch로 직접 호출. **Fine-grained PAT**
  (이 저장소 actions:write 한정)는 사용자 브라우저 localStorage에만 저장 — 페이지 소스·저장소에 없음.
  백업 입구: Actions 수동 실행.
- 실행: `scripts/on-demand.mjs`(DOI→PMID 해석 후 기존 부품 재사용). **"하루 1편" 카운트 밖의 예외**이며,
  같은 날 데일리 섹션·표를 건드리지 않는다(자체 섹션 키 `YYYY-MM-DD-m-<pmid>`).
- **URL 지정(가이드라인·참고자료)**: 학회 홈페이지 공개본처럼 **PubMed 미등재** 문서는
  `target`에 `https://…` 원문 URL을 넣는다(`kind=guideline` 또는 `kind=reference`.
  선택 입력 `title`·`org`·`pubdate`). **논문(PICO)은 URL로 못 넣는다** — PICO 분석은 PubMed
  메타데이터(저널·저자·MeSH)가 전제라 `scripts/on-demand.mjs`가 거부한다.
  본문은 러너가 확보하되 차단·PDF면 소프트 스킵하고 **LLM 웹검색 보강**이 원문을 읽는다
  (`src/utils/externalGuideline.js`). PMID 대신 `sourceId`(`web:<host><path>`)가 섹션 키·표 행 키·
  중복 제거 키가 되고, 카드·표 링크는 PubMed 대신 **원문(발행기관)** 으로 건다.
- **`kind=reference` — 범용 참고자료 (2026-08-06 신설)**: 공식 가이드라인도 논문도 아닌, PeterJ가
  직접 열어보고 쓸 만하다고 판단한 자료(기관 프로토콜·출판사 요약·해설 페이지 등)를 태운다.
  URL·PMID·DOI 전부 받는다. 카드는 가이드라인과 골격이 같고 축 하나만 다르다 —
  "이전 판 대비 변경점" 자리에 **"출처 성격"**(동료심사 여부·1차/2차·근거 인용·기준 시점·이해관계)이
  들어간다. **공인되지 않은 출처일 수 있다는 것이 이 모드의 전제**이므로, 확인되지 않는 것은
  "확인되지 않음"으로 적게 하고 **추정으로 권위를 부여하지 않는다**. 배지 `🔖 참고자료`(가이드라인은
  `📋 가이드라인`). 상태는 `output/selected_references.json`(자동 선정 대상이 아니라 가이드라인
  트랙의 주간 게이트와 분리). 구현: `GuidelineAnalyzerAgent.analyze(doc, { mode })`.
- 카드에 **"직접 지정" 배지**(주황) 표기 · 지정 PMID는 제외목록 등록으로 이후 자동 선정과 중복 방지.
- 소프트 성격: 분석 실패 시 대시보드 미변경. Secrets 미설정 시 아카이브만 스킵.

## 1-C. 가이드라인 자동 선정 — 현행 계약 (개편 G0 기준선)

개편 설계서: `docs/superpowers/plans/2026-08-14-guideline-selection-redesign-plan.md` (G0~G10).
아래는 **개편 전 현행 동작**이며, 회귀 테스트 `test/guidelineContract.test.mjs` 가 이것을 고정한다.
G1~G10 이 이 계약을 바꿀 때는 **그 커밋이 테스트도 같이 고쳐** 변경이 의도된 것임을 남긴다.

- **주기 게이트 7일** — `guidelineIntervalDays` 기본 7. 노출 기록이 없으면 첫날부터 시도하고,
  마지막 노출로부터 7일 이상 지나야 다시 시도한다. 판정 기준은 배열의 마지막 항목이 아니라
  **가장 최근 날짜**다. 주기가 아닌 날에는 **PubMed·LLM 을 아예 부르지 않는다.**
- **상태 파일은 배열** — `output/selected_guidelines.json` 은 `{pmid,title,org?,date}` 배열이며
  누적 append 만 한다. `org` 는 선택 필드이고, 수동 웹 항목은 `pmid` 가 빈 문자열이며
  `sourceUrl`·`sourceId` 를 가진다. **이 배열이 v2 승격(G3)의 무손실 입력이다.**
- **수동 URL = PeterJ 최종 승인 (확정 ⑤-A)** — `scripts/on-demand.mjs` 의 입력 검사는
  URL 형식과 `kind=guideline|reference` 뿐이다. **자동 학회 수집(G5)의 도메인·기관 검증을
  이 경로에 재사용하지 않는다.** PeterJ 가 넘긴 URL 은 그 자체로 공식성 판정이 끝난 것이다.
- **non-fatal 경계** — 수집·선정·분석·본문확보 중 무엇이 실패해도 `_stageGuideline()` 은
  throw 하지 않고 `null` 을 돌려준다. 가이드라인 장애가 그날 논문 데일리를 죽이면 안 된다(§4 불변식).
- **논문 경로 불변** — 가이드라인 수집은 `DataCollectorAgent.collectGuidelines()` 로 분리돼 있고
  `run()` 은 이를 부르지 않는다. 선정기는 후보 객체를 변형하지 않는다.

**PeterJ 확정 5건 (2026-08-14)** — 개편이 향할 곳:
①-B+①-C 자동 인정 범위를 PT 밖(consensus·statement·focused update·recommendations)까지 넓히고
승인 학회 사이트도 별도 수집 · ②-C 주제 무매칭 tier-1 은 버리지 않고 `needsReview` 보존 ·
③-C 신판은 새 카드, 구판은 삭제 없이 `superseded` 배지 · ④-D 매일 시도하되 큐가 비면 건너뜀 ·
⑤-A 수동 URL 은 승인 그 자체(도메인 검증 금지).


## 2. 리포트 메시지 포맷 (텔레그램 · 정본 `src/utils/reportMessage.js`)

```
[trend-review]
{YYYY-MM-DD}
{논문 제목}
{저널} · #{PMID}
📊 https://njell85-spec.github.io/trend-review/
```

- **핵심만**: 헤더 / 날짜 / 제목 / 저널·PMID / 링크. 스크리닝 설명·점수·evidenceLevel·
  LLM 경로·메달(🥇) 등 부가 정보는 **넣지 않는다** (PeterJ 요청, 2026-07-03).
- **링크는 매 발송마다 반드시 포함**. 메신저가 자동 링크화하도록 `https://` 포함.
- 200자를 넘으면 **제목을 자르지 말고 2개 메시지로 분할**(① 헤더+날짜+제목 ② 저널·PMID+링크),
  링크는 항상 **마지막 메시지**에 둔다. 구현: `reportMessage.buildReportMessages`.

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
  (새 attempt 기준 최대 3회), 끝내 실패하면 텔레그램 실패 알림 + 워크플로우 실패.
  잡을 분리한 이유: 재실행용 `actions: write` 토큰을 LLM 파이프라인 잡에 주지
  않기 위한 권한 분리. 한계(의도된 트레이드오프): 리포트는 배포 검증
  전에 발송되므로, 배포 실패 시 링크가 자동 복구(수 분)까지 잠시 전날 데이터를
  보일 수 있다 — 복구 불가면 실패 알림이 뒤따른다.
  (근거: 2026-07-05 GitHub 측 일시 오류로 배포만 실패 → 리포트 링크가 전날 데이터 노출.)

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

## 4-D. 텔레그램 발송 (무인 · 단일 알림 채널)

리포트·알림은 **텔레그램 Bot API `sendMessage`** 하나로 발송한다 (MCP/세션 불필요 → Actions에서 무인).
- 모듈: `src/agents/TelegramNotifier.js`. 메시지 텍스트 정본은 `src/utils/reportMessage.js`
  (§2) — 채널 모듈은 텍스트를 만들지 않고 실어 나르기만 한다.
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. **미설정 시 발송만 건너뜀(파이프라인 정상)**,
  발송 실패도 소프트(파이프라인 성공 처리, 로그에 `::warning`).
  - ⚠️ **값은 "리포트용" 봇이다** — 타워 센티널의 "경보용" 봇과 다른 봇을 쓴다.
    경보와 리포트를 한 대화창에 섞으면 음소거를 따로 못 걸어 경보를 놓친다.
    규격 정본: global-config `rulebook/command-center.md` §7 "봇 2개 규격".
    (`TELEGRAM_CHAT_ID`는 두 봇 모두 같은 값 — 대화창은 chat_id가 아니라 봇으로 갈린다.)
- 발송 지점 5곳: 데일리 성공 리포트·데일리 실패 알림(`github-actions-daily.mjs`),
  **on-demand 성공 리포트**(`scripts/on-demand.mjs`), 자료화 실패(`scripts/materialize.mjs`),
  Pages 배포 실패(`scripts/verify-pages-deploy.mjs`), NotebookLM 리마인더(`scripts/notebooklm-remind.mjs`).
- 통로 점검: `telegram-smoke.yml`(workflow_dispatch) — 시크릿 변경 직후 수동 1회.
- 보안: 봇 토큰이 URL에 들어가므로 에러 메시지에 URL을 넣지 않는다. `parse_mode` 미사용.
- **카카오는 폐지(2026-08-04, PeterJ 확정)** — refresh 토큰 만료(KOE322) + 재발급 부담,
  그리고 텔레그램이 이미 전 지점의 대체재였다. `KakaoNotifier`·`KAKAO_*` env 제거.
  되살릴 일이 생기면 그 커밋을 revert한다(git 히스토리 보존). 저장소 Secrets의 `KAKAO_*`는
  코드가 안 쓰므로 남아 있어도 무해하다.
- **이메일(Gmail)은 사용하지 않음(PeterJ 확정, 2026-07-05)**.
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
  notebooklm-py(비공식)로 새 달 Doc 2개를 노트북에 자동 등록. 실패·미설정 시 **텔레그램
  리마인더 폴백**(Doc 링크 포함). Variables `NOTEBOOKLM_NOTEBOOK_ID` + Secret
  `NOTEBOOKLM_AUTH_STATE` 필요 — 미설정 시 리마인더만(소프트).
- 모듈: `src/agents/ArchiveAgent.js` + `src/utils/googleAuth.js`(env 우선)·`docBuilder.js`·
  `fulltextDoc.js`·`webRefText.js`, `scripts/notebooklm-{register.py,remind.mjs}`.
  `github-actions-daily.mjs`가 텔레그램 발송 뒤 호출 — **실패해도 파이프라인 성공(소프트 실패)**.
- 상태 파일: `output/analysis_archive.json`(항목 + Drive docId/folderId/pdfFileId) —
  워크플로우 "Commit daily state" 스텝이 커밋. gitignore 예외 필수(spec-lint 강제).
- **대시보드 "아카이브 저장 현황" 섹션(§4-E, `src/utils/archiveStatus.js`)**: 누적 아카이브
  표 아래 접힌 섹션으로, 논문 건별 저장 상태(본문 출처 = OA본문/웹레퍼런스/초록만 · OA PDF
  적재 여부 · 전문 Doc 포함 여부)를 요약+건별로 보여준다. **메타데이터만**(본문 텍스트 미노출).
  **나만 보기 게이트**: 큐레이션 PAT(localStorage `tr_pat`)가 있을 때만 표시(기본 display:none).
  대시보드 삭제(§4-G)와 **무관** — 삭제한 논문도 여기엔 "저장됨"으로 남는다(Drive·Doc 누적).
  `GitHubPublisher._ensureArchiveStatus`가 매일 최신 데이터로 멱등 주입(archive 없으면 소프트 스킵).
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
  재클릭하면 나머지만 만든다. 실패 시 빨간 run + 텔레그램 알림.
- **인증·경합**: 버튼은 기존 Fine-grained PAT(localStorage, on-demand 위젯과 공용)로
  workflow_dispatch. 실행 전 확인 대화 1회. 데일리 커밋과의 경합은 push 실패 시 최신
  main 위에 멱등 재적용(재시도 3회)으로 처리 — daily-review.yml은 건드리지 않는다
  (데일리 코어 무영향 불변식). 클릭 직후 반영 지연(2~5분)은 클릭한 브라우저의
  "⏳ 요청됨" 로컬 표시로 완화.

## 4-H. 배포 페이지 2분할 — 논문 / 가이드라인·기타 (PeterJ 확정 2026-08-08)

설계 근거: `docs/superpowers/specs/2026-08-06-selection-guideline-redesign-design.md` §5.5-B.
콘텐츠 **3분류(논문·가이드라인·기타)는 유지**하되 **페이지는 2개**로 나눈다.

```
index.html        ① 논문 (데일리 코어)
guidelines.html   ② 가이드라인 및 기타
                    ├ 📋 가이드라인   — 공식 발행기관 진료지침
                    └ 🔖 기타 자료    — 직접 지정 참고자료
```

- **3페이지로 안 가는 이유**: 가이드라인과 기타는 카드 빌더(`_buildGuidelineCard`)를
  공유하고 축 하나만 다르다. 기타는 부정기·소량이라 단독 페이지를 못 채운다(빈 페이지 = 죽은 링크).
- **② 안에서 섹션을 분리하는 이유**: 기타는 미공인 출처일 수 있는데 시간순으로 섞이면
  **페이지 자체가 "여기 있는 건 다 권위 문서"라는 인상**을 준다. 페이지 인상은 카드보다 먼저 온다.
- **누적 표도 페이지별로 가른다 — 과거 행 포함.** 상태 파일엔 저널명이 없으므로
  (`selected_papers.json` = `{pmid,title,date}`) **배포된 HTML 이 정본**이다.
- **대등한 병렬 페이지**: 두 페이지가 같은 히어로 + 같은 탭 바(`.pgnav`)를 쓰고 현재
  페이지만 활성. 한쪽을 다른 쪽의 하위 링크로 두지 않는다.
- **디자인 톤**: 타워홈·타워플랜·마스터플랜과 같은 언어(웜뉴트럴 지면 + 무지개 라디얼,
  글래스 카드, 웜 잉크, 알약 배지). `<style id="tower-tone">` 한 덩어리로 원본 CSS 뒤에 얹는다.

**구현 계약 (`src/utils/pageSplit.js` — 순수 함수, 테스트로 고정)**

1. **합쳤다가 가른다.** `publish()` 는 읽을 때 `mergePages(index, guidelines)` 로 단일
   본문을 만들고, 기존 증분 로직(지침 중복 제거·TODAY 강등·날짜 행 교체·PMID dedup·
   큐레이션 재적용·통계 갱신)을 **종전과 동일한 입력**에 적용한 뒤, 끝에서
   `splitPages()` 로 두 파일을 기록한다. 로직을 두 벌로 만들지 않는 것이 요점이다.
2. **마이그레이션은 자동.** `guidelines.html` 이 없으면 merge 가 현행 `index.html` 을
   그대로 돌려주고 split 이 과거 카드·행까지 가른다. 별도 일회성 스크립트 없음.
3. **★ 표 행 속성 순서 계약** — 어기면 데일리가 조용히 깨진다:
   - `data-pmid` 는 **`<tr ` 다음 첫 속성**이어야 한다(행 dedup·큐레이션 삭제 패치가
     `<tr data-pmid="…"[^>]*>` 로 잡는다).
   - **논문 행에는 종류 마커를 붙이지 않는다.** 같은 날 재실행 교체 정규식이
     `<tr data-pmid="[^"]*"><td class="c-date">…` 라, 속성이 하나라도 늘면 매치가 깨져
     행이 중복 누적된다. 논문은 "`data-guideline` 없음"으로 판별한다.
   - 가이드·기타 행만 `data-kind="guideline|reference"` 를 **`data-pmid` 뒤에** 단다.
   - **예외는 둘뿐**: `data-guideline="1"`(주 1회 소개가 날짜 스윕에 지워지면 안 됨)과
     `data-manual="1"`(직접 지정분 보호). 둘 다 "스윕에 안 걸리는 것"이 목적이라
     **논문 행에 속성을 다는 것과는 방향이 반대**다.
   - **집행**: 스윕 정규식의 단일 원본은 `GitHubPublisher._rowDateDupRe(dateStr)` 하나이고,
     `test/tableRowContract.test.mjs` 가 `_tableRows` 산출물과 이 정규식을 맞물려 검사한다
     (둘 중 하나만 바뀌면 적색). spec-lint 가 CI 앞단에서 같은 계약을 3중으로 잡는다.
     **문서로만 두면 다시 밟는다 — 실제로 구현 중 한 번 밟았다.**
4. **소프트 실패**: `guidelines.html` 읽기 실패는 "없음"으로 보고 진행. 스캐폴드가
   아니면 분할하지 않고 `index.html` 만 종전대로 기록한다 — 분할이 데일리를 막지 않는다.
5. 아카이브 저장 현황(§4-E)은 논문 아카이브 기준이라 **`index.html` 에만** 둔다.
6. 큐레이션 스크립트는 표를 **전부 순회**한다(`guidelines.html` 은 표가 둘).

## 4-C. 자동화(GitHub Actions) 인증

분석 LLM 호출은 **claude CLI(구독)** 우선, 없으면 **Anthropic API** 폴백.
- 워크플로우가 `npm i -g @anthropic-ai/claude-code`로 CLI 설치.
- 저장소 Secrets 중 **하나** 필요: `CLAUDE_CODE_OAUTH_TOKEN`(구독, 무비용 — 로컬에서 `claude setup-token`으로 발급) **또는** `ANTHROPIC_API_KEY`(API 과금).

## 5. 변경 이력

- 2026-08-15 (가이드라인 개편 G4·G5·G6): `guidelinePubmed.js`(PT 쿼리 + 제목·유형 확장 쿼리를
  독립 실행·병합 · 쿼리별 실행 증거 manifest · **초집합 검증**) · `guidelineOrgSources.js`
  (기관 어댑터 골격 rss/listing-html/sitemap/api-json/manual-seed + source health · dry-run) ·
  `guidelineLineage.js`(제목 정규화 · 계보 키 · supersede 전이 — 애매하면 자동 처리 금지).
  **런타임 미배선.** 이 컨테이너는 아웃바운드 전면 차단이라 기관 실물 selector 를 검증할 수
  없어 `guideline-orgs.json` 의 `sources` 는 **전부 비운 채로 둔다**(테스트가 그것을 못 박는다).
  ★ 초집합 검증(`assertSupersetOfPtPath`)이 이 개편의 최우선 정지 신호다 — PT 경로가 찾은 것을
  확장 경로가 하나라도 놓치면 던진다. 근거(`ptPmids`)는 **열거 가능한 manifest 필드**여야 한다.

- 2026-08-15 (가이드라인 개편 G2·G3): `src/utils/guidelineClassifier.js`(문서 성격 판정 —
  **점수 계산보다 앞**에 선다) + `test/fixtures/guideline-corpus.json`(오탐 corpus 34건) ·
  `src/utils/guidelineState.js`(상태 v2 + 무손실 마이그레이션 · 원자 저장 · 손상 파일을
  빈 큐로 위장 금지). **런타임 미배선.**
  ★ 소급 판정 회귀(`test/guidelineHistoryRegression.test.mjs`) — 라벨이 없으므로 **현행 경로가
  실제로 발행한 이력 7건**을 새 분류기로 되돌려 판정한다. 이것이 두 결함을 잡았다:
  ①PMID 42373461 은 지침이 아니라 그 지침의 **해설 논문**인데 현행 경로가 발행했다
  (`guideline-commentary-or-digest` 패턴 신설) ②수동 승인 URL 이 `needsReview` 로 떨어지고
  있었다 — 확정 ⑤-A 위반이라 `manualApproved` 우회로를 넣었다(자동 필터를 통째로 건너뛴다).

- 2026-08-15 (arm F 전량 스크리닝): `config/collection.json` 의 `monthly.screenDepth` **1000 → 5000**.
  전환 첫날 실측(run `31844016618`)에서 **12구간 전부가 상한에 걸려** 있었다 — 구간별 실제
  1,013~2,575편(합 21,946)인데 12,000편만 회수돼 **9,946편(45%)이 점수조차 안 매겨졌다.**
  `sort=date` 내림차순이라 절단은 각 30일 구간의 **오래된 쪽부터** 일어난다.
  **LLM 토큰 변화 0**(사전순위는 결정적 `MetadataScorer`, 재순위 풀 36·efetch 12×100 은 불변).
  늘어나는 것은 esummary 요청뿐(60 → 116회/일, 총 192 → 248). 순차 호출이라 **요청 속도(≈0.85/s)는
  그대로**여서 NCBI 한도 여유도 불변. 월별 수집 구간 소요 85s → 약 151s.
  회귀: `test/monthlyScreenDepth.test.mjs` — 절단 보고와 설정값을 고정(종전 무테스트).

- 2026-08-15 (가이드라인 개편 G1 — 전용 스코어러·기관 스키마): `config/guideline-orgs.json`(기관 9곳 ·
  정책값) · `src/utils/guidelineOrgs.js`(fail-fast 검증기 + 기관 판정) ·
  `src/utils/GuidelineScorer.js`(권위·주제·최신성·범위·발견신뢰도 전용 점수식) 신설.
  **`MetadataScorer` 무수정 · import 도 하지 않는다** — 저널 등급·연구설계·표본은 점수에 안 들어간다.
  **런타임 미배선**(아직 아무도 부르지 않는다). `unmatchedTier1Policy="needsReview"` 만 PeterJ 확정(②-C)이고
  가중치·임계값은 잠정값이다. 기관별 `sources` 는 **전부 비웠다** — 검증되지 않은 URL·selector 는
  넣지 않는다(G5 몫).

- 2026-08-15 (가이드라인 개편 G0 — 회귀 보호): §1-C 신설 — 개편 전 **현행 계약**(7일 게이트 ·
  배열 상태 = v2 마이그레이션 입력 · 수동 URL 최종 승인 · non-fatal 경계 · 논문 경로 불변)을
  명문화하고 `test/guidelineContract.test.mjs` 23건으로 고정. **런타임 배선 무변경.**
  변이 6종(게이트 주기·상태 필드 유실·catch 재throw·수동 URL 기관검증·선정기 입력변형·
  run() 결합) 전부 적색 확인.

- 2026-08-04 (알림 채널 텔레그램 단일화): §4-D 전면 개정 — 카카오 폐지(`KakaoNotifier` 삭제,
  워크플로우 `KAKAO_*` env 제거), 전 발송 지점(**on-demand·materialize·NotebookLM 리마인더 포함**)을
  텔레그램으로 통일. §2 메시지 텍스트 정본을 `src/utils/reportMessage.js`로 분리(**텍스트 무변경**),
  spec-lint 앵커도 그 파일로 이전.

- 2026-08-04 (On-demand URL 가이드라인): §1-B에 **URL 지정 경로** 추가 — PubMed 미등재
  학회 공개본(예: IDSA 2026 AMR 그람음성 가이던스 v4.0)을 원문 URL로 태운다.
  PMID 없는 가이드 카드는 죽은 PubMed 링크 대신 원문 링크로 렌더(`sourceId` 키).
  데일리 자동 경로(PMID 기반)는 무변경.

- 2026-07-06 (R4 큐레이션): §4-G 신설 — 삭제·자료화 버튼 + 자료화 상태 표시를
  카드·누적 표 양쪽에(단일 상태 파일 `curation_state.json`, 클라이언트 블록 렌더).
  삭제=표시 제거만, 자료화=선별 승격(비공개 업로드), spec-lint 앵커(5e) 추가.

- 2026-07-06 (R3 아카이브 자동화): 4-E 개정 — 전문 Doc(b′: OA 본문 텍스트 append) +
  페이월 권위 웹 레퍼런스 본문 수집(c) + notebooklm-sync.yml(월 1일 소스 자동 등록,
  실패 시 리마인더 폴백). 비공개층 수집 확대 확정(공개 발신물 재구성 원칙 유지),
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
