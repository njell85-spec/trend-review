# HANDOFF — 세션 인수인계 노트

> 목적: 새 세션(어느 모델이든)이 이 파일 하나로 지금까지의 맥락·결정·상태·다음 할 일을
> 복원해 이어가기 위함. **새 세션을 열면 이 파일부터 읽고, 아래 "먼저 읽을 파일"을 훑으세요.**
> 최종 갱신: 2026-07-06 (KST) 오후 · **데스크탑 데이 진행 중 세션 인계**.
> D1~D7(GCP·OAuth·YouTube 채널·인증·TTS 키·Secrets 4종) 완료, **D8 검증만 남음**(§8·§10).
> Fable 안전 라우팅이 세션 중 재차 발동 → Opus로 튕김 → **새 세션 + 이 파일로 복원**해 이어감.

## 0. 한 줄 요약
`trend-review`(EM/CCM 데일리 논문 리뷰 파이프라인)를 **4-Phase 구조로 확장**했고,
Phase 2·3 코드 + On-demand 수동 디깅 + 카드뉴스까지 **main에 병합 완료**. 남은 건 코드가 아니라
**외부 설정(데스크탑 데이)**과 **샘플 승인**뿐. 병합 후 첫 자동 데일리(2026-07-06) 정상 작동 확인.

## 1. 먼저 읽을 파일 (맥락 복원용, 순서대로)
1. `REPORT_SPEC.md` — 단일 기준 문서(SSOT). §1(선정)·§1-B(On-demand)·§2(카톡)·§4-E(아카이브)·§4-F(영상).
2. `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md` — 확장 설계 근거.
3. `docs/superpowers/plans/2026-07-05-phase2-notebooklm.md`, `...phase3-youtube.md` — 실행 계획(코드는 이미 반영됨. 문서 상단 경고대로 폐기된 초안 코드블록 존재 — `src/`가 정본).
4. `docs/desktop-day-guide.md` — **내일 PeterJ가 데스크탑에서 할 1회성 설정 8단계.**
5. 마스터플랜 Artifact(대화형 계획서, HTML): **v8** = https://claude.ai/code/artifact/4d280a76-7d18-4fd5-911f-496a763274ec
   (회의록·Phase 트래커·오늘 오전/오후 작업 리스트·Fable→Opus 전환 조치). v7은 구버전.

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
- NotebookLM: 리빙 Doc은 자동 동기화, PDF는 주 1회 수동 소스 추가. **타인 저작물 파일 수집 금지**(자체 도시에만).
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
  **#28**(모델 전환 대비 하드닝 — `ci.yml` PR 게이트 + `video-sample.yml` + 세션 리추얼).
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
- **D8에서 실버그 1건 발견·수정(브랜치 `claude/d8-phase2-validation-pxeu3h`, 병합 대기)**:
  아카이브 항목 pmid가 `''`로 저장 — FilterAnalyzer 성공경로가 `{...data, paper}`를 반환하는데
  LLM 툴 출력 `data.pmid`가 빈 문자열이면 `analysis.pmid ?? paper.pmid`가 폴백 못함. 데일리
  아카이브 가동 시 ① `upsertEntry` 키(date+'') 충돌로 같은 날 항목 유실 ② `pdfFiles['']`
  고정으로 OA 두 편째 오탐 스킵. 데일리 코어(카톡·대시보드는 `paper.pmid` 직접 읽음) 무영향.
  `entryPmidOf()`(paper.pmid 우선·빈 문자열은 `||` 통과)로 3개 소비점 통일 + 회귀 2건.
- 신규 파일: `src/agents/ArchiveAgent.js` `src/agents/VideoAgent.js`,
  `src/utils/{googleAuth,docBuilder,ChartRenderer,videoScript,videoRender,tts,cardNews}.js`,
  `scripts/{google-auth-setup,on-demand,video-sample}.mjs`,
  `.github/workflows/{on-demand,ci,video-sample}.yml`, `test/*.test.mjs`(7개), `docs/desktop-day-guide.md`.

## 6. 남은 일 (우선순위) — 상세 착수 절차는 §10
0. ~~데스크탑 데이 D1~D7~~ **완료**(§5). 남은 건 D8 검증(§10-1) — 데스크탑 불요, 제가 트리거.
1. **D8 Phase 2 검증** (on-demand 워크플로우, PeterJ가 PMID 제공) — §10-1.
2. **NotebookLM 노트북 연결**(M1) + **On-demand 검색 폰 확인**(M2): 키워드 검색이 뜨는지
   (=PubMed CORS). 안 되면 대안(검색을 워크플로우로) — 미구현, 필요 시 착수.
3. **영상·카드 샘플 승인**(M3): `video-sample.yml` workflow_dispatch → Artifacts 다운로드 →
   시청 → 만족 시 Variables `ENABLE_VIDEO=true`. (수동 폴백: `node scripts/video-sample.mjs`)
4. **Phase 4 착수**(품질 도달 후): 공개 개시 기준·인스타 소프트런칭·한국어 계정 추가 시점 결정.

## 7. 열린 결정 (급하지 않음)
- 수동 지정분도 영상·카드까지 만들지(현재: 분석·아카이브까지) / 하루 수동 지정 상한.
- 카드뉴스 최종 사양(장수·정사각 vs 세로).
- Phase 4: 공개 개시 판단 기준.

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
**상태**: **D1~D8 완료**(§5). 데스크탑 필요한 일은 전부 끝 — 남은 건 폰 작업 + 무인 자동화뿐.
새 세션(Fable)을 열어 **A(자동)** 를 무인 처리하고, **B(사람)** 는 PeterJ가 폰으로 진행한다.

### A. 새 세션 Fable이 무인으로 할 수 있는 것
- **A1 · 아카이브 pmid 실버그 PR 병합**: 브랜치 `claude/d8-phase2-validation-pxeu3h`.
  PR 생성(없으면) → `ci.yml`(spec-lint + test:unit 35건)은 **PR 이벤트에서만** 도므로 PR을
  열어야 CI가 돈다 → 초록 확인 후 main 병합. (데일리 아카이브 켜지기 전에 병합해 유실·OA
  중복 스킵을 원천 차단.) 이미 병합됐으면 이 항목은 스킵.
- **A2 · 영상/카드 샘플 생성**: `video-sample.yml` workflow_dispatch(GitHub MCP) 트리거 →
  완료 후 Artifacts 링크를 PeterJ에게 전달(업로드 없음, 무해). **소재는 오늘 아카이브된
  SOHO(PMID 41841715)로 이미 준비됨.** 여기까지가 자동 한계 — 시청·승인은 B.
- **A3 · 데일리/아카이브 관찰**: 다음 자동 데일리(06:30 KST) 실행 결과를 job summary/로그로
  확인해 회귀 0인지 보고. (데일리 워크플로우에 GOOGLE_* env가 주입돼 아카이브가 실제로
  도는지도 이때 함께 확인 — 안 돌면 daily-review.yml에 env 추가가 후속 코드 작업.)

### B. PeterJ가 폰으로 해야 하는 것 (자동 불가 — Google 로그인·시청·승인)
- **B1 · M1 NotebookLM 연결**: notebooklm.google.com 새 노트북 → Drive의 `Trend Review — 2026-07`
  Doc을 "소스 추가 → Google Drive"로 연결 → SOHO 내용 질문해 인용 응답 확인. (월초마다 새 달 Doc 추가.)
- **B2 · M2 위젯 폰 확인**: 대시보드에서 PubMed 검색(CORS)·PAT 붙여넣기·직접 지정 1건 동작 확인.
- **B3 · M3 샘플 승인**: A2 산출 영상·카드 시청 → 만족 시 Variables `ENABLE_VIDEO=true`
  (대시보드/카톡 포맷 바뀌면 push 전 /preview). 승인은 사람 판단 게이트.
- **B4 · M4 관찰**: 이상 없으면 7일 무개입 관찰.

### 주의 (자동 세션·사람 공통)
- §3 확정 결정 되묻지 말 것. §4 데일리 코어 무영향 유지. 대시보드/카톡 포맷 변경 시 push 전 /preview.
- YouTube 업로드는 승인 계정이 개인계정이라, 나중에 영상 켰을 때 403(channelNotFound) 나면
  `google-auth-setup.mjs` 재실행해 **브랜드 채널 컨텍스트로 재승인**(가이드 문제해결 참고).
- **Fable 안전 라우팅 주의**(§0·§7): 과거 이 프로젝트 작업 중 Fable→Opus 강제 전환이 있었다.
  새 Fable 세션이 중간에 튕기면 이 파일 하나로 복원해 이어가면 된다(§1 순서).

## 9. 프로젝트 규칙 (CLAUDE.md 요지)
- 호칭 **PeterJ**, **존댓말**. 결론부터, 확인/추측 구분.
- 작업 마무리 시 commit+push. 리포트·발송·대시보드 변경 전 `REPORT_SPEC.md` 필독.
- 대시보드/카톡 포맷 변경은 push 전 **/preview 스킬로 미리보기 승인**.
- 커밋 전 `npm run spec-lint` 통과. 규모 있는 변경은 `/code-review`.
- 병합된 PR은 재사용 금지 — 후속 작업은 main에서 브랜치 새로 파서.
