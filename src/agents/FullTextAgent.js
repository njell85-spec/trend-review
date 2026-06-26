/**
 * FullTextAgent
 *
 * Enriches papers with full-text content via two routes (in priority order):
 *   1. PMC E-utilities (PubMed Central open-access full XML)
 *   2. Unpaywall API  (DOI → legal open-access landing page or PDF URL → HTML text)
 *
 * Returns papers with added fields:
 *   fullText         — truncated text sent to Claude
 *   fullTextSource   — 'PMC' | 'Unpaywall' | 'abstract-only'
 *   fullTextLength   — original character count before truncation
 *   figures          — array of { label, caption } extracted from PMC XML
 *   oaUrl            — open-access URL (Unpaywall route)
 */
import { parseStringPromise } from 'xml2js';
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { RetryHelper } from '../utils/RetryHelper.js';

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const MAX_FULLTEXT_CHARS = 10000; // cap per paper sent to Claude
const FETCH_TIMEOUT_MS = 20000;

export class FullTextAgent {
  constructor(options = {}) {
    this.logger = new Logger('FullTextAgent', { logFile: 'fulltext_agent.jsonl' });
    this.cache = new Cache({ ttlHours: 72 });
    this.retry = new RetryHelper({ maxAttempts: 2, baseDelayMs: 1500 });

    this.apiKey = process.env.PUBMED_API_KEY ?? '';
    this.email = process.env.PUBMED_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? 'research@example.com';
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run(papers) {
    this.logger.section('FullTextAgent — Full-text Retrieval');
    this.logger.info(`Attempting full-text for ${papers.length} papers`);

    const enriched = await Promise.all(papers.map((p) => this._enrich(p)));

    const stats = {
      pmc:          enriched.filter((p) => p.fullTextSource === 'PMC').length,
      unpaywall:    enriched.filter((p) => p.fullTextSource === 'Unpaywall').length,
      abstractOnly: enriched.filter((p) => p.fullTextSource === 'abstract-only').length,
    };
    this.logger.info('Full-text retrieval complete', stats);
    return { papers: enriched, stats };
  }

  // ── Per-paper enrichment ──────────────────────────────────────────────────
  async _enrich(paper) {
    const cacheKey = `ft_v1_${paper.pmid}`;
    const { data, fromCache } = await this.cache.getOrFetch(cacheKey, () => this._fetch(paper));
    if (fromCache) this.logger.debug(`Full text from cache: PMID ${paper.pmid}`);
    return { ...paper, ...data };
  }

  async _fetch(paper) {
    // ── Route 1: PMC ────────────────────────────────────────────────────────
    if (paper.pmcid && String(paper.pmcid).length > 0 && paper.pmcid !== 'undefined') {
      try {
        const { text, figures } = await this._fetchPmc(paper.pmcid);
        if (text.length > 300) {
          this.logger.info(`PMC full text: PMID ${paper.pmid} — ${text.length} chars, ${figures.length} figures`);
          return {
            fullText: text.slice(0, MAX_FULLTEXT_CHARS),
            fullTextSource: 'PMC',
            fullTextLength: text.length,
            figures,
          };
        }
      } catch (e) {
        this.logger.warn(`PMC failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    // ── Route 2: Unpaywall ──────────────────────────────────────────────────
    if (paper.doi && paper.doi.length > 3 && paper.doi !== 'undefined') {
      try {
        const oaUrl = await this._unpaywall(paper.doi);
        if (oaUrl) {
          const text = await this._fetchHtmlText(oaUrl);
          if (text && text.length > 300) {
            this.logger.info(`Unpaywall full text: PMID ${paper.pmid} — ${text.length} chars`);
            return {
              fullText: text.slice(0, MAX_FULLTEXT_CHARS),
              fullTextSource: 'Unpaywall',
              fullTextLength: text.length,
              figures: [],
              oaUrl,
            };
          }
        }
      } catch (e) {
        this.logger.warn(`Unpaywall failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    this.logger.info(`Abstract-only: PMID ${paper.pmid} (pmcid=${paper.pmcid || 'none'}, doi=${paper.doi || 'none'})`);
    return { fullText: null, fullTextSource: 'abstract-only', fullTextLength: 0, figures: [] };
  }

  // ── PMC full text ─────────────────────────────────────────────────────────
  async _fetchPmc(pmcid) {
    const cleanId = String(pmcid).replace(/^PMC/i, '');
    const params = new URLSearchParams({
      db: 'pmc',
      id: cleanId,
      rettype: 'full',
      retmode: 'xml',
      tool: 'TrendReviewAgent',
      email: this.email,
      ...(this.apiKey && { api_key: this.apiKey }),
    });

    const url = `${PUBMED_BASE}/efetch.fcgi?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`PMC HTTP ${res.status}`);

    const xmlText = await res.text();
    const xml = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });
    return this._parsePmcXml(xml);
  }

  _parsePmcXml(xml) {
    const parts = [];
    const figures = [];

    const article =
      xml?.pmc?.article
      ?? xml?.['pmc-articleset']?.article
      ?? xml?.article
      ?? null;

    if (!article) return { text: '', figures };

    const body = article?.body ?? article?.['body'];
    if (!body) return { text: '', figures };

    const extractSec = (sec) => {
      if (!sec) return;
      const secs = Array.isArray(sec) ? sec : [sec];
      for (const s of secs) {
        const titleRaw = s?.title;
        const title = titleRaw?._ ?? titleRaw ?? '';
        if (title) parts.push(`\n### ${title}`);

        // Paragraphs
        const rawP = s?.p;
        const paras = Array.isArray(rawP) ? rawP : rawP ? [rawP] : [];
        for (const p of paras) {
          const t = (p?._ ?? p ?? '').toString().trim();
          if (t.length > 10) parts.push(t);
        }

        // Figures
        const rawFig = s?.fig;
        const figs = Array.isArray(rawFig) ? rawFig : rawFig ? [rawFig] : [];
        for (const fig of figs) {
          const label = (fig?.label?._ ?? fig?.label ?? '').toString();
          const capP = fig?.caption?.p;
          const caption = (
            Array.isArray(capP) ? capP.map((c) => c?._ ?? c).join(' ') : capP?._ ?? capP ?? ''
          ).toString().trim();
          if (label || caption) {
            figures.push({ label, caption });
            parts.push(`[Figure: ${label} — ${caption}]`);
          }
        }

        // Tables
        const rawTable = s?.['table-wrap'];
        const tables = Array.isArray(rawTable) ? rawTable : rawTable ? [rawTable] : [];
        for (const tw of tables) {
          const label = (tw?.label?._ ?? tw?.label ?? '').toString();
          const capP = tw?.caption?.p;
          const caption = (
            Array.isArray(capP) ? capP.map((c) => c?._ ?? c).join(' ') : capP?._ ?? capP ?? ''
          ).toString().trim();
          if (caption) parts.push(`[Table: ${label} — ${caption}]`);
        }

        // Nested sections
        if (s?.sec) extractSec(s.sec);
      }
    };

    extractSec(body?.sec);
    return { text: parts.join('\n').trim(), figures };
  }

  // ── Unpaywall ─────────────────────────────────────────────────────────────
  async _unpaywall(doi) {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    const best = data?.best_oa_location;
    if (!best) return null;

    // Prefer HTML landing page (easier to parse) over direct PDF
    return best.url_for_landing_page ?? best.url_for_pdf ?? best.url ?? null;
  }

  // ── HTML text extraction ──────────────────────────────────────────────────
  async _fetchHtmlText(url) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': `TrendReviewAgent/1.0 (research; mailto:${this.email})`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('pdf')) return null; // skip binary PDFs

    const html = await res.text();
    return this._stripHtml(html);
  }

  _stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
