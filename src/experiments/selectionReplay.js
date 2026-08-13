import { MetadataScorer } from '../utils/MetadataScorer.js';
import { composeDualStreams } from '../agents/DataCollectorAgent.js';

export const REPLAY_WARNING = '이 실험은 arm 간 상대 우열만 말한다. PubMed 의 MeSH·publication type 은 나중에 붙으므로 과거 재생은 실제보다 유리하다.';

export const SOFT_PATTERNS = [
  'nursing', 'nurse', ' nurs ', 'midwifery', 'nutrition', 'nutrients', 'dietet',
  'parenteral and enteral', 'rehabilitation', 'physical therapy', 'physiotherapy',
  'occupational therapy', 'medical education', 'education online', 'medical teacher',
  'health policy', 'health services research', 'health economics', 'informatics',
  'american journal of critical care', 'heart & lung', 'intensive and critical care nurs',
];
const HARD_PATTERNS = [
  'veterinary', 'dental', 'dentistry', 'oral health', 'acupuncture', 'herbal',
  'complementary', 'alternative medicine', 'ethics', 'nursing ethics',
];

export function isoDay(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{1,2})?/);
  if (!match) return null;
  return `${match[1]}-${String(match[2] ?? 1).padStart(2, '0')}-${String(match[3] ?? 1).padStart(2, '0')}`;
}

export function replayDates(start, end) {
  const out = [];
  for (let d = new Date(`${start}T00:00:00Z`), stop = new Date(`${end}T00:00:00Z`); d <= stop; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function candidatesAsOf(papers, day) {
  return papers.filter((p) => {
    const edat = isoDay(p.edat ?? p.pubDate);
    return edat != null && edat <= day;
  });
}

/**
 * 월별 풀 (arm E · PeterJ 2026-08-14) — 재생일 기준으로 후보를 30일씩 12구간에 넣고,
 * 구간마다 스코어러 상위 keepPerMonth 편만 남겨 합친다.
 *
 * 구간 귀속은 `pdat`(발행일) 축이어야 한다. 재생 코퍼스의 `paper.pubDate` 는 파서가
 * History[pubmed] 를 우선해 사실상 EDAT 이지만(2026-08-13 확인), 재생은 그 값 하나만
 * 갖고 있으므로 여기서는 그대로 쓴다 — **이 실험이 말하는 것은 풀 구조의 효과이지
 * 날짜축 교체의 효과가 아니다.**
 */
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
  // ★ 배제를 top-K **앞**에 건다. 뒤에 걸면 배제 저널이 월 10슬롯을 차지한 뒤 사라져
  //   그 달 기여가 10편 미만으로 줄고, 밀려난 정상 임상지는 보충되지 않는다.
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

/**
 * LLM rerank 프롬프트의 실제 크기 — `FilterAnalyzerAgent._rerankSelect` 와 **같은 서식**으로
 * 만들어 글자수를 잰다. 토큰 비교의 근거를 추정이 아니라 실물 문자열에 둔다
 * (초록 1200자 컷까지 동일). 여기서 만든 문자열은 버리고 길이만 쓴다.
 */
export function rerankPromptChars(pool) {
  const body = pool.map((p, i) => `[${i + 1}] PMID ${p.pmid} | ${p.journal} | types: ${(p.publicationTypes || []).join(', ') || 'NR'}
Title: ${p.title}
Abstract: ${String(p.abstract ?? '').slice(0, 1200)}`).join('\n\n');
  const header = `You are an expert emergency medicine and critical care (EM/CCM) physician choosing the single most valuable paper for TODAY's bedside practice.
Score each of the following ${pool.length} papers 1-10 for CLINICAL BEDSIDE VALUE to an acute/critical-care physician:
10 = directly changes acute bedside management of a critically ill or emergency patient (diagnosis, drug, procedure, resuscitation target).
Downgrade papers that do NOT change bedside decisions even if on-topic: epidemiology/registry/health-services, interhospital transfer, readmission/remote monitoring, quality-improvement, narrative reviews, case reports, protocols.
Return one entry per paper via the submit_paper_scores tool.

Papers:
`;
  return header.length + body.length;
}

export function classifyTieredJournal(paper, journals = {}) {
  const name = String(paper?.journal ?? '').toLowerCase();
  if ((journals.exclude?.allow ?? []).some((p) => name.includes(String(p).toLowerCase()))) return 'allow';
  if (HARD_PATTERNS.some((p) => name.includes(p))) return 'hard';
  if (SOFT_PATTERNS.some((p) => name.includes(p))) return 'soft';
  return 'allow';
}

export function applyArmExclusions(papers, arm, scorer, journals) {
  if (arm !== 'D') {
    const kept = papers.filter((p) => !scorer.isExcludedJournal(p));
    const fallbackTriggered = papers.length > 0 && kept.length < 1;
    return { papers: fallbackTriggered ? papers : kept, excludedCount: papers.length - kept.length,
      softRestoredCount: 0, fallbackTriggered };
  }
  const allow = [], soft = [];
  let hard = 0;
  for (const paper of papers) {
    const tier = classifyTieredJournal(paper, journals);
    if (tier === 'hard') hard++;
    else if (tier === 'soft') soft.push({ ...paper, exclusionTier: 'soft' });
    else allow.push({ ...paper, exclusionTier: 'allow' });
  }
  const restore = allow.length < 1;
  return { papers: restore ? soft : allow, excludedCount: hard + (restore ? 0 : soft.length),
    softRestoredCount: restore ? soft.length : 0, fallbackTriggered: restore && soft.length > 0 };
}

function scorerForArm(arm, armConfig, { profile, journals, queryMeshExclusions }) {
  const scoring = { ...(armConfig.scoring ?? {}) };
  const injectedJournals = structuredClone(journals);
  if (arm === 'D') {
    injectedJournals.exclude = injectedJournals.exclude ?? {};
    injectedJournals.exclude.allow = [...new Set([...(injectedJournals.exclude.allow ?? []), ...SOFT_PATTERNS])];
  }
  return new MetadataScorer({ profile, journals: injectedJournals, queryMeshExclusions, scoring });
}

export function runReplay({ corpus, arms, armDefinitions, profile, journals, collection, start, end }) {
  const results = Object.fromEntries(arms.map((arm) => [arm, { selectedPmids: [], days: [] }]));
  for (const day of replayDates(start, end)) {
    for (const arm of arms) {
      const cfg = armDefinitions[arm];
      const seen = new Set(results[arm].selectedPmids);
      const asOf = candidatesAsOf(corpus, day).filter((p) => !seen.has(String(p.pmid)));
      let candidates;
      if (cfg.collection === 'dual') {
        const streamA = asOf.filter((p) => (p.collectionSources ?? p.streamSources ?? [p.streamSource]).includes('A'));
        const streamB = asOf.filter((p) => (p.collectionSources ?? p.streamSources ?? [p.streamSource]).includes('B'));
        candidates = composeDualStreams(streamA, streamB, { maxPapers: collection.maxPapers ?? 300, minB: 80 });
      } else if (cfg.collection === 'monthly12') {
        // 월별 스크리닝 코퍼스(source 'M'). 없으면 코퍼스가 arm E 없이 만들어진 것이다.
        candidates = asOf.filter((p) => (p.collectionSources ?? []).includes('M'))
          .map((p) => ({ ...p, streamSource: 'M' }));
      } else {
        candidates = asOf.filter((p) => {
          const sources = p.collectionSources ?? (p.streamSources?.includes('A') ? ['legacy'] : []) ?? [];
          return sources.includes('legacy');
        }).map((p) => ({ ...p, streamSource: 'legacy' }));
      }
      const scorer = scorerForArm(arm, cfg, { profile, journals, queryMeshExclusions: collection.queryMeshExclusions ?? [] });
      // arm E: 월별 버킷에서 구간마다 top-K 만 남겨 후보를 좁힌다(스코어링 단계).
      let monthlyPerMonth = null;
      if (cfg.collection === 'monthly12') {
        const sel = selectMonthlyPool(candidates, day, scorer, cfg.monthly ?? {});
        monthlyPerMonth = sel.perMonth;
        candidates = sel.pool;
      }
      const exclusion = applyArmExclusions(candidates, arm, scorer, journals);
      const allScored = scorer.scorePapers(candidates).map((score) => {
        const paper = candidates.find((p) => String(p.pmid) === String(score.pmid));
        const tier = arm === 'D' ? classifyTieredJournal(paper, journals) : (scorer.isExcludedJournal(paper) ? 'hard' : 'allow');
        if (arm === 'D' && tier === 'soft') {
          score.rawScore += Number(cfg.exclusions?.softPenalty ?? -1);
          score.contributions.softExclusion = Number(cfg.exclusions?.softPenalty ?? -1);
          score.score = Math.max(1, Math.min(10, Math.round(score.rawScore * 10) / 10));
        }
        return { ...paper, exclusionTier: tier, scoringData: score };
      });
      const scoreMap = new Map(allScored.map((p) => [String(p.pmid), p]));
      const scored = exclusion.papers.map((p) => scoreMap.get(String(p.pmid)))
        .filter(Boolean)
        .sort((a, b) => (b.scoringData.rawScore - a.scoringData.rawScore) || String(a.pmid).localeCompare(String(b.pmid)));
      const pick = scored[0] ?? null;
      if (pick) results[arm].selectedPmids.push(String(pick.pmid));
      const dates = candidates.map((p) => isoDay(p.edat ?? p.pubDate)).filter(Boolean).sort();
      // ── 토큰 비교 근거 — 실제 rerank 프롬프트를 만들어 글자수를 잰다 ──────────
      // 현행(A)은 데일리에서 RERANK_POOL=20, arm E 는 PeterJ 안대로 120 이다.
      const rerankPoolSize = Number(cfg.rerankPool ?? 0);
      const rerankPool = rerankPoolSize > 0 ? scored.slice(0, rerankPoolSize) : [];
      const promptChars = rerankPool.length > 1 ? rerankPromptChars(rerankPool) : 0;

      results[arm].days.push({ date: day, candidateCount: candidates.length,
        monthlyPerMonth, rerankPoolSize: rerankPool.length, rerankPromptChars: promptChars,
        excludedCount: exclusion.excludedCount, softRestoredCount: exclusion.softRestoredCount,
        fallbackTriggered: exclusion.fallbackTriggered, oldestPubDate: dates[0] ?? null,
        newestPubDate: dates.at(-1) ?? null,
        ranked: allScored.sort((a, b) => (b.scoringData.rawScore - a.scoringData.rawScore) || String(a.pmid).localeCompare(String(b.pmid))).map((p) => ({ pmid: String(p.pmid), title: p.title, journal: p.journal,
          pubDate: p.pubDate, pubDateSource: p.pubDateSource, streamSource: p.streamSource,
          exclusionTier: p.exclusionTier, eligibleAfterExclusion: scored.some((x) => String(x.pmid) === String(p.pmid)),
          score: p.scoringData.score, rawScore: p.scoringData.rawScore,
          titleHits: p.scoringData.titleHits, metaHitsBefore: p.scoringData.metaHitsBefore,
          metaHitsAfter: p.scoringData.metaHitsAfter, rel01: p.scoringData.rel01,
          primaryTopic: p.scoringData.primaryTopic, contributions: p.scoringData.contributions })),
        selected: pick ? { pmid: String(pick.pmid), title: pick.title, journal: pick.journal,
          pubDate: pick.pubDate, pubDateSource: pick.pubDateSource, streamSource: pick.streamSource,
          ...pick.scoringData } : null });
    }
  }
  return { warning: REPLAY_WARNING, start, end, arms: results };
}

/**
 * arm 간 발산 진단 — "arm 주입이 스코어러까지 닿는가" 와 "효과가 top-1 을 뒤집는가" 를 가른다.
 *
 * 2026-08-13 재생(run 31712702785)에서 A·C·D 가 30일 내내 같은 논문을 골랐다. 그때
 * 결과 표만으로는 ⓐ배선이 죽어 점수가 아예 같은 것인지 ⓑ점수는 갈렸는데 top-1 을
 * 못 뒤집은 것인지 구분할 수 없었다. 이 표가 그 구분을 강제한다:
 *   - scoreDiffDays = 0  →  ⓐ 배선 문제(주입이 스코어러에 안 닿는다)
 *   - scoreDiffDays > 0 이고 pickDiffDays = 0  →  ⓑ 효과 크기 문제
 */
export function armDivergence(result, baseline = 'A') {
  const arms = Object.keys(result.arms);
  if (!arms.includes(baseline)) return [];
  const base = result.arms[baseline];
  return arms.filter((a) => a !== baseline).map((arm) => {
    const other = result.arms[arm];
    let scoreDiffDays = 0, pickDiffDays = 0, maxAbsDelta = 0, comparedPmids = 0, poolDiffDays = 0;
    for (const dayB of base.days) {
      const dayX = other.days.find((d) => d.date === dayB.date);
      if (!dayX) continue;
      const mapB = new Map(dayB.ranked.map((r) => [String(r.pmid), r.rawScore]));
      let dayDiff = false;
      for (const r of dayX.ranked) {
        const b = mapB.get(String(r.pmid));
        if (b === undefined) continue;
        comparedPmids++;
        const delta = Math.abs(r.rawScore - b);
        if (delta > 1e-9) { dayDiff = true; maxAbsDelta = Math.max(maxAbsDelta, delta); }
      }
      if (dayDiff) scoreDiffDays++;
      // 후보 "수"만 보면 크기가 같고 내용이 다른 두 풀을 같다고 오판한다 — 집합으로 본다.
      const setB = new Set(dayB.ranked.map((r) => String(r.pmid)));
      const setX = new Set(dayX.ranked.map((r) => String(r.pmid)));
      const sameSet = setB.size === setX.size && [...setB].every((id) => setX.has(id));
      if (!sameSet) poolDiffDays++;
      if ((dayB.selected?.pmid ?? null) !== (dayX.selected?.pmid ?? null)) pickDiffDays++;
    }
    const verdict = scoreDiffDays === 0 && poolDiffDays === 0
      ? 'ⓐ 주입이 점수·후보 어디에도 안 닿음 (배선/설정 확인)'
      : pickDiffDays === 0
        ? 'ⓑ 점수는 갈렸으나 top-1 을 못 뒤집음 (효과 크기)'
        : '갈림';
    return { arm, baseline, scoreDiffDays, poolDiffDays, pickDiffDays,
      maxAbsDelta: Math.round(maxAbsDelta * 1000) / 1000, comparedPmids, verdict };
  });
}

export function renderArmDivergence(result, baseline = 'A') {
  const rows = armDivergence(result, baseline);
  if (!rows.length) return '';
  let md = `\n## arm 발산 진단 (기준 ${baseline})\n\n`;
  md += `| arm | 점수가 달랐던 날 | 후보수가 달랐던 날 | 선정이 달랐던 날 | 최대 rawScore 차 | 판정 |\n`;
  md += `|---|---:|---:|---:|---:|---|\n`;
  for (const r of rows) {
    md += `| ${r.arm} | ${r.scoreDiffDays} | ${r.poolDiffDays} | ${r.pickDiffDays} | ${r.maxAbsDelta} | ${r.verdict} |\n`;
  }
  return md;
}

/**
 * 풀 구조 비교 — 현행(A) vs PeterJ 안(E). 선정 결과와 **토큰 비용**을 같이 낸다.
 * 토큰은 실제 rerank 프롬프트 글자수에 측정된 chars/token 비를 곱해 낸다(추정 아님).
 */
export function renderPoolComparison(result, { charsPerToken = null } = {}) {
  const arms = Object.keys(result.arms);
  if (!arms.includes('A') || !arms.includes('E')) return '';
  const sum = (a, f) => result.arms[a].days.reduce((n, d) => n + (f(d) ?? 0), 0);
  const picks = (a) => new Set(result.arms[a].selectedPmids);
  // ★ 두 지표는 다르다. 종전엔 고유 PMID 교집합을 "같은 날"이라고 적어 오보했다 —
  //   서로 다른 날 같은 논문을 골라도 1로 세고, 반복 선정이 있으면 반대로 과소계상한다.
  const sameDayPicks = result.arms.A.days.filter((d) => {
    const e = result.arms.E.days.find((x) => x.date === d.date);
    return (d.selected?.pmid ?? null) !== null && (d.selected?.pmid ?? null) === (e?.selected?.pmid ?? null);
  }).length;
  const pmidOverlap = [...picks('A')].filter((x) => picks('E').has(x)).length;

  let md = `\n## 풀 구조 비교 — 현행 A vs PeterJ 안 E\n\n`;
  md += `| 항목 | A (180일·단일 300 → top20 → LLM) | E (365일·12×100 → 월top10 → 120 → LLM) |\n|---|---:|---:|\n`;
  md += `| 발행한 날 | ${result.arms.A.days.filter((d) => d.selected).length} | ${result.arms.E.days.filter((d) => d.selected).length} |\n`;
  md += `| 고유 선정 PMID | ${picks('A').size} | ${picks('E').size} |\n`;
  md += `| 일평균 후보(스코어링 대상) | ${(sum('A', (d) => d.candidateCount) / result.arms.A.days.length).toFixed(0)} | ${(sum('E', (d) => d.candidateCount) / result.arms.E.days.length).toFixed(0)} |\n`;
  md += `| 일평균 LLM 풀 | ${(sum('A', (d) => d.rerankPoolSize) / result.arms.A.days.length).toFixed(1)} | ${(sum('E', (d) => d.rerankPoolSize) / result.arms.E.days.length).toFixed(1)} |\n`;
  md += `| 30일 rerank 프롬프트 총 글자 | ${sum('A', (d) => d.rerankPromptChars).toLocaleString()} | ${sum('E', (d) => d.rerankPromptChars).toLocaleString()} |\n`;
  if (charsPerToken) {
    const tokA = Math.round(sum('A', (d) => d.rerankPromptChars) / charsPerToken);
    const tokE = Math.round(sum('E', (d) => d.rerankPromptChars) / charsPerToken);
    md += `| **30일 rerank 입력 토큰** (실측 ${charsPerToken.toFixed(2)} chars/token) | **${tokA.toLocaleString()}** | **${tokE.toLocaleString()}** |\n`;
    md += `| 배수 | 1.00× | ${(tokE / Math.max(1, tokA)).toFixed(2)}× |\n`;
  }
  if (result.tokenCalibration?.length) {
    md += `\n### 토큰 실측 캘리브레이션 (프로덕션과 같은 경로로 실제 호출)\n\n`;
    md += `| arm | 날짜 | 풀 | 프롬프트 글자 | 입력 토큰 | 출력 토큰 | 출력상한 | chars/token | 결과 |\n`;
    md += `|---|---|---:|---:|---:|---:|---:|---:|---|\n`;
    for (const c of result.tokenCalibration) {
      md += `| ${c.arm} | ${c.date} | ${c.poolSize} | ${c.promptChars.toLocaleString()} | ${c.inputTokens.toLocaleString()} | ${c.outputTokens.toLocaleString()} | ${(c.maxTokens ?? 0).toLocaleString()} | ${c.charsPerToken ?? '—'} | ${c.reason ?? (c.llmCalled ? 'O' : 'X')} |\n`;
    }
    md += `\n> 이 두 줄만 실제 호출이다. 30일 총량은 **일자별 실제 프롬프트 글자수 합 × 위 비율**로 냈다.\n`;
    md += `> 선정 논문 1편을 분석하는 LLM 비용은 두 안이 동일하므로(둘 다 1편) 비교에서 상쇄된다.\n`;
  }
  md += `\n**같은 날 같은 논문을 고른 날: ${sameDayPicks} / ${result.arms.A.days.length}**`;
  md += ` · 날짜 무관 고유 PMID 교집합: ${pmidOverlap}편 (다른 지표다)\n`;

  md += `\n### 선정 논문이 갈린 날\n\n| 날짜 | A | E |\n|---|---|---|\n`;
  let diff = 0;
  for (const d of result.arms.A.days) {
    const e = result.arms.E.days.find((x) => x.date === d.date);
    const a1 = d.selected, e1 = e?.selected;
    if ((a1?.pmid ?? null) === (e1?.pmid ?? null)) continue;
    diff++;
    if (diff <= 30) {
      md += `| ${d.date} | ${a1 ? `${a1.pmid} · ${String(a1.journal).slice(0, 28)}` : '—'} | ${e1 ? `${e1.pmid} · ${String(e1.journal).slice(0, 28)}` : '—'} |\n`;
    }
  }
  if (!diff) md += `| (없음) | | |\n`;

  // 월별 스크리닝이 실제로 채워졌는지 — 빈 달이 있으면 "12구간 균등"이 성립 안 한 것이다
  const last = result.arms.E.days.at(-1);
  if (last?.monthlyPerMonth) {
    md += `\n### E 의 월별 채움 (마지막 날 ${last.date} 기준)\n\n| 달 | 스크리닝된 편수 | 남긴 편수 |\n|---|---:|---:|\n`;
    for (const m of last.monthlyPerMonth) md += `| M${m.month} (${m.month * 30}~${(m.month + 1) * 30}일 전) | ${m.screened} | ${m.kept} |\n`;
    const empty = last.monthlyPerMonth.filter((m) => m.kept === 0).length;
    md += `\n> 빈 달 ${empty}개. **빈 달이 있으면 "12구간 균등"이 이름뿐이다** — 그 달은 풀에 기여하지 않는다.\n`;
  }
  return md;
}

export function renderReplaySummary(result) {
  const arms = Object.keys(result.arms);
  let md = `> ⚠️ ${REPLAY_WARNING}\n\n# 30일 선정 재생 ${result.start} ~ ${result.end}\n\n`;
  md += `| 날짜 | ${arms.join(' | ')} |\n|---|${arms.map(() => '---').join('|')}|\n`;
  for (const day of replayDates(result.start, result.end)) {
    md += `| ${day} | ${arms.map((a) => result.arms[a].days.find((d) => d.date === day)?.selected?.pmid ?? '—').join(' | ')} |\n`;
  }
  md += `\n| arm | 선정 | 고유 PMID | 배제 | soft 복원 | 폴백 |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const arm of arms) {
    const days = result.arms[arm].days;
    md += `| ${arm} | ${days.filter((d) => d.selected).length} | ${new Set(result.arms[arm].selectedPmids).size} | ${days.reduce((n, d) => n + d.excludedCount, 0)} | ${days.reduce((n, d) => n + d.softRestoredCount, 0)} | ${days.filter((d) => d.fallbackTriggered).length} |\n`;
  }
  md += renderArmDivergence(result);
  md += renderPoolComparison(result, { charsPerToken: result.charsPerToken ?? null });
  return md;
}
