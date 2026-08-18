import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGuidelineState, mergeCandidates, migrateGuidelineState, saveGuidelineState, appendManualEntry } from '../src/utils/guidelineState.js';
import { readPublishedLegacy } from './helpers/guidelineProduction.mjs';

// ★ 2026-08-18 — 고정 건수(7)를 하한으로 바꿨다. 가이드라인은 매일 발행되므로
//   `=== 7` 은 발행이 있는 날마다 깨진다. 이 검사의 값은 건수가 아니라
//   **무손실 마이그레이션**이다(아래 필드 대조가 그것을 본다).
const LEGACY_FLOOR = 7;   // 2026-08-17 기준 실측. 줄면 데이터 유실이다.

test('migrates every production record without field loss', async () => {
  const legacy = await readPublishedLegacy();
  const state = migrateGuidelineState(legacy);
  assert.ok(legacy.length >= LEGACY_FLOOR,
    `발행 이력이 ${legacy.length}건으로 줄었다(하한 ${LEGACY_FLOOR}) — 유실을 의심하라`);
  assert.equal(state.published.length, legacy.length);
  for (const [index, original] of legacy.entries()) {
    assert.deepEqual(state.published[index].legacy, original);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(state.published[index].legacy[key], value);
  }
  const web = state.published.find((item) => item.pmid === '');
  assert.equal(web.id, web.sourceId);
  assert.ok(web.sourceUrl);
  assert.ok(state.published.some((item) => !('org' in item.legacy)));
});

test('v2 migration is idempotent by identity and value', () => {
  const state = migrateGuidelineState([]);
  assert.strictEqual(migrateGuidelineState(state), state);
  assert.deepEqual(migrateGuidelineState(state), state);
});

test('a corrupt file never masquerades as an empty state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guideline-state-'));
  const path = join(dir, 'state.json');
  await writeFile(path, '{ broken json');
  await assert.rejects(loadGuidelineState(path), /Failed to load guideline state/);
});

test('save is atomic and verifies by reading the result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guideline-state-'));
  const path = join(dir, 'state.json');
  const state = migrateGuidelineState([]);
  const saved = await saveGuidelineState(path, state);
  assert.deepEqual(saved, state);
  assert.deepEqual(await loadGuidelineState(path), state);
});

test('merging the same candidate preserves one item and unions discovery paths', () => {
  let state = migrateGuidelineState([]);
  state = mergeCandidates(state, [{ pmid: '123', title: 'One', discoveredBy: ['pubmed-pt'] }]);
  state = mergeCandidates(state, [{ pmid: '123', title: 'One updated', discoveredBy: ['pubmed-title'] }]);
  assert.equal(state.queue.length, 1);
  assert.deepEqual(state.queue[0].discoveredBy, ['pubmed-pt', 'pubmed-title']);
  assert.equal(state.queue[0].title, 'One updated');
  assert.ok(state.queue[0].lastSeenAt);
});

test('published ids are not returned to the queue', () => {
  const state = migrateGuidelineState([{ pmid: '123', title: 'Already out', date: '2026-01-01' }]);
  const merged = mergeCandidates(state, [{ pmid: '123', title: 'Rediscovered', discoveredBy: ['pubmed-pt'] }]);
  assert.equal(merged.queue.length, 0);
});

// ── B2 회귀 (코드리뷰) ─────────────────────────────────────────────────────
// on-demand 수동 등록은 상태 파일이 배열이라고 전제하고 `list.some(...)` 을 불렀다.
// 상태 v2 가 배포되면 그 다음 날부터 `list.some is not a function` 으로 죽는데,
// 이 호출이 `publisher.publish()` 보다 **앞**이라 카드 발행 자체가 실패한다 —
// 확정 ⑤-A(PeterJ 수동 URL = 최종 승인) 경로가 통째로 막히는 것이다.

test('★ 수동 등록: v1 배열이면 배열 모양 그대로 덧붙인다', () => {
  const raw = [{ pmid: '1', title: 'a', date: '2026-08-01' }];
  const { changed, next } = appendManualEntry(raw, { pmid: '2', title: 'b', date: '2026-08-02' });
  assert.equal(changed, true);
  assert.ok(Array.isArray(next), '모양을 멋대로 승격하면 안 된다');
  assert.equal(next.length, 2);
});

test('★ 수동 등록: v2 객체여도 죽지 않고 published 에 들어간다 (⑤-A)', () => {
  const raw = { schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' };
  const { changed, next } = appendManualEntry(raw, {
    pmid: '', title: 'IDSA guidance', date: '2026-08-16',
    sourceUrl: 'https://www.idsociety.org/x/', sourceId: 'web:idsociety-x',
  });
  assert.equal(changed, true);
  assert.equal(next.schemaVersion, 2, 'v2 모양을 유지해야 한다');
  assert.equal(next.published.length, 1);
  assert.equal(next.published[0].manualApproved, true, '수동 승인은 큐를 거치지 않는다');
  assert.equal(next.published[0].sourceId, 'web:idsociety-x');
});

test('★ 수동 등록: v2 에서도 중복은 다시 넣지 않는다', () => {
  const raw = { schemaVersion: 2, queue: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2',
    published: [{ id: 'pmid:42', pmid: '42', title: 't', status: 'current' }] };
  const { changed } = appendManualEntry(raw, { pmid: '42', title: 't', date: '2026-08-16' });
  assert.equal(changed, false);
});

test('★ 수동 등록: 마이그레이션된 레거시 항목과도 중복 판정이 된다', () => {
  const raw = { schemaVersion: 2, queue: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2',
    published: [{ id: 'web:idsociety-x', legacy: { pmid: '', sourceId: 'web:idsociety-x' }, status: 'current' }] };
  const { changed } = appendManualEntry(raw, { pmid: '', sourceId: 'web:idsociety-x', title: 't', date: '2026-08-16' });
  assert.equal(changed, false);
});
