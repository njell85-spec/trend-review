// 읽음 상태 — **저장소에 올린다.**
//
// 지금까지 읽음 체크는 브라우저 localStorage 에만 있었다. 대시보드에서는 잘 보였지만
// **러너는 그것을 볼 수 없다.** 텔레그램 리포트는 러너가 만들기 때문에
// "몇 개 안 읽었다" 를 넣을 방법이 없었다. 그래서 저장소 파일로 올린다.
//
// 쓰는 주체는 **브라우저 하나뿐**이다. 러너는 읽기만 한다 —
// 러너가 이 파일을 정규화해서 되쓰면 브라우저 커밋과 상호 덮어쓰기가 시작된다.

/** localStorage 키. 바뀌면 기존 읽음 기록이 통째로 유실되므로 고정한다. */
export const READ_KEY = 'tr_read_v1';

export function normalizeRead(raw) {
  const out = { schemaVersion: 1, items: {} };
  const src = raw && typeof raw === 'object' ? raw.items : null;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string' || !v) continue;
    // 날짜까지만. public repo 에 분 단위 읽은 시각이 쌓이면 생활 패턴 시계열이 되고,
    // 공개 히스토리에 들어간 것은 회수할 수 없다.
    out.items[k] = v.slice(0, 10);
  }
  return out;
}

/** 읽음 표시/해제. **원본을 변형하지 않는다** — 브라우저가 커밋 실패 시 같은 입력으로 재시도한다. */
export function markRead(state, id, today, read = true) {
  const next = { ...state, items: { ...state.items } };
  if (read) next.items[String(id)] = today;
  else delete next.items[String(id)];   // false 로 남기면 "읽었다가 취소" 와 구분이 안 된다
  return next;
}

/** 발행된 것 중 읽음 표시가 없는 개수. 텔레그램 리포트가 먹는 값이다. */
export function unreadCount(publishedIds, state) {
  const items = state?.items ?? {};
  return (publishedIds ?? []).filter((id) => !(String(id) in items)).length;
}
