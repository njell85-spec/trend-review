import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { emptyQueue } from '../src/utils/trackQueue.js';
import { nextPaper, publishablePapers, needsRefill, REFILL_FLOOR } from '../src/utils/paperQueue.js';

/**
 * ★★ PeterJ 확정 2026-08-18
 *   *"예비리스트에서 순서대로 안 뽑히면 예비리스트가 무슨 소용이 있니…"*
 *   *"예비리스트가 미리 선정 돌린 거로 보고 당일에는 예비리스트를 분석만 하는 걸로."*
 *
 *   종전에는 트랙2(가이드라인)·트랙3(리뷰)만 예정리스트에서 꺼내 썼고 **트랙1만 매일
 *   PubMed 를 새로 뒤져 그 자리에서 뽑았다.** 그래서 2026-08-18 에 예정리스트에 없던
 *   AHA 지침 문서가 "오늘의 논문" 으로 나갔다. 화면이 "다음은 이것" 이라고 말하는데
 *   실제로는 딴 게 나가는, 이 저장소가 반복해서 낸 사고의 가장 큰 판이다.
 *
 * ★ 이 파일은 **실제 `run()` 을 태운다.** 순수 함수만 검사하면 "모듈은 옳은데 아무도
 *   안 부른다" 를 못 잡는다 — 이 저장소 최다 반복 함정이다.
 */

async function sandbox(queue) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-pq-'));
  // ★ 디렉터리 이름을 `output` 으로 두면 안 된다 — `saveTrackQueue` 의 테스트 가드가
  //   경로에 `output/` 이 보이면 "테스트가 프로덕션 경로에 쓰려 한다" 로 던진다.
  //   그 가드는 실제 사고(픽스처가 운영 큐를 오염) 때문에 생긴 것이라 유지하고,
  //   여기서 이름만 피한다.
  await mkdir(path.join(dir, 'state'), { recursive: true });
  await writeFile(path.join(dir, 'state', 'control_state.json'),
    JSON.stringify({ schemaVersion: 1, tracks: {} }));
  await writeFile(path.join(dir, 'state', 'queue_papers.json'),
    JSON.stringify({ ...emptyQueue('papers'), queue }, null, 2));
  return dir;
}

/** run() 을 태우되 네트워크·LLM 은 전부 스텁. 무엇이 불렸는지 기록한다. */
function harness(dir, { articles = {} } = {}) {
  const o = new TrendReviewOrchestrator({
    controlStatePath: path.join(dir, 'state', 'control_state.json'),
    queuePapersPath: path.join(dir, 'state', 'queue_papers.json'),
    outputDir: path.join(dir, 'state'),
  });
  const called = [];
  o._stageCollect = async () => { called.push('collect'); return { papers: [], stats: {} }; };
  o._stageValidate1 = async () => { called.push('validate1'); return { papers: [], stats: {} }; };
  o._stageAnalyze = async () => { called.push('analyze'); return { topPapers: [], allScoredPapers: [], rerank: null }; };
  o.collector.fetchArticles = async ([pmid]) => {
    called.push(`fetch:${pmid}`);
    return articles[pmid] ? [articles[pmid]] : [];
  };
  o.filter.scorer.scorePapers = async () => [{ pmid: 'x', score: 7, studyType: 'RCT' }];
  o._stageFetchFullText = async (p) => { called.push('fulltext'); return p; };
  o._stagePicoAnalysis = async (p) => {
    called.push('pico');
    return { topPapers: p.map((x) => ({ paper: x, pmid: x.pmid, title_ko: `분석:${x.pmid}` })), stats: {} };
  };
  o._stageValidate2 = async (pico) => ({ validated: pico, qualityReport: {} });
  o._stageReport = async () => ({ jsonPath: 'j', htmlPath: 'h' });
  o._loadExcludePmids = async () => [];
  o._saveExcludePmids = async () => {};
  o._stageGuideline = async () => null;
  o._stageReview = async () => ({ outcome: 'empty' });
  o._stagePublish = async () => 'https://pages/';
  o._stageNotify = async () => null;
  o.logger.saveSession = async () => {};
  return { o, called };
}

const ART = (pmid, title) => ({ pmid, title, journal: 'NEJM', abstract: 'a'.repeat(200), publicationTypes: ['Journal Article'] });

test('★★ 예정리스트 머리를 그대로 발행한다 (순서대로 뽑힌다)', async () => {
  const dir = await sandbox([
    { pmid: '111', title: '첫째', journal: 'NEJM', score: 9 },
    { pmid: '222', title: '둘째', journal: 'Lancet', score: 8 },
  ]);
  const { o, called } = harness(dir, { articles: { 111: ART('111', '첫째'), 222: ART('222', '둘째') } });

  const result = await o.run();

  assert.equal(result.topPapers.length, 1);
  assert.equal(String(result.topPapers[0].pmid), '111', '예정리스트 1번이 아닌 것이 나갔다');
  assert.equal(result.paperSource, 'queue');
  assert.ok(called.includes('fetch:111'), '예정 항목을 받아오지 않았다');
});

test('★★ 그날은 수집·재순위를 **안 한다** (당일엔 분석만)', async () => {
  const dir = await sandbox([{ pmid: '111', title: '첫째', journal: 'NEJM', score: 9 }]);
  const { o, called } = harness(dir, { articles: { 111: ART('111', '첫째') } });
  await o.run();
  assert.ok(!called.includes('analyze'),
    '예정리스트에서 꺼내는 날에 LLM 재순위가 돌았다 — 선정은 리필 때 끝났어야 한다');
  assert.ok(called.includes('pico'), '분석은 돌아야 한다');
});

test('★★ 발행한 것은 예정리스트에서 빠진다 (다음 날 또 안 나간다)', async () => {
  const dir = await sandbox([
    { pmid: '111', title: '첫째', journal: 'NEJM', score: 9 },
    { pmid: '222', title: '둘째', journal: 'Lancet', score: 8 },
  ]);
  const { o } = harness(dir, { articles: { 111: ART('111', '첫째'), 222: ART('222', '둘째') } });
  await o.run();

  const after = JSON.parse(await readFile(path.join(dir, 'state', 'queue_papers.json'), 'utf8'));
  assert.deepEqual(after.queue.map((x) => x.pmid), ['222'], '발행분이 예정리스트에 남았다');
  assert.deepEqual(after.published.map((x) => x.pmid), ['111']);
});

test('★★ 큐가 비면 종전 수집 경로로 폴백한다 (발행이 멈추면 안 된다)', async () => {
  const dir = await sandbox([]);
  const { o, called } = harness(dir);
  o._stageCollect = async () => { called.push('collect'); return { papers: [ART('999', '새로 수집')], stats: {} }; };
  o._stageValidate1 = async (p) => { called.push('validate1'); return { papers: p, stats: {} }; };
  o._buildSelectionPool = (p) => p;
  o._saveTrack1Queue = async () => { called.push('saveQueue'); };
  o._stageAnalyze = async (p) => {
    called.push('analyze');
    return { topPapers: p, allScoredPapers: p, rerank: { applied: false } };
  };

  const result = await o.run();
  assert.equal(result.paperSource, 'fresh-collection');
  assert.ok(called.includes('collect') && called.includes('analyze'),
    '큐가 비었는데 수집·선정 폴백이 안 돌았다 — 그날 발행이 통째로 멈춘다');
  assert.equal(String(result.topPapers[0].pmid), '999');
});

test('★ 이미 발행된 PMID 는 예정리스트에서 건너뛴다', async () => {
  const dir = await sandbox([
    { pmid: '111', title: '이미 나감', journal: 'NEJM', score: 9 },
    { pmid: '222', title: '아직', journal: 'Lancet', score: 8 },
  ]);
  const { o } = harness(dir, { articles: { 111: ART('111', 'x'), 222: ART('222', '아직') } });
  o._loadExcludePmids = async () => ['111'];

  const result = await o.run();
  assert.equal(String(result.topPapers[0].pmid), '222', '이미 발행된 것을 또 냈다');
});

test('★ 예정 논문을 PubMed 에서 못 받으면 폴백한다 (죽지 않는다)', async () => {
  const dir = await sandbox([{ pmid: '111', title: '첫째', journal: 'NEJM', score: 9 }]);
  const { o, called } = harness(dir, { articles: {} });   // fetch 가 빈 배열
  o._stageCollect = async () => { called.push('collect'); return { papers: [ART('999', '폴백')], stats: {} }; };
  o._stageValidate1 = async (p) => ({ papers: p, stats: {} });
  o._buildSelectionPool = (p) => p;
  o._saveTrack1Queue = async () => {};
  o._stageAnalyze = async (p) => ({ topPapers: p, allScoredPapers: p, rerank: null });

  const result = await o.run();
  assert.equal(result.paperSource, 'fresh-collection');
  assert.equal(String(result.topPapers[0].pmid), '999');
});

// ── 리필 ─────────────────────────────────────────────────────────────────────
test('★★ 리필은 발행 **뒤**에 돌고, 하한 위면 수집을 안 한다', async () => {
  const queue = Array.from({ length: REFILL_FLOOR + 2 }, (_, i) => ({
    pmid: String(100 + i), title: `t${i}`, journal: 'J', score: 9 - i * 0.1,
  }));
  const dir = await sandbox(queue);
  const articles = Object.fromEntries(queue.map((q) => [q.pmid, ART(q.pmid, q.title)]));
  const { o, called } = harness(dir, { articles });

  await o.run();
  assert.ok(!called.includes('collect'),
    '하한 위인데 수집이 돌았다 — 매일 수집하면 어제 본 순서가 오늘 바뀐다');
});

test('★★ 하한 밑으로 떨어지면 리필이 수집을 돌린다', async () => {
  const dir = await sandbox([{ pmid: '111', title: '마지막 하나', journal: 'J', score: 9 }]);
  const { o, called } = harness(dir, { articles: { 111: ART('111', '마지막 하나') } });
  o._stageCollect = async () => { called.push('collect'); return { papers: [ART('999', '보충')], stats: {} }; };
  o._stageValidate1 = async (p) => ({ papers: p, stats: {} });
  o._buildSelectionPool = (p) => p;
  o._saveTrack1Queue = async () => { called.push('saveQueue'); };

  await o.run();
  assert.ok(called.includes('collect') && called.includes('saveQueue'),
    '큐가 바닥났는데 리필이 안 돌았다 — 며칠 뒤 발행이 멈춘다');
  // 리필은 발행 뒤여야 한다 — 앞에 두면 오늘 채운 것이 오늘 나가서 "미리 선정" 이 아니다.
  assert.ok(called.indexOf('pico') < called.indexOf('collect'),
    '리필이 발행보다 먼저 돌았다');
});

test('★ 리필이 실패해도 그날 발행은 이미 끝나 있다', async () => {
  const dir = await sandbox([{ pmid: '111', title: '하나', journal: 'J', score: 9 }]);
  const { o } = harness(dir, { articles: { 111: ART('111', '하나') } });
  o._stageCollect = async () => { throw new Error('PubMed 죽음'); };

  const result = await o.run();
  assert.equal(String(result.topPapers[0].pmid), '111', '리필 실패가 발행을 죽였다');
  assert.equal(result.queueRefill.refilled, false);
});

// ── 순수 함수 ────────────────────────────────────────────────────────────────
test('publishablePapers: 배열 순서를 지키고 나간 것만 걷는다', () => {
  const st = { ...emptyQueue('papers'), queue: [{ pmid: '1' }, { pmid: '2' }, { pmid: '3' }], published: [{ pmid: '2' }] };
  assert.deepEqual(publishablePapers(st, ['3']).map((x) => x.pmid), ['1']);
  assert.equal(nextPaper(st)?.pmid, '1');
});

test('needsRefill: 하한 기준', () => {
  const mk = (n) => ({ ...emptyQueue('papers'), queue: Array.from({ length: n }, (_, i) => ({ pmid: String(i) })) });
  assert.equal(needsRefill(mk(REFILL_FLOOR)), false);
  assert.equal(needsRefill(mk(REFILL_FLOOR - 1)), true);
  assert.equal(needsRefill(mk(0)), true);
});

test('빈 입력에도 안 죽는다', () => {
  assert.deepEqual(publishablePapers(undefined), []);
  assert.equal(nextPaper(null), null);
});
