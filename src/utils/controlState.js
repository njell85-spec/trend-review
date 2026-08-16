// 트랙별 on/off/격일 제어 상태.
//
// **쓰는 주체는 브라우저(PeterJ 버튼) 하나뿐이다.** 러너는 읽기만 한다 —
// 러너가 이 파일을 정규화해서 되쓰기 시작하면 버튼 커밋과 상호 덮어쓰기가 시작된다.
// 그래서 `normalizeControl` 은 **메모리에서만** 정규화하고 파일로 되돌려 쓰지 않는다.

export const TRACKS = ['papers', 'guidelines', 'reviews'];
const MODES = new Set(['on', 'off', 'alternate']);

/** 다음 모드. 버튼 한 번에 on → off → 격일 → on. */
export function cycleMode(mode) {
  if (mode === 'on') return 'off';
  if (mode === 'off') return 'alternate';
  return 'on';
}

export function defaultControl() {
  return { schemaVersion: 1, tracks: Object.fromEntries(TRACKS.map((t) => [t, { mode: 'on', since: null }])) };
}

/**
 * 어떤 입력이 와도 **살아 있는 제어 상태**를 돌려준다.
 *
 * ★ 파일이 없거나 깨져도 "전부 on" 으로 산다. 제어 파일 하나 때문에 데일리가 멈추면
 * 고장이 조용히 배포를 끊는다 — 그건 이 저장소가 가장 오래 싸운 실패 양상이다.
 * 모르는 모드도 on 으로 되돌린다(오타로 트랙이 소리 없이 죽는 것을 막는다).
 */
export function normalizeControl(raw) {
  const base = defaultControl();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw.tracks && typeof raw.tracks === 'object' ? raw.tracks : {};
  for (const t of TRACKS) {
    const v = src[t];
    if (!v || typeof v !== 'object') continue;
    if (MODES.has(v.mode)) base.tracks[t].mode = v.mode;
    // 시각은 날짜까지만. public repo 에 분 단위가 쌓이면 생활 패턴 시계열이 된다.
    if (typeof v.since === 'string' && v.since) base.tracks[t].since = v.since.slice(0, 10);
  }
  return base;
}

/**
 * 며칠째 off 인지. 텔레그램 리포트가 먹는 값이다.
 * ★ on 이면 `null` 이다 — `0` 은 "오늘 껐다" 를 뜻하므로 섞으면 안 된다.
 */
export function offDays(track, today) {
  if (!track || track.mode !== 'off' || !track.since) return null;
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd, 12); };
  return Math.round((d(today) - d(track.since)) / 86_400_000);
}
