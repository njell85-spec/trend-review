# HANDOFF — 세션 인수인계 노트

> 목적: 새 세션(어느 모델이든)이 이 파일 하나로 지금까지의 맥락·결정·상태·다음 할 일을
> 복원해 이어가기 위함. **새 세션을 열면 이 파일부터 읽고, 아래 "먼저 읽을 파일"을 훑으세요.**
> 최종 갱신: 2026-07-06 (KST) · Fable 재검토 세션이 §5·§8 갱신 (PR #27 병합까지 완료).

## 0. 한 줄 요약
`trend-review`(EM/CCM 데일리 논문 리뷰 파이프라인)를 **4-Phase 구조로 확장**했고,
Phase 2·3 코드 + On-demand 수동 디깅 + 카드뉴스까지 **main에 병합 완료**. 남은 건 코드가 아니라
**외부 설정(데스크탑 데이)**과 **샘플 승인**뿐. 병합 후 첫 자동 데일리(2026-07-06) 정상 작동 확인.

## 1. 먼저 읽을 파일 (맥락 복원용, 순서대로)
1. `REPORT_SPEC.md` — 단일 기준 문서(SSOT). §1(선정)·§1-B(On-demand)·§2(카톡)·§4-E(아카이브)·§4-F(영상).
2. `docs/superpowers/specs/2026-07-05-phase2-notebooklm-phase3-youtube-design.md` — 확장 설계 근거.
3. `docs/superpowers/plans/2026-07-05-phase2-notebooklm.md`, `...phase3-youtube.md` — 실행 계획(코드는 이미 반영됨. 문서 상단 경고대로 폐기된 초안 코드블록 존재 — `src/`가 정본).
4. `docs/desktop-day-guide.md` — **내일 PeterJ가 데스크탑에서 할 1회성 설정 8단계.**
5. 마스터플랜 Artifact(대화형 계획서, HTML): claude.ai에 v7로 published. 진행 트래커·Phase 1~4 개괄.

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
- PR **#24**(확장 전체) + PR **#25**(최종 리뷰 5건 보완) + PR **#27**(Fable 전체 재검토
  실버그 6건 — 아래 §8) main 병합 완료.
- 단위 테스트 **33건 통과**(`npm run test:unit`), `npm run spec-lint` 통과.
- /code-review high 1회(10건) + 병합 후 병렬 재리뷰 1회(5건) + Fable 재검토 1회(6건) 반영
  완료. 데일리 회귀 0건. **주의**: 데스크탑 데이 가이드가 바뀜 — Drive 폴더 수동 생성·
  `GOOGLE_DRIVE_FOLDER_ID` 등록 불필요(앱이 자동 생성, drive.file 스코프 제약 때문).
- 신규 파일: `src/agents/ArchiveAgent.js` `src/agents/VideoAgent.js`,
  `src/utils/{googleAuth,docBuilder,ChartRenderer,videoScript,videoRender,tts,cardNews}.js`,
  `scripts/{google-auth-setup,on-demand,video-sample}.mjs`, `.github/workflows/on-demand.yml`,
  `test/*.test.mjs`(6개), `docs/desktop-day-guide.md`.

## 6. 남은 일 (우선순위)
1. **데스크탑 데이** (`docs/desktop-day-guide.md` 8단계, 1~2h): GCP·OAuth·TTS 키·Secrets·영어 전용
   YouTube 채널·수동 디깅용 PAT·NotebookLM 노트북 → workflow_dispatch로 Phase 2 검증.
2. **On-demand 검색 폰 확인**: 대시보드에서 키워드 검색이 뜨는지(= PubMed CORS 동작). 안 되면
   대안(검색을 워크플로우로 처리)으로 전환 — 미구현, 필요 시 착수.
3. **영상·카드 샘플 승인**: `node scripts/video-sample.mjs` → `output/video/`·`output/cards/` 확인 →
   만족 시 Variables `ENABLE_VIDEO=true`.
4. **Phase 4 착수**(품질 도달 후): 공개 개시 기준·인스타 소프트런칭·한국어 계정 추가 시점 결정 필요.

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

## 9. 프로젝트 규칙 (CLAUDE.md 요지)
- 호칭 **PeterJ**, **존댓말**. 결론부터, 확인/추측 구분.
- 작업 마무리 시 commit+push. 리포트·발송·대시보드 변경 전 `REPORT_SPEC.md` 필독.
- 대시보드/카톡 포맷 변경은 push 전 **/preview 스킬로 미리보기 승인**.
- 커밋 전 `npm run spec-lint` 통과. 규모 있는 변경은 `/code-review`.
- 병합된 PR은 재사용 금지 — 후속 작업은 main에서 브랜치 새로 파서.
