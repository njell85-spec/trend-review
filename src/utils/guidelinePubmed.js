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

// ★ NCBI esummary(pubmed) 의 publication type 필드 이름은 **`pubtype`** 이다.
//   종전 구현은 `pubtypelist` 를 읽었고, 그런 필드는 응답에 없다 — 그래서
//   **모든 후보의 `publicationTypes` 가 빈 배열**이었다(2026-08-17 실측: 상태 파일의
//   PubMed 수집분 8건 전부 `[]`). 결과는 조용한 전멸이다:
//     · 분류기의 `format` 축(제목·PT 로 문서형식 추정)이 PT 쪽 근거를 못 받고
//     · `official` 축(PubMed 공식 색인)은 `guidelineType` 에 걸려 있어 통째로 죽는다
//   **PT 쿼리로 찾아온 문서조차 "PT 가 아님" 으로 판정됐다** — 42522393 이 manifest 의
//   `ptPmids` 에 있으면서 상태에는 `documentType: null` 로 앉아 있다.
//   같은 저장소의 논문 트랙(`DataCollectorAgent._parseArticles` 호출부)과 시장조사
//   (`scripts/guideline-census.mjs`)는 처음부터 `pubtype` 을 쓴다 — 여기 한 곳만 틀렸다.
//   테스트가 초록이던 이유는 픽스처가 **틀린 이름을 그대로 박아 놨기** 때문이다.
//   옛 이름들도 폴백으로 남긴다(다른 호출자가 넘겨 주는 모양이 있다) — 다만
//   **비어 있지 않은 첫 배열**을 고른다. `??` 로는 빈 배열이 먼저 걸려 폴백이 안 돈다.
export function pubTypesOf(record = {}) {
  for (const raw of [record.pubtype, record.pubtypelist, record.publicationTypes]) {
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((x) => x?.value ?? x)
      .filter((x) => String(x ?? '').trim());
    if (list.length) return list;
  }
  return [];
}

function toCandidate(pmid, record, discoveredBy, now) {
  return {
    id: `pmid:${pmid}`,
    pmid: String(pmid),
    title: record.title ?? '',
    pubDate: dateOf(record),
    journal: record.fulljournalname ?? record.source ?? '',
    publicationTypes: pubTypesOf(record),
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
  // ★ PT 쿼리 **자신이 죽은 날**이 가장 위험한데, 종전 가드는 거기서 침묵했다.
  //   `succeeded:false` 면 ptPmids 가 비고, 빈 집합은 어떤 후보 집합의 부분집합이므로
  //   `missing` 이 항상 비어 무조건 통과한다. 수집기는 **두 쿼리가 다 죽어야** throw 하므로,
  //   PT 가 죽고 확장만 산 날은 "초집합 검증 통과 + 후보 정상 수집" 으로 읽힌다.
  //   현행 경로가 무너진 바로 그 상황에서 최우선 정지 신호가 조용해지는 것이다.
  if (ptQuery && ptQuery.succeeded === false) {
    throw new Error(`PT superset check cannot run: the PT query failed `
      + `(${ptQuery.error ?? 'unknown error'}) — 확장 경로만으로는 현행 회수율을 보장할 수 없다`);
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
  // PT 쿼리가 죽었으면 초집합을 **판정할 수 없다.** 수집 자체는 부분 성공으로 계속하되
  // (G4 계약), 판정 불가라는 사실을 manifest 에 남긴다 — 호출자가 정지 신호로 올린다.
  // 여기서 던져 버리면 확장 경로 결과까지 버리게 되고, 조용히 통과시키면 최우선 정지
  // 신호가 죽는다. 둘 다 아니고 **판정 불가로 표시**하는 것이 맞다.
  const ptOk = manifest.queries.find((q) => q.id === 'pubmed-pt')?.succeeded === true;
  manifest.supersetCheckable = ptOk;
  if (ptOk) assertSupersetOfPtPath(manifest, candidates);
  return { candidates, manifest };
}

// ★ esummary 는 **초록을 주지 않는다.** 그런데 분류기의 `normative` 축(권고 표현이
//   본문에 있는가)은 초록·본문에서만 읽고, 스코어러의 주제 점수는 MeSH·키워드도 본다.
//   즉 수집이 esummary 에서 끝나면 그 두 축이 **구조적으로 항상 비어 있다** —
//   2026-08-17 실측에서 상태 파일 15건 전부 `abstract` 가 없었고, 그래서 큐 5건이
//   모두 `insufficient-positive-evidence` 로 격리됐다.
//
//   efetch 로 한 번 더 받아 채운다. 파싱은 이미 논문 트랙이 검증된 구현을 갖고 있으므로
//   (`DataCollectorAgent.fetchArticles`) 여기서 다시 쓰지 않고 **주입받는다** — 파서가
//   둘로 갈리면 같은 PubMed 응답을 서로 다르게 읽는 날이 온다.
//
//   ★ 보강은 **소프트 실패**다. efetch 가 죽어도 수집 자체는 성사시킨다(esummary 만으로도
//   후보 목록은 성립한다). 다만 조용히 넘어가지 않고 manifest 에 남긴다 — 보강이 죽은
//   날은 판정이 옛 상태로 되돌아가므로, 그 사실이 보여야 한다.
export function mergeArticleDetail(candidate, article) {
  if (!article) return candidate;
  const types = pubTypesOf({ pubtype: article.publicationTypes });
  // ★ 규칙 하나로 통일한다: **빈 자리만 채운다. 있는 값은 안 덮는다.**
  //   위쪽(수동 승인 URL·본문 수집)이 이미 채워 넣은 것을 efetch 가 덮으면
  //   PeterJ 가 직접 넣은 근거가 조용히 바뀐다 — 확정 ⑤-A 가 막으려는 부류다.
  return {
    ...candidate,
    abstract: candidate.abstract || article.abstract || '',
    publicationTypes: (candidate.publicationTypes ?? []).length ? candidate.publicationTypes : types,
    meshTerms: article.meshTerms?.length ? article.meshTerms : (candidate.meshTerms ?? []),
    keywords: article.keywords?.length ? article.keywords : (candidate.keywords ?? []),
    journal: candidate.journal || article.journal || '',
    doi: candidate.doi || article.doi || '',
    pmcid: candidate.pmcid || article.pmcid || '',
  };
}

export async function enrichCandidates(candidates, { fetchArticles } = {}) {
  const evidence = { attempted: false, requested: 0, enriched: 0, withAbstract: 0, error: null };
  const pmids = (candidates ?? []).map((c) => String(c?.pmid ?? '')).filter(Boolean);
  if (typeof fetchArticles !== 'function' || !pmids.length) {
    return { candidates: candidates ?? [], evidence };
  }
  evidence.attempted = true;
  evidence.requested = pmids.length;
  let articles = [];
  try {
    articles = (await fetchArticles(pmids)) ?? [];
  } catch (error) {
    evidence.error = error?.message ?? String(error);
    return { candidates, evidence };
  }
  const byPmid = new Map(articles.map((a) => [String(a?.pmid ?? ''), a]));
  const out = candidates.map((candidate) => {
    const article = byPmid.get(String(candidate?.pmid ?? ''));
    if (!article) return candidate;
    evidence.enriched += 1;
    const merged = mergeArticleDetail(candidate, article);
    if (String(merged.abstract ?? '').trim()) evidence.withAbstract += 1;
    return merged;
  });
  return { candidates: out, evidence };
}
