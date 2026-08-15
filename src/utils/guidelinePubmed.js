const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export const PT_TERM = '(("practice guideline"[Publication Type]) OR ("guideline"[Publication Type])) AND ("emergency medicine"[MeSH] OR "critical care"[MeSH] OR "sepsis"[MeSH] OR "respiratory distress syndrome"[MeSH] OR "resuscitation"[MeSH] OR "heart arrest"[MeSH] OR "shock"[MeSH] OR "respiration, artificial"[MeSH])';
export const EXPANDED_TERM = '((consensus[Title] OR "consensus statement"[Title] OR "scientific statement"[Title] OR "position statement"[Title] OR "focused update"[Title] OR "clinical recommendations"[Title] OR "practice recommendations"[Title] OR "expert recommendations"[Title] OR statement[Title] OR recommendations[Title]) OR (consensus[Publication Type] OR statement[Publication Type] OR recommendations[Publication Type])) AND ("emergency medicine"[MeSH] OR "critical care"[MeSH] OR "sepsis"[MeSH] OR "respiratory distress syndrome"[MeSH] OR "resuscitation"[MeSH] OR "heart arrest"[MeSH] OR "shock"[MeSH] OR "respiration, artificial"[MeSH])';

function searchUrl(term, minDate, maxDate, retmax) {
  const p = new URLSearchParams({ db: 'pubmed', term, mindate: minDate, maxdate: maxDate, datetype: 'pdat', retmode: 'json', sort: 'date', retmax: String(retmax) });
  return `${BASE}/esearch.fcgi?${p}`;
}

function summaryUrl(ids) {
  const p = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' });
  return `${BASE}/esummary.fcgi?${p}`;
}

function dateOf(record) {
  return record.pubdate ?? record.epubdate ?? record.sortpubdate ?? record.date ?? null;
}

function toCandidate(pmid, record, discoveredBy, now) {
  return {
    id: `pmid:${pmid}`,
    pmid: String(pmid),
    title: record.title ?? '',
    pubDate: dateOf(record),
    journal: record.fulljournalname ?? record.source ?? '',
    publicationTypes: (record.pubtypelist ?? record.publicationTypes ?? []).map((x) => x?.value ?? x),
    discoveredBy: [discoveredBy],
    discoveredAt: now,
  };
}

async function runQuery(spec, fetchJson, opts) {
  const evidence = { id: spec.id, term: spec.term, attempted: true, succeeded: false, totalFound: 0, idsFetched: 0, truncated: false, error: null };
  try {
    const search = await fetchJson(searchUrl(spec.term, opts.minDate, opts.maxDate, opts.retmax));
    const result = search?.esearchresult;
    if (!result) throw new Error('PubMed esearch response missing esearchresult');
    const ids = (result.idlist ?? []).map(String);
    evidence.totalFound = Number(result.count ?? ids.length);
    evidence.idsFetched = ids.length;
    evidence.truncated = ids.length >= opts.retmax;
    let records = {};
    if (ids.length) {
      const summary = await fetchJson(summaryUrl(ids));
      records = summary?.result ?? {};
    }
    const candidates = ids.map((id) => toCandidate(id, records[id] ?? {}, spec.discovery, opts.now));
    evidence.succeeded = true;
    return { evidence, candidates, ids };
  } catch (error) {
    evidence.error = error?.message ?? String(error);
    return { evidence, candidates: [], ids: [] };
  }
}

// ★ 이 개편의 최우선 정지 신호다 — 그물을 넓혔는데 현행 PT 경로가 찾던 것을
//   하나라도 놓치면 즉시 멈춘다.
//
//   ★★ `ptPmids` 는 반드시 **열거 가능한** manifest 필드여야 한다.
//   처음 구현은 `Object.defineProperty(..., { enumerable: false })` 로 숨겨 뒀는데,
//   그러면 manifest 를 JSON 으로 남기는 순간(G9 artifact · G10 상태 파일이 정확히
//   그렇게 한다) 증거가 사라지고 **이 검증이 조용히 통과한다.** 검사한 척만 하게 된다.
//   그래서 증거가 아예 없으면 통과시키지 않고 던진다.
export function assertSupersetOfPtPath(manifest, candidates) {
  const ptPmids = manifest?.ptPmids;
  if (!Array.isArray(ptPmids)) {
    throw new Error('PT superset check has no evidence: manifest.ptPmids is missing '
      + '(직렬화에서 사라졌거나 수집기가 안 남겼다 — 통과로 위장하지 않는다)');
  }
  const ptQuery = (manifest?.queries ?? []).find((q) => q.id === 'pubmed-pt');
  if (ptQuery && ptQuery.succeeded && ptQuery.idsFetched > 0 && ptPmids.length === 0) {
    throw new Error(`PT superset check evidence is empty although the PT query fetched `
      + `${ptQuery.idsFetched} id(s)`);
  }
  const finalIds = new Set((candidates ?? []).map((item) => item.id ?? (item.pmid ? `pmid:${item.pmid}` : null)));
  const missing = ptPmids.filter((pmid) => !finalIds.has(`pmid:${pmid}`));
  if (missing.length) throw new Error(`PubMed PT superset violation; missing PMID(s): ${missing.join(', ')}`);
  return true;
}

export async function collectGuidelineCandidates({ fetchJson, minDate, maxDate, retmax = 40, now = new Date().toISOString() }) {
  if (typeof fetchJson !== 'function') throw new TypeError('fetchJson must be a function');
  if (!minDate || !maxDate) throw new TypeError('minDate and maxDate are required');
  if (!Number.isInteger(retmax) || retmax < 1) throw new TypeError('retmax must be a positive integer');
  const specs = [
    { id: 'pubmed-pt', discovery: 'pubmed-pt', term: PT_TERM },
    { id: 'pubmed-expanded', discovery: 'pubmed-title', term: EXPANDED_TERM },
  ];
  const results = await Promise.all(specs.map((spec) => runQuery(spec, fetchJson, { minDate, maxDate, retmax, now })));
  if (results.every((x) => !x.evidence.succeeded)) {
    throw new AggregateError(results.map((x) => new Error(x.evidence.error)), 'Both PubMed guideline queries failed');
  }
  const merged = new Map();
  for (const result of results) for (const candidate of result.candidates) {
    const previous = merged.get(candidate.id);
    merged.set(candidate.id, previous
      ? { ...previous, ...candidate, discoveredBy: [...new Set([...previous.discoveredBy, ...candidate.discoveredBy])] }
      : candidate);
  }
  const candidates = [...merged.values()];
  const pt = new Set(results[0].ids);
  const expanded = new Set(results[1].ids);
  const dates = candidates.map((x) => x.pubDate).filter(Boolean).sort();
  const manifest = {
    queries: results.map((x) => x.evidence),
    mergedTotal: candidates.length,
    overlapCount: [...pt].filter((id) => expanded.has(id)).length,
    ptOnlyCount: [...pt].filter((id) => !expanded.has(id)).length,
    expandedOnlyCount: [...expanded].filter((id) => !pt.has(id)).length,
    oldestFetchedDate: dates[0] ?? null,
    newestFetchedDate: dates.at(-1) ?? null,
    window: { minDate, maxDate }, retmax,
  };
  manifest.ptPmids = [...pt];   // 열거 가능해야 한다 — 위 assert 주석 참조
  assertSupersetOfPtPath(manifest, candidates);
  return { candidates, manifest };
}
