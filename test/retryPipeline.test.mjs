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

test('classifyFailure: 인증 실패(401·API키 무효·인증 실패)는 결정적(비재시도)', () => {
  // 2026-07-20 데일리 장애의 실제 에러 문자열
  const real = 'PICO analysis failed for all 1 paper(s): claude CLI exited with code 1: '
    + 'stdout={"is_error":true,"api_error_status":401,"result":"Failed to authenticate. '
    + 'API Error: 401 API key is invalid."}';
  assert.equal(classifyFailure(real).retryable, false);
  assert.match(classifyFailure(real).label, /인증/);
  assert.equal(classifyFailure('401 API key is invalid').retryable, false);
  assert.equal(classifyFailure('Failed to authenticate').retryable, false);
  assert.equal(classifyFailure('401 Unauthorized').retryable, false);
  // 429(세션 한도)는 401 규칙에 걸리지 않고 여전히 재시도 대상 — 오분류 회귀 방지
  assert.equal(classifyFailure('api_error_status: 429').retryable, true);
});

test('인증 실패는 runWithRetry에서 1회만 시도 (2.5시간 헛재시도 제거)', async () => {
  let attempts = 0;
  const res = await runWithRetry(
    () => ({ run: async () => { attempts++; throw new Error('api_error_status":401 — API key is invalid'); } }),
    { maxAttempts: 3, delayMs: 0, sleepFn: async () => {} },
  );
  assert.equal(res.ok, false);
  assert.equal(res.retryable, false);
  assert.equal(attempts, 1); // 결정적 인증 오류 → 재시도 없이 즉시 중단
});
