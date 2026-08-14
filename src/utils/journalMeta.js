/**
 * 저널 부가정보 — 영향력지수(IF) 조회.
 *
 * IF 는 Clarivate JCR 유료 데이터라 자동 수집 경로가 없다. `config/journals.json` 의
 * `impactFactors` 에 손으로 넣고 PeterJ 가 폰에서 숫자만 고친다(PeterJ 확정 2026-08-14:
 * "걍 정확하지 않아도 통상적으로 알려진 IF 적어봐").
 *
 * ★ 모르는 저널은 **아무것도 반환하지 않는다.** 틀린 IF 를 찍는 것보다 안 찍는 것이 낫다.
 */
import { readFileSync } from 'fs';

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(new URL('../../config/journals.json', import.meta.url), 'utf8'));
    cache = raw?.impactFactors ?? {};
  } catch { cache = {}; }
  return cache;
}

/** 테스트용 주입 (파일 IO 없이 표를 갈아끼운다). */
export function setImpactFactors(map) { cache = map ?? {}; }

/**
 * @param {string} journal 저널명(대소문자 무관)
 * @returns {number|null} IF, 없으면 null
 */
export function impactFactor(journal) {
  const table = load();
  const j = String(journal ?? '').toLowerCase().trim();
  if (!j) return null;
  if (table[j] != null) return Number(table[j]);
  // PubMed 는 동명 저널을 가르려고 발행지를 괄호로 덧붙인다 — 떼고 한 번 더 본다
  // (`Shock (Augusta, Ga.)` → `shock`). 저널 티어 판정과 같은 정규화다.
  const bare = j.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return table[bare] != null ? Number(table[bare]) : null;
}

/** 표시용 문자열. 없으면 빈 문자열이라 그대로 이어붙여도 안전하다. */
export function impactFactorLabel(journal, { prefix = ' · ' } = {}) {
  const v = impactFactor(journal);
  return v == null ? '' : `${prefix}IF ${v}`;
}
