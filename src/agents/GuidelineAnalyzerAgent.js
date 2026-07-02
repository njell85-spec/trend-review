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
      description: 'Submit a DETAILED, structured guideline catch-up brief (bilingual EN + KO)',
      input_schema: {
        type: 'object',
        properties: {
          pmid: { type: 'string' },
          org: { type: 'string', description: 'Issuing organization/society, e.g. "AHA/ACC", "Surviving Sepsis Campaign", "ATS/ESICM". Infer from title/journal; use "NR" if unclear.' },
          version: { type: 'string', description: 'Guideline year/version, e.g. "2026" or "2026 update". Use the publication year if not otherwise stated.' },
          title_ko: { type: 'string', description: 'Korean title of the guideline.' },
          scope_ko: { type: 'string', description: '이 가이드라인이 다루는 범위·대상 환자군을 1–2문장 한국어로.' },
          summary: { type: 'array', items: { type: 'string' }, description: 'KEY recommendations as SPECIFIC, self-contained bullets (English). Each must state the actual recommended action AND its class/level of evidence when the source gives it (e.g. "Start norepinephrine as first-line vasopressor targeting MAP ≥65 mmHg (strong recommendation, moderate evidence)"). 4–8 bullets. Use ONLY the provided text.' },
          summary_ko: { type: 'array', items: { type: 'string' }, description: 'Korean translations of summary (same order). Drug/score names may stay in English.' },
          keyChanges: {
            type: 'array',
            description: 'What SPECIFICALLY changed vs the previous version. Each item is ONE concrete change with enough detail to act on — NEVER a count like "20 recommendations added". If the source does not describe specific changes, return an empty array (never fabricate).',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string', description: 'Short topic/area of the change in Korean (e.g. "초기 수액 소생", "승압제 선택", "항생제 투여 시점").' },
                detail: { type: 'string', description: 'The specific change in English: previous recommendation → new recommendation, including changed thresholds/doses/timing, the new class/level of evidence, and the stated reason. Be concrete and self-contained.' },
                detail_ko: { type: 'string', description: 'Korean translation of detail with the SAME specificity (수치·용량·시간·등급 포함). Drug/score names may stay in English.' },
              },
              required: ['topic', 'detail', 'detail_ko'],
            },
          },
          practiceImpact: { type: 'string', description: 'How this should concretely change EM/CCM bedside practice (2–4 sentences, English).' },
          practiceImpact_ko: { type: 'string', description: 'Korean translation of practiceImpact.' },
          webSources: {
            type: 'array',
            description: 'Authoritative web pages you consulted via WebSearch/WebFetch to determine the specific changes (only if you actually used web search). Prefer the issuing society, the journal, or PubMed. Each {label, url}. Empty array if you did not use web search.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
          },
        },
        required: ['pmid', 'org', 'version', 'title_ko', 'scope_ko', 'summary', 'summary_ko', 'keyChanges', 'practiceImpact', 'practiceImpact_ko'],
      },
    };
  }

  async analyze(guideline) {
    if (!guideline) return null;
    const cacheKey = `guideline_v4_${this.provider}_${this.model}_${guideline.pmid}`;
    try {
      const { data } = await this.cache.getOrFetch(cacheKey, async () => {
        this.logger.info(`Guideline analysis: ${guideline.pmid} — ${guideline.title?.slice(0, 60)}…`);
        const hasFullText = guideline.fullText && guideline.fullText.length > 100;
        const fullTextSection = hasFullText
          ? `\n\n--- FULL TEXT (source: ${guideline.fullTextSource}, truncated) ---\n${guideline.fullText}\n---`
          : '';
        const augmentSection = guideline.augmentText
          ? `\n\n--- AUTHORITATIVE SOURCE (trustworthy structured/registry) ---\n${guideline.augmentText}\n---`
          : '';
        const prompt = `You are an expert emergency medicine and critical care physician writing a DETAILED GUIDELINE CATCH-UP brief for a busy clinician who wants to know EXACTLY what to change in practice.

This is a clinical practice guideline (not a primary study) — do NOT force a PICO structure. Produce:
  1. scope_ko — 무엇을(어떤 환자군을) 다루는 가이드라인인지.
  2. summary — the key recommendations, each a SPECIFIC actionable statement with class/level of evidence when stated.
  3. keyChanges — for EACH important change versus the previous version, describe SPECIFICALLY what changed: 이전 권고 → 새 권고, 바뀐 수치/용량/시간 기준, 새 근거등급, 그리고 이유. Describe the actual CONTENT of the changes — NEVER vague counts like "20 recommendations were added". Include as many concrete changes as the source supports.
  4. practiceImpact — concrete bedside impact for EM/CCM.

Guideline:
Title: ${guideline.title}
Authors: ${(guideline.authors ?? []).join(', ')}
Journal: ${guideline.journal} (${guideline.pubDate})
MeSH: ${(guideline.meshTerms ?? []).join(', ')}

Abstract / summary text:
${guideline.abstract}${fullTextSection}${augmentSection}

Use the submit_guideline_catchup tool. Report ONLY facts you can source — never invent recommendations or changes.

RESEARCH: If the provided text does NOT describe the specific CONTENT of what changed (e.g. it only gives aggregate counts like "20 new, 13 updated"), USE WebSearch/WebFetch to find the actual changes from AUTHORITATIVE sources — the issuing society's "What's New"/executive summary, the journal article, guideline repositories, or PubMed. Extract the specific changed recommendations (이전→이후, 수치/용량/시간/등급, 이유). List every authoritative page you used in "webSources". If, after searching, you still cannot find the specific content, return an empty "keyChanges" array rather than restating counts.

Provide Korean for all _ko fields; medical/drug/score names may remain in English. Be thorough — allocate as much detail as the sources support.`;

        // 웹검색 보강 우선; 헤드리스에서 웹툴이 불가/실패하면 텍스트-only 로 폴백(정직 안내로 귀결).
        const call = (webSearch) => this.cb.execute(() =>
          this.retry.execute(
            () => this.llm.callWithTool([{ role: 'user', content: prompt }], this._tool, { maxTokens: 12000, webSearch }),
            { label: `${this.provider}-guideline${webSearch ? '-web' : ''}` }));
        let result;
        try {
          result = await call(true);
        } catch (e) {
          this.logger.warn(`Guideline web-search call failed — falling back to text-only: ${e.message}`);
          result = await call(false);
        }
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
    if (guideline.oaUrl) sources.push({ label: 'Open-access full text', url: guideline.oaUrl });
    for (const s of guideline.augmentSources ?? []) sources.push(s);
    // Opus 가 웹검색으로 실제 사용한 권위 출처
    for (const s of data.webSources ?? []) {
      if (s?.url) sources.push({ label: `웹 — ${s.label ?? s.url}`, url: s.url });
    }

    const keyChanges = Array.isArray(data.keyChanges) ? data.keyChanges : [];
    return {
      type: 'guideline',
      paper: {
        pmid: guideline.pmid, title: guideline.title, journal: guideline.journal,
        pubDate: guideline.pubDate, pubmedUrl: pmUrl, doi: guideline.doi,
      },
      org: data.org, version: data.version, title_ko: data.title_ko,
      scope_ko: data.scope_ko ?? '',
      summary: data.summary ?? [], summary_ko: data.summary_ko ?? [],
      keyChanges,
      // 세부 변경점을 못 얻었고 본문도 확보 못한 경우 → 카드에서 정직하게 안내
      changesUnavailable: keyChanges.length === 0,
      fullTextSource: guideline.fullTextSource ?? 'abstract-only',
      practiceImpact: data.practiceImpact, practiceImpact_ko: data.practiceImpact_ko,
      sources,
      scoringData: guideline.scoringData,
    };
  }
}
