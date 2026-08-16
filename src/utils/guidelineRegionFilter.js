// 트랙2(가이드라인) 지역 필터 — **미국·유럽·한국 발표 기관만** 받는다.
//
// PeterJ 확정 2026-08-16: *"저널지 기준 아예 미국 유럽 한국 꺼만 일단 넣어줘.
// 내가 브라질 가이드라인을 읽고 쓰지는 않을듯."*
//
// 왜 트랙2 에만 필요한가: 트랙1(논문)·트랙3(리뷰)은 **저널 등급**으로 이미 걸러진다
// (등급 낮은 저널은 감점되거나 아예 배제). 트랙2 는 그 장치가 없어서 전 세계 지침이
// 그대로 들어온다 — 실제로 이 모듈이 붙기 전까지 지역 판정은 census 분석용으로만
// 쓰이고 수집 경로에는 걸려 있지 않았다.

import { resolveRegion } from './guidelineRegion.js';

export const ALLOWED_REGIONS = new Set(['us', 'eu', 'kr']);

/**
 * @returns {{kept: Array, dropped: Array}} — 배제된 것도 **이유와 함께** 돌려준다.
 *   조용히 사라지면 "왜 이 지침이 안 왔나" 를 나중에 물을 수 없다.
 */
export function filterByRegion(candidates) {
  const kept = [];
  const dropped = [];
  for (const c of candidates ?? []) {
    // 수동 승인은 PeterJ의 최종 승인이다(확정 ⑤-A). 자동 필터가 뒤집지 않는다.
    if (c?.manualApproved === true) {
      kept.push({ ...c, region: 'manual', by: 'manual-approved' });
      continue;
    }
    const { region, by } = resolveRegion({
      title: c?.title,
      affiliationRegion: c?.affiliationRegion ?? null,
      journalRegion: c?.journalRegion ?? null,
    });
    if (region && ALLOWED_REGIONS.has(region)) {
      kept.push({ ...c, region, by });
      continue;
    }
    // ★ "그 외 지역" 과 "판정 불가" 는 다르다. 전자는 브라질 지침이고 후자는 우리가 못 가린
    //   것이다 — 후자가 많아지면 판정 규칙을 손봐야 한다는 신호이므로 구분해서 남긴다.
    dropped.push({
      pmid: c?.pmid ?? null,
      title: c?.title ?? '',
      region: region ?? null,
      reason: region ? `허용 외 지역(${region})` : '지역 판정 불가 (unknown)',
    });
  }
  return { kept, dropped };
}
