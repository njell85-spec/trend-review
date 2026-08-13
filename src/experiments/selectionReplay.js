import { MetadataScorer } from '../utils/MetadataScorer.js';
import { composeDualStreams } from '../agents/DataCollectorAgent.js';

export const REPLAY_WARNING = '이 실험은 arm 간 상대 우열만 말한다. PubMed 의 MeSH·publication type 은 나중에 붙으므로 과거 재생은 실제보다 유리하다.';

const SOFT_PATTERNS = [
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
      } else {
        candidates = asOf.filter((p) => {
          const sources = p.collectionSources ?? (p.streamSources?.includes('A') ? ['legacy'] : []) ?? [];
          return sources.includes('legacy');
        }).map((p) => ({ ...p, streamSource: 'legacy' }));
      }
      const scorer = scorerForArm(arm, cfg, { profile, journals, queryMeshExclusions: collection.queryMeshExclusions ?? [] });
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
      results[arm].days.push({ date: day, candidateCount: candidates.length,
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
  return md;
}
