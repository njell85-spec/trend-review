import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyQueue } from '../src/utils/trackQueue.js';
import {
  buildReviewQueue, itemsForSet, publicationYear, recencyBonus,
  scoreReviewItems, spreadJournals,
} from '../src/utils/reviewQueue.js';

const scorer = { scorePapers: (papers) => papers.map((paper) => ({
  pmid: paper.pmid, score: paper.baseScore ?? 5, primaryTopic: 'resp_airway',
  relevanceScore: 5, gated: false,
})) };
const paper = (pmid, year, journal = 'A', baseScore = 5) => ({
  pmid, title: `리뷰 ${pmid}`, journal, date: `${year} Jan 1`, types: ['Review'], baseScore,
});

test('발행 연도는 실제 date 필드에서 읽는다', () => {
  assert.equal(publicationYear({ date: '2024 Dec 3' }), 2024);
  assert.equal(publicationYear({ date: '날짜 없음' }), null);
});

test('연도 가중은 최신 리뷰를 올리되 최종 점수의 20%를 넘지 않는다', () => {
  const oldBonus = recencyBonus(paper('old', 2021), { currentYear: 2026 });
  const newBonus = recencyBonus(paper('new', 2026), { currentYear: 2026 });
  assert.ok(newBonus > oldBonus);
  assert.ok(newBonus / (10 + newBonus) <= 0.2);
  const ranked = scoreReviewItems([paper('old', 2021), paper('new', 2026)], scorer, { currentYear: 2026 });
  assert.deepEqual(ranked.map((item) => item.pmid), ['new', 'old']);
});

test('기본 점수 차이가 크면 최신성이 순위를 지배하지 않는다', () => {
  const ranked = scoreReviewItems([paper('old', 2021, 'A', 9), paper('new', 2026, 'B', 5)], scorer,
    { currentYear: 2026 });
  assert.deepEqual(ranked.map((item) => item.pmid), ['old', 'new']);
});

test('큐 항목은 trackQueue 관례의 필드만 가진다', () => {
  const [item] = scoreReviewItems([paper('1', 2026)], scorer, { currentYear: 2026 });
  assert.deepEqual(Object.keys(item).sort(),
    ['journal', 'lowConfidence', 'pmid', 'score', 'title', 'topic'].sort());
});

test('같은 저널이 4건 연속으로 배치되지 않는다', () => {
  const input = ['1', '2', '3', '4', '5'].map((id) => ({ pmid: id, journal: 'A' }));
  input.push({ pmid: 'x', journal: 'B' });
  const arranged = spreadJournals(input);
  assert.deepEqual(arranged.slice(0, 4).map((item) => item.journal), ['A', 'A', 'A', 'B']);
  assert.doesNotMatch(arranged.map((item) => item.journal).join(''), /AAAA/);
});

test('저널 분산은 점수를 바꾸지 않고 항목도 잃지 않는다', () => {
  const input = [{ pmid: '1', journal: 'A', score: 9 }, { pmid: '2', journal: 'B', score: 8 }];
  const arranged = spreadJournals(input, 1);
  assert.deepEqual(arranged.map(({ pmid, score }) => ({ pmid, score })), input.map(({ pmid, score }) => ({ pmid, score })));
});

test('같은 후보로 두 번 병합해도 큐가 불어나지 않는다', () => {
  const args = { papers: [paper('1', 2026), paper('2', 2025)], scorer, limit: 10,
    today: '2026-08-16', currentYear: 2026 };
  const once = buildReviewQueue({ ...args, state: emptyQueue('reviews') });
  const twice = buildReviewQueue({ ...args, state: once });
  assert.equal(once.queue.length, 2);
  assert.equal(twice.queue.length, 2);
  assert.deepEqual(twice.queue, once.queue);
});

test('빈 입력은 빈 큐로 처리한다', () => {
  const result = buildReviewQueue({ state: emptyQueue('reviews'), papers: [], scorer,
    today: '2026-08-16', currentYear: 2026 });
  assert.deepEqual(result.queue, []);
});

test('없는 축과 잘못된 문서 구조는 빈 입력으로 처리한다', () => {
  assert.deepEqual(itemsForSet({}, 'core4'), []);
  assert.deepEqual(itemsForSet({ axes: {} }, 'wide'), []);
  assert.deepEqual(itemsForSet({ axes: { review_core4: { items: null } } }, 'core4'), []);
});

test('limit만큼만 상위 후보를 큐에 넣는다', () => {
  const result = buildReviewQueue({ state: emptyQueue('reviews'),
    papers: [paper('1', 2026, 'A', 3), paper('2', 2026, 'B', 8)], scorer,
    limit: 1, today: '2026-08-16', currentYear: 2026 });
  assert.deepEqual(result.queue.map((item) => item.pmid), ['2']);
});
