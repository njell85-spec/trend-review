/**
 * sourceTrust — 웹 보강 출처가 **인용해도 되는 곳**인지 가른다.
 *
 * ★ 왜 생겼나 (실측 2026-08-18)
 *   웹검색을 고쳐 돌리자마자 리뷰 카드가 1,119자 → 5,173자로 좋아졌는데,
 *   그 근거로 붙은 출처가 이것이었다:
 *     https://waltersport.com/wp-content/uploads/2026/03/LANCET-Sepsis-Singer-et-al.-2026.pdf
 *   Lancet 논문 PDF 가 무단 게재된 **미러 사이트**다. 내용이 맞더라도
 *   ⓐ 저작권상 인용할 곳이 아니고 ⓑ 언제 사라질지 모르는 링크이며
 *   ⓒ 그 파일이 진본인지 보증하는 것이 아무것도 없다.
 *   프롬프트는 "블로그·콘텐츠팜·AI 생성물 배제" 라고 했는데 PDF 미러는 그 어디에도
 *   안 걸렸다. **말로 막는 대신 코드로 막는다.**
 *
 * ★ 허용목록이다(차단목록이 아니다). 미러는 도메인이 무한히 생기므로 차단목록으로는
 *   영원히 못 따라간다. **모르는 곳은 안 쓴다** 가 이 판정의 기본값이다.
 *
 * ★ 대가를 알고 고른 것이다 — 정당한 출처를 못 찾은 날은 보강이 **비고 카드가 얇아진다.**
 *   얇은 것은 정직한 결과이고, 해적판을 근거로 단 두꺼운 카드는 그렇지 않다.
 *   (얇으면 에스컬레이션이 한 번 더 돌아 정당한 출처를 다시 찾는다.)
 */

/** 접미사 일치로 보는 신뢰 호스트. `endsWith` 라 하위도메인이 자동 포함된다. */
export const TRUSTED_HOST_SUFFIXES = Object.freeze([
  // ── 색인·공공 ──
  'ncbi.nlm.nih.gov', 'europepmc.org', 'doi.org', 'clinicaltrials.gov',
  'who.int', 'cochranelibrary.com',
  // ── 주요 출판사·저널 ──
  'thelancet.com', 'lancet.com', 'nejm.org', 'jamanetwork.com', 'bmj.com',
  'sciencedirect.com', 'elsevier.com', 'springer.com', 'springerlink.com',
  'link.springer.com', 'wiley.com', 'onlinelibrary.wiley.com',
  'academic.oup.com', 'oup.com', 'nature.com', 'cell.com',
  'ahajournals.org', 'atsjournals.org', 'journals.lww.com', 'lww.com',
  'tandfonline.com', 'sagepub.com', 'karger.com', 'thieme-connect.com',
  'annals.org', 'chestnet.org', 'jwatch.org',
  // ── 학회·기관 ──
  'sccm.org', 'esicm.org', 'idsociety.org', 'heart.org', 'acc.org',
  'escardio.org', 'ersnet.org', 'thoracic.org', 'acep.org', 'sepsis.org',
  'erc.edu', 'ilcor.org', 'nice.org.uk', 'sign.ac.uk', 'cdc.gov', 'nih.gov',
  'fda.gov', 'nhs.uk', 'kdca.go.kr',
  // ── 임상 레퍼런스 ──
  'uptodate.com', 'dynamed.com', 'bestpractice.bmj.com',
]);

/** 신뢰 호스트가 아니어도 통과시키는 상위도메인(대학·정부·학술). */
export const TRUSTED_TLD_SUFFIXES = Object.freeze(['.edu', '.ac.uk', '.gov', '.go.kr']);

/**
 * 이 URL 을 근거로 인용해도 되는가.
 * http(s) 가 아니거나 파싱이 안 되면 false — 스킴 주입(`javascript:`)도 여기서 막힌다.
 */
export function isTrustedSourceUrl(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (TRUSTED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  return TRUSTED_TLD_SUFFIXES.some((t) => host.endsWith(t));
}

/**
 * 신뢰 못 할 출처를 걷어낸다. 걷어낸 것을 함께 돌려준다 —
 * 조용히 사라지면 "왜 보강이 비었지" 를 다음 사람이 못 쫓는다.
 */
export function filterTrustedSources(items, urlOf = (x) => x?.sourceUrl ?? x?.url) {
  const kept = [];
  const dropped = [];
  for (const item of items ?? []) (isTrustedSourceUrl(urlOf(item)) ? kept : dropped).push(item);
  return { kept, dropped };
}
