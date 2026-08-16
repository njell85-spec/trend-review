import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultControl, normalizeControl, cycleMode, offDays, TRACKS } from '../src/utils/controlState.js';

// 트랙별 on/off/격일 제어. 브라우저(PeterJ 버튼)만 쓰고 러너는 **읽기만** 한다.
// 러너가 이 파일을 쓰기 시작하면 버튼 커밋과 서로 덮어쓰기가 시작된다(Fable 판정).

test('기본값은 세 트랙 모두 on 이다', () => {
  const c = defaultControl();
  for (const t of TRACKS) assert.equal(c.tracks[t].mode, 'on', `${t} 가 on 이 아니다`);
});

test('★ 파일이 없거나 깨져도 "전부 on" 으로 산다 — 제어 파일 때문에 데일리가 멈추면 안 된다', () => {
  assert.equal(normalizeControl(null).tracks.papers.mode, 'on');
  assert.equal(normalizeControl('쓰레기').tracks.papers.mode, 'on');
  assert.equal(normalizeControl({}).tracks.reviews.mode, 'on');
});

test('★ 모르는 모드는 on 으로 되돌린다 (오타로 트랙이 조용히 멈추면 안 된다)', () => {
  const c = normalizeControl({ tracks: { papers: { mode: 'ON' } } });
  assert.equal(c.tracks.papers.mode, 'on');
  const c2 = normalizeControl({ tracks: { papers: { mode: 'paused' } } });
  assert.equal(c2.tracks.papers.mode, 'on');
});

test('알려진 모드는 그대로 보존한다', () => {
  for (const m of ['on', 'off', 'alternate']) {
    assert.equal(normalizeControl({ tracks: { papers: { mode: m } } }).tracks.papers.mode, m);
  }
});

test('모르는 트랙 키는 버린다', () => {
  const c = normalizeControl({ tracks: { papers: { mode: 'off' }, 유령: { mode: 'off' } } });
  assert.equal(c.tracks.papers.mode, 'off');
  assert.equal(c.tracks.유령, undefined);
});

test('버튼 한 번에 on → off → alternate → on 으로 돈다', () => {
  assert.equal(cycleMode('on'), 'off');
  assert.equal(cycleMode('off'), 'alternate');
  assert.equal(cycleMode('alternate'), 'on');
  assert.equal(cycleMode('이상한값'), 'on');
});

test('off 로 바꾸면 그 날짜가 기록된다', () => {
  const c = normalizeControl({ tracks: { papers: { mode: 'off', since: '2026-08-13' } } });
  assert.equal(c.tracks.papers.since, '2026-08-13');
});

test('★ 시각은 날짜까지만 남는다 — public repo 에 분 단위가 쌓이면 생활 패턴이 된다', () => {
  const c = normalizeControl({ tracks: { papers: { mode: 'off', since: '2026-08-13T21:47:11Z' } } });
  assert.equal(c.tracks.papers.since, '2026-08-13', '분 단위가 남았다');
});

test('며칠째 off 인지 센다 (텔레그램 리포트가 먹는 값)', () => {
  assert.equal(offDays({ mode: 'off', since: '2026-08-13' }, '2026-08-16'), 3);
  assert.equal(offDays({ mode: 'off', since: '2026-08-16' }, '2026-08-16'), 0);
});

test('★ on 인 트랙은 off 일수가 null 이다 (0 이 아니다 — 0 은 "오늘 껐다" 를 뜻한다)', () => {
  assert.equal(offDays({ mode: 'on', since: '2026-08-13' }, '2026-08-16'), null);
});

test('since 가 없으면 off 여도 일수를 모른다', () => {
  assert.equal(offDays({ mode: 'off' }, '2026-08-16'), null);
});
