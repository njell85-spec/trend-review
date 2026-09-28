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

// 2026-09-28 — drive.file 과 youtube.upload 는 한 요청에 같이 못 받는다(구글 400) → 용도별 토큰
test('YouTube 용도는 전용 토큰(GOOGLE_YT_REFRESH_TOKEN)을 우선한다', () => {
  const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_REFRESH_TOKEN: 'drive-rt', GOOGLE_YT_REFRESH_TOKEN: 'yt-rt' };
  assert.equal(buildAuthConfig(env, { purpose: 'youtube' }).refreshToken, 'yt-rt');
  assert.equal(buildAuthConfig(env).refreshToken, 'drive-rt', 'Drive(기본)는 전용 토큰을 쓰지 않는다');
});

test('YouTube 전용 토큰이 없으면 공용 토큰으로 떨어진다(구 설정 호환)', () => {
  const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_REFRESH_TOKEN: 'rt' };
  assert.equal(buildAuthConfig(env, { purpose: 'youtube' }).refreshToken, 'rt');
});

test('Drive·YouTube 권한은 각각 하나씩 — 섞지 않는다', async () => {
  const { DRIVE_SCOPES, YOUTUBE_SCOPES } = await import('../src/utils/googleAuth.js');
  assert.deepEqual(DRIVE_SCOPES, ['https://www.googleapis.com/auth/drive.file']);
  assert.deepEqual(YOUTUBE_SCOPES, ['https://www.googleapis.com/auth/youtube.upload']);
});
