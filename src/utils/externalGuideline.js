/**
 * externalGuideline — PubMed 미등재 가이드라인(발행기관 홈페이지 공개본) 취급 유틸.
 *
 * 학회 가이드라인은 홈페이지에 living document로 먼저 나오고 저널 등재는 몇 달 뒤인 경우가
 * 흔하다(예: IDSA AMR 그람음성 가이던스). PMID/DOI가 없어 기존 on-demand 입력(PMID·DOI)으로는
 * 태울 수 없으므로, URL을 받아 GuidelineAnalyzerAgent 가 그대로 먹을 수 있는 합성 객체를 만든다.
 *
 * 임상 내용 생성은 전적으로 파이프라인 LLM 몫 — 여기서는 텍스트 확보와 형식 변환만 한다.
 */
import { htmlToText } from './fulltextDoc.js';

export const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(String(s ?? '').trim());

/**
 * 안정적인 출처 식별자 — 상태파일 키·캐시키·중복 제거에 쓴다.
 * PMID 자리를 대신하지만 숫자 PMID 와 절대 충돌하지 않게 `web:` 접두사를 붙인다.
 */
export function sourceIdOf(url) {
  const u = String(url ?? '').trim();
  try {
    const { hostname, pathname } = new URL(u);
    const slug = `${hostname}${pathname}`.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    return `web:${slug.slice(0, 80).toLowerCase()}`;
  } catch {
    return `web:${u.replace(/[^a-z0-9]+/gi, '-').slice(0, 80).toLowerCase()}`;
  }
}

/** HTML `<title>` 추출 (실패 시 null) — 제목 입력이 없을 때의 폴백. */
export function titleFromHtml(html) {
  const m = String(html ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, ' ').trim();
  return t.length > 2 ? t : null;
}

/**
 * 출처 URL에서 본문 텍스트를 확보한다. 소프트 — 실패·PDF·비HTML이면 `{ text: '', title: null }`.
 * (PDF 파서는 의존성에 없다. 본문이 없어도 분석은 LLM 웹검색 보강으로 계속된다.)
 */
export async function fetchSourceText(url, { fetchImpl = fetch, cap = 60000, timeoutMs = 25000 } = {}) {
  const empty = { text: '', title: null, contentType: '' };
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'trend-review (personal research digest)' },
    });
    const ctype = res.headers?.get?.('content-type') ?? '';
    if (!res.ok || !ctype.includes('html')) return { ...empty, contentType: ctype };
    const html = await res.text();
    return { text: htmlToText(html, cap), title: titleFromHtml(html), contentType: ctype };
  } catch {
    return empty; // 차단(403)·타임아웃 — 조용히 텍스트 없이 진행
  }
}

/**
 * GuidelineAnalyzerAgent.analyze() 입력 형태의 합성 가이드라인 객체.
 * pmid 는 빈 문자열(PubMed 미등재) — 식별은 sourceId/sourceUrl 이 담당한다.
 */
export function buildWebGuideline({ url, title = '', org = '', pubDate = '', text = '' } = {}) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const hasText = text && text.length > 200;
  return {
    pmid: '',
    sourceId: sourceIdOf(url),
    sourceUrl: url,
    title: title || host || url,
    authors: [],
    journal: org || host,
    pubDate,
    meshTerms: [],
    // 본문을 못 받은 경우에도 프롬프트가 "undefined" 를 찍지 않도록 명시 문구를 넣는다.
    abstract: hasText ? text.slice(0, 4000) : '(발행기관 공개 문서 — 초록 없음. 아래 Source URL 을 참조해 확인할 것.)',
    fullText: hasText ? text : '',
    fullTextSource: hasText ? 'web(publisher site)' : 'none',
  };
}
