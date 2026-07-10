import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';

// PeterJ 선정 우선순위(2026-07-10): ① 관심주제 부합 ② 저명 저널.
// 실측 실패 픽(2026-07-09 인지재활 타당성, 07-10 post-ICU 가족증후군)이 바닥으로
// 내려가고, 관심밖 논문은 저명저널이라도 배제되는지 회귀 고정.
const scorer = new MetadataScorer({ now: '2026-07-10' });
const one = (p) => scorer.scoreOne(p);

const CEFAZOLIN = {
  pmid: 'cef', title: 'Cefazolin vs antistaphylococcal penicillins for MSSA bacteremia: a randomized trial',
  journal: 'The New England journal of medicine', pubDate: '2026-07',
  publicationTypes: ['Randomized Controlled Trial'], abstract: 'We randomized 500 patients with bacteremia.',
  meshTerms: ['Bacteremia', 'Anti-Bacterial Agents'],
};
const REHAB_FEASIBILITY = {
  pmid: 'reh', title: 'Acceptability and Fidelity of a Cognitive Rehabilitation Intervention During Intensive Care: A Feasibility Evaluation',
  journal: 'Nursing in critical care', pubDate: '2026-07', publicationTypes: ['Journal Article'],
  abstract: 'Feasibility study of a nursing rehabilitation intervention in ICU.', meshTerms: ['Intensive Care Units', 'Rehabilitation'],
};
const MELANOMA_NEJM = {
  pmid: 'mel', title: 'Pembrolizumab for advanced melanoma: 5-year survival',
  journal: 'The New England journal of medicine', pubDate: '2026-07',
  publicationTypes: ['Randomized Controlled Trial'], abstract: 'Oncology trial of 1000 melanoma patients.',
  meshTerms: ['Melanoma', 'Immunotherapy'],
};
const SEPSIS_QI = {
  pmid: 'qi', title: 'Medical Record Abstraction for Quality Improvement in Sepsis Care Using AI: a cluster RCT',
  journal: 'JAMA network open', pubDate: '2026-07', publicationTypes: ['Randomized Controlled Trial'],
  abstract: 'Cluster RCT of AI-driven quality improvement feedback.', meshTerms: ['Sepsis', 'Quality Improvement'],
};

test('관심주제 + 최상위 저널 = 최고점 (Cefazolin/NEJM)', () => {
  const r = one(CEFAZOLIN);
  assert.equal(r.gated, false);
  assert.ok(r.rawScore >= 8, `expected high raw, got ${r.rawScore}`);
});

test('관심밖 논문은 최상위 저널이라도 배제(gated) (melanoma/NEJM)', () => {
  const r = one(MELANOMA_NEJM);
  assert.equal(r.gated, true, 'melanoma는 관심주제 무매칭이라 배제되어야');
  assert.ok(r.rawScore < one(CEFAZOLIN).rawScore);
});

test('방법론·타당성 연구는 강하게 감점되어 관심주제 논문보다 낮다', () => {
  const rehab = one(REHAB_FEASIBILITY);
  const cef = one(CEFAZOLIN);
  assert.ok(rehab.rawScore < cef.rawScore, '인지재활 타당성 < Cefazolin');
  assert.ok(rehab.rawScore < 4, `feasibility는 낮아야, got ${rehab.rawScore}`);
});

test('QI 연구는 저명 저널·RCT라도 방법론 감점으로 눌린다', () => {
  const qi = one(SEPSIS_QI);
  const cef = one(CEFAZOLIN);
  assert.ok(qi.rawScore < cef.rawScore, 'QI(JAMA Netw Open) < Cefazolin(NEJM)');
});

test('저명도 낮은 저널은 감점된다 (Sci Reports)', () => {
  const good = one({ ...CEFAZOLIN, pmid: 'g', journal: 'The New England journal of medicine' });
  const weak = one({ ...CEFAZOLIN, pmid: 'w', journal: 'Scientific reports' });
  assert.ok(weak.rawScore < good.rawScore, '같은 논문이면 저명저널이 더 높아야');
});

test('출력 계약 유지 (pmid, score, rawScore, studyType, matchedInterests)', () => {
  const r = one(CEFAZOLIN);
  for (const k of ['pmid', 'score', 'rawScore', 'qualityScore', 'relevanceScore', 'studyType', 'matchedInterests']) {
    assert.ok(k in r, `missing field: ${k}`);
  }
  assert.equal(typeof r.score, 'number');
  assert.ok(Array.isArray(r.matchedInterests));
});
