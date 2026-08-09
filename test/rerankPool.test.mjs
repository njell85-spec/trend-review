import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';

// F1(스펙 §5.4) — 2층 LLM 재순위가 프로덕션에서 4주간 한 번도 돌지 않았다.
//   daily-review.yml:85 `RERANK_POOL: ${{ vars.RERANK_POOL }}` 는 변수 미설정 시
//   **빈 문자열**을 주입한다. `Number(env ?? 20)` 에서 `??` 는 빈 문자열을 통과시켜
//   `Number('') = 0` → `poolSize = max(topN, 0) = 1` → `_rerankSelect` 가
//   `pool.length <= n` 에서 LLM 없이 즉시 반환.
//   그런데 로그는 플래그(`enableRerank`)만 보고 `(LLM reranked)` 를 찍어 4주간 은폐했다.
// 실측 근거: run 31280455886 (2026-08-08) — env `RERANK_POOL:` 빈 값,
//   `Selected top 1 papers (LLM reranked)`, `Stage ANALYZING completed in 0.1s`,
//   `LLM 실행 경로: 구독×1`(재순위가 돌면 2회).

/** 결정적 스코어러가 순위를 매길 수 있는 최소 논문 더미 n편 */
function makePapers(n) {
  return Array.from({ length: n }, (_, i) => ({
    pmid: String(1000 + i),
    title: `Sepsis resuscitation trial ${i}`,
    abstract: 'Randomized controlled trial of early vasopressor therapy in septic shock.',
    journal: 'Critical Care Medicine',
    publicationTypes: ['Randomized Controlled Trial'],
    pubDate: '2026-08-01',
  }));
}

/** 재순위 프롬프트에 실린 PMID 목록 (LLM 이 실제로 받은 풀) */
function promptPmids(messages) {
  return (String(messages[0].content).match(/PMID (\d+)/g) || []).map((s) => s.replace('PMID ', ''));
}

/** 풀 전체를 덮는 점수 응답 — `winner` 만 최고점. 부분 응답은 §5.4 상 무효라 테스트에 못 쓴다. */
function fullScores(messages, winner) {
  return promptPmids(messages).map((pmid) => ({
    pmid, score: pmid === winner ? 10 : 5, rationale: 'bedside value',
  }));
}

/** logger 출력을 가로채 문자열 배열로 모은다 (실제 로그 문구를 검사하기 위함) */
function captureLogs(agent) {
  const lines = [];
  for (const level of ['info', 'warn', 'error']) {
    agent.logger[level] = (msg, meta) => lines.push(`${level}:${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  }
  agent.logger.section = () => {};
  return lines;
}

test('rerankPool: RERANK_POOL 이 빈 문자열이면 기본값 20 (워크플로 미설정 변수 주입)', () => {
  const prev = process.env.RERANK_POOL;
  process.env.RERANK_POOL = '';
  try {
    const agent = new FilterAnalyzerAgent({ topN: 1 });
    assert.equal(agent.rerankPool, 20);
  } finally {
    if (prev === undefined) delete process.env.RERANK_POOL; else process.env.RERANK_POOL = prev;
  }
});

test('rerankPool: 쓰레기 값(0 · 음수 · 비수치)도 기본값 20으로 떨어진다', () => {
  const prev = process.env.RERANK_POOL;
  try {
    for (const bad of ['0', '-5', 'abc', '   ']) {
      process.env.RERANK_POOL = bad;
      assert.equal(new FilterAnalyzerAgent({ topN: 1 }).rerankPool, 20, `RERANK_POOL=${JSON.stringify(bad)}`);
    }
    process.env.RERANK_POOL = '12';
    assert.equal(new FilterAnalyzerAgent({ topN: 1 }).rerankPool, 12, '정상 값은 그대로 쓴다');
  } finally {
    if (prev === undefined) delete process.env.RERANK_POOL; else process.env.RERANK_POOL = prev;
  }
});

test('rerankPool: 빈 RERANK_POOL 로도 LLM 재순위가 실제로 호출된다 (풀 붕괴 회귀)', async () => {
  const prev = process.env.RERANK_POOL;
  process.env.RERANK_POOL = '';
  try {
    const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true });
    captureLogs(agent);
    let calledWithPool = 0;
    agent._callLLM = async (messages) => {
      calledWithPool = promptPmids(messages).length;
      return { scores: fullScores(messages, '1007') };
    };
    const { topPapers } = await agent.runScoringOnly(makePapers(30));
    assert.equal(calledWithPool, 20, 'LLM 이 20편 풀을 받아야 한다');
    assert.equal(topPapers[0].pmid, '1007', 'LLM 최고점 논문이 선정돼야 한다');
  } finally {
    if (prev === undefined) delete process.env.RERANK_POOL; else process.env.RERANK_POOL = prev;
  }
});

test('rerankLog: 재순위가 실제로 적용됐을 때만 "(LLM reranked)" 를 찍는다', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true, rerankPool: 20 });
  const lines = captureLogs(agent);
  agent._callLLM = async (messages) => ({ scores: fullScores(messages, '1003') });
  await agent.runScoringOnly(makePapers(30));
  const selected = lines.find((l) => l.includes('Selected top'));
  assert.ok(/\(LLM reranked\)/.test(selected), `적용됐는데 문구가 없다: ${selected}`);
  assert.ok(lines.some((l) => /rerank_applied.*true/.test(l)), '실행 증거 로그가 있어야 한다');
});

test('rerankLog: 풀이 topN 이하로 붕괴하면 "(LLM reranked)" 를 찍지 않는다 (거짓말 금지)', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true, rerankPool: 1 });
  const lines = captureLogs(agent);
  agent._callLLM = async () => { throw new Error('LLM 이 호출되면 안 된다'); };
  await agent.runScoringOnly(makePapers(30));
  const selected = lines.find((l) => l.includes('Selected top'));
  assert.ok(!/\(LLM reranked\)/.test(selected), `안 돌았는데 돌았다고 찍는다: ${selected}`);
  assert.ok(
    lines.some((l) => /rerank_applied.*false/.test(l) && /pool_too_small/.test(l)),
    '미발동 사유(fallback_reason)가 로그에 남아야 한다',
  );
});

test('rerankLog: LLM 이 실패하면 결정적 순위를 유지하고 "(LLM reranked)" 를 찍지 않는다', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true, rerankPool: 20 });
  const lines = captureLogs(agent);
  agent._callLLM = async () => { throw new Error('session limit 429'); };
  const { topPapers } = await agent.runScoringOnly(makePapers(30));
  assert.equal(topPapers.length, 1, '소프트 폴백 — 데일리는 계속 돈다');
  const selected = lines.find((l) => l.includes('Selected top'));
  assert.ok(!/\(LLM reranked\)/.test(selected), `실패했는데 돌았다고 찍는다: ${selected}`);
  assert.ok(lines.some((l) => /llm_error/.test(l)), '실패 사유가 로그에 남아야 한다');
});

test('rerankLog: LLM 응답이 풀 PMID 를 전부 덮지 않으면 재순위 전체 무효', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true, rerankPool: 20 });
  const lines = captureLogs(agent);
  // 20편 풀인데 3편만 점수를 돌려준다 → 나머지 17편이 0점 취급돼 순위가 뒤집힌다.
  agent._callLLM = async () => ({
    scores: [{ pmid: '1019', score: 10 }, { pmid: '1018', score: 9 }, { pmid: '1017', score: 8 }],
  });
  const { topPapers } = await agent.runScoringOnly(makePapers(30));
  assert.notEqual(topPapers[0].pmid, '1019', '부분 응답으로 순위를 뒤집으면 안 된다');
  const selected = lines.find((l) => l.includes('Selected top'));
  assert.ok(!/\(LLM reranked\)/.test(selected), `무효 처리인데 돌았다고 찍는다: ${selected}`);
  assert.ok(lines.some((l) => /incomplete_scores/.test(l)), '무효 사유가 로그에 남아야 한다');
});
