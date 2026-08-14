import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';

const today = '2026-08-14';
const history = [{ topic: 'cardiac_resus', date: '2026-08-13' }];
const papers = [
  { pmid: 'A', title: 'A', journal: 'JAMA' },
  { pmid: 'B', title: 'B', journal: 'JAMA' },
];

function select(scores, cfg, selectedHistory = history) {
  const agent = new FilterAnalyzerAgent({ topN: 2, topicCooldown: cfg });
  return agent._selectTopPapers(papers, scores, { history: selectedHistory, today });
}

test('days:0 or penalty:0 produces identical results', () => {
  const scores = [
    { pmid: 'A', rawScore: 8.2, primaryTopic: 'cardiac_resus' },
    { pmid: 'B', rawScore: 8.0, primaryTopic: 'sepsis_shock' },
  ];
  const baseline = select(scores, { days: 5, penalty: -2 }, []).map((p) => p.pmid);
  assert.deepEqual(select(scores, { days: 0, penalty: -2 }).map((p) => p.pmid), baseline);
  assert.deepEqual(select(scores, { days: 5, penalty: 0 }).map((p) => p.pmid), baseline);
});

test('a 0.2 gap reverses when the leading topic was selected yesterday', () => {
  const result = select([
    { pmid: 'A', rawScore: 8.2, primaryTopic: 'cardiac_resus' },
    { pmid: 'B', rawScore: 8.0, primaryTopic: 'sepsis_shock' },
  ], { days: 5, penalty: -2 });
  assert.deepEqual(result.map((p) => p.pmid), ['B', 'A']);
  assert.equal(result[1].scoringData.cooldownPenalty, -2);
});

test('cooldown is a penalty, not exclusion: a 2.5 gap keeps A first', () => {
  const result = select([
    { pmid: 'A', rawScore: 10.5, primaryTopic: 'cardiac_resus' },
    { pmid: 'B', rawScore: 8.0, primaryTopic: 'sepsis_shock' },
  ], { days: 5, penalty: -2 });
  assert.equal(result[0].pmid, 'A');
  assert.equal(result[0].scoringData.rawScore, 8.5);
  assert.equal(result[0].scoringData.cooldownPenalty, -2);
});

test('history entries without topic are backward compatible and apply no penalty', () => {
  const result = select([
    { pmid: 'A', rawScore: 8.2, primaryTopic: 'cardiac_resus' },
    { pmid: 'B', rawScore: 8.0, primaryTopic: 'sepsis_shock' },
  ], { days: 5, penalty: -2 }, [{ date: '2026-08-13' }]);
  assert.deepEqual(result.map((p) => p.pmid), ['A', 'B']);
  assert.equal(result[0].scoringData.cooldownPenalty, 0);
});

test('a null primary topic receives zero penalty', () => {
  const result = select([
    { pmid: 'A', rawScore: 8.2, primaryTopic: null },
    { pmid: 'B', rawScore: 8.0, primaryTopic: 'sepsis_shock' },
  ], { days: 5, penalty: -2 }, [{ topic: null, date: '2026-08-13' }]);
  assert.equal(result[0].pmid, 'A');
  assert.equal(result[0].scoringData.cooldownPenalty, 0);
});
