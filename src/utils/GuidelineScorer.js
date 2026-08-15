import { matchOrganization } from './guidelineOrgs.js';

function text(value) {
  return (Array.isArray(value) ? value.join(' ') : String(value ?? ''))
    .normalize('NFKC').toLocaleLowerCase('en-US');
}

function consumeTerms(value, terms) {
  let remaining = ` ${text(value)} `;
  let matched = false;
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const needle = text(term).trim();
    if (!needle || !remaining.includes(needle)) continue;
    matched = true;
    remaining = remaining.split(needle).join(' ');
  }
  return matched;
}

function topicScore(candidate, interests) {
  let score = 0;
  for (const group of Object.values(interests?.topicGroups ?? {})) {
    const weight = Number(group.weight) || 0;
    const terms = Array.isArray(group.terms) ? group.terms : [];
    if (consumeTerms(candidate.title, terms)) score += 2 * weight;
    if (consumeTerms(candidate.abstract, terms)) score += 1 * weight;
    if (consumeTerms(candidate.meshTerms ?? candidate.mesh ?? candidate.keywords, terms)) score += 1 * weight;
  }
  return Math.min(4, score);
}

function recencyScore(pubDate, now = new Date()) {
  if (!pubDate) return 0;
  const published = new Date(pubDate);
  if (Number.isNaN(published.getTime())) return 0;
  const months = Math.max(0, (now.getTime() - published.getTime()) / (365.2425 / 12 * 86400000));
  if (months <= 6) return 2;
  if (months >= 24) return 0;
  return 2 * (24 - months) / 18;
}

function confidenceScore(candidate) {
  const discovered = (candidate.discoveredBy ?? []).map(text);
  const signals = candidate.signals ?? {};
  let score = 0;
  if (discovered.some((v) => ['pubmed-pt', 'pubmed-guideline-pt'].includes(v))
      || signals.pubmedPt || signals.guidelinePublicationType) score += 2;
  if (discovered.some((v) => v.startsWith('org:'))
      || signals.approvedOrganization || signals.approvedOrgPath) score += 2;
  if (discovered.some((v) => ['pubmed-title', 'expanded-title'].includes(v))
      || signals.expandedTitle) score += 1;
  if (signals.normativeContent || signals.explicitRecommendation) score += 1;
  return Math.min(2, score);
}

function scopeScore(candidate, policy) {
  const adjustments = policy?.scopeAdjustments ?? {};
  let score = Number(adjustments.default) || 0;
  const tags = new Set([...(candidate.scope ?? []), ...(candidate.scopeTags ?? [])]);
  for (const [key, adjustment] of Object.entries(adjustments)) {
    if (key !== 'default' && (tags.has(key) || candidate.signals?.[key] === true)) score += Number(adjustment) || 0;
  }
  return score;
}

export function scoreGuideline(candidate, { orgs, interests }) {
  const match = matchOrganization(candidate, orgs);
  const organization = match && orgs.organizations.find((org) => org.id === match.organizationId);
  const authority = organization?.authorityScore ?? 0;
  const topic = topicScore(candidate, interests);
  const recency = recencyScore(candidate.pubDate);
  const scope = scopeScore(candidate, orgs.policy);
  const confidence = confidenceScore(candidate);
  const policy = orgs.policy;
  const priority = policy.authorityWeight * authority
    + policy.topicWeight * topic
    + policy.recencyWeight * recency
    + scope + confidence;
  return {
    priority,
    breakdown: { authority, topic, recency, scope, confidence },
    organizationId: match?.organizationId ?? null,
    // ★ tier·topicMatched 를 여기서 같이 내보내는 이유: `suggestStatus` 가 이 둘을
    //   호출자에게서만 받으면, 호출자가 빠뜨렸을 때 "주제 무매칭 tier-1 은 needsReview
    //   보존"(PeterJ 확정 ②-C)이 **아무 신호 없이** 안 걸리고 임계값 분기로 새어 나간다.
    //   이 저장소가 반복해서 당한 실패 모양이다(F1 재순위·주제 쿨다운). 길목에서 계산한다.
    tier: organization?.tier ?? null,
    topicMatched: topic > 0,
  };
}

export function suggestStatus(scored, { policy, topicMatched, tier } = {}) {
  const matched = topicMatched ?? scored.topicMatched;
  const orgTier = tier ?? scored.tier;
  if (!matched && Number(orgTier) === 1) {
    return { queue: 'queued', needsReview: 'needsReview', reject: 'rejected' }[policy.unmatchedTier1Policy];
  }
  if (scored.priority >= policy.autoPublishThreshold) return 'queued';
  if (scored.priority >= policy.reviewThreshold) return 'needsReview';
  return 'rejected';
}
