function finding(code, severity, detail) { return { code, severity, detail }; }

function decodeHtml(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function cardIds(html) {
  const ids = new Set();
  for (const match of String(html ?? '').matchAll(/<article\b[^>]*class="[^"]*\bguideline-card\b[^"]*"[^>]*>/g)) {
    const id = match[0].match(/\bdata-guideline-id="([^"]+)"/)?.[1]
      ?? match[0].match(/\bid="([^"]+)"/)?.[1];
    if (id) ids.add(decodeHtml(id));
  }
  return ids;
}

/** G9 실행 증거 교차 검증. 이 함수는 보고만 하며 논문 파이프라인을 throw하지 않는다. */
export function verifyGuidelineRun({ state, html, manifest }) {
  const findings = [];
  if (!manifest) return { ok: false, findings: [finding('manifest-missing', 'error', 'guideline run manifest is missing')] };

  const pubmed = manifest.pubmed;
  const org = manifest.orgSources;
  const orgRows = Array.isArray(org) ? org.flatMap((x) => x?.sources ?? []) : (org?.sources ?? []);
  const attempts = Number(pubmed?.queriesAttempted ?? pubmed?.queries?.length ?? 0)
    + Number(org?.attempted ?? orgRows.length);
  if (attempts === 0) findings.push(finding('source-attempts-zero', 'error', 'guideline stage ran but recorded zero source attempts'));

  if (!pubmed || !Object.hasOwn(pubmed, 'ptPmids') || !Array.isArray(pubmed.ptPmids)) {
    findings.push(finding('pubmed-pt-evidence-missing', 'error', 'manifest.pubmed.ptPmids is absent after serialization'));
  }

  const failed = Number(org?.failed ?? 0)
    + orgRows.filter((x) => x?.status === 'red' || x?.ok === false || x?.error).length
    + (pubmed?.queries ?? []).filter((x) => x?.succeeded === false).length;
  if (failed > 0 || manifest.collectionError) findings.push(finding('source-partial-failure', 'warn', `${failed || 1} source collection attempt(s) failed`));

  const publishedIds = new Set((state?.published ?? []).map((x) => x?.id).filter(Boolean));
  const ids = cardIds(html);
  for (const id of publishedIds) if (!ids.has(id)) findings.push(finding('published-card-missing', 'error', `published state id has no HTML card: ${id}`));
  for (const id of ids) if (!publishedIds.has(id)) findings.push(finding('html-card-without-state', 'error', `HTML card has no published state transition: ${id}`));

  return { ok: !findings.some((x) => x.severity === 'error'), findings };
}
