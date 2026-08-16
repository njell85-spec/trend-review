import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

const item = (pmid) => ({ pmid, title: `리뷰 ${pmid}`, journal: 'Journal', score: 9 });
const state = (queue = [], lastRun = null) => ({
  schemaVersion: 1, track: 'reviews', queue, published: [], rejected: [], lastRun, updatedAt: null,
});

async function setup(queue = [], lastRun = null) {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-stage-'));
  const queueFile = path.join(dir, 'queue_reviews.json');
  const controlFile = path.join(dir, 'control_state.json');
  await writeFile(queueFile, JSON.stringify(state(queue, lastRun)));
  const o = new TrendReviewOrchestrator({ queueReviewsPath: queueFile, controlStatePath: controlFile });
  return { o, queueFile, controlFile };
}

test('마지막 발행 6일째에는 주간 게이트로 건너뛴다', async () => {
  const { o, queueFile } = await setup([item('1')], { date: '2026-08-10', outcome: 'published' });
  assert.deepEqual(await o._stageReview('2026-08-16'), { outcome: 'skipped', reason: 'weekly-gate' });
  assert.equal(JSON.parse(await readFile(queueFile, 'utf8')).queue.length, 1);
});

test('마지막 발행 7일째에는 한 편을 발행한다', async () => {
  const { o } = await setup([item('1')], { date: '2026-08-10', outcome: 'published' });
  assert.equal((await o._stageReview('2026-08-17')).outcome, 'published');
});

test('빈 큐는 예외 없이 empty를 돌려준다', async () => {
  const { o } = await setup();
  await assert.doesNotReject(async () => assert.deepEqual(await o._stageReview('2026-08-16'), { outcome: 'empty' }));
});

test('리뷰 트랙이 off면 큐를 발행하지 않는다', async () => {
  const { o, queueFile, controlFile } = await setup([item('1')]);
  await writeFile(controlFile, JSON.stringify({ tracks: { reviews: { mode: 'off' } } }));
  assert.deepEqual(await o._stageReview('2026-08-16'), { outcome: 'skipped', reason: 'track-off' });
  assert.equal(JSON.parse(await readFile(queueFile, 'utf8')).published.length, 0);
});

test('깨진 제어 파일은 전부 on으로 취급해 발행한다', async () => {
  const { o, controlFile } = await setup([item('1')]);
  await writeFile(controlFile, '{broken');
  assert.equal((await o._stageReview('2026-08-16')).outcome, 'published');
});

test('발행한 머리 항목은 queue에서 빠져 published로 옮겨진다', async () => {
  const { o, queueFile } = await setup([item('1'), item('2')]);
  await o._stageReview('2026-08-16');
  const saved = JSON.parse(await readFile(queueFile, 'utf8'));
  assert.deepEqual(saved.queue.map((x) => x.pmid), ['2']);
  assert.deepEqual(saved.published.map((x) => x.pmid), ['1']);
  assert.equal(saved.lastRun.date, '2026-08-16');
});

test('alternate 모드는 마지막 발행 후 13일에는 건너뛴다', async () => {
  const { o, controlFile } = await setup([item('1')], { date: '2026-08-01' });
  await writeFile(controlFile, JSON.stringify({ tracks: { reviews: { mode: 'alternate' } } }));
  assert.deepEqual(await o._stageReview('2026-08-14'), { outcome: 'skipped', reason: 'weekly-gate' });
});

test('alternate 모드는 마지막 발행 후 14일에 발행한다', async () => {
  const { o, controlFile } = await setup([item('1')], { date: '2026-08-01' });
  await writeFile(controlFile, JSON.stringify({ tracks: { reviews: { mode: 'alternate' } } }));
  assert.equal((await o._stageReview('2026-08-15')).outcome, 'published');
});

test('리뷰 단계가 예외를 던져도 데일리 논문 발행 경로는 살아남는다', async () => {
  const { o } = await setup();
  o._stageCollect = async () => ({ papers: [{ pmid: 'paper-1' }], stats: {} });
  o._stageValidate1 = async (papers) => ({ papers, stats: {} });
  o._buildSelectionPool = (papers) => papers;
  o._saveTrack1Queue = async () => {};
  o._loadExcludePmids = async () => [];
  o._stageAnalyze = async (papers) => ({ topPapers: papers, allScoredPapers: papers, rerank: null });
  o._stageFetchFullText = async (papers) => papers;
  o._stagePicoAnalysis = async (papers) => ({ topPapers: papers, stats: {} });
  o._stageValidate2 = async (papers) => ({ validated: papers, qualityReport: {} });
  o._stageReport = async () => ({ jsonPath: 'r.json', htmlPath: 'r.html' });
  o._stageGuideline = async () => null;
  o._stageReview = async () => { throw new Error('review boom'); };
  o._saveExcludePmids = async () => {};
  let published = 0;
  o._stagePublish = async () => { published += 1; return 'pages'; };
  o._stageNotify = async () => null;
  o.logger.saveSession = async () => {};
  await o.run();
  assert.equal(published, 1);
});
