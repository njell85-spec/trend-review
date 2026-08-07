/**
 * userSuppliedText — PeterJ 가 직접 넘긴 본문을 분석 문서에 얹는다 (on-demand 전용).
 *
 * 존재 이유: 페이월 문헌(NEJM 등)은 러너가 원문을 못 읽는다. `fetchSourceText` 는 403 을
 * 맞고, LLM 웹검색 보강도 유료 장벽 앞에서 멈춘다. 그러면 카드가 초록 수준으로 얇아진다.
 * 이 통로는 그때 PeterJ 가 확보한 본문(요지 정리본)을 `fullText` 자리에 넣어준다.
 *
 * ★ 공개 저장소 주의: on-demand 는 public repo 에서 돌고, workflow_dispatch 입력값은
 * Actions 실행 화면에 그대로 남는다. 따라서 여기에 **유료 원문을 그대로 옮겨 붙이지 않는다** —
 * 수치·역치·권고 같은 사실 위주의 정리본을 넣는다. (카드에 실릴 내용과 같은 수준)
 *
 * 데일리 코어 무영향: 이 모듈은 scripts/on-demand.mjs 에서만 호출된다.
 */

/** 이보다 짧으면 본문으로 치지 않는다 — 오타·빈 입력이 초록을 덮어쓰는 것을 막는다. */
export const MIN_TEXT_LEN = 100;

/** LLM 컨텍스트 상한 — externalGuideline.fetchSourceText 와 같은 값으로 맞춘다. */
export const MAX_TEXT_LEN = 60000;

/**
 * @param doc  분석 대상 문서(PubMed 메타 또는 웹 출처 합성 객체)
 * @param raw  사용자가 넘긴 본문 텍스트(없으면 빈 문자열)
 * @returns {{ doc: object, applied: boolean, reason: string, length: number }}
 *          `applied=false` 면 doc 는 **입력 그대로**(참조 동일) 반환된다.
 */
export function applyUserText(doc, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { doc, applied: false, reason: 'empty', length: 0 };
  if (text.length < MIN_TEXT_LEN) {
    return { doc, applied: false, reason: 'too_short', length: text.length };
  }
  const capped = text.slice(0, MAX_TEXT_LEN);
  return {
    // fullTextSource 를 'user-supplied' 로 남기는 이유: 프롬프트가 본문 출처를 그대로
    // LLM 에 노출하므로(`--- FULL TEXT (source: …) ---`), 카드가 "어디서 온 본문인지"를
    // 알고 출처 성격(sourceNote_ko)에 반영할 수 있다.
    // fullTextLength 도 함께 갱신한다 — FilterAnalyzerAgent 의 PICO 캐시키가 이 값을 쓴다.
    doc: { ...doc, fullText: capped, fullTextSource: 'user-supplied', fullTextLength: capped.length },
    applied: true,
    reason: 'ok',
    length: capped.length,
  };
}
