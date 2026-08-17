/**
 * 리뷰(트랙3) 큐의 **정렬·필터 정본**.
 *
 * ★ 가이드라인은 `guidelineRank.js` 가 같은 일을 한다. 왜 파일을 가르나:
 *   두 큐의 규칙 점수 필드 이름이 다르다(가이드라인 `priority` · 리뷰 `score`)。
 *   한 함수가 둘 다 보려면 필드 추측이 들어가는데, 그러면 한쪽 필드명이 바뀐 날
 *   **조용히 0점으로 읽히면서 순서만 뒤집힌다.** 트랙마다 자기 필드를 못 박는다.
 *
 * ★ 왜 함수로 두나: 순서를 읽는 곳이 둘이다 —
 *   ① 발행 픽(`_stageReview`) ② 예고 리스트(`_renderUpcomingFromDisk`).
 *   두 곳이 각자 정렬하면 화면이 "다음에 이것이 나갑니다" 라고 해놓고 다른 게 나간다
 *   (2026-08-16 결함 B2 가 정확히 그 모양이었다).
 */

/**
 * 발행 대상이 될 수 있는 것만.
 *
 * ★★ `status` 가 **없으면 통과**시킨다. 리뷰 큐는 2026-08-17 까지 `status` 를 아예 안
 *   들고 있었고(실측: 397건 전원 무필드), 판정은 벌크로 나중에 붙는다. 없음을 격리로
 *   읽으면 필터를 붙이는 순간 **큐 397건이 통째로 화면에서 사라진다.**
 *   격리는 LLM 이 명시적으로 내린 `needsReview` 뿐이다.
 */
export function publishableReviews(items) {
  return (items ?? []).filter((x) => x?.status == null || x.status === 'queued');
}

/**
 * 클수록 먼저 나간다.
 * · LLM 이 "안 맞는다" 고 본 것은 바닥으로 내린다(지우지는 않는다 — ▶ 로 되살린다).
 * · LLM 적합도가 규칙 점수를 지배한다(×10). 규칙 점수는 0~10 대라 같은 적합도
 *   안에서만 순서를 가른다 — PeterJ 지시대로 "나한테 맞는 것" 이 1순위다.
 * · 아직 판정 안 받은 것은 규칙 점수만으로 선다. **0점 취급이 아니다.**
 */
export function reviewRank(item) {
  const score = Number(item?.score) || 0;
  const fit = item?.llmFit;
  if (fit?.keep === false) return -1_000 + score;
  if (!Number.isFinite(Number(fit?.score))) return score;
  return Number(fit.score) * 10 + score;
}

export function sortByReviewRank(items) {
  return [...(items ?? [])].sort((a, b) => reviewRank(b) - reviewRank(a));
}

/** 픽과 예고가 같이 쓰는 한 줄 — 걸러서 정렬한 것. */
export function rankedPublishableReviews(items) {
  return sortByReviewRank(publishableReviews(items));
}
