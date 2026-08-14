import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { composeDualStreams, DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { candidatesAsOf, applyArmExclusions, runReplay, armDivergence, selectMonthlyPool, SOFT_PATTERNS } from '../src/experiments/selectionReplay.js';
import { applyTopicCooldown } from '../src/utils/topicCooldown.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/replay-corpus.json', import.meta.url), 'utf8'));
const arms = JSON.parse(readFileSync(new URL('../experiments/arms.json', import.meta.url), 'utf8')).arms;
const profile = JSON.parse(readFileSync(new URL('../config/interests.json', import.meta.url), 'utf8'));
const journals = JSON.parse(readFileSync(new URL('../config/journals.json', import.meta.url), 'utf8'));
const collection = JSON.parse(readFileSync(new URL('../config/collection.json', import.meta.url), 'utf8'));
const replay = () => runReplay({ corpus: fixture.papers, arms: ['A','B','C','D'], armDefinitions: arms,
  profile, journals, collection, start: fixture.start, end: fixture.end });

test('a) edat > D 논문은 D일 후보에서 제외된다', () => {
  assert.equal(candidatesAsOf(fixture.papers, '2026-08-05').some((p) => p.pmid === '108'), false);
});

test('b) arm별 선정 PMID 목록은 독립이다', () => {
  const result = replay();
  assert.notStrictEqual(result.arms.A.selectedPmids, result.arms.B.selectedPmids);
  result.arms.A.selectedPmids.push('mutated');
  assert.equal(result.arms.B.selectedPmids.includes('mutated'), false);
});

test('c) 같은 스냅샷·arm 재생은 결정적이다', () => {
  assert.deepEqual(replay(), replay());
});

test('d) 상수 주입 기본값은 종전 점수를 바꾸지 않는다', () => {
  const paper = fixture.papers[0];
  const implicit = new MetadataScorer({ profile, journals }).scoreOne(paper);
  const explicit = new MetadataScorer({ profile, journals, scoring: {
    titleWeights: [0.5, 0.25, 0.15, 0.1], metaHitWeight: 0.08, metaHitCap: 3,
    relevanceSpan: 4, designScale: 0.5, designCap: 2,
    reviewScoreFlagship: 3.2, reviewScoreOther: 0.7,
  } }).scoreOne(paper);
  assert.equal(explicit.rawScore, implicit.rawScore);
});

test('e) C arm에서 검색 MeSH 기여가 0이다', () => {
  const p = { pmid:'mesh', title:'Unrelated title', abstract:'', journal:'JAMA', publicationTypes:[], meshTerms:['Resuscitation'], keywords:[] };
  const a = new MetadataScorer({ profile, journals, queryMeshExclusions: collection.queryMeshExclusions,
    scoring: arms.A.scoring }).scoreOne(p);
  const c = new MetadataScorer({ profile, journals, queryMeshExclusions: collection.queryMeshExclusions,
    scoring: arms.C.scoring }).scoreOne(p);
  assert.ok(a.metaHitsAfter > 0);
  assert.equal(c.metaHitsBefore, a.metaHitsBefore);
  assert.equal(c.metaHitsAfter, 0);
  assert.equal(c.contributions.relevance, 0);
});

test('f) D soft 복원은 hard 논문을 되살리지 않는다', () => {
  const scorer = new MetadataScorer({ profile, journals });
  const onlyExcluded = fixture.papers.filter((p) => ['106','107'].includes(p.pmid));
  const result = applyArmExclusions(onlyExcluded, 'D', scorer, journals);
  assert.deepEqual(result.papers.map((p) => p.pmid), ['106']);
  assert.equal(result.softRestoredCount, 1);
});

test('g) B 합성은 dedup·상한300·B최소80을 지킨다', () => {
  const a = Array.from({length:260}, (_,i) => ({ pmid:String(i+1) }));
  const b = Array.from({length:100}, (_,i) => ({ pmid:String(i+201) }));
  const merged = composeDualStreams(a, b);
  assert.equal(merged.length, 300);
  assert.equal(new Set(merged.map((p) => p.pmid)).size, 300);
  assert.ok(merged.filter((p) => p.streamSource === 'B').length >= 80);
});

test('PubMed 날짜는 history[pubmed] → ArticleDate → JournalIssue 순서다', () => {
  const collector = new DataCollectorAgent();
  const base = { MedlineCitation: { PMID: '1', Article: { ArticleTitle: 'x', Journal: {
    Title: 'JAMA', JournalIssue: { PubDate: { Year:'2024', Month:'01', Day:'01' } } },
    ArticleDate: { Year:'2025', Month:'02', Day:'02' } } }, PubmedData: { History: { PubMedPubDate: [
      { $:{ PubStatus:'received' }, Year:'2023', Month:'01', Day:'01' },
      { $:{ PubStatus:'pubmed' }, Year:'2026', Month:'03', Day:'03' },
    ] } } };
  const [paper] = collector._parseArticles({ PubmedArticleSet: { PubmedArticle: base } });
  assert.equal(paper.edat, '2026-03-03');
  assert.equal(paper.pubDateSource, 'PubmedData.History/PubMedPubDate[pubmed]');
});

// ── arm 발산 진단 (2026-08-13 재생에서 A·C·D 가 동일 결과였던 원인 규명용) ──────
test('g) armDivergence 는 배선 문제(ⓐ)와 효과 크기 문제(ⓑ)를 구분한다', () => {
  const day = (selectedPmid, ranked) => ({ date: '2026-08-01', candidateCount: ranked.length,
    excludedCount: 0, softRestoredCount: 0, fallbackTriggered: false,
    ranked, selected: selectedPmid ? { pmid: selectedPmid } : null });

  // ⓐ 점수도 후보수도 완전히 같다 → 주입이 안 닿았다
  const identical = { arms: {
    A: { selectedPmids: ['1'], days: [day('1', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 4 }])] },
    X: { selectedPmids: ['1'], days: [day('1', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 4 }])] },
  } };
  const a = armDivergence(identical).find((r) => r.arm === 'X');
  assert.equal(a.scoreDiffDays, 0);
  assert.equal(a.poolDiffDays, 0);
  assert.match(a.verdict, /배선/);

  // ⓑ 점수는 갈렸는데 top-1 은 그대로 → 효과 크기
  const nudged = { arms: {
    A: { selectedPmids: ['1'], days: [day('1', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 4 }])] },
    X: { selectedPmids: ['1'], days: [day('1', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 4.2 }])] },
  } };
  const b = armDivergence(nudged).find((r) => r.arm === 'X');
  assert.equal(b.scoreDiffDays, 1);
  assert.equal(b.pickDiffDays, 0);
  assert.equal(b.maxAbsDelta, 0.2);
  assert.match(b.verdict, /효과 크기/);

  // 실제로 갈린 경우
  const flipped = { arms: {
    A: { selectedPmids: ['1'], days: [day('1', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 4 }])] },
    X: { selectedPmids: ['2'], days: [day('2', [{ pmid: '1', rawScore: 5 }, { pmid: '2', rawScore: 6 }])] },
  } };
  assert.equal(armDivergence(flipped).find((r) => r.arm === 'X').pickDiffDays, 1);
});

test('h) D 의 배제 집합은 A 와 같다 — 티어화가 후보를 바꾸지 않는다(soft 복원 0의 이유)', () => {
  const scorer = new MetadataScorer({ profile, journals });
  const papers = fixture.papers;
  const aKept = applyArmExclusions(papers, 'A', scorer, journals);
  const dScorer = new MetadataScorer({ profile, journals: {
    ...journals, exclude: { ...journals.exclude, allow: SOFT_PATTERNS } } });
  const dKept = applyArmExclusions(papers, 'D', dScorer, journals);
  assert.deepEqual(aKept.papers.map((p) => String(p.pmid)).sort(),
    dKept.papers.map((p) => String(p.pmid)).sort());
  assert.equal(dKept.softRestoredCount, 0);
});

test('i) 월별 top-K 는 배제 저널을 먼저 걷어낸 뒤 채운다', () => {
  // 배제 저널이 월 10슬롯을 차지한 뒤 사라지면 그 달 기여가 10편 미만이 되고
  // 밀려난 정상 임상지는 보충되지 않는다 (코덱스 리뷰 2026-08-14).
  const scorer = new MetadataScorer({ profile, journals });
  const mk = (pmid, journal) => ({ pmid, title: 'Sepsis septic shock trial', abstract: 'sepsis',
    journal, publicationTypes: ['Randomized Controlled Trial'], pubDate: '2026-08-01' });
  const cand = [mk('N1', 'Intensive & critical care nursing'), mk('N2', 'Journal of clinical nursing'),
    mk('G1', 'Critical care medicine'), mk('G2', 'Resuscitation')];
  const sel = selectMonthlyPool(cand, '2026-08-05', scorer, { months: 12, monthDays: 30, keepPerMonth: 2 });
  const ids = sel.pool.map((p) => String(p.pmid)).sort();
  assert.deepEqual(ids, ['G1', 'G2'], '배제 저널이 슬롯을 먹고 사라졌다');
});

test('j) armDivergence 는 후보 수가 같아도 집합이 다르면 잡는다', () => {
  const day = (pmids) => ({ date: '2026-08-01', candidateCount: pmids.length,
    excludedCount: 0, softRestoredCount: 0, fallbackTriggered: false,
    ranked: pmids.map((p) => ({ pmid: p, rawScore: 5 })), selected: { pmid: pmids[0] } });
  const r = { arms: {
    A: { selectedPmids: ['1'], days: [day(['1', '2'])] },
    X: { selectedPmids: ['1'], days: [day(['1', '3'])] },
  } };
  assert.equal(armDivergence(r).find((x) => x.arm === 'X').poolDiffDays, 1);
});

// ── 주제 쿨다운 (PeterJ 확정 2026-08-14 "돌아가면서 나오게") ──────────────────
test('k) 쿨다운은 배제가 아니라 감점이다 — 충분히 큰 논문은 감점을 이기고 그대로 나온다', () => {
  const scored = [
    { pmid: 'SAME', rawScore: 9.0, primaryTopic: 'cardiac_resus' },  // 어제와 같은 주제, 압도적
    { pmid: 'OTHER', rawScore: 7.5, primaryTopic: 'sepsis_shock' },
  ];
  const hist = [{ topic: 'cardiac_resus', date: '2026-08-13' }];
  const out = applyTopicCooldown(scored, hist, '2026-08-14', { days: 5, penalty: -1.0 });
  assert.equal(out[0].pmid, 'SAME', '감점(-1.0)이 1.5점 차를 못 이겨야 한다');
  assert.equal(out[0].rawScore, 8.0);
});

test('l) 쿨다운이 접전에서는 주제를 바꾼다', () => {
  const scored = [
    { pmid: 'SAME', rawScore: 8.0, primaryTopic: 'cardiac_resus' },
    { pmid: 'OTHER', rawScore: 7.5, primaryTopic: 'sepsis_shock' },
  ];
  const hist = [{ topic: 'cardiac_resus', date: '2026-08-13' }];
  const out = applyTopicCooldown(scored, hist, '2026-08-14', { days: 5, penalty: -2.0 });
  assert.equal(out[0].pmid, 'OTHER', '0.5점 차는 감점 -2.0 에 뒤집혀야 한다');
});

test('m) 쿨다운은 시간이 지나면 사라지고, 끄면 아무것도 안 바뀐다', () => {
  const scored = [{ pmid: 'X', rawScore: 8.0, primaryTopic: 'cardiac_resus' }];
  const hist = [{ topic: 'cardiac_resus', date: '2026-08-13' }];
  // 5일 뒤 = 감점 0
  assert.equal(applyTopicCooldown(scored, hist, '2026-08-18', { days: 5, penalty: -2 })[0].rawScore, 8.0);
  // days 0 = 완전히 꺼짐
  assert.equal(applyTopicCooldown(scored, hist, '2026-08-14', { days: 0, penalty: -2 })[0].rawScore, 8.0);
  // penalty 0 = 완전히 꺼짐
  assert.equal(applyTopicCooldown(scored, hist, '2026-08-14', { days: 5, penalty: 0 })[0].rawScore, 8.0);
  // 이력에 없는 주제는 무영향
  assert.equal(applyTopicCooldown([{ pmid: 'Y', rawScore: 8, primaryTopic: 'trauma' }],
    hist, '2026-08-14', { days: 5, penalty: -2 })[0].rawScore, 8.0);
});
