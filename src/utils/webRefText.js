/**
 * webRefText — 페이월 논문의 권위 웹 레퍼런스(dossier) 본문 수집 (REPORT_SPEC §4-E c).
 * 결과는 Drive 비공개 전문 Doc으로만 보낸다 — 공개 repo 커밋 금지. URL별 소프트 실패.
 */
import { htmlToText } from './fulltextDoc.js';

export async function fetchRefTexts(dossier, { fetchImpl = fetch, capPerRef = 40000, timeoutMs = 20000 } = {}) {
  const out = [];
  for (const d of dossier ?? []) {
    try {
      const res = await fetchImpl(d.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'trend-review-archive (personal research archive)' },
      });
      const ctype = res.headers.get('content-type') ?? '';
      if (!res.ok || !ctype.includes('html')) continue;
      const text = htmlToText(await res.text(), capPerRef);
      if (text.length > 200) out.push({ source: d.source, url: d.url, text });
    } catch { /* URL별 소프트 실패 — 다음 레퍼런스로 */ }
  }
  return out;
}
