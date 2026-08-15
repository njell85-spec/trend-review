import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';

// arm F 첫날(2026-08-15 데일리 · run 31844016618) 실측에서 나온 것:
// **12개 구간 전부가 screenDepth 상한에 걸려 있었다.** 구간별 실제 편수는 1,013~2,575편
// (12구간 합 21,946)인데 상한 1,000 탓에 9,946편(45%)이 **점수조차 안 매겨졌다.**
// 절단은 무작위가 아니다 — `sort=date` 내림차순이라 각 30일 구간의 **오래된 쪽부터** 잘린다.
//
// 이 파일이 지키는 것 둘:
//   ① 절단이 일어나면 조용히 넘어가지 않고 `truncated:true` 로 드러난다 (종전 무테스트였다)
//   ② `screenDepth` 설정값이 조용히 되돌아가지 않는다
//
// ★ screenDepth 는 **상한이지 회수량이 아니다.** esummary 는 실제로 받은 PMID 수만큼만
//   부르므로, 상한을 실제 편수보다 높게 잡는 것은 추가 비용이 0이다.

function summaries(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    pmid: String(offset + i + 1), title: `paper ${offset + i + 1}`, journal: 'JAMA',
  }));
}

function agentWith({ perMonthFound }) {
  const agent = new DataCollectorAgent({ collection: { mode: 'monthly12' } });
  let call = 0;
  agent._search = async ({ retmax }) => {
    const found = perMonthFound[Math.min(call, perMonthFound.length - 1)];
    call += 1;
    return summaries(Math.min(found, retmax)).map((s) => s.pmid);
  };
  agent.fetchSummaries = async (ids) => summaries(ids.length);
  agent.fetchArticles = async (ids) => ids.map((pmid) => ({ pmid, title: `p${pmid}`, pubDate: '2026-08-01' }));
  return agent;
}

const prerank = { scorePapers: (papers) => papers.map((p) => ({ pmid: p.pmid, rawScore: Number(p.pmid) })) };

test('절단: 구간이 상한에 닿으면 truncated=true 로 드러난다 (조용히 넘기지 않는다)', async () => {
  const agent = agentWith({ perMonthFound: [5000] });
  const out = await agent.collectMonthlyPool({ months: 3, screenDepth: 1000, screenPerMonth: 100, prerankScorer: prerank });
  assert.equal(out.perMonth.length, 3);
  for (const m of out.perMonth) {
    assert.equal(m.truncated, true, `M${m.month} 절단이 보고되지 않았다`);
    assert.equal(m.found, 1000, '상한만큼만 회수한다');
    assert.equal(m.screenDepth, 1000);
  }
});

test('절단: 상한에 못 미치면 truncated=false 다', async () => {
  const agent = agentWith({ perMonthFound: [400] });
  const out = await agent.collectMonthlyPool({ months: 2, screenDepth: 3000, screenPerMonth: 100, prerankScorer: prerank });
  for (const m of out.perMonth) {
    assert.equal(m.truncated, false);
    assert.equal(m.found, 400);
  }
});

test('절단: 상한을 올리면 같은 구간이 전량 스크리닝으로 바뀐다', async () => {
  const found = 2575;   // 실측 최다 구간(M7)
  const before = await agentWith({ perMonthFound: [found] })
    .collectMonthlyPool({ months: 1, screenDepth: 1000, screenPerMonth: 100, prerankScorer: prerank });
  const after = await agentWith({ perMonthFound: [found] })
    .collectMonthlyPool({ months: 1, screenDepth: 3000, screenPerMonth: 100, prerankScorer: prerank });
  assert.equal(before.perMonth[0].truncated, true);
  assert.equal(before.perMonth[0].found, 1000);
  assert.equal(after.perMonth[0].truncated, false);
  assert.equal(after.perMonth[0].found, found, '실측 최다 구간이 3000 상한 안에 들어와야 한다');
  // efetch 예산은 상한과 무관하게 고정이다 — 늘어나는 것은 esummary 뿐이다.
  assert.equal(before.perMonth[0].kept, after.perMonth[0].kept);
});

test('설정: screenDepth 는 3000 이다 (실측 최다 구간 2,575 를 덮는다)', async () => {
  const cfg = JSON.parse(await readFile(new URL('../config/collection.json', import.meta.url), 'utf8'));
  assert.equal(cfg.monthly.screenDepth, 3000,
    '되돌리면 구간마다 오래된 쪽이 잘려 45% 가 점수조차 못 받는다 (2026-08-15 실측)');
  assert.equal(cfg.monthly.screenPerMonth, 100, 'efetch 예산 12×100 은 그대로다');
  assert.equal(cfg.monthly.keepPerMonth, 3);
});
