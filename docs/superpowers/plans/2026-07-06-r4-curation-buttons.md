# R4 — 대시보드 큐레이션 버튼 2종 + 자료화 상태 표시 (실행 계획)

> PeterJ 확정(2026-07-06 저녁): 🗑 삭제 · 🎬 자료화 버튼과 **자료화 상태 표시**를
> **카드 하단과 누적 아카이브 표 양쪽 모두**에 구현. (배치 A+B 합집합)
> 선행 근거: HANDOFF §10-P2(경계·프레임 확정), REPORT_SPEC §1-B(PAT·dispatch 프레임).
> ※ 이전 세션의 R4 구현물은 push 전 유실 — 본 계획으로 재구현(상태 표시 요구 추가 반영).

## 0. 확정 경계 (HANDOFF §10-P2, 되묻지 않음)

- **삭제** = 대시보드 표시 제거만. 아카이브(Drive Doc)·재선정 방지 목록은 유지.
- **자료화** = 카드뉴스·영상 생성 + YouTube **비공개** 업로드까지 한 번에
  (privacyStatus private 고정 = 안전망, spec-lint 강제). 전역 `ENABLE_VIDEO`는 계속 꺼짐 —
  버튼은 "선별 승격" 경로.
- 인증: 기존 Fine-grained PAT(localStorage `tr_pat`, on-demand 위젯과 공용) →
  workflow_dispatch. 실행 전 확인 대화 1회.
- 불변식: **데일리 코어 무영향**(§4) — daily-review.yml은 건드리지 않는다.

## 1. 아키텍처 (싱크 원천 차단)

**단일 상태 파일** `output/curation_state.json` (gitignore 예외, 커밋 대상):
```json
{ "hidden": { "<sectionKey>": { "pmid": "", "date": "", "at": "" } },
  "materialized": { "<pmid>": { "date": "YYYY-MM-DD", "videos": [{"form":"","lang":"","videoId":""}] } } }
```

**렌더는 클라이언트 스크립트 1개** — `CURATION_BLOCK v1` (on-demand 위젯과 동일한
버전 마커 + 멱등 교체 패턴, `src/utils/curation.js`가 생성, GitHubPublisher가 주입):
- 페이지 로드 시 `output/curation_state.json` fetch(캐시버스트) → 실패 시 상태 '—'로 폴백
  (file:// 미리보기·Pages 404에도 버튼은 렌더).
- 각 `.paper-card`/`.guideline-card` 하단에 **상태 칩 + 🗑 삭제 + 🎬 자료화** 행 주입
  (pmid는 카드 푸터의 PubMed 링크에서 파싱, sectionKey는 감싸는 SECTION 주석에서).
- 누적 표 thead/각 행에 **자료화(상태)** 컬럼 + **관리(🗑·🎬 아이콘)** 컬럼 주입
  (`tr[data-pmid]` 기존 마커 활용).
- 과거 카드·행 포함 전부 커버(서버측 카드별 패치 불필요) — 카드/표가 **같은 상태 객체**를
  그리므로 두 위치 불일치 불가능.
- 클릭 → 확인 대화 → PAT로 dispatch → 204면 localStorage에 pending 마커
  (`tr_cur_pending_<pmid>`, 45분 TTL) → 그 브라우저에선 즉시 "⏳ 요청됨" 표시
  (반영 지연 2~5분 완화). 상태 파일이 done을 주면 pending 마커 해제.

## 2. 워크플로우 2종 (역할·권한 분리)

- **`.github/workflows/curate-remove.yml`** — inputs: sectionKey. permissions contents:write.
  `scripts/curate-remove.mjs`: ① curation_state.hidden 기록 ② index.html에서
  SECTION/GSECTION 블록 제거 + 해당 pmid 표 행 제거 + 통계(분석일수·논문 수) 재계산
  ③ commit+push (경합 시 pull --rebase 재시도 3회 — 데일리와 커밋 경합 대비.
  daily-review.yml에 concurrency를 넣지 않는 이유 = 데일리 코어 무영향 불변식).
- **`.github/workflows/materialize.yml`** — inputs: pmid. secrets: GOOGLE_*, TTS, LLM.
  timeout 60분. `scripts/materialize.mjs`: ① analysis_archive.json에서 pmid 항목 →
  분석 객체 복원(video-sample.mjs와 동일 패턴) ② `VideoAgent.run({upload:true})`
  (video_log.json이 중복 업로드 방지) ③ 결과를 curation_state.materialized에 기록
  ④ 상태 파일들 commit+push(재시도 동일). 실패 시 exit 1(빨간 run) + 카톡 실패 알림.

## 3. 퍼블리셔 연동 (미래 발행분)

- `GitHubPublisher.publish()`에 `_ensureCurationBlock()` 추가(위젯 ensure 옆).
- publish 시 hidden 목록의 sectionKey는 재삽입하지 않음(가이드라인 주간 게이트 실패 등
  재출현 방어 — curation_state 읽기만, 데일리 경로 로직 불변).
- 배포본 index.html에도 블록을 로컬 주입해 커밋(이중 관리 규칙) — 병합 즉시 버튼 활성.

## 4. 작업 순서 (작은 커밋, 매 커밋 push — 유실 방지)

1. 이 계획 문서.
2. `src/utils/curation.js`(블록 생성·ensure·제거 패치·통계 재계산·상태 IO) + 테스트.
3. GitHubPublisher 연동(+hidden 가드) + index.html 블록 주입 + 테스트.
4. `scripts/curate-remove.mjs` + workflow + 테스트(패치 함수 단위).
5. `scripts/materialize.mjs` + workflow.
6. REPORT_SPEC §4 큐레이션 항목 신설·§4-F 운영 모드 문구 갱신, .gitignore 예외,
   spec-lint(curation_state 예외 강제 추가 검토), HANDOFF 갱신.
7. spec-lint + 전체 테스트 + **/preview 실렌더 승인(PeterJ)** → 서브에이전트 리뷰 → PR → CI → 병합.

## 5. 완료 기준

- 테스트·spec-lint 초록 + /preview 스크린샷 승인.
- 삭제: 미리보기/실페이지에서 대상 섹션·행 소멸 + 통계 감소 + 재실행 멱등.
- 자료화: dispatch → run success → 상태 파일 갱신 → 카드·표 양쪽 "자료화됨" 표시.
  (실영상 검증은 R5 전 1~2건만 — §10 로드맵 주의사항.)
