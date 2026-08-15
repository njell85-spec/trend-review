function orgFor(candidate, orgs) {
  if (candidate?.organizationId) return candidate.organizationId;
  const text = `${candidate?.title ?? ''} ${(candidate?.affiliations ?? []).join?.(' ') ?? candidate?.affiliations ?? ''}`.normalize('NFKC').toLowerCase();
  for (const org of orgs?.organizations ?? orgs ?? []) {
    const names = [org.name, ...(org.aliases ?? []), ...(org.pubmedMatchers?.title ?? [])].filter(Boolean);
    if (names.some((name) => text.includes(String(name).toLowerCase()))) return org.id;
  }
  return 'unknown';
}

export function normalizeGuidelineTitle(title) {
  return String(title ?? '').normalize('NFKC').toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:v(?:ersion)?\s*)?\d+(?:\.\d+)+\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+edition\b/g, ' ')
    .replace(/\b(?:focused\s+update|consensus\s+statement|scientific\s+statement|position\s+statement|clinical\s+recommendations|practice\s+recommendations|expert\s+recommendations|guidelines?|guidance|recommendations?|updated?|edition|version)\b/g, ' ')
    .replace(/\bfor\s+the\s+management\s+of\b/g, ' ')
    .replace(/[\p{P}\p{S}()\[\]{}]+/gu, ' ')
    .replace(/\b(?:the|a|an|and|or|of|on|for|to|in)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\s/g, '-');
}

export function lineageKeyOf(candidate, { orgs } = {}) {
  const organizationId = orgFor(candidate, orgs);
  let subject = normalizeGuidelineTitle(candidate?.title);
  const org = (orgs?.organizations ?? orgs ?? []).find?.((x) => x.id === organizationId);
  for (const name of [org?.name, ...(org?.aliases ?? [])].filter(Boolean)) {
    const normalizedName = normalizeGuidelineTitle(name);
    subject = subject.replace(new RegExp(`(?:^|-)${normalizedName}(?:-|$)`, 'g'), '-').replace(/^-|-$/g, '').replace(/--+/g, '-');
  }
  const alias = org?.lineageAliases?.[subject];
  return `${organizationId}|${alias ?? subject}`;
}

function yearOf(item) {
  const explicit = item?.versionYear ?? item?.editionYear;
  if (/^(?:19|20)\d{2}$/.test(String(explicit ?? ''))) return Number(explicit);
  const titleYear = String(item?.title ?? '').match(/\b((?:19|20)\d{2})\b/)?.[1];
  if (titleYear) return Number(titleYear);
  for (const value of [item?.officialPublishedAt, item?.publishedAt, item?.pubDate, item?.lastModified]) {
    const year = String(value ?? '').match(/\b((?:19|20)\d{2})\b/)?.[1];
    if (year) return Number(year);
  }
  return null;
}
function idOf(item) { return item?.id ?? (item?.pmid ? `pmid:${item.pmid}` : item?.sourceId); }

export function resolveSupersede(state, candidate, { orgs } = {}) {
  const key = lineageKeyOf(candidate, { orgs });
  const candidateYear = yearOf(candidate);
  const all = [...(state?.queue ?? []), ...(state?.published ?? [])];
  const same = all.filter((item) => idOf(item) !== idOf(candidate) && lineageKeyOf(item, { orgs }) === key);
  if (!same.length) return { supersedes: [], reason: 'no-matching-lineage', confident: false };
  if (!candidateYear) return { supersedes: [], reason: 'candidate-year-unknown', confident: false };
  if (same.some((item) => !yearOf(item))) return { supersedes: [], reason: 'prior-year-unknown', confident: false };
  if (same.some((item) => yearOf(item) === candidateYear)) return { supersedes: [], reason: 'same-year-ambiguous', confident: false };
  const older = same.filter((item) => yearOf(item) < candidateYear);
  if (!older.length) return { supersedes: [], reason: 'candidate-not-newer', confident: false };
  const supersedes = older.map(idOf);
  const at = new Date().toISOString();
  for (const item of older) { item.status = 'superseded'; item.supersededBy = idOf(candidate); item.supersededAt = at; }
  return { supersedes, reason: `newer-edition-${candidateYear}`, confident: true };
}
