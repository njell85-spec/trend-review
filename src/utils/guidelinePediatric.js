/**
 * 소아 전용 지침 배제 (PeterJ 확정 2026-08-17, 선택지 A-1).
 *
 * PeterJ 는 **성인** 응급의학·중환자의학 임상의다. 2년 풀을 캐면 소아 전용 지침이
 * 상당수 섞여 들어온다 — 실측(3개월 dry-run)에서 `queued` 에 이런 것들이 올라왔다:
 *   · Surviving Pediatric Cardiogenic Shock …
 *   · ACR Appropriateness Criteria® Gastrointestinal Bleeding-Child
 *   · An Update to the Classification … Childhood Interstitial Lung Disease in Infancy
 *   · Physical Activity in Pediatric Cardiomyopathies
 *   · [Cardiotoxicity in children and adolescents with acute leukemia …]
 *
 * ★ 왜 분류기가 아니라 **필터**인가
 *   분류기(`guidelineClassifier`)는 "이 문서가 지침인가" 를 판정한다. 소아 전용 지침은
 *   **훌륭한 지침이다** — 다만 이 독자의 것이 아니다. 그건 문서 성격이 아니라 정책이다.
 *   지역 필터(`filterByRegion`)와 같은 층에 두어 둘이 섞이지 않게 한다.
 *   정책이므로 `rejected`(영구 배제)로 남기지 않는다 — PeterJ 가 마음을 바꾸면
 *   다음 수집에서 그냥 다시 들어온다.
 *
 * ★ 가장 조심할 것: **소아를 포함하는 성인 종합 지침을 자르면 안 된다.**
 *   "American Heart Association 2025 Guidelines: Basic life support, advanced
 *    cardiovascular life support, pediatric advanced life support, and neonatal
 *    resuscitation." — 이것은 ACLS 를 담은 핵심 지침인데 제목에 pediatric·neonatal 이
 *   같이 들어 있다. 소아 낱말만 보고 자르면 이런 것이 통째로 사라진다.
 */

function normalized(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 소아 표지어. 제목에 이것이 있으면 소아 후보다. */
const PEDIATRIC = /\b(?:pediatric|paediatric|paediatrics|pediatrics|child|children|childhood|infant|infants|infancy|neonate|neonates|neonatal|newborn|newborns|adolescent|adolescents|preterm|premature infant|kawasaki|bronchiolitis)\b/;

/**
 * 성인 표지어 — 하나라도 있으면 **소아 전용이 아니다**(성인도 다루는 문서다).
 * ★ `adult` 만 보면 안 된다. 위 AHA 통합 지침에는 'adult' 라는 낱말이 없고
 *   'basic life support' · 'advanced cardiovascular life support' 로만 성인을 담는다.
 *   실측에서 확인한 성인 축 표현을 같이 넣는다.
 */
const ADULT = /\b(?:adult|adults|basic life support|advanced cardiovascular life support|acls|bls|adult patients|in adults)\b/;

/**
 * @returns {boolean} 소아 **전용** 이면 true. 성인을 같이 다루면 false.
 */
export function isPediatricOnly(candidate) {
  // 수동 승인은 PeterJ 의 최종 판단이다(확정 ⑤-A). 정책 필터가 뒤집지 않는다.
  if (candidate?.manualApproved === true) return false;
  const title = normalized(candidate?.title);
  if (!PEDIATRIC.test(title)) return false;
  return !ADULT.test(title);
}

/**
 * @returns {{kept: Array, dropped: Array}} — 배제한 것은 이유와 함께 돌려준다.
 *   조용히 사라지면 "왜 이 지침이 안 왔나" 를 나중에 못 묻는다(지역 필터와 같은 규칙).
 */
export function filterPediatric(candidates) {
  const kept = [];
  const dropped = [];
  for (const c of candidates ?? []) {
    if (isPediatricOnly(c)) dropped.push({ pmid: c?.pmid ?? null, title: c?.title ?? '', reason: '소아 전용' });
    else kept.push(c);
  }
  return { kept, dropped };
}
