import { readFileSync } from 'node:fs';

const DEFAULT_CONFIG = new URL('../../config/guideline-orgs.json', import.meta.url);
const SOURCE_TYPES = new Set(['rss', 'listing-html', 'sitemap', 'api-json', 'manual-seed']);
const TIER1_POLICIES = new Set(['needsReview', 'queue', 'reject']);

function fail(message) {
  throw new Error(`가이드라인 기관 설정 오류: ${message}`);
}

export function validateGuidelineOrgs(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) fail('설정은 객체여야 합니다.');
  if (cfg.schemaVersion !== 1) fail('schemaVersion은 1이어야 합니다.');
  if (!cfg.policy || typeof cfg.policy !== 'object') fail('policy가 필요합니다.');
  if (!TIER1_POLICIES.has(cfg.policy.unmatchedTier1Policy)) {
    fail('policy.unmatchedTier1Policy는 needsReview, queue, reject 중 하나여야 합니다.');
  }
  if (!Array.isArray(cfg.organizations)) fail('organizations는 배열이어야 합니다.');

  const organizationIds = new Set();
  const sourceIds = new Set();
  for (const org of cfg.organizations) {
    if (!org?.id || organizationIds.has(org.id)) fail(`중복 organization id: ${org?.id ?? '(없음)'}`);
    organizationIds.add(org.id);
    if (![1, 2].includes(org.tier)) fail(`${org.id}의 tier는 1 또는 2여야 합니다.`);
    if (!Number.isFinite(org.authorityScore)) fail(`${org.id}의 authorityScore는 숫자여야 합니다.`);
    if (!Array.isArray(org.sources)) fail(`${org.id}의 sources는 배열이어야 합니다.`);
    for (const source of org.sources) {
      if (!source?.id || sourceIds.has(source.id)) fail(`중복 source id: ${source?.id ?? '(없음)'}`);
      sourceIds.add(source.id);
      if (!SOURCE_TYPES.has(source.type)) fail(`${source.id}의 알 수 없는 adapter(type): ${source.type}`);
      // manual-seed 는 "자동 수집이 불가능한 기관"을 명시적으로 관찰 제외로 표시하는 항목이라
      // 가져올 URL 자체가 없을 수 있다(계획서 §4.2). URL 을 적었으면 그것은 검사한다.
      if (source.type === 'manual-seed' && source.url == null) continue;
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        fail(`${source.id}의 url은 유효한 http(s) URL이어야 합니다: ${source.url ?? '(없음)'}`);
      }
    }
  }

  const tier1 = cfg.organizations.filter((org) => org.tier === 1).map((org) => org.authorityScore);
  const tier2 = cfg.organizations.filter((org) => org.tier === 2).map((org) => org.authorityScore);
  if (tier1.length && tier2.length && Math.min(...tier1) < Math.max(...tier2)) {
    fail(`tier와 authorityScore의 단조성이 깨졌습니다(tier-1 최소 ${Math.min(...tier1)}, tier-2 최대 ${Math.max(...tier2)}).`);
  }
  return cfg;
}

export function loadGuidelineOrgs(pathOrObject = DEFAULT_CONFIG) {
  const raw = typeof pathOrObject === 'object' && !(pathOrObject instanceof URL)
    ? pathOrObject
    : JSON.parse(readFileSync(pathOrObject, 'utf8'));
  validateGuidelineOrgs(raw);
  return structuredClone(raw);
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
}

function includesMatcher(haystack, matcher) {
  const needle = normalized(matcher).trim();
  if (!needle) return false;
  if (/^[a-z0-9]+$/.test(needle) && needle.length <= 5) {
    return new RegExp(`(?:^|[^a-z0-9])${needle}(?:$|[^a-z0-9])`, 'i').test(haystack);
  }
  return haystack.includes(needle);
}

export function matchOrganization(candidate, cfg) {
  const title = normalized(candidate?.title);
  const journal = normalized(candidate?.journal);
  const affiliations = normalized(Array.isArray(candidate?.affiliations)
    ? candidate.affiliations.join(' ') : candidate?.affiliations);

  for (const org of cfg.organizations) {
    const titleMatchers = [...(org.pubmedMatchers?.title ?? []), ...(org.aliases ?? []), org.name];
    if (titleMatchers.some((matcher) => includesMatcher(title, matcher))) {
      return { organizationId: org.id, matchedBy: 'title' };
    }
    const affiliationMatchers = org.pubmedMatchers?.affiliation ?? [];
    if (affiliationMatchers.some((matcher) => includesMatcher(affiliations, matcher))) {
      return { organizationId: org.id, matchedBy: 'affiliation' };
    }
    const journalMatchers = org.pubmedMatchers?.journal ?? [];
    if (journalMatchers.some((matcher) => includesMatcher(journal, matcher))) {
      return { organizationId: org.id, matchedBy: 'journal' };
    }
  }

  if (candidate?.sourceUrl) {
    try {
      const hostname = new URL(candidate.sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
      for (const org of cfg.organizations) {
        if ((org.domains ?? []).some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
          return { organizationId: org.id, matchedBy: 'sourceUrl' };
        }
      }
    } catch { /* malformed candidate URLs simply do not identify an organization */ }
  }
  return null;
}
