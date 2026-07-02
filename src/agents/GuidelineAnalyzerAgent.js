/**
 * GuidelineAnalyzerAgent — 가이드라인 캐치업 트랙.
 *
 * 논문(PICO)과 별개 트랙. PeterJ 요청:
 *   · 주 1회 가이드라인 1편만 추가 소개(없으면 건너뜀), 신규 나오면 추가.
 *   · PICO 형식 대신 "핵심 권고 요약 + 이전 판 대비 변경점 + 임상 임팩트".
 *
 * 선정: MetadataScorer(결정적)로 관심 적합도 기준 상위 미노출 가이드라인 1편.
 * 분석: 단일 문서 요약이므로 Opus 사용(단건이라 CLI 안전필터 통과 가능성 높음).
 *        LLM 미가용/거부 시 null 반환 → 오케스트레이터가 조용히 건너뜀.
 */
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';
import { LLMClient, PROVIDER_DEFAULTS } from '../utils/LLMClient.js';
import { MetadataScorer } from '../utils/MetadataScorer.js';

export class GuidelineAnalyzerAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? 'claude-opus-4-8' : PROVIDER_DEFAULTS[this.provider]);

    this.logger = new Logger('GuidelineAnalyzer', { logFile: 'guideline_analyzer.jsonl' });
    this.cache = new Cache();
    this.cb = new CircuitBreaker(`${this.provider}-guideline`, { failureThreshold: 3 });
    this.retry = new RetryHelper({ maxAttempts: 2, baseDelayMs: 3_000 });
    this.llm = new LLMClient({ provider: this.provider, model: this.model });
    this.scorer = new MetadataScorer();
  }

  // ── 미노출 가이드라인 중 관심 적합도 최상위 1편 선정 ──────────────────────────
  selectNew(guidelines, seenPmids = []) {
    if (!guidelines?.length) return null;
    const seen = new Set(seenPmids);
    const eligible = guidelines.filter((g) => !seen.has(g.pmid));
    if (!eligible.length) return null;

    const scores = new Map(this.scorer.scorePapers(eligible).map((s) => [s.pmid, s]));
    const ranked = eligible
      .map((g) => ({ ...g, scoringData: scores.get(g.pmid) ?? { rawScore: 0, score: 0 } }))
      .sort((a, b) => (b.scoringData.rawScore ?? 0) - (a.scoringData.rawScore ?? 0));

    const top = ranked[0];
    this.logger.info('Selected guideline', {
      pmid: top.pmid, score: top.scoringData.score, title: top.title?.slice(0, 70),
    });
    return top;
  }

  get _tool() {
    return {
      name: 'submit_guideline_catchup',
      description: 'Submit a structured guideline catch-up summary (bilingual EN + KO)',
      input_schema: {
        type: 'object',
        properties: {
          pmid: { type: 'string' },
          org: { type: 'string', description: 'Issuing organization/society, e.g. "AHA/ACC", "Surviving Sepsis Campaign", "ATS/ESICM". Infer from title/journal; use "NR" if unclear.' },
          version: { type: 'string', description: 'Guideline year/version, e.g. "2026" or "2026 update". Use the publication year if not otherwise stated.' },
          title_ko: { type: 'string', description: 'Korean title of the guideline.' },
          summary: { type: 'array', items: { type: 'string' }, description: '3–5 KEY recommendations as concise bullets (English). Include class/level of evidence if the abstract states them. Use ONLY what is in the provided text — never invent recommendations.' },
          summary_ko: { type: 'array', items: { type: 'string' }, description: 'Korean translations of summary (same order). Medical terms may stay in English.' },
          changes: { type: 'array', items: { type: 'string' }, description: 'What CHANGED versus the previous version — new/updated/downgraded recommendations (English). If the source does not describe changes, return an empty array (do NOT fabricate deltas).' },
          changes_ko: { type: 'array', items: { type: 'string' }, description: 'Korean translations of changes (same order).' },
          practiceImpact: { type: 'string', description: 'How this should change EM/CCM bedside practice (2–3 sentences, English).' },
          practiceImpact_ko: { type: 'string', description: 'Korean translation of practiceImpact.' },
        },
        required: ['pmid', 'org', 'version', 'title_ko', 'summary', 'summary_ko', 'changes', 'changes_ko', 'practiceImpact', 'practiceImpact_ko'],
      },
    };
  }

  async analyze(guideline) {
    if (!guideline) return null;
    const cacheKey = `guideline_v1_${this.provider}_${this.model}_${guideline.pmid}`;
    try {
      const { data } = await this.cache.getOrFetch(cacheKey, async () => {
        this.logger.info(`Guideline analysis: ${guideline.pmid} — ${guideline.title?.slice(0, 60)}…`);
        const prompt = `You are an expert emergency medicine and critical care physician writing a concise GUIDELINE CATCH-UP brief for a busy clinician.

This is a clinical practice guideline (not a primary study), so do NOT force a PICO structure. Instead summarize:
  1. The KEY recommendations (with class/level of evidence if stated).
  2. What CHANGED versus the previous version of this guideline.
  3. The practical bedside impact for EM/CCM.

Guideline:
Title: ${guideline.title}
Authors: ${(guideline.authors ?? []).join(', ')}
Journal: ${guideline.journal} (${guideline.pubDate})
MeSH: ${(guideline.meshTerms ?? []).join(', ')}

Abstract / summary text:
${guideline.abstract}

Use the submit_guideline_catchup tool. Report ONLY facts present in the provided text — never invent recommendations or changes. If the text does not describe what changed from a prior version, return an empty "changes" array rather than guessing. Provide Korean translations for all text fields (_ko); medical terms, drug names, and score names may remain in English.`;

        const result = await this.cb.execute(() =>
          this.retry.execute(() => this.llm.callWithTool([{ role: 'user', content: prompt }], this._tool),
            { label: `${this.provider}-guideline` }));
        return result;
      });

      return this._toCard(guideline, data);
    } catch (err) {
      // 분석 실패/거부 → null. 오케스트레이터가 조용히 건너뛴다(카드 미표시).
      this.logger.warn('Guideline analysis failed — skipping guideline this cycle', { err: err.message });
      return null;
    }
  }

  _toCard(guideline, data) {
    const sources = [];
    const pmUrl = guideline.pubmedUrl ?? (guideline.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${guideline.pmid}/` : null);
    if (pmUrl) sources.push({ label: `PubMed — PMID ${guideline.pmid}`, url: pmUrl });
    if (guideline.doi && guideline.doi.length > 3) sources.push({ label: `Journal (DOI) — ${guideline.doi}`, url: `https://doi.org/${guideline.doi}` });

    return {
      type: 'guideline',
      paper: {
        pmid: guideline.pmid, title: guideline.title, journal: guideline.journal,
        pubDate: guideline.pubDate, pubmedUrl: pmUrl, doi: guideline.doi,
      },
      org: data.org, version: data.version, title_ko: data.title_ko,
      summary: data.summary ?? [], summary_ko: data.summary_ko ?? [],
      changes: data.changes ?? [], changes_ko: data.changes_ko ?? [],
      practiceImpact: data.practiceImpact, practiceImpact_ko: data.practiceImpact_ko,
      sources,
      scoringData: guideline.scoringData,
    };
  }
}
