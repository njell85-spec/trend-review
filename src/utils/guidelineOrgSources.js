function responseOf(raw, source) {
  if (typeof raw === 'string') return { body: raw, status: 200, finalUrl: source.url };
  return { body: String(raw?.body ?? raw?.text ?? ''), status: raw?.status ?? raw?.statusCode ?? 200, finalUrl: raw?.finalUrl ?? raw?.url ?? source.url };
}

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function tag(block, name) {
  return decode(block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');
}

function xmlItems(body, itemTag, linkTag = 'link') {
  return [...body.matchAll(new RegExp(`<${itemTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${itemTag}>`, 'gi'))].map((m) => {
    const block = m[1];
    const atomHref = block.match(/<link[^>]+href=["']([^"']+)/i)?.[1];
    return { title: tag(block, 'title') || tag(block, 'loc'), url: atomHref || tag(block, linkTag) || tag(block, 'loc'), date: tag(block, 'pubDate') || tag(block, 'updated') || tag(block, 'lastmod') || null };
  });
}

function className(selector = '') { return selector.match(/^\.([\w-]+)$/)?.[1] ?? selector.match(/^\[class=["']?([^\]"']+)/)?.[1]; }
function blocksFor(body, selector) {
  const cls = className(selector);
  if (cls) return [...body.matchAll(new RegExp(`<([a-z][\\w-]*)[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'))].map((m) => m[0]);
  const element = selector?.match(/^[a-z][\w-]*$/i)?.[0];
  return element ? [...body.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`, 'gi'))].map((m) => m[0]) : [];
}
function field(block, selector, kind) {
  const chunks = selector ? blocksFor(block, selector) : [block];
  const chunk = chunks[0] ?? '';
  if (kind === 'link') return chunk.match(/href=["']([^"']+)/i)?.[1] ?? null;
  if (kind === 'date') return chunk.match(/datetime=["']([^"']+)/i)?.[1] ?? (decode(chunk) || null);
  return decode(chunk);
}

function atPath(value, path) { return String(path ?? '').split('.').filter(Boolean).reduce((v, key) => v?.[key], value); }
function unique(items) {
  const seen = new Set();
  return items.filter((item) => item.url && !seen.has(item.url) && seen.add(item.url));
}

export async function fetchOrgSource(source, { fetchText }) {
  const fetchedAt = new Date().toISOString();
  if (source.type === 'manual-seed') return { observed: false, reason: 'manual-seed', items: [], body: '', status: null, finalUrl: source.url ?? null, fetchedAt };
  if (typeof fetchText !== 'function') throw new TypeError('fetchText must be a function');
  const response = responseOf(await fetchText(source.url), source);
  let items;
  if (source.type === 'rss') items = [...xmlItems(response.body, 'item'), ...xmlItems(response.body, 'entry')];
  else if (source.type === 'sitemap') items = xmlItems(response.body, 'url', 'loc');
  else if (source.type === 'listing-html') items = blocksFor(response.body, source.selectors?.item).map((block) => ({ title: field(block, source.selectors?.title, 'title'), url: field(block, source.selectors?.link, 'link'), date: field(block, source.selectors?.date, 'date') }));
  else if (source.type === 'api-json') {
    const json = JSON.parse(response.body);
    const rows = atPath(json, source.itemsPath ?? 'items') ?? (Array.isArray(json) ? json : []);
    const fields = source.fields ?? { title: 'title', link: 'url', date: 'date' };
    items = rows.map((row) => ({ title: atPath(row, fields.title), url: atPath(row, fields.link), date: atPath(row, fields.date) ?? null }));
  } else throw new Error(`Unknown organization source type: ${source.type}`);
  return { observed: true, items: unique(items), body: response.body, status: response.status, finalUrl: response.finalUrl, fetchedAt };
}

function ageDays(value, now) { return value ? (new Date(now) - new Date(value)) / 86400000 : null; }
export function evaluateSourceHealth(source, result) {
  const reasons = [];
  let status = 'green';
  const body = result?.body ?? '';
  const finalUrl = result?.finalUrl ?? source.url ?? null;
  const itemCount = result?.items?.length ?? 0;
  const red = (reason) => { status = 'red'; reasons.push(reason); };
  const amber = (reason) => { if (status === 'green') status = 'amber'; reasons.push(reason); };
  if (result?.observed === false) return { status: 'unobserved', reasons: [result.reason], itemCount, fetchedAt: result.fetchedAt, finalUrl };
  if (result?.status >= 400) red(`http-${result.status}`);
  if (result?.status === 200 && itemCount === 0) red('http-200-zero-items');
  if (source.health?.expectedContentMarker && !body.includes(source.health.expectedContentMarker)) red('expected-content-marker-missing');
  if (/\b(login|sign[- ]?in|access[- ]denied|forbidden|blocked)\b/i.test(`${finalUrl} ${body.slice(0, 2000)}`)) red('login-or-block-page');
  if (itemCount < (source.health?.minimumItems ?? 0) && status !== 'red') amber('minimum-items');
  const now = result?.fetchedAt ?? new Date().toISOString();
  const successAge = ageDays(result?.lastSuccessfulAt ?? source.health?.lastSuccessfulAt, now);
  const newAge = ageDays(result?.lastNewItemAt ?? source.health?.lastNewItemAt, now);
  const max = source.health?.maxSilenceDays;
  if (Number.isFinite(max) && successAge != null && successAge > max) amber('last-success-silence');
  if (Number.isFinite(max) && newAge != null && newAge > max) amber('last-new-item-silence');
  return { status, reasons, itemCount, fetchedAt: result?.fetchedAt, finalUrl };
}

export async function dryRunOrgSources(cfg, { fetchText }) {
  const organizations = [];
  for (const org of cfg.organizations ?? []) {
    if (!(org.sources?.length)) { organizations.push({ organizationId: org.id, status: 'unconfigured', sources: [] }); continue; }
    const sources = [];
    for (const source of org.sources) {
      try { const result = await fetchOrgSource(source, { fetchText }); sources.push({ sourceId: source.id, ...evaluateSourceHealth(source, result) }); }
      catch (error) { sources.push({ sourceId: source.id, status: 'red', reasons: [error?.message ?? String(error)], itemCount: 0, fetchedAt: new Date().toISOString(), finalUrl: source.url ?? null }); }
    }
    const status = sources.some((x) => x.status === 'red') ? 'red' : sources.some((x) => x.status === 'amber' || x.status === 'unobserved') ? 'amber' : 'green';
    organizations.push({ organizationId: org.id, status, sources });
  }
  return organizations;
}
