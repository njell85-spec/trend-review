/**
 * paperTypeFilter — **논문 트랙(트랙1)에 지침 문서가 섞여 들어오는 것**을 막는다.
 *
 * ★ 왜 생겼나 (PeterJ 실측 2026-08-18)
 *   그날 논문 트랙이 뽑아 발행한 것이 이것이었다:
 *     "Part 9: Adult Advanced Life Support: 2025 American Heart Association Guidelines
 *      for Cardiopulmonary Resuscitation and Emergency Cardiovascular Care"
 *      (Circulation · IF 35.5 · PMID 41122884)
 *   PeterJ: *"오늘 선정된 논문은 가이드라인인데 이게 맞나?"* — 맞지 않다.
 *   그날 가이드라인 트랙(트랙2)은 **따로** AHA/ASA 뇌졸중 지침을 발행했다.
 *   같은 날 화면 두 곳이 지침을 냈고, 한 곳은 "논문" 이라고 이름표를 달고 있었다.
 *
 * ★ 왜 안 걸러졌나 — 논문 수집 경로에 **출판유형 배제가 아예 없었다.**
 *   `collectGuidelines()` 에는 "PublicationType 에 guideline 이 있는 것만 유지" 라는
 *   안전장치가 있는데(`DataCollectorAgent`), 그 **반대편**이 없었다.
 *   지침은 저명 저널에 실리고 인용·주제 적합도가 높아 **점수가 잘 나온다** —
 *   즉 걸러지기는커녕 상위로 올라온다. 이번에 IF 35.5 Circulation 이 그랬다.
 *
 * ★ 판정 근거는 **NCBI 의 PublicationType 뿐이다.** 제목으로 때려잡지 않는다 —
 *   "guideline" 이 제목에 들어간 정당한 임상 연구가 많다(지침 준수도 연구, 지침
 *   비교 연구, 지침의 효과를 본 RCT). 제목 매칭은 그것들을 통째로 죽인다.
 *   PT 는 NLM 이 색인 단계에서 붙이는 권위 있는 라벨이라 오탐이 적다.
 *
 * ★ 트랙2(가이드라인)·트랙3(리뷰)에는 **걸지 않는다.** 이 필터는 트랙1 전용이다.
 */

/**
 * 논문 트랙에서 배제할 출판유형.
 *
 * · Guideline / Practice Guideline — 지침 그 자체. 트랙2 의 소관이다.
 * · Consensus Development Conference (+ NIH) — 합의문. 원저 연구가 아니다.
 *
 * ★ Review 는 **넣지 않는다.** 종설은 트랙3 소관이지만, 논문 트랙의 후보 풀에는
 *   메타분석·체계적 고찰이 Review PT 를 달고 들어오고 그것들은 원저 근거로서
 *   가치가 크다(실제로 이 저장소가 여러 번 발행했다). 여기서 Review 를 자르면
 *   **메타분석이 통째로 사라진다.** 종설이 논문 트랙에 뜨는 문제는 별건이다.
 */
export const EXCLUDED_PUBLICATION_TYPES = Object.freeze([
  'guideline',
  'practice guideline',
  'consensus development conference',
  'consensus development conference, nih',
]);

const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * 2차 안전장치 — **제목이 공식 지침의 정형(定型)일 때만** 걸린다.
 *
 * ★ 왜 필요한가: PT 는 NLM 색인 시점에 붙는다. 갓 나온 지침은 색인이 늦어
 *   `publicationTypes` 가 비거나 `Journal Article` 만 달고 들어오는 창이 있다.
 *   논문 트랙은 최신순으로 캐므로 **바로 그 창에 걸린 문서를 만난다.**
 *
 * ★ 그래서 좁게 짠다. 세 조건을 **모두** 만족해야 한다:
 *     ① 제목에 guideline(s) 또는 recommendations 가 있다
 *     ② 제목이 `2026 …` 처럼 **연도로 시작**하거나 `Part 9:` 처럼 편(篇)으로 시작한다
 *     ③ 발표 기관 이름이 제목에 있다
 *   지침을 **연구한** 논문(준수도·비교·효과 RCT)은 ②를 통과하지 못한다 —
 *   그것들을 죽이지 않는 것이 이 규칙의 존재 이유다.
 *   예: "Adherence to 2021 Surviving Sepsis Campaign guidelines in …" → 유지(연도로 시작 안 함)
 */
const TITLE_GUIDELINE_WORD = /\b(guidelines?|recommendations)\b/i;
const TITLE_CANONICAL_LEAD = /^\s*(?:\d{4}\b|part\s+\d+\s*:)/i;
const TITLE_ISSUER = new RegExp([
  'american heart association', 'american stroke association', 'american college',
  'american academy', 'american thoracic', 'american society',
  'european society', 'european resuscitation', 'european academy',
  'international liaison committee', 'surviving sepsis campaign',
  'society of critical care', 'infectious diseases society',
  'world health organization', 'task force', 'consensus statement',
].join('|'), 'i');

export function looksLikeCanonicalGuidelineTitle(title) {
  const t = String(title ?? '');
  return TITLE_GUIDELINE_WORD.test(t) && TITLE_CANONICAL_LEAD.test(t) && TITLE_ISSUER.test(t);
}

/**
 * 이 문서가 지침류인가.
 * 1순위는 **PublicationType**(NLM 이 붙인 권위 라벨 — 오탐이 적다).
 * 2순위는 위의 좁은 제목 정형(색인 지연 창을 덮는다).
 */
export function isGuidelineLikePublication(article) {
  const types = Array.isArray(article?.publicationTypes) ? article.publicationTypes : [];
  if (types.some((t) => EXCLUDED_PUBLICATION_TYPES.includes(norm(t)))) return true;
  return looksLikeCanonicalGuidelineTitle(article?.title);
}

/**
 * 논문 후보에서 지침류를 걷어낸다. 걷어낸 것을 함께 돌려준다(로그·통계용 —
 * 조용히 사라지면 "왜 후보가 줄었지" 를 다음 사람이 못 쫓는다).
 */
export function excludeGuidelineLike(articles) {
  const kept = [];
  const dropped = [];
  for (const a of articles ?? []) (isGuidelineLikePublication(a) ? dropped : kept).push(a);
  return { kept, dropped };
}
