import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthConfig } from '../src/utils/googleAuth.js';

test('env 3종이 모두 있으면 env 설정을 반환한다', () => {
  const cfg = buildAuthConfig({
    GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_REFRESH_TOKEN: 'rt',
  });
  assert.deepEqual(cfg, { clientId: 'id', clientSecret: 'sec', refreshToken: 'rt', source: 'env' });
});

test('하나라도 빠지면 null (부분 설정은 오류 아님)', () => {
  assert.equal(buildAuthConfig({ GOOGLE_CLIENT_ID: 'id' }), null);
  assert.equal(buildAuthConfig({}), null);
});

test('빈 문자열은 미설정으로 취급한다', () => {
  assert.equal(buildAuthConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r' }), null);
});
