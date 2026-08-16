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

/**
 * ★ 그 트랙이 그 날 도는가 — **게이트와 예고가 공유하는 단 하나의 판정.**
 *
 * 왜 함수 하나로 합쳤나 (2026-08-16 코드리뷰 발견 B2)
 *   배포 페이지에 트랙 on/off/격일 토글이 세 페이지에 다 붙어 있는데,
 *   **`mode` 를 읽는 게이트가 리뷰 하나뿐이었다.** PeterJ 가 "논문 · 꺼짐" 을 눌러도
 *   화면과 예고만 꺼진 것처럼 보이고 **다음 데일리는 논문을 그대로 발행했다.**
 *   화면과 실제가 다른 것은 이 저장소가 반복해서 낸 사고이므로, 판정을 한 곳에 두고
 *   양쪽이 같은 함수를 부르게 한다.
 *
 * ★ 상태를 안 쓴다. 날짜만으로 정한다 — 예고는 **미래 날짜**를 그려야 하는데
 *   `lastRun` 기반으로는 미래를 계산할 수 없다. 격일도 달력 패리티로 잡아야
 *   화면의 "모레 나갑니다" 가 실제와 맞는다.
 *   (같은 날 두 번 도는 것을 막는 것은 별개의 안전망이고 호출부가 따로 본다.)
 */
export function trackRunsOn(track, dateStr, { mode = 'on', sequential = false } = {}) {
  if (mode === 'off') return false;
  const day = calendarDay(dateStr);
  if (day === null) return true;                       // 날짜를 못 읽으면 막지 않는다(소프트)
  if (mode === 'alternate' && day % 2 !== 0) return false;
  if (sequential && !sequentialAllows(track, dateStr)) return false;
  return true;
}
