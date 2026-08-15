import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGuidelineBackfill, simulateDailyPublishing } from '../src/utils/guidelineBackfill.js';
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

// ── 세션 검수에서 추가한 것 ────────────────────────────────────────────────
// 네트워크가 끊긴 컨테이너에서 CLI 를 실제로 돌려 보니, **수집이 통째로 실패한 창**을
// `stopSignals: []` · exit 0 으로 보고했다. PubMed 가 죽은 날의 실행이 "깨끗한 실험,
// 문제 없음" 으로 읽힌다 — 계획서 §11 이 막으려는 무음 실패가 실험 도구 자신에게서 났다.

test('★ 수집이 실패한 창은 정지 신호로 올라온다 (발견 0건으로 위장 금지)', async () => {
  const report = await runGuidelineBackfill({
    windows: ['60-30'],
    fetchJson: async () => { throw new Error('network down'); },
    now: new Date('2026-08-15T00:00:00Z'),
  });
  assert.equal(report.windows[0].error !== undefined, true);
  assert.equal(report.failedWindows.length, 1);
  assert.equal(report.evaluatedWindows, 0);
  assert.ok(report.stopSignals.some((s) => s.includes('수집 실패')),
    '실패한 창이 정지 신호에 없다 — 실패한 실험이 성공처럼 보인다');
});

test('★ 실패한 창의 초집합 판정은 false(위반 없음)가 아니라 판정 불가다', async () => {
  const report = await runGuidelineBackfill({
    windows: ['60-30'],
    fetchJson: async () => { throw new Error('network down'); },
    now: new Date('2026-08-15T00:00:00Z'),
  });
  assert.equal(report.windows[0].supersetViolation.violated, null,
    'false 는 "검사했고 위반 없음" 이라는 뜻이라 거짓말이 된다');
  assert.equal(report.windows[0].supersetViolation.evaluated, false);
});

// ── 일자별 발행 시뮬레이션 ────────────────────────────────────────────────
// 개수만 세는 것과 다르다. 개수는 "자격이 되는 게 몇 건인가", 이것은 "그날 아침
// 이 로직이 돌았다면 무엇이 뽑혔을까" 다. 프로덕션 `_stageGuideline()` 과 같은 규칙:
// 그날까지 발행된 문서만 · 재발행 없음 · 하루 한 편 · 빈 큐면 건너뜀.

const q = (pmid, priority, pubDate) => ({ id: `pmid:${pmid}`, pmid, priority, pubDate,
  status: 'queued', title: `Guideline ${pmid}` });

test('★ 하루 한 편씩, priority 순으로 나간다', () => {
  const sim = simulateDailyPublishing(
    [q('1', 10, '2026-07-01'), q('2', 9, '2026-07-01'), q('3', 8, '2026-07-01')],
    { minDate: '2026/07/01', maxDate: '2026/07/03' });
  assert.deepEqual(sim.days.map((d) => d.pmid), ['1', '2', '3']);
  assert.equal(sim.publishedDays, 3);
  assert.equal(sim.skippedDays, 0);
});

test('★ 아직 발행 안 된 문서를 미리 뽑지 않는다', () => {
  const sim = simulateDailyPublishing(
    [q('late', 10, '2026-07-05')],
    { minDate: '2026/07/01', maxDate: '2026/07/06' });
  const first = sim.days.find((d) => d.outcome === 'published');
  assert.equal(first.date, '2026-07-05', '문서 발행일 전에 뽑으면 미래를 훔쳐보는 것이다');
  assert.equal(sim.days.slice(0, 4).every((d) => d.outcome === 'empty'), true);
});

test('★ 큐가 마르면 그날부터는 건너뛴다 (확정 ④-D)', () => {
  const sim = simulateDailyPublishing(
    [q('1', 10, '2026-07-01')],
    { minDate: '2026/07/01', maxDate: '2026/07/05' });
  assert.equal(sim.publishedDays, 1);
  assert.equal(sim.skippedDays, 4);
  assert.equal(sim.coverage, 0.2);
});

test('★ 같은 문서를 두 번 발행하지 않는다', () => {
  const sim = simulateDailyPublishing(
    [q('1', 10, '2026-07-01')],
    { minDate: '2026/07/01', maxDate: '2026/07/03' });
  const pmids = sim.days.filter((d) => d.outcome === 'published').map((d) => d.pmid);
  assert.equal(new Set(pmids).size, pmids.length);
});

test('★ needsReview·rejected 는 시뮬레이션에 안 들어간다 (자동 발행 대상이 아니다)', () => {
  const sim = simulateDailyPublishing(
    [{ ...q('1', 10, '2026-07-01'), status: 'needsReview' },
     { ...q('2', 9, '2026-07-01'), status: 'rejected' }],
    { minDate: '2026/07/01', maxDate: '2026/07/03' });
  assert.equal(sim.publishedDays, 0);
});
