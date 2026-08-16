import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressLines } from '../src/utils/trackProgress.js';

// 텔레그램 리포트의 "진행상황" 줄. PeterJ 요구:
//   "1 2 3 트랙에서 진행상황들. 몇개 안읽었고 며칠째 off한 상태 뭐 이런거"

const base = {
  today: '2026-08-16',
  control: { tracks: { papers: { mode: 'on' }, guidelines: { mode: 'on' }, reviews: { mode: 'on' } } },
  read: { items: {} },
  published: { papers: ['1', '2'], guidelines: ['3'], reviews: [] },
};

test('트랙마다 한 줄씩 나온다', () => {
  const lines = buildProgressLines(base);
  assert.equal(lines.length, 3);
});

test('미독 수가 실린다', () => {
  const lines = buildProgressLines({ ...base, read: { items: { 1: '2026-08-15' } } });
  assert.match(lines[0], /미독 1/);
});

test('★ 며칠째 off 인지 나온다 (PeterJ가 명시적으로 요구한 값)', () => {
  const lines = buildProgressLines({ ...base,
    control: { tracks: { ...base.control.tracks, reviews: { mode: 'off', since: '2026-08-13' } } } });
  const rv = lines.find((l) => l.includes('리뷰'));
  assert.match(rv, /꺼짐/);
  assert.match(rv, /3일째/);
});

test('오늘 끈 것은 "오늘부터" 로 쓴다 (0일째는 어색하다)', () => {
  const lines = buildProgressLines({ ...base,
    control: { tracks: { ...base.control.tracks, reviews: { mode: 'off', since: '2026-08-16' } } } });
  assert.match(lines.find((l) => l.includes('리뷰')), /오늘부터/);
});

test('since 가 없는 off 는 일수 없이 꺼짐만 쓴다 (모르는 것을 지어내지 않는다)', () => {
  const lines = buildProgressLines({ ...base,
    control: { tracks: { ...base.control.tracks, reviews: { mode: 'off' } } } });
  const rv = lines.find((l) => l.includes('리뷰'));
  assert.match(rv, /꺼짐/);
  assert.ok(!/일째/.test(rv), '모르는 일수를 지어냈다');
});

test('격일은 격일이라고 쓴다', () => {
  const lines = buildProgressLines({ ...base,
    control: { tracks: { ...base.control.tracks, papers: { mode: 'alternate' } } } });
  assert.match(lines[0], /격일/);
});

test('★ 미독이 0이면 "다 읽음" 으로 쓴다 (0을 굳이 보여주지 않는다)', () => {
  const lines = buildProgressLines({ ...base, read: { items: { 1: 'x', 2: 'x', 3: 'x' } } });
  assert.match(lines[0], /다 읽음/);
});

test('발행된 게 없으면 아직 없다고 쓴다', () => {
  const lines = buildProgressLines(base);
  assert.match(lines.find((l) => l.includes('리뷰')), /아직 없음/);
});

test('★ 제어 상태가 없어도 안 터지고 전부 켜짐으로 본다', () => {
  const lines = buildProgressLines({ ...base, control: null });
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => !/꺼짐/.test(l)));
});
