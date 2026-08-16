# 3페이지 재구성 — 설계 계획 (PeterJ 요구 5건)

> 착수: 2026-08-16. 요구 5건은 **페이지 구조를 함께 건드리므로 하나로 설계한다.**
> 따로 붙이면 구조가 두 번 갈린다(PeterJ 지시).

## 0. 착수 전 실물 재확인 결과

| 확인 | 결과 |
|---|---|
| 예고 리스트가 배포 페이지에 떴나 | **떴다.** `index.html` 에 7건(가이드라인 6 · 리뷰 1) · 08-17~08-22 |
| `queue_papers.json` 생존 | **판정 불가** — 데일리(21:30 UTC)가 아직 안 돌았다. 현재 `queue: []` 는 정상 |
| 리뷰 주 1회 게이트 | **판정 불가** (같은 이유) |
| 텔레그램 진행상황 줄 | **판정 불가** (같은 이유) |

### 실물에서 새로 잡은 결함 3건

- **B1 예고 버튼이 전부 죽어 있다.** 배포된 `index.html` 의 `UPBTN v1` 스크립트가
  `var OWNER='undefined', REPO='undefined'`. `owner = process.env.GITHUB_OWNER` 인데
  PR #108 배포가 러너 밖에서 돌아 env 가 비었다. 같은 페이지의 `ONDEMAND_WIDGET`·
  `CURATION_BLOCK` 은 멀쩡한데, **그 둘은 없을 때만 삽입되고 UPBTN 은 매번 재생성**되기
  때문이다. 데일리가 돌면 자가 치유되지만, env 누락이 조용히 라이브 스크립트로 구워지는
  경로가 열려 있다는 것 자체가 결함이다.
- **B2 예고가 거짓말을 한다.** `_renderUpcomingFromDisk` 는 가이드라인을
  `cadence:'daily'` 로 그리는데 발행 게이트는 `guidelineIntervalDays = 7` 이다.
  화면은 매일 나간다고 말하고 실제로는 주 1회 나간다. → 요구 ④가 이것을 겸해 고친다.
- **B3 리뷰 트랙은 화면에 아예 렌더되지 않는다.** `_stageReview` 는 큐에서 꺼내
  `published` 로 옮기기만 하고 카드도 표 행도 만들지 않는다. 리뷰 페이지를 만들어도
  예고 말고는 영원히 빈다 → 요구 ①을 실제로 성립시키려면 렌더 배선이 필요하다.

## 1. 목표 구조

```
index.html       ① 논문            SECTION:      · data-kind=paper
guidelines.html  ② 가이드라인       GSECTION:     · data-kind=guideline
reviews.html     ③ 리뷰 · 기타      RSECTION:(신) · data-kind=review
                                    GSECTION(🔖)  · data-kind=reference
```

각 페이지 = `헤더 · 통계 · 탭(3) · **예고 블록(그 트랙만)** · 카드 섹션(전부 접힘) ·
누적 표(접힘 토글)` 순서.

## 2. 변경 지점

### ① 3분할 — `src/utils/pageSplit.js`
- `mergePages(index, guidelines, reviews)` — 인자 3개.
- `splitPages(html, opts)` → `{ index, guidelines, reviews, counts }`.
- 분류기 확장: 섹션은 `SECTION` / `GSECTION`(🔖 여부로 가이드·기타) / `RSECTION`.
  행은 `data-kind` 4종. **구본 행 폴백은 유지**(마이그레이션).
- `pageNav` 3탭.
- **마이그레이션은 공짜다**: `reviews.html` 이 없으면 merge 가 무시하고, split 이
  기존 `guidelines.html` 의 기타 카드·행을 리뷰 페이지로 옮긴다.

### ② 예고를 각 페이지 맨 위로 — `GitHubPublisher`
- 마커를 트랙별로 가른다: `<!-- UPCOMING:papers -->` … `<!-- /UPCOMING:papers -->`
  (`guidelines` · `reviews` 동일). 구버전 `<!-- UPCOMING -->` 는 렌더가 함께 걷어낸다.
- `_renderUpcoming(html, {track, ...})` 로 트랙 1개씩 그린다.
  `_renderUpcomingFromDisk` 가 세 번 호출해 병합 본문에 3블록을 넣는다.
- `splitPages` 가 각 블록을 **자기 페이지의 맨 위**(탭 바로 아래)로 옮긴다.
- 버튼(🗑 · ▶ · 토글 · 갈아엎기)은 블록 안에 그대로 따라간다.
- **스크립트는 페이지마다 필요하다** — 세 페이지가 각자 자기 블록의 버튼을 배선해야 한다.

### ③ 전부 접힘
- `_buildSection` · `_buildGuidelineSection` 의 `openAttr` 제거(오늘 것 포함).
- 배포본에 남은 `<details open class="day` 는 publish 경로에서 1회 정규화해 걷는다.
- `day-today` / `day-past` **클래스 구분은 유지**(시각적 강조는 남긴다. 접힘만 바꾼다).

### ④ 가이드라인 주기
- 게이트 기본값 `guidelineIntervalDays: 7 → 1`(매일). 리뷰는 7일 유지.
- **예고 cadence 와 게이트를 한 곳에서 끌어온다** — 지금처럼 따로 두면 B2 가 재발한다.
- PeterJ 최종 확정(3일 사이클 여부)이 오면 숫자만 바꾸면 되게 상수화한다.

### ⑤ 누적 리스트 접힘 토글
- `tableHtml()` 을 `<details class="arch-fold">`(기본 접힘)로 감싼다. 세 페이지 공통.

### 곁들여 고치는 것
- **B1**: owner/repo 가 비면 스크립트에 `'undefined'` 를 굽지 않는다. 배포본도 수리.
- **B3**: 리뷰 발행분을 `RSECTION` 카드 + `data-kind="review"` 행으로 렌더 배선.

## 3. 무손실 검사 재정비 — ★ 이번 작업의 가장 큰 함정

3페이지로 가르면 **마커가 어느 파일에 있는지가 바뀐다.** 지난 세션에 정확히 이걸로
헛검사가 났다(`data-guideline` 이 `index.html` 엔 0개 → `0 >= 0` 이라 삭제 변이가 초록).

규칙:
1. 검사 대상 마커마다 **어느 파일에서 재는지**를 표로 명시한다.
2. **기준값이 0이면 테스트가 스스로 실패한다**(`assert.ok(before > 0)`). 전 페이지 적용.
3. 각 검사에 대해 **배선을 지우는 변이가 적색이 되는 것**을 실제로 돌려 확인하고 기록한다.

## 4. 지킬 불변식
- 데일리 코어(논문 1편)는 무영향. 새 경로가 전부 실패해도 논문은 나간다.
- 렌더는 **덧붙이기만 한다. 지우지 않는다**(확정 ③-C).
- 러너는 브라우저 파일(`control_state.json` · `read_state.json`)을 **읽기만** 한다.
- 새 상태 파일을 만들면 `.gitignore` 예외를 같이 넣는다.
- 모듈을 만들면 **그것을 실제로 부르는 경로를 호출하는 테스트**를 같이 박는다.
