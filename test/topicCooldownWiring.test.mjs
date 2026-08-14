// 배선 테스트 — 쿨다운이 "붙어 있다고 적힌 것"이 아니라 실제로 흐르는지 본다.
//
// ★ 왜 이 파일이 따로 있나: 쿨다운 단위 테스트(topicCooldown.test.mjs)는
//   `_selectTopPapers` 에 history 를 **직접 넣어** 검증한다. 그래서 오케스트레이터가
//   history 를 안 넘기거나 topic 을 파일에 안 적어도 그 테스트는 전부 초록이다.
//   F1(재순위가 4주간 안 돌았는데 로그는 돌았다고 찍은 사건)이 정확히 이 구멍이었다.
//   여기서는 **파일 왕복**(save → load)을 실물로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

async function freshOrchestrator() {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'tr-cooldown-'));
  return new TrendReviewOrchestrator({ outputDir });
}

test('선정 결과를 저장하면 topic 이 함께 적힌다', async () => {
  const orch = await freshOrchestrator();
  await orch._saveExcludePmids([
    { pmid: '111', title: 'cardiac arrest trial', scoringData: { primaryTopic: 'cardiac_resus' } },
  ]);
  const saved = JSON.parse(await readFile(orch.excludeListPath, 'utf8'));
  assert.equal(saved[0].pmid, '111');
  assert.equal(saved[0].topic, 'cardiac_resus', 'topic 이 안 적히면 쿨다운은 영원히 무동작이다');
});

test('paper 안쪽에 scoringData 가 있어도 topic 을 찾아낸다', async () => {
  const orch = await freshOrchestrator();
  await orch._saveExcludePmids([
    { paper: { pmid: '222', title: 'sepsis rct', scoringData: { primaryTopic: 'sepsis_shock' } } },
  ]);
  const saved = JSON.parse(await readFile(orch.excludeListPath, 'utf8'));
  assert.equal(saved[0].topic, 'sepsis_shock');
});

test('저장한 것을 이력으로 다시 읽어온다 (왕복)', async () => {
  const orch = await freshOrchestrator();
  await orch._saveExcludePmids([
    { pmid: '333', title: 'x', scoringData: { primaryTopic: 'neuro' } },
  ]);
  const history = await orch._loadSelectionHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].topic, 'neuro');
  assert.ok(history[0].date, '날짜가 없으면 감쇠를 계산할 수 없다');
});

test('topic 없는 옛 항목은 이력에서 조용히 빠진다 (하위호환)', async () => {
  const orch = await freshOrchestrator();
  // 배포 이전에 쌓인 항목 — pmid/title/date 만 있다.
  await writeFile(orch.excludeListPath, JSON.stringify([
    { pmid: '900', title: 'old entry', date: '2026-08-01' },
    { pmid: '901', title: 'new entry', date: '2026-08-13', topic: 'resp_airway' },
  ], null, 2));
  const history = await orch._loadSelectionHistory();
  assert.deepEqual(history, [{ topic: 'resp_airway', date: '2026-08-13' }]);
});

test('파일이 없으면 빈 이력이다 (첫 실행에 안 터진다)', async () => {
  const orch = await freshOrchestrator();
  assert.deepEqual(await orch._loadSelectionHistory(), []);
});

test('★ 호출부가 아무것도 안 줘도 _stageAnalyze 가 이력을 스스로 싣는다', async () => {
  // 이 테스트가 이 파일의 핵심이다. 종전엔 run() 이 history 를 조립해 넘겼는데,
  // 그러면 호출부에서 인자를 빼도 테스트가 전부 초록이었다(실제로 변이로 확인했다).
  // 이제 길목인 _stageAnalyze 가 직접 싣는다 — 호출부는 빠뜨릴 수가 없다.
  const orch = await freshOrchestrator();
  await orch._saveExcludePmids([
    { pmid: '444', title: 'arrest', scoringData: { primaryTopic: 'cardiac_resus' } },
  ]);
  let received = null;
  orch.filter = {
    runScoringOnly: async (papers, options) => {
      received = options;
      return { topPapers: [], allScoredPapers: [], rerank: null };
    },
  };
  orch._saveCheckpoint = async () => {};
  // 호출부는 excludePmids 만 준다 — run() 이 실제로 하는 그대로다.
  await orch._stageAnalyze([{ pmid: '1' }], { excludePmids: ['9'] });
  assert.deepEqual(received.history, [{ topic: 'cardiac_resus', date: received.today }],
    '이력을 스스로 싣지 않으면 쿨다운은 죽은 코드다');
  assert.match(received.today, /^\d{4}-\d{2}-\d{2}$/, 'today 가 없으면 감쇠를 계산할 수 없다');
});

test('명시로 넘긴 history·today 는 그대로 쓴다', async () => {
  const orch = await freshOrchestrator();
  let received = null;
  orch.filter = {
    runScoringOnly: async (papers, options) => {
      received = options;
      return { topPapers: [], allScoredPapers: [], rerank: null };
    },
  };
  orch._saveCheckpoint = async () => {};
  const history = [{ topic: 'cardiac_resus', date: '2026-08-13' }];
  await orch._stageAnalyze([{ pmid: '1' }], { excludePmids: ['9'], history, today: '2026-08-14' });
  assert.deepEqual(received.history, history, 'history 가 안 넘어가면 쿨다운은 죽은 코드다');
  assert.equal(received.today, '2026-08-14');
  assert.deepEqual(received.excludePmids, ['9'], '기존 배제 목록도 그대로 가야 한다');
});
