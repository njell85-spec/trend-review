/**
 * GuidelineFitAgent — 풀에서 **PeterJ 에게 맞는 것**을 LLM 이 고른다.
 *
 * PeterJ 지시 2026-08-17: *"셀렉은 LLM 통해서 나한테 맞는거 리스트를 정하고."*
 *
 * ★ 실패는 전부 소프트다. 판정이 없으면 항목은 손대지 않은 채 남고, 규칙 점수
 *   (`GuidelineScorer`)가 종전대로 순서를 정한다 — 데일리 코어 무영향 불변식.
 *   LLM 이 죽었다고 그날 지침이 안 나가면 안 된다.
 */
import { Logger } from '../utils/Logger.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';
import { LLMClient, PROVIDER_DEFAULTS, ANTHROPIC_ANALYSIS_MODEL } from '../utils/LLMClient.js';
import { FIT_TOOL, buildFitPrompt, fitBatches, toFitInput, applyFitVerdicts } from '../utils/guidelineFit.js';

export class GuidelineFitAgent {
  constructor(options = {}) {
    this.provider = options.provider ?? 'anthropic';
    this.model = options.model ?? (this.provider === 'anthropic' ? ANTHROPIC_ANALYSIS_MODEL : PROVIDER_DEFAULTS[this.provider]);
    this.logger = options.logger ?? new Logger('GuidelineFit', { logFile: 'guideline_fit.jsonl' });
    this.cb = options.cb ?? new CircuitBreaker(`${this.provider}-guideline-fit`, { failureThreshold: 3 });
    this.retry = options.retry ?? new RetryHelper({ maxAttempts: 2, baseDelayMs: 3_000 });
    this.llm = options.llm ?? new LLMClient({ provider: this.provider, model: this.model });
    this.batchSize = options.batchSize ?? 20;
    this.threshold = options.threshold ?? 6;
    // ★ 트랙마다 **고르는 기준이 다르다**(PeterJ 확정: 세 트랙은 셀렉도 다르다).
    //   배치·전역 index·소프트 실패는 트랙과 무관한 규칙이라 여기 한 벌만 둔다.
    //   기준(도구·프롬프트·입력 모양)만 주입한다. 기본값은 가이드라인이라 종전 호출부는
    //   한 글자도 안 바뀐다.
    //   ★ 리뷰에 가이드라인 프롬프트를 그대로 쓰면 **전건 격리된다** — 그 프롬프트가
    //     "지침이 아닌 것" 을 0~2 점으로 규정하고 리뷰는 정의상 전부 그렇다.
    //     그래서 프롬프트를 주입구로 뺐다. 자세한 것은 `src/utils/reviewFit.js` 머리말.
    this.tool = options.tool ?? FIT_TOOL;
    this.buildPrompt = options.buildPrompt ?? buildFitPrompt;
    this.toInput = options.toInput ?? toFitInput;
    this.label = options.label ?? 'guideline-fit';
  }

  /**
   * @param {Array} items 판정할 후보들 (이미 예산만큼 잘라서 넘긴다)
   * @returns {{items: Array, scored: number, batches: number, failed: number, error: string|null}}
   */
  async score(items, { topicLabels = [], now = new Date().toISOString() } = {}) {
    const evidence = { scored: 0, batches: 0, failed: 0, error: null };
    if (!items?.length) return { items: items ?? [], ...evidence };

    const batches = fitBatches(items, this.batchSize);
    evidence.batches = batches.length;
    // ★ 판정은 **전역 index** 로 돌아온다. 배치별 0-based 로 받으면 두 번째 배치의
    //   판정이 첫 배치 항목에 붙는다 — 조용히 엉뚱한 지침이 나가는 부류다.
    let offset = 0;
    let verdicts = [];
    for (const batch of batches) {
      const inputs = batch.map((item, i) => this.toInput(item, offset + i));
      try {
        const result = await this.cb.execute(() => this.retry.execute(
          () => this.llm.callWithTool(
            [{ role: 'user', content: this.buildPrompt(inputs, { topicLabels }) }],
            this.tool, { maxTokens: 8000 },
          ),
          { label: `${this.provider}-${this.label}` },
        ));
        const rows = Array.isArray(result?.verdicts) ? result.verdicts : [];
        if (!rows.length) throw new Error('LLM returned no verdicts');
        verdicts.push(...rows);
      } catch (error) {
        evidence.failed += 1;
        evidence.error = error?.message ?? String(error);
        this.logger.warn('적합도 판정 배치 실패 — 이 묶음은 규칙 점수로 남는다', {
          batch: evidence.batches, size: batch.length, err: evidence.error,
        });
      }
      offset += batch.length;
    }

    const applied = applyFitVerdicts(items, verdicts, { now, threshold: this.threshold });
    evidence.scored = applied.scored;
    this.logger.info('적합도 판정', {
      트랙: this.label, 대상: items.length, 판정: applied.scored, 실패배치: evidence.failed,
    });
    return { items: applied.items, ...evidence };
  }
}
