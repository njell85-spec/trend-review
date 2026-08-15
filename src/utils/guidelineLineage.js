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
  if (!same.length) return { supersedes: [], transitions: [], reason: 'no-matching-lineage', confident: false };
  if (!candidateYear) return { supersedes: [], transitions: [], reason: 'candidate-year-unknown', confident: false };
  if (same.some((item) => !yearOf(item))) return { supersedes: [], transitions: [], reason: 'prior-year-unknown', confident: false };
  if (same.some((item) => yearOf(item) === candidateYear)) return { supersedes: [], transitions: [], reason: 'same-year-ambiguous', confident: false };
  const older = same.filter((item) => yearOf(item) < candidateYear);
  if (!older.length) return { supersedes: [], transitions: [], reason: 'candidate-not-newer', confident: false };
  const supersedes = older.map(idOf);
  const at = new Date().toISOString();
  // ★ 여기서 원본 객체를 제자리 변형하면 호출자의 `map()` 과 순서 다툼이 난다.
  //   호출부는 `state.queue.map(...)` 안에서 이 함수를 부르고 항목마다 **새 객체**를 반환한다.
  //   같은 큐 안에 구판 A(앞)와 신판 B(뒤)가 있으면: i=0 에서 A 가 새 객체로 교체되고,
  //   i=1 에서 B 가 **옛 배열의 A 객체**를 superseded 로 바꾼다 — 그 변형은 결과 배열에
  //   반영되지 않는다. 결과는 "B 는 supersedes:[A] 인데 A 는 needsReview" 라는 모순 상태가
  //   매일 디스크에 저장되는 것이다. 배열 순서가 반대면 정상 동작하므로 테스트가 한쪽
  //   순서만 쓰면 초록으로 통과한다.
  //   그래서 **변형하지 않고 전이 지시만 돌려준다.** 적용은 `applySupersede` 가 한 곳에서 한다.
  const transitions = older.map((item) => ({ id: idOf(item), status: 'superseded', supersededBy: idOf(candidate), supersededAt: at }));
  return { supersedes, transitions, reason: `newer-edition-${candidateYear}`, confident: true };
}


// 전이를 **한 곳에서** 적용한다. 큐와 발행분 양쪽을 훑되, 배열 순서에 의존하지 않는다.
// 호출자가 map 으로 새 객체를 만들든 말든, 이 함수는 최종 배열을 받아 마지막에 한 번 돈다.
export function applySupersede(state, transitions) {
  if (!transitions?.length) return state;
  const byId = new Map(transitions.map((t) => [t.id, t]));
  const apply = (item) => {
    const id = item.id ?? (item.pmid ? `pmid:${item.pmid}` : item.sourceId);
    const t = byId.get(id);
    return t ? { ...item, status: t.status, supersededBy: t.supersededBy, supersededAt: t.supersededAt } : item;
  };
  state.queue = (state.queue ?? []).map(apply);
  state.published = (state.published ?? []).map(apply);
  return state;
}
