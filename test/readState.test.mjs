import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRead, markRead, unreadCount, READ_KEY } from '../src/utils/readState.js';

// 읽음 상태. 지금까지는 localStorage 에만 있어서 **러너가 못 봤다** —
// 그래서 텔레그램 리포트에 "몇 개 안 읽었다" 를 넣을 수 없었다.
// 저장소로 올려야 리포트가 먹을 수 있다.

test('빈/깨진 입력도 살아난다', () => {
  assert.deepEqual(normalizeRead(null).items, {});
  assert.deepEqual(normalizeRead('쓰레기').items, {});
  assert.deepEqual(normalizeRead({ items: '아님' }).items, {});
});

test('읽음 표시는 날짜로 남는다', () => {
  const s = markRead(normalizeRead(null), '123', '2026-08-16');
  assert.equal(s.items['123'], '2026-08-16');
});

test('★ 시각은 날짜까지만 — public repo 에 분 단위가 쌓이면 생활 패턴이 된다', () => {
  const s = normalizeRead({ items: { '123': '2026-08-16T21:47:11Z' } });
  assert.equal(s.items['123'], '2026-08-16');
});

test('읽음 해제하면 항목이 사라진다 (false 로 남기지 않는다)', () => {
  let s = markRead(normalizeRead(null), '123', '2026-08-16');
  s = markRead(s, '123', '2026-08-16', false);
  assert.equal('123' in s.items, false);
});

test('★ 원본을 변형하지 않는다 (브라우저가 재시도할 때 같은 입력을 다시 쓴다)', () => {
  const before = normalizeRead(null);
  const snapshot = JSON.stringify(before);
  markRead(before, '1', '2026-08-16');
  assert.equal(JSON.stringify(before), snapshot);
});

test('미독 수를 센다 — 발행됐는데 읽음 표시가 없는 것', () => {
  const read = normalizeRead({ items: { a: '2026-08-16' } });
  assert.equal(unreadCount(['a', 'b', 'c'], read), 2);
});

test('★ 발행 목록이 비면 미독은 0이다 (읽을 게 없는 것과 안 읽은 것은 다르다)', () => {
  assert.equal(unreadCount([], normalizeRead(null)), 0);
});

test('읽음 목록에 있지만 발행 목록에 없는 것은 미독 계산에 영향 없다', () => {
  const read = normalizeRead({ items: { x: '2026-08-01', y: '2026-08-02' } });
  assert.equal(unreadCount(['a'], read), 1);
});

test('저장 키는 고정이다 (바뀌면 기존 읽음 기록이 통째로 유실된다)', () => {
  assert.equal(READ_KEY, 'tr_read_v1');
});

// ── 브라우저 배선 회귀 ──────────────────────────────────────────────────────
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const page = () => new GitHubPublisher({ owner: 'o', repo: 'r' }).buildPage('');

test('★ 읽음 체크가 저장소로도 올라간다 (localStorage 만이면 러너가 못 본다)', () => {
  const h = page();
  assert.match(h, /contents\/output\/read_state\.json|'output\/read_state\.json'/,
    '읽음 상태를 저장소에 올리는 경로가 없다');
  assert.match(h, /method:'PUT'/, '커밋하는 코드가 없다');
});

test('★ 토큰은 헤더로만 간다 — URL 에 실으면 히스토리·로그에 남는다', () => {
  const h = page();
  assert.ok(!/read_state\.json\?[^"']*(token|access_token)=/.test(h), '토큰이 URL 에 실렸다');
  assert.match(h, /Authorization:'Bearer '\+t/);
});

test('★ 토큰이 없어도 화면 표시는 된다 (읽음 체크가 토큰을 요구하면 안 된다)', () => {
  const h = page();
  // 토큰이 없으면 push 가 조용히 반환한다 — prompt 를 띄우지 않는다.
  assert.match(h, /if\(!t\)\{return;\}/, '토큰 없을 때 조용히 넘어가는 경로가 없다');
  assert.ok(!/readcb[\s\S]{0,400}prompt\(/.test(h), '읽음 체크가 토큰을 조른다');
});

test('★ 커밋은 날짜만 싣는다 (분 단위 읽은 시각이 공개 히스토리에 쌓이면 안 된다)', () => {
  const h = page();
  assert.match(h, /toISOString\(\)\.slice\(0,10\)/, '날짜 절단이 없다');
});
