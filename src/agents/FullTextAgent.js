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

    // NCBI/EPMC 동시 폭주 방지 — 소규모 풀로 제한 (topN=1이면 사실상 순차)
    const enriched = await this._mapLimit(papers, 3, (p) => this._enrich(p));

    const stats = {
      pmc:          enriched.filter((p) => p.fullTextSource === 'PMC').length,
      europePmc:    enriched.filter((p) => p.fullTextSource === 'EuropePMC').length,
      unpaywall:    enriched.filter((p) => p.fullTextSource === 'Unpaywall').length,
      registry:     enriched.filter((p) => p.fullTextSource === 'abstract+registry').length,
      abstractOnly: enriched.filter((p) => p.fullTextSource === 'abstract-only').length,
    };
    this.logger.info('Full-text retrieval complete', stats);
    return { papers: enriched, stats };
  }

  async _mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        out[idx] = await fn(items[idx]);
      }
    });
    await Promise.all(workers);
    return out;
  }

  // ── Per-paper enrichment ──────────────────────────────────────────────────
  // 성공(본문 확보)만 캐시한다 — 일시 장애로 초록-only가 된 결과를 72시간
  // 재사용하면 그날의 선정 논문이 며칠간 초록 분석에 갇힌다.
  async _enrich(paper) {
    const cacheKey = `ft_v2_${paper.pmid}`;
    const cached = await this.cache.get(cacheKey);
    if (cached !== null) {
      this.logger.debug(`Full text from cache: PMID ${paper.pmid}`);
      return { ...paper, ...cached };
    }
    const data = await this._fetch(paper);
    if (data.fullText) await this.cache.set(cacheKey, data);
    return { ...paper, ...data };
  }

  // 일시 오류(429/5xx/네트워크)만 재시도하는 fetch 래퍼. 4xx는 그대로 반환해
  // 각 라우트가 "본문 없음"으로 판단하게 둔다.
  async _fetchRetry(url, opts = {}, label = 'fetch') {
    return this.retry.execute(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...opts });
      if (res.status === 429 || res.status >= 500) throw new Error(`${label} HTTP ${res.status}`);
      return res;
    }, { label });
  }

  async _fetch(paper) {
    // 권위 있는 구조화 소스(ClinicalTrials.gov)는 본문 확보 여부와 무관하게 먼저 시도해
    // 항상 레지스트리 링크/근거를 확보한다.
    const augment = await this._augment(paper).catch((e) => {
      this.logger.warn(`Registry augment failed (PMID ${paper.pmid}): ${e.message}`);
      return { augmentText: null, augmentSources: [], augmentRegistry: false };
    });

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
            ...augment,
          };
        }
      } catch (e) {
        this.logger.warn(`PMC failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    // ── Route 1b: Europe PMC (JATS 전문; 키 불필요·권위, NCBI가 못 줄 때 보완) ──
    try {
      const { text, figures } = await this._fetchEuropePmc(paper);
      if (text && text.length > 300) {
        this.logger.info(`EuropePMC full text: PMID ${paper.pmid} — ${text.length} chars`);
        return {
          fullText: text.slice(0, MAX_FULLTEXT_CHARS),
          fullTextSource: 'EuropePMC',
          fullTextLength: text.length,
          figures,
          ...augment,
        };
      }
    } catch (e) {
      this.logger.warn(`EuropePMC failed (PMID ${paper.pmid}): ${e.message}`);
    }

    // ── Route 2: Unpaywall (best_oa_location 실패 시 다른 OA location도 시도) ──
    if (paper.doi && paper.doi.length > 3 && paper.doi !== 'undefined') {
      try {
        const oaUrls = await this._unpaywallUrls(paper.doi);
        for (const oaUrl of oaUrls) {
          const text = await this._fetchHtmlText(oaUrl).catch(() => null);
          if (text && text.length > 300) {
            this.logger.info(`Unpaywall full text: PMID ${paper.pmid} — ${text.length} chars`);
            return {
              fullText: text.slice(0, MAX_FULLTEXT_CHARS),
              fullTextSource: 'Unpaywall',
              fullTextLength: text.length,
              figures: [],
              oaUrl,
              ...augment,
            };
          }
        }
      } catch (e) {
        this.logger.warn(`Unpaywall failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    // ── Route 3: 본문 없음 → 레지스트리 보강(초록 + ClinicalTrials.gov) ─────────
    const source = augment.augmentRegistry ? 'abstract+registry' : 'abstract-only';
    this.logger.info(`${source}: PMID ${paper.pmid} (pmcid=${paper.pmcid || 'none'}, doi=${paper.doi || 'none'}, nct=${augment.nctId || 'none'})`);
    return { fullText: null, fullTextSource: source, fullTextLength: 0, figures: [], ...augment };
  }

  // ── 권위 있는 구조화 소스: ClinicalTrials.gov (API 키 불필요) ────────────────
  async _augment(paper) {
    const nct = this._findNct(paper);
    if (!nct) return { augmentText: null, augmentSources: [], augmentRegistry: false };

    const url = `https://clinicaltrials.gov/api/v2/studies/${nct}?format=json`;
    let study;
    try {
      const res = await this._fetchRetry(url, {}, 'ctgov');
      if (!res.ok) throw new Error(`ClinicalTrials.gov HTTP ${res.status}`);
      study = await res.json();
    } catch (e) {
      this.logger.warn(`ClinicalTrials.gov fetch failed (${nct}): ${e.message}`);
      // 레지스트리 본문은 못 가져와도 링크는 출처로 제공
      return {
        augmentText: null, nctId: nct, augmentRegistry: false,
        augmentSources: [{ label: `ClinicalTrials.gov — ${nct}`, url: `https://clinicaltrials.gov/study/${nct}` }],
      };
    }

    const text = this._summarizeCtgov(study, nct);
    return {
      augmentText: text ? text.slice(0, 6000) : null,
      nctId: nct,
      augmentRegistry: Boolean(text),
      augmentSources: [{ label: `ClinicalTrials.gov — ${nct} (구조화 레지스트리)`, url: `https://clinicaltrials.gov/study/${nct}` }],
    };
  }

  _findNct(paper) {
    const hay = `${paper.abstract ?? ''}\n${paper.title ?? ''}`;
    const m = hay.match(/\bNCT0*\d{6,8}\b/i);
    return m ? m[0].toUpperCase() : null;
  }

  _summarizeCtgov(study, nct) {
    try {
      const ps = study?.protocolSection ?? {};
      const id = ps.identificationModule ?? {};
      const design = ps.designModule ?? {};
      const di = design.designInfo ?? {};
      const elig = ps.eligibilityModule ?? {};
      const arms = ps.armsInterventionsModule ?? {};
      const outcomes = ps.outcomesModule ?? {};
      const rs = study?.resultsSection ?? {};

      const lines = [`ClinicalTrials.gov ${nct} — authoritative trial registry record`];
      if (id.officialTitle) lines.push(`Official title: ${id.officialTitle}`);
      const enr = design.enrollmentInfo?.count;
      const phases = (design.phases ?? []).join(', ');
      const alloc = di.allocation, masking = di.maskingInfo?.masking, model = di.interventionModel;
      lines.push(`Design: ${[phases && `phase ${phases}`, alloc, model, masking && `masking ${masking}`].filter(Boolean).join('; ')}${enr ? `; enrollment ${enr}` : ''}`);

      const prim = (outcomes.primaryOutcomes ?? []).slice(0, 3)
        .map((o) => `• PRIMARY: ${o.measure}${o.timeFrame ? ` [${o.timeFrame}]` : ''}${o.description ? ` — ${o.description}` : ''}`);
      const sec = (outcomes.secondaryOutcomes ?? []).slice(0, 5)
        .map((o) => `• secondary: ${o.measure}${o.timeFrame ? ` [${o.timeFrame}]` : ''}`);
      if (prim.length) lines.push('Outcome measures:', ...prim, ...sec);

      // 적격기준 (요약)
      if (elig.eligibilityCriteria) lines.push(`Eligibility (excerpt): ${String(elig.eligibilityCriteria).replace(/\s+/g, ' ').slice(0, 700)}`);

      // 게시된 결과(있을 때만) — 군별 측정값
      const om = rs?.outcomeMeasuresModule?.outcomeMeasures ?? [];
      if (om.length) {
        lines.push('POSTED RESULTS (registry):');
        for (const o of om.slice(0, 4)) {
          const groups = (o.groups ?? []).map((g) => g.title).filter(Boolean).join(' vs ');
          lines.push(`• ${o.title}${o.timeFrame ? ` [${o.timeFrame}]` : ''}${groups ? ` — groups: ${groups}` : ''}`);
        }
      }
      const joined = lines.filter(Boolean).join('\n');
      return joined.length > 80 ? joined : null;
    } catch {
      return null;
    }
  }

  // ── Europe PMC full text (key-free) ──────────────────────────────────────
  // NCBI PMC efetch가 실패하거나 pmcid가 없을 때, Europe PMC 검색으로 OA 여부·PMCID를
  // 확인해 JATS 전문(fullTextXML)을 가져온다. 파싱은 PMC와 동일(_parsePmcXml).
  async _fetchEuropePmc(paper) {
    const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
    let pmcid = paper.pmcid ? String(paper.pmcid).replace(/^PMC/i, '') : '';

    if (!pmcid && paper.pmid) {
      const q = `EXT_ID:${paper.pmid} AND SRC:MED`;
      const sres = await this._fetchRetry(
        `${EPMC}/search?query=${encodeURIComponent(q)}&resultType=core&format=json`,
        {}, 'epmc-search'
      );
      if (!sres.ok) throw new Error(`EuropePMC search HTTP ${sres.status}`);
      const sdata = await sres.json();
      const r = sdata?.resultList?.result?.[0];
      // OA 전문이 있는 경우에만 진행(환각 방지: 페이월 초록만 있으면 스킵)
      if (!r || r.isOpenAccess !== 'Y' || !r.pmcid) return { text: '', figures: [] };
      pmcid = String(r.pmcid).replace(/^PMC/i, '');
    }
    if (!pmcid) return { text: '', figures: [] };

    const fres = await this._fetchRetry(`${EPMC}/PMC/PMC${pmcid}/fullTextXML`, {}, 'epmc-fulltext');
    if (!fres.ok) throw new Error(`EuropePMC fullText HTTP ${fres.status}`);
    const xmlText = await fres.text();
    const xml = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: false });
    return this._parsePmcXml(xml);
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
    const res = await this._fetchRetry(url, {}, 'pmc');
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
  // best_oa_location 우선, 나머지 oa_locations도 후보로 반환 (landing page 우선)
  async _unpaywallUrls(doi) {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
    const res = await this._fetchRetry(url, {}, 'unpaywall');
    if (!res.ok) return [];
    const data = await res.json();

    const locations = [data?.best_oa_location, ...(data?.oa_locations ?? [])].filter(Boolean);
    const urls = [];
    for (const loc of locations) {
      for (const u of [loc.url_for_landing_page, loc.url_for_pdf, loc.url]) {
        if (u && !urls.includes(u)) urls.push(u);
      }
    }
    return urls.slice(0, 4);
  }

  // ── HTML text extraction ──────────────────────────────────────────────────
  async _fetchHtmlText(url) {
    const res = await this._fetchRetry(url, {
      headers: {
        'User-Agent': `TrendReviewAgent/1.0 (research; mailto:${this.email})`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, 'oa-html');
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
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // &amp; 는 마지막에 — 먼저 풀면 '&amp;lt;' 같은 이중 인코딩이 마크업으로 되살아남
      .replace(/&amp;/g, '&')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
