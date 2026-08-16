import { emptyQueue, mergeQueueItems } from './trackQueue.js';

export const REVIEW_TRACK = 'reviews';
export const MAX_RECENCY_BONUS = 2;

export const REVIEW_AXES = {
  core4: 'review_core4',
  core4_plus_ccm: 'review_core4_plus_ccm',
  wide: 'review_wide',
};

export function publicationYear(paper) {
  const match = String(paper?.date ?? paper?.pubdate ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export function recencyBonus(paper, { currentYear = new Date().getUTCFullYear(), windowYears = 5 } = {}) {
  const year = publicationYear(paper);
  if (year == null || windowYears <= 1) return 0;
  const oldestYear = currentYear - windowYears;
  const position = Math.max(0, Math.min(windowYears, year - oldestYear));
  // 기본 점수(최대 10)에 최대 2만 더한다. 따라서 최신 논문의 최신성 몫도
  // 최종 12점 중 2점(16.7%)이라 20%를 넘지 않고, 주제·저널 판단이 계속 지배한다.
  return Math.round((MAX_RECENCY_BONUS * position / windowYears) * 100) / 100;
}

export function scoreReviewItems(papers = [], scorer, options = {}) {
  if (!Array.isArray(papers) || papers.length === 0) return [];
  const scoredByPmid = new Map(scorer.scorePapers(papers).map((score) => [String(score.pmid), score]));
  return papers.map((paper) => {
    const scoring = scoredByPmid.get(String(paper.pmid)) ?? {};
    const score = Math.round((Number(scoring.score ?? 0) + recencyBonus(paper, options)) * 100) / 100;
    return {
      pmid: String(paper.pmid),
      title: paper.title ?? '',
      journal: paper.journal ?? '',
      score,
      topic: scoring.primaryTopic ?? null,
      lowConfidence: scoring.gated === true || Number(scoring.relevanceScore ?? 0) <= 0,
    };
  }).sort((a, b) => Number(b.score) - Number(a.score)
    || String(a.pmid).localeCompare(String(b.pmid)));
}

const journalKey = (item) => String(item?.journal ?? '').trim().toLocaleLowerCase();

export function spreadJournals(items = [], maxConsecutive = 3) {
  const remaining = [...items];
  const result = [];
  let previous = null;
  let run = 0;
  while (remaining.length > 0) {
    let index = 0;
    if (run >= maxConsecutive) {
      index = remaining.findIndex((item) => journalKey(item) !== previous);
      // 후보 전체가 같은 저널이면 제약 충족은 불가능하다. 항목을 버리지 않고 원순서를 보존한다.
      if (index < 0) index = 0;
    }
    const [next] = remaining.splice(index, 1);
    const key = journalKey(next);
    run = key === previous ? run + 1 : 1;
    previous = key;
    result.push(next);
  }
  return result;
}

export function itemsForSet(census, setName) {
  const axis = REVIEW_AXES[setName];
  const items = axis ? census?.axes?.[axis]?.items : null;
  return Array.isArray(items) ? items : [];
}

export function buildReviewQueue({ state = emptyQueue(REVIEW_TRACK), papers = [], scorer,
  limit = 400, today, currentYear } = {}) {
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const candidates = scoreReviewItems(papers, scorer, { currentYear }).slice(0, safeLimit);
  const merged = mergeQueueItems(state, candidates, { today });
  return { ...merged, queue: spreadJournals(merged.queue) };
}
