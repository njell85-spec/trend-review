import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGuidelineDocument } from '../src/utils/guidelineClassifier.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const corpus = JSON.parse(await readFile(new URL('./fixtures/guideline-corpus.json', import.meta.url)));
const orgs = loadGuidelineOrgs();

test('guideline corpus classifications all match their expected verdict', async (t) => {
  for (const candidate of corpus) {
    await t.test(candidate.title, () => {
      const result = classifyGuidelineDocument(candidate, { orgs });
      assert.equal(result.verdict, candidate.expect, `${candidate.title}: actual verdict=${result.verdict}`);
      assert.ok(Array.isArray(result.reasons));
      assert.equal(typeof result.evidence.format, 'boolean');
      assert.equal(typeof result.evidence.publisher, 'boolean');
      assert.equal(typeof result.evidence.normative, 'boolean');
      assert.equal(typeof result.evidence.official, 'boolean');
    });
  }
});

// ── F1+F3 회귀: PT 로 찾아온 문서가 "PT 가 아님" 으로 판정되면 안 된다 ────────────
//
// 2026-08-17 실물: `manifest.ptPmids` 에 42522393 이 들어 있는데 상태 파일에는
// `documentType: null` · `insufficient-positive-evidence` 로 앉아 있었다.
// 원인은 esummary 필드명 오타로 `publicationTypes` 가 전건 빈 배열이던 것(F1).
// 분류기가 PT 근거를 **publicationTypes 하나에만** 걸어 두었기 때문에 그 오타 하나가
// format·official 두 축을 통째로 꺼 버렸다. 발견 경로를 두 번째 근거로 세운다(F3).
test('F3: pubmed-pt 로 발견된 문서는 publicationTypes 가 비어도 공식 문서로 인정된다', () => {
  const out = classifyGuidelineDocument({
    pmid: '42522393',
    title: 'Consensus document on the management of patients with accidental hypothermia',
    publicationTypes: [],                     // ← esummary 가 못 준 날 (실제로 매일 그랬다)
    discoveredBy: ['pubmed-pt', 'pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.official, true, 'PT 쿼리 결과인데 공식 색인 축이 꺼져 있다');
  assert.equal(out.evidence.format, true, 'PT 쿼리 결과인데 문서형식 축이 꺼져 있다');
  assert.equal(out.documentType, 'guideline');
  assert.equal(out.verdict, 'guideline', '두 축이 서면 격리가 아니라 통과여야 한다');
});

test('F3: 확장(제목) 경로만으로 발견된 것은 여전히 승격되지 않는다', () => {
  const out = classifyGuidelineDocument({
    pmid: '41705512',
    title: 'The impact of physician factors on treatment recommendations in sports medicine.',
    publicationTypes: [],
    discoveredBy: ['pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.official, false, 'PT 가 아닌 것까지 공식으로 인정하면 F3 이 너무 넓다');
  assert.equal(out.verdict, 'needsReview');
});

test('F1+F2: publicationTypes 와 초록이 채워지면 확장 경로도 두 축을 채운다', () => {
  const out = classifyGuidelineDocument({
    pmid: '41942814',
    title: 'Teleneurocritical Care (TeleNCC) Consensus Statement',
    publicationTypes: ['Journal Article'],
    abstract: 'This consensus statement provides recommendations for teleneurocritical care programs.',
    discoveredBy: ['pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.format, true);      // 제목 → consensus
  assert.equal(out.evidence.normative, true);   // 초록 → recommendations  (보강 전에는 항상 false 였다)
  assert.equal(out.verdict, 'guideline');
});
