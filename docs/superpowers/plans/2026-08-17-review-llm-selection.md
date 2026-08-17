# 트랙3 리뷰 397건에 LLM 셀렉 걸기 (PeterJ 확정 3-1, 2026-08-17)

## 왜 "가이드라인 셀렉을 그대로 돌린다" 가 안 되나 — 실물 확인 결과 두 가지

### ① 프롬프트를 재사용하면 397건이 **전부 격리된다**

`buildFitPrompt` 의 점수 기준은 "권위 있는 최신 **진료지침**인가" 다. 마지막 줄이

```
- 0~2  이 독자와 무관 (수의·치과·미용, 지침이 아니라 지침을 연구한 논문, 학회 행정문서)
```

리뷰 아티클은 **정의상 전부** "지침이 아닌 것" 이다. 이 프롬프트로 397건을 판정하면
LLM 이 성실하게 0~2 점을 주고 `keep:false` 로 내린다. 돌려놓고 "셀렉이 잘 걸렀다" 로
읽힐 수 있는 부류라 특히 위험하다. **리뷰 전용 프롬프트가 필요하다.**

### ② 판정을 써도 **아무도 안 본다** — 리뷰 큐엔 `status` 도 정렬도 없다

실측한 큐 항목 모양:

```json
{ "pmid": "41951238", "title": "Airway management of adults…",
  "journal": "BMJ", "score": 8.9, "topic": "resp_airway",
  "lowConfidence": false, "addedAt": "2026-08-16" }
```

397건 전부 `status` 가 **없다**. 그리고 발행 픽은 `TrendReviewOrchestrator._stageReview`
에서 `const [picked, ...remaining] = state.queue` — **배열 머리를 그냥 집는다.**
예고 리스트(`_renderUpcomingFromDisk`)도 리뷰는 큐를 통째로 그린다.

즉 `applyFitVerdicts` 가 `status: 'needsReview'` 를 써 넣어도 **픽도 화면도 그 필드를
쳐다보지 않는다.** 셀렉을 돌리고 커밋까지 성공하는데 동작은 아무것도 안 바뀐다 —
이 저장소가 여러 번 데인 "모듈은 옳은데 안 불린다" 부류다.

## 그래서 하는 일

가이드라인이 이미 쓰는 구조를 리뷰에 **같은 모양으로** 얹는다. 새 개념은 안 만든다.

| # | 파일 | 하는 일 |
|---|---|---|
| 1 | `src/utils/reviewFit.js` (신설) | 리뷰 전용 도구·프롬프트·입력 매퍼 |
| 2 | `src/utils/reviewRank.js` (신설) | **정렬·필터 정본** — 픽과 예고가 같이 쓴다 |
| 3 | `src/utils/guidelineFit.js` | `unscoredItems` 에 `priorityOf` 주입구 (리뷰는 `score`) |
| 4 | `src/agents/GuidelineFitAgent.js` | 도구·프롬프트·입력 매퍼를 주입 가능하게 (기본값 무변경) |
| 5 | `TrendReviewOrchestrator._stageReview` | 큐 머리가 아니라 `publishableReviews` 에서 픽 |
| 6 | `GitHubPublisher._renderUpcomingFromDisk` | 리뷰 예고도 같은 함수로 걸러 정렬 |
| 7 | `scripts/review-fit.mjs` (신설) | 벌크 실행 CLI |
| 8 | `.github/workflows/guideline-fit.yml` | `track` 입력 추가 (guidelines · reviews) |

`promoteInQueue`(▶)는 **손대지 않는다** — 이미 `status != null` 이면 승격하도록 일반화돼
있어서, 리뷰가 `status` 를 갖는 순간 자동으로 옳게 동작한다(PR #118 의 F4 교훈).

## 반드시 지킬 것 세 개

1. **`status` 가 없는 항목은 발행 가능으로 본다.** 필터를 붙이는 순간 아직 판정 안 받은
   397건이 전부 화면에서 사라지면 안 된다. 없음 = 통과, 명시적 `needsReview` 만 격리.
2. **격리는 `rejected` 가 아니다.** `mergeQueueItems` 가 `rejected` 를 영구 배제로 다루므로
   한 번 잘못 자르면 다시는 안 들어온다(PR #120 에서 같은 결정을 했다). ▶ 로 되살린다.
3. **데일리 코어 무영향** — 리뷰 큐를 채우는 것은 데일리가 아니라
   `scripts/build-review-queue.mjs` 다(실측: 데일리는 `_saveTrack1Queue` 로 논문 큐만
   채운다). 그래서 리뷰에는 **데일리 증분 판정을 붙이지 않는다.** 벌크 한 번으로 끝난다.

## 변이로 확인할 것

- 리뷰 픽에서 필터를 벗기면 → 격리 항목이 발행되는 테스트가 적색이어야 한다
- 예고에서 필터를 벗기면 → 화면과 픽이 어긋나는 테스트가 적색이어야 한다
- `status` 없음을 격리로 취급하면 → 미판정 큐가 통째로 빈다는 테스트가 적색이어야 한다
- 리뷰 프롬프트에서 "지침이 아니어도 된다" 문구를 지우면 → 프롬프트 계약 테스트가 적색
