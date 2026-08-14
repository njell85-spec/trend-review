/**
 * 주제 쿨다운 — 같은 주제가 며칠씩 연달아 나오지 않게 한다.
 *
 * PeterJ 확정 2026-08-14: "주제 쿨다운은 좋은거같아. 돌아가면서 나오게."
 *
 * ★ 왜 필요한가 (실측): 풀을 1년으로 넓힌 arm F 재생에서 **30일 중 26일이 심정지
 *   아니면 인공호흡이었다(87%)**. 관심주제는 10그룹인데 2그룹만 나왔고, Resuscitation
 *   한 저널이 12편이었다. 일간 top-1 은 풀 전체의 argmax 인데 `cardiac_resus` 주제군 +
 *   대표지(3.2) 조합이 거의 항상 이기고, **풀을 넓힐수록 그 조합이 더 쌓여 쏠림이 심해진다.**
 *
 * 설계 원칙 — 배제가 아니라 감점이다:
 *   · 어제 나온 주제라고 오늘 후보에서 빼면, 그날 정말 큰 논문이 그 주제일 때 놓친다.
 *     그래서 **점수를 깎기만 한다** — 충분히 큰 논문이면 감점을 이기고 그대로 나온다.
 *   · 감점은 최근일수록 크고 선형으로 사라진다(어제 = 최대, cooldownDays 째 = 0).
 *   · 주제가 없는 논문(primaryTopic null)은 건드리지 않는다.
 *
 * config: `interests.json` 의 `topicCooldown: { days, penalty }`. 숫자 둘이라 폰에서 고친다.
 *   days 0 이나 penalty 0 이면 **완전히 꺼진다**(기본 동작 보존용 스위치).
 */

export const DEFAULT_TOPIC_COOLDOWN = { days: 5, penalty: -2.0 };

/**
 * 최근 발행 이력에서 (주제 → 며칠 전) 표를 만든다. 같은 주제가 여러 번이면 가장 최근 것.
 * @param {Array<{topic: string|null, date: string}>} history  발행분 (날짜 문자열 YYYY-MM-DD)
 * @param {string} today
 */
export function recentTopicAges(history = [], today) {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const ages = new Map();
  for (const h of history) {
    if (!h?.topic || !h?.date) continue;
    const t = Date.parse(`${String(h.date).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(t) || t > t0) continue;
    const age = Math.round((t0 - t) / 86_400_000);
    const prev = ages.get(h.topic);
    if (prev == null || age < prev) ages.set(h.topic, age);
  }
  return ages;
}

/**
 * 주제별 감점. 어제(age 1) = penalty 전액, age >= days = 0.
 * age 0(오늘 이미 그 주제를 뽑음)도 전액으로 본다.
 */
export function cooldownPenalty(topic, ages, cfg = DEFAULT_TOPIC_COOLDOWN) {
  const days = Number(cfg?.days ?? 0);
  const penalty = Number(cfg?.penalty ?? 0);
  if (!topic || !(days > 0) || !penalty) return 0;
  const age = ages.get(topic);
  if (age == null || age >= days) return 0;
  // age 0·1 → 전액, days-1 → 1/days 만큼만. 선형 감쇠.
  const strength = (days - Math.max(1, age)) / (days - 1 || 1);
  return penalty * Math.max(0, Math.min(1, strength));
}

/**
 * 점수 목록에 쿨다운을 먹인다. **원본을 건드리지 않고** 새 배열을 돌려준다.
 * @param {Array<{pmid:string, rawScore:number, primaryTopic:string|null}>} scored
 * @returns {Array} rawScore 가 조정되고 `cooldown` 필드가 붙은 목록 (재정렬됨)
 */
export function applyTopicCooldown(scored, history, today, cfg = DEFAULT_TOPIC_COOLDOWN) {
  const ages = recentTopicAges(history, today);
  return scored
    .map((s) => {
      const pen = cooldownPenalty(s.primaryTopic, ages, cfg);
      return pen ? { ...s, rawScore: s.rawScore + pen, cooldown: pen } : { ...s, cooldown: 0 };
    })
    .sort((a, b) => (b.rawScore - a.rawScore) || String(a.pmid).localeCompare(String(b.pmid)));
}
