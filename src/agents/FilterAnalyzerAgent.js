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
import { LLMClient, PROVIDER_DEFAULTS, ANTHROPIC_ANALYSIS_MODEL } from '../utils/LLMClient.js';
import { MetadataScorer } from '../utils/MetadataScorer.js';

// LLM 재순위를 신뢰하는 최소 커버리지 — 이 밑이면 재순위 전체 무효.
// 1.0(전부 덮어야 함)이었으나 19/20 응답을 버리는 것이 실제 해였다(2026-08-10).
const MIN_RERANK_COVERAGE = 0.8;

export class FilterAnalyzerAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? ANTHROPIC_ANALYSIS_MODEL : PROVIDER_DEFAULTS[this.provider]);
    this.picoModel = options.picoModel ?? this.model;

    this.logger = new Logger('FilterAnalyzerAgent', { logFile: 'filter_analyzer.jsonl' });
    this.cache = new Cache();
    this.cb = new CircuitBreaker(`${this.provider}-API`, { failureThreshold: 3 });
    this.retry = new RetryHelper({ maxAttempts: 3, baseDelayMs: 3_000 });

    this.llm = new LLMClient({ provider: this.provider, model: this.model });
    this.picoLlm = new LLMClient({ provider: this.provider, model: this.picoModel });
    this.topN = options.topN ?? Number(process.env.TOP_N ?? 1);

    // 스코어링은 결정적 메타데이터 스코어러로 후보를 압축한다 (LLM 아님).
    //   · 무료·무인 자동화에서 Claude Code CLI 안전필터의 배치 채점 거부(AUP)를 회피.
    this.scorer = new MetadataScorer();

    // LLM rerank(선택): 결정적 상위 K편만 Opus가 정독해 "침상 임상가치"로 재순위 → top-N.
    //   · PeterJ 확정(2026-07-10): 결정적은 주제·저널까지, 침상가치 변별은 LLM.
    //   · 소프트: 실패/거부 시 결정적 순위 유지(데일리 코어 무영향). 게이트 기본 off.
    //   · ★ RERANK_POOL 은 워크플로가 `${{ vars.RERANK_POOL }}` 로 주입하므로 변수가
    //     미설정이면 **빈 문자열**이 온다. `??` 는 빈 문자열을 통과시켜 `Number('')=0`
    //     → poolSize 1 → 재순위가 조용히 죽는다(F1, 4주간 은폐). 정수·양수만 신뢰한다.
    this.enableRerank = options.enableRerank ?? (process.env.ENABLE_RERANK === 'true');
    const parsedPool = Number(process.env.RERANK_POOL);
    this.rerankPool = options.rerankPool
      ?? (Number.isInteger(parsedPool) && parsedPool > 0 ? parsedPool : 20);
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
          webSources: {
            type: 'array',
            description: 'Authoritative web pages you actually consulted via WebSearch/WebFetch to fill gaps when no full text/registry was available (journal official page, PubMed, PMC, publisher). Only if you truly used web search. Each {label, url}. Empty array if you did not use web search.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
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
  async _callLLM(messages, tool, llm = this.llm, { webSearch = false, maxTokens = null } = {}) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => llm.callWithTool(messages, tool,
          { webSearch, maxTokens: maxTokens ?? (webSearch ? 12000 : 8192) }),
        {
          label: `${this.provider}-API${webSearch ? '-web' : ''}`,
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

  // ── Step 2: Select top-K papers (excluding already-published PMIDs) ─────────
  // limit 기본은 topN. rerank 시엔 pool(예: 20)을 넘겨 결정적 상위 K편을 추린다.
  _selectTopPapers(papers, scores, excludePmids = [], limit = this.topN) {
    const scoreMap  = new Map(scores.map((s) => [s.pmid, s]));
    const excludeSet = new Set(excludePmids);

    let eligible = papers.filter((p) => !excludeSet.has(p.pmid));
    if (eligible.length < papers.length) {
      this.logger.info(`Excluded ${papers.length - eligible.length} already-published PMIDs from selection`);
    }

    // 저널 배제 (PeterJ 지시 2026-08-10) — 감점이 아니라 후보에서 뺀다.
    // ★ 폴백: 배제 후 topN 을 못 채우면 배제를 적용하지 않는다. 배제 목록이 넓어졌거나
    //   그날 후보가 얕을 때 데일리가 빈손이 되는 것보다, 한 편이라도 내보내는 편이 낫다.
    //   (이 폴백이 돌면 로그에 남으므로 목록이 과한지 사후에 알 수 있다.)
    const kept = eligible.filter((p) => !this.scorer.isExcludedJournal(p));
    const dropped = eligible.length - kept.length;
    if (dropped > 0) {
      if (kept.length >= this.topN) {
        this.logger.info(`저널 배제: ${dropped}편 제외 (간호·영양 등 — config/journals.json exclude)`);
        eligible = kept;
      } else {
        this.logger.warn('저널 배제를 건너뜀 — 배제하면 후보가 topN 미만이 된다', {
          eligible: eligible.length, kept: kept.length, topN: this.topN,
        });
      }
    }

    return eligible
      .map((p) => ({
        ...p,
        scoringData: scoreMap.get(p.pmid) ?? { score: 0, rawScore: 0, rationale: '', studyType: 'Other' },
      }))
      // rawScore(풀 정밀도)로 정렬해 동점을 안정적으로 깬다 (표시 점수는 반올림됨).
      .sort((a, b) => (b.scoringData.rawScore ?? b.scoringData.score ?? 0)
                    - (a.scoringData.rawScore ?? a.scoringData.score ?? 0))
      .slice(0, limit);
  }

  // ── Step 2b: LLM rerank — 결정적 상위 K편을 "침상 임상가치"로 재순위 → 상위 n편 ──
  // 결정적은 주제·저널까지 압축하고, 여기서 Opus가 연구 성격(급성 침상 개입 vs
  // 역학·이송·원격모니터링·QI·리뷰·증례)을 변별한다. 소프트: 실패/거부 시 결정적 순위 유지.
  //
  // 반환은 `{ picks, telemetry }` — telemetry 는 **실행 증거**다. 호출부는 이 값으로만
  // `(LLM reranked)` 를 찍는다. 플래그(enableRerank)로 찍으면 안 돈 날도 돌았다고
  // 기록돼 고장이 보이지 않는다(F1이 4주간 은폐된 직접 원인).
  async _rerankSelect(pool, n) {
    const telemetry = { llmCalled: false, applied: false, reason: null };
    if (pool.length <= n) {
      telemetry.reason = 'pool_too_small';
      this.logger.warn('LLM rerank 미발동 — 풀이 topN 이하 (RERANK_POOL 주입값을 확인하라)', {
        pool: pool.length, topN: n, rerankPool: this.rerankPool,
      });
      return { picks: pool.slice(0, n), telemetry };
    }
    try {
      const prompt = `You are an expert emergency medicine and critical care (EM/CCM) physician choosing the single most valuable paper for TODAY's bedside practice.
Score each of the following ${pool.length} papers 1–10 for CLINICAL BEDSIDE VALUE to an acute/critical-care physician:
10 = directly changes acute bedside management of a critically ill or emergency patient (diagnosis, drug, procedure, resuscitation target).
Downgrade papers that do NOT change bedside decisions even if on-topic: epidemiology/registry/health-services, interhospital transfer, readmission/remote monitoring, quality-improvement, narrative reviews, case reports, protocols.
Return one entry per paper via the submit_paper_scores tool.

Papers:
${pool.map((p, i) => `[${i + 1}] PMID ${p.pmid} | ${p.journal} | types: ${(p.publicationTypes || []).join(', ') || 'NR'}
Title: ${p.title}
Abstract: ${String(p.abstract ?? '').slice(0, 1200)}`).join('\n\n')}`;

      // ★ 출력 상한은 풀 크기에 비례해야 한다 (2026-08-14 실측).
      //   `submit_paper_scores` 는 **논문 1편당 1엔트리**를 요구하므로 출력이 풀에 비례한다.
      //   실측: 20편 → 3,883 출력 토큰 = 편당 194. 고정 상한 8,192 는 **42편이 한계**이고,
      //   120편(PeterJ 안)은 약 23,300 토큰이 필요해 그냥 죽는다 — 실제로 110편 호출이
      //   조용히 실패했다(usage 0). 소프트 실패라 "결정적 순위 유지"로 넘어가 **LLM 이 안
      //   돌았는데 돈 것처럼 보인다.** 상한을 풀에 맞춰 늘린다.
      //   ★ 종전 기본값(8,192)보다 **낮아지지 않게** 바닥을 깐다. 풀 20 이면 공식값이
      //   5,800 이라 데일리 예산이 오히려 줄어드는데, 초록·rationale 길이는 날마다 달라서
      //   그 축소가 언젠가 조용한 절단으로 돌아온다. 늘리는 것만 하고 줄이지는 않는다.
      const rerankMaxTokens = Math.max(8_192, Math.min(64_000, 1_000 + 240 * pool.length));
      telemetry.rerankMaxTokens = rerankMaxTokens;
      telemetry.llmCalled = true;
      const out = await this._callLLM([{ role: 'user', content: prompt }], this._scoringTool,
        this.llm, { maxTokens: rerankMaxTokens });
      // ★ 숫자가 아닌 점수는 버린다. 하나라도 NaN 이 섞이면 그 논문이 정렬에서 1위로
      //   튀어오르고(NaN 비교는 false), 중앙값에 걸리면 미채점분 전체가 NaN 이 된다.
      const map = new Map((out?.scores ?? [])
        .filter((s) => s?.pmid != null && Number.isFinite(Number(s.score)))
        .map((s) => [String(s.pmid), s]));
      if (!map.size) {
        telemetry.reason = 'empty_scores';
        this.logger.warn('LLM rerank: 빈 결과 — 결정적 순위 유지');
        return { picks: pool.slice(0, n), telemetry };
      }
      // ★ 커버리지 판정 (2026-08-10 개정 — 스펙 §5.4 에서 벗어난다).
      //   스펙은 "풀을 전부 덮지 않으면 전체 무효"였고 그대로 구현했는데, 실운영
      //   첫날(run 31338148071) `{pool:20, scored:20, missing:1}` — LLM 이 풀에 없는
      //   PMID 를 하나 섞어 보낸 것만으로 **19편의 멀쩡한 채점을 통째로 버렸다.**
      //   그 결과 결정적 순위가 그대로 쓰여 간호지가 1위로 발행됐다. 규칙이 과했다.
      //   이제 대부분(80% 이상)을 덮으면 **채점분만 재순위**하고, 미채점분은 0점이
      //   아니라 **결정적 순위 뒤**로 보낸다(0점 취급하면 LLM 이 안 본 논문이 최하위로
      //   밀려 순위가 왜곡된다). 절반도 못 덮으면 종전대로 전체 무효.
      const covered = pool.filter((p) => map.has(String(p.pmid))).length;
      const coverage = covered / pool.length;
      if (coverage < MIN_RERANK_COVERAGE) {
        telemetry.reason = 'incomplete_scores';
        this.logger.warn('LLM rerank: 응답 커버리지 부족 — 재순위 무효, 결정적 순위 유지', {
          pool: pool.length, covered, coverage: coverage.toFixed(2),
        });
        return { picks: pool.slice(0, n), telemetry };
      }
      if (covered < pool.length) {
        telemetry.reason = 'partial_scores';
        this.logger.warn('LLM rerank: 부분 적용 — 채점분만 재순위, 미채점분은 결정적 순위 뒤로', {
          pool: pool.length, covered, missing: pool.length - covered,
        });
      }

      // 미채점분에는 **채점분의 중앙값**을 준다. 0점(또는 맨 뒤)으로 밀면 LLM 이
      // 우연히 빠뜨린 논문이 처벌받고, 만점을 주면 반대로 특혜가 된다. 중앙값이면
      // 결정적 순위(동점 tie-break)가 그대로 살아 LLM 의 누락이 순위를 왜곡하지 않는다.
      const scored = pool.map((p) => map.get(String(p.pmid))).filter(Boolean).map((s) => Number(s.score));
      const sortedScores = [...scored].sort((a, b) => a - b);
      const median = sortedScores.length
        ? sortedScores[Math.floor((sortedScores.length - 1) / 2)]
        : 0;
      const scoreOf = (p) => (map.has(String(p.pmid)) ? Number(map.get(String(p.pmid)).score) : median);
      const reranked = [...pool]
        .sort((a, b) => (scoreOf(b) - scoreOf(a))
                     || ((b.scoringData?.rawScore ?? 0) - (a.scoringData?.rawScore ?? 0)))
        .map((p) => {
          const r = map.get(String(p.pmid));
          if (r) { p.rerankScore = Number(r.score); p.rerankRationale = r.rationale; }
          return p;
        });
      telemetry.applied = true;
      this.logger.info('LLM rerank applied', {
        pool: pool.length,
        top: reranked.slice(0, 3).map((p) => ({ pmid: p.pmid, rerank: p.rerankScore, det: p.scoringData?.score })),
      });
      return { picks: reranked.slice(0, n), telemetry };
    } catch (err) {
      telemetry.reason = `llm_error: ${err.message}`;
      this.logger.warn('LLM rerank 실패 — 결정적 순위 유지 (소프트)', { err: err.message });
      return { picks: pool.slice(0, n), telemetry };
    }
  }

  // ── Step 3: PICO analysis for top papers (parallel) ──────────────────────
  async analyzePico(topPapers) {
    this.logger.info(`Generating PICO analysis for top ${topPapers.length} papers`);

    const analyses = await Promise.allSettled(
      topPapers.map((paper) => this._analyzeSinglePaper(paper))
    );

    const rejected = analyses.filter((a) => a.status === 'rejected');
    // 전건 실패면 예외를 전파한다 — 성공처럼 빈 fallback 카드를 발행/발송하지 않고,
    // runWithRetry(github-actions-daily)가 세션 한도(429) 리셋 창을 노려 재시도하게 한다.
    // (실패 사유 원문을 메시지에 실어 classifyFailure가 429/세션한도를 인식하도록 한다.)
    if (topPapers.length && rejected.length === topPapers.length) {
      const reason = rejected[0].reason?.message ?? 'unknown error';
      throw new Error(`PICO analysis failed for all ${topPapers.length} paper(s): ${reason}`);
    }

    return analyses.map((result, idx) => {
      if (result.status === 'fulfilled') return result.value;
      this.logger.error(`PICO failed for PMID ${topPapers[idx].pmid}`, {
        err: result.reason?.message,
      });
      return this._fallbackPico(topPapers[idx]);
    });
  }

  async _analyzeSinglePaper(paper) {
    const hasFullText = paper.fullText && paper.fullText.length > 100;
    const hasRegistry = Boolean(paper.augmentText);
    // 본문(PMC/OA)도 권위 레지스트리(ClinicalTrials.gov)도 없으면 → 웹검색 보강.
    // "초록만"으로 끝나지 않도록 권위 소스(저널 공식 페이지·PubMed)를 찾게 한다.
    const webAugment = !hasFullText && !hasRegistry;
    // 캐시 키에 본문 확보 상태 + 웹보강 여부 포함 — 상태 바뀌면 재분석
    const src = paper.fullTextSource ?? 'none';
    const cacheKey = `pico_v7_${this.provider}_${this.picoModel}_${paper.pmid}_${src}_${paper.fullTextLength ?? 0}_${webAugment ? 'web' : 'nw'}`;
    const { data, fromCache } = await this.cache.getOrFetch(cacheKey, async () => {
      this.logger.info(`PICO analysis: ${paper.pmid} — ${paper.title.slice(0, 60)}…${webAugment ? ' (web-augmented)' : ''}`);

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
          : 'No journal full text and no trial registry are available. USE the WebSearch/WebFetch tools to find the study details from AUTHORITATIVE sources ONLY — the journal\'s official article page, PubMed, PMC, or the publisher. Extract exact numbers (N, effect sizes, CIs, p-values, outcome definitions) that the abstract omits ONLY from those authoritative pages. List every page you actually used in "webSources". If, after searching, you still cannot find a value, use the abstract only and do NOT invent, infer, or import numbers from other studies.')}
2. PICO fields must include specific numbers (sample sizes, ages, percentages, date ranges, cutoffs, effect sizes, p-values, confidence intervals). Use ONLY values explicitly present in the abstract, the provided full text, or the provided authoritative registry — NEVER infer, compute, or import numbers from memory or other studies. Prioritize full text > registry > abstract when sources differ.
3. Provide Korean translations for ALL text fields (_ko suffix). Medical terms, drug names, score names (e.g., SOFA, AUROC, PELOD-2), and statistics must remain in English within Korean text — translate only the surrounding prose.
4. Report ONLY values explicitly stated in the paper. NEVER derive, compute, or estimate new statistics yourself (e.g., do not calculate NNT or absolute risk differences unless the paper reports them). If a value is not reported, omit it rather than guessing.
5. For the English PICO fields (population/intervention/comparison/outcome), preserve the original wording of the source text as closely as possible — write them as near-verbatim excerpts, not free paraphrases.
6. statGlossary: for every statistical term that appears in your outcome/secondaryOutcomes text (e.g., OR, HR, 95% CI, p-value, AUROC, mRS), add one entry with a single-sentence plain-Korean explanation a junior clinician could understand. Do not include terms that do not appear.
7. practiceChange: 2–3 concrete, actionable bullets describing how this evidence should (or should not) change EM/CCM practice.
8. title_ko: a natural, concise Korean translation of the paper title (drug/score/trial names may stay in English).`;

      return await this._callLLM(
        [{ role: 'user', content: prompt }],
        this._picoTool,
        this.picoLlm,
        { webSearch: webAugment }
      );
    });

    if (fromCache) this.logger.debug(`PICO from cache: ${paper.pmid}`);
    const webSources = Array.isArray(data.webSources)
      ? data.webSources.filter((s) => s?.url && /^https?:\/\//i.test(String(s.url).trim()))
      : [];
    return { ...data, paper, ...this._provenance(paper, { webAugment, webSources }) };
  }

  // ── 근거 출처 배지 + 참조 링크 ───────────────────────────────────────────────
  _provenance(paper, { webAugment = false, webSources = [] } = {}) {
    let badge = {
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

    // 본문·레지스트리가 없어 웹검색으로 보강했고 실제 권위 출처를 사용한 경우.
    // http/https URL 만 수용 (javascript: 등 주입 차단, 상위 필터와 이중 방어).
    const validWeb = webAugment
      ? webSources.filter((s) => s?.url && /^https?:\/\//i.test(String(s.url).trim()))
      : [];
    if (validWeb.length) {
      if (badge === '초록만') badge = '초록 + 웹보강';
      for (const s of validWeb) sources.push({ label: `웹 — ${s.label ?? s.url}`, url: String(s.url).trim() });
    }

    return { evidenceSource: badge, sources };
  }

  // 성공 경로와 동일한 필드 계약 유지 (_ko 필드·출처 포함) — 렌더러가 빈 섹션 대신
  // 정직한 안내를 표시하고, 카카오 메시지도 한국어 제목 부재를 명시적으로 처리한다
  _fallbackPico(paper) {
    return {
      pmid: paper.pmid,
      paper,
      title_ko: '',
      clinicalQuestion: 'Analysis unavailable — see abstract',
      clinicalQuestion_ko: '자동 분석 실패 — 원문 초록을 확인하세요',
      pico: {
        population: 'Not analyzed',
        intervention: 'Not analyzed',
        comparison: 'Not analyzed',
        outcome: 'Not analyzed',
      },
      pico_ko: {},
      baseline: 'Not reported',
      secondaryOutcomes: [],
      secondaryOutcomes_ko: [],
      statGlossary: [],
      keyFindings: ['Analysis failed — refer to original abstract'],
      keyFindings_ko: ['자동 분석 실패 — 원문 초록 참조'],
      clinicalTakeaway: 'Manual review required',
      clinicalTakeaway_ko: '수동 검토 필요',
      limitations: 'Automated analysis failed',
      limitations_ko: '자동 분석 실패',
      practiceChange: [],
      practiceChange_ko: [],
      evidenceLevel: 'Very Low',
      clinicalApplicabilityScore: paper.scoringData?.score ?? 0,
      analysisError: true,
      ...this._provenance(paper),
    };
  }

  // ── Scoring + selection only (no PICO) — used when full-text enrichment follows ──
  async runScoringOnly(papers, excludePmids = []) {
    this.logger.section('FilterAnalyzerAgent — Scoring & Selection (no PICO yet)');
    if (!papers.length) return { topPapers: [], allScoredPapers: [] };

    const scores = await this.scorePapers(papers);
    // 결정적으로 pool(rerank 시 K편, 아니면 top-N)을 추린 뒤, 켜져 있으면 LLM 재순위.
    const poolSize = this.enableRerank ? Math.max(this.topN, this.rerankPool) : this.topN;
    const pool = this._selectTopPapers(papers, scores, excludePmids, poolSize);
    const { picks: topPapers, telemetry } = this.enableRerank
      ? await this._rerankSelect(pool, this.topN)
      : { picks: pool, telemetry: { llmCalled: false, applied: false, reason: 'disabled' } };

    telemetry.poolSize = pool.length;
    // 실행 증거 — 플래그가 아니라 "무슨 일이 실제로 있었나"를 남긴다.
    this.logger.info('rerank telemetry', {
      rerank_requested: this.enableRerank,
      rerank_pool_size: pool.length,
      rerank_llm_called: telemetry.llmCalled,
      rerank_applied: telemetry.applied,
      fallback_reason: telemetry.reason,
    });

    const scoreMap = new Map(scores.map((s) => [s.pmid, s]));
    const allScoredPapers = papers.map((p) => ({
      ...p,
      scoringData: scoreMap.get(p.pmid) ?? { score: 0, studyType: 'Other' },
    }));

    // ★ 문구는 `telemetry.applied` 에서만 나온다 — 플래그로 찍으면 안 돈 날도 돌았다고 적힌다.
    this.logger.info(`Selected top ${topPapers.length} papers${telemetry.applied ? ' (LLM reranked)' : ''} for full-text enrichment`);
    return { topPapers, allScoredPapers, rerank: telemetry };
  }

  // ── 통합 경로 (스코어링→선정→PICO 일괄) — standalone 테스트 전용 ─────────────
  // 운영(오케스트레이터)은 본문 확보를 중간에 끼우려고 runScoringOnly + analyzePico
  // 를 분리 호출한다. 이 run() 은 파일 하단 standalone 테스트에서만 쓰인다.
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
