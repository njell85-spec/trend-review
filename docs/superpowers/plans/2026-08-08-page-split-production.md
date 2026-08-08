# 배포 페이지 2분할 — 프로덕션 반영 계획 (2026-08-08)

> 스펙: `docs/superpowers/specs/2026-08-06-selection-guideline-redesign-design.md` §5.5-B
> 승인: PeterJ 2026-08-08 (미리보기 2회 → "나-1. 이대로 좋다. 프로덕션 반영까지 진행")

## 목표

```
index.html        → ① 논문 (데일리 코어)
guidelines.html   → ② 가이드라인 및 기타 (안에서 📋/🔖 섹션 분리)
```
누적 표도 페이지별로 가르되 **과거 행 포함**. 두 페이지는 **대등한 병렬 페이지**
(같은 히어로 + 같은 탭 바, 현재 페이지만 활성). 디자인은 타워 톤(TH·TP·MP).

## ★ 설계의 핵심 — 합쳤다가 가른다

`publish()`는 지금 **단일 index.html 증분 패처**다. 그 안에는 4주간 버그를 잡아온
로직이 쌓여 있다(같은 지침 중복 제거·TODAY→past 강등·날짜 행 교체·PMID 행 dedup·
큐레이션 재적용). **이걸 두 페이지용으로 쪼개면 그 로직을 전부 두 벌로 만들어야 하고,
데일리 코어 불변식이 깨질 위험이 크다.**

그래서 반대로 간다:

```
① 읽기   index.html + guidelines.html  →  mergePages()  →  단일 병합 본문
② 처리   기존 publish() 로직을 병합 본문에 그대로 적용   ← 한 줄도 안 고침
③ 쓰기   splitPages(병합 결과)  →  index.html + guidelines.html 둘 다 기록
```

- 기존 정규식·dedup·강등·통계 갱신이 **전부 종전과 동일한 입력**을 본다.
- **마이그레이션이 공짜다.** 첫 실행 때 `guidelines.html`이 없으면 merge 는 현행
  index.html 을 그대로 돌려주고, split 이 과거 카드·행까지 두 페이지로 가른다.
  별도 일회성 스크립트가 필요 없다(스펙이 걱정한 저널명 소실도 없다 — 배포 HTML 이
  입력이므로).
- split 은 **순수 함수**라 단위 테스트로 못 박을 수 있다.

## 가르는 키

| 대상 | 키 |
|---|---|
| 카드 | `<!-- SECTION:… -->` = 논문 / `<!-- GSECTION:… -->` = 가이드·기타 |
| 가이드 vs 기타 (카드) | 카드 안 `🔖 참고자료` 칩 |
| 표 행 | **신규**: `data-kind="paper\|guideline\|reference"` |
| 표 행 (구본) | `data-guideline="1"` + `selected_references.json` 대조 (마이그레이션 1회) |

## 함께 고치는 결함 3건 (미리보기에서 드러남)

① `_buildGuidelineSection` 이 접힌 헤더 라벨을 `📋 가이드라인`으로 하드코딩 —
   참고자료 카드도 그렇게 뜬다. 섹션이 갈리면 정면 모순이라 같이 고친다.
② `_tableRows` 가 참고자료 행에도 `data-guideline="1"` + `📋` 를 붙인다 →
   `data-kind` 부여, 기타는 `🔖`.
③ `curation.js` 의 `addTableControls` 가 `querySelector` 로 표 1개만 잡아
   둘째 표에 `자료화` 열이 안 붙는다 → 표 전부 순회.

## 작업 단위 (작은 커밋)

1. `src/utils/pageSplit.js` 신설 (순수: `mergePages` / `splitPages` / 타워 톤 CSS / 탭) + 테스트
2. `curation.js` addTableControls 표 전부 순회 (결함 ③)
3. `GitHubPublisher`: `_buildGuidelineSection` type 라벨(①) · `_tableRows` data-kind(②)
4. `GitHubPublisher`: `buildPage` 에 타워 톤 + 탭 · publish 의 읽기/쓰기를 merge/split 로
5. `_gitPush` · API 폴백 파일 목록에 `guidelines.html`
6. `REPORT_SPEC.md` §4-H + `spec-lint` 앵커
7. 검증: `test:unit` · `spec-lint` · 실제 index.html 로 종단 dry-run · `/preview` 렌더

## 불변식 (깨면 안 되는 것)

- 데일리 자동 발행 경로의 **선정·분석·알림은 무변경**. 이 작업은 발행 표현 계층뿐.
- 소프트 실패: `guidelines.html` 읽기 실패는 "없음"으로 보고 진행(merge 가 index 반환).
- `index.html` 의 앵커(`ARCHIVE_START` / `TABLE_ROWS_*` / 위젯 / 큐레이션 블록)는 유지 —
  spec-lint 가 그것들을 검사하고 있고, 큐레이션 JS 가 그 위에서 돈다.
