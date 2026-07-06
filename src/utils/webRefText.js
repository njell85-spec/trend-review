/**
 * webRefText — 페이월 논문의 권위 웹 레퍼런스(dossier) 본문 수집 (REPORT_SPEC §4-E c).
 * 결과는 Drive 비공개 전문 Doc으로만 보낸다 — 공개 repo 커밋 금지. URL별 소프트 실패.
 */
import { htmlToText } from './fulltextDoc.js';

export async function fetchRefTexts(dossier, { fetchImpl = fetch, capPerRef = 40000, timeoutMs = 20000 } = {}) {
  // 병렬 수집 — 순차면 죽은 호스트마다 타임아웃이 누적된다(백로그 재처리 시 수 분).
  // URL별 소프트 실패(allSettled), 입력 순서 유지.
  const settled = await Promise.allSettled(
    (dossier ?? []).map(async (d) => {
      const res = await fetchImpl(d.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'trend-review-archive (personal research archive)' },
      });
      const ctype = res.headers.get('content-type') ?? '';
      if (!res.ok || !ctype.includes('html')) return null;
      const text = htmlToText(await res.text(), capPerRef);
      return text.length > 200 ? { source: d.source, url: d.url, text } : null;
    }),
  );
  return settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => s.value);
}
