/**
 * llmTelemetry — 토큰·비용 누적 계약 테스트.
 *
 * 이 집계가 타워(global-config) 사용량 장부의 원자료가 되므로, 조용히 0이 되거나
 * 재시도 때 사라지는 회귀를 여기서 잡는다. 계약: rulebook/usage-accounting.md C1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmTelemetry } from '../src/utils/LLMClient.js';

const CLI_USAGE = {
  input_tokens: 2,
  output_tokens: 4,
  cache_creation_input_tokens: 47951,
  cache_read_input_tokens: 10,
};

test('빈 상태의 summary()는 빈 배열', () => {
  llmTelemetry.resetTotals();
  assert.deepEqual(llmTelemetry.summary(), []);
});

test('구독 CLI 호출을 토큰·비용까지 누적한다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', {
    models: ['claude-opus-4-8'],
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
  // 부동소수 잔재가 장부로 새지 않아야 한다
  assert.equal(rec.cost_usd, 0.287772);
  assert.equal(rec.calls, 1);
});

test('여러 호출이 더해지고, 모델이 섞이면 +로 이어붙인다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', { models: ['claude-opus-4-8'], usage: CLI_USAGE, costUsd: 1 });
  llmTelemetry.record('subscription', { models: ['claude-sonnet-4-6'], usage: CLI_USAGE, costUsd: 2 });

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.calls, 2);
  assert.equal(rec.in, 4);
  assert.equal(rec.cache_w, 47951 * 2);
  assert.equal(rec.cost_usd, 3);
  assert.equal(rec.model, 'claude-opus-4-8+claude-sonnet-4-6');
});

test('구독과 API가 섞이면 auth별로 레코드가 분리된다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', { models: ['claude-opus-4-8'], usage: CLI_USAGE, costUsd: 0.5 });
  llmTelemetry.record('api', { models: ['claude-sonnet-4-6'], usage: { input_tokens: 100, output_tokens: 7 } });

  const recs = llmTelemetry.summary();
  assert.equal(recs.length, 2);

  const sub = recs.find((r) => r.auth === 'subscription');
  const api = recs.find((r) => r.auth === 'api');
  assert.equal(sub.cost_usd, 0.5);
  assert.equal(api.in, 100);
  assert.equal(api.out, 7);
  // Messages API는 비용을 안 돌려주므로 0이어야 한다(추정치를 몰래 채우지 않는다)
  assert.equal(api.cost_usd, 0);
  // 없는 필드는 0으로 떨어져야 한다 — undefined가 장부에 새면 JSON이 깨진다
  assert.equal(api.cache_w, 0);
  assert.equal(api.cache_r, 0);
});

test('reset()은 런 카운터만 지우고 토큰 누적은 보존한다 (재시도 누락 방지)', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.cli = 3;
  llmTelemetry.record('subscription', { models: ['claude-opus-4-8'], usage: CLI_USAGE, costUsd: 0.5 });

  llmTelemetry.reset(); // 세션 한도로 재시도 → 오케스트레이터가 런 시작 시 호출

  assert.equal(llmTelemetry.cli, 0, 'label()용 런 카운터는 초기화되어야 한다');
  const [rec] = llmTelemetry.summary();
  assert.equal(rec.calls, 1, '실패한 시도에서 태운 토큰도 장부에 남아야 한다');
  assert.equal(rec.cost_usd, 0.5);
});

test('숫자가 아닌 usage 값은 0으로 떨어진다', () => {
  llmTelemetry.resetTotals();
  llmTelemetry.record('subscription', {
    models: [],
    usage: { input_tokens: null, output_tokens: 'x', cache_creation_input_tokens: undefined },
  });

  const [rec] = llmTelemetry.summary();
  assert.equal(rec.in, 0);
  assert.equal(rec.out, 0);
  assert.equal(rec.cache_w, 0);
  assert.equal(rec.model, 'unknown');
});

test('label()의 기존 출력은 바뀌지 않는다 (카톡·job summary 문구 보존)', () => {
  llmTelemetry.reset();
  assert.equal(llmTelemetry.label(), '—');
  llmTelemetry.cli = 2;
  llmTelemetry.api = 1;
  assert.equal(llmTelemetry.label(), '구독×2 · API×1');
  llmTelemetry.reset();
});
