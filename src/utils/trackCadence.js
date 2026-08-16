import { calendarDay } from './dates.js';

/**
 * 트랙별 발행 주기 — **게이트와 예고가 같은 곳을 본다.**
 *
 * ★ 왜 모듈로 뽑았나 (2026-08-16 실측 결함 B2)
 *   배포된 예고 리스트는 가이드라인을 **매일** 한 건씩 그려놨는데, 실제 발행 게이트는
 *   `guidelineIntervalDays = 7` 이라 **주 1회만 나갔다.** 화면이 거짓말을 하고 있었고
 *   테스트는 전부 초록이었다 — 두 숫자가 서로 다른 파일에 따로 적혀 있었기 때문이다.
 *   한쪽만 고치면 반드시 재발하므로 **정본을 하나로 만든다.**
 *
 * ★ PeterJ 확정 2026-08-16 (4-A) — **세 트랙 전부 매일.** 논문·가이드라인·리뷰가
 *   매일 각각 1편씩 나간다. "며칠 잘 돌려보고 간격 재설정 예정" 이므로 숫자만 고치면
 *   되도록 여기 한 곳에 모아둔다.
 */
export const TRACK_INTERVAL_DAYS = Object.freeze({
  papers: 1,
  guidelines: 1,
  reviews: 1,
});

/**
 * 순차진행 순서 — PeterJ 확정 2026-08-16.
 * "순차진행 on 을 켜면 논문 → 가이드라인 → 리뷰 순으로 하루 한 트랙씩 돈다."
 */
export const SEQUENTIAL_ORDER = Object.freeze(['papers', 'guidelines', 'reviews']);

/**
 * 순차진행이 켜져 있을 때 **그 날짜에 도는 트랙**.
 *
 * ★ 상태를 저장하지 않는다. 달력 일수의 나머지로 정한다 — 저장하면 러너와 브라우저가
 *   같은 파일을 놓고 다투게 되고(러너는 브라우저 파일을 읽기만 한다는 불변식 위반),
 *   무엇보다 **예고 렌더가 미래 날짜의 담당 트랙을 계산할 수 없게 된다.**
 *   나머지 연산이면 렌더와 게이트가 같은 답을 낸다.
 */
export function sequentialTrackFor(dateStr) {
  const day = calendarDay(dateStr);
  if (day === null) return null;
  return SEQUENTIAL_ORDER[((day % SEQUENTIAL_ORDER.length) + SEQUENTIAL_ORDER.length) % SEQUENTIAL_ORDER.length];
}

/** 순차진행이 켜져 있을 때 이 트랙이 그 날 도는가. */
export function sequentialAllows(track, dateStr) {
  const owner = sequentialTrackFor(dateStr);
  return owner === null ? true : owner === track; // 날짜를 못 읽으면 막지 않는다(소프트)
}

/** 예고 렌더가 쓰는 표현. 게이트 숫자에서 파생시키므로 둘이 어긋날 수 없다. */
export function cadenceFor(track) {
  return intervalFor(track) <= 1 ? 'daily' : 'weekly';
}

/** 게이트가 쓰는 숫자. 모르는 트랙은 매일로 본다(막지 않는다 — 소프트). */
export function intervalFor(track) {
  const v = TRACK_INTERVAL_DAYS[track];
  return Number.isFinite(v) && v > 0 ? v : 1;
}
