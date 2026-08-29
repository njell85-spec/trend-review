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
import { isTrustedSourceUrl } from '../utils/sourceTrust.js';

/**
 * ★ 트랙3(리뷰) 실질 게이트 임계 — sections 본문(한국어) 글자수 합이 이 미만이고
 * coverage 가 full-text 가 아니면 "초록 치환"으로 보고 에스컬레이션 프롬프트로 1회 재시도한다.
 *
 * 근거(실측): 2026-08-18 데일리에서 Lancet Seminar "Sepsis"(PMID 41765030)가 초록만
 * 6개 절로 쪼개져 본문 합 1,119자로 발행됐다 — 이것이 "얇다"의 실례다. 초록을 한국어로
 * 옮기면 대개 600~1,500자 대에 머무르고, 웹에서 본문·공개 요약·2차 출처를 실제로 보강한
 * 카드는 수천 자 이상이 나온다. 실측치의 약 2.7배인 3,000자를 하한으로 잡으면 초록 치환은
 * 확실히 걸리고, 정상 보강 카드를 얇다고 오판해 불필요한 이중 호출을 내는 일은 드물다.
 * (재시도는 어차피 1회뿐이라 오판 비용도 호출 1번이다 — 데일리 코어 무영향.)
 */
export const REVIEW_THIN_BODY_CHARS = 3000;

export class GuidelineAnalyzerAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? ANTHROPIC_ANALYSIS_MODEL : PROVIDER_DEFAULTS[this.provider]);

    this.logger = new Logger('GuidelineAnalyzer', { logFile: 'guideline_analyzer.jsonl' });
    this.cache = options.cache ?? new Cache();
    this.cb = new CircuitBreaker(`${this.provider}-guideline`, { failureThreshold: 3 });
    this.retry = new RetryHelper({ maxAttempts: 2, baseDelayMs: 3_000 });
    this.llm = options.llm ?? new LLMClient({ provider: this.provider, model: this.model });
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
  _tool(mode = 'guideline', doc = null) {
    if (mode === 'reference') return this._referenceTool();
    if (mode === 'review') return this._reviewTool();
    if (mode === 'synthesis') {
      return this._synthesisTool((doc?.docs ?? []).map((d) => String(d.refId)).filter(Boolean));
    }
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
          augmentedSections: {
            type: 'array',
            description: "Web-augmentation axis (PeterJ 확정 2026-08-18), SEPARATE from the guideline's own text and SEPARATE from keyChanges: worthwhile SECONDARY-SOURCE material about THIS guideline that you found via the MANDATORY title searches — official society summaries, journal editorials/comments, practice summaries in major journals, established clinical references. NEVER put the guideline's own recommendations here, NEVER mix this material into summary/keyChanges, and NEVER include personal blogs, content-farm summary sites, or AI-generated pages. Every item MUST carry the exact page you actually opened (sourceLabel + sourceUrl) — items without a real http(s) URL are discarded before publication. Empty array if the searches yielded nothing usable (say so honestly — never fabricate).",
            items: {
              type: 'object',
              properties: {
                heading_ko: { type: 'string', description: '보강 항목 제목(한국어) — 이 2차 자료가 다루는 논점.' },
                body_ko: { type: 'string', description: '그 2차 자료가 말한 내용을 한국어로 충실히. 이 가이드라인 원문이 말한 것과 절대 섞지 마라 — 섞이면 "지침이 이렇게 말했다"로 잘못 읽힌다.' },
                sourceLabel: { type: 'string', description: "출처 이름 (예: 'ESICM 공식 요약', 'JAMA editorial')." },
                sourceUrl: { type: 'string', description: '실제로 열어 읽은 페이지의 URL. 실제 URL 이 없으면 이 항목을 제출하지 마라 (출처 없는 보강은 버려진다).' },
              },
              required: ['heading_ko', 'body_ko', 'sourceLabel', 'sourceUrl'],
            },
          },
          webSources: {
            type: 'array',
            description: 'Every web page you ACTUALLY OPENED AND READ via WebSearch/WebFetch while running the MANDATORY searches — never a page you merely assume exists. Prefer the issuing society, the journal, or PubMed. Each {label, url}. Empty array ONLY if the searches genuinely failed or returned nothing usable.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
          },
        },
        required: ['pmid', 'org', 'version', 'title_ko', 'scope_ko', 'summary', 'summary_ko', 'keyChanges', 'augmentedSections', 'practiceImpact', 'practiceImpact_ko'],
      },
    };
  }

  /**
   * 종합 툴 — 관련 문헌 2~5건을 한 장으로 대조한다 (PeterJ 요구 2026-08-29).
   *
   * ★ **문헌의 정체(제목·PMID·기관)는 LLM 이 쓰지 않는다.** 파이프라인이 넘겨주고 모델은
   *   `refId`(D1…D5)로만 지칭한다. refId 는 그 실행의 실제 목록으로 **enum 고정**한다.
   *   이 카드의 제1 실패가 오귀속("ESC 가 이렇게 말했다"가 실은 합의문 내용)인데,
   *   프롬프트로 막는 것보다 스키마로 막는 것이 세다 — 해적판 출처를 허용목록으로
   *   막은 것과 같은 판단이다(sourceTrust.js).
   *
   * ★ "해당 없음"이 없다. 어떤 축에 안 나오는 문헌은 그 축의 `positions` 어디에도
   *   안 실리면 그만이다 — 결정경로가 '정의' 축에 빠져도 빈칸을 강요받지 않는다.
   */
  _synthesisTool(refIds = []) {
    const refSchema = refIds.length
      ? { type: 'string', enum: refIds }
      : { type: 'string', description: 'refId of one of the provided documents (D1, D2, …).' };
    return {
      name: 'submit_synthesis_brief',
      description: 'Submit a structured multi-document synthesis/comparison brief (bilingual EN + KO)',
      input_schema: {
        type: 'object',
        properties: {
          title_ko: { type: 'string', description: '종합 카드 제목(한국어). 무엇을 묶었고 무엇이 쟁점인지 드러나게.' },
          version: { type: 'string', description: '이 묶음을 대표하는 연도/판 (예: "2026").' },
          scope_ko: { type: 'string', description: '이 문헌들을 왜 지금 한 장으로 묶는지 1–2문장(공통 주제 + 시기).' },
          documents: {
            type: 'array',
            description: 'One entry per provided document, SAME refIds you were given. Do NOT invent documents and do NOT restate their titles/PMIDs — the pipeline supplies those.',
            items: {
              type: 'object',
              properties: {
                refId: refSchema,
                docType: { type: 'string', enum: ['guideline', 'consensus', 'pathway', 'statement', 'other'], description: 'What KIND of document this is — a formal practice guideline carries different weight from a consensus statement or a decision pathway.' },
                docTypeNote_ko: { type: 'string', description: '이 문서의 성격과 권위 무게를 1문장 한국어로 (정식 지침인지·합의문인지·실무 경로인지).' },
                role_ko: { type: 'string', description: '이 묶음에서 이 문서가 맡는 몫을 1문장 한국어로.' },
                shortLabel_ko: { type: 'string', description: '칩 라벨 12자 이내 (예: "ESC 2026", "ACC 경로").' },
                isBaseline: { type: 'boolean', description: 'true only for an older document included as the comparison baseline, not as part of the new wave.' },
              },
              required: ['refId', 'docType', 'docTypeNote_ko', 'role_ko', 'shortLabel_ko'],
            },
          },
          commonGround: {
            type: 'array',
            description: 'What the NEW documents (excluding any isBaseline document) actually agree on. 2–6 items, each a specific clinical statement — never a vague "both emphasise prevention".',
            items: {
              type: 'object',
              properties: {
                point: { type: 'string', description: 'The agreed point, English, specific and self-contained.' },
                point_ko: { type: 'string', description: 'Korean translation with the same specificity.' },
              },
              required: ['point', 'point_ko'],
            },
          },
          comparisons: {
            type: 'array',
            description: 'The axes where the documents actually DIVERGE — real decision points (definitions, thresholds, drug positioning, recommendation classes), never a per-document summary restated side by side. 3–6 axes. Documents holding the SAME position must be grouped into ONE position entry.',
            items: {
              type: 'object',
              properties: {
                axis_ko: { type: 'string', description: '쟁점 축 이름(한국어). 예: "LVEF 표현형 분류", "HFpEF 진단 도구".' },
                positions: {
                  type: 'array',
                  description: 'Distinct positions on this axis. Group documents that say the same thing. A document that does not address this axis simply does not appear.',
                  items: {
                    type: 'object',
                    properties: {
                      refIds: { type: 'array', items: refSchema, description: 'Documents holding THIS position. At least one.' },
                      detail: { type: 'string', description: 'What these documents say on this axis, English, with numbers/thresholds/classes.' },
                      detail_ko: { type: 'string', description: 'Korean translation with the same specificity.' },
                    },
                    required: ['refIds', 'detail', 'detail_ko'],
                  },
                },
                divergenceNote_ko: { type: 'string', description: '왜 갈리는지 — 문헌 자신이 밝힌 이유만. 추측이면 넣지 마라.' },
              },
              required: ['axis_ko', 'positions'],
            },
          },
          gapNotes_ko: {
            type: 'array',
            items: { type: 'string' },
            description: '이 묶음이 해결하지 못한 것·읽는 사람이 주의할 것 (0–4개). 문헌들이 말한 범위 안에서만.',
          },
          practiceImpact: { type: 'string', description: 'Concrete bedside impact for EM/CCM, INCLUDING what to follow when the documents diverge (2–4 sentences, English).' },
          practiceImpact_ko: { type: 'string', description: 'Korean translation of practiceImpact.' },
          augmentedSections: {
            type: 'array',
            description: "Web-augmentation axis, SEPARATE from what the documents themselves say: secondary-source material about THIS group of documents (editorials comparing them, society summaries). Every item MUST carry sourceLabel + sourceUrl of a page you actually opened. Empty array if nothing usable.",
            items: {
              type: 'object',
              properties: {
                heading_ko: { type: 'string' },
                body_ko: { type: 'string' },
                sourceLabel: { type: 'string' },
                sourceUrl: { type: 'string' },
              },
              required: ['heading_ko', 'body_ko', 'sourceLabel', 'sourceUrl'],
            },
          },
          webSources: {
            type: 'array',
            description: 'Every web page you ACTUALLY OPENED AND READ. Each {label, url}.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
          },
        },
        required: ['title_ko', 'version', 'scope_ko', 'documents', 'commonGround', 'comparisons', 'practiceImpact', 'practiceImpact_ko', 'augmentedSections'],
      },
    };
  }

  /** 범용 참고자료 툴 — 가이드라인의 `keyChanges` 자리를 `sourceNote_ko` 가 대신한다. */
  /**
   * 트랙3(리뷰 아티클) 전용 — **요약이 아니라 번역**이다 (PeterJ 확정 2026-08-17).
   *
   * *"리뷰는 있는그대로 번역 제시. 원문 확보 어려우면 웹서칭통해서라도."*
   *
   * ★ 가이드라인·참고자료 도구와 무엇이 다른가
   *   · `summary`(4~8 불릿 요약)를 안 쓴다 — 요약하면 원문이 사라진다. 대신 원문의
   *     절 구조를 그대로 따라가는 `sections` 를 받는다.
   *   · `keyChanges`(이전 판 대비)가 없다 — 종설은 판본 개정 문서가 아니다.
   *   · `sourceNote_ko`(출처 신뢰도 평가)가 없다 — NEJM·Lancet·ICM 급 종설이라
   *     출처는 이미 확실하다. 그 칸은 PeterJ 가 직접 고른 자료(reference)에만 필요하다.
   *   · `coverage` 로 **무엇을 보고 번역했는지 정직하게** 남긴다. 초록만 보고 번역해 놓고
   *     전문을 옮긴 척하면 안 된다.
   */
  _reviewTool() {
    return {
      name: 'submit_review_translation',
      description: 'Submit a faithful Korean rendering of a review article, section by section.',
      input_schema: {
        type: 'object',
        properties: {
          pmid: { type: 'string' },
          title_ko: { type: 'string', description: '리뷰 제목의 한국어 번역.' },
          scope_ko: { type: 'string', description: '이 종설이 무엇을 다루는지 1–2문장 한국어로.' },
          coverage: {
            type: 'string',
            enum: ['full-text', 'web-augmented', 'abstract-only'],
            description: 'What you actually rendered from. full-text = the provided full text. web-augmented = you fetched the article content from the web because full text was unavailable. abstract-only = you could only reach the abstract. NEVER claim full-text if you did not have it.',
          },
          sections: {
            type: 'array',
            description: "The article rendered in Korean, FOLLOWING THE SOURCE'S OWN SECTION ORDER. This is a translation, not a summary: keep the author's claims, numbers, doses, thresholds, caveats and hedging. Do not compress several sections into one. 4–12 sections depending on the article. If you could not obtain the article body, article-derived sections (origin 'article') and clearly-marked supplementary sections (origin 'augmented', with sources) may coexist — NEVER mixed inside one section.",
            items: {
              type: 'object',
              properties: {
                heading_ko: { type: 'string', description: "절 제목(한국어). 원문 소제목을 그대로 옮긴다. 원문에 소제목이 없으면 그 문단이 다루는 바를 짧게 붙인다." },
                body_ko: { type: 'string', description: '그 절의 내용을 한국어로 **충실히** 옮긴 것. 요약하지 말고, 저자가 말한 수치·용량·역치·근거등급·단서를 그대로 살려라. 약물명·점수명·약어는 영어로 두어도 된다. 여러 문단이면 줄바꿈으로 나눠라.' },
                origin: { type: 'string', enum: ['article', 'augmented'], description: "이 절의 내용이 어디서 왔는가. 'article'(기본) = 이 논문 자체(제공된 전문·웹에서 확보한 본문·초록)가 말한 내용만. 'augmented' = 원문을 못 구해 권위 있는 2차 출처(학회 성명·저널 editorial/comment·공개 요약)에서 보강한 내용 — 반드시 sourceLabel·sourceUrl 을 채워라. 두 성격을 한 절에 절대 섞지 마라." },
                sourceLabel: { type: 'string', description: "origin='augmented' 전용 — 보강 출처의 이름 (예: 'ESICM statement', 'NEJM editorial')." },
                sourceUrl: { type: 'string', description: "origin='augmented' 전용 — 실제로 열어 읽은 페이지의 URL. 실제 URL 이 없으면 그 절을 제출하지 마라 (출처 없는 보강은 버려진다)." },
              },
              required: ['heading_ko', 'body_ko'],
            },
          },
          practiceImpact_ko: { type: 'string', description: '이 종설을 읽고 EM/CCM 침상에서 무엇이 달라지는지 2–3문장 한국어. 원문이 말한 범위 안에서만 쓴다.' },
          webSources: {
            type: 'array',
            description: 'Pages you ACTUALLY OPENED AND READ via WebSearch/WebFetch while running the MANDATORY searches and working the search ladder (only those — never a page you merely assume exists). Each {label, url}. Empty array ONLY if the searches genuinely failed or returned nothing usable.',
            items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] },
          },
        },
        required: ['pmid', 'title_ko', 'scope_ko', 'coverage', 'sections'],
      },
    };
  }

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

  /**
   * ★ 필수 웹검색 블록 (PeterJ 확정 2026-08-18) — 검색어는 **문서 제목 그대로**.
   *
   * 실측(2026-08-18 · Actions run 32089367959): 리뷰 보강이 실전에서 한 번도 안 돌았다 —
   * webSources 0건, 보강 절 0개. 원인은 LLMClient 프롬프트 꼬리의 "You MAY first use
   * WebSearch…" 였다. MAY 라서 모델이 안 해도 되는 것으로 읽었다. LLMClient 는 논문
   * PICO·rerank 도 같이 쓰므로 못 고친다 — 그래서 여기 프롬프트 본문에서 **must** 로
   * 강제하고, 실제로 칠 검색어를 제목에서 만들어 리터럴로 박는다.
   */
  _mandatorySearchBlock(doc, mode = 'review') {
    // 제목 안의 큰따옴표는 검색어 리터럴을 깨므로 작은따옴표로 바꾼다.
    const title = String(doc?.title ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    const queries = [
      `  WebSearch: "${title}"`,
      `  WebSearch: "${title}" key points`,
      `  WebSearch: "${title}" summary`,
      ...(mode === 'guideline'
        ? [`  WebSearch: "${title}" what's new`, `  WebSearch: "${title}" executive summary`]
        : []),
    ];
    return `★★ MANDATORY WEB RESEARCH — THIS IS NOT OPTIONAL.
Any general instruction elsewhere saying you "may" use web tools does NOT apply here.
You MUST run at least these searches before answering, and open the most authoritative
hits with WebFetch:
${queries.join('\n')}
From what the searches return, use ONLY worthwhile SECONDARY sources: official society
summaries/statements, journal editorials/comments, practice summaries in major journals,
established clinical references. EXCLUDE personal blogs, content-farm/summary sites, and
AI-generated pages. Every claim you take from the web must carry the page you actually
opened (label + URL). If the searches fail or return nothing usable, say so honestly —
return empty arrays rather than pretending you searched, and NEVER fabricate content.`;
  }

  /** 분석 프롬프트. 모드에 따라 요구 산출물이 갈린다. `escalate` 는 실질 게이트(③·④) 전용. */
  _prompt(doc, mode = 'guideline', { escalate = false } = {}) {
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

    if (mode === 'review') {
      // ★ 요약이 아니라 **번역**이다 (PeterJ 확정 2026-08-17).
      //   원문을 못 구하면 웹서치로라도 본문을 확보한 뒤 옮긴다. 못 구했으면
      //   `coverage` 에 그대로 적는다 — 초록만 보고 전문을 옮긴 척하면 안 된다.
      const escalatePreamble = escalate ? `★★ ESCALATION — a previous attempt on this article returned an abstract-sized rendering
(sections totalling roughly 1,000 Korean characters). That is exactly the failure this task
exists to prevent. This time, ACTUALLY WALK the search ladder below rung by rung, opening
pages with WebFetch, before you answer. If the article body is truly unreachable, you MUST
still add clearly-marked "augmented" sections (origin "augmented", with sourceLabel and
sourceUrl) from rungs 3–4, so the reader gets substance beyond the abstract.

` : '';
      return `${escalatePreamble}You are translating a medical review article into Korean for an emergency
medicine / critical care physician who wants to read the article itself, not a digest.

★ THIS IS A TRANSLATION TASK, NOT A SUMMARY TASK.
Do NOT compress the article into bullets. Do NOT impose a PICO structure. Do NOT report
"changes versus a previous version" — a review article is not a versioned guideline.
Follow the source's OWN section order and render each section faithfully in Korean,
keeping the author's numbers, doses, thresholds, evidence grades, caveats and hedging.
If the author is uncertain, your Korean must be uncertain in the same way.

${this._mandatorySearchBlock(doc, 'review')}

★ IF YOU DO NOT HAVE THE FULL TEXT: work this SEARCH LADDER IN ORDER with WebSearch/WebFetch
BEFORE settling for the abstract. The user explicitly asked for this. Do not stop because one
page is paywalled — move to the next rung:
  1. DOI landing page / publisher page — the article itself. Lancet/NEJM/ICM pages often
     expose key messages, panels and figure legends even when the PDF is paywalled.
  2. PubMed Central / Europe PMC — a free full-text or author-manuscript copy.
  3. Public companion material for THIS article from the journal or a society: Seminar/Series
     companion or "key points"/summary pages, visual abstracts, journal press releases.
  4. Authoritative secondary sources that DISCUSS THIS ARTICLE: society statements,
     editorials/comments in major journals, established clinical references citing it.
List in webSources ONLY pages you actually opened and read — never a page you merely assume exists.

★ IF THE LADDER STILL DID NOT YIELD THE ARTICLE BODY, do NOT ship a padded abstract:
  · Render what the article itself provides (the abstract) as sections with origin "article".
  · THEN ADD substantive supplementary sections with origin "augmented", built from rung 3–4
    material, each carrying sourceLabel + sourceUrl of a page you actually opened. Stay
    strictly inside the topic scope of THIS article — no generic textbook filler.
  · NEVER blend augmented material into an "article" section. The reader must always be able
    to tell what THIS article said from what came from elsewhere.

Then set coverage honestly — coverage describes the ARTICLE body only; "augmented" sections
NEVER upgrade it:
  · full-text     — you rendered from the full text provided below
  · web-augmented — you fetched the article's own content from the web (rung 1–2)
  · abstract-only — you only reached the article's abstract (even if you added clearly
    marked augmented sections from rung 3–4); say so rather than padding
NEVER claim full-text coverage you did not have, and never invent section content.

Review article:
${meta}${doc.doi ? `
DOI: https://doi.org/${doc.doi}` : ''}${doc.pmid ? `
PubMed: https://pubmed.ncbi.nlm.nih.gov/${doc.pmid}/` : ''}

Abstract:
${doc.abstract}${fullTextSection}${augmentSection}

Use the submit_review_translation tool.
Write every _ko field in natural Korean prose. Drug names, score names, trial acronyms and
abbreviations may stay in English. Keep the register of a clinical journal, not a blog.`;
    }

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

    if (mode === 'synthesis') {
      const docs = Array.isArray(doc.docs) ? doc.docs : [];
      const blocks = docs.map((d) => {
        const body = (d.fullText && d.fullText.length > 100)
          ? `\n--- FULL TEXT (${d.fullTextSource ?? 'n/a'}, truncated) ---\n${d.fullText}\n---`
          : '';
        return `[${d.refId}]${d.isBaseline ? ' (BASELINE — older document, included only for comparison)' : ''}
Title: ${d.title}
Journal: ${d.journal ?? ''} (${d.pubDate ?? ''})${d.pmid ? `
PMID: ${d.pmid}` : ''}${d.sourceUrl ? `
Source URL: ${d.sourceUrl}` : ''}
Abstract / summary text:
${d.abstract ?? '(none)'}${body}`;
      }).join('\n\n========================================\n\n');
      const searchTitles = docs.slice(0, 5).map((d) => `  WebSearch: "${String(d.title ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim()}"`);
      const synEscalate = escalate ? `★★ ESCALATION — a previous attempt produced no real contrast: every axis had all
documents in a single position, which means you summarised instead of comparing. Find the
points where these documents actually DISAGREE (definitions, cut-offs, drug positioning,
recommendation classes) and group documents by position. If, after genuinely checking, the
documents truly agree everywhere, say that in gapNotes_ko rather than inventing a dispute.

` : '';
      return `${synEscalate}You are an expert emergency medicine and critical care physician writing a MULTI-DOCUMENT SYNTHESIS for a busy clinician. Several societies published on the same topic; your job is to say what they agree on and exactly where they diverge.

★★ MANDATORY WEB RESEARCH — THIS IS NOT OPTIONAL.
Any general instruction elsewhere saying you "may" use web tools does NOT apply here.
Run at least these searches and open the most authoritative hits with WebFetch:
${searchTitles.join('\n')}
  WebSearch: "${String(doc.title ?? '').replace(/"/g, "'").trim()}" comparison
Use ONLY worthwhile SECONDARY sources (official society summaries, journal editorials/
comments, practice summaries in major journals). EXCLUDE personal blogs, content-farm
summary sites, AI-generated pages. Every web claim carries the page you actually opened.

★★ ATTRIBUTION IS THE POINT OF THIS CARD.
Refer to documents ONLY by the refIds given below (${docs.map((d) => d.refId).join(', ')}).
NEVER attribute a statement to a document that did not make it — that is the single worst
failure this card can have. If you are unsure which document said something, leave it out.
Do NOT restate the documents' titles, PMIDs or publishers — the pipeline supplies those.

Produce:
  1. scope_ko — 왜 이 문헌들을 지금 한 장으로 묶는지.
  2. documents — one entry per refId: what KIND of document it is and what part it plays here.
  3. commonGround — what the NEW documents genuinely agree on (exclude any BASELINE document).
  4. comparisons — 3–6 axes where they actually DIVERGE. Group documents holding the same
     position into ONE position entry. An axis a document does not address simply omits it.
     ★ Do NOT produce an axis that merely lists each document's summary — that is not a
     comparison. Each axis must name a real decision that differs.
  5. gapNotes_ko — what this group leaves unresolved, or cautions for the reader.
  6. practiceImpact — bedside impact INCLUDING what to follow when they diverge.
  7. augmentedSections — secondary-source material ABOUT this group, kept separate from
     what the documents themselves say. Each needs sourceLabel + sourceUrl actually opened.

Topic: ${doc.title}

Documents:
${blocks}

Use the submit_synthesis_brief tool. Report ONLY what you can source — never invent a
recommendation, a disagreement, or an agreement.

Provide Korean for all _ko fields; medical/drug/score names may remain in English.`;
    }

    const glEscalate = escalate ? `★★ ESCALATION — a previous attempt on this guideline skipped the mandatory web research
entirely (no web sources, no secondary-source augmentation). That is exactly the failure
this task exists to prevent. This time, ACTUALLY RUN every mandatory search below and open
the best hits with WebFetch BEFORE you answer. Only if, after really searching, nothing
usable exists may you return empty augmentedSections/webSources — never skip the searching.

` : '';
    return `${glEscalate}You are an expert emergency medicine and critical care physician writing a DETAILED GUIDELINE CATCH-UP brief for a busy clinician who wants to know EXACTLY what to change in practice.

${this._mandatorySearchBlock(doc, 'guideline')}

This is a clinical practice guideline (not a primary study) — do NOT force a PICO structure. Produce:
  1. scope_ko — 무엇을(어떤 환자군을) 다루는 가이드라인인지.
  2. summary — the key recommendations, each a SPECIFIC actionable statement with class/level of evidence when stated.
  3. keyChanges — for EACH important change versus the previous version, describe SPECIFICALLY what changed: 이전 권고 → 새 권고, 바뀐 수치/용량/시간 기준, 새 근거등급, 그리고 이유. Describe the actual CONTENT of the changes — NEVER vague counts like "20 recommendations were added". Include as many concrete changes as the source supports.
  4. augmentedSections — the WEB AUGMENTATION axis (separate from 2 and 3): worthwhile
     secondary-source material about THIS guideline found via the mandatory searches
     (society official summaries, journal editorials/comments, practice summaries in major
     journals, established clinical references). Each item MUST carry sourceLabel + sourceUrl
     of a page you actually opened — items without a real URL are discarded. NEVER mix this
     material into summary or keyChanges: the reader must always be able to tell what THIS
     guideline said from what came from elsewhere. Empty array if nothing usable was found.
  5. practiceImpact — concrete bedside impact for EM/CCM.

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
      const fetchFresh = async () => {
        this.logger.info(`${mode} analysis: ${doc.pmid || doc.sourceId} — ${doc.title?.slice(0, 60)}…`);
        const tool = this._tool(mode, doc);

        // 웹검색 보강 우선; 헤드리스에서 웹툴이 불가/실패하면 텍스트-only 로 폴백(정직 안내로 귀결).
        const callOnce = async (prompt) => {
          const call = (webSearch) => this.cb.execute(() =>
            this.retry.execute(
              () => this.llm.callWithTool([{ role: 'user', content: prompt }], tool, { maxTokens: 12000, webSearch }),
              { label: `${this.provider}-${mode}${webSearch ? '-web' : ''}` }));
          try {
            return await call(true);
          } catch (e) {
            // ★★ 이 폴백이 **조용해서** 두 달 가까이 웹검색이 한 번도 안 도는 줄 몰랐다
          //   (2026-08-18 실측). 실패해도 카드는 나오므로 화면만 봐서는 안 보인다.
          //   그래서 CLI 가 돌려준 진단(서버 웹툴 호출 횟수·중단 사유)을 **뽑아서 남긴다.**
          //   `web_search_requests: 0` 이면 도구가 아예 안 돈 것이고, `error_max_turns`
          //   면 턴이 모자란 것이다 — 둘은 처방이 다르므로 구분해서 보여야 한다.
          const diag = (() => {
            const m = String(e.message);
            const subtype = m.match(/"subtype":"([^"]+)"/)?.[1] ?? '?';
            const turns = m.match(/"num_turns":(\d+)/)?.[1] ?? '?';
            const ws = m.match(/"web_search_requests":(\d+)/)?.[1] ?? '?';
            const wf = m.match(/"web_fetch_requests":(\d+)/)?.[1] ?? '?';
            return `subtype=${subtype} turns=${turns} web_search=${ws} web_fetch=${wf}`;
          })();
          this.logger.warn(`${mode} web-search call failed — falling back to text-only [${diag}]`);
          this.logger.warn(`${mode} web-search 원문 오류: ${String(e.message).slice(0, 300)}`);
            return await call(false);
          }
        };

        let result = await callOnce(this._prompt(doc, mode));

        // ★ ③④ 실질 게이트(리뷰) — coverage 가 full-text 도 아닌데 **본문이 얇거나 웹을
        //   아예 안 열었으면**(webSources 0건 — 2026-08-18 run 32089367959 실측 증상)
        //   에스컬레이션 프롬프트로 **딱 1회** 더 시도한다. 두 번째도 안 되면 그대로
        //   발행한다 — 나쁜 카드보다 데일리가 늦어지거나 죽는 것이 나쁘다(불변식: 데일리
        //   코어 무영향). 재시도가 더 나쁘면(본문이 안 늘고 게이트도 못 풀면) 첫 결과를 쓴다.
        if (mode === 'review' && this._needsReviewEscalation(result)) {
          this.logger.warn(`review gate: body ${this._reviewBodyChars(result)} chars, webSources ${this._validWebSources(result).length} — escalating once`);
          try {
            const second = await callOnce(this._prompt(doc, mode, { escalate: true }));
            const adoptSecond = this._reviewBodyChars(second) > this._reviewBodyChars(result)
              || (!this._needsReviewEscalation(second) && this._needsReviewEscalation(result));
            if (adoptSecond) result = second;
            else this.logger.warn('review escalation did not improve — keeping first result');
          } catch (e) {
            this.logger.warn(`review escalation failed — keeping first result: ${e.message}`);
          }
        }

        // ★ ④ 실질 게이트(가이드라인) — 보강 축도 비었고 webSources 도 비었으면 필수
        //   검색이 통째로 건너뛰어진 것이다. **딱 1회** 에스컬레이션. 두 번째가 게이트를
        //   못 풀면 첫 결과 그대로 발행한다(불변식: 데일리 코어 무영향 — 여기서 절대
        //   던지지 않는다. callOnce 실패는 아래 catch 가 삼키고 첫 결과를 유지한다).
        // ★ 종합의 실질 게이트: 축이 없거나 **모든 축이 입장 하나뿐**이면 대조가 아니라
        //   요약 재탕이다. 얇은 카드 게이트와 같은 자리, 같은 1회 재시도.
        if (mode === 'synthesis' && result && this._needsSynthesisEscalation(result)) {
          this.logger.warn(`synthesis gate: 축 ${(result.comparisons ?? []).length}개가 전부 단일 입장 — escalating once`);
          try {
            const second = await callOnce(this._prompt(doc, mode, { escalate: true }));
            if (second && !this._needsSynthesisEscalation(second)) result = second;
          } catch (e) {
            this.logger.warn(`synthesis escalation failed — keeping first result: ${e.message}`);
          }
        }
        if (mode === 'guideline' && result && this._needsGuidelineEscalation(result)) {
          this.logger.warn('guideline gate: no augmentedSections and no webSources — escalating once');
          try {
            const second = await callOnce(this._prompt(doc, mode, { escalate: true }));
            if (second && !this._needsGuidelineEscalation(second)) result = second;
            else this.logger.warn('guideline escalation still had no web evidence — keeping first result');
          } catch (e) {
            this.logger.warn(`guideline escalation failed — keeping first result: ${e.message}`);
          }
        }
        return result;
      };

      let data;
      if (mode === 'review') {
        // ★ 리뷰는 캐시를 직접 다룬다 — **얇은 결과를 캐시에 굳히지 않기 위해서다.**
        //   getOrFetch 를 그대로 쓰면 에스컬레이션까지 하고도 얇았던 결과가 TTL 동안
        //   재사용돼 다음 실행도 얇게 나온다. 읽기도 같은 기준: 구버전이 굳혀 둔 얇은
        //   캐시는 miss 로 취급해 새로 시도한다. (guideline·reference 경로는 종전 그대로.)
        // 게이트 기준(얇음 또는 웹 미사용)에 걸리는 결과는 캐시에 굳히지도, 캐시에서
        // 재사용하지도 않는다 — 굳히면 다음 실행도 같은 실패를 그대로 재사용한다.
        const cached = await this.cache.get(cacheKey);
        if (cached !== null && cached !== undefined && !this._needsReviewEscalation(cached)) {
          data = cached;
        } else {
          data = await fetchFresh();
          if (data !== undefined && !this._needsReviewEscalation(data)) await this.cache.set(cacheKey, data);
        }
      } else {
        // 데일리 코어(guideline)·reference 는 종전 경로 그대로 (불변식: 데일리 코어 무영향)
        ({ data } = await this.cache.getOrFetch(cacheKey, fetchFresh));
      }

      return this._toCard(doc, data, mode);
    } catch (err) {
      // 분석 실패/거부 → null. 오케스트레이터가 조용히 건너뛴다(카드 미표시).
      this.logger.warn(`${mode} analysis failed — skipping this cycle`, { err: err.message });
      return null;
    }
  }

  /**
   * ② 리뷰 카드에 실을 수 있는 절만 남기고, 보강 절(origin='augmented')을 **화면에서
   * 구분되게** 장식한다. 렌더러(GitHubPublisher·dailyDigest)는 heading_ko/body_ko 만
   * 그리므로 구분 표식을 데이터에 심는다:
   *   · 제목 앞에 `[웹 보강]` — 원문이 말한 절과 섞여 "Lancet 이 이렇게 말했다"로
   *     읽히는 것을 막는다 (REPORT_SPEC §4-B 환각 배제 원칙).
   *   · 본문 끝에 `— 보강 출처: <label> (<url>)` 한 줄 — 어디서 온 문장인지 링크로 밝힌다.
   *   · http(s) 출처 URL 이 없는 보강 절은 **버린다** — 출처 없는 보강은 환각과 구분할 수 없다.
   */
  _publishableReviewSections(data) {
    const AUG_MARK = '[웹 보강]';
    return (Array.isArray(data?.sections) ? data.sections : [])
      .filter((x) => String(x?.body_ko ?? '').trim())
      .map((x) => {
        if (x?.origin !== 'augmented') return x;
        const url = String(x.sourceUrl ?? '').trim();
        // ★ 허용목록을 통과한 출처만 (2026-08-18) — http(s) 만 보면 해적판 PDF 미러가
        //   그대로 들어온다. 가이드라인 보강 절과 **같은 기준**이어야 한다.
        if (!isTrustedSourceUrl(url)) return null;
        // ★ 모델이 제목에 `[보강]` 같은 표식을 스스로 붙여 오는 일이 있다(실측 2026-08-18:
        //   화면에 `[웹 보강] [보강] …` 로 두 번 찍혔다). 우리 표식을 붙이기 **전에**
        //   앞머리의 대괄호 표식을 걷어낸다 — 표식은 우리가 붙이는 것 하나여야 한다.
        const heading = String(x.heading_ko ?? '').trim()
          .replace(/^(?:\[[^\]]{0,12}\]\s*)+/, '').trim();
        const label = String(x.sourceLabel ?? '').trim() || url;
        const body = String(x.body_ko);
        return {
          ...x,
          heading_ko: heading.includes(AUG_MARK) ? heading : `${AUG_MARK} ${heading}`.trim(),
          body_ko: body.includes(url) ? body : `${body}\n— 보강 출처: ${label} (${url})`,
        };
      })
      .filter(Boolean);
  }

  /** 리뷰 본문 실질량 — 카드에 실제로 실릴 절(body_ko)의 글자수 합. */
  _reviewBodyChars(data) {
    return this._publishableReviewSections(data)
      .reduce((n, sec) => n + String(sec.body_ko ?? '').trim().length, 0);
  }

  /** ③ 실질 게이트 판정 — full-text 를 확보했다고 말한 카드는 길이로 트집잡지 않는다. */
  _isThinReview(data) {
    if (!data) return true;
    if (data.coverage === 'full-text') return false;
    return this._reviewBodyChars(data) < REVIEW_THIN_BODY_CHARS;
  }

  /** 실제 http(s) 링크가 달린 webSources 만 — 웹을 정말 열었다는 증거로 센다. */
  /**
   * 근거로 인정할 웹 출처만.
   *
   * ★★ 2026-08-18 실측 — 웹검색을 고치자마자 내용은 1,119 → 5,173자로 좋아졌는데
   *   근거로 붙은 출처가 **Lancet 논문 PDF 무단 게재 미러**(waltersport.com)였다.
   *   내용이 맞더라도 인용할 곳이 아니고, 링크가 언제 사라질지 모르며, 진본 보증도 없다.
   *   프롬프트의 "블로그·콘텐츠팜 배제" 는 PDF 미러를 못 걸렀다 —
   *   **말로 막지 말고 코드로 막는다**(`sourceTrust` 허용목록).
   * ★ 대가를 알고 고른 것이다: 정당한 출처를 못 찾은 날은 보강이 비어 카드가 얇아진다.
   *   얇은 것은 정직한 결과이고, 해적판을 근거로 단 두꺼운 카드는 그렇지 않다.
   *   (얇으면 아래 게이트가 한 번 더 돌아 정당한 출처를 다시 찾는다.)
   */
  _validWebSources(data) {
    const all = (Array.isArray(data?.webSources) ? data.webSources : []);
    const kept = all.filter((s) => isTrustedSourceUrl(s?.url));
    const dropped = all.length - kept.length;
    if (dropped) {
      this.logger.warn(`신뢰할 수 없는 웹 출처 ${dropped}건 제외 (허용목록 밖)`, {
        hosts: all.filter((s) => !isTrustedSourceUrl(s?.url))
          .map((s) => { try { return new URL(String(s.url)).hostname; } catch { return String(s?.url).slice(0, 40); } })
          .slice(0, 5),
      });
    }
    return kept;
  }

  /**
   * ④ 리뷰 에스컬레이션 판정 — 본문 길이만 보면 이번 실측(2026-08-18)의 증상을 놓친다:
   * 그날 카드는 길이가 아니라 **webSources: 0** 이 증상이었다(웹을 아예 안 열었다).
   * coverage ≠ full-text 이고 (본문이 얇거나 **웹 증거가 없으면**) 게이트에 걸린다.
   */
  _needsReviewEscalation(data) {
    if (!data) return true;
    if (data.coverage === 'full-text') return false;
    return this._reviewBodyChars(data) < REVIEW_THIN_BODY_CHARS
      || this._validWebSources(data).length === 0;
  }

  /** ④ 가이드라인 에스컬레이션 판정 — 보강 축도 비었고 웹 증거도 없으면 검색을 건너뛴 것. */
  /**
   * 종합 카드가 "대조" 가 아니라 "요약 재탕" 으로 붕괴했는가.
   *
   * ★ 축이 하나도 없거나, **모든 축의 입장이 하나뿐**이면 갈린 것이 없다는 뜻이다.
   *   그런 카드는 문헌별 요약을 나란히 늘어놓은 것에 지나지 않는데, 화면에서는
   *   "비교했다" 로 읽힌다 — 숫자가 정상처럼 보이는 고장이라 게이트로 잡는다.
   */
  _needsSynthesisEscalation(data) {
    const axes = Array.isArray(data?.comparisons) ? data.comparisons : [];
    if (!axes.length) return true;
    return axes.every((c) => (Array.isArray(c?.positions) ? c.positions : []).length <= 1);
  }

  _needsGuidelineEscalation(data) {
    if (!data) return false; // null/거부는 기존 실패 경로가 처리한다 — 여기서 재시도하지 않는다
    return this._publishableAugments(data).length === 0
      && this._validWebSources(data).length === 0;
  }

  /**
   * ② 가이드라인 보강 축 — 카드에 실을 수 있는 항목만. 리뷰의 보강 절과 같은 계약이다:
   * {heading_ko, body_ko, sourceLabel, sourceUrl} 이고 **http(s) 출처가 없으면 버린다**
   * (출처 없는 보강은 환각과 구분할 수 없다 — REPORT_SPEC §4-B 환각 배제).
   * 원문(summary·keyChanges)과 별도 배열로 남겨 렌더러가 화면에서 구분해 그린다.
   */
  _publishableAugments(data) {
    return (Array.isArray(data?.augmentedSections) ? data.augmentedSections : [])
      .filter((x) => String(x?.body_ko ?? '').trim())
      .map((x) => {
        const url = String(x?.sourceUrl ?? '').trim();
        // ★ http(s) 인 것만으로는 부족하다 — 해적판 PDF 미러도 https 다(2026-08-18 실측).
        //   보강 절의 출처도 `webSources` 와 **같은 허용목록**을 통과해야 한다.
        //   두 곳이 다른 기준을 쓰면 한쪽으로 미심쩍은 출처가 새어 들어온다.
        if (!isTrustedSourceUrl(url)) return null;
        return {
          // 리뷰 보강 절과 같은 규칙 — 모델이 스스로 붙인 앞머리 표식을 걷는다.
          heading_ko: String(x.heading_ko ?? '').trim().replace(/^(?:\[[^\]]{0,12}\]\s*)+/, '').trim(),
          body_ko: String(x.body_ko).trim(),
          sourceLabel: String(x.sourceLabel ?? '').trim() || url,
          sourceUrl: url,
        };
      })
      .filter(Boolean);
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
    // 트랙마다 축이 다르다 (PeterJ 확정 2026-08-17):
    //   guideline  이전 판 대비 변경점(keyChanges)
    //   reference  출처 성격·한계(sourceNote_ko) — PeterJ 가 직접 고른 자료라 신뢰도를 먼저 말한다
    //   review     절별 번역(sections) + 무엇을 보고 옮겼는지(coverage)
    // ★ 종합: 문헌의 정체는 **파이프라인이 넣는다.** LLM 이 준 것은 refId 와 성격 설명뿐이라
    //   여기서 실제 문헌 목록과 합친다. 모르는 refId 는 버린다(오귀속 차단 2차 방어).
    if (mode === 'synthesis') {
      // ★ 목록의 정본은 **파이프라인이 넘긴 docs** 다 (코드리뷰 2026-08-29).
      //   종전에는 모델이 반환한 documents 로 목록을 만들었는데, 모델이 문헌 하나를
      //   빠뜨리면 그 문헌의 입장이 **모든 축에서 조용히 사라졌다**(재현됨).
      //   설명은 모델이 붙이는 것이고 존재 여부는 모델이 정하는 것이 아니다.
      const described = new Map((Array.isArray(data.documents) ? data.documents : [])
        .filter((e) => e?.refId != null).map((e) => [String(e.refId), e]));
      const documents = (guideline.docs ?? []).map((src) => {
        const entry = described.get(String(src.refId)) ?? {};
        return {
          refId: String(src.refId),
          docType: entry.docType ?? 'other',
          docTypeNote_ko: entry.docTypeNote_ko ?? '',
          role_ko: entry.role_ko ?? '',
          shortLabel_ko: entry.shortLabel_ko ?? '',
          isBaseline: Boolean(entry.isBaseline ?? src.isBaseline),
          pmid: src.pmid ?? '',
          sourceUrl: src.sourceUrl ?? '',
          title: src.title ?? '',
          org: src.org ?? '',
        };
      });
      const known = new Set(documents.map((d) => d.refId));
      const comparisons = (Array.isArray(data.comparisons) ? data.comparisons : [])
        .map((c) => ({
          axis_ko: c?.axis_ko ?? '',
          divergenceNote_ko: c?.divergenceNote_ko ?? '',
          positions: (Array.isArray(c?.positions) ? c.positions : [])
            .map((p) => ({
              refIds: (Array.isArray(p?.refIds) ? p.refIds : []).map(String).filter((r) => known.has(r)),
              detail: p?.detail ?? '',
              detail_ko: p?.detail_ko ?? '',
            }))
            .filter((p) => p.refIds.length && (p.detail || p.detail_ko)),
        }))
        .filter((c) => c.positions.length);
      const ground = Array.isArray(data.commonGround) ? data.commonGround : [];
      const groundPairs = ground.filter((x) => String(x?.point ?? '').trim() || String(x?.point_ko ?? '').trim());
      // 종합 카드의 1차 출처는 **묶인 문헌 각각**이다. 웹 보강 출처보다 앞에 둔다.
      const docSources = [];
      for (const d of documents) {
        const label = d.shortLabel_ko || d.org || d.refId;
        if (d.pmid) docSources.push({ label: `${label} — PMID ${d.pmid}`, url: `https://pubmed.ncbi.nlm.nih.gov/${d.pmid}/` });
        else if (/^https?:\/\//i.test(String(d.sourceUrl))) docSources.push({ label: `${label} — 원문(발행기관)`, url: d.sourceUrl });
      }
      sources.unshift(...docSources);
      return {
        type: 'synthesis',
        // 종합은 원제(영문 단일 제목)가 없다 — 여기에 title_ko 를 넣으면 카드가
        // 같은 한국어 제목을 제목·부제로 두 번 찍는다(코드리뷰 2026-08-29 재현).
        paper: {
          pmid: '', title: '', journal: '',
          pubDate: '', pubmedUrl: null, doi: '',
          sourceUrl: '', sourceId: guideline.sourceId,
        },
        // 카드에 id 를 달아 누적 표 행이 같은 페이지의 이 카드로 걸리게 한다.
        stateId: guideline.sourceId,
        org: `문헌 ${documents.length}건`,
        version: data.version ?? '',
        title_ko: data.title_ko ?? '',
        scope_ko: data.scope_ko ?? '',
        // ★ EN 만 filter 하면 인덱스가 밀려 **다른 항목의 한국어가 붙는다**
        //   (코드리뷰 2026-08-29 재현: "EN 2" 밑에 "한국어 1"). 짝으로 거른다.
        summary: groundPairs.map((x) => String(x.point ?? '')),
        summary_ko: groundPairs.map((x) => String(x.point_ko ?? '')),
        documents,
        comparisons,
        gapNotes_ko: (Array.isArray(data.gapNotes_ko) ? data.gapNotes_ko : []).map(String).filter((x) => x.trim()),
        augmentedSections: this._publishableAugments(data),
        fullTextSource: 'synthesis',
        practiceImpact: data.practiceImpact,
        practiceImpact_ko: data.practiceImpact_ko,
        sources,
      };
    }

    const modeFields = mode === 'review'
      ? {
        sections: this._publishableReviewSections(data),
        coverage: ['full-text', 'web-augmented', 'abstract-only'].includes(data.coverage)
          ? data.coverage : 'abstract-only',
      }
      : mode === 'reference'
        ? { sourceNote_ko: data.sourceNote_ko ?? '' }
        // guideline: keyChanges(원문 축 — 그대로 둔다)와 **별개 축**으로 웹 보강을 싣는다.
        // 출처(http/https) 없는 보강 항목은 여기서 버려진다 — 렌더러까지 못 간다.
        : { keyChanges, changesUnavailable: keyChanges.length === 0, augmentedSections: this._publishableAugments(data) };
    return {
      type: mode === 'reference' ? 'reference' : (mode === 'review' ? 'review' : 'guideline'),
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
