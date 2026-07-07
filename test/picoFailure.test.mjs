import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';

// F5: PICO 전건 실패 시 예외를 전파해야 한다 (빈 fallback 카드를 성공처럼 발행/발송하지 않도록).
test('analyzePico: 전건 실패면 예외를 던지고 실패 사유를 메시지에 싣는다', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 2 });
  agent._analyzeSinglePaper = async () => { throw new Error('session limit 429'); };
  await assert.rejects(
    () => agent.analyzePico([{ pmid: '1' }, { pmid: '2' }]),
    (err) => /PICO analysis failed for all 2/.test(err.message) && /429/.test(err.message),
  );
});

test('analyzePico: 부분 실패면 예외 없이 성공분 + fallback(analysisError) 반환', async () => {
  const agent = new FilterAnalyzerAgent({ topN: 2 });
  let n = 0;
  agent._analyzeSinglePaper = async (p) => {
    n += 1;
    if (n === 1) return { pmid: p.pmid, paper: p, analysisError: false };
    throw new Error('boom');
  };
  const paper = { pmid: '2', title: 't', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/2/', pubDate: '2026' };
  const res = await agent.analyzePico([{ pmid: '1', paper: { pmid: '1' } }, paper]);
  assert.equal(res.length, 2);
  assert.ok(res.some((r) => r.analysisError === true)); // 실패분은 fallback 카드
  assert.ok(res.some((r) => r.analysisError === false)); // 성공분은 유지
});
