/**
 * FilterAnalyzerAgent
 * MCP bindings: fetch (Claude API), filesystem (cache read/write)
 *
 * Uses Claude to:
 *   1. Score all papers (1–10) for EM/CCM clinical applicability
 *   2. Select top-N papers
 *   3. Generate structured PICO analysis for each top paper
 */
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';
import { LLMClient, PROVIDER_DEFAULTS } from '../utils/LLMClient.js';
import { MetadataScorer } from '../utils/MetadataScorer.js';

export class FilterAnalyzerAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? 'claude-opus-4-8' : PROVIDER_DEFAULTS[this.provider]);
    this.picoModel = options.picoModel ?? this.model;

    this.logger = new Logger('FilterAnalyzerAgent', { logFile: 'filter_analyzer.jsonl' });
    this.cache = new Cache();
    this.cb = new CircuitBreaker(`${this.provider}-API`, { failureThreshold: 3 });
    this.retry = new RetryHelper({ maxAttempts: 3, baseDelayMs: 3_000 });

    this.llm = new LLMClient({ provider: this.provider, model: this.model });
    this.picoLlm = new LLMClient({ provider: this.provider, model: this.picoModel });
    this.topN = options.topN ?? Number(process.env.TOP_N ?? 1);

    // 스코어링은 결정적 메타데이터 스코어러로 수행한다 (LLM 아님).
    //   · 무료·무인 자동화에서 Claude Code CLI 안전필터의 배치 채점 거부(AUP)를 회피.
    //   · Opus 는 아래 analyzePico 의 "선정 1편" 심층분석에만 쓴다.
    this.scorer = new MetadataScorer();
  }

  // ── Tool definitions for structured Claude output ─────────────────────────
  get _scoringTool() {
    return {
      name: 'submit_paper_scores',
      description: 'Submit clinical applicability scores for a batch of EM/CCM papers',
      input_schema: {
        type: 'object',
        properties: {
          scores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pmid: { type: 'string' },
                score: {
                  type: 'number',
                  description: 'Clinical applicability score 1–10 for EM/CCM practice',
                },
                rationale: {
                  type: 'string',
                  description: 'One-sentence justification',
                },
                studyType: {
                  type: 'string',
                  enum: ['RCT', 'Observational', 'Meta-analysis', 'Systematic Review',
                         'Case Series', 'Guidelines', 'Other'],
                },
              },
              required: ['pmid', 'score', 'rationale', 'studyType'],
            },
          },
        },
        required: ['scores'],
      },
    };
  }

  get _picoTool() {
    return {
      name: 'submit_pico_analysis',
      description: 'Submit a complete PICO analysis for a paper (bilingual: English + Korean)',
      input_schema: {
        type: 'object',
        properties: {
          pmid: { type: 'string' },
          title_ko: {
            type: 'string',
            description: 'Natural Korean translation of the paper title (concise). Drug names, score names, and trial acronyms may remain in English.',
          },
          clinicalQuestion: {
            type: 'string',
            description: 'Core clinical question the paper addresses (1–2 sentences, English)',
          },
          clinicalQuestion_ko: {
            type: 'string',
            description: 'Korean translation of clinicalQuestion. Medical/drug/score names may stay in English.',
          },
          pico: {
            type: 'object',
            properties: {
              population: {
                type: 'string',
                description: 'Patient population and inclusion criteria. MUST BEGIN with the study country/region in square brackets, e.g. "[USA] ...", "[International]" for multinational studies, or "[Country NR]" if not reported. State the country only when given/inferable from the source — never guess. Then preserve the original wording of the abstract as closely as possible (near-verbatim excerpt). MUST include specific numbers (N, age, %, date ranges) from the abstract.',
              },
              intervention: {
                type: 'string',
                description: 'Primary intervention or exposure studied. Preserve the original abstract wording where possible. Include doses, thresholds, or cutoff values when reported.',
              },
              comparison: {
                type: 'string',
                description: 'Comparison group or control condition (null if none). Preserve the original abstract wording where possible.',
              },
              outcome: {
                type: 'string',
                description: 'PRIMARY outcome only, with reported statistics (AUROC, OR, HR, CI, p-values, etc.). Report ONLY statistics explicitly stated in the paper — never derive or compute new values (e.g., do not calculate NNT).',
              },
            },
            required: ['population', 'intervention', 'comparison', 'outcome'],
          },
          pico_ko: {
            type: 'object',
            description: 'Korean translations of each PICO field. The population field MUST also begin with the study country in Korean square brackets, e.g. "[미국] ...", "[다국가]" for multinational, or "[국가 미기재]" if not reported. Medical terms, score names, and statistics may remain in English.',
            properties: {
              population: { type: 'string' },
              intervention: { type: 'string' },
              comparison: { type: 'string' },
              outcome: { type: 'string' },
            },
          },
          baseline: {
            type: 'string',
            enum: ['Balanced', 'Imbalanced', 'Not reported'],
            description: 'Baseline comparability between study groups as reported in the paper. Use "Not reported" if the paper does not state it.',
          },
          secondaryOutcomes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Up to 3 key secondary outcomes, each with its reported statistics. Report ONLY values explicitly stated in the paper. Empty array if none reported.',
          },
          secondaryOutcomes_ko: {
            type: 'array',
            items: { type: 'string' },
            description: 'Korean translations of secondaryOutcomes (same order). Statistics and medical terms may remain in English.',
          },
          statGlossary: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                term: {
                  type: 'string',
                  description: 'Statistical term exactly as used in the outcome fields (e.g., OR, HR, 95% CI, p-value, AUROC, mRS)',
                },
                explanation_ko: {
                  type: 'string',
                  description: 'One-sentence Korean explanation WITH a concrete value example from this paper. Format: "[개념 설명]. 예: [term] [actual value from paper] → [meaning in plain Korean]". Example for OR: "오즈비: 1보다 작으면 위험 감소, 1보다 크면 증가. 예: OR 0.76 → 대조군 대비 사건 발생이 24% 낮음". Always include the actual numeric value from this paper.',
                },
              },
              required: ['term', 'explanation_ko'],
            },
            description: 'Plain-language glossary covering every statistical measure that appears in the outcome/secondaryOutcomes fields. Only include terms that actually appear.',
          },
          practiceChange: {
            type: 'array',
            items: { type: 'string' },
            description: '2–3 actionable practice-change bullet points for EM/CCM clinicians (English)',
          },
          practiceChange_ko: {
            type: 'array',
            items: { type: 'string' },
            description: 'Korean translations of practiceChange (same order). Medical terms may remain in English.',
          },
          keyFindings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Top 3 key findings as bullet points. Include specific numbers, effect sizes, and p-values from the abstract.',
          },
          keyFindings_ko: {
            type: 'array',
            items: { type: 'string' },
            description: 'Korean translations of keyFindings (same 3 items). Statistics and medical terms may remain in English.',
          },
          clinicalTakeaway: {
            type: 'string',
            description: 'Actionable clinical takeaway for EM/CCM practitioners (2–3 sentences, English)',
          },
          clinicalTakeaway_ko: {
            type: 'string',
            description: 'Korean translation of clinicalTakeaway. Medical terms may remain in English.',
          },
          limitations: {
            type: 'string',
            description: 'Main study limitations relevant to clinical application (English)',
          },
          limitations_ko: {
            type: 'string',
            description: 'Korean translation of limitations. Medical terms may remain in English.',
          },
          evidenceLevel: {
            type: 'string',
            enum: ['High', 'Moderate', 'Low', 'Very Low'],
            description: 'GRADE-informed evidence quality',
          },
          clinicalApplicabilityScore: {
            type: 'number',
            description: 'Final score 1–10 after full analysis',
          },
        },
        required: [
          'pmid', 'title_ko', 'clinicalQuestion', 'clinicalQuestion_ko',
          'pico', 'pico_ko', 'baseline',
          'secondaryOutcomes', 'secondaryOutcomes_ko', 'statGlossary',
          'keyFindings', 'keyFindings_ko',
          'clinicalTakeaway', 'clinicalTakeaway_ko',
          'limitations', 'limitations_ko',
          'practiceChange', 'practiceChange_ko',
          'evidenceLevel', 'clinicalApplicabilityScore',
        ],
      },
    };
  }

  // ── LLM API wrapper (provider-agnostic) ─────────────────────────────────
  async _callLLM(messages, tool, llm = this.llm, opts = {}) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => llm.callWithTool(messages, tool, opts),
        {
          label: `${this.provider}-API`,
          onRetry: ({ attempt, delay }) =>
            this.logger.warn(`${this.provider} retry ${attempt} in ${Math.round(delay)}ms`),
        }
      )
    );
  }

  // ── Step 1: Score all papers — 결정적 메타데이터 스코어링 (LLM 아님) ─────────
  // PubMed 메타데이터(저널 등급·연구 설계·표본수·최신성·EM/CCM 적합도)만으로 채점한다.
  // LLM 배치 채점은 Claude Code CLI 안전필터가 거부(AUP)하므로 자동화에서 쓸 수 없다.
  // 반환 형태는 기존 계약 유지: [{ pmid, score, rationale, studyType }]
  async scorePapers(papers) {
    const scores = this.scorer.scorePapers(papers);
    this.logger.info(`Scored ${scores.length} papers (deterministic metadata)`, {
      top: [...scores].sort((a, b) => b.score - a.score).slice(0, 3)
        .map((s) => ({ pmid: s.pmid, score: s.score, type: s.studyType })),
    });
    return scores;
  }

  // ── Step 2: Select top-N papers (excluding already-published PMIDs) ─────────
  _selectTopPapers(papers, scores, excludePmids = []) {
    const scoreMap  = new Map(scores.map((s) => [s.pmid, s]));
    const excludeSet = new Set(excludePmids);

    const eligible = papers.filter((p) => !excludeSet.has(p.pmid));
    if (eligible.length < papers.length) {
      this.logger.info(`Excluded ${papers.length - eligible.length} already-published PMIDs from selection`);
    }

    return eligible
      .map((p) => ({
        ...p,
        scoringData: scoreMap.get(p.pmid) ?? { score: 0, rawScore: 0, rationale: '', studyType: 'Other' },
      }))
      // rawScore(풀 정밀도)로 정렬해 동점을 안정적으로 깬다 (표시 점수는 반올림됨).
      .sort((a, b) => (b.scoringData.rawScore ?? b.scoringData.score ?? 0)
                    - (a.scoringData.rawScore ?? a.scoringData.score ?? 0))
      .slice(0, this.topN);
  }

  // ── Step 3: PICO analysis for top papers (parallel) ──────────────────────
  async analyzePico(topPapers) {
    this.logger.info(`Generating PICO analysis for top ${topPapers.length} papers`);

    const analyses = await Promise.allSettled(
      topPapers.map((paper) => this._analyzeSinglePaper(paper))
    );

    return analyses.map((result, idx) => {
      if (result.status === 'fulfilled') return result.value;
      this.logger.error(`PICO failed for PMID ${topPapers[idx].pmid}`, {
        err: result.reason?.message,
      });
      // 폴백도 정상 경로와 동일하게 출처 배지/링크(provenance)를 붙여, 렌더 시
      // evidenceSource/sources 가 undefined 가 되지 않도록 한다.
      return { ...this._fallbackPico(topPapers[idx]), ...this._provenance(topPapers[idx]) };
    });
  }

  async _analyzeSinglePaper(paper) {
    const cacheKey = `pico_v5_${this.provider}_${this.picoModel}_${paper.pmid}`;
    const { data, fromCache } = await this.cache.getOrFetch(cacheKey, async () => {
      this.logger.info(`PICO analysis: ${paper.pmid} — ${paper.title.slice(0, 60)}…`);

      const hasFullText = paper.fullText && paper.fullText.length > 100;
      const fullTextSection = hasFullText
        ? `\n\n--- FULL TEXT (source: ${paper.fullTextSource}, ${Math.round(paper.fullTextLength / 1000)}k chars, truncated) ---\n${paper.fullText}\n---`
        : '';

      // 권위 있는 구조화 보강 소스 (ClinicalTrials.gov 등). 본문이 없을 때 특히 중요.
      const augmentSection = paper.augmentText
        ? `\n\n--- AUTHORITATIVE REGISTRY (ClinicalTrials.gov — trustworthy structured source) ---\n${paper.augmentText}\n---`
        : '';

      const figureSection = paper.figures?.length
        ? `\n\nFigures/Tables extracted:\n${paper.figures.map((f) => `• ${f.label}: ${f.caption}`).join('\n')}`
        : '';

      const prompt = `You are an expert emergency medicine and critical care physician conducting a systematic literature review.

Perform a detailed PICO analysis of the following paper:

Title: ${paper.title}
Authors: ${paper.authors.join(', ')}
Journal: ${paper.journal} (${paper.pubDate})
MeSH Terms: ${paper.meshTerms.join(', ')}
Full-text available: ${hasFullText ? `YES (${paper.fullTextSource})` : 'NO — abstract only'}

Abstract:
${paper.abstract}${fullTextSection}${augmentSection}${figureSection}

Provide a complete structured analysis using the submit_pico_analysis tool.
Requirements:
1. ${hasFullText
        ? 'Full text is provided — use it to extract detailed methods, subgroup analyses, exact statistics, and figure/table data NOT in the abstract.'
        : (paper.augmentText
          ? 'No journal full text — the abstract PLUS an authoritative ClinicalTrials.gov registry record are provided. You MAY use the registry to add trial design, eligibility, exact outcome definitions, enrollment, and any POSTED numeric results that the abstract omits. Treat the registry as a trustworthy source; do NOT pull facts from anywhere else.'
          : 'Only the abstract is available — note this limitation explicitly and do not invent details.')}
2. PICO fields must include specific numbers (sample sizes, ages, percentages, date ranges, cutoffs, effect sizes, p-values, confidence intervals). Use ONLY values explicitly present in the abstract, the provided full text, or the provided authoritative registry — NEVER infer, compute, or import numbers from memory or other studies. Prioritize full text > registry > abstract when sources differ.
3. Provide Korean translations for ALL text fields (_ko suffix). Medical terms, drug names, score names (e.g., SOFA, AUROC, PELOD-2), and statistics must remain in English within Korean text — translate only the surrounding prose.
4. Report ONLY values explicitly stated in the paper. NEVER derive, compute, or estimate new statistics yourself (e.g., do not calculate NNT or absolute risk differences unless the paper reports them). If a value is not reported, omit it rather than guessing.
5. For the English PICO fields (population/intervention/comparison/outcome), preserve the original wording of the source text as closely as possible — write them as near-verbatim excerpts, not free paraphrases.
6. statGlossary: for every statistical term that appears in your outcome/secondaryOutcomes text (e.g., OR, HR, 95% CI, p-value, AUROC, mRS), add one entry with a single-sentence plain-Korean explanation a junior clinician could understand. Do not include terms that do not appear.
7. practiceChange: 2–3 concrete, actionable bullets describing how this evidence should (or should not) change EM/CCM practice.
8. title_ko: a natural, concise Korean translation of the paper title (drug/score/trial names may stay in English).`;

      // 이중언어 필드가 많아 출력이 길다 — 기본 8192 를 넘겨 tool_use 가 잘리지 않도록 상향.
      return await this._callLLM(
        [{ role: 'user', content: prompt }],
        this._picoTool,
        this.picoLlm,
        { maxTokens: 12000 }
      );
    });

    if (fromCache) this.logger.debug(`PICO from cache: ${paper.pmid}`);
    return { ...data, paper, ...this._provenance(paper) };
  }

  // ── 근거 출처 배지 + 참조 링크 (결정적 — LLM 무관) ───────────────────────────
  _provenance(paper) {
    const badge = {
      PMC: '본문(PMC)',
      EuropePMC: '본문(EPMC)',
      Unpaywall: '본문(OA)',
      'abstract+registry': '초록 + 레지스트리',
      'abstract-only': '초록만',
    }[paper.fullTextSource] ?? '초록만';

    const sources = [];
    const pmUrl = paper.pubmedUrl ?? (paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : null);
    if (pmUrl) sources.push({ label: `PubMed — PMID ${paper.pmid}`, url: pmUrl });
    if (paper.doi && paper.doi.length > 3) sources.push({ label: `Journal (DOI) — ${paper.doi}`, url: `https://doi.org/${paper.doi}` });
    if (paper.oaUrl) sources.push({ label: 'Open-access full text', url: paper.oaUrl });
    for (const s of paper.augmentSources ?? []) sources.push(s);

    return { evidenceSource: badge, sources };
  }

  _fallbackPico(paper) {
    const notAnalyzed = { population: 'Not analyzed', intervention: 'Not analyzed', comparison: 'Not analyzed', outcome: 'Not analyzed' };
    return {
      pmid: paper.pmid,
      paper,
      title_ko: paper.title ?? '',
      clinicalQuestion: 'Analysis unavailable — see abstract',
      clinicalQuestion_ko: '분석 실패 — 원문 초록을 확인하세요',
      pico: { ...notAnalyzed },
      pico_ko: { ...notAnalyzed },
      baseline: 'Not reported',
      secondaryOutcomes: [],
      secondaryOutcomes_ko: [],
      statGlossary: [],
      keyFindings: ['Analysis failed — refer to original abstract'],
      keyFindings_ko: ['분석 실패 — 원문 초록을 확인하세요'],
      clinicalTakeaway: 'Manual review required',
      clinicalTakeaway_ko: '수동 검토 필요',
      limitations: 'Automated analysis failed',
      limitations_ko: '자동 분석 실패',
      practiceChange: [],
      practiceChange_ko: [],
      evidenceLevel: 'Very Low',
      clinicalApplicabilityScore: paper.scoringData?.score ?? 0,
      analysisError: true,
    };
  }

  // ── Scoring + selection only (no PICO) — used when full-text enrichment follows ──
  async runScoringOnly(papers, excludePmids = []) {
    this.logger.section('FilterAnalyzerAgent — Scoring & Selection (no PICO yet)');
    if (!papers.length) return { topPapers: [], allScoredPapers: [] };

    const scores = await this.scorePapers(papers);
    const topPapers = this._selectTopPapers(papers, scores, excludePmids);

    const scoreMap = new Map(scores.map((s) => [s.pmid, s]));
    const allScoredPapers = papers.map((p) => ({
      ...p,
      scoringData: scoreMap.get(p.pmid) ?? { score: 0, studyType: 'Other' },
    }));

    this.logger.info(`Selected top ${topPapers.length} papers for full-text enrichment`);
    return { topPapers, allScoredPapers };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run(papers, { excludePmids = [] } = {}) {
    this.logger.section('FilterAnalyzerAgent — Clinical Scoring & PICO Analysis');

    if (!papers.length) {
      this.logger.warn('No papers to analyze');
      return { topPapers: [], allScoredPapers: [], stats: {} };
    }

    const start = Date.now();

    // 1. Score all papers
    this.logger.info(`Scoring ${papers.length} papers for clinical applicability…`);
    const scores = await this.scorePapers(papers);
    this.logger.info(`Scored ${scores.length} papers`);

    // 2. Select top-N (excluding already-published)
    const topPapers = this._selectTopPapers(papers, scores, excludePmids);
    this.logger.info(
      `Top ${topPapers.length} papers selected`,
      topPapers.map((p) => ({
        pmid: p.pmid,
        score: p.scoringData.score,
        title: p.title.slice(0, 60),
      }))
    );

    // 3. PICO analysis
    const picoResults = await this.analyzePico(topPapers);

    // Merge scoring data into all papers for reporting
    const scoreMap = new Map(scores.map((s) => [s.pmid, s]));
    const allScoredPapers = papers.map((p) => ({
      ...p,
      scoringData: scoreMap.get(p.pmid) ?? { score: 0, studyType: 'Other' },
    }));

    const stats = {
      totalPapersInput: papers.length,
      papersScored: scores.length,
      topNSelected: picoResults.length,
      picoErrors: picoResults.filter((p) => p.analysisError).length,
      elapsedSeconds: ((Date.now() - start) / 1000).toFixed(1),
      circuitBreaker: this.cb.getStatus(),
    };

    this.logger.info('Analysis complete', stats);
    return { topPapers: picoResults, allScoredPapers, stats };
  }
}

// ── Standalone test ───────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('FilterAnalyzerAgent.js')) {
  const mockPapers = [
    {
      pmid: '99999001',
      title: 'Early Goal-Directed Therapy vs Usual Care in Septic Shock: A Multicenter RCT',
      abstract:
        'Background: Septic shock carries high mortality. We randomized 1200 patients to early goal-directed therapy (EGDT) vs usual care. Primary outcome was 90-day mortality. Results: 90-day mortality was 24.2% in EGDT vs 27.6% in usual care (OR 0.84, 95%CI 0.65-1.08). Secondary outcomes including ICU LOS did not differ. Conclusion: EGDT did not improve mortality in contemporary septic shock.',
      authors: ['Rivers E', 'Nguyen B', 'Smith J'],
      journal: 'New England Journal of Medicine',
      pubDate: '2024-11',
      meshTerms: ['Septic Shock', 'Fluid Therapy', 'Resuscitation'],
      keywords: ['sepsis', 'EGDT', 'resuscitation'],
      pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/99999001/',
      collectedAt: new Date().toISOString(),
    },
  ];

  const agent = new FilterAnalyzerAgent({ topN: 1 });
  const result = await agent.run(mockPapers);
  console.log('\nPICO result:', JSON.stringify(result.topPapers[0]?.pico, null, 2));
}
