import { emptyQueue, mergeQueueItems } from './trackQueue.js';

export const REVIEW_TRACK = 'reviews';
export const MAX_RECENCY_BONUS = 2;

export const REVIEW_AXES = {
  core4: 'review_core4',
  core4_plus_ccm: 'review_core4_plus_ccm',
  wide: 'review_wide',
};

/**
 * 리뷰 아티클이 맞는가 — **합의문·지침류를 걷어낸다.**
 *
 * ★ 2026-08-17 실측 (PeterJ 지적) — 첫 발행분이
 *   "A consensus of international experts on ... obtained by the Delphi method: the
 *   SAVECMO study" 였다. PubMed 의 `Review[Publication Type]` 은 **합의문·Delphi 연구·
 *   지침 성격 문서까지 포함**한다. 종전 쿼리는 SR·메타만 뺐다.
 *   트랙3의 목적은 "복습용 종설"(NEJM Clinical Practice 같은 것)이므로 성격이 다르다.
 *   지침류는 트랙2가 따로 다룬다 — 여기 섞이면 같은 것을 두 트랙이 다룬다.
 *
 * 제목으로만 판정한다. 초록·MeSH 는 저수지 항목에 없고(제목·저널·점수만 들고 온다),
 * 제목이 문서 성격을 가장 잘 드러내는 축이기도 하다.
 */
const NOT_REVIEW_PATTERNS = [
  /\bconsensus\b/i,
  /\bdelphi\b/i,
  /\bguidelines?\b/i,
  /\brecommendations?\b/i,
  /\bposition (statement|paper)\b/i,
  /\bexpert statement\b/i,
  /\bpractice parameter\b/i,
  // ★ `standard of care` 는 **넣지 않는다.** 실측에서 "Current standard of care for
  //   septic shock", "TBI management: standard of care and knowledge gaps" 같은
  //   **진짜 종설**이 걸렸다. 문서 성격이 아니라 주제를 가리키는 말이다.
  /\bappropriate use criteria\b/i,
  /\bsystematic review\b/i,
  /\bmeta-?analysis\b/i,
  /\bscoping review\b/i,
  /\bumbrella review\b/i,
];

export function isNarrativeReview(item) {
  const title = String(item?.title ?? item?.paper?.title ?? '').trim();
  if (!title) return false;
  return !NOT_REVIEW_PATTERNS.some((re) => re.test(title));
}

/** 걸러낸 이유(로그·장부용). 통과하면 null. */
export function notReviewReason(item) {
  const title = String(item?.title ?? item?.paper?.title ?? '').trim();
  if (!title) return 'no-title';
  const hit = NOT_REVIEW_PATTERNS.find((re) => re.test(title));
  return hit ? `not-narrative-review:${hit.source.replace(/\\b/g, '')}` : null;
}

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
  // ★ 합의문·지침류는 저수지에 넣지 않는다(위 isNarrativeReview 주석 참조).
  //   여기서 한 번, 발행 직전에 한 번 더 본다 — 이미 쌓인 저수지에는 섞여 있기 때문이다.
  papers = (papers ?? []).filter(isNarrativeReview);
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const candidates = scoreReviewItems(papers, scorer, { currentYear }).slice(0, safeLimit);
  const merged = mergeQueueItems(state, candidates, { today });
  return { ...merged, queue: spreadJournals(merged.queue) };
}
