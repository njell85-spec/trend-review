import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  emptyQueue, loadTrackQueue, mergeQueueItems, saveTrackQueue,
} from '../src/utils/trackQueue.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

const item = (pmid, score = 5) => ({
  pmid, title: `논문 ${pmid}`, journal: 'JAMA', score,
  topic: 'sepsis_shock', lowConfidence: false,
});

async function tempPath() {
  const dir = await mkdtemp(path.join(tmpdir(), 'track-queue-'));
  return { dir, file: path.join(dir, 'queue.json') };
}

test('빈 큐는 트랙과 고정 스키마를 가진다', () => {
  assert.deepEqual(emptyQueue('papers'), {
    schemaVersion: 1, track: 'papers', queue: [], published: [], rejected: [],
    lastRun: null, updatedAt: null,
  });
});

test('파일이 없으면 빈 큐를 반환한다', async () => {
  const { file } = await tempPath();
  assert.deepEqual(await loadTrackQueue(file, 'papers'), emptyQueue('papers'));
});

test('깨진 JSON은 빈 큐로 둔갑하지 않고 예외를 던진다', async () => {
  const { file } = await tempPath();
  await writeFile(file, '{broken');
  await assert.rejects(loadTrackQueue(file, 'papers'), /Failed to load track queue/);
});

test('유효하지 않은 상태도 읽기 검증에서 거부한다', async () => {
  const { file } = await tempPath();
  await writeFile(file, JSON.stringify({ schemaVersion: 1, track: 'papers', queue: {} }));
  await assert.rejects(loadTrackQueue(file, 'papers'), /Failed to load track queue/);
});

test('원자적으로 저장하고 다시 읽어 같은 상태인지 검증한다', async () => {
  const { dir, file } = await tempPath();
  const state = { ...emptyQueue('papers'), queue: [{ ...item('1'), addedAt: '2026-08-16' }] };
  const saved = await saveTrackQueue(file, state);
  assert.deepEqual(saved, state);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
});

test('published에 있는 PMID는 새 큐에서 제외한다', () => {
  const state = { ...emptyQueue('papers'), published: [item('1')] };
  assert.deepEqual(mergeQueueItems(state, [item('1')], { today: '2026-08-16' }).queue, []);
});

test('rejected에 있는 PMID는 새 큐에서 제외한다', () => {
  const state = { ...emptyQueue('papers'), rejected: [item('2')] };
  assert.deepEqual(mergeQueueItems(state, [item('2')], { today: '2026-08-16' }).queue, []);
});

test('기존 queue와 입력 내부의 중복 PMID도 한 번만 유지한다', () => {
  const state = { ...emptyQueue('papers'), queue: [{ ...item('3', 4), addedAt: '2026-08-15' }] };
  const result = mergeQueueItems(state, [item('3', 9), item('4'), item('4', 8)], { today: '2026-08-16' });
  assert.deepEqual(result.queue.map((x) => x.pmid), ['4', '3']);
  assert.equal(result.queue.filter((x) => x.pmid === '3')[0].score, 4);
  assert.equal(result.queue.filter((x) => x.pmid === '3')[0].addedAt, '2026-08-15');
});

test('점수 내림차순과 동점 PMID 오름차순으로 결정적 정렬한다', () => {
  const result = mergeQueueItems(emptyQueue('papers'), [
    item('20', 7), item('3', 9), item('10', 7),
  ], { today: '2026-08-16' });
  assert.deepEqual(result.queue.map((x) => x.pmid), ['3', '10', '20']);
  assert.ok(result.queue.every((x) => x.addedAt === '2026-08-16'));
});

test('병합은 상태와 입력 객체를 변형하지 않는다', () => {
  const state = { ...emptyQueue('papers'), queue: [{ ...item('1'), addedAt: '2026-08-15' }] };
  const items = [item('2')];
  const beforeState = structuredClone(state);
  const beforeItems = structuredClone(items);
  const result = mergeQueueItems(state, items, { today: '2026-08-16' });
  assert.deepEqual(state, beforeState);
  assert.deepEqual(items, beforeItems);
  assert.notEqual(result, state);
  assert.notEqual(result.queue, state.queue);
});

test('오케스트레이터는 큐 경로 옵션과 기본값을 사용한다', async () => {
  const { dir } = await tempPath();
  const custom = path.join(dir, 'custom.json');
  assert.equal(new TrendReviewOrchestrator({ outputDir: dir }).queuePapersPath,
    path.join(dir, 'queue_papers.json'));
  assert.equal(new TrendReviewOrchestrator({ outputDir: dir, queuePapersPath: custom }).queuePapersPath, custom);
});

test('선정 풀 상위 14편을 실제 score와 topic 필드로 저장한다', async () => {
  const { dir, file } = await tempPath();
  const orch = new TrendReviewOrchestrator({ outputDir: dir, queuePapersPath: file });
  orch.filter.scorer = {
    scorePapers: (papers) => papers.map((paper) => ({
      pmid: paper.pmid, score: Number(paper.pmid), rawScore: Number(paper.pmid),
      primaryTopic: `topic-${paper.pmid}`,
    })),
  };
  const pool = Array.from({ length: 16 }, (_, i) => ({
    pmid: String(i + 1), title: `제목 ${i + 1}`, journal: `저널 ${i + 1}`,
  }));
  await orch._saveTrack1Queue(pool, '2026-08-16');
  const state = await loadTrackQueue(file, 'papers');
  assert.equal(state.queue.length, 14);
  assert.deepEqual(state.queue.slice(0, 2).map((x) => x.pmid), ['16', '15']);
  assert.deepEqual(state.queue[0], {
    pmid: '16', title: '제목 16', journal: '저널 16', score: 16,
    topic: 'topic-16', addedAt: '2026-08-16', lowConfidence: false,
  });
});

test('큐 저장 실패는 경고만 남기고 데일리 호출부로 전파하지 않는다', async () => {
  const { dir } = await tempPath();
  const orch = new TrendReviewOrchestrator({ outputDir: dir, queuePapersPath: dir });
  orch.filter.scorer = { scorePapers: () => [
    { pmid: '1', score: 9, rawScore: 9, primaryTopic: 'sepsis' },
  ] };
  let warning = null;
  orch.logger.warn = (message, meta) => { warning = { message, meta }; };
  await assert.doesNotReject(orch._saveTrack1Queue([
    { pmid: '1', title: '제목', journal: '저널' },
  ], '2026-08-16'));
  assert.match(warning.message, /큐 저장 실패/);
  assert.ok(warning.meta.err);
});

// ★ 실버그 회귀 (병합 전 검수에서 잡음, 2026-08-16).
// 예비 큐는 `_buildSelectionPool()` 직후에 저장되는데, 그 시점의 풀에는
// **이미 발행된 논문이 아직 섞여 있다** — 제외는 그 다음 `_stageAnalyze` 에서 일어난다.
// 그래서 제외 목록을 넘기지 않으면 **예고 리스트에 PeterJ가 이미 읽은 논문이 뜬다.**
// 큐의 published/rejected 검사로는 못 잡는다 — 그건 큐 자신의 이력이지 발행 장부가 아니다.
test('★ 이미 발행된 pmid 는 예비 큐에 들어가지 않는다 (exclude 목록 반영)', () => {
  const state = emptyQueue('papers');
  const items = [
    { pmid: '111', title: '이미 발행됨', score: 9 },
    { pmid: '222', title: '새 논문', score: 8 },
  ];
  const merged = mergeQueueItems(state, items, { today: '2026-08-16', excludePmids: ['111'] });
  assert.deepEqual(merged.queue.map((x) => x.pmid), ['222'], '발행된 111 이 큐에 남았다');
});

test('exclude 목록은 숫자·문자 pmid 를 섞어 줘도 걸러낸다', () => {
  // 양방향 다 본다 — 장부에서 숫자로 올 수도, 풀에서 숫자로 올 수도 있다.
  // 한쪽만 검사하면 String() 을 빼는 변이가 안 잡힌다(실측).
  const a = mergeQueueItems(emptyQueue('papers'),
    [{ pmid: 111, title: 'a', score: 1 }], { today: '2026-08-16', excludePmids: ['111'] });
  assert.equal(a.queue.length, 0, '풀이 숫자 · 장부가 문자');
  const b = mergeQueueItems(emptyQueue('papers'),
    [{ pmid: '111', title: 'a', score: 1 }], { today: '2026-08-16', excludePmids: [111] });
  assert.equal(b.queue.length, 0, '풀이 문자 · 장부가 숫자');
});
