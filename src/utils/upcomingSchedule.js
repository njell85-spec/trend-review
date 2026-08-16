// 1주치 예고 리스트의 날짜 계산.
//
// ★ 예고 날짜는 **저장하지 않는다.** 큐 순서와 트랙 주기·온오프에서 렌더 시점에 계산한다.
// 저장하면 🗑 하나 누를 때마다 뒤 항목 전부의 날짜를 다시 써서 커밋해야 한다.
// 계산으로 두면 "지운 자리를 다음 항목이 물려받는다"(= PeterJ가 원한 자동 충원)가
// 코드 한 줄 없이 공짜로 된다 — 큐에서 하나 빠지면 다음 것이 그 자리에 올 뿐이다.
//
// 날짜는 처음부터 끝까지 'YYYY-MM-DD' 문자열로만 다룬다. Date 객체를 돌리면
// 컨테이너 타임존과 KST 가 어긋나 하루가 밀린다 — 이 저장소가 이미 겪은 부류다.

/** 'YYYY-MM-DD' 에 일수를 더한다. UTC 정오를 기준으로 삼아 DST·타임존 밀림을 피한다. */
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * 트랙 하나가 앞으로 `days` 일 창에서 **발행할 날짜들**.
 * mode: 'on' 매일 · 'alternate' 격일 · 'off' 안 나옴
 * cadence: 'daily' 주기대로 · 'weekly' 창에 한 번
 */
export function nextRunDates({ from, days, mode = 'on', cadence = 'daily' }) {
  if (mode === 'off') return [];
  if (cadence === 'weekly') return [from];
  const step = mode === 'alternate' ? 2 : 1;
  const out = [];
  for (let i = 0; i < days; i += step) out.push(addDays(from, i));
  return out;
}

/**
 * 큐를 날짜에 붙여 예고 리스트를 만든다.
 *
 * ★ 큐가 날짜보다 짧으면 **남는 날은 비워둔다.** 없는 것을 지어내면
 * PeterJ가 "있다고 믿고 안 채우는" 상태가 되므로, 빈 것은 빈 채로 보여야 한다.
 */
export function buildUpcoming({ from, days, tracks = [] }) {
  const rows = [];
  for (const t of tracks) {
    const dates = nextRunDates({ from, days, mode: t.mode, cadence: t.cadence });
    // ★ 제목 없는 항목은 예고에 올리지 않는다. 화면에 **빈 줄**로 떠서 무엇을 지우는지
    //   무엇을 먼저 돌리는지 알 수 없게 된다(실측: 테스트 픽스처가 흘러들어와 빈 줄이 떴다).
    //   큐에서 지우지는 않는다 — 데이터 문제이지 큐 자체의 문제가 아니다.
    const queue = (t.state?.queue ?? []).filter((x) => String(x?.title ?? '').trim());
    // 큐 머리부터 순서대로. 큐가 모자라면 거기서 멈춘다.
    for (let i = 0; i < Math.min(dates.length, queue.length); i += 1) {
      rows.push({
        date: dates[i],
        track: t.key,
        trackLabel: t.label,
        item: queue[i],
        lowConfidence: queue[i]?.lowConfidence === true,
      });
    }
  }
  // 같은 날짜면 트랙 정의 순서를 유지한다(정렬이 결정적이어야 화면이 안 흔들린다).
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .map(({ r }) => r);
}
