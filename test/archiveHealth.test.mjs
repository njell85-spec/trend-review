/**
 * 아카이브 판정 회귀 테스트 — GC#60.
 *
 * 2026-07-08~08-03, Google 인증이 만료돼 Drive 아카이브가 매일 죽었는데
 * 로그에는 "📚 Drive 아카이브 완료"가 찍혔다(안쪽 3단계 전부 실패인데 ok:true).
 * 워크플로도 초록이라 27일간 아무도 못 봤다. 여기서 잠그는 것은 딱 하나 —
 * **실패는 실패로 보여야 한다.**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveAgent, archiveHealthOf, archiveStatusText } from '../src/agents/ArchiveAgent.js';

const DAY = '2026-08-04';

test('단계 실패가 있으면 완료로 쓰지 않는다 (GC#60 회귀)', () => {
  const r = { ok: false, skipped: false, failures: ['리빙 Doc: invalid_grant'], pdf: false };
  const text = archiveStatusText(r);
  assert.match(text, /실패/);
  assert.ok(!text.includes('완료'), `"완료"가 들어가면 안 된다: ${text}`);
  assert.match(text, /invalid_grant/);
});

test('실패는 판정 파일에서도 ok:false — 게이트가 이걸 읽는다', () => {
  const h = archiveHealthOf(
    { ok: false, skipped: false, failures: ['PDF: invalid_grant', '리빙 Doc: invalid_grant'] }, DAY);
  assert.deepEqual(h, {
    ok: false,
    skipped: false,
    failures: ['PDF: invalid_grant', '리빙 Doc: invalid_grant'],
    date: DAY,
  });
});

test('전부 성공하면 완료 · ok:true', () => {
  const r = { ok: true, skipped: false, failures: [], pdf: true, docUpdated: true };
  assert.equal(archiveStatusText(r), '완료 (PDF 적재 · Doc 갱신)');
  assert.equal(archiveHealthOf(r, DAY).ok, true);
});

test('인증 미설정은 실패가 아니라 건너뜀 — 빨간불을 켜지 않는다', () => {
  const r = { ok: false, skipped: true, reason: 'google-auth-unset', failures: [] };
  assert.equal(archiveStatusText(r), '건너뜀: google-auth-unset');
  const h = archiveHealthOf(r, DAY);
  assert.equal(h.ok, true, '미설정 환경(로컬·포크)에서 매일 빨개지면 안 된다');
  assert.equal(h.skipped, true);
});

test('인증이 없는 환경에서 run()은 skipped를 돌려준다', async () => {
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) delete process.env[k];
  // credentials.json 이 없는 CI/테스트 환경 기준 — 폴백까지 실패해 auth=null
  process.env.GOOGLE_CREDENTIALS_PATH = '/nonexistent/credentials.json';
  const r = await new ArchiveAgent().run({ analysis: {}, todayKST: DAY });
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'google-auth-unset');
  assert.deepEqual(r.failures, []);
});
