import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGuidelineBackfill } from '../src/utils/guidelineBackfill.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const interests = { topicGroups: { resus: { weight: 1, terms: ['cardiac arrest'] } } };
const item = (pmid) => ({ id: `pmid:${pmid}`, pmid, title: `2026 AHA cardiac arrest guideline ${pmid}`, pubDate: '2026-07-01', publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'] });
const result = (pmids, ptPmids = pmids) => ({ candidates: pmids.map(item), manifest: { queries: [], ptPmids, window: {} } });
const opts = (collect, extra = {}) => ({ windows: '60-30', today: new Date('2026-08-15T00:00:00Z'), fetchJson: async () => ({}), collect, orgs: loadGuidelineOrgs(), interests, ...extra });

test('같은 창 재실행 결과가 멱등이다', async () => {
  const collect = async () => result(['1']);
  const a = await runGuidelineBackfill(opts(collect));
  const b = await runGuidelineBackfill(opts(collect));
  delete a.generatedAt; delete b.generatedAt;
  assert.deepEqual(a, b);
});

test('dry-run은 상태 파일을 바꾸지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'backfill-'));
  const file = path.join(dir, 'state.json');
  const initial = JSON.stringify({ schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' });
  await writeFile(file, initial);
  await runGuidelineBackfill(opts(async () => result(['1']), { statePath: file }));
  assert.equal(await readFile(file, 'utf8'), initial);
});

test('이미 published인 후보는 다시 큐에 넣지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'backfill-pub-'));
  const file = path.join(dir, 'state.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 2, queue: [], published: [{ ...item('1'), status: 'current' }], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' }));
  const report = await runGuidelineBackfill(opts(async () => result(['1']), { statePath: file }));
  assert.equal(report.windows[0].counts.queued, 0);
});

test('초집합 위반은 stopSignals에 실린다', async () => {
  const report = await runGuidelineBackfill(opts(async () => result(['1'], ['1', '9'])));
  assert.equal(report.windows[0].supersetViolation.violated, true);
  assert.match(report.stopSignals[0], /①.*9/);
});

test('중간 창 실패 후에도 나머지 창을 계속한다', async () => {
  let calls = 0;
  const collect = async () => { calls += 1; if (calls === 2) throw new Error('middle failed'); return result([String(calls)]); };
  const report = await runGuidelineBackfill(opts(collect, { windows: '60-30,150-120,240-210' }));
  assert.equal(report.windows.length, 3);
  assert.equal(report.windows[1].error, 'middle failed');
  assert.equal(calls, 3);
});
