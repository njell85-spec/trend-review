import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';

// PeterJ 지시 2026-08-10: "간호지 영양학지 등 다 배제."
// 감점(-1.0)이 아니라 **배제**다. 이틀 연속 간호지가 1위로 뽑힌 뒤 나온 지시.
//
// 왜 감점으로는 부족한가: 저널 축은 대표지 3.2 대 저명도낮음 -1.0 으로 4.2점 폭인데,
// 주제 축이 4.0 까지 오르므로 감점만으로는 주제가 포화된 간호지가 여전히 상위 20 에 든다.
// 실측(2026-08-09 후보): 상위 8~20위 13편 중 4편이 간호지·유사지였다.
//
// ★ 기전: 대표지 티어가 `'critical care'` **맨몸 부분일치**라, 저널명에 그 두 단어만
//   들어가면 간호지도 3.2점을 받았다. 배제 검사를 티어 판정보다 **먼저** 둬서 끊는다.

const scorer = new MetadataScorer();
const j = (journal) => ({ pmid: '1', title: 'Sepsis trial', abstract: 'x', journal, publicationTypes: [] });

test('배제: 실제로 뽑혔던 간호지들이 배제된다', () => {
  for (const name of [
    'Intensive & critical care nursing',              // 2026-08-10 픽
    'Dimensions of critical care nursing : DCCN',     // 2026-08-09 후보 9위
    'Critical care nursing clinics of North America', // 11·12위
    'Journal of clinical nursing',
    'American journal of critical care',              // AACN 간호지
  ]) {
    assert.equal(scorer.isExcludedJournal(j(name)), true, `배제돼야 한다: ${name}`);
  }
});

test('배제: 영양학지가 배제된다', () => {
  for (const name of [
    'Clinical nutrition (Edinburgh, Scotland)',
    'Nutrients',
    'JPEN. Journal of parenteral and enteral nutrition',
    'The British journal of nutrition',
  ]) {
    assert.equal(scorer.isExcludedJournal(j(name)), true, `배제돼야 한다: ${name}`);
  }
});

test('배제: 재활·교육·보건정책·수의·치의학지도 배제된다', () => {
  for (const name of [
    'Journal of rehabilitation medicine',
    'Physical therapy',
    'Medical education online',
    'BMC medical education',
    'Health policy',
    'Journal of veterinary emergency and critical care',
    'Journal of dental research',
  ]) {
    assert.equal(scorer.isExcludedJournal(j(name)), true, `배제돼야 한다: ${name}`);
  }
});

test('★ 배제: 정상 임상지는 절대 배제되지 않는다 (오탐 = 데일리 품질 붕괴)', () => {
  for (const name of [
    'The New England journal of medicine',
    'Lancet',
    'JAMA',
    'Critical care medicine',
    'Critical care (London, England)',
    'Intensive care medicine',
    'Annals of emergency medicine',
    'Resuscitation',
    'Chest',
    'Circulation',
    'American journal of respiratory and critical care medicine',
    'Shock (Augusta, Ga.)',
    'Annals of intensive care',
    'European heart journal',
    'Stroke',
    'Clinical infectious diseases',
  ]) {
    assert.equal(scorer.isExcludedJournal(j(name)), false, `배제되면 안 된다: ${name}`);
  }
});

test('배제: 저널명이 비어 있으면 배제하지 않는다 (메타데이터 결손으로 좋은 논문을 잃지 않는다)', () => {
  assert.equal(scorer.isExcludedJournal(j('')), false);
  assert.equal(scorer.isExcludedJournal({ pmid: '1' }), false);
});

test('배제: 점수에도 드러난다 — 배제 저널은 게이트 감점으로 바닥에 깔린다', () => {
  const r = scorer.scoreOne({ ...j('Intensive & critical care nursing'), title: 'Sepsis resuscitation trial' });
  assert.equal(r.journalExcluded, true);
  assert.ok(r.rawScore < 0, `배제 저널이 양수 점수를 받는다: ${r.rawScore}`);
});

test('★ 배제: 후보 선정에서 아예 빠진다 (감점이 아니라 배제)', () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: false });
  agent.logger.info = () => {}; agent.logger.warn = () => {}; agent.logger.section = () => {};
  const papers = [
    { pmid: 'N1', title: 'Sepsis bundle adherence', abstract: 'x', journal: 'Intensive & critical care nursing', publicationTypes: ['Meta-Analysis'], pubDate: '2026-08-01' },
    { pmid: 'G1', title: 'Sepsis vasopressor trial', abstract: 'x', journal: 'Critical care medicine', publicationTypes: ['Randomized Controlled Trial'], pubDate: '2026-08-01' },
  ];
  const scores = agent.scorer.scorePapers(papers);
  const picked = agent._selectTopPapers(papers, scores, [], 5);
  assert.deepEqual(picked.map((p) => p.pmid), ['G1'], '배제 저널이 후보에 남아 있다');
});

test('★ 배제: 배제 때문에 후보가 0이 되면 폴백한다 (데일리를 죽이지 않는다)', () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: false });
  agent.logger.info = () => {}; agent.logger.warn = () => {}; agent.logger.section = () => {};
  const papers = [
    { pmid: 'N1', title: 'Sepsis bundle', abstract: 'x', journal: 'Journal of clinical nursing', publicationTypes: [], pubDate: '2026-08-01' },
    { pmid: 'N2', title: 'Sepsis care', abstract: 'x', journal: 'Nutrients', publicationTypes: [], pubDate: '2026-08-01' },
  ];
  const scores = agent.scorer.scorePapers(papers);
  const picked = agent._selectTopPapers(papers, scores, [], 1);
  assert.equal(picked.length, 1, '전부 배제되면 빈손이 아니라 폴백해야 한다');
});

// ── 코드리뷰(high) 지적 반영 ──────────────────────────────────────────────
test('★ 배제: config 가 깨져도 배제가 꺼지지 않는다 (폰 편집 사고 대비)', () => {
  // journals.json 은 PeterJ 가 폰에서 고치는 파일이다. JSON 이 깨지면 _loadJson 이
  // 조용히 임베디드 기본값으로 떨어지는데, 거기에 exclude 가 없으면 **배제가 통째로
  // 꺼진 채 아무 로그도 없이** 데일리가 돈다 — 이 개편이 막으려던 바로 그 실패다.
  // config 에 exclude 가 통째로 없어도(= 깨진 파일 → 임베디드 기본값) 배제는 살아 있다.
  const noExclude = new MetadataScorer({ journals: { tiers: {}, default: { score: 0.8 } } });
  assert.equal(noExclude.isExcludedJournal({ journal: 'Intensive & critical care nursing' }), true,
    'config 에 exclude 가 없으면 배제가 꺼진다 — 코드가 바닥을 들어야 한다');
  assert.equal(noExclude.isExcludedJournal({ journal: 'Critical care medicine' }), false);
});

test('배제: config allow 로 폰에서 되살릴 수 있다', () => {
  const revived = new MetadataScorer({
    journals: { tiers: {}, default: { score: 0.8 }, exclude: { allow: ['clinical nutrition'] } },
  });
  assert.equal(revived.isExcludedJournal({ journal: 'Clinical nutrition (Edinburgh, Scotland)' }), false);
  assert.equal(revived.isExcludedJournal({ journal: 'Nutrients' }), true, 'allow 가 다른 것까지 풀면 안 된다');
});

test('배제: 배제 사유와 주제 무매칭 사유가 구분된다', () => {
  const excluded = scorer.scoreOne(paper2('Sepsis septic shock vasopressor lactate', 'Nursing in critical care'));
  assert.equal(excluded.journalExcluded, true);
  assert.ok(!/관심주제 무매칭/.test(excluded.rationale),
    `주제가 맞는데 "관심주제 무매칭"이라고 적는다: ${excluded.rationale}`);
  assert.match(excluded.rationale, /배제/);
});

function paper2(title, journal) {
  return { pmid: '1', title, abstract: '', journal, publicationTypes: [], pubDate: '2026-08-01' };
}
