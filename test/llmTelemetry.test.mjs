/**
 * llmTelemetry — 토큰·비용 누적 계약 테스트.
 *
 * 이 집계가 타워(global-config) 사용량 장부의 원자료가 되고, 장부는 append-only라
 * 잘못 들어간 값을 되돌릴 수 없다. 그래서 "조용히 0이 되는" 회귀를 여기서 잡는다.
 * 계약: rulebook/usage-accounting.md C1.
 *
 * 단위 테스트만으로는 부족하다 — llmTelemetry가 아무리 정확해도 LLMClient가 record()를
 * 부르지 않으면 장부는 조용히 빈다. 그래서 아래 "배선" 테스트가 _spawnClaude를 스텁으로
 * 갈아끼워 callWithTool() 경로까지 통째로 검증한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmTelemetry, LLMClient } from '../src/utils/LLMClient.js';

const CLI_USAGE = {
  input_tokens: 2,
  output_tokens: 4,
  cache_creation_input_tokens: 47951,
  cache_read_input_tokens: 10,
};

// 실제 claude CLI(--output-format json) 응답 모양 — 2026-07-25 CLI 2.1.220 실측 기준.
const cliResult = (over = {}) => ({
  is_error: false,
  type: 'result',
  subtype: 'success',
  result: '{"ok":true}',
  total_cost_usd: 0.287772,
  usage: CLI_USAGE,
  modelUsage: {
    'claude-opus-4-8': {
      inputTokens: 2,
      outputTokens: 4,
      cacheCreationInputTokens: 47951,
      cacheReadInputTokens: 10,
      costUSD: 0.287772,
    },
  },
  ...over,
});

const TOOL = { name: 't', description: 'd', input_schema: { type: 'object' } };
const MSGS = [{ role: 'user', content: 'hi' }];

/** _spawnClaude 만 갈아끼운 anthropic 클라이언트 — 실제 CLI를 부르지 않는다. */
function stubbedClient(spawnResult, model = 'claude-opus-4-8') {
  const client = new LLMClient({ provider: 'anthropic', model });
  client._spawnClaude = async () => spawnResult;
  return client;
}

// ── 누적 로직 ───────────────────────────────────────────────────────────────

test('빈 상태의 summary()는 빈 배열', () => {
  llmTelemetry.resetTotals();
  assert.deepEqual(llmTelemetry.summary(), []);
});

test('구독 CLI 호출을 토큰·비용까지 누적한다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', {
    model: 'claude-opus-4-8',
    usage: CLI_USAGE,
    costUsd: 0.28777200000000003,
  });

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.auth, 'subscription');
  assert.equal(rec.model, 'claude-opus-4-8');
  assert.equal(rec.in, 2);
  assert.equal(rec.out, 4);
  assert.equal(rec.cache_w, 47951);
  assert.equal(rec.cache_r, 10);
  assert.equal(rec.cost_usd, 0.287772, '부동소수 잔재가 장부로 새면 안 된다');
  assert.equal(rec.calls, 1);
  assert.equal(rec.accuracy, 'exact');
});

test('모델이 섞이면 합치지 않고 모델별로 레코드가 갈린다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', { model: 'claude-opus-4-8', usage: CLI_USAGE, costUsd: 1 });
  llmTelemetry.record('subscription', { model: 'claude-sonnet-4-6', usage: CLI_USAGE, costUsd: 2 });

  const recs = llmTelemetry.summary();
  assert.equal(recs.length, 2, '모델별 원자료가 보존되어야 한다(장부는 되돌릴 수 없다)');
  assert.deepEqual(recs.map((r) => r.model).sort(), ['claude-opus-4-8', 'claude-sonnet-4-6']);
  for (const r of recs) assert.ok(!r.model.includes('+'), '모델명을 이어붙이면 안 된다');
  assert.equal(recs.find((r) => r.model === 'claude-sonnet-4-6').cost_usd, 2);
});

test('같은 모델 반복 호출은 한 레코드로 더해진다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', { model: 'claude-opus-4-8', usage: CLI_USAGE, costUsd: 1 });
  llmTelemetry.record('subscription', { model: 'claude-opus-4-8', usage: CLI_USAGE, costUsd: 2 });

  const recs = llmTelemetry.summary();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].calls, 2);
  assert.equal(recs[0].in, 4);
  assert.equal(recs[0].cache_w, 47951 * 2);
  assert.equal(recs[0].cost_usd, 3);
});

test('구독과 API가 섞이면 auth별로 레코드가 분리된다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', { model: 'claude-opus-4-8', usage: CLI_USAGE, costUsd: 0.5 });
  llmTelemetry.record('api', { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 7 } });

  const recs = llmTelemetry.summary();
  assert.equal(recs.length, 2);

  const sub = recs.find((r) => r.auth === 'subscription');
  const api = recs.find((r) => r.auth === 'api');
  assert.equal(sub.cost_usd, 0.5);
  assert.equal(api.in, 100);
  assert.equal(api.out, 7);
  assert.equal(api.cache_w, 0, '없는 필드는 0 — undefined가 장부에 새면 JSON이 깨진다');
  assert.equal(api.cache_r, 0);
});

test('API 레코드는 비용 0을 exact로 위장하지 않는다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('api', { model: 'claude-opus-4-8', usage: { input_tokens: 900, output_tokens: 80 } });

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.cost_usd, 0, 'Messages API는 비용을 주지 않는다 — 추정치를 몰래 채우지 않는다');
  assert.equal(rec.accuracy, 'approx', '$0을 exact로 남기면 과금된 날이 무비용으로 보인다');
  assert.match(rec.note, /Messages API/);
});

test('reset()은 런 카운터만 지우고 토큰 누적은 보존한다 (재시도 누락 방지)', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.cli = 3;
  llmTelemetry.record('subscription', { model: 'claude-opus-4-8', usage: CLI_USAGE, costUsd: 0.5 });

  llmTelemetry.reset(); // 세션 한도로 재시도 → 오케스트레이터가 런 시작 시 호출

  assert.equal(llmTelemetry.cli, 0, 'label()용 런 카운터는 초기화되어야 한다');
  const [rec] = llmTelemetry.summary();
  assert.equal(rec.calls, 1, '실패한 시도에서 태운 토큰도 장부에 남아야 한다');
  assert.equal(rec.cost_usd, 0.5);
});

test('숫자가 아닌 usage 값은 0으로 떨어진다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', {
    usage: { input_tokens: null, output_tokens: 'x', cache_creation_input_tokens: undefined },
  });

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.in, 0);
  assert.equal(rec.out, 0);
  assert.equal(rec.cache_w, 0);
  assert.equal(rec.model, 'unknown', '모델 미상도 레코드는 남아야 한다');
});

test('label()의 기존 출력은 바뀌지 않는다 (카톡·job summary 문구 보존)', () => {
  llmTelemetry.reset();
  assert.equal(llmTelemetry.label(), '—');
  llmTelemetry.cli = 2;
  llmTelemetry.api = 1;
  assert.equal(llmTelemetry.label(), '구독×2 · API×1');
  llmTelemetry.reset();
});

// ── CLI 응답 해석 ────────────────────────────────────────────────────────────

test('modelUsage가 있으면 모델별 정확값을 쓰고 최상위 usage와 이중 계상하지 않는다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.recordCliResult(cliResult(), 'ignored-fallback');

  const recs = llmTelemetry.summary();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].model, 'claude-opus-4-8', 'modelUsage 키가 요청 모델보다 정확하다');
  assert.equal(recs[0].in, 2, '최상위 usage와 modelUsage를 함께 세면 2배가 된다');
  assert.equal(recs[0].cache_w, 47951);
  assert.equal(recs[0].cost_usd, 0.287772);
});

test('modelUsage가 없으면 최상위 usage + 요청 모델로 폴백한다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.recordCliResult(cliResult({ modelUsage: undefined }), 'claude-sonnet-4-6');

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.model, 'claude-sonnet-4-6');
  assert.equal(rec.in, 2);
  assert.equal(rec.cost_usd, 0.287772);
});

test('tryRecordCliStdout는 깨진 stdout에도 던지지 않는다', () => {
  llmTelemetry.resetTotals();
  assert.equal(llmTelemetry.tryRecordCliStdout('{"records":', 'm'), false);
  assert.equal(llmTelemetry.tryRecordCliStdout('', 'm'), false);
  assert.equal(llmTelemetry.tryRecordCliStdout(undefined, 'm'), false);
  assert.deepEqual(llmTelemetry.summary(), [], '실패 파싱이 유령 레코드를 만들면 안 된다');
});

// ── 배선(LLMClient → llmTelemetry) ──────────────────────────────────────────
// 이 블록이 없으면 LLMClient에서 record 호출을 지워도 위 테스트가 전부 통과한다.

test('배선: 성공한 CLI 호출이 장부에 잡힌다', async () => {
  llmTelemetry.resetTotals();
  const client = stubbedClient({ status: 0, stdout: JSON.stringify(cliResult()), stderr: '' });

  await client.callWithTool(MSGS, TOOL);

  const [rec] = llmTelemetry.summary();
  assert.ok(rec, 'LLMClient가 record를 부르지 않으면 장부가 조용히 빈다');
  assert.equal(rec.auth, 'subscription');
  assert.equal(rec.model, 'claude-opus-4-8');
  assert.equal(rec.in, 2);
});

test('배선: 종료코드가 0이 아니어도 stdout의 사용량은 건진다 (세션 한도 시나리오)', async () => {
  llmTelemetry.resetTotals();
  const limited = cliResult({ is_error: true, subtype: 'error_max_structured_output_retries' });
  const client = stubbedClient({ status: 1, stdout: JSON.stringify(limited), stderr: '' });

  await assert.rejects(() => client.callWithTool(MSGS, TOOL), /exited with code 1/);

  const [rec] = llmTelemetry.summary();
  assert.ok(rec, '한도로 죽은 호출이야말로 기록이 필요한 사용량이다');
  assert.equal(rec.cost_usd, 0.287772);
});

test('배선: is_error 응답도 던지기 전에 사용량을 적재한다', async () => {
  llmTelemetry.resetTotals();
  const errored = cliResult({ is_error: true, result: 'refused' });
  const client = stubbedClient({ status: 0, stdout: JSON.stringify(errored), stderr: '' });

  await assert.rejects(() => client.callWithTool(MSGS, TOOL), /error response/);

  const [rec] = llmTelemetry.summary();
  assert.ok(rec);
  assert.equal(rec.in, 2);
});

test('배선: 요약 JSON의 키가 장부(C1)가 요구하는 필드와 맞는다', async () => {
  llmTelemetry.resetTotals();
  const client = stubbedClient({ status: 0, stdout: JSON.stringify(cliResult()), stderr: '' });
  await client.callWithTool(MSGS, TOOL);

  // 워크플로우 스텝이 jq로 읽는 키들 — 이름이 바뀌면 장부에 빈 값이 들어간다.
  for (const k of ['auth', 'model', 'in', 'out', 'cache_w', 'cache_r', 'cost_usd', 'accuracy', 'note']) {
    assert.ok(k in llmTelemetry.summary()[0], `요약에 ${k} 키가 있어야 한다`);
  }
  assert.ok(['subscription', 'api'].includes(llmTelemetry.summary()[0].auth));
  assert.ok(['exact', 'approx'].includes(llmTelemetry.summary()[0].accuracy));
});
