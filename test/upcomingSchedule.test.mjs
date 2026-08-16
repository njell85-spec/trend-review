import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpcoming, nextRunDates } from '../src/utils/upcomingSchedule.js';

// ★ 예고 날짜는 **저장하지 않고 렌더 시점에 계산한다**(Fable 판정 2026-08-16).
// 날짜를 큐에 박아두면 🗑 하나 누를 때마다 뒤 항목 전부의 날짜를 다시 써야 해서
// 커밋이 매번 난다. 계산으로 두면 "🗑 → 다음 항목이 그 날짜를 물려받는다" 가 공짜다.
// 그래서 이 계산이 틀리면 화면 전체가 틀린다 — 여기가 예고 기능의 급소다.

const D = (s) => s;   // 날짜는 'YYYY-MM-DD' 문자열로만 다룬다(타임존 사고 방지)

test('매일 트랙: 오늘부터 하루 간격으로 채운다', () => {
  assert.deepEqual(
    nextRunDates({ from: D('2026-08-16'), days: 5, mode: 'on', cadence: 'daily' }),
    ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']);
});

// ★ 격일은 **달력 패리티**로 바뀌었다 (2026-08-16 리뷰 B13).
//   종전에는 `from` 부터 두 칸씩 셌는데, 게이트는 다른 기준으로 판정해 둘이 하루씩
//   엇갈렸다. 이제 양쪽 다 `trackRunsOn` 을 부르므로 어긋날 수 없다.
//   그래서 "무슨 날이 나오는가" 는 시작일이 아니라 달력이 정한다.
test('격일 트랙: 하루 걸러 나오고, 어느 날부터 세든 같은 날들이 나온다', () => {
  const a = nextRunDates({ from: D('2026-08-16'), days: 7, mode: 'alternate', cadence: 'daily' });
  const b = nextRunDates({ from: D('2026-08-17'), days: 6, mode: 'alternate', cadence: 'daily' });
  // 하루 걸러 나온다 (7일 창이면 3~4일 — 창이 짝수 날에서 시작하는지에 달렸다)
  assert.ok(a.length === 3 || a.length === 4, `격일인데 ${a.length}일이 나왔다`);
  for (let i = 1; i < a.length; i += 1) {
    const gap = (new Date(a[i]) - new Date(a[i - 1])) / 86_400_000;
    assert.equal(gap, 2, `${a[i - 1]} → ${a[i]} 간격이 2일이 아니다`);
  }
  // ★ 시작일을 바꿔도 같은 계열이다 — 이것이 게이트와 안 어긋나는 이유다.
  for (const d of b) assert.ok(a.includes(d), `시작일에 따라 격일 계열이 달라졌다 (${d})`);
});

test('★ off 면 날짜가 하나도 안 나온다 — 예고도 비어야 한다', () => {
  assert.deepEqual(
    nextRunDates({ from: D('2026-08-16'), days: 7, mode: 'off', cadence: 'daily' }), []);
});

test('주간 트랙(리뷰): 7일 창에 한 번만 나온다', () => {
  const r = nextRunDates({ from: D('2026-08-16'), days: 7, mode: 'on', cadence: 'weekly' });
  assert.equal(r.length, 1);
  assert.equal(r[0], '2026-08-16');
});

test('★ 월 경계를 넘어도 날짜가 깨지지 않는다', () => {
  assert.deepEqual(
    nextRunDates({ from: D('2026-08-30'), days: 4, mode: 'on', cadence: 'daily' }),
    ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
});

test('★ 윤년 2월을 넘어도 깨지지 않는다', () => {
  assert.deepEqual(
    nextRunDates({ from: D('2028-02-27'), days: 4, mode: 'on', cadence: 'daily' }),
    ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
});

// ── 큐를 날짜에 붙이는 부분 ─────────────────────────────────────────────────

const q = (n) => ({ queue: Array.from({ length: n }, (_, i) => ({
  pmid: String(100 + i), title: `논문 ${i}`, journal: 'J', score: 10 - i })) });

test('큐 머리부터 날짜 순으로 붙는다', () => {
  const out = buildUpcoming({
    from: D('2026-08-16'), days: 3,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: q(5) }],
  });
  assert.deepEqual(out.map((x) => [x.date, x.item.pmid]),
    [['2026-08-16', '100'], ['2026-08-17', '101'], ['2026-08-18', '102']]);
});

test('★ 큐가 날짜보다 짧으면 남는 날은 비워둔다 (없는 것을 지어내지 않는다)', () => {
  const out = buildUpcoming({
    from: D('2026-08-16'), days: 5,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: q(2) }],
  });
  assert.equal(out.length, 2, '큐에 있는 만큼만 예고한다');
});

test('★ 삭제로 큐 머리가 빠지면 다음 항목이 그 날짜를 물려받는다 (자동 충원의 정체)', () => {
  const before = buildUpcoming({
    from: D('2026-08-16'), days: 2,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: q(4) }],
  });
  assert.equal(before[0].item.pmid, '100');
  // 100 을 지운 상태 = queue 머리가 101 이 된 것
  const after = buildUpcoming({
    from: D('2026-08-16'), days: 2,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: q(4).queue.slice(1) } }],
  });
  assert.equal(after[0].item.pmid, '101', '지운 자리를 다음 항목이 채운다');
  assert.equal(after[0].date, '2026-08-16', '날짜는 그대로 — 하루 밀리지 않는다');
});

test('여러 트랙이 섞이면 날짜 오름차순으로 정렬된다', () => {
  const out = buildUpcoming({
    from: D('2026-08-16'), days: 3,
    tracks: [
      { key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: q(3) },
      { key: 'reviews', label: '리뷰', cadence: 'weekly', mode: 'on', state: q(2) },
    ],
  });
  const dates = out.map((x) => x.date);
  assert.deepEqual([...dates].sort(), dates, '날짜 오름차순이어야 한다');
  assert.equal(out.filter((x) => x.track === 'reviews').length, 1, '주간은 창에 하나');
});

test('★ off 인 트랙은 결과에서 통째로 빠진다', () => {
  const out = buildUpcoming({
    from: D('2026-08-16'), days: 3,
    tracks: [
      { key: 'papers', label: '논문', cadence: 'daily', mode: 'off', state: q(3) },
      { key: 'reviews', label: '리뷰', cadence: 'weekly', mode: 'on', state: q(2) },
    ],
  });
  assert.equal(out.filter((x) => x.track === 'papers').length, 0);
  assert.equal(out.length, 1);
});

test('lowConfidence 항목은 표시가 따라온다 (계산만 되고 출구가 없던 값)', () => {
  const out = buildUpcoming({
    from: D('2026-08-16'), days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1, lowConfidence: true }] } }],
  });
  assert.equal(out[0].lowConfidence, true);
});

// ★ 타임존 회귀 — 이 테스트가 없으면 변이가 안 잡힌다(실측).
// 컨테이너가 UTC 라 로컬 자정 == UTC 자정이 되어, `new Date(y,m-1,d)` 로 짜도 초록이었다.
// 실제 운영은 KST 이고 러너는 UTC 다. 음수 오프셋에서는 로컬 자정이 UTC 로 **전날**이라
// `toISOString().slice(0,10)` 이 하루 앞선 날짜를 준다 — 예고가 통째로 하루 밀린다.
test('★ 어떤 타임존에서도 날짜가 밀리지 않는다', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['Asia/Seoul', 'America/New_York', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = tz;
      assert.deepEqual(
        nextRunDates({ from: '2026-08-16', days: 3, mode: 'on', cadence: 'daily' }),
        ['2026-08-16', '2026-08-17', '2026-08-18'], `${tz} 에서 밀렸다`);
    }
  } finally { process.env.TZ = saved; }
});

test('★ 제목 없는 항목은 예고에 안 뜬다 (빈 줄은 지울지 돌릴지 알 수 없다)', () => {
  const out = buildUpcoming({ from: '2026-08-16', days: 3,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [
        { pmid: '1', title: '', score: 9 },
        { pmid: '2', title: '   ', score: 8 },
        { pmid: '3', title: '진짜 제목', score: 7 }] } }] });
  assert.deepEqual(out.map((x) => x.item.pmid), ['3']);
  assert.equal(out[0].date, '2026-08-16', '빈 항목 때문에 날짜가 밀리면 안 된다');
});
