# 계획 — 아카이브 저장 현황 하루 지연 수정 (item 2 / 2A)

> 발단: 2026-07-09 PeterJ 리포트 피드백 #2 — "아카이브 저장 현황"에 오늘 논문이 안 뜸.
> 진단: 데이터(analysis_archive.json)는 정상. **연동 타이밍 버그**.

## 근본 원인 (코드로 확정)

데일리 실행 순서(`github-actions-daily.mjs`):
1. `orchestrator.run()` → `GitHubPublisher.publish()`가 **그 시점의** `analysis_archive.json`
   (=어제까지만)을 읽어 "아카이브 저장 현황"(§4-E) 블록을 index.html에 구워 커밋·푸시.
2. **그 다음에** `ArchiveAgent.run()`이 오늘 항목을 `analysis_archive.json`에 추가.

→ 패널은 항상 정확히 **하루 지연**. (논문분석/누적 리스트는 그날 `topPapers`로 바로 그려 무관.)
`scripts/on-demand.mjs`도 동일(publish → ArchiveAgent 순서).

## 수정 (2A — 재주입)

`GitHubPublisher.refreshArchiveStatus(dateStr)` 신설:
- ArchiveAgent 실행 **직후** 호출. 최신 `analysis_archive.json`으로 §4-E 블록만 다시 굽고
  index.html 커밋·푸시. 변경 없으면 no-op(멱등).
- **소프트**: 커밋/푸시 실패해도 던지지 않음(패널은 부가정보, 데일리 코어 무영향). 로컬 커밋만
  남으면 워크플로 후속 "sync daily state" 푸시가 함께 올림. push 실패 시 Contents API 폴백.
- push 폴백 로직은 `_pushToMain()`으로 추출해 `_gitPush`와 공유(동작 보존 리팩터).

호출부: `github-actions-daily.mjs`(Phase 2 아카이브 직후) + `scripts/on-demand.mjs`(ArchiveAgent 직후).

## 불변식
- 패널 **마크업/포맷 무변경** — 오늘 행이 하루 늦지 않고 뜨는 것뿐(내용 정확성 수정).
- 데일리 코어(카톡·대시보드 본문) 경로 무영향. 발송 속도 무변화(publish·카톡 먼저, 재주입은 뒤).

## 검증
- `test/archiveStatus.test.mjs`에 refresh 회귀(임시 git repo: 지연 상태 → 재주입 후 오늘 PMID 포함,
  2회차 no-op) 추가.
- `npm run spec-lint` + `npm run test:unit` 통과.
- 브랜치 push, 머지는 PeterJ 승인 후.
