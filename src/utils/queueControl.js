/**
 * 예고 리스트 버튼이 실제로 하는 일 — **큐 자체를 고친다.**
 *
 * ★ 왜 새로 만들었나 (2026-08-16 실측)
 *   지난 세션이 붙인 버튼 세 개가 전부 **누르면 아무 일도 안 일어나는 상태**였다.
 *     ▶  `on-demand.yml` 에 `{pmid, mode}` 를 보냈다 — 그 워크플로가 받는 이름은
 *        `{target, kind}` 다. 422 로 튕긴다.
 *     🗑  `curate-remove.yml` 에 pmid 를 `sectionKey` 로 보냈다. 그 워크플로는
 *        **이미 발행된 섹션을 숨기는** 것이라 아직 발행 전인 큐 항목과는 무관하다.
 *     ♻  `sectionKey:'__UPCOMING_RESET__'` 를 보냈는데 그 문자열을 아는 코드가
 *        저장소 어디에도 없다.
 *   테스트는 전부 초록이었다. `data-up-*` 속성과 `dataset.upRun` 대응만 검사했지
 *   **받는 쪽 계약**은 아무도 안 봤기 때문이다. 같은 부류(모듈은 옳은데 안 불린다)의
 *   또 다른 얼굴이다.
 *
 * 여기 함수들은 전부 **순수 함수**다 — 원본을 고치지 않고 새 상태를 돌려준다.
 * 파일 입출력은 `scripts/queue-control.mjs` 가 맡는다.
 */

/** 큐 항목의 식별자. pmid 가 정본이고 없으면 id 로 떨어진다. */
export function itemId(item) {
  return String(item?.pmid ?? item?.id ?? '').trim();
}

/**
 * 🗑 — 큐에서 뺀다. **뺀 것은 `rejected` 에 남긴다.**
 * 지우기만 하면 다음 수집이 같은 것을 또 집어와 무한히 되돌아온다.
 */
export function dropFromQueue(state, id, todayStr = null) {
  const key = String(id ?? '').trim();
  if (!key) return { next: state, changed: false };
  const queue = state.queue ?? [];
  const hit = queue.find((x) => itemId(x) === key);
  if (!hit) return { next: state, changed: false };
  return {
    next: {
      ...state,
      queue: queue.filter((x) => itemId(x) !== key),
      rejected: [...(state.rejected ?? []), { ...hit, rejectedAt: todayStr }],
      updatedAt: todayStr ?? state.updatedAt ?? null,
    },
    changed: true,
  };
}

/**
 * ▶ — 큐 머리로 올린다(= 다음 실행에서 이것이 나간다).
 *
 * ★ 순서만 바꾸면 **아무 일도 안 일어나는 항목**이 있다 (2026-08-17 실측).
 *   가이드라인 큐는 항목마다 `status` 를 들고 있고, 발행 픽은 `status === 'queued'` 인
 *   것 중에서만 고른다. 그런데 실물 큐 5건이 전부 `needsReview` 였다 —
 *   ▶ 를 눌러 머리로 올려도 **게이트가 쳐다보지도 않는 자리로 올릴 뿐**이다.
 *   예고 리스트도 `queued` 만 그리므로 화면에서 사라지고, 자동 재판정이 닿지 않는
 *   (수집 창 밖으로 나간) 항목은 **영구 적체**된다. 소진 통로가 0 이었다.
 *
 *   그래서 ▶ 는 "다음 실행에서 이것이 나간다" 라는 **자기 설명대로** 동작한다:
 *   머리로 올리고, 검토 대기 상태였으면 **발행 대기로 승격한다.**
 *   이것은 PeterJ 의 수동 판단이므로 자동 필터보다 우선한다(확정 ⑤-A 와 같은 원칙).
 *   `status` 자체가 없는 큐(papers·reviews)는 종전과 똑같이 순서만 바뀐다.
 */
export function promoteInQueue(state, id, todayStr = null) {
  const key = String(id ?? '').trim();
  if (!key) return { next: state, changed: false };
  const queue = state.queue ?? [];
  const idx = queue.findIndex((x) => itemId(x) === key);
  if (idx < 0) return { next: state, changed: false };
  const hit = queue[idx];
  const needsPromotion = hit?.status != null && hit.status !== 'queued';
  // 이미 머리이고 승격할 것도 없으면 진짜로 할 일이 없다.
  if (idx === 0 && !needsPromotion) return { next: state, changed: false };
  const moved = needsPromotion
    ? { ...hit, status: 'queued', promotedFrom: hit.status, promotedAt: todayStr ?? null }
    : hit;
  return {
    next: {
      ...state,
      queue: [moved, ...queue.slice(0, idx), ...queue.slice(idx + 1)],
      updatedAt: todayStr ?? state.updatedAt ?? null,
    },
    changed: true,
  };
}

/**
 * ♻ — 이 목록 전체 갈아엎기.
 *
 * ★ 큐를 비우기만 한다. **다시 채우는 것은 다음 수집의 몫이다** — 여기서 새로 뽑으려면
 *   PubMed 를 때려야 하고, 그건 버튼 한 번에 러너가 몇 분씩 도는 일이다.
 * ★ 뺀 것을 `rejected` 로 넘긴다. 안 그러면 다음 수집이 **똑같은 목록을 그대로**
 *   다시 채워서 "갈아엎기" 가 아무것도 안 한 것처럼 보인다.
 */
export function resetQueue(state, todayStr = null) {
  const queue = state.queue ?? [];
  if (!queue.length) return { next: state, changed: false };
  return {
    next: {
      ...state,
      queue: [],
      rejected: [...(state.rejected ?? []), ...queue.map((x) => ({ ...x, rejectedAt: todayStr }))],
      updatedAt: todayStr ?? state.updatedAt ?? null,
    },
    changed: true,
  };
}

export const ACTIONS = Object.freeze(['drop', 'promote', 'reset']);

/** 액션 이름으로 위 셋 중 하나를 고른다. 모르는 이름은 던진다(조용히 넘어가면 안 된다). */
export function applyQueueAction(state, action, { id = '', today = null } = {}) {
  if (action === 'drop') return dropFromQueue(state, id, today);
  if (action === 'promote') return promoteInQueue(state, id, today);
  if (action === 'reset') return resetQueue(state, today);
  throw new Error(`알 수 없는 큐 액션: ${action}`);
}
