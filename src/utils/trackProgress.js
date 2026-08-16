// 텔레그램 리포트의 트랙별 진행상황 줄.
//
// PeterJ 요구: *"1 2 3 트랙에서 진행상황들. 몇개 안읽었고 며칠째 off한 상태 뭐 이런거"*
// 리포트는 폰에서 읽는다 — 트랙당 **한 줄**을 넘기지 않는다.

import { normalizeControl, offDays, TRACKS } from './controlState.js';
import { normalizeRead, unreadCount } from './readState.js';

const LABEL = { papers: '논문', guidelines: '가이드라인', reviews: '리뷰' };

export function buildProgressLines({ today, control, read, published } = {}) {
  const c = normalizeControl(control);
  const r = normalizeRead(read);
  return TRACKS.map((key) => {
    const t = c.tracks[key];
    const ids = published?.[key] ?? [];
    // 상태: 꺼짐이면 며칠째인지까지. since 를 모르면 **지어내지 않는다.**
    let state;
    if (t.mode === 'off') {
      const d = offDays(t, today);
      state = d === null ? '꺼짐' : (d === 0 ? '꺼짐(오늘부터)' : `꺼짐(${d}일째)`);
    } else state = t.mode === 'alternate' ? '격일' : '켜짐';
    // 읽기 상태: 0을 굳이 숫자로 보여주지 않는다 — "다 읽음" 이 한눈에 낫다.
    const n = unreadCount(ids, r);
    const readPart = ids.length === 0 ? '아직 없음' : (n === 0 ? '다 읽음' : `미독 ${n}`);
    return `${LABEL[key]} · ${state} · ${readPart}`;
  });
}
