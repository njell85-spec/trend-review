/**
 * DataCollectorAgent
 * MCP bindings: fetch (PubMed API), time (date window), filesystem (cache write)
 *
 * Collects EM/CCM/Sepsis papers from PubMed E-utilities for the past N days,
 * returning structured paper objects ready for downstream analysis.
 */
import { parseStringPromise } from 'xml2js';
import { readFileSync } from 'fs';
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';
import { kstDateSlash } from '../utils/dates.js';

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

// PubMed URL에는 api_key 가 query param 으로 들어간다. 로그·에러에 URL을 남기기 전에
// 반드시 이 함수로 키를 가린다 (public/공유 Actions 로그 노출 방지).
const scrubUrl = (u) => String(u).replace(/([?&]api_key=)[^&]*/gi, '$1REDACTED');

const DEFAULT_QUERY =
  '"emergency service, hospital"[MeSH] OR "critical illness"[MeSH] OR "intensive care units"[MeSH] OR "resuscitation"[MeSH] OR "critical care"[MeSH] OR "emergency medicine"[MeSH]';

const DEFAULT_COLLECTION = {
  maxPapers: 300,
  streamA: { days: 30, retmax: 220 },
  streamB: { days: 180, slices: 6, retmaxPerSlice: 16, journalChunkSize: 10,
    designTypes: ['randomized controlled trial', 'meta-analysis', 'systematic review'] },
};

export function composeDualStreams(streamA, streamB, { maxPapers = 300, minB = 80 } = {}) {
  const byId = (items) => new Map(items.filter((p) => p?.pmid).map((p) => [String(p.pmid), p]));
  const a = byId(streamA);
  const b = byId(streamB);
  const out = [];
  const add = (p, source) => {
    if (!p || out.some((x) => String(x.pmid) === String(p.pmid))) return;
    const id = String(p.pmid);
    const sources = [a.has(id) && 'A', b.has(id) && 'B'].filter(Boolean);
    out.push({ ...p, streamSource: source, streamSources: sources });
  };
  for (const p of b.values()) { if (out.length >= Math.min(minB, b.size, maxPapers)) break; add(p, 'B'); }
  for (const p of a.values()) { if (out.length >= maxPapers) break; add(p, 'A'); }
  for (const p of b.values()) { if (out.length >= maxPapers) break; add(p, 'B'); }
  return out;
}

function mergeCorpusSources(groups) {
  const merged = new Map();
  for (const [source, papers] of Object.entries(groups)) {
    for (const paper of papers) {
      const id = String(paper.pmid);
      const prior = merged.get(id);
      merged.set(id, { ...(prior ?? {}), ...paper,
        collectionSources: [...new Set([...(prior?.collectionSources ?? []), source])] });
    }
  }
  return [...merged.values()];
}

export class DataCollectorAgent {
  constructor(options = {}) {
    this.logger = new Logger('DataCollectorAgent', { logFile: 'data_collector.jsonl' });
    this.cache = new Cache({ ttlHours: Number(process.env.CACHE_TTL_HOURS ?? 24) });
    // PubMed(NCBI eutils)는 아침 피크에 429/5xx 가 잦아 내성을 넉넉히 둔다.
    this.cb = new CircuitBreaker('PubMed-API', { failureThreshold: 8, recoveryTimeoutMs: 30_000 });
    this.retry = new RetryHelper({ maxAttempts: 5, baseDelayMs: 3_000, maxDelayMs: 45_000 });

    this.apiKey = process.env.PUBMED_API_KEY ?? '';
    this.email = process.env.PUBMED_EMAIL ?? 'research@example.com';
    this.maxPapers = options.maxPapers ?? Number(process.env.MAX_PAPERS ?? 300);
    this.searchDays = options.searchDays ?? Number(process.env.SEARCH_DAYS ?? 180);
    this.query = options.query ?? DEFAULT_QUERY;
    this.collectionMode = options.collectionMode ?? 'single';
    this.now = options.now ? new Date(options.now) : new Date();
    this.collection = options.collection ?? this._loadCollection();
    this.journals = options.journals ?? this._loadJournals();
  }

  _loadCollection() {
    try { return JSON.parse(readFileSync(new URL('../../config/collection.json', import.meta.url), 'utf8')); }
    catch { return DEFAULT_COLLECTION; }
  }

  _loadJournals() {
    try { return JSON.parse(readFileSync(new URL('../../config/journals.json', import.meta.url), 'utf8')); }
    catch { return { tiers: {} }; }
  }

  // ── MCP: time — compute search date window (KST 기준) ─────────────────────
  _getDateRange(days = this.searchDays) {
    const now = this.now;
    const past = new Date(now.getTime() - days * 86_400_000);
    return { minDate: kstDateSlash(past), maxDate: kstDateSlash(now) };
  }

  _buildParams(extra = {}) {
    const p = new URLSearchParams({
      tool: 'TrendReviewAgent',
      email: this.email,
      ...(this.apiKey && { api_key: this.apiKey }),
      ...extra,
    });
    return p.toString();
  }

  // ── MCP: fetch — HTTP calls to PubMed ────────────────────────────────────
  async _fetchJson(url) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`PubMed HTTP ${res.status}: ${scrubUrl(url)}`);
          return res.json();
        },
        {
          label: 'PubMed-fetch',
          onRetry: ({ attempt, delay }) =>
            this.logger.warn(`Retry ${attempt} in ${Math.round(delay)}ms`, { url: scrubUrl(url) }),
        }
      )
    );
  }

  async _fetchXml(url) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`PubMed HTTP ${res.status}`);
          const text = await res.text();
          return parseStringPromise(text, { explicitArray: false, ignoreAttrs: false });
        },
        { label: 'PubMed-xml' }
      )
    );
  }

  // ── Search: get PMIDs ─────────────────────────────────────────────────────
  // Always fetches fresh results — esearch is a single fast call and the search
  // window (기본 180일) shifts daily, so caching PMIDs would risk serving stale candidate sets.
  async searchPmids() {
    const { minDate, maxDate } = this._getDateRange();
    return this._search({ term: this.query, retmax: this.maxPapers, minDate, maxDate, stream: 'A', datetype: 'pdat' });
  }

  async _search({ term, retmax, minDate, maxDate, stream, datetype = 'edat' }) {
    this.logger.info('Searching PubMed (fresh)', { query: this.query, minDate, maxDate });

    const params = this._buildParams({
      db: 'pubmed',
      term,
      retmax,
      mindate: minDate,
      maxdate: maxDate,
      datetype,
      retmode: 'json',
      sort: 'date',
    });

    const data = await this._fetchJson(`${PUBMED_BASE}/esearch.fcgi?${params}`);
    const result = data?.esearchresult;
    if (!result) throw new Error('Unexpected PubMed esearch response');

    const ids = result.idlist ?? [];
    this.logger.info(`Found ${result.count} total, retrieved ${ids.length} PMIDs`, {
      count: result.count,
    });
    return ids.map(String);
  }

  _isoDate(date) { return date.toISOString().slice(0, 10).replaceAll('-', '/'); }

  _streamBJournals() {
    return Object.values(this.journals.tiers ?? {}).flatMap((t) => t.pubmedTa ?? []);
  }

  async collectDualStreams() {
    const aCfg = this.collection.streamA ?? DEFAULT_COLLECTION.streamA;
    const bCfg = this.collection.streamB ?? DEFAULT_COLLECTION.streamB;
    const aRange = this._getDateRange(aCfg.days);
    const aIds = await this._search({ term: this.query, retmax: aCfg.retmax, ...aRange, stream: 'A' });
    const aPapers = (await this.fetchArticles(aIds)).map((p) => ({ ...p, streamSource: 'A', streamSources: ['A'] }));

    const journals = this._streamBJournals();
    const chunks = [];
    for (let i = 0; i < journals.length; i += bCfg.journalChunkSize) chunks.push(journals.slice(i, i + bCfg.journalChunkSize));
    const bIds = [];
    for (let slice = 0; slice < bCfg.slices; slice++) {
      const end = new Date(this.now.getTime() - slice * 30 * 86_400_000);
      const start = new Date(this.now.getTime() - Math.min(bCfg.days, (slice + 1) * 30) * 86_400_000);
      const design = bCfg.designTypes.map((t) => `"${t}"[Publication Type]`).join(' OR ');
      for (const chunk of chunks) {
        const journalTerm = chunk.map((j) => `"${j}"[Journal]`).join(' OR ');
        const ids = await this._search({
          term: `((${journalTerm})) AND ((${design}))`, retmax: bCfg.retmaxPerSlice,
          minDate: this._isoDate(start), maxDate: this._isoDate(end), stream: 'B',
        });
        bIds.push(...ids);
      }
    }
    const uniqueB = [...new Set(bIds)];
    const bPapers = (await this.fetchArticles(uniqueB)).map((p) => ({ ...p, streamSource: 'B', streamSources: ['B'] }));
    return { papers: composeDualStreams(aPapers, bPapers, { maxPapers: this.collection.maxPapers ?? 300, minB: 80 }), streamA: aPapers, streamB: bPapers };
  }

  async collectReplayCorpus() {
    const legacyRange = this._getDateRange(this.searchDays);
    const legacyIds = await this._search({ term: this.query, retmax: this.maxPapers, ...legacyRange, datetype: 'pdat', stream: 'legacy' });
    const legacy = await this.fetchArticles(legacyIds);
    const dual = await this.collectDualStreams();
    const papers = mergeCorpusSources({ legacy, A: dual.streamA, B: dual.streamB });
    const dates = papers.map((p) => p.pubDate).filter(Boolean).sort();
    return { papers, stats: { pmidsFound: papers.length, articlesCollected: papers.length,
      legacyCount: legacy.length, streamACount: dual.streamA.length, streamBCount: dual.streamB.length,
      oldestPubDate: dates[0] ?? null, newestPubDate: dates.at(-1) ?? null } };
  }

  // ── Fetch article details in batches ─────────────────────────────────────
  async fetchArticles(pmids) {
    const BATCH = 10;
    const articles = [];

    for (let i = 0; i < pmids.length; i += BATCH) {
      const batch = pmids.slice(i, i + BATCH);
      const cacheKey = `articles_${batch.join('_')}`;

      const { data: batchData, fromCache } = await this.cache.getOrFetch(
        cacheKey,
        async () => {
          this.logger.debug(`Fetching batch ${Math.floor(i / BATCH) + 1}`, {
            ids: batch,
          });

          const params = this._buildParams({
            db: 'pubmed',
            id: batch.join(','),
            rettype: 'abstract',
            retmode: 'xml',
          });

          const xml = await this._fetchXml(`${PUBMED_BASE}/efetch.fcgi?${params}`);
          return this._parseArticles(xml);
        }
      );

      if (fromCache) this.logger.debug(`Batch ${Math.floor(i / BATCH) + 1} from cache`);
      articles.push(...batchData);

      // Rate limit: PubMed allows 10 req/sec with API key, 3/sec without
      if (!this.apiKey && i + BATCH < pmids.length) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    return articles;
  }

  // ── XML → structured paper object ────────────────────────────────────────
  _parseArticles(xml) {
    const articles = [];
    const set = xml?.PubmedArticleSet?.PubmedArticle;
    if (!set) return articles;

    const items = Array.isArray(set) ? set : [set];

    for (const item of items) {
      try {
        const medline = item?.MedlineCitation;
        const article = medline?.Article;
        if (!article) continue;

        const pmid = medline?.PMID?._ ?? medline?.PMID ?? '';
        const title = article?.ArticleTitle?._ ?? article?.ArticleTitle ?? '';

        // Abstract
        let abstract = '';
        const ab = article?.Abstract?.AbstractText;
        if (Array.isArray(ab)) {
          abstract = ab
            .map((a) => {
              const label = a?.$?.Label ? `${a.$.Label}: ` : '';
              return `${label}${a?._ ?? a ?? ''}`;
            })
            .join('\n');
        } else {
          abstract = ab?._ ?? ab ?? '';
        }

        // Authors
        const authorList = article?.AuthorList?.Author;
        const authors = this._parseAuthors(authorList);

        // Journal
        const journal = article?.Journal;
        const journalName =
          journal?.Title ?? journal?.ISOAbbreviation ?? '';
        const { pubDate, pubDateSource } = this._preferredPubDate(item, article, journal);

        // Publication types (authoritative study-design labels — no LLM guessing)
        const ptList = article?.PublicationTypeList?.PublicationType;
        const publicationTypes = ptList
          ? (Array.isArray(ptList) ? ptList : [ptList])
              .map((t) => t?._ ?? t ?? '')
              .filter(Boolean)
          : [];

        // MeSH
        const meshList = medline?.MeshHeadingList?.MeshHeading;
        const meshTerms = this._parseMesh(meshList);

        // Keywords
        const kwList = medline?.KeywordList?.Keyword;
        const keywords = kwList
          ? (Array.isArray(kwList) ? kwList : [kwList]).map(
              (k) => k?._ ?? k ?? ''
            )
          : [];

        // DOI + PMCID (for full-text retrieval)
        const articleIds = item?.PubmedData?.ArticleIdList?.ArticleId;
        const idList = Array.isArray(articleIds) ? articleIds : articleIds ? [articleIds] : [];
        const doi = idList.find((id) => id?.$?.IdType === 'doi')?._
          ?? idList.find((id) => id?.$?.IdType === 'doi')
          ?? '';
        const pmcid = idList.find((id) => id?.$?.IdType === 'pmc')?._
          ?? idList.find((id) => id?.$?.IdType === 'pmc')
          ?? '';

        articles.push({
          pmid: String(pmid),
          title: String(title),
          abstract: String(abstract),
          authors,
          journal: String(journalName),
          pubDate,
          edat: pubDate,
          pubDateSource,
          publicationTypes,
          meshTerms,
          keywords,
          doi: String(doi),
          pmcid: String(pmcid),
          pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          collectedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn('Failed to parse article', { err: err.message });
      }
    }

    return articles;
  }

  _parseAuthors(authorList) {
    if (!authorList) return [];
    const items = Array.isArray(authorList) ? authorList : [authorList];
    return items
      .slice(0, 6)
      .map((a) => {
        const last = a?.LastName ?? '';
        const initials = a?.Initials ?? '';
        return `${last} ${initials}`.trim();
      })
      .filter(Boolean);
  }

  _parsePubDate(pubDate) {
    if (!pubDate) return '';
    const year = pubDate?.Year ?? '';
    const month = pubDate?.Month ?? pubDate?.MedlineDate?.split(' ')[1] ?? '';
    const day = pubDate?.Day ?? '';
    return [year, month, day].filter(Boolean).join('-');
  }

  _preferredPubDate(item, article, journal) {
    const history = item?.PubmedData?.History?.PubMedPubDate;
    const entries = Array.isArray(history) ? history : history ? [history] : [];
    const pubmed = entries.find((d) => String(d?.$?.PubStatus ?? '').toLowerCase() === 'pubmed');
    const articleDates = article?.ArticleDate;
    const articleDate = Array.isArray(articleDates) ? articleDates[0] : articleDates;
    const candidates = [
      ['PubmedData.History/PubMedPubDate[pubmed]', pubmed],
      ['Article.ArticleDate', articleDate],
      ['JournalIssue.PubDate', journal?.JournalIssue?.PubDate],
    ];
    for (const [source, value] of candidates) {
      const parsed = this._parsePubDate(value);
      if (parsed) return { pubDate: parsed, pubDateSource: source };
    }
    return { pubDate: '', pubDateSource: 'missing' };
  }

  _parseMesh(meshList) {
    if (!meshList) return [];
    const items = Array.isArray(meshList) ? meshList : [meshList];
    return items
      .map((m) => m?.DescriptorName?._ ?? m?.DescriptorName ?? '')
      .filter(Boolean)
      .slice(0, 10);
  }

  // ── 가이드라인 수집 (별도 쿼리: PublicationType=Guideline + EM/CCM 도메인) ──────
  // 가이드라인은 드물어 검색창을 넓게(기본 365일) 잡고, 상위에서 미노출분만 선별한다.
  async collectGuidelines({ days = 365, max = 40 } = {}) {
    const { minDate, maxDate } = this._getDateRange(days);

    const term =
      '(("practice guideline"[Publication Type]) OR ("guideline"[Publication Type])) AND ' +
      '("emergency medicine"[MeSH] OR "critical care"[MeSH] OR "sepsis"[MeSH] OR ' +
      '"respiratory distress syndrome"[MeSH] OR "resuscitation"[MeSH] OR "heart arrest"[MeSH] OR ' +
      '"shock"[MeSH] OR "respiration, artificial"[MeSH])';

    const params = this._buildParams({
      db: 'pubmed', term, retmax: max,
      mindate: minDate, maxdate: maxDate, datetype: 'pdat',
      retmode: 'json', sort: 'date',
    });

    const data = await this._fetchJson(`${PUBMED_BASE}/esearch.fcgi?${params}`);
    const ids = data?.esearchresult?.idlist ?? [];
    this.logger.info(`Guideline search: ${ids.length} PMIDs`, { term: 'guideline+EM/CCM' });
    if (!ids.length) return [];

    const articles = await this.fetchArticles(ids);
    // PublicationType 에 실제로 guideline 이 있는 것만 유지(안전장치)
    return articles.filter((a) =>
      (a.publicationTypes ?? []).some((t) => /guideline/i.test(t)));
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run() {
    this.logger.section('DataCollectorAgent — PubMed Collection');
    const start = Date.now();

    try {
      if (this.collectionMode === 'dual') {
        const dual = await this.collectDualStreams();
        const dates = dual.papers.map((p) => p.pubDate).filter(Boolean).sort();
        return { papers: dual.papers, stats: {
          pmidsFound: dual.papers.length, articlesCollected: dual.papers.length,
          streamACount: dual.streamA.length, streamBCount: dual.streamB.length,
          oldestPubDate: dates[0] ?? null, newestPubDate: dates.at(-1) ?? null,
        } };
      }
      const pmids = await this.searchPmids();
      if (!pmids.length) {
        this.logger.warn('No PMIDs found for query');
        return { papers: [], stats: { pmidsFound: 0, articlesCollected: 0 } };
      }

      const papers = await this.fetchArticles(pmids);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const stats = {
        pmidsFound: pmids.length,
        articlesCollected: papers.length,
        withAbstracts: papers.filter((p) => p.abstract.length > 50).length,
        elapsedSeconds: Number(elapsed),
        circuitBreaker: this.cb.getStatus(),
        oldestPubDate: papers.map((p) => p.pubDate).filter(Boolean).sort()[0] ?? null,
        newestPubDate: papers.map((p) => p.pubDate).filter(Boolean).sort().at(-1) ?? null,
      };

      this.logger.info('Collection complete', stats);
      return { papers, stats };
    } catch (err) {
      this.logger.error('Collection failed', { err: err.message, stack: err.stack });
      throw err;
    }
  }
}

// ── Standalone test ───────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('DataCollectorAgent.js')) {
  const agent = new DataCollectorAgent({ maxPapers: 5, searchDays: 30 });
  const result = await agent.run();
  console.log(`\nCollected ${result.papers.length} papers`);
  if (result.papers[0]) {
    console.log('\nFirst paper:', result.papers[0].title);
  }
}
