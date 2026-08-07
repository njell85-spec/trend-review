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
import { createHash } from 'crypto';
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';
import { LLMClient, PROVIDER_DEFAULTS, ANTHROPIC_ANALYSIS_MODEL } from '../utils/LLMClient.js';
import { MetadataScorer } from '../utils/MetadataScorer.js';

export class GuidelineAnalyzerAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? ANTHROPIC_ANALYSIS_MODEL : PROVIDER_DEFAULTS[this.provider]);

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

  /**
   * 툴 스키마. `mode`:
   *   'guideline'  — 가이드라인 캐치업 브리프 (기본값. 데일리 코어가 쓰는 경로 — 건드리지 말 것)
   *   'reference'  — PeterJ 가 직접 고른 범용 참고자료 요약 (on-demand `kind=reference`)
   *
   * 두 모드가 갈리는 지점은 둘뿐이다: 가이드라인은 `keyChanges`(이전 판 대비 변경점)를 요구하고,
   * 참고자료는 `sourceNote_ko`(출처 성격·근거 수준·한계)를 요구한다. 참고자료는 공인되지 않은
   * 출처일 수 있다는 것이 이 모드의 전제이므로, 출처 성격을 카드가 말하지 않으면 안 된다.
   */
  _tool(mode = 'guideline') {
    if (mode === 'reference') return this._referenceTool();
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

  /** 범용 참고자료 툴 — 가이드라인의 `keyChanges` 자리를 `sourceNote_ko` 가 대신한다. */
  _referenceTool() {
    return {
      name: 'submit_reference_brief',
      description: 'Submit a structured brief for a user-selected clinical reference (bilingual EN + KO)',
      input_schema: {
        type: 'object',
        properties: {
          pmid: { type: 'string' },
          org: { type: 'string', description: 'Who produced this — society, institution, journal, publisher, or site operator. Infer from the document/host; use "NR" if unclear.' },
          version: { type: 'string', description: 'Publication or last-updated date/version as stated by the source, e.g. "2026-03" or "3rd edition". Use "NR" if the source states none — do NOT guess.' },
          title_ko: { type: 'string', description: 'Korean title of the reference.' },
          scope_ko: { type: 'string', description: '이 자료가 무엇이고 누가 만든 것인지, 무엇을 다루는지 1–2문장 한국어로.' },
          summary: { type: 'array', items: { type: 'string' }, description: 'KEY content as SPECIFIC, self-contained bullets (English) — the actual substance a clinician would want (numbers, doses, thresholds, algorithms). 4–8 bullets. Use ONLY what the source actually says.' },
          summary_ko: { type: 'array', items: { type: 'string' }, description: 'Korean translations of summary (same order). Drug/score names may stay in English.' },
          sourceNote_ko: {
            type: 'string',
            description: '★ 출처의 성격과 한계를 한국어 2–4문장으로 정직하게. 반드시 다룰 것: ① 동료심사를 거친 문헌인가, 학회 공식 문서인가, 아니면 기관·개인의 웹 문서인가 ② 1차 자료인가 2차 해설인가 ③ 권고의 근거가 인용으로 뒷받침되는가 ④ 언제 기준인가(갱신 시점 불명이면 불명이라고) ⑤ 발행 주체에 상업적·이해관계가 보이면 명시. **확인되지 않는 것은 "확인되지 않음"이라고 적어라 — 절대 추정으로 권위를 부여하지 마라.**',
          },
          practiceImpact: { type: 'string', description: 'How a clinician should (and should not) use this in practice, given its source quality (2–4 sentences, English).' },
          practiceImpact_ko: { type: 'string', description: 'Korean translation of practiceImpact.' },
          webSources: {
            type: 'array',
            description: 'Web pages you consulted via WebSearch/WebFetch. Each {label, url}. Empty array if you did not use web search.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
          },
        },
        required: ['pmid', 'org', 'version', 'title_ko', 'scope_ko', 'summary', 'summary_ko', 'sourceNote_ko', 'practiceImpact', 'practiceImpact_ko'],
      },
    };
  }

  /**
   * 캐시키. **mode 를 포함해야 한다** — 같은 URL 을 guideline 으로 한 번, reference 로 한 번
   * 돌리면 mode 없는 키에서는 먼저 돌린 쪽 결과가 그대로 재사용된다.
   * PubMed 미등재(웹 출처)는 pmid 가 빈 문자열이라 sourceId 로 폴백한다.
   */
  _cacheKey(doc, mode = 'guideline') {
    const id = doc.pmid || doc.sourceId || doc.sourceUrl;
    // 사용자가 본문을 얹은 경우 본문 지문을 키에 넣는다 — 안 넣으면 같은 PMID 를 초록만으로
    // 한 번 돌린 뒤 본문을 넣어 다시 돌려도 **얇은 첫 결과가 그대로 재사용**된다.
    // (본문 없는 기존 경로는 접미사가 붙지 않아 키가 종전과 완전히 동일 — 데일리 코어 무영향)
    const supplied = doc.fullTextSource === 'user-supplied' && doc.fullText
      ? `_ut${createHash('sha256').update(doc.fullText).digest('hex').slice(0, 12)}`
      : '';
    return `${mode}_v5_${this.provider}_${this.model}_${id}${supplied}`;
  }

  /** 분석 프롬프트. 모드에 따라 요구 산출물이 갈린다. */
  _prompt(doc, mode = 'guideline') {
    const hasFullText = doc.fullText && doc.fullText.length > 100;
    const fullTextSection = hasFullText
      ? `\n\n--- FULL TEXT (source: ${doc.fullTextSource}, truncated) ---\n${doc.fullText}\n---`
      : '';
    const augmentSection = doc.augmentText
      ? `\n\n--- AUTHORITATIVE SOURCE (trustworthy structured/registry) ---\n${doc.augmentText}\n---`
      : '';
    const meta = `Title: ${doc.title}
Authors: ${(doc.authors ?? []).join(', ')}
Journal: ${doc.journal} (${doc.pubDate})
MeSH: ${(doc.meshTerms ?? []).join(', ')}`;

    if (mode === 'reference') {
      return `You are an expert emergency medicine and critical care physician summarising a clinical reference for a busy colleague.

IMPORTANT — this document was **chosen by the user, not by a curation process. It may not be authoritative**: it can be a society page, an institutional protocol, a publisher's summary, a blog, or vendor material. Your job is BOTH to convey its content AND to tell the reader honestly what kind of source it is, so they can weigh it themselves.

This is NOT a clinical practice guideline brief and NOT a primary study — do NOT force a PICO structure and do NOT report "changes versus the previous version". Produce:
  1. scope_ko — 이 자료가 무엇이고 누가 만든 것인지, 무엇을 다루는지.
  2. summary — the actual substance: numbers, doses, thresholds, algorithms. Only what the source says.
  3. sourceNote_ko — ★ 출처의 성격과 한계. peer-reviewed 문헌인지, 학회 공식 문서인지, 기관·개인 웹 문서인지. 1차 자료인지 2차 해설인지. 근거가 인용으로 뒷받침되는지. 언제 기준인지. 이해관계가 보이는지. **확인되지 않는 것은 "확인되지 않음"이라고 적어라.**
  4. practiceImpact — 이 자료를 임상에서 어떻게 쓰고, 어디까지만 믿어야 하는지.

Reference:
${meta}${doc.sourceUrl ? `
Source URL (user-supplied — read it directly): ${doc.sourceUrl}
→ Read this URL with WebFetch/WebSearch to extract the actual content, and to judge what kind of source it is (publisher, peer review status, citations, last update).` : ''}

Abstract / summary text:
${doc.abstract}${fullTextSection}${augmentSection}

Use the submit_reference_brief tool. Report ONLY what you can source — never invent content, and never grant the source authority it has not demonstrated. If you cannot verify something, say so in sourceNote_ko.

Provide Korean for all _ko fields; medical/drug/score names may remain in English.`;
    }

    return `You are an expert emergency medicine and critical care physician writing a DETAILED GUIDELINE CATCH-UP brief for a busy clinician who wants to know EXACTLY what to change in practice.

This is a clinical practice guideline (not a primary study) — do NOT force a PICO structure. Produce:
  1. scope_ko — 무엇을(어떤 환자군을) 다루는 가이드라인인지.
  2. summary — the key recommendations, each a SPECIFIC actionable statement with class/level of evidence when stated.
  3. keyChanges — for EACH important change versus the previous version, describe SPECIFICALLY what changed: 이전 권고 → 새 권고, 바뀐 수치/용량/시간 기준, 새 근거등급, 그리고 이유. Describe the actual CONTENT of the changes — NEVER vague counts like "20 recommendations were added". Include as many concrete changes as the source supports.
  4. practiceImpact — concrete bedside impact for EM/CCM.

Guideline:
${meta}${doc.sourceUrl ? `
Source URL (issuing organization's own publication — this document is NOT in PubMed): ${doc.sourceUrl}
→ Read this URL (and the issuing society's "What's New"/summary pages) with WebFetch/WebSearch to extract the actual recommendations and changes.` : ''}

Abstract / summary text:
${doc.abstract}${fullTextSection}${augmentSection}

Use the submit_guideline_catchup tool. Report ONLY facts you can source — never invent recommendations or changes.

RESEARCH: If the provided text does NOT describe the specific CONTENT of what changed (e.g. it only gives aggregate counts like "20 new, 13 updated"), USE WebSearch/WebFetch to find the actual changes from AUTHORITATIVE sources — the issuing society's "What's New"/executive summary, the journal article, guideline repositories, or PubMed. Extract the specific changed recommendations (이전→이후, 수치/용량/시간/등급, 이유). List every authoritative page you used in "webSources". If, after searching, you still cannot find the specific content, return an empty "keyChanges" array rather than restating counts.

Provide Korean for all _ko fields; medical/drug/score names may remain in English. Be thorough — allocate as much detail as the sources support.`;
  }

  /**
   * @param doc  가이드라인/참고자료 문서(PubMed 메타 또는 externalGuideline 합성 객체)
   * @param mode 'guideline'(기본 — 데일리 코어가 쓰는 경로) | 'reference'(on-demand 범용 참고자료)
   */
  async analyze(doc, { mode = 'guideline' } = {}) {
    if (!doc) return null;
    const cacheKey = this._cacheKey(doc, mode);
    try {
      const { data } = await this.cache.getOrFetch(cacheKey, async () => {
        this.logger.info(`${mode} analysis: ${doc.pmid || doc.sourceId} — ${doc.title?.slice(0, 60)}…`);
        const prompt = this._prompt(doc, mode);
        const tool = this._tool(mode);

        // 웹검색 보강 우선; 헤드리스에서 웹툴이 불가/실패하면 텍스트-only 로 폴백(정직 안내로 귀결).
        const call = (webSearch) => this.cb.execute(() =>
          this.retry.execute(
            () => this.llm.callWithTool([{ role: 'user', content: prompt }], tool, { maxTokens: 12000, webSearch }),
            { label: `${this.provider}-${mode}${webSearch ? '-web' : ''}` }));
        let result;
        try {
          result = await call(true);
        } catch (e) {
          this.logger.warn(`${mode} web-search call failed — falling back to text-only: ${e.message}`);
          result = await call(false);
        }
        return result;
      });

      return this._toCard(doc, data, mode);
    } catch (err) {
      // 분석 실패/거부 → null. 오케스트레이터가 조용히 건너뛴다(카드 미표시).
      this.logger.warn(`${mode} analysis failed — skipping this cycle`, { err: err.message });
      return null;
    }
  }

  _toCard(guideline, data, mode = 'guideline') {
    const sources = [];
    const pmUrl = guideline.pubmedUrl ?? (guideline.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${guideline.pmid}/` : null);
    if (pmUrl) sources.push({ label: `PubMed — PMID ${guideline.pmid}`, url: pmUrl });
    // 발행기관 공개본(PubMed 미등재) — 원문이 유일한 1차 출처이므로 맨 앞줄급으로 넣는다.
    if (guideline.sourceUrl) sources.push({ label: '원문 — 발행기관 공개 문서', url: guideline.sourceUrl });
    if (guideline.doi && guideline.doi.length > 3) sources.push({ label: `Journal (DOI) — ${guideline.doi}`, url: `https://doi.org/${guideline.doi}` });
    if (guideline.oaUrl) sources.push({ label: 'Open-access full text', url: guideline.oaUrl });
    for (const s of guideline.augmentSources ?? []) sources.push(s);
    // Opus 가 웹검색으로 실제 사용한 권위 출처 (http/https 링크만 수용 — javascript: 등 주입 차단)
    for (const s of data.webSources ?? []) {
      if (s?.url && /^https?:\/\//i.test(String(s.url).trim())) {
        sources.push({ label: `웹 — ${s.label ?? s.url}`, url: String(s.url).trim() });
      }
    }

    const keyChanges = Array.isArray(data.keyChanges) ? data.keyChanges : [];
    // 참고자료는 "이전 판 대비 변경점" 축이 없다 — 대신 출처 성격을 싣는다.
    const modeFields = mode === 'reference'
      ? { sourceNote_ko: data.sourceNote_ko ?? '' }
      : { keyChanges, changesUnavailable: keyChanges.length === 0 };
    return {
      type: mode === 'reference' ? 'reference' : 'guideline',
      paper: {
        pmid: guideline.pmid, title: guideline.title, journal: guideline.journal,
        pubDate: guideline.pubDate, pubmedUrl: pmUrl, doi: guideline.doi,
        // 웹 출처 가이드라인 식별자 — 카드/표 링크와 중복 제거가 PMID 대신 이걸 쓴다.
        sourceUrl: guideline.sourceUrl, sourceId: guideline.sourceId,
      },
      org: data.org, version: data.version, title_ko: data.title_ko,
      scope_ko: data.scope_ko ?? '',
      summary: data.summary ?? [], summary_ko: data.summary_ko ?? [],
      // guideline: keyChanges + changesUnavailable(세부 변경점을 못 얻은 경우 카드에서 정직 안내)
      // reference: sourceNote_ko(출처 성격·한계)
      ...modeFields,
      fullTextSource: guideline.fullTextSource ?? 'abstract-only',
      practiceImpact: data.practiceImpact, practiceImpact_ko: data.practiceImpact_ko,
      sources,
      scoringData: guideline.scoringData,
    };
  }
}
