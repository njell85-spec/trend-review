import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadGuidelineState, mergeCandidates, migrateGuidelineState, saveGuidelineState,
} from '../src/utils/guidelineState.js';

const productionPath = new URL('../output/selected_guidelines.json', import.meta.url);

test('migrates all seven production records without field loss', async () => {
  const legacy = JSON.parse(await readFile(productionPath, 'utf8'));
  const state = migrateGuidelineState(legacy);
  assert.equal(legacy.length, 7);
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
