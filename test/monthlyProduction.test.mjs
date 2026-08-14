import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { selectMonthlyPool } from '../src/utils/monthlyPool.js';

const singleCollection = { mode: 'single', maxPapers: 300 };

function paper(pmid, ageDays, journal = 'JAMA') {
  const d = new Date('2026-08-14T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ageDays);
  return { pmid: String(pmid), pubDate: d.toISOString().slice(0, 10), title: `paper ${pmid}`,
    abstract: 'sepsis resuscitation randomized trial', journal,
    publicationTypes: ['Randomized Controlled Trial'], meshTerms: [], keywords: [] };
}

const rankScorer = {
  isExcludedJournal: (p) => p.journal === 'Excluded',
  scorePapers: (papers) => papers.map((p) => ({ pmid: p.pmid, rawScore: Number(p.pmid) })),
};

test('monthly12 외 mode는 종전 single 수집 경로를 그대로 실행한다', async () => {
  const agent = new DataCollectorAgent({ collection: singleCollection });
  let searches = 0;
  agent.searchPmids = async () => { searches++; return ['1']; };
  agent.fetchArticles = async () => [paper(1, 0)];
  agent.collectMonthlyPool = async () => { throw new Error('monthly path must not run'); };
  const result = await agent.run();
  assert.equal(searches, 1);
  assert.equal(result.papers[0].pmid, '1');
  assert.equal('monthlyFallback' in result.stats, false);
});

test('selectMonthlyPool은 12구간에서 월 top-3, 최대 36편을 만든다', () => {
  const candidates = [];
  for (let month = 0; month < 12; month++) {
    for (let n = 1; n <= 5; n++) candidates.push(paper(month * 10 + n, month * 30 + n));
  }
  const result = selectMonthlyPool(candidates, '2026-08-14', rankScorer,
    { months: 12, monthDays: 30, keepPerMonth: 3 });
  assert.equal(result.pool.length, 36);
  assert.deepEqual(result.perMonth.map((m) => m.kept), Array(12).fill(3));

  const shallow = selectMonthlyPool(candidates.slice(0, 2), '2026-08-14', rankScorer,
    { months: 12, monthDays: 30, keepPerMonth: 3 });
  assert.equal(shallow.pool.length, 2);
});

test('배제 저널은 월 top-K 전에 제거되어 정상 논문이 슬롯을 채운다', () => {
  const candidates = [paper(99, 1, 'Excluded'), paper(2, 2), paper(1, 3)];
  const result = selectMonthlyPool(candidates, '2026-08-14', rankScorer,
    { months: 1, monthDays: 30, keepPerMonth: 2 });
  assert.deepEqual(result.pool.map((p) => p.pmid), ['2', '1']);
  assert.deepEqual(result.perMonth[0], { month: 0, screened: 2, kept: 2 });
});

for (const failure of ['throw', 'empty']) {
  test(`월별 수집 ${failure === 'throw' ? '예외' : '빈 결과'} 시 single 폴백 실행 증거를 남긴다`, async () => {
    const agent = new DataCollectorAgent({ collection: {
      mode: 'monthly12', monthly: { months: 12, screenPerMonth: 100 },
    } });
    agent.collectMonthlyPool = async () => {
      if (failure === 'throw') throw new Error('pubmed unavailable');
      return { papers: [], perMonth: [], requestedTotal: 1200, uniqueIds: 0 };
    };
    let fallbackSearches = 0;
    agent.searchPmids = async () => { fallbackSearches++; return ['7']; };
    agent.fetchArticles = async () => [paper(7, 0)];
    const result = await agent.run();
    assert.equal(fallbackSearches, 1);
    assert.equal(result.papers[0].pmid, '7');
    assert.equal(result.stats.monthlyFallback.executed, true);
    assert.deepEqual(result.stats.monthlyFallback.execution,
      { pmidsFound: 1, articlesCollected: 1 });
  });
}

test('monthly12 rerankPool은 환경변수 20보다 유도값 36이 우선한다', () => {
  const previous = process.env.RERANK_POOL;
  process.env.RERANK_POOL = '20';
  try {
    const orchestrator = new TrendReviewOrchestrator();
    assert.equal(orchestrator.collectionMode, 'monthly12');
    assert.equal(orchestrator.filter.rerankPool, 36);
  } finally {
    if (previous === undefined) delete process.env.RERANK_POOL;
    else process.env.RERANK_POOL = previous;
  }
});

test('monthly12 esummary 사전순위 스코어러는 주제 게이트를 끈다', async () => {
  const agent = new DataCollectorAgent({ collection: {
    mode: 'monthly12', monthly: { months: 12, screenPerMonth: 100 },
  } });
  let penalty;
  agent.collectMonthlyPool = async ({ prerankScorer }) => {
    penalty = prerankScorer.scoring.topicGatePenalty;
    return { papers: [paper(1, 0)], perMonth: [], requestedTotal: 1200, uniqueIds: 1 };
  };
  await agent.run();
  assert.equal(penalty, 0);
});

// ★ 수집 폴백이 못 잡는 구멍 — 수집은 성공했는데 월별 갈래에서 풀이 비는 경우.
//    pubDate 가 미래(ahead-of-print)거나 360일 창 밖이면 버킷에 안 담긴다.
//    막지 않으면 그날 데일리가 조용히 빈손이 된다.
//    ★ 아래 테스트들은 오케스트레이터의 **실제 메서드**를 호출한다 — 분기를 재현하면
//      폴백을 지워도 초록으로 남기 때문이다.
async function freshOrchestrator() {
  const { TrendReviewOrchestrator } = await import('../src/orchestrator/TrendReviewOrchestrator.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const orch = new TrendReviewOrchestrator({ outputDir: await mkdtemp(path.join(tmpdir(), 'tr-mp-')) });
  orch.collectionMode = 'monthly12';
  orch.monthlyConfig = { months: 12, monthDays: 30, keepPerMonth: 3 };
  return orch;
}

test('★ 월별 선정 풀이 비면 수집분 전체로 폴백한다 (조용한 빈손 방지)', async () => {
  const orch = await freshOrchestrator();
  // 전부 미래 날짜 — monthlyBuckets 가 ageDays < 0 으로 전부 버린다.
  const collected = [
    { pmid: '1', title: 'a', journal: 'JAMA', pubDate: '2099-01-01' },
    { pmid: '2', title: 'b', journal: 'JAMA', pubDate: '2099-01-02' },
  ];
  const stats = {};
  const pool = orch._buildSelectionPool(collected, stats);
  assert.equal(stats.monthlySelectionPoolSize, 0, '전제: 미래 날짜는 버킷에 안 담긴다');
  assert.equal(stats.monthlySelectionFallback.executed, true);
  assert.equal(pool.length, 2, '빈 풀을 그대로 넘기면 그날은 빈손이 된다');
});

test('월별 풀이 차면 그 풀을 쓰고 폴백은 안 돈다', async () => {
  const orch = await freshOrchestrator();
  const today = new Date();
  const recent = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
  const collected = Array.from({ length: 6 }, (_, i) => (
    { pmid: String(100 + i), title: `cardiac arrest trial ${i}`, journal: 'JAMA', pubDate: recent }));
  const stats = {};
  const pool = orch._buildSelectionPool(collected, stats);
  assert.equal(stats.monthlySelectionFallback.executed, false);
  assert.equal(pool.length, 3, '한 구간에 몰리면 keepPerMonth=3 만 남는다');
  assert.equal(stats.monthlySelectionPoolSize, 3);
});

test('monthly12 가 아니면 수집분을 그대로 쓴다 (불변식)', async () => {
  const orch = await freshOrchestrator();
  orch.collectionMode = 'single';
  const collected = [{ pmid: '1', title: 'a', journal: 'JAMA', pubDate: '2026-08-01' }];
  const stats = {};
  assert.equal(orch._buildSelectionPool(collected, stats), collected);
  assert.deepEqual(stats, {}, '월별이 아니면 stats 를 건드리지 않는다');
});

test('수집이 이미 폴백했으면 월별 선정을 건너뛴다', async () => {
  const orch = await freshOrchestrator();
  const collected = [{ pmid: '1', title: 'a', journal: 'JAMA', pubDate: '2026-08-01' }];
  const stats = { monthlyFallback: { executed: true, reason: 'x' } };
  assert.equal(orch._buildSelectionPool(collected, stats), collected);
  assert.equal(stats.monthlySelectionPoolSize, undefined);
});
