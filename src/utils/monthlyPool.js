export function isoDay(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{1,2})?/);
  if (!match) return null;
  return `${match[1]}-${String(match[2] ?? 1).padStart(2, '0')}-${String(match[3] ?? 1).padStart(2, '0')}`;
}

export function monthlyBuckets(candidates, day, { months = 12, monthDays = 30 } = {}) {
  const dayMs = new Date(`${day}T00:00:00Z`).getTime();
  const buckets = Array.from({ length: months }, () => []);
  for (const p of candidates) {
    const iso = isoDay(p.pubDate ?? p.edat);
    if (!iso) continue;
    const ageDays = Math.floor((dayMs - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
    if (ageDays < 0) continue;
    const idx = Math.floor(ageDays / monthDays);
    if (idx >= 0 && idx < months) buckets[idx].push(p);
  }
  return buckets;
}

export function selectMonthlyPool(candidates, day, scorer, cfg = {}) {
  const { months = 12, monthDays = 30, keepPerMonth = 10 } = cfg;
  // 배제 저널은 top-K 전에 제거해야 슬롯을 차지하지 않는다.
  const eligible = candidates.filter((p) => !scorer.isExcludedJournal(p));
  const buckets = monthlyBuckets(eligible, day, { months, monthDays });
  const pool = [];
  const perMonth = [];
  for (let m = 0; m < buckets.length; m++) {
    const scored = scorer.scorePapers(buckets[m])
      .sort((a, b) => (b.rawScore - a.rawScore) || String(a.pmid).localeCompare(String(b.pmid)));
    const keep = scored.slice(0, keepPerMonth).map((sc) =>
      buckets[m].find((p) => String(p.pmid) === String(sc.pmid)));
    perMonth.push({ month: m, screened: buckets[m].length, kept: keep.length });
    pool.push(...keep.filter(Boolean));
  }
  return { pool, perMonth };
}
