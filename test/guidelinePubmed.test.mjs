import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGuidelineCandidates, assertSupersetOfPtPath, pubTypesOf, enrichCandidates, mergeArticleDetail } from '../src/utils/guidelinePubmed.js';

function stub({ pt = ['1', '2'], expanded = ['2', '3'], fail = '' } = {}) {
  return async (url) => {
    if (url.includes('esearch')) {
      const isPt = new URL(url).searchParams.get('term').includes('practice guideline');
      if (fail === (isPt ? 'pt' : 'expanded') || fail === 'both') throw new Error(`${isPt ? 'pt' : 'expanded'} down`);
      const ids = isPt ? pt : expanded;
      return { esearchresult: { count: String(ids.length + 2), idlist: ids } };
    }
    const ids = new URL(url).searchParams.get('id').split(',');
    return { result: Object.fromEntries(ids.map((id) => [id, { uid: id, title: id === '3' ? 'Scientific statement and focused update' : `Guideline ${id}`, pubdate: `202${id}-01-01`, pubtype: id === '3' ? ['Journal Article'] : ['Guideline'] }])) };
  };
}

test('expanded non-PT documents enter and overlap discovery signals merge', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub(), minDate: '2025/01/01', maxDate: '2026/01/01', retmax: 10, now: '2026-01-02T00:00:00Z' });
  assert.equal(out.candidates.length, 3);
  assert.deepEqual(out.candidates.find((x) => x.pmid === '2').discoveredBy.sort(), ['pubmed-pt', 'pubmed-title']);
  assert.equal(out.candidates.find((x) => x.pmid === '3').title, 'Scientific statement and focused update');
  assert.equal(out.manifest.overlapCount, 1);
});

test('one query failure is recorded and the other succeeds', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub({ fail: 'pt' }), minDate: 'a', maxDate: 'b', retmax: 10 });
  assert.equal(out.manifest.queries[0].succeeded, false);
  assert.match(out.manifest.queries[0].error, /pt down/);
  assert.equal(out.candidates.length, 2);
});

test('both failures throw', async () => assert.rejects(() => collectGuidelineCandidates({ fetchJson: stub({ fail: 'both' }), minDate: 'a', maxDate: 'b', retmax: 10 }), /Both PubMed/));

test('truncation is honestly based on ids fetched reaching retmax', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub({ pt: ['1', '2'], expanded: [] }), minDate: 'a', maxDate: 'b', retmax: 2 });
  assert.equal(out.manifest.queries[0].truncated, true);
  assert.equal(out.manifest.queries[1].truncated, false);
});

test('PT superset assertion throws when a PT PMID is absent', () => {
  const manifest = {};
  Object.defineProperty(manifest, 'ptPmids', { value: ['1', '2'] });
  assert.throws(() => assertSupersetOfPtPath(manifest, [{ id: 'pmid:1' }]), /superset violation/);
});

// ── 세션 검수에서 추가한 것 ────────────────────────────────────────────────
// 초집합 검증은 이 개편의 **최우선 정지 신호**인데, 처음 구현은 근거(`ptPmids`)를
// non-enumerable 로 숨겨 뒀다. manifest 를 JSON 으로 남기는 순간(G9 artifact ·
// G10 상태 파일이 정확히 그렇게 한다) 근거가 사라지고 **검증이 조용히 통과했다.**
// 검사한 척만 하는 것이 검사를 안 하는 것보다 나쁘다.

test('★ 초집합 근거는 JSON 왕복을 견딘다 (artifact 로 남겨도 재검증된다)', async () => {
  const built = await collectGuidelineCandidates({
    fetchJson: stub({ pt: ['11', '22'], expanded: ['22', '33'] }),
    minDate: 'a', maxDate: 'b', retmax: 100,
  });
  const roundTripped = JSON.parse(JSON.stringify(built.manifest));
  assert.ok(Array.isArray(roundTripped.ptPmids), 'ptPmids 가 직렬화에서 사라졌다');
  assert.deepEqual([...roundTripped.ptPmids].sort(), ['11', '22']);
  assert.equal(assertSupersetOfPtPath(roundTripped, built.candidates), true);
});

test('★ 근거가 없으면 통과가 아니라 오류다 (조용한 통과 금지)', () => {
  assert.throws(() => assertSupersetOfPtPath({ queries: [] }, [{ id: 'pmid:1' }]),
    /no evidence/, '근거 없는 manifest 가 통과하면 정지 신호가 죽는다');
});

test('★ PT 쿼리가 건을 가져왔는데 근거가 비면 오류다', () => {
  assert.throws(() => assertSupersetOfPtPath(
    { ptPmids: [], queries: [{ id: 'pubmed-pt', succeeded: true, idsFetched: 5 }] },
    [{ id: 'pmid:1' }],
  ), /evidence is empty/);
});

test('★ 초집합 위반은 직렬화 뒤에도 잡힌다', async () => {
  const built = await collectGuidelineCandidates({
    fetchJson: stub({ pt: ['11', '22'], expanded: ['22'] }),
    minDate: 'a', maxDate: 'b', retmax: 100,
  });
  const roundTripped = JSON.parse(JSON.stringify(built.manifest));
  const missingOne = built.candidates.filter((c) => c.pmid !== '11');
  assert.throws(() => assertSupersetOfPtPath(roundTripped, missingOne), /superset violation/);
});

test('★ PT 쿼리가 죽은 날은 초집합을 "통과" 로 위장하지 않는다 (판정 불가로 표시)', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub({ fail: 'pt' }), minDate: 'a', maxDate: 'b', retmax: 10 });
  assert.equal(out.manifest.supersetCheckable, false,
    'PT 가 죽으면 ptPmids 가 비고 빈 집합은 모든 집합의 부분집합이라 검증이 항상 통과한다');
  assert.equal(out.candidates.length, 2, '수집 자체는 부분 성공으로 계속한다');
  assert.throws(() => assertSupersetOfPtPath(out.manifest, out.candidates), /PT query failed/);
});

test('★ PT 쿼리가 성공한 날은 초집합 판정이 가능하다고 표시된다', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub(), minDate: 'a', maxDate: 'b', retmax: 10 });
  assert.equal(out.manifest.supersetCheckable, true);
});

// ── F1 회귀: esummary 의 실제 필드명은 `pubtype` 이다 ──────────────────────────
// 종전 구현은 `pubtypelist` 를 읽었고 **픽스처도 같은 오타를 쓰고 있었다.** 그래서
// 프로덕션에서 `publicationTypes` 가 전건 빈 배열이었는데도 테스트는 초록이었다
// (2026-08-17 실측: 상태 파일의 PubMed 수집분 8건 전부 `[]`).
// 이 테스트는 **NCBI 응답 모양 그 자체**를 계약으로 못 박는다 — 여기가 흔들리면
// 분류기의 format·official 두 축이 조용히 죽는다.
test('F1: esummary 의 pubtype 을 읽는다 (pubtypelist 아님)', () => {
  assert.deepEqual(pubTypesOf({ pubtype: ['Practice Guideline', 'Journal Article'] }),
    ['Practice Guideline', 'Journal Article']);
  // 옛 이름들은 폴백으로만 산다
  assert.deepEqual(pubTypesOf({ pubtypelist: ['Guideline'] }), ['Guideline']);
  assert.deepEqual(pubTypesOf({ publicationTypes: ['Guideline'] }), ['Guideline']);
  // ★ 빈 배열이 먼저 오면 `??` 로는 폴백이 안 돈다 — 비어 있지 않은 첫 배열을 골라야 한다
  assert.deepEqual(pubTypesOf({ pubtype: [], pubtypelist: ['Guideline'] }), ['Guideline']);
  assert.deepEqual(pubTypesOf({}), []);
});

test('F1: 수집 결과의 publicationTypes 가 채워진다', async () => {
  const out = await collectGuidelineCandidates({ fetchJson: stub(), minDate: 'a', maxDate: 'b', retmax: 10 });
  const one = out.candidates.find((x) => x.pmid === '1');
  assert.deepEqual(one.publicationTypes, ['Guideline'],
    'esummary 가 pubtype 을 줬는데 후보가 비어 있다면 필드명이 또 어긋난 것이다');
  assert.ok(out.candidates.every((x) => Array.isArray(x.publicationTypes)));
});

// ── F2 회귀: 초록 보강 ────────────────────────────────────────────────────────
test('F2: efetch 보강이 초록·PT·MeSH 를 채운다', async () => {
  const candidates = [
    { id: 'pmid:1', pmid: '1', title: 'A', publicationTypes: [], discoveredBy: ['pubmed-title'] },
    { id: 'pmid:2', pmid: '2', title: 'B', publicationTypes: [], discoveredBy: ['pubmed-title'] },
  ];
  const out = await enrichCandidates(candidates, {
    fetchArticles: async (pmids) => {
      assert.deepEqual(pmids, ['1', '2']);
      return [{ pmid: '1', abstract: 'We recommend early antibiotics.', publicationTypes: ['Guideline'], meshTerms: ['Sepsis'], keywords: ['sepsis'], journal: 'J', doi: 'd', pmcid: '' }];
    },
  });
  assert.equal(out.candidates[0].abstract, 'We recommend early antibiotics.');
  assert.deepEqual(out.candidates[0].publicationTypes, ['Guideline']);
  assert.deepEqual(out.candidates[0].meshTerms, ['Sepsis']);
  assert.equal(out.candidates[1].abstract, undefined, '응답에 없는 PMID 는 손대지 않는다');
  assert.deepEqual(out.evidence, { attempted: true, requested: 2, enriched: 1, withAbstract: 1, error: null });
});

test('F2: 보강 실패는 수집을 죽이지 않되 조용하지도 않다', async () => {
  const candidates = [{ id: 'pmid:1', pmid: '1', title: 'A' }];
  const out = await enrichCandidates(candidates, { fetchArticles: async () => { throw new Error('efetch 500'); } });
  assert.equal(out.candidates.length, 1);
  assert.match(out.evidence.error, /efetch 500/);
  assert.equal(out.evidence.attempted, true);
});

test('F2: fetchArticles 가 없으면 그대로 통과한다', async () => {
  const out = await enrichCandidates([{ pmid: '1' }], {});
  assert.equal(out.evidence.attempted, false);
  assert.equal(out.candidates.length, 1);
});

test('F2: 보강은 이미 있는 값을 덮어쓰지 않는다', () => {
  const merged = mergeArticleDetail(
    { pmid: '1', abstract: 'kept', publicationTypes: ['Guideline'], journal: 'kept-journal' },
    { pmid: '1', abstract: 'new', publicationTypes: [], journal: 'new-journal' });
  assert.equal(merged.abstract, 'kept');
  assert.deepEqual(merged.publicationTypes, ['Guideline']);
  assert.equal(merged.journal, 'kept-journal');
});
