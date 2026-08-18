/**
 * paperQueue — 논문 트랙(트랙1)의 **예정리스트에서 발행할 것을 고르는 정본**.
 *
 * ★ 왜 생겼나 (PeterJ 확정 2026-08-18)
 *   *"예비리스트에서 순서대로 안 뽑히면 예비리스트가 무슨 소용이 있니…"*
 *   *"예비리스트가 미리 선정 돌린 거로 보고 당일에는 예비리스트를 분석만 하는 걸로."*
 *
 *   종전에는 트랙2(가이드라인)·트랙3(리뷰)만 예정리스트에서 꺼내 썼고 **트랙1만
 *   매일 PubMed 를 새로 뒤져 그 자리에서 뽑았다.** 예정리스트는 그저 "이런 게 후보다"
 *   를 보여 주는 장식이었고, 그래서 2026-08-18 에 **예정리스트에 없던 AHA 지침 문서가
 *   논문으로 발행됐다.** 화면이 "다음은 이것" 이라고 말하는데 실제로는 딴 게 나갔다 —
 *   이 저장소가 여러 번 데인 "화면과 게이트가 다른 것을 본다" 부류의 가장 큰 판이다.
 *
 * ★ 순서 규칙은 **배열 순서 하나뿐이다.**
 *   가이드라인·리뷰 큐는 `status` 와 랭크 함수를 갖지만 논문 큐는 안 갖는다.
 *   `mergeQueueItems` 가 이미 점수 내림차순으로 정렬해 저장하므로 **배열 순서가 곧
 *   선정 순서**이고, ▶(promote)도 항목을 배열 맨 앞으로 옮기는 것으로 동작한다.
 *   ★★ 여기에 `status` 나 `promotedAt` 표식을 도입하지 마라 — `queueControl` 이
 *      논문 큐에는 표식을 **일부러 안 붙이고**(PR #129) 회귀 테스트가 그것을 잠갔다.
 *      두 곳이 다른 규칙을 쓰기 시작하면 ▶ 가 다시 거짓말을 한다.
 */

/** 이미 나간 것 — 발행 장부(selected_papers.json) + 큐 자신의 이력. */
function consumedSet(state, excludePmids = []) {
  const ids = new Set();
  for (const e of [...(state?.published ?? []), ...(state?.rejected ?? [])]) {
    if (e?.pmid != null) ids.add(String(e.pmid));
  }
  for (const pmid of excludePmids ?? []) if (pmid != null) ids.add(String(pmid));
  return ids;
}

/**
 * 발행 가능한 예정 항목들 — **배열 순서 그대로**, 이미 나간 것만 걷어낸다.
 * 화면(예정리스트 렌더)이 보는 것과 **같은 규칙**이어야 한다. 다르면 화면이 거짓말한다.
 */
export function publishablePapers(state, excludePmids = []) {
  const consumed = consumedSet(state, excludePmids);
  return (state?.queue ?? []).filter((item) => {
    const pmid = String(item?.pmid ?? '').trim();
    return pmid && !consumed.has(pmid);
  });
}

/** 오늘 나갈 것 하나. 없으면 null. */
export function nextPaper(state, excludePmids = []) {
  return publishablePapers(state, excludePmids)[0] ?? null;
}

/**
 * 예정리스트를 다시 채워야 하는가.
 *
 * ★ 매일 채우지 않는다. 매일 수집·재순위를 돌리면 **어제 본 순서가 오늘 바뀐다** —
 *   그러면 "미리 선정해 둔 목록" 이라는 말이 다시 거짓이 된다. 남은 것이 하한 밑으로
 *   떨어질 때만 채운다(= 그때만 PubMed·LLM 을 쓴다).
 */
export const REFILL_FLOOR = 7;      // 일주일치. 이 밑으로 떨어지면 채운다.
export function needsRefill(state, excludePmids = [], floor = REFILL_FLOOR) {
  return publishablePapers(state, excludePmids).length < floor;
}
