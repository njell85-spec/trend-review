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

// ★ 계약 변경 (PeterJ 확정 2026-08-16 · 4-A) — "세 트랙 전부 매일" 로 바뀌었다.
//   종전 계약은 주 1회(6일째 skip · 7일째 발행)였고 그것을 여기서 잠그고 있었다.
//   간격은 `src/utils/trackCadence.js` 한 곳에서 온다 — 예고 렌더도 같은 값을 보므로
//   화면과 실제가 어긋날 수 없다. PeterJ 가 "며칠 돌려보고 재설정" 하겠다고 했으므로
//   그 파일의 숫자만 고치면 이 계약도 같이 움직인다.
test('같은 날 두 번 돌면 두 번째는 게이트로 건너뛴다', async () => {
  const { o, queueFile } = await setup([item('1')], { date: '2026-08-16', outcome: 'published' });
  assert.deepEqual(await o._stageReview('2026-08-16'), { outcome: 'skipped', reason: 'weekly-gate' });
  assert.equal(JSON.parse(await readFile(queueFile, 'utf8')).queue.length, 1);
});

test('어제 발행했으면 오늘 또 발행한다 (4-A · 매일)', async () => {
  const { o } = await setup([item('1')], { date: '2026-08-15', outcome: 'published' });
  assert.equal((await o._stageReview('2026-08-16')).outcome, 'published');
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

// 격일 모드는 기본 간격의 2배다 — 4-A 에서 기본이 1일이므로 격일은 2일이 된다.
test('alternate 모드는 발행 다음 날에는 건너뛴다', async () => {
  const { o, controlFile } = await setup([item('1')], { date: '2026-08-14' });
  await writeFile(controlFile, JSON.stringify({ tracks: { reviews: { mode: 'alternate' } } }));
  assert.deepEqual(await o._stageReview('2026-08-15'), { outcome: 'skipped', reason: 'weekly-gate' });
});

test('alternate 모드는 발행 이틀 뒤에 발행한다', async () => {
  const { o, controlFile } = await setup([item('1')], { date: '2026-08-14' });
  await writeFile(controlFile, JSON.stringify({ tracks: { reviews: { mode: 'alternate' } } }));
  assert.equal((await o._stageReview('2026-08-16')).outcome, 'published');
});

// ★ 순차진행 (PeterJ 확정 2026-08-16) — 켜면 논문 → 가이드라인 → 리뷰 하루 한 트랙.
//   게이트와 예고가 **같은 함수**를 보는지까지 확인한다(따로 계산하면 화면이 거짓말한다).
test('순차진행이 켜지면 리뷰는 자기 차례 날에만 발행한다', async () => {
  const { sequentialTrackFor } = await import('../src/utils/trackCadence.js');
  const mine = ['2026-08-17', '2026-08-18', '2026-08-19'].find((d) => sequentialTrackFor(d) === 'reviews');
  const notMine = ['2026-08-17', '2026-08-18', '2026-08-19'].find((d) => sequentialTrackFor(d) !== 'reviews');

  const a = await setup([item('1')]);
  await writeFile(a.controlFile, JSON.stringify({ sequential: true }));
  assert.deepEqual(await a.o._stageReview(notMine), { outcome: 'skipped', reason: 'sequential-gate' });

  const b = await setup([item('1')]);
  await writeFile(b.controlFile, JSON.stringify({ sequential: true }));
  assert.equal((await b.o._stageReview(mine)).outcome, 'published');
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
