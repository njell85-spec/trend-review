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

// ── ★ 배선 회귀 ─────────────────────────────────────────────────────────────
// 이 세션에만 "모듈은 옳은데 아무도 안 부른다" 로 세 번 데였다(지역 필터·예고 렌더·
// import 누락). 게다가 데일리 진입점에서는 없는 변수를 참조해도 `node --check` 가 통과했다.
// 그래서 **실제로 호출해서** 결과 모양까지 본다.
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { readFile } from 'node:fs/promises';

test('★ 오케스트레이터에서 진행상황 계산이 실제로 돈다', async () => {
  const lines = await new TrendReviewOrchestrator()._buildProgressLines('2026-08-16');
  assert.equal(lines.length, 3, '세 트랙이 다 안 나온다');
  for (const l of lines) assert.match(l, /켜짐|꺼짐|격일/, `상태가 없다: ${l}`);
});

test('★ 데일리 진입점이 존재하지 않는 변수를 참조하지 않는다', async () => {
  // github-actions-daily.mjs 는 러너에서만 도는 파일이라 테스트가 실행 경로를 안 탄다.
  // 한 번 `orchestrator` 라는 없는 변수를 참조한 채 커밋될 뻔했다(node --check 는 통과했다).
  const src = await readFile(new URL('../github-actions-daily.mjs', import.meta.url), 'utf8');
  const call = src.match(/progressLines = await ([^;]+);/)?.[1] ?? '';
  assert.ok(call.includes('new TrendReviewOrchestrator()'),
    `진행상황 호출이 지역 변수를 참조한다: ${call}`);
});
