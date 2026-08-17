/**
 * 가이드라인 큐의 **정렬 정본**.
 *
 * ★ 왜 함수 하나로 두나: 순서를 읽는 곳이 둘이다 —
 *   ① 발행 픽(`_stageGuideline`) ② 예고 리스트(`GitHubPublisher._renderUpcomingFromDisk`).
 *   두 곳이 각자 정렬하면 **화면이 "내일 이것이 나갑니다" 라고 해놓고 다른 게 나간다.**
 *   이 저장소가 2026-08-16 에 실제로 겪은 결함 B2 가 정확히 그 모양이었다.
 */

/**
 * 클수록 먼저 나간다.
 * · LLM 이 "안 맞는다" 고 본 것은 바닥으로 내린다(지우지는 않는다 — 되살릴 수 있어야 한다).
 * · LLM 적합도가 규칙 점수를 지배한다(×10). 규칙 점수는 0~12 범위라 같은 적합도
 *   안에서만 순서를 가른다 — PeterJ 지시대로 "나한테 맞는 것" 이 1순위다.
 * · 아직 판정 안 받은 것은 규칙 점수만으로 선다. 0점 취급이 아니다.
 */
export function guidelineRank(item) {
  const priority = Number(item?.priority) || 0;
  const fit = item?.llmFit;
  if (fit?.keep === false) return -1_000 + priority;
  if (!Number.isFinite(Number(fit?.score))) return priority;
  return Number(fit.score) * 10 + priority;
}

export function sortByGuidelineRank(items) {
  return [...(items ?? [])].sort((a, b) => guidelineRank(b) - guidelineRank(a));
}
