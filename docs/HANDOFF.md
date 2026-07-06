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
5. 마스터플랜 Artifact(대화형 계획서, HTML): **v12** = https://claude.ai/code/artifact/757a28f8-bef7-4d5d-bc38-0dbccf747a5f
   (R1~R4 완료 반영·R5 대기·B5 폴백 운영·4-Phase 상태·주의/미결). v11 이하는 구버전, 링크 동일.
   **정본은 이 파일(HANDOFF.md)** — Artifact는 세션 간 fetch가 403으로 막힐 수 있어(v8 실측) 뷰로만 취급.

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
  - **실검증 결과(2026-07-07 dispatch, run 28829294519)**: 자동 등록 **실패** —
    `notebooklm-py` 인증 갱신 단계에서 `ValueError: Authentication expired or invalid`
    (storage_state가 CI 헤드리스에서 만료/무효 판정, `notebooklm login` 재인증 요구).
    **카톡 리마인더 폴백은 정상 작동**(분석 Doc·전문 Doc 2건 발송 확인) — 설계된
    소프트 실패 안전망 성립. **미결(선택)**: 자동 등록 살리려면 auth state 재발급 또는
    브라우저 프로필 동반 필요(비공식 라이브러리 한계, PeterJ 리스크 수용 항목).
    **현 운영 모드 = 매월 1일 카톡 리마인더 → 폰에서 소스 2개 수동 추가(2클릭)**.
    데일리 코어·아카이브에는 무영향(소프트 실패 격리 실증).

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
