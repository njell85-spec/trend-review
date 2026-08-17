import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

const baseState = (queue = []) => ({ schemaVersion: 2, queue, published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: '2026-08-01T00:00:00.000Z', configVersion: 'guideline-v2' });
const candidate = (pmid, priority) => ({ id: `pmid:${pmid}`, pmid, title: `AHA cardiac arrest guideline 2026 ${pmid}`, pubDate: '2026-08-01', status: 'queued', priority, attempts: 0 });

async function setup(queue = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'guideline-daily-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify(baseState(queue)));
  const o = new TrendReviewOrchestrator();
  o.guidelineListPath = file;
  // 이 파일은 **자동 발행을 켠 상태**의 소진 계약을 본다.
  // 관찰 전용 기본값(게이트 OFF) 자체는 `guidelineContract.test.mjs` 가 본다.
  process.env.ENABLE_GUIDELINE_AUTOPUBLISH = 'true';
  o._guidelineInputs = async () => ({ candidates: [], manifest: { ptPmids: [] } });
  o.guideline = { analyze: async (paper) => ({ paper, org: 'AHA' }) };
  o.fullText = { run: async (papers) => ({ papers }) };
  return { o, file };
}

test('연속 이틀 실제 candidateId가 하루 한 편씩 published로 전이한다', async () => {
  const { o, file } = await setup([candidate('1', 10), candidate('2', 9)]);
  await o._stageGuideline('2026-08-15');
  let state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.lastRun.publishedId, 'pmid:1');
  assert.deepEqual(state.published.map((x) => x.id), ['pmid:1']);
  await o._stageGuideline('2026-08-16');
  state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.lastRun.publishedId, 'pmid:2');
  assert.deepEqual(state.published.map((x) => x.id), ['pmid:1', 'pmid:2']);
});

test('빈 큐는 outcome empty이고 분석기를 호출하지 않는다', async () => {
  const { o, file } = await setup();
  let calls = 0; o.guideline.analyze = async () => { calls += 1; };
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.lastRun.outcome, 'empty');
  assert.equal(calls, 0);
});

test('수집 실패에도 기존 큐에서 발행한다', async () => {
  const { o, file } = await setup([candidate('3', 8)]);
  o._guidelineInputs = async () => { throw new Error('PubMed down'); };
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.lastRun.outcome, 'published');
  assert.equal(state.lastRun.manifest.collectionError, 'PubMed down');
});

test('분석 실패는 published 전이 없이 attempts와 lastError를 남긴다', async () => {
  const { o, file } = await setup([candidate('4', 8)]);
  o.guideline.analyze = async () => { throw new Error('LLM refused'); };
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.published.length, 0);
  assert.equal(state.queue[0].attempts, 1);
  assert.equal(state.queue[0].lastError, 'LLM refused');
  assert.equal(state.lastRun.outcome, 'failed');
});

test('손상 상태는 빈 상태로 덮어쓰지 않는다', async () => {
  const { o, file } = await setup();
  await writeFile(file, '{broken');
  await o._stageGuideline('2026-08-15');
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('가이드라인 단계가 throw해도 논문 publish가 호출된다', async () => {
  const { o } = await setup();
  o._stageCollect = async () => ({ papers: [{ pmid: 'paper-1' }], stats: {} });
  o._stageValidate1 = async (papers) => ({ papers, stats: {} });
  o._stageAnalyze = async (papers) => ({ topPapers: papers, allScoredPapers: papers, rerank: null });
  o._stageFetchFullText = async (papers) => papers;
  o._stagePicoAnalysis = async (papers) => ({ topPapers: papers, stats: {} });
  o._stageValidate2 = async (papers) => ({ validated: papers, qualityReport: {} });
  o._stageReport = async () => ({ jsonPath: 'r.json', htmlPath: 'r.html' });
  o._stageGuideline = async () => { throw new Error('guideline boom'); };
  let published = 0;
  o._stagePublish = async () => { published += 1; return 'pages'; };
  o._saveExcludePmids = async () => {};
  o._stageNotify = async () => null;
  o.logger.saveSession = async () => {};
  // run()의 가이드라인 호출 자체는 실제 구현이 non-fatal이라 throw하지 않는다. 여기서는
  // 그 경계를 강제로 깨뜨렸을 때를 검증하기보다, 실제 단계의 최상위 catch를 통과시킨다.
  const realStage = TrendReviewOrchestrator.prototype._stageGuideline.bind(o);
  o._stageGuideline = async () => {
    o._guidelineInputs = async () => { throw new Error('guideline boom'); };
    return realStage('2026-08-15');
  };
  await o.run();
  assert.equal(published, 1);
});

// ── F2 배선 회귀: 보강이 **실제로 불리는가** ─────────────────────────────────────
//
// 이 저장소가 반복해서 밟은 함정이 "모듈은 옳은데 아무도 안 부른다" 다.
// `enrichCandidates` 자체는 `guidelinePubmed.test.mjs` 가 보지만, 그것이 데일리 수집
// 경로에 **걸려 있는지**는 여기서만 볼 수 있다. 안 걸려 있으면 초록이 영원히 비고
// 분류기의 `normative` 축이 항상 0 이다 — 2026-08-17 실물이 정확히 그 상태였다.
test('F2: _guidelineInputs 가 efetch 보강을 태우고 증거를 manifest 에 남긴다', async () => {
  const o = new TrendReviewOrchestrator();
  const asked = [];
  o.collector = {
    _fetchJson: async (url) => {
      if (url.includes('esearch')) {
        const isPt = new URL(url).searchParams.get('term').includes('practice guideline');
        return { esearchresult: { count: '1', idlist: isPt ? ['11'] : ['12'] } };
      }
      const ids = new URL(url).searchParams.get('id').split(',');
      return { result: Object.fromEntries(ids.map((id) => [id, { uid: id, title: `Doc ${id}`, pubdate: '2026-08-01', pubtype: ['Guideline'] }])) };
    },
    fetchArticles: async (pmids) => {
      asked.push(...pmids);
      return pmids.map((pmid) => ({ pmid, abstract: `We recommend X for ${pmid}.`, publicationTypes: ['Guideline'], meshTerms: ['Sepsis'], keywords: [] }));
    },
  };
  const out = await o._guidelineInputs('2026-08-17');
  assert.deepEqual(asked.sort(), ['11', '12'], 'efetch 보강이 아예 안 불렸다');
  assert.ok(out.candidates.every((c) => String(c.abstract ?? '').includes('We recommend')),
    '보강 결과가 후보에 안 실렸다 — 반환값을 버리고 원본을 돌려주고 있다');
  assert.equal(out.manifest.enrichment.enriched, 2);
  assert.equal(out.manifest.enrichment.withAbstract, 2);
});

test('F2: 보강이 죽어도 수집은 성사되고, 죽었다는 사실이 남는다', async () => {
  const o = new TrendReviewOrchestrator();
  o.collector = {
    _fetchJson: async (url) => (url.includes('esearch')
      ? { esearchresult: { count: '1', idlist: ['11'] } }
      : { result: { 11: { uid: '11', title: 'Doc 11', pubdate: '2026-08-01', pubtype: ['Guideline'] } } }),
    fetchArticles: async () => { throw new Error('efetch 503'); },
  };
  const out = await o._guidelineInputs('2026-08-17');
  assert.equal(out.candidates.length, 1, '보강 실패가 수집을 죽이면 안 된다');
  assert.match(out.manifest.enrichment.error, /efetch 503/, '조용히 넘어가면 안 된다');
});
