import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithRetry, classifyFailure } from '../src/utils/retryPipeline.js';

test('delayMs=0 이어도 retryable 실패를 maxAttempts만큼 재시도한다 (delay 게이트 회귀 방지)', async () => {
  let attempts = 0;
  const res = await runWithRetry(
    () => ({ run: async () => { attempts++; throw new Error('session limit'); } }),
    { maxAttempts: 3, delayMs: 0, sleepFn: async () => {} },
  );
  assert.equal(res.ok, false);
  assert.equal(attempts, 3); // delayMs=0에도 3회 모두 시도 (과거엔 1회에서 멈춤)
});

test('결정적(비재시도) 오류는 delayMs 무관하게 1회만 시도', async () => {
  let attempts = 0;
  const res = await runWithRetry(
    () => ({ run: async () => { attempts++; throw new Error('has not been trusted'); } }),
    { maxAttempts: 3, delayMs: 0, sleepFn: async () => {} },
  );
  assert.equal(res.ok, false);
  assert.equal(res.retryable, false);
  assert.equal(attempts, 1);
});

test('classifyFailure: 세션 한도=retryable, 신뢰 미설정=결정적', () => {
  assert.equal(classifyFailure('api_error_status: 429').retryable, true);
  assert.equal(classifyFailure('workspace has not been trusted').retryable, false);
});
