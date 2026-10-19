import test from 'node:test';
import assert from 'node:assert/strict';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';

const doc = { pmid: 'synthetic-cache', title: 'Synthetic review', abstract: 'Abstract evidence only', fullTextSource: 'abstract-only' };
const modelResult = marker => ({ coverage: 'full-text', title_ko: '합성 시험', scope_ko: '합성',
  sections: [{ heading_ko: marker, body_ko: marker.repeat(1000) }],
  webSources: [{ label: 'Synthetic citation, never fetched', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' }] });
const setup = fn => {
  const store = new Map();
  const cache = { get: async k => store.get(k) ?? null, set: async (k,v) => { store.set(k,v); } };
  const a = new GuidelineAnalyzerAgent({ cache, llm: { callWithTool: fn } });
  a.retry = { execute: fn => fn() };
  a.logger = { info() {}, warn() {} };
  return { a, store };
};

test('fresh abstract cache cannot be promoted by supplying previously unread PMC text', async () => {
  let calls = 0;
  const { a } = setup(async () => modelResult(++calls === 1 ? 'OLD_' : 'NEW_'));
  const first = await a.analyze(doc, { mode: 'review' });
  assert.equal(first.coverage, 'abstract-only');
  const before = calls;
  const enriched = { ...doc, fullText: 'NEWLY_SUPPLIED_PMC_BODY '.repeat(21), fullTextSource: 'PMC' };
  const second = await a.analyze(enriched, { mode: 'review' });
  assert.ok(calls > before, 'new input must be analyzed rather than relabeling old output');
  assert.match(second.sections[0].body_ko, /^NEW_/);
  assert.equal(second.coverage, 'full-text');
  assert.notEqual(first.coverageEvidence.inputFingerprint, second.coverageEvidence.inputFingerprint);
});

test('every analysis mode distinguishes article body, source and augmentation inputs', () => {
  const { a } = setup(async () => ({}));
  for (const mode of ['review', 'guideline', 'reference', 'synthesis']) {
    const base = { ...doc, fullText: 'body '.repeat(30), fullTextSource: 'PMC' };
    const inputs = [base, { ...base, fullText: base.fullText.replace('body', 'text') },
      { ...base, fullTextSource: 'OA' }, { ...base, oaUrl: 'https://example.org/body' },
      { ...base, augmentText: 'Additional registry text' },
      { ...base, augmentSources: [{ label: 'registry', url: 'https://clinicaltrials.gov/study/NCT00000001' }] }];
    assert.equal(new Set(inputs.map(x => a._cacheKey(x, mode))).size, inputs.length, mode);
  }
  const member = { ...doc, refId: 'A', fullText: 'Member body '.repeat(30), fullTextSource: 'PMC' };
  assert.notEqual(a._cacheKey({ ...doc, docs: [member] }, 'synthesis'),
    a._cacheKey({ ...doc, docs: [{ ...member, fullText: 'Different member text '.repeat(30) }] }, 'synthesis'));
});

test('legacy values or mismatched generation evidence are ignored without deleting them', async () => {
  let calls = 0;
  const { a, store } = setup(async () => { calls++; return modelResult('FRESH_'); });
  const enriched = { ...doc, fullText: 'PMC body '.repeat(60), fullTextSource: 'PMC' };
  const oldKey = `review_v5_${a.provider}_${a.model}_${doc.pmid}`;
  store.set(oldKey, modelResult('LEGACY_'));
  store.set(a._cacheKey(enriched, 'review'), modelResult('RAW_WITHOUT_EVIDENCE_'));
  const first = await a.analyze(enriched, { mode: 'review' });
  assert.equal(calls, 1);
  assert.match(first.sections[0].body_ko, /^FRESH_/);
  assert.ok(store.has(oldKey), 'compatibility policy must not delete operational legacy keys');
  const record = structuredClone(store.get(a._cacheKey(enriched, 'review')));
  record.evidence.inputFingerprint = 'different-generation-input';
  store.set(a._cacheKey(enriched, 'review'), record);
  await a.analyze(enriched, { mode: 'review' });
  assert.equal(calls, 2);
  const wrongPolicy = structuredClone(store.get(a._cacheKey(enriched, 'review')));
  wrongPolicy.evidence.policyVersion += 1;
  store.set(a._cacheKey(enriched, 'review'), wrongPolicy);
  await a.analyze(enriched, { mode: 'review' });
  assert.equal(calls, 3);
});

test('compatible cache preserves generation evidence; a trusted URL is not retrieval verification', async () => {
  let calls = 0;
  const { a } = setup(async () => { calls++; return modelResult('SAME_'); });
  const first = await a.analyze(doc, { mode: 'review' });
  const again = await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 1);
  assert.deepEqual(again.coverageEvidence, first.coverageEvidence);
  assert.equal(again.coverageEvidence.webRetrievalVerified, false);
  assert.equal(again.coverageEvidence.suppliedTextChars, 0);
  assert.equal(again.coverage, 'abstract-only');
});
