import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRACK_INTERVAL_DAYS, SEQUENTIAL_ORDER, cadenceFor, intervalFor, sequentialTrackFor, sequentialAllows } from '../src/utils/trackCadence.js';
import { nextRunDates } from '../src/utils/upcomingSchedule.js';

/**
 * ★ 2026-08-16 실측 결함 B2 — 배포된 예고는 가이드라인을 **매일** 그렸는데 발행 게이트는
 *   7일이었다. **화면이 거짓말을 하고 있었고 테스트는 전부 초록이었다** — 두 숫자가
 *   서로 다른 파일에 따로 적혀 있었기 때문이다.
 *   이 파일은 "게이트와 예고가 같은 곳을 본다" 를 잠근다.
 */

test('PeterJ 확정 4-A — 세 트랙 전부 매일', () => {
  assert.deepEqual(TRACK_INTERVAL_DAYS, { papers: 1, guidelines: 1, reviews: 1 });
});

test('★ 예고의 cadence 는 게이트 숫자에서 파생된다 (따로 적지 않는다)', () => {
  for (const t of Object.keys(TRACK_INTERVAL_DAYS)) {
    assert.equal(cadenceFor(t), intervalFor(t) <= 1 ? 'daily' : 'weekly');
  }
});

test('★ 예고 렌더가 cadence 를 하드코딩하지 않는다', async () => {
  const src = await readFile(new URL('../src/utils/GitHubPublisher.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async _renderUpcomingFromDisk('), src.indexOf('_renderGuidelineState('));
  assert.ok(body.includes('cadenceFor('), '예고가 주기를 정본에서 안 끌어온다');
  assert.equal(/cadence:\s*'(daily|weekly)'/.test(body), false,
    "예고에 cadence 가 하드코딩됐다 — 게이트와 어긋나면 화면이 거짓말한다(결함 B2)");
});

test('모르는 트랙은 막지 않는다 (소프트)', () => {
  assert.equal(intervalFor('unknown'), 1);
  assert.equal(cadenceFor('unknown'), 'daily');
});

// ── 순차진행 (PeterJ 확정 2026-08-16) ────────────────────────────────────────
test('순차진행은 논문 → 가이드라인 → 리뷰 순으로 하루 한 트랙', () => {
  assert.deepEqual(SEQUENTIAL_ORDER, ['papers', 'guidelines', 'reviews']);
  const days = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'];
  const owners = days.map(sequentialTrackFor);
  // 연속 3일이 서로 다른 트랙이고, 4일째에 첫 트랙으로 돌아온다.
  assert.equal(new Set(owners.slice(0, 3)).size, 3);
  assert.equal(owners[3], owners[0]);
  for (const d of days) {
    const owner = sequentialTrackFor(d);
    for (const t of SEQUENTIAL_ORDER) assert.equal(sequentialAllows(t, d), t === owner);
  }
});

test('★ 예고도 같은 회전을 본다 (게이트만 알고 화면은 모르면 또 거짓말이 된다)', () => {
  for (const t of SEQUENTIAL_ORDER) {
    const dates = nextRunDates({ from: '2026-08-17', days: 9, sequential: true, track: t });
    assert.ok(dates.length > 0, `${t} 예고 날짜가 하나도 없다`);
    for (const d of dates) {
      assert.equal(sequentialTrackFor(d), t, `${t} 예고에 남의 차례 날(${d})이 섞였다`);
    }
    // 3일에 한 번씩만 돈다
    assert.equal(dates.length, 3, `${t} 가 9일 창에서 3번이 아니다 (${dates.length})`);
  }
});

test('순차진행이 꺼져 있으면 매일 나온다', () => {
  const dates = nextRunDates({ from: '2026-08-17', days: 5, sequential: false, track: 'papers' });
  assert.equal(dates.length, 5);
});

test('날짜를 못 읽으면 막지 않는다 (소프트 — 고장이 배포를 끊으면 안 된다)', () => {
  assert.equal(sequentialTrackFor('garbage'), null);
  assert.equal(sequentialAllows('papers', 'garbage'), true);
});

/**
 * ★ 코드리뷰 실측 — `calendarDay` 가 형식만 검사하던 시절에는 `2026-02-31` 이 통과했고,
 *   게이트는 그 날을 계산했지만 예고 쪽 `addDays` 는 `Date.UTC` 로 `2026-03-03` 으로
 *   정규화해 **둘이 서로 다른 날을 봤다.** 연도 0000~0099 는 JS 의 1900년 보정까지 겹쳐
 *   게이트는 papers, 예고는 guidelines 를 골랐다. 없는 날짜는 양쪽 다 "판정 불가" 여야 한다.
 */
test('★ 없는 날짜는 게이트와 예고가 같이 판정 불가로 떨어진다', () => {
  for (const bad of ['2026-02-31', '2026-13-01', '0000-01-01', '2026-00-10', '2026-04-31']) {
    assert.equal(sequentialTrackFor(bad), null, `${bad} 를 실재하는 날짜로 봤다`);
    assert.equal(sequentialAllows('papers', bad), true, `${bad} 에서 소프트 폴백이 안 돈다`);
  }
  // 실재하는 경계는 살아 있어야 한다(윤년 포함) — 과잉 차단이면 이 줄이 잡는다.
  for (const ok of ['2028-02-29', '2026-02-28', '2026-12-31', '2026-01-01']) {
    assert.notEqual(sequentialTrackFor(ok), null, `${ok} 를 없는 날짜로 봤다`);
  }
});
