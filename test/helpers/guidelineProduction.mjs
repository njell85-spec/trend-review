import { readFile } from 'node:fs/promises';

// 프로덕션 상태 파일은 **v1 배열 → v2 객체**로 한 번 갈아탔다(2026-08-16 데일리에서 실제로 넘어갔다).
// 실물을 읽는 테스트들이 배열 모양을 그대로 가정하고 있어서, 마이그레이션이 프로덕션에
// 착지한 날 여섯 개가 한꺼번에 깨졌다. 모양 갈아타기는 앞으로도 또 있을 수 있으므로
// **읽는 자리를 여기 한 곳으로 모은다** — 테스트는 "옛 발행 이력 배열"만 요구하면 된다.

const PRODUCTION = new URL('../../output/selected_guidelines.json', import.meta.url);

/** 파일 원문(모양 불문). */
export async function readProductionRaw() {
  return JSON.parse(await readFile(PRODUCTION, 'utf8'));
}

/**
 * 발행 이력을 **v1 배열 모양**으로 돌려준다.
 * v2 객체면 `published[].legacy` 를 꺼내고, 아직 배열이면 그대로 쓴다.
 */
export async function readPublishedLegacy() {
  const raw = await readProductionRaw();
  if (Array.isArray(raw)) return raw;
  return (raw.published ?? []).map((item) => item.legacy ?? item);
}
