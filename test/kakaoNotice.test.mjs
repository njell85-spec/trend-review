import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';

test('sendNotice: 미설정이면 발송 없이 {sent:false} (소프트 게이트)', async () => {
  const k = new KakaoNotifier({ restApiKey: '', refreshToken: '' });
  const r = await k.sendNotice({ text: 'x', url: 'https://example.com' });
  assert.deepEqual(r, { sent: false, reason: 'not-configured' });
});
