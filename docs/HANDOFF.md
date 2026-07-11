# HANDOFF — 세션 인수인계 노트

> 목적: 새 세션(어느 모델이든)이 이 파일 하나로 지금까지의 맥락·결정·상태·다음 할 일을
> 복원해 이어가기 위함. **새 세션을 열면 이 파일부터 읽고, 아래 "먼저 읽을 파일"을 훑으세요.**
> 최종 갱신: **2026-07-10 (KST)** · **논문 선정 개편 구현·프로덕션 반영 완료** — 3층(결정적 주제+저명저널 → Opus rerank 침상가치) + rerank 데일리 활성. **며칠 트렌드 관찰 대기**. 상세·다음은 **§10 [2026-07-10] 블록**.
> 최종 갱신(이전): 2026-07-09 진단·설계 · 2026-07-07 세션 크래시 복원.
> D1~D7(GCP·OAuth·YouTube 채널·인증·TTS 키·Secrets 4종) 완료, **D8 검증만 남음**(§8·§10).
> Fable 안전 라우팅이 세션 중 재차 발동 → Opus로 튕김 → **새 세션 + 이 파일로 복원**해 이어감.
> **[복원 2026-07-07 12:xx KST]** 직전 세션이 12:03 KST(커밋 `1a7e300`) 이후 API 오류로 끊김.
> 미병합 3파일(CLAUDE.md·HANDOFF.md·notebooklm-register.py)을 `session-history-loss-error-182sbo`
> 브랜치에서 복원. 유실분 재작업: ① 전역 `.claude/global-CLAUDE.md`에 "사용자 액션 안내" 규칙
> 신설 + 프로젝트/전역 양쪽에 **"안내 전 최신 UI(모바일/데스크탑 폼) 구성 확인"** 조항 추가,
> ② NotebookLM `NOTEBOOKLM_AUTH_STATE` 재발급 + register.py `async with` 버그 수정 →
> sync 재검증 **성공**(run 28839729336, Doc 2건 등록 완료). 데일리 상태파일은 main 최신 유지.
>
> **[2026-07-07 낮~오후 추가 완료 — 이 세션, 상세 개정은 추후]**
> - PR **#36** 병합: 복구 3파일 + NotebookLM async fix(월 cron 자동등록 실동작 조건 충족) + 전역 "최신 UI" 규칙.
> - PR **#37** 병합: 대시보드 **아카이브 저장 현황 섹션**(누적 표 아래, 접힘, "나만 보기"=tr_pat 게이트,
>   건별 본문출처/PDF/전문Doc 메타데이터만). REPORT_SPEC §4-E. 테스트 65건.
> - PR **#38** 병합: `.mcp.json`(`codex mcp-server`) — 클코 세션에서 **Codex 사용**.
> - **Codex MCP 셋업 완료·실검증**(새 세션 `/mcp`에 codex 도구 로드 확인). 데스크탑 Codex 로그인 →
>   `CODEX_AUTH_B64`(Default 환경 env) + setup script 설치/복원 + OpenAI 네트워크 허용.
>   문서 **`docs/codex-mcp-setup.md`**(토큰 갱신 §3). 전역 자동 규칙(모든 repo `.mcp.json` 자동)
>   `.claude/global-CLAUDE.md` "Codex MCP" 항.
>
> **[2026-07-07 저녁 추가 완료 — 이 세션]**
> - PR **#41** 병합: **codex-debate 스킬**("클코덱스 토론 시작") — codex(gpt-5.5)↔Opus 변증
>   코드리뷰 + 중립 심판 수렴 + 승인 게이트. 글로벌+로컬 단일원본(§5).
> - PR **#42** 병합: 그 스킬로 **전체 코드 토론 → 확정 8건 수정**(major 2·minor 6). 오탐 1건(F3) 기각.
>   회귀 테스트 6건 추가(test:unit 65→71). 근거 리포트 `docs/reviews/2026-07-07-2209-full-codebase-debate.md`.
> - `CODEX_AUTH_B64`가 빈 `~/.codex/auth.json`으로 시작해 401 → 스킬 프리플라이트가 멱등 시딩(재발 방지).

## 0. 한 줄 요약
`trend-review`(EM/CCM 데일리 논문 리뷰 파이프라인)를 **4-Phase 구조로 확장**했고,
Phase 2·3 코드 + On-demand 수동 디깅 + 카드뉴스까지 **main에 병합 완료**. 남은 건 코드가 아니라
**외부 설정(데스크탑 데이)**과 **샘플 승인**뿐. 병합 후 첫 자동 데일리(2026-07-06) 정상 작동 확인.

## 1. 먼저 읽을 파일 (맥락 복원용, 순서대로)
1. `REPORT_SPEC.md` — 단일 기준 문서(SSOT). §1(선정)·§1-B(On-demand)·§2(카톡)·§4-E(아카이브)·§4-F(영상).
2. `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md` — 확장 설계 근거.
3. `docs/superpowers/plans/2026-07-05-phase2-notebooklm.md`, `...phase3-youtube.md` — 실행 계획(코드는 이미 반영됨. 문서 상단 경고대로 폐기된 초안 코드블록 존재 — `src/`가 정본).
4. `docs/desktop-day-guide.md` — **내일 PeterJ가 데스크탑에서 할 1회성 설정 8단계.**
5. **TR master plan** — **정본(SSOT) = `docs/master-plan.html`** (git). 현재 **v18**.
   Artifact(뷰) = https://claude.ai/code/artifact/757a28f8-bef7-4d5d-bc38-0dbccf747a5f
   **★ 이름·운영 규칙(PeterJ 확정 2026-07-07 — 반드시 준수)**:
   - **공식 이름 = "TR master plan"**. PeterJ가 **TR plan / 로드맵 / 마스터플랜 / 서머리 / sum** 중
     무엇으로 부르든 **전부 이 문서**를 가리킨다.
   - **★ 갱신 절차(2026-07-07 개정 — 기록 유실 방지)**: ① 저장소 원본 `docs/master-plan.html`을
     **직접 편집**(내용 갱신 + 문서 안 "버전 기록" 맨 위에 새 줄 추가, **옛 줄 삭제 금지**, 버전 라벨 올림)
     → ② **같은 아티팩트 URL로 재배포**(Artifact 도구, `url=`) → ③ **커밋·푸시**.
     — 절대 새로 만들지 말 것. 원본이 git에 있으므로 세션이 바뀌어도 그대로 읽어 편집만 한다.
     (과거엔 아티팩트만 있어 세션 간 fetch 403 → 매번 재작성·이력 유실. 이제 git 원본으로 해결.)
   - **디자인 포맷(PeterJ 확정 v18, 함부로 바꾸지 말 것)**: 파란 히어로(제목 아래 바로가기) + Phase
     1→4 파스텔 색 박스(각 카드에 6분류 개수) + 각 Phase 상세를 **6분류 세로 나열**(확정 / 진행 P-m=모바일 /
     진행 P-d=데스크탑 / 진행 C=클코 / 상의 / 특이) + 공통·인프라 블록 + 버전 기록 표. (임시 R/A/B 코드는 폐기.)
   - **작업 후 리추얼**: 규모 있는 작업을 마치면 이 문서를 갱신해 **리포트처럼 전달**.
   **정본 = `docs/master-plan.html`(git)** — Artifact는 그 렌더 뷰(세션 간 fetch 403이어도 원본 유실 없음).

## 2. 프로젝트 구조 (4-Phase, PeterJ 확정)
- **Phase 1 · Curate & Brief** (운영 중) — PubMed 6개월/최대 300편 스코어링 → 임상적용성 최고 1편 →
  Opus PICO 분석(본문>레지스트리>웹보강>초록, 환각 배제) → GitHub Pages 대시보드 + 카카오 발송.
  - **+ On-demand 리뷰(신규, 병합됨)**: 대시보드 위젯에서 키워드 검색 → 후보 클릭 → 그 논문/가이드라인
    분석. 자동 선정과 별개 경로(자체 섹션 키, "직접 지정" 배지, 하루 1편 카운트 밖).
- **Phase 2 · Archive** (코드 완료, 시크릿 대기) — OA 논문 PDF → Drive 적재 + 월별 리빙 Google Doc
  갱신(NotebookLM 자동 동기화용) + 페이월 시 근거 도시에. 하이브리드(Doc 자동 + PDF 주1회 수동 추가).
- **Phase 3 · Produce** (코드 완료, 샘플 승인 대기) — 리포트 → 영상(중간폼·숏폼) + 카드뉴스(1080×1350).
  **영어 단일 기본**(`VIDEO_LANGS=en`, 한국어는 값 하나로 확장). 수치 생성 금지·원문 그림 미사용·차트 재구성.
- **Phase 4 · Publish** (전략만 확정, 미착수) — YouTube 비공개 인큐베이터 → 품질 도달 시 공개 전환
  (과거분 재업로드) + Instagram 영어 계정. 미리보기는 Drive 적재로. 착수는 품질 도달 후.

## 3. 확정된 핵심 결정 (되묻지 말 것)
- 발신물 **영어 단일 우선**. 브리핑(카톡·대시보드)은 한국어 유지.
- YouTube/Instagram **영어 단일 계정**으로 시작(한국어 계정은 추이 보고 추가).
- 발신 전략: **유튜브 비공개 + 인스타는 품질 도달 후 개시**(인스타는 게시물/프로계정 비공개가 불가함을 확인).
- NotebookLM 아카이브(2026-07-06 개정 확정): **비공개 아카이브층은 수집 범위 확대** —
  a 분석 Doc + b′ 전문 Doc(OA PDF 텍스트 추출 append) + c 페이월 시 권위 웹 레퍼런스 본문 자동 수집.
  (구 "타인 저작물 파일 수집 금지"는 비공개층에 한해 해제 — 사적 이용 복제 범위, 입수는 합법 경로만.)
  **공개 발신물(영상·카드)은 재구성 원칙 유지**(원문 그림·표 미사용, 수치는 리포트 값만, 출처 명시).
  소스 등록(월별 새 Doc 연결)도 **notebooklm-py(비공식)로 완전 자동화** — 소프트 실패 +
  실패 시 카톡 알림·수동 폴백(월 1회 리마인더). 계정 리스크는 PeterJ가 인지·수용함.
- 자막: captions API 대신 **번인**(force-ssl 스코프 회피). SRT는 보존.
- 영상 업로드 **privacyStatus 'private' 고정**(spec-lint 강제). `ENABLE_VIDEO=true` 전엔 비활성.
- On-demand 입구: **대시보드 검색 위젯** + PubMed esearch/esummary 브라우저 직접 호출. PAT는 사용자
  브라우저 localStorage에만(저장소·페이지 소스에 없음). 백업: Actions 수동 실행.

## 4. 안전장치 = 데일리 코어 무영향 (설계 불변식)
- Phase 2/3/On-demand는 전부 **소프트 실패 + 게이트** 뒤. 시크릿 없으면 해당 단계만 조용히 스킵.
- 데일리 자동 발행 경로는 병합 전과 **바이트 동일**(위젯 추가 제외) — 병렬 리뷰로 실증.
- **증거**: 병합 후 첫 자동 데일리 `46f2dad`(2026-07-06)가 정상 작동 — 대시보드 갱신, 위젯 생존,
  분석일수 6으로 정상 증가.

## 5. 완료 상태
- 병합 완료 PR: **#24**(확장 전체) · **#25**(리뷰 5건) · **#27**(Fable 재검토 실버그 6건, §8) ·
  **#28**(모델 전환 대비 하드닝 — `ci.yml` PR 게이트 + `video-sample.yml` + 세션 리추얼) ·
  **#30**(아카이브 pmid 실버그) · **#31**(러너 ffmpeg 설치 + 부분 산출물 업로드) ·
  **#34**(R3 아카이브 자동화 — 전문 Doc·웹 레퍼런스 수집·NotebookLM 등록 자동화 + 로드맵/정책 문서).
- 단위 테스트 **35건 통과**(D8에서 아카이브 pmid 회귀 2건 추가), `npm run spec-lint` 통과.
  **PR CI 게이트 가동 중**(모든 PR에서 spec-lint+테스트 자동 강제 — 병합 전 초록 확인).
- /code-review high 1회(10) + 병합 후 병렬 재리뷰(5) + Fable 재검토(6) 반영. 데일리 회귀 0.
- **데스크탑 데이 실동작 완료(2026-07-06 오전, 이 세션)**: GCP 프로젝트 `trend-review-501602`,
  API 3종(Drive·YouTube Data v3·Cloud TTS) 활성, OAuth 동의화면 **프로덕션**(7일 만료 회피),
  데스크톱 OAuth 클라이언트, YouTube 브랜드 채널 **`TrendReviewEMCCM`**(@TrendReviewEMCCM,
  개인계정 njell85 관리), refresh token 발급(개인계정 컨텍스트로 승인 — Drive 우선), TTS 키
  발급. **GitHub Secrets 4종 등록 완료**: `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/TTS_API_KEY`.
  `GOOGLE_DRIVE_FOLDER_ID`는 미등록(앱 자동 생성).
- **D8 Phase 2 검증 완료(2026-07-06 오후, 이 세션)**: on-demand 워크플로우로 SOHO 트라이얼
  (NEJM, PMID 41841715, DOI 10.1056/NEJMoa2516087)을 직접 지정 분석 → run `28769877446`
  **success**. 로그 실증: `Google 인증: env(Secrets) 경로`(Secrets 4종 실작동) · OA PDF 없음
  (NEJM 페이월, 정상 스킵) · **리빙 Doc 갱신 완료: 2026-07** · 카카오 발송 완료 · 4-B 레지스트리
  보강(NCT04468126). Drive에 앱 자동 생성 확인: rootFolder `17BmQVj…` / `2026-07` 폴더
  `1t3xruJ…` / Doc `15hUHhHz…`(`analysis_archive.json` driveState에 기록·커밋).
- **D8에서 실버그 1건 발견·수정(PR #30으로 병합 완료)**:
  아카이브 항목 pmid가 `''`로 저장 — FilterAnalyzer 성공경로가 `{...data, paper}`를 반환하는데
  LLM 툴 출력 `data.pmid`가 빈 문자열이면 `analysis.pmid ?? paper.pmid`가 폴백 못함. 데일리
  아카이브 가동 시 ① `upsertEntry` 키(date+'') 충돌로 같은 날 항목 유실 ② `pdfFiles['']`
  고정으로 OA 두 편째 오탐 스킵. 데일리 코어(카톡·대시보드는 `paper.pmid` 직접 읽음) 무영향.
  `entryPmidOf()`(paper.pmid 우선·빈 문자열은 `||` 통과)로 3개 소비점 통일 + 회귀 2건.
- 신규 파일: `src/agents/ArchiveAgent.js` `src/agents/VideoAgent.js`,
  `src/utils/{googleAuth,docBuilder,ChartRenderer,videoScript,videoRender,tts,cardNews}.js`,
  `scripts/{google-auth-setup,on-demand,video-sample}.mjs`,
  `.github/workflows/{on-demand,ci,video-sample}.yml`, `test/*.test.mjs`(7개), `docs/desktop-day-guide.md`.
- **codex-debate 스킬 완료(2026-07-07, 이 세션)**: PeterJ가 **"클코덱스 토론 시작 [대상]"**
  이라고 하면 codex(gpt-5.5)↔Opus가 대상을 독립 리뷰 후 **변증법적으로 수렴**(신규 반박 소진 or
  최대 4라운드)시키고 **중립 심판 서브에이전트**가 최종 판정·수정방안을 낸다. **수정은 승인 게이트 후**.
  · SSOT = `.claude/skills/codex-debate/{SKILL.md,codex-review.sh,report-template.md}` +
    `.claude/agents/{code-reviewer,review-judge}.md`. `env-bootstrap.sh`가 세션 시작 시 `~/.claude/`로
    복사(로컬 없으면 GitHub main 다운로드) → **전 프로젝트 글로벌**. 리포트 = `docs/reviews/`.
  · **유지보수 규칙: 저장소 원본만 수정. `~/.claude/` 사본은 세션마다 덮어써지는 파생물 — 직접 편집 금지.**
  · codex/`CODEX_AUTH_B64` 없는 환경(데스크탑 등)은 곱게 실패 + Opus 단독 폴백 안내.
  · 설계 SSOT = `docs/superpowers/specs/2026-07-07-codex-debate-design.md`, 계획 =
    `docs/superpowers/plans/2026-07-07-codex-debate.md`. E2E 검증 산출물 =
    `docs/reviews/2026-07-07-2146-dates-debate.md`(R1 수렴, src 무변경으로 게이트 준수 실증).
- **전체 코드 클코덱스 토론 → 8건 수정 완료(PR #42 병합, 2026-07-07 저녁)**: 전체 프로덕션 코드
  대상 codex↔Opus 2라운드 변증 수렴. 리포트 `docs/reviews/2026-07-07-2209-full-codebase-debate.md`.
  확정 8건 전부 수정: **F5**(FilterAnalyzerAgent — PICO 전건 실패 예외 전파, fallback 카드
  제외목록 배제), **F1**(GitHubPublisher — push 실패 폴백이 상태 JSON도 upsert, `_putFileViaApi`),
  **F9**(폴백 원격 sha 재조회+경고), **F2**(DataCollector — api_key 로그 마스킹 `scrubUrl`),
  **F4**(docBuilder — 월간 Doc P `pico.patient→population`), **F6**(retryPipeline — `delayMs>=0`
  게이트), **F7**(orchestrator — 제외 PMID dedup), **F8**(KakaoNotifier — access token 실행 내 캐시).
  오탐 **F3**(fetch 무한 hang — undici 기본 타임아웃 존재)은 변증으로 기각·미수정. 회귀 테스트 6건
  추가(`test/{retryPipeline,picoFailure}.test.mjs` + docBuilder P), test:unit **71 pass**·spec-lint 0·dry-run 정상.
  데일리 코어 불변식 무영향.

## 6. 남은 일 (우선순위) — 상세 착수 절차는 §10
0. ~~데스크탑 데이 D1~D7~~ **완료**(§5). 남은 건 D8 검증(§10-1) — 데스크탑 불요, 제가 트리거.
1. **D8 Phase 2 검증** (on-demand 워크플로우, PeterJ가 PMID 제공) — §10-1.
2. **NotebookLM 노트북 연결**(M1) + **On-demand 검색 폰 확인**(M2): 키워드 검색이 뜨는지
   (=PubMed CORS). 안 되면 대안(검색을 워크플로우로) — 미구현, 필요 시 착수.
3. **영상·카드 샘플 승인**(M3): `video-sample.yml` workflow_dispatch → Artifacts 다운로드 →
   시청 → 만족 시 Variables `ENABLE_VIDEO=true`. (수동 폴백: `node scripts/video-sample.mjs`)
4. **Phase 4 착수**(품질 도달 후): 공개 개시 기준·인스타 소프트런칭·한국어 계정 추가 시점 결정.

## 7. 열린 결정 (급하지 않음)
- ~~수동 지정분도 영상·카드까지 만들지~~ → **P2 선별 승격으로 확정**(2026-07-06, §10-P2):
  데일리/수동 불문 "자료화" 버튼 누른 것만 영상·카드 + 비공개 업로드.
- 카드뉴스 최종 사양(장수·정사각 vs 세로).
- Phase 4: 공개 개시 판단 기준 / 전체 자동 영상화 전환 시점(안정화 후, 설정값 하나로).
- **entry.fullText가 공개 repo에 커밋됨**(analysis_archive.json, #24부터 — OA 본문 최대 1만 자).
  §3 비공개층 원칙과 긴장: 유지(분석 Doc 재생성·R5 대본 컨텍스트에 사용) vs 전문 Doc append 후
  제거(공개 재배포 노출 축소). **PeterJ 결정 필요** — R3 리뷰에서 표면화(2026-07-06).
- 후속 정리 후보(P3): ① ArchiveAgent의 Drive find-or-create 5중복 → 헬퍼 통합
  ② verify-pages 잡의 불필요 npm ci 제거 ③ docBuilder.esc↔GitHubPublisher.esc 중복 통합
  ④ chromium launch 3중복(videoRender·cardNews·preview) 통합(R5 때 겸사) ⑤ 전문 Doc
  append의 export+재업로드 O(n²) → Docs API batchUpdate 전환(월말 Doc 수 MB 시).

## 8. 진행 중이던 것 → 완료 (Fable 재검토, 2026-07-06)
- Fable 세션에서 **전체 재검토 완료**: VideoAgent·ArchiveAgent·on-demand 위젯/스크립트·
  tts·videoRender·cardNews·googleAuth·docBuilder·ChartRenderer 전부 정독. 실버그 6건
  발견·수정 → **PR #27 병합**. 핵심: ① drive.file 스코프는 수동 생성 폴더 접근 불가
  (가이드 6-b 함정 — 자동 생성 폴백으로 해소), ② Drive 실패 시 아카이브 항목 영구 결번
  (선저장으로 해소), ③ 위젯이 배포 페이지에서 영구 동결(버전 마커+교체로 해소),
  ④ on-demand.yml 셸 인젝션, ⑤ 영상 재실행 시 LLM·TTS 재지출 + 거짓 "일부 실패" 경고,
  ⑥ TTS 키 URL 노출면. ffmpeg 인자·경로, PAT 저장 방식, docBuilder/카드 이스케이프,
  KakaoNotifier·FilterAnalyzer 필드 정합은 **문제 없음 확인**.
- 계획(4-Phase) 비판 검토 결론: 구조는 건전(소프트 실패 격리·게이트). 남은 약점은
  ① 검증이 데스크탑 데이 하루에 몰림(§6-1 그대로 진행하되 8번 검증을 순서대로),
  ② on-demand 발행엔 Pages 배포 검증(verify-pages)이 없음 — 위젯 안내대로 "수 분 후
  새로고침"이 안 되면 Actions 로그 확인, ③ VIDEO_LANGS=en이어도 대본은 ko·en 둘 다
  생성(LLM 토큰 소폭 낭비 — 언어 확장 대비 의도적 트레이드오프, 유지).
- 미검증 잔여(코드로 확정 불가): 위젯의 PubMed CORS(폰 확인, §6-2), NotebookLM
  자동 동기화 실동작(§6-1 데스크탑 데이 8번).

## 10. ★ 다음 세션 착수점 (여기서 이어서 시작)

> **[2026-07-11] 트랙 비교 실험(Arm1 vs Arm2) 구현 완료 — 시작 대기**
> 2주 무인 A/B: Arm1(프로덕션 픽 재사용) vs Arm2(Opus 웹서치 자체선정+동일 PICO).
> 코드·워크플로우 main 병합됨. **시작하려면 PeterJ가 Variables 2개 설정**:
> `ENABLE_TRACK_COMPARE=true`, `TRACK_COMPARE_END=<시작+14일, 예 2026-07-25>` →
> compare-tracks 워크플로우 수동 dispatch로 스모크 → 이후 매일 08:00 KST 자동.
> 결과: https://njell85-spec.github.io/trend-review/experiments/compare.html
> Arm3(ChatGPT)는 2주 뒤 PeterJ가 리스트 복붙 → arm3-list.json 병합·재렌더.
> 스펙: docs/superpowers/specs/2026-07-11-track-comparison-experiment-design.md

> **[2026-07-10 세션 마무리 — 다음 세션은 여기부터]**
> **논문 선정 개편(Phase A) 구현·프로덕션 반영 완료. 지금은 "며칠 데일리 트렌드 관찰" 대기.** 마스터플랜 **v20**.
>
> **한 일 (전부 main 병합 + rerank 데일리 활성):**
> - **3층 선정 파이프라인 완성**: 결정적(주제+저명저널) → 상위 K편(RERANK_POOL 기본 20) →
>   **Opus rerank(침상 임상가치)** → 1편 → 기존 PICO. rerank는 **소프트**(실패/AUP거부/빈결과 시
>   결정적 순위 유지) + 게이트 `ENABLE_RERANK`(daily-review.yml 기본 on, `vars.ENABLE_RERANK=false`로 끔).
> - **PeterJ 선정 기준 확정(2026-07-10)**: ①관심주제 부합 ②저명저널. 둘 다 메타로 계산 가능 →
>   결정적 스코어러가 주제·저널을 지배적으로(각 0~4), 설계·최신성·표본은 보조(~3), **관심 0매칭이면
>   배제(topicGatePenalty)**. "연구 성격"(이송역학·원격모니터링·증례·리뷰) 변별만 LLM rerank 몫.
> - **파일**: `config/interests.json`(관심주제 9그룹+trauma+방법론/이송/원격/역학 감점+scoring),
>   `config/journals.json`(신설, 분야 Q1 저널 등급 — EM/CCM 저명지 정당대우, Sci Reports/Medicine/BMC
>   등 감점; **폰에서 숫자만 고쳐 튜닝**), `MetadataScorer`(재설계+증례 -1.5),
>   `FilterAnalyzerAgent._rerankSelect`(LLM rerank), `daily-review.yml`(ENABLE_RERANK on),
>   `test/metadataScorer.test.mjs`(회귀 6건, 총 77 pass).
> - **실측 검증(Actions, 브랜치 ref)**: 오늘 300편 → 결정 1위 Cefazolin/NEJM, rerank 최종 1위도
>   **Cefazolin**(300편 LLM 풀스크린 1위와 수렴). 실패픽(07-09 인지재활·07-10 family syndrome) 제거.
>   결정 #3 미세순환 기전연구(8.7)→rerank #15, 리뷰·관찰 3~4점 강등, RCT·실무개입 상위 독점. 429 0건.
> - **실험 도구 상시화**: `selection-experiment.yml`(수동) — `EXP_LLM=0`(결정 재랭킹), `EXP_MODE=rerank`
>   (결정 top-K→LLM 재순위), 기본(recall 진단). 재검증은 브랜치/main ref로 dispatch.
>
> **다음 세션/PeterJ 대기 (여기부터):**
> 1. **며칠 데일리 픽 트렌드 관찰** → PeterJ 피드백. 조정은 대부분 **`config/*.json` 숫자 수정**으로
>    (세션 없이 폰에서). 코드 변경 필요한 것: RERANK_POOL 크기, rerank 프롬프트 문구, 감점 강도 등.
> 2. **관심 키워드는 아직 초안** — PeterJ가 추후 추가/배제/가중 조정 예정(그때 config 반영).
> 3. **남은 큰 작업(미착수)**: Phase B = 주1회 **가이드라인 선정**(`GuidelineAnalyzerAgent`·주간 게이트)
>    실동작 관측 후 개편. R5 영상·카드 품질(HANDOFF P1)도 여전히 대기.
> ※ GPT 교차검증(원안 L4)은 보류 — 결정적+rerank로 충분한지 트렌드 보고 판단.

> **[2026-07-09 세션 — 논문 선정 진단·설계]**
> **주제: 논문 선정 품질 개편(Phase A) — 설계·진단 단계. 프로덕션 코드 미변경.** 마스터플랜 **v19**.
> PeterJ 문제제기: "논문 선정 퀄이 낮다." 원안 = 메타 기준 촘촘화 + 10편 스크리닝 → Opus가 10편
> 검토·1편 선정 → Opus 분석 → GPT 교차검증 → 리포트.
>
> **확인된 사실 (커밋·실측 근거):**
> - 현행 선정에는 **LLM 판단이 0**. `MetadataScorer`(결정적 휴리스틱)가 300편 채점 → rawScore
>   최고 1편 **기계 선정**(`FilterAnalyzerAgent._selectTopPapers` `.slice`). Opus는 **이미 뽑힌**
>   1편 PICO에만 관여 → "임상적으로 이게 최선인가"를 아무도 안 읽음 = **저품질의 구조적 원인**.
> - **"300편 배치가 AUP로 거부됐다"는 확정 사실 아님.** 커밋 실측(2026-06-29~07-01): 진단이 4번
>   뒤집힘(harness 문서 B3 "오진→땜질→표류"). 배치 폐기 커밋 `82fb2d0`는 사유로 AUP를 들었으나
>   **직전** 근본원인 규명 `b8faf6a`(#2)은 AUP가 아니라 **429 세션 한도**였다("not a GitHub…as an
>   earlier alert had guessed"). AUP 오탐 신호는 실재했으나(`c33e08d`) 429와 **분리 검증 안 된 채**
>   "배치 불가"로 묶여 폐기됨. → 원 병목은 **429(300편 토큰 과다)** 가능성 큼.
> - **실측(이 세션): 실제 논문 13편을 폐기된 배치 채점 경로(`_scoringTool`)로 claude CLI(구독)에
>   돌림 → 13/13 성공·59초·AUP 거부/429 없음.** 채점 품질도 정확히 빠진 그 판단(QI·AI·원격모니터링
>   논문을 침상 임상가치로 하향, PE RCT 상향). → **"LLM은 선정에 못 쓴다" 전제 붕괴.**
>   ※ PubMed은 이 세션 환경에서 **완전 차단**(`http=000`, §11 명시) — 신선 수집·대규모 실험은 Actions에서.
>
> **확정 방향 (PeterJ 합의):**
> - **retrieve-then-rerank**: 결정적 프리필터(싼 고recall) → 상위 **K편만** Opus 정독·선정(고정밀).
>   300편 전량 LLM 스크리닝은 **비권장**(비용·429↑, 이득은 상위 변별에 집중, 하위는 메타가 이미 처리).
> - **K는 감이 아니라 실측(recall@K)으로 확정** — "결정적 top-K가 LLM이 전량에서 고를 1편을 담나".
> - **메타 기준 촘촘화 = 실험과 한 몸.** 실험이 "결정적이 오판해 떨군 좋은 논문 목록"을 주고 그게
>   튜닝 타깃(감으로 조이지 않음). 즉 원안 1·2번은 분리 작업이 아니라 하나.
> - **GPT 교차검증 = 2단계 옵션**(우선 Claude 단독으로 선정 품질부터, 효과 확인 후 OpenAI 키·비용
>   결정). `openai` provider는 이미 코드에 있음(`LLMClient`). 자동 데일리엔 `OPENAI_API_KEY` **미설정**.
>
> **다음 세션 착수점 (구체):**
> 1. **recall@K 실험 워크플로우 작성**(임시·브랜치 한정·**데일리 코어 무영향**) — **Actions에서 실행**.
>    실제 300편 수집 → LLM 청크(30~50편) 풀스크린(부산물: "청크 풀스크린 429 여부" 확인) →
>    **recall@10/20/50 표 + 오판 논문 목록** 산출.
> 2. **Ground truth = (B) 가벼운 버전**(PeterJ 승인 대기): 실험이 **LLM top-5**를 먼저 뽑아 오면
>    PeterJ가 폰에서 "이 정도면 신뢰" 확인 → 그다음 recall@K. (LLM 재순위가 설계 심장 → 1회 눈 검증.)
> 3. 실험 결과로 **K·메타 튜닝 확정** → 설계 spec(`docs/superpowers/specs/`) → 계획 → 구현.
> **Phase B(그다음): 주1회 가이드라인 선정**(`GuidelineAnalyzerAgent`·주간 게이트) 실동작 관측 후 개편.

> **[2026-07-07 세션 마무리]**
> R1~R4 완료. 오늘 **#36~#39 병합**: ① 세션 복구 ② NotebookLM async fix(월 1회 cron 자동등록
> **부활**, 폴백 아님) ③ 대시보드 **아카이브 저장현황 섹션**(#37, `src/utils/archiveStatus.js`)
> ④ **Codex를 Claude Code에서 사용**(MCP 연동·실검증·전역 자동, #38·#39).
> **다음 큰 작업 = R5 영상·카드 품질 개선**(아래 P1 절차). 착수 전 PeterJ 폰에서 **R5 불만 항목 청취**(B3).
> Codex 사용 가능 — 막히면 "codex 문서 불러와"(→ `docs/codex-mcp-setup.md`, 토큰 갱신 §3).
> **마스터플랜 최신 = v16**(§1-5, 같은 URL). 모든 작업 main 병합·CI 초록·working tree clean 상태로 종료.

**상태**: **D1~D8 + A1·A2 완료**(§5·아래 A). **샘플 1차 검토 완료(2026-07-06, PeterJ):
생성 자체는 성공했으나 디자인·내용·자막·구성 전반 품질 미달로 승인 보류** —
`ENABLE_VIDEO`는 계속 미설정(기본 비활성). PR #30·#31·#32 병합 완료.

### ★ 확정 로드맵 순서 (PeterJ 확정 2026-07-06 저녁 — P1·P2 우선순위 재배열)
R1 **on-demand 실증**(PeterJ: PAT 발급·위젯 클릭 → 세션: run 확인) → R2 **NotebookLM 연결**(B1)
→ R3 **아카이브 자동화 구현** ~~(코드)~~ **구현 완료(2026-07-06 저녁 세션, PR 대기)** —
b′ 전문 Doc(`fulltextDoc.js`+ArchiveAgent append-only) + c 웹 레퍼런스 수집(`webRefText.js`) +
`notebooklm-sync.yml`(월 1일 notebooklm-py 등록 + 카톡 리마인더 폴백) + REPORT_SPEC §4-E 개정.
계획: `docs/superpowers/plans/2026-07-06-r3-archive-automation.md`. 테스트 42건 통과.
**잔여**: ~~PeterJ 셋업(아래 B5)~~ 완료 → 07-07 데일리 후 dispatch 실검증만 → R4 **큐레이션 버튼 2종**(P2)
→ R5 **영상·카드 품질 개선**(P1). ※ R5 전에 자료화 버튼 본격 사용은 자제(저품질 영상 누적+비용)
— R4 완료 후 동작 확인 1~2건만.
- **R4 경과(2026-07-06 저녁)**: 이전 세션이 R4를 구현 완료했으나 **push 전 세션 에러로
  컨테이너와 함께 유실**(로컬 커밋 5개 — 원격 미존재 확인). 교훈: 미리보기 승인 대기 중에도
  세션 지정 브랜치에 push는 해둘 것(승인 전 병합만 안 하면 /preview 규칙 충족).
  현 세션에서 PeterJ 추가 요구 반영해 재착수: **자료화 여부 상태 표시** 추가, 배치는
  **카드+표 양쪽 모두**로 확정(PeterJ 2026-07-06 밤). **본구현 완료 + 실렌더 미리보기
  승인 + 서브에이전트 리뷰 6건(C1 치명 포함) 반영 완료** — 계획: `docs/superpowers/
  plans/2026-07-06-r4-curation-buttons.md`, 스펙: REPORT_SPEC §4-G. 테스트 58건.
  **PR #35 병합 완료(2026-07-06 밤, PeterJ 직접 머지) + 라이브 배포 반영(CURATION_BLOCK
  v4)**. 07-07 데일리가 병합 후 정상 실행(run success) — 새 `_applyCuration` 경로
  통과에도 데일리 코어 회귀 0(불변식 유지 실증). PeterJ 실사용 피드백 대기 →
  포맷 수정사항 나오면 반영. ※ 자료화 버튼 본격 사용은 R5(품질) 후 — 지금은 1~2건 확인만.

### P1 · 영상·카드 품질 개선 (승인 게이트 재도전) — 로드맵상 R5
- **품질 레버 노트(2026-07-06 확인)**: 현재 대본 생성 입력은 리포트 필드(PICO·keyFindings 등)만
  — `buildScriptMessages()`가 아카이브 항목의 fullText·dossier를 안 씀. R5에서 이를 대본
  프롬프트의 **추가 컨텍스트**로 넣으면 내용 풍부화 가능("새 수치 생성 금지" 규칙은 그대로).
- **R5 필수 요건(PeterJ 2026-07-06)**: 레퍼런스 전 채널 병기(REPORT_SPEC §4-F) — 영상 설명·
  마지막 슬라이드·카드 마지막 장에 참조 링크(references) 표기 구현.
- **작업 성격: 템플릿·렌더링 코드 개선**(§11 지침 안에서 가능) — 대상 파일:
  `src/utils/videoRender.js`(슬라이드 HTML/CSS 템플릿·ffmpeg 자막 번인 스타일),
  `src/utils/cardNews.js`(카드 레이아웃), `src/utils/videoScript.js`(대본 생성 프롬프트의
  **구성 지시부** — 슬라이드 수·문장 길이·구조. 단 "새 수치 생성 금지" 문구는 spec-lint
  강제라 유지), `src/utils/ChartRenderer.js`(차트 스타일).
- **절차(2026-07-06 개정 — 2단계 미리보기 루프)**: ① PeterJ에게 구체 불만 항목 청취
  (디자인/내용/자막/구성 중 무엇이 어떻게 — 항목당 2~4개 보기 선택형 권장) →
  ② 개선 계획 짧게 제시·합의 → **②-b 더미(플레이스홀더) 데이터로 슬라이드·카드 PNG를
  세션에서 직접 렌더해 폰으로 선승인**(슬라이드는 chromium HTML 스크린샷 방식이고 원격
  세션에 Chromium 사전 설치 — PR·CI·LLM·TTS 없이 몇 분 내 반복, 더미 텍스트라 §11 준수) →
  ③ 세션 지정 브랜치에 작은 커밋 + spec-lint/테스트 → ④ PR CI 초록 → 병합 →
  ⑤ `video-sample.yml` 재트리거 → Artifacts 링크 전달 → ⑥ PeterJ 시청 → 피드백 반복.
  **승인 전 `ENABLE_VIDEO` 설정 금지.**
- 1차 샘플 실물: A2 링크(아래) — 개선 전 기준점으로 참고.

### P2 · 대시보드 큐레이션 버튼 2종 (PeterJ 확정 2026-07-06) — 로드맵상 R4 (P1보다 먼저)
- **운영 플로우(확정)**: 데일리 + 필요 시 On-demand로 페이지 구성 → PeterJ가 페이지에서
  ① **삭제 버튼**(별로/번잡한 항목 정리), ② **자료화 버튼**(누른 것만 카드뉴스·영상 생성 +
  YouTube **비공개** 업로드). Phase 2(Drive Doc·NotebookLM)는 지금처럼 **전량 자동 누적** 유지.
- **경계(합의)**: 삭제 = 대시보드 표시 제거만(Drive Doc·제외목록 유지 — 재선정 방지).
  자료화 = 생성+비공개 업로드까지 한 번에(privacyStatus private 고정이 안전망).
  전역 자동 영상화(ENABLE_VIDEO 상시)는 안정화 후 옵션으로 보류 — **지금은 선별 승격으로
  품질 컨펌**. 자료화 버튼은 나중에 자동 모드에서도 "예외 승격" 용도로 존치.
- **구현 방식**: 기존 검증된 프레임 재사용 — 버튼 → PAT(localStorage)로 workflow_dispatch →
  Actions가 수정·커밋. 삭제는 섹션 키 단위 HTML 블록 제거 + 상태파일 숨김 목록 기록.
  주의: 데일리와 커밋 경합(concurrency 그룹+재시도), 삭제 확인 단계 1회.
- **선행 조건**: R3(아카이브 자동화) 완료 후 착수(로드맵 재배열로 P1 승인보다 먼저).
  REPORT_SPEC §4-F 운영 모드 문구 갱신 동반(spec-lint 고정 문구 2종은 불변).

### A. 새 세션 Fable이 무인으로 할 수 있는 것
- ~~A1 · 아카이브 pmid 실버그 PR 병합~~ **완료** — PR #30 병합(squash `8866b46`).
- ~~A2 · 영상/카드 샘플 생성~~ **완료** — 1차 run `28770767478` 실패(ffprobe ENOENT,
  러너에 ffmpeg 기본 미포함) → **PR #31**(ffmpeg 설치 스텝 + Upload `if: always()`) 병합
  (`240fb36`) → 재실행 run `28772142066` **success**. Artifacts `video-samples-2`
  (9파일 · 9MB · 7일 보관, ~07-13 만료):
  https://github.com/njell85-spec/trend-review/actions/runs/28772142066/artifacts/8101326827
  시청·승인(B3)은 PeterJ 몫.
- **A3 · 데일리/아카이브 관찰**: 다음 자동 데일리(07-07 06:30 KST) 실행 결과를 job summary/
  로그로 확인해 회귀 0 + 아카이브 단계 실동작 보고. (env 주입 여부는 **정적 확인 완료** —
  daily-review.yml 83~87행에 GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/TTS_API_KEY +
  GOOGLE_DRIVE_FOLDER_ID 이미 주입돼 있어 후속 코드 작업 불필요. 남은 건 로그 관찰뿐.)

### B. PeterJ가 폰으로 해야 하는 것 (자동 불가 — Google 로그인·시청·승인)
- ~~B1 · M1 NotebookLM 연결~~ **완료(2026-07-06 저녁)**: 노트북 `Trend-review` 생성,
  분석 Doc 소스 연결, 질문 1건에 인용 마커 달린 응답 확인(R2 완료).
- ~~B2 · M2 위젯 폰 확인~~ **완료(2026-07-06 저녁)**: Fine-grained PAT 발급
  (Actions R/W 한정, **No expiration** — PeterJ 위험 수용, 유출 시 revoke+재발급이 대응책)
  → 폰 브라우저 2개(삼성인터넷·크롬) 등록, 태블릿은 추후. 위젯 클릭 →
  on-demand run `28788944742` dispatch 실증(R1 완료).
- **B3 · M3 샘플 승인**: ~~1차 시청 완료~~ → **보류**(품질 미달, P1로 개선 후 재도전).
  개선판 재생성 때마다 시청 → 만족 시에만 Variables `ENABLE_VIDEO=true`. 승인은 사람 판단 게이트.
- **B4 · M4 관찰**: 이상 없으면 7일 무개입 관찰.
- ~~B5 · NotebookLM 자동 등록 셋업(R3 잔여)~~ **셋업 완료(2026-07-06 저녁, 데스크탑)**:
  notebooklm-py 설치·`notebooklm login` 성공(Windows, Python 3.12.10 신규 설치·
  playwright chromium 별도 다운로드 필요했음) → Secret `NOTEBOOKLM_AUTH_STATE` +
  Variables `NOTEBOOKLM_NOTEBOOK_ID` 등록.
  - **실검증 결과(2026-07-07 낮 복원 세션) — 자동 등록 부활 ✅**: PeterJ가
    `NOTEBOOKLM_AUTH_STATE` 재발급 + register.py `async with` 버그 수정(아래) 후
    run `28839729336`에서 분석 Doc(`15hUHhHz…`)·전문 Doc(`1t1XkK4D…`) **2건 모두
    `등록 완료`**, 카톡 리마인더 폴백은 **skip**(불필요). 즉 자동 동기화 경로 실동작.
  - **직전 "실패"의 진짜 원인 = 인증 만료 아님, 코드 버그**: main에도 있던 선재 버그로
    `client = await NotebookLMClient.from_storage(...)`가 HTTP 커널을 초기화 안 해
    `add_url`에서 `RuntimeError: Client not initialized`로 죽었다(진단의 "만료됨 2개"는
    비핵심 쿠키 오탐 — `from_storage`는 재발급분을 정상 통과). `async with … as client:`로
    수정(복구 브랜치 커밋 `b481c03`).
  - **미결(권장) — main 병합 필요**: 이 fix는 현재 `claude/recover-previous-session-t0l4tb`
    에만 있음. **main에 병합해야 매월 1일 cron 자동 등록이 실제 동작**한다(안 하면 cron은
    여전히 버그 → 리마인더 폴백으로만). 운영 모드 = **자동 등록 복귀**(실패 시 카톡 리마인더 폴백 유지).

### 주의 (자동 세션·사람 공통)
- §3 확정 결정 되묻지 말 것. §4 데일리 코어 무영향 유지. 대시보드/카톡 포맷 변경 시 push 전 /preview.
- YouTube 업로드는 승인 계정이 개인계정이라, 나중에 영상 켰을 때 403(channelNotFound) 나면
  `google-auth-setup.mjs` 재실행해 **브랜드 채널 컨텍스트로 재승인**(가이드 문제해결 참고).
- **Fable 안전 라우팅 주의**(§0·§7): 과거 이 프로젝트 작업 중 Fable→Opus 강제 전환이 있었다.
  새 Fable 세션이 중간에 튕기면 이 파일 하나로 복원해 이어가면 된다(§1 순서).

## 11. ★ 새 세션 운영 지침 — Fable 안전 라우팅 회피 (중요)
이 저장소는 의료(EM/CCM) 도메인이라, **세션이 직접 임상 내용을 생성·해석하면** Fable의
의료/이중용도 안전 계층이 자극돼 세션이 튕길 수 있다(과거 반복 발생, §0·§7). 회피 원칙:

- **세션 = 인프라 오케스트레이션 전용.** 세션이 하는 일은 워크플로우 트리거(GitHub MCP),
  PR 생성·CI 확인·병합, 파일 커밋/푸시, 로그·job summary 확인, 상태 파일 점검뿐이다.
- **임상 내용은 세션이 만지지 않는다.** 논문 초록 요약, 치료효과·사망률·용량 등 수치 해석,
  "어떤 치료가 낫다"류 판단·권고는 **전부 자동 파이프라인(claude CLI/API)** 이 담당한다.
  세션은 그 산출물(리포트 JSON·대시보드·아카이브)을 **내용을 읽어 해석하지 말고 기계적으로
  전달·발행**만 한다. 논문은 식별자(PMID/DOI)로만 참조한다.
- **PubMed 실조회를 세션에서 하지 않는다.** 검증용 논문이 필요하면 지어내지 말고 PeterJ에게
  PMID/DOI를 받는다(이 원격 환경은 어차피 PubMed 직접 접근이 막혀 있음).
- 튕겨도 손실 없음: 세션 작업은 전부 커밋으로 남고, 이 파일 하나로 복원해 이어가면 된다(§1).

## 9. 프로젝트 규칙 (CLAUDE.md 요지)
- 호칭 **PeterJ**, **존댓말**. 결론부터, 확인/추측 구분.
- 작업 마무리 시 commit+push. 리포트·발송·대시보드 변경 전 `REPORT_SPEC.md` 필독.
- 대시보드/카톡 포맷 변경은 push 전 **/preview 스킬로 미리보기 승인**.
- 커밋 전 `npm run spec-lint` 통과. 규모 있는 변경은 `/code-review`.
- 병합된 PR은 재사용 금지 — 후속 작업은 main에서 브랜치 새로 파서.
