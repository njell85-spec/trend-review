/**
 * fulltextDoc — 월별 전문(全文) Doc(plain text)용 순수부 (REPORT_SPEC §4-E b′).
 * 전문 텍스트는 Drive 비공개 Doc으로만 보낸다 — 공개 repo에 커밋 금지
 * (HANDOFF §3: 수집 확대는 비공개 아카이브층 한정, 사적 이용 복제 범위).
 */
export const fulltextDocName = (month) => `Trend Review 전문 — ${month}`;
export const docUrlOf = (docId) => `https://docs.google.com/document/d/${docId}/edit`;

export function htmlToText(html, cap = 40000) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // 본문 외 보일러플레이트 제거 — 상한(cap)을 실제 본문이 쓰도록 (FullTextAgent._stripHtml과 동일 원칙)
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // &amp;는 마지막에 — 먼저 풀면 &amp;lt; 같은 이중 인코딩이 마크업으로 되살아남
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
    .slice(0, cap);
}

/** 항목 1건의 전문 섹션(plain text). 넣을 본문이 없으면 null. */
export function fulltextSectionText(e, webTexts = []) {
  const head = `\n\n========================================\n[${e.date}] PMID ${e.pmid} — ${e.title}\n${e.journal ?? ''}\n========================================\n`;
  if (e.fullText) return `${head}(본문 출처: ${e.fullTextSource ?? '확보 본문'})\n\n${e.fullText}`;
  const parts = (webTexts ?? []).filter((w) => w?.text);
  if (!parts.length) return null;
  const body = parts.map((w) => `--- 권위 웹 레퍼런스: ${w.source} (${w.url}) ---\n${w.text}`).join('\n\n');
  return `${head}(페이월 — 권위 웹 레퍼런스 본문 수집)\n\n${body}`;
}
