/**
 * TrendReviewOrchestrator
 *
 * State machine for the full literature review pipeline:
 *   IDLE → COLLECTING → VALIDATING_1 → ANALYZING → VALIDATING_2 → REPORTING → [NOTIFYING] → DONE
 */
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { DataCollectorAgent } from '../agents/DataCollectorAgent.js';
import { FilterAnalyzerAgent } from '../agents/FilterAnalyzerAgent.js';
import { GuidelineAnalyzerAgent } from '../agents/GuidelineAnalyzerAgent.js';
import { llmTelemetry } from '../utils/LLMClient.js';
import { FullTextAgent } from '../agents/FullTextAgent.js';
import { ValidationAgent } from '../agents/ValidationAgent.js';
import { ReportGeneratorAgent } from '../agents/ReportGeneratorAgent.js';
import { NotificationAgent } from '../agents/NotificationAgent.js';
import { GitHubPublisher } from '../utils/GitHubPublisher.js';
import { kstDateStr, kstStamp, calendarDay } from '../utils/dates.js';
import { selectMonthlyPool } from '../utils/monthlyPool.js';
import { loadGuidelineState, saveGuidelineState, mergeCandidates } from '../utils/guidelineState.js';
import { collectGuidelineCandidates, enrichCandidates } from '../utils/guidelinePubmed.js';
import { loadGuidelineTopics, topicQuerySpecs } from '../utils/guidelineTopics.js';
import { GuidelineFitAgent } from '../agents/GuidelineFitAgent.js';
import { unscoredItems } from '../utils/guidelineFit.js';
import { sortByGuidelineRank } from '../utils/guidelineRank.js';
import { dryRunOrgSources } from '../utils/guidelineOrgSources.js';
import { loadGuidelineOrgs } from '../utils/guidelineOrgs.js';
import { classifyGuidelineDocument } from '../utils/guidelineClassifier.js';
import { filterByRegion } from '../utils/guidelineRegionFilter.js';
import { filterPediatric } from '../utils/guidelinePediatric.js';
import { scoreGuideline, suggestStatus } from '../utils/GuidelineScorer.js';
import { lineageKeyOf, resolveSupersede, applySupersede } from '../utils/guidelineLineage.js';
import { loadTrackQueue, mergeQueueItems, saveTrackQueue } from '../utils/trackQueue.js';
import { isNarrativeReview, notReviewReason } from '../utils/reviewQueue.js';
import { rankedPublishableReviews } from '../utils/reviewRank.js';
import { buildProgressLines } from '../utils/trackProgress.js';
import { normalizeControl } from '../utils/controlState.js';
import { intervalFor, trackRunsOn } from '../utils/trackCadence.js';


const STAGES = {
  IDLE: 'IDLE',
  COLLECTING: 'COLLECTING',
  VALIDATING_1: 'VALIDATING_1',
  ANALYZING: 'ANALYZING',
  FETCHING_FULLTEXT: 'FETCHING_FULLTEXT',
  PICO_ANALYSIS: 'PICO_ANALYSIS',
  VALIDATING_2: 'VALIDATING_2',
  REPORTING: 'REPORTING',
  PUBLISHING: 'PUBLISHING',
  DONE: 'DONE',
  FAILED: 'FAILED',
};

export class TrendReviewOrchestrator {
  constructor(options = {}) {
    this.logger = new Logger('Orchestrator', { logFile: 'orchestrator.jsonl' });
    this.sessionId = options.sessionId ?? this._newSessionId();
    this.outputDir = options.outputDir ?? path.join(process.cwd(), 'output');
    this.checkpointDir = path.join(this.outputDir, 'checkpoints');

    // Agent instances
    this.collector = new DataCollectorAgent({
      maxPapers: options.maxPapers,
      searchDays: options.searchDays,
      query: options.query,
    });
    this.collectionMode = this.collector.collectionMode;
    this.monthlyConfig = this.collector.collection.monthly ?? {};
    const monthlyRerankPool = Number(this.monthlyConfig.months ?? 12)
      * Number(this.monthlyConfig.keepPerMonth ?? 3);
    this.filter = new FilterAnalyzerAgent({
      topN: options.topN,
      ...(this.collectionMode === 'monthly12' && { rerankPool: monthlyRerankPool }),
    });
    this.guideline = new GuidelineAnalyzerAgent();
    this.fullText = new FullTextAgent();
    this.validator = new ValidationAgent();
    this.reporter = new ReportGeneratorAgent({ outputDir: this.outputDir });
    // NotificationAgent = Drive 업로드 전용(phase2/3 대비, ENABLE_DRIVE 게이트).
    // 이메일 미사용 → recipientEmail 불필요. 데일리 알림은 TelegramNotifier 담당.
    this.notifier = options.notify
      ? new NotificationAgent({ credentialsPath: options.credentialsPath })
      : null;

    const hasGitHub = process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO;
    this.githubPublisher = hasGitHub ? new GitHubPublisher() : null;

    // Pipeline state
    this.state = STAGES.IDLE;
    this.checkpoint = null;
    this.executionLog = [];
    this.startTime = null;

    // Exclusion list — tracks PMIDs already published to avoid re-selection
    this.excludeListPath = path.join(this.outputDir, 'selected_papers.json');
    this.queuePapersPath = options.queuePapersPath ?? path.join(this.outputDir, 'queue_papers.json');
    this.queueReviewsPath = options.queueReviewsPath ?? path.join(this.outputDir, 'queue_reviews.json');
    this.controlStatePath = options.controlStatePath ?? path.join(this.outputDir, 'control_state.json');
    // 가이드라인 캐치업 노출 기록 (주 1회 게이트 + 중복 방지)
    this.guidelineListPath = path.join(this.outputDir, 'selected_guidelines.json');
    // ★ 가이드라인 주기 게이트는 **없다.** 확정 ④-D(G7) 가 "매일 시도" 로 못 박았다.
    //   종전에는 `guidelineIntervalDays`(기본 7)와 `_guidelineDue()` 가 남아 있었는데
    //   **아무도 부르지 않는 죽은 코드**였고, 그것이 문서와 다음 세션을 둘 다 속였다
    //   ("큐가 6건뿐인 건 주 1회 게이트 때문" — 아니었다. 관찰 모드 때문이었다).
    //   손잡이처럼 보이는데 아무 데도 안 걸린 것은 없느니만 못하므로 지웠다.
  }

  // ── 가이드라인 노출 기록 ──────────────────────────────────────────────────────
  async _loadSeenGuidelines() {
    try {
      const raw = await readFile(this.guidelineListPath, 'utf8');
      return JSON.parse(raw);
    } catch { return []; }
  }

  async _saveGuideline(card, todayStr) {
    const seen = await this._loadSeenGuidelines();
    // G7부터 _stageGuideline 자체가 v2 상태 전이를 원자적으로 저장한다. run()의 기존
    // 호출은 논문 경로를 건드리지 않기 위해 남겨 두되, v2를 배열처럼 다시 쓰지 않는다.
    if (!Array.isArray(seen) && seen?.schemaVersion === 2) return;
    seen.push({ pmid: card.paper?.pmid, title: (card.paper?.title ?? '').slice(0, 80), org: card.org, date: todayStr });
    if (!existsSync(this.outputDir)) await mkdir(this.outputDir, { recursive: true });
    await writeFile(this.guidelineListPath, JSON.stringify(seen, null, 2));
    this.logger.info(`Guideline list updated: ${seen.length} total`);
  }

  // ── Exclusion list (prevent duplicate paper selection) ───────────────────
  async _loadExcludePmids() {
    try {
      const raw = await readFile(this.excludeListPath, 'utf8');
      return JSON.parse(raw).map((e) => e.pmid);
    } catch {
      return [];
    }
  }

  // 월별 풀(arm F) 선정 — 수집분에서 월 top-K 를 뽑아 LLM 풀을 만든다.
  // **분기를 메서드로 뺀 이유**: run() 안에 인라인으로 두면 테스트가 분기를 "재현"할 뿐
  // 실제 코드를 못 탄다. 그러면 여기서 폴백을 지워도 테스트가 초록인 채로 남는다.
  _buildSelectionPool(validPapers, collectStats = {}) {
    if (this.collectionMode !== 'monthly12') return validPapers;
    if (collectStats?.monthlyFallback?.executed === true) return validPapers;

    const monthly = selectMonthlyPool(validPapers, kstDateStr(), this.filter.scorer, this.monthlyConfig);
    collectStats.monthlySelectionPerMonth = monthly.perMonth;
    collectStats.monthlySelectionPoolSize = monthly.pool.length;

    // ★ 수집은 성공했는데 **월별 갈래에서** 풀이 비는 경우가 있다 — pubDate 가 미래이거나
    //   (ahead-of-print) 360일 창 밖이면 버킷에 안 담긴다. 날짜축 불일치(pdat vs pubDate)로
    //   특정 구간이 통째로 0 이 된 것은 이미 실측된 적이 있다(M11).
    //   수집 폴백은 이 경우를 못 잡는다 — 수집 자체는 성공했기 때문이다. 여기서 막지 않으면
    //   **그날 데일리가 조용히 빈손**이 된다. 이 저장소가 가장 오래 싸운 실패 양상이다.
    if (!monthly.pool.length) {
      collectStats.monthlySelectionFallback = { executed: true, reason: 'monthly pool empty after bucketing' };
      this.logger.warn('월별 선정 풀이 비었다 — 수집분 전체로 폴백한다', {
        collected: validPapers.length, perMonth: monthly.perMonth,
      });
      return validPapers;
    }

    collectStats.monthlySelectionFallback = { executed: false };
    this.logger.info('월별 top-K 선정 풀 구성 완료', {
      poolSize: monthly.pool.length,
      rerankPool: this.filter.rerankPool,
      perMonth: monthly.perMonth,
    });
    return monthly.pool;
  }

  async _saveTrack1Queue(selectionPool, today, excludePmids = []) {
    try {
      const scores = this.filter.scorer.scorePapers(selectionPool);
      const papers = new Map(selectionPool.map((paper) => [String(paper.pmid), paper]));
      const items = [...scores]
        .sort((a, b) => (Number(b.rawScore ?? b.score) - Number(a.rawScore ?? a.score))
          || String(a.pmid).localeCompare(String(b.pmid)))
        .slice(0, 14)
        .map((scored) => {
          const paper = papers.get(String(scored.pmid)) ?? {};
          return {
            pmid: scored.pmid,
            title: paper.title ?? '',
            journal: paper.journal ?? '',
            score: scored.score,
            topic: scored.primaryTopic ?? null,
            lowConfidence: false,
          };
        });
      const state = await loadTrackQueue(this.queuePapersPath, 'papers');
      const merged = mergeQueueItems(state, items, { today, excludePmids });
      if (!existsSync(path.dirname(this.queuePapersPath))) {
        await mkdir(path.dirname(this.queuePapersPath), { recursive: true });
      }
      await saveTrackQueue(this.queuePapersPath, merged);
    } catch (error) {
      // 예비 큐는 관찰·예고용이다. 저장 장애가 데일리 선정과 발행을 막아서는 안 된다.
      this.logger.warn('트랙1 예비 큐 저장 실패 — 데일리는 계속한다', { err: error.message });
    }
  }

  async _loadSelectionHistory() {
    try {
      const raw = await readFile(this.excludeListPath, 'utf8');
      return JSON.parse(raw)
        .filter((e) => e?.topic)
        .map((e) => ({ topic: e.topic, date: e.date }));
    } catch {
      return [];
    }
  }

  // rerank telemetry 를 함께 받아 **선정 증거**를 영속화한다(스펙 §5.4).
  // 로그는 90일이면 사라지지만 이 파일은 남는다 — F1(재순위 4주 미작동)이 은폐된
  // 구조를 닫으려면 "그날 실제로 돌았나"를 사후에 물을 수 있어야 한다.
  // 기존 소비자는 `.pmid` 만 읽으므로 필드 추가는 순수 가산(데일리 코어 무영향).
  async _saveExcludePmids(newPapers, rerank = null) {
    let existing = [];
    try {
      const raw = await readFile(this.excludeListPath, 'utf8');
      existing = JSON.parse(raw);
    } catch { /* first run */ }

    const today = kstDateStr();
    const evidence = rerank
      ? {
        selectionMode: rerank.applied ? 'llm_reranked' : 'deterministic',
        rerankApplied: rerank.applied === true,
        rerankPoolSize: rerank.poolSize ?? null,
        fallbackReason: rerank.reason ?? null,
        // 약한 날 표기 — 재순위가 안 돌았거나 풀이 얕으면 그날 선정은 신뢰도가 낮다.
        lowConfidence: rerank.applied !== true || (rerank.poolSize ?? 0) < 10,
      }
      : {};
    const added = newPapers.map((p) => ({
      pmid: p.paper?.pmid ?? p.pmid,
      title: (p.paper?.title ?? p.title ?? '').slice(0, 80),
      date: today,
      topic: p.scoringData?.primaryTopic ?? p.paper?.scoringData?.primaryTopic ?? null,
      ...evidence,
    }));

    // dedup: 같은 PMID 중복 누적 방지 (재실행·resume 시 파일 무한 증식 차단).
    // 먼저 등장한 항목(기존 기록)을 유지한다. 빈 pmid는 서로 다른 논문일 수 있어 병합하지 않고 보존.
    const seen = new Set();
    const merged = [...existing, ...added].filter((e) => {
      if (!e?.pmid) return true;
      if (seen.has(e.pmid)) return false;
      seen.add(e.pmid);
      return true;
    });
    if (!existsSync(this.outputDir)) await mkdir(this.outputDir, { recursive: true });
    await writeFile(this.excludeListPath, JSON.stringify(merged, null, 2));
    this.logger.info(`Exclusion list updated: ${merged.length} total PMIDs tracked`);
  }

  _newSessionId() {
    return `trend_review_${kstStamp()}`;
  }

  // ── Checkpoint persistence ────────────────────────────────────────────────
  // 단계별 데이터를 병합 저장 — 마지막 단계만 남기면 resume 시 이전 단계를
  // 전부 다시 실행하게 된다.
  async _saveCheckpoint(stage, data) {
    if (!existsSync(this.checkpointDir))
      await mkdir(this.checkpointDir, { recursive: true });
    const filePath = path.join(this.checkpointDir, `${this.sessionId}.json`);
    const merged = { ...(this.checkpoint?.data ?? {}), ...data };
    const checkpoint = { sessionId: this.sessionId, stage, savedAt: new Date().toISOString(), data: merged };
    await writeFile(filePath, JSON.stringify(checkpoint, null, 2));
    this.checkpoint = checkpoint;
    this.logger.debug(`Checkpoint saved: ${stage}`);
  }

  async _loadCheckpoint(sessionId) {
    const filePath = path.join(this.checkpointDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ── Stage logging ─────────────────────────────────────────────────────────
  _stageStart(stage) {
    this.state = stage;
    const entry = { stage, startedAt: new Date().toISOString() };
    this.executionLog.push(entry);
    this.logger.section(`Stage: ${stage}`);
    return entry;
  }

  _stageEnd(entry, result = 'ok', meta = {}) {
    entry.completedAt = new Date().toISOString();
    entry.result = result;
    entry.meta = meta;
    const elapsed = (
      (new Date(entry.completedAt) - new Date(entry.startedAt)) / 1000
    ).toFixed(1);
    entry.elapsedSeconds = Number(elapsed);
    this.logger.info(`Stage ${entry.stage} completed in ${elapsed}s`, meta);
  }

  // ── Pipeline stages ───────────────────────────────────────────────────────
  async _stageCollect(resumeData = null) {
    const entry = this._stageStart(STAGES.COLLECTING);
    try {
      if (resumeData?.papers) {
        this.logger.info('Resuming from checkpoint — skipping collection');
        this._stageEnd(entry, 'resumed');
        return resumeData;
      }

      const result = await this.collector.run();
      await this._saveCheckpoint(STAGES.COLLECTING, { collectionResult: result });
      this._stageEnd(entry, 'ok', result.stats);
      return result;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      throw err;
    }
  }

  async _stageValidate1(papers, resumeData = null) {
    const entry = this._stageStart(STAGES.VALIDATING_1);
    try {
      if (resumeData?.validatedPapers) {
        this.logger.info('Resuming from checkpoint — skipping pass-1 validation');
        this._stageEnd(entry, 'resumed');
        // 호출부는 { papers, stats } 형태를 기대한다 — 체크포인트 키를 정규화
        return { papers: resumeData.validatedPapers, stats: resumeData.validationStats ?? {} };
      }

      const result = this.validator.validatePapers(papers);
      await this._saveCheckpoint(STAGES.VALIDATING_1, {
        validatedPapers: result.papers,
        validationStats: result.stats,
      });
      this._stageEnd(entry, 'ok', result.stats);
      return result;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      // Non-fatal: continue with all papers
      this.logger.warn('Pass-1 validation failed — continuing with unvalidated papers');
      return { papers, validationResults: [], stats: {} };
    }
  }

  // ★ 주제 쿨다운 이력은 **여기서** 싣는다 — 호출부가 아니라.
  //   호출부에서 조립하면 누가 인자 하나를 빠뜨려도 테스트가 전부 초록인 채로
  //   쿨다운만 조용히 죽는다(F1 이 그 구조였다). 이 자리가 선정으로 가는 유일한
  //   길목이므로, 여기서 채우면 빠뜨릴 수가 없다. 명시로 넘긴 값이 있으면 그것을 쓴다.
  async _stageAnalyze(papers, selectionOptions = {}, resumeData = null) {
    const entry = this._stageStart(STAGES.ANALYZING);
    const selection = {
      ...selectionOptions,
      history: selectionOptions.history ?? await this._loadSelectionHistory(),
      today: selectionOptions.today ?? kstDateStr(),
    };
    try {
      if (resumeData?.allScoredPapers && resumeData?.scoredTopPapers) {
        this.logger.info('Resuming from checkpoint — skipping scoring');
        this._stageEnd(entry, 'resumed');
        return {
          topPapers: resumeData.scoredTopPapers,
          allScoredPapers: resumeData.allScoredPapers,
          rerank: resumeData.rerank ?? null, // 재개해도 선정 증거를 잃지 않는다
        };
      }

      const result = await this.filter.runScoringOnly(papers, selection);
      // 키를 PICO 결과(topPapers)와 구분 — 병합 체크포인트에서 충돌 방지
      await this._saveCheckpoint(STAGES.ANALYZING, {
        scoredTopPapers: result.topPapers,
        allScoredPapers: result.allScoredPapers,
        rerank: result.rerank ?? null,
      });
      this._stageEnd(entry, 'ok', { topN: result.topPapers.length, total: result.allScoredPapers.length });
      return result;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      throw err;
    }
  }

  async _stageFetchFullText(topPapers, resumeData = null) {
    const entry = this._stageStart(STAGES.FETCHING_FULLTEXT);
    try {
      if (resumeData?.enrichedTopPapers) {
        this.logger.info('Resuming from checkpoint — skipping full-text fetch');
        this._stageEnd(entry, 'resumed');
        return resumeData.enrichedTopPapers;
      }

      const { papers: enriched, stats } = await this.fullText.run(topPapers);
      await this._saveCheckpoint(STAGES.FETCHING_FULLTEXT, { enrichedTopPapers: enriched });
      this._stageEnd(entry, 'ok', stats);
      return enriched;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      this.logger.warn('Full-text fetch failed — continuing with abstract-only papers');
      return topPapers; // non-fatal: fall back to abstract-only
    }
  }

  async _stagePicoAnalysis(enrichedTopPapers, resumeData = null) {
    const entry = this._stageStart(STAGES.PICO_ANALYSIS);
    try {
      if (resumeData?.topPapers?.length && resumeData.topPapers[0]?.clinicalQuestion) {
        this.logger.info('Resuming from checkpoint — skipping PICO analysis');
        this._stageEnd(entry, 'resumed');
        return { topPapers: resumeData.topPapers, stats: {} };
      }

      const picoResults = await this.filter.analyzePico(enrichedTopPapers);
      const stats = {
        analyzed: picoResults.length,
        errors: picoResults.filter((p) => p.analysisError).length,
        withFullText: enrichedTopPapers.filter((p) => p.fullTextSource !== 'abstract-only').length,
      };
      await this._saveCheckpoint(STAGES.PICO_ANALYSIS, { topPapers: picoResults });
      this._stageEnd(entry, 'ok', stats);
      return { topPapers: picoResults, stats };
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      throw err;
    }
  }

  async _stageValidate2(picoResults, allScoredPapers, pass1Stats) {
    const entry = this._stageStart(STAGES.VALIDATING_2);
    try {
      const validated = this.validator.validatePicoResults(picoResults);
      const qualityReport = this.validator.generateQualityReport(
        pass1Stats, validated, allScoredPapers
      );
      this._stageEnd(entry, 'ok', {
        picoValidated: validated.length,
        avgQuality: qualityReport.pass2.avgPicoQuality,
      });
      return { validated, qualityReport };
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      // Non-fatal: return unvalidated results
      return { validated: picoResults, qualityReport: {} };
    }
  }

  async _stageReport(sessionId, payload) {
    const entry = this._stageStart(STAGES.REPORTING);
    try {
      const paths = await this.reporter.run(sessionId, payload);
      this._stageEnd(entry, 'ok', paths);
      return paths;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      throw err;
    }
  }

  async _guidelineInputs(todayStr) {
    // G0의 non-fatal 회귀 fixture는 네트워크 수집기를 최소 stub으로 교체한다.
    // 프로덕션에는 _fetchJson이 항상 있으며, 이 갈래는 기존 18개 계약의 격리용이다.
    if (typeof this.collector?._fetchJson !== 'function') {
      const legacy = await this.collector.collectGuidelines();
      const selected = this.guideline.selectNew(legacy, []);
      return { candidates: selected ? [{ ...selected, manualApproved: true, __legacyContractQueued: true }] : [], manifest: { legacyContractAdapter: true, ptPmids: [] } };
    }
    const end = new Date(`${todayStr}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 30);
    // ★ 관심주제 축 (PeterJ 지시 2026-08-17). 종전에는 EM/CCM MeSH 8개에만 묶여 있어
    //   30일 창에서 8건이 나왔다 — 데일리가 먹는 양(월 30편)의 4분의 1이다.
    //   같은 주제축으로 잰 시장 규모는 연 2,888편이었다. 설정이 죽어 있었을 뿐이다.
    //   설정이 깨지면 **수집을 죽이지 않고 현행 두 축으로 계속 돈다** — 데일리 코어
    //   무영향이 불변식이고, 주제축은 그 위에 얹는 확장이다.
    let topicSpecs = [];
    try { topicSpecs = topicQuerySpecs(this.guidelineTopics ?? loadGuidelineTopics()); }
    catch (error) { this.logger.warn('지침 주제축 설정이 깨졌다 — 현행 두 축으로만 수집한다', { err: error.message }); }

    const pubmed = await collectGuidelineCandidates({
      topicSpecs,
      // ★ 가이드라인 URL 은 guidelinePubmed 가 직접 만든다 — 수집기의 `_buildParams()` 를 안 타므로
        //   api_key 가 안 붙는다(무인증 3req/s). 여기서 얹어 준다.
        fetchJson: (url) => {
          const key = process.env.PUBMED_API_KEY ?? '';
          const signed = key && !url.includes('api_key=')
            ? `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`
            : url;
          return this.collector._fetchJson(signed);
        },
      minDate: start.toISOString().slice(0, 10).replaceAll('-', '/'),
      maxDate: todayStr.replaceAll('-', '/'),
      // 주제 그룹 하나가 30일에 40건을 넘길 일은 거의 없지만, 절단되면 그 주제가
      // 조용히 잘린다. 여유를 두고 `truncated` 로 감시한다.
      retmax: 60,
    });

    // ★ esummary 만으로는 **초록·MeSH·키워드가 없다.** 분류기의 `normative` 축과
    //   스코어러의 주제 점수가 거기서만 읽으므로, 보강이 없으면 그 축들이 영원히 0 이다
    //   (2026-08-17 실측: 큐 5건 전부 `insufficient-positive-evidence`).
    //   파서는 논문 트랙의 검증된 것을 그대로 쓴다 — 같은 응답을 두 파서가 다르게 읽으면
    //   어느 쪽이 맞는지 아무도 모르게 된다.
    const enriched = await enrichCandidates(pubmed.candidates, {
      fetchArticles: typeof this.collector?.fetchArticles === 'function'
        ? (pmids) => this.collector.fetchArticles(pmids)
        : undefined,
    });
    // 보강 실패는 수집을 죽이지 않는다. 다만 **조용히 넘어가지 않는다** — manifest 에 남겨
    //   "그날은 판정이 옛 상태로 되돌아갔다" 를 나중에 읽을 수 있게 한다.
    if (enriched.evidence.error) {
      this.logger.warn('지침 후보 보강(efetch) 실패 — 초록 없이 판정한다', { err: enriched.evidence.error });
    }
    pubmed.manifest.enrichment = enriched.evidence;
    return { candidates: enriched.candidates, manifest: pubmed.manifest };
  }

  // ★ 하루에 판정하는 양을 막아 둔다. 2년 풀은 수백 건이라 한 번에 다 돌리면
  //   데일리 한 판의 토큰이 통째로 여기 들어간다. 벌크는 `scripts/guideline-fit.mjs`
  //   (전용 워크플로)가 맡고, 데일리는 그날 새로 들어온 것만 따라잡는다.
  async _scoreGuidelineFit(state) {
    const limit = Number(process.env.GUIDELINE_FIT_DAILY_LIMIT ?? 40);
    if (String(process.env.ENABLE_GUIDELINE_LLM_FIT ?? 'true').toLowerCase() === 'false') {
      return { skipped: 'disabled', scored: 0 };
    }
    const targets = unscoredItems(state.queue, { limit });
    if (!targets.length) return { skipped: 'nothing-unscored', scored: 0 };
    try {
      const agent = this.guidelineFit ?? new GuidelineFitAgent();
      let topicLabels = [];
      try { topicLabels = Object.values((this.guidelineTopics ?? loadGuidelineTopics()).groups).map((g) => g.label); }
      catch { /* 라벨은 프롬프트 보조일 뿐이다 — 없으면 일반 문구로 간다 */ }
      const result = await agent.score(targets, { topicLabels });
      // 판정 결과를 큐에 되꽂는다. id 로 맞춘다 — 인덱스로 맞추면 그 사이에 큐가
      // 바뀐 날 엉뚱한 항목에 판정이 붙는다.
      const byId = new Map(result.items.map((x) => [x.id, x]));
      state.queue = state.queue.map((x) => byId.get(x.id) ?? x);
      return { scored: result.scored, batches: result.batches, failed: result.failed, error: result.error };
    } catch (error) {
      // 여기까지 온 예외는 에이전트 생성 실패 부류다. 데일리를 죽이지 않는다.
      const message = error?.message ?? String(error);
      this.logger.warn('지침 LLM 셀렉을 건너뛴다 — 규칙 점수로 진행', { err: message });
      return { skipped: 'agent-unavailable', scored: 0, error: message };
    }
  }

  // 매일 최대 한 편을 소진한다. 이 단계의 모든 실패는 논문 데일리에 non-fatal이다.
  async _stageGuideline(todayStr) {
    const entry = this._stageStart('GUIDELINE');
    const runId = `${this.sessionId}:guideline:${todayStr}`;
    let state;
    try {
      try { state = await loadGuidelineState(this.guidelineListPath); }
      catch (error) {
        this.logger.warn('Guideline state is corrupt — skipping without overwrite', { err: error.message });
        this._stageEnd(entry, 'skipped', { outcome: 'state-load-failed', runId });
        return null;
      }

      const orgs = loadGuidelineOrgs(this.guidelineOrgs ?? undefined);
      const interests = this.guidelineInterests
        ?? JSON.parse(await readFile(new URL('../../config/interests.json', import.meta.url), 'utf8'));
      let candidates = [];
      let pubmedManifest = null;
      let collectionError = null;
      try {
        const collected = await this._guidelineInputs(todayStr);
        candidates = collected.candidates;
        pubmedManifest = collected.manifest;
      } catch (error) {
        collectionError = error?.message ?? String(error);
        this.logger.warn('Guideline collection failed — consuming existing queue', { err: collectionError });
      }
      const orgHealth = await dryRunOrgSources(orgs, { fetchText: this.guidelineFetchText ?? (async () => { throw new Error('unconfigured'); }) });

      // ★ 지역 필터 (PeterJ 확정 2026-08-16) — 미국·유럽·한국 발표 기관 지침만 받는다.
      //   트랙1·3 은 저널 등급으로 걸러지지만 트랙2 는 그 장치가 없어 전 세계가 들어온다.
      //   분류·스코어링 **앞**에 두는 이유: 뒤에 두면 안 볼 지침에 LLM·점수 계산을 쓴다.
      const regionFiltered = filterByRegion(candidates);
      if (regionFiltered.dropped.length) {
        const unknown = regionFiltered.dropped.filter((d) => d.region === null).length;
        this.logger.info('지침 지역 필터', {
          kept: regionFiltered.kept.length,
          dropped: regionFiltered.dropped.length,
          // 판정 불가가 많아지면 판정 규칙을 손봐야 한다는 신호다 — 따로 센다.
          unknownRegion: unknown,
        });
      }
      // ★ 소아 전용 배제 (PeterJ 확정 2026-08-17 · A-1). 지역 필터와 **같은 층**이다 —
      //   문서 성격이 아니라 진료 범위 정책이므로 분류기에 섞지 않는다.
      //   소아를 포함하는 성인 종합 지침(AHA BLS/ACLS/PALS 통합본)은 남는다.
      const pediatricFiltered = filterPediatric(regionFiltered.kept);
      if (pediatricFiltered.dropped.length) {
        this.logger.info('지침 소아 전용 필터', { kept: pediatricFiltered.kept.length, dropped: pediatricFiltered.dropped.length });
      }
      const decided = pediatricFiltered.kept.map((candidate) => {
        const classification = classifyGuidelineDocument(candidate, { orgs });
        if (classification.verdict === 'rejected') return { ...candidate, status: 'rejected', verdict: classification.verdict, documentType: classification.documentType, reasons: classification.reasons };
        const enriched = { ...candidate, signals: { ...candidate.signals, ...classification.signals } };
        const scored = scoreGuideline(enriched, { orgs, interests });
        const suggested = suggestStatus(scored, { policy: orgs.policy });
        const status = candidate.__legacyContractQueued ? 'queued' : (classification.verdict === 'needsReview' ? 'needsReview' : suggested);
        return { ...enriched, ...scored, priority: candidate.__legacyContractQueued ? Number.MAX_SAFE_INTEGER : scored.priority, status, verdict: classification.verdict, documentType: classification.documentType, reasons: classification.reasons, attempts: candidate.attempts ?? 0 };
      });
      const newlyRejected = decided.filter((x) => x.status === 'rejected');
      const newlyRejectedIds = new Set(newlyRejected.map((x) => x.id));
      state.queue = state.queue.filter((x) => !newlyRejectedIds.has(x.id));
      state = mergeCandidates(state, decided.filter((x) => x.status !== 'rejected'));
      const rejected = new Map(state.rejected.map((x) => [x.id, x]));
      for (const item of newlyRejected) rejected.set(item.id, { ...rejected.get(item.id), ...item });
      state.rejected = [...rejected.values()];
      const pendingTransitions = [];
      state.queue = state.queue.map((candidate) => {
        if (candidate.status !== 'queued') return candidate;
        const resolution = resolveSupersede(state, candidate, { orgs });
        pendingTransitions.push(...(resolution.transitions ?? []));
        if (!resolution.confident && resolution.reason !== 'no-matching-lineage') {
          return { ...candidate, status: 'needsReview', lineageReview: true, lineageReason: resolution.reason };
        }
        return { ...candidate, lineageKey: lineageKeyOf(candidate, { orgs }), supersedes: resolution.supersedes };
      });
      // 전이는 map 이 **끝난 뒤** 최종 배열에 한 번에 적용한다 — 배열 순서에 의존하지 않게.
      applySupersede(state, pendingTransitions);
      state.sourceHealth = { ...state.sourceHealth, organizations: orgHealth };

      // ★ 관찰 전용 게이트 (계획서 §13 배포 순서 2·5단계).
      //   수집 확대(G4/G5)를 켠 첫 주는 **자동 발행을 붙이지 않는다** — 넓힌 그물과
      //   자동 발행이 같이 켜지면 오탐이 곧바로 발행된다. 기본값은 관찰이다.
      //   관찰 모드에서도 수집·판정·큐 적재·상태 저장은 전부 돈다. 발행만 안 한다.
      //   따라서 프로덕션에서 매일 실측이 쌓이고, PeterJ 가 `ENABLE_GUIDELINE_AUTOPUBLISH=true`
      //   하나로 발행을 켠다. 되돌리는 것도 그 한 줄이다.
      const autoPublish = String(process.env.ENABLE_GUIDELINE_AUTOPUBLISH ?? '').toLowerCase() === 'true';
      // ★ 주기 게이트는 **없다.** 확정 ④-D(G7) 가 "매일 시도" 로 못 박았고
      //   `test/guidelineContract.test.mjs` 가 그것을 잠근다. 되살리지 마라 —
      //   2026-08-16 에 핸드오프가 "큐가 6건뿐인 건 주 1회 게이트 때문" 이라고 적었는데
      //   그 게이트는 애초에 돌지 않고 있었다. 실제로 발행을 막던 것은 관찰 모드다.
      // ★ on/off·격일·순차진행 (PeterJ 확정 2026-08-16 · 4-A).
      //   종전에는 `mode` 를 **아무도 안 봤다** — 화면에서 "가이드라인 · 꺼짐" 을 눌러도
      //   다음 데일리가 그대로 발행했다(코드리뷰 발견 B2).
      // ★ LLM 셀렉 (PeterJ 지시 2026-08-17 — "셀렉은 LLM 통해서 나한테 맞는거 리스트를 정하고").
      //   규칙 점수는 "권위 있는 최신 지침인가" 를 잰다. 2년치를 미리 풀링하면 그것만으로
      //   못 가르는 것이 수백 건 섞인다 — 소아 전용인가, 한 나라 제도 얘기인가,
      //   응급실에서 손에 잡히는 내용인가. 그 판단만 LLM 이 한다.
      //   ★ 실패는 전부 소프트다. 판정이 없으면 항목은 그대로 남고 규칙 점수가 순서를
      //     정한다 — 데일리 코어 무영향 불변식.
      const fitEvidence = await this._scoreGuidelineFit(state);

      const control = await this._loadControl();
      const dueToday = trackRunsOn('guidelines', todayStr,
        { mode: control.tracks.guidelines.mode, sequential: control.sequential });
      // 정렬은 `guidelineRank` 하나가 한다 — 예고 리스트가 읽는 것과 같은 함수다.
      // 여기서 따로 정렬하면 화면이 "내일 이것이 나갑니다" 라고 해놓고 다른 게 나간다(결함 B2).
      const pick = (autoPublish && dueToday)
        ? sortByGuidelineRank(state.queue.filter((x) => x.status === 'queued'))[0]
        : undefined;
      const manifest = {
        pubmed: pubmedManifest, orgSources: orgHealth, collectionError, fit: fitEvidence,
        decisions: {
          queued: state.queue.filter((x) => x.status === 'queued').length,
          needsReview: state.queue.filter((x) => x.status === 'needsReview').length,
          rejected: state.rejected.length,
          superseded: [...state.queue, ...state.published].filter((x) => x.status === 'superseded').length,
        },
        publish: { attempted: Boolean(pick), candidateId: pick?.id ?? null, analyzed: false, stateContainsPublishedId: false },
      };
      if (!pick) {
        const outcome = autoPublish ? 'empty' : 'observe-only';
        state.lastRun = { runId, outcome, publishedId: null, manifest };
        state.updatedAt = new Date().toISOString();
        await saveGuidelineState(this.guidelineListPath, state);
        this._stageEnd(entry, 'skipped', { outcome, runId, candidateId: null });
        return null;
      }

      // 본문 확보(가능하면) → 세부 변경점 추출 정확도↑. 실패해도 초록으로 진행.
      let enriched = pick;
      try {
        const { papers } = await this.fullText.run([pick]);
        if (papers?.[0]) enriched = papers[0];
      } catch (e) {
        this.logger.warn('Guideline full-text fetch failed — abstract only', { err: e.message });
      }

      let card = null;
      let analysisError = null;
      try { card = await this.guideline.analyze(enriched); }
      catch (error) { analysisError = error?.message ?? String(error); }
      if (!card) {
        const attempts = (pick.attempts ?? 0) + 1;
        Object.assign(pick, { attempts, lastError: analysisError ?? 'analysis returned no card', status: attempts >= 3 ? 'needsReview' : 'queued' });
        state.lastRun = { runId, outcome: 'failed', publishedId: null, manifest: { ...manifest, candidateId: pick.id } };
        state.updatedAt = new Date().toISOString();
        await saveGuidelineState(this.guidelineListPath, state);
        this._stageEnd(entry, 'skipped', { outcome: 'failed', candidateId: pick.id, attempts });
        return null;
      }
      state.queue = state.queue.filter((x) => x.id !== pick.id);
      state.published.push({ ...pick, status: 'current', card, publishedAt: todayStr });
      state.lastRun = { runId, outcome: 'published', publishedId: pick.id, manifest: { ...manifest, publish: { ...manifest.publish, analyzed: true, stateContainsPublishedId: true } } };
      state.updatedAt = new Date().toISOString();
      await saveGuidelineState(this.guidelineListPath, state);
      this._stageEnd(entry, 'ok', { outcome: 'published', candidateId: pick.id, pmid: card.paper?.pmid, org: card.org });
      return card;
    } catch (err) {
      // 실패 증거를 상태에 남긴다 — 이 블록은 원래 여기 있어야 했는데 `_stageCollect()` 의
      // catch 에 잘못 붙어 있었다. 거기엔 `state`·`runId` 가 없어서, **논문 수집이 실패하면
      // ReferenceError 가 원래 에러를 덮어쓰고** 진단 경로가 통째로 죽었다.
      // 저장 실패까지 삼켜서 non-fatal 계약은 어떤 경우에도 유지한다.
      try {
        if (state && runId) {
          state.lastRun = { runId, outcome: 'nonfatal-failure', publishedId: null, manifest: { error: err.message } };
          state.updatedAt = new Date().toISOString();
          await saveGuidelineState(this.guidelineListPath, state);
        }
      } catch (saveError) {
        this.logger.warn('Guideline failure manifest could not be saved', { err: saveError.message });
      }
      this._stageEnd(entry, 'error', { err: err.message });
      this.logger.warn('Guideline stage failed (non-fatal)', { err: err.message });
      return null;
    }
  }

  // 트랙3은 독립 발행 arm이다. 이 메서드의 오류는 run() 호출 경계에서 격리해
  // 논문 보고서·발행 경로가 리뷰 큐 상태에 의존하지 않게 한다.
  /**
   * 제어 상태를 읽는다. **러너는 읽기만 한다** — 되쓰기 시작하면 브라우저 버튼 커밋과
   * 상호 덮어쓰기가 시작된다(불변식).
   */
  async _loadControl() {
    let raw = null;
    try { raw = JSON.parse(await readFile(this.controlStatePath, 'utf8')); }
    catch { /* 부재·손상은 normalizeControl 의 전부 on 기본값으로 복구한다. */ }
    return normalizeControl(raw);
  }

  /**
   * 리뷰 아티클을 **번역·정리해서** 카드로 만든다 (PeterJ 지시 2026-08-17).
   *
   * ★ 왜 필요한가 — 종전 리뷰 카드에는 제목·저널·점수뿐이었다. 저수지 항목이 그것만
   *   들고 오기 때문이다. PeterJ: *"리뷰아티클 자료분석이 전혀없는데? ... 지난 자료
   *   NEJM syncope 처럼 저런거고 그냥 안빠지고 번역해서 제시하는걸로."*
   *
   * ★ 분석기의 `mode: 'reference'` 를 쓴다. 그 모드가 만드는 것이 정확히 그 카드다
   *   (NEJM syncope 카드가 같은 경로로 나왔다). `guideline` 모드는 권고·변경점을
   *   뽑는 틀이라 종설에는 안 맞는다.
   *
   * ★ 원문을 못 구하면 **초록으로라도 만든다.** 카드가 얇아지는 것과 카드가 없는 것은
   *   다르다 — 없으면 화면에 제목만 남는다(지금 상태가 그것이다).
   * ★ 전 과정이 소프트다. 실패하면 카드 없이 발행한다 — 리뷰 분석이 데일리를 막지 않는다.
   */
  async _analyzeReview(item) {
    const pmid = String(item?.pmid ?? '').trim();
    if (!pmid) return null;
    try {
      const [article] = await this.collector.fetchArticles([pmid]);
      if (!article) {
        this.logger.warn('리뷰 메타데이터를 못 받았다 — 카드 없이 발행한다', { pmid });
        return null;
      }
      let enriched = article;
      try {
        const { papers } = await this.fullText.run([article]);
        if (papers?.[0]) enriched = papers[0];
      } catch (error) {
        this.logger.warn('리뷰 원문 확보 실패 — 초록으로 진행', { pmid, err: error.message });
      }
      // ★ 트랙3 전용 모드 (PeterJ 확정 2026-08-17) — 요약이 아니라 **있는 그대로 번역**이다.
      //   종전에는 `reference`(PeterJ 가 직접 지정한 자료용)를 빌려 써서 요약이 나왔고,
      //   NEJM·Lancet 종설에 불필요한 '출처 성격' 평가가 붙었다.
      const card = await this.guideline.analyze(enriched, { mode: 'review' });
      if (!card) this.logger.warn('리뷰 번역이 카드를 못 냈다 — 카드 없이 발행한다', { pmid });
      return card ?? null;
    } catch (error) {
      this.logger.warn('리뷰 분석 실패 (non-fatal)', { pmid, err: error.message });
      return null;
    }
  }

  async _stageReview(todayStr) {
    const control = await this._loadControl();
    const mode = control.tracks.reviews.mode;
    if (mode === 'off') return { outcome: 'skipped', reason: 'track-off' };
    // ★ on/off·격일·순차진행 판정은 예고가 부르는 것과 **같은 함수**가 한다.
    if (!trackRunsOn('reviews', todayStr, { mode, sequential: control.sequential })) {
      return { outcome: 'skipped', reason: 'cadence-gate' };
    }

    let state = await loadTrackQueue(this.queueReviewsPath, 'reviews');
    const intervalDays = mode === 'alternate' ? intervalFor('reviews') * 2 : intervalFor('reviews');
    const todayDay = calendarDay(todayStr);
    const lastDay = calendarDay(state.lastRun?.date);
    if (todayDay !== null && lastDay !== null && todayDay - lastDay < intervalDays) {
      return { outcome: 'skipped', reason: 'weekly-gate' };
    }
    if (!state.queue.length) return { outcome: 'empty' };

    // ★ 발행 직전에 한 번 더 거른다 (PeterJ 지적 2026-08-17).
    //   저수지는 필터가 생기기 전에 만들어져 합의문·지침이 섞여 있다. 다시 만들지 않고
    //   **소비하면서 정화한다** — 걸린 것은 rejected 로 옮겨 다음 수집에 안 돌아오게 한다.
    //   (`rejected` 대조는 `mergeQueueItems` 가 이미 한다.)
    const dropped = [];
    let queue = state.queue;
    while (queue.length && !isNarrativeReview(queue[0])) {
      const bad = queue[0];
      this.logger.info('리뷰 아님 — 저수지에서 뺀다', {
        reason: notReviewReason(bad), title: String(bad.title ?? '').slice(0, 70),
      });
      dropped.push({ ...bad, rejectedAt: todayStr, rejectedReason: notReviewReason(bad) });
      queue = queue.slice(1);
    }
    if (dropped.length) {
      await saveTrackQueue(this.queueReviewsPath, {
        ...state, queue, rejected: [...(state.rejected ?? []), ...dropped], updatedAt: todayStr,
      });
      state = { ...state, queue, rejected: [...(state.rejected ?? []), ...dropped] };
    }
    if (!queue.length) return { outcome: 'empty' };

    // ★★ 큐 **배열 머리**를 집으면 안 된다 (2026-08-17 · LLM 셀렉을 붙이면서 드러났다).
    //   리뷰 큐는 종전에 `status` 도 정렬도 없어서 머리를 집는 것이 곧 순서였다.
    //   그 상태로 셀렉만 붙이면 `status:'needsReview'` 가 써지는데 **픽이 그 필드를
    //   쳐다보지 않아** 격리한 것이 그대로 발행된다 — 돌려도 아무것도 안 바뀌는 부류다.
    //   정렬·필터 정본은 `reviewRank` 하나이고, **예고 리스트가 쓰는 것과 같은 함수다**
    //   (다르면 화면이 "다음은 이것" 이라 해놓고 딴 게 나간다 — 결함 B2).
    const ranked = rankedPublishableReviews(queue);
    if (!ranked.length) return { outcome: 'empty', reason: 'all-quarantined' };
    const picked = ranked[0];
    const pickedKey = String(picked.pmid ?? picked.id ?? '');
    const remaining = state.queue.filter((x) => String(x?.pmid ?? x?.id ?? '') !== pickedKey);
    // ★ 번역·정리 카드를 여기서 만든다. 실패해도 발행은 계속된다(카드만 얇아진다).
    const card = await this._analyzeReview(picked);
    const published = { ...picked, publishedAt: todayStr, card };
    const next = {
      ...state,
      queue: remaining,
      published: [...state.published, published],
      lastRun: { date: todayStr, outcome: 'published', publishedId: picked.pmid ?? picked.id ?? null },
      updatedAt: todayStr,
    };
    await saveTrackQueue(this.queueReviewsPath, next);
    // 발행이 실패하면 호출부가 이것을 불러 큐를 되돌린다(B14). 되돌림은 **직전 상태를
    // 그대로 다시 쓴다** — 그 사이 다른 주체가 이 파일을 고치지 않는다(러너 단독 크론).
    const rollback = async () => { await saveTrackQueue(this.queueReviewsPath, state); };
    return { outcome: 'published', item: published, rollback };
  }

  async _stagePublish(topPapers, guideline = null, review = null) {
    if (!this.githubPublisher) return null;
    const entry = this._stageStart(STAGES.PUBLISHING);
    try {
      let guidelineState = null;
      try { guidelineState = await loadGuidelineState(this.guidelineListPath); }
      catch (error) { this.logger.warn('Guideline render state unavailable — keeping existing page', { err: error.message }); }
      const pagesUrl = await this.githubPublisher.publish(kstDateStr(), topPapers, { guideline, guidelineState, review });
      this._stageEnd(entry, 'ok', { pagesUrl });
      this.logger.info(`GitHub Pages 업데이트 완료: ${pagesUrl}`);
      return pagesUrl;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      this.logger.warn('GitHub Pages 업데이트 실패 (파이프라인은 계속)', { err: err.message });
      return null;
    }
  }

  /**
   * 텔레그램 리포트에 실을 트랙별 진행상황.
   * ★ 실패해도 리포트는 그대로 간다 — 진행상황은 부가 정보다.
   */
  async _buildProgressLines(todayStr) {
    try {
      const out = path.join(this.outputDir);
      const rj = async (f) => { try { return JSON.parse(await readFile(path.join(out, f), 'utf8')); } catch { return null; } };
      const [control, read, papers, guidelines, reviews] = await Promise.all([
        rj('control_state.json'), rj('read_state.json'),
        rj('queue_papers.json'), rj('selected_guidelines.json'), rj('queue_reviews.json'),
      ]);
      const ids = (st) => (st?.published ?? []).map((x) => String(x.pmid ?? x.id ?? '')).filter(Boolean);
      return buildProgressLines({
        today: todayStr, control, read,
        published: { papers: ids(papers), guidelines: ids(guidelines), reviews: ids(reviews) },
      });
    } catch (err) {
      this.logger.warn('진행상황 계산 실패 — 리포트는 그대로 간다', { err: err.message });
      return [];
    }
  }

  async _stageNotify(sessionId, paths, topPapers, pagesUrl = null) {
    if (!this.notifier) return null;
    const entry = this._stageStart('NOTIFYING');
    try {
      const result = await this.notifier.run(sessionId, paths, topPapers, pagesUrl);
      this._stageEnd(entry, 'ok', result);
      return result;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      // Non-fatal: 알림 실패해도 파이프라인은 성공
      this.logger.warn('알림 전송 실패 (파이프라인은 완료)', { err: err.message });
      return null;
    }
  }

  // ── Full pipeline run ─────────────────────────────────────────────────────
  async run(options = {}) {
    this.startTime = Date.now();
    llmTelemetry.reset(); // 이번 실행의 LLM 경로(구독/API) 집계 초기화
    this.logger.section(`TrendReview — Session: ${this.sessionId}`);
    this.logger.info('Pipeline starting', {
      sessionId: this.sessionId,
      resumeFrom: options.resumeFromSession ?? null,
    });

    let resumeCheckpoint = null;
    if (options.resumeFromSession) {
      resumeCheckpoint = await this._loadCheckpoint(options.resumeFromSession);
      if (resumeCheckpoint) {
        this.sessionId = options.resumeFromSession;
        this.checkpoint = resumeCheckpoint; // 이후 저장이 기존 데이터에 병합되도록
        this.logger.info(`Resuming session from stage: ${resumeCheckpoint.stage}`);
      } else {
        this.logger.warn(`No checkpoint found for session ${options.resumeFromSession} — running fresh`);
      }
    }

    try {
      // ★ 논문 트랙 게이트를 **수집보다 먼저** 본다 (코드리뷰 발견 B9).
      //   종전에는 수집·재순위·풀텍스트·PICO·검증(전부 LLM)을 다 돌린 뒤에야 게이트를
      //   보고 결과를 버렸다. 순차진행을 켜면 3일 중 2일이 그렇게 되어 **LLM 비용이 3배**다.
      //   더 나쁜 것은 정합성이다 — 리포트와 텔레그램은 게이트 이전 값을 쓰므로
      //   PeterJ 는 "오늘의 논문" 알림을 받는데 페이지에는 그 논문이 없다.
      //   여기서 막으면 셋이 같은 말을 한다.
      const todayStr = kstDateStr();
      const controlForRun = await this._loadControl();
      const papersDue = trackRunsOn('papers', todayStr,
        { mode: controlForRun.tracks.papers.mode, sequential: controlForRun.sequential });
      if (!papersDue) {
        this.logger.info('논문 트랙이 오늘은 쉰다 — 수집·분석을 건너뛴다', {
          today: todayStr, mode: controlForRun.tracks.papers.mode, sequential: controlForRun.sequential,
        });
        return this._runWithoutPapers(todayStr);
      }

      // Stage 1: Collect
      const { papers: rawPapers, stats: collectStats } = await this._stageCollect(
        resumeCheckpoint?.data?.collectionResult
      );

      if (!rawPapers.length) {
        this.logger.warn('No papers collected — aborting pipeline');
        this.state = STAGES.DONE;
        return this._buildResult(null, null, null, null, null, { warning: 'No papers found' });
      }

      // Stage 2: Validate (pass 1) — can run immediately after collect
      const { papers: validPapers, stats: validStats } = await this._stageValidate1(
        rawPapers,
        resumeCheckpoint?.data
      );

      if (!validPapers.length) {
        this.logger.warn('All papers excluded by validation — aborting pipeline');
        this.state = STAGES.DONE;
        return this._buildResult(null, null, null, null, null, {
          warning: 'All papers failed validation',
        });
      }

      // Stage 3: Score + select top-N — exclude already-published PMIDs
      const excludePmids = await this._loadExcludePmids();
      if (excludePmids.length) this.logger.info(`Excluding ${excludePmids.length} already-published PMIDs`);
      const selectionPapers = this._buildSelectionPool(validPapers, collectStats);
      await this._saveTrack1Queue(selectionPapers, kstDateStr(), excludePmids);
      const { topPapers: scoredTopPapers, allScoredPapers, rerank } = await this._stageAnalyze(
        selectionPapers,
        { excludePmids },
        resumeCheckpoint?.data
      );

      // Stage 4: Fetch full text for top-N papers only
      const enrichedTopPapers = await this._stageFetchFullText(
        scoredTopPapers,
        resumeCheckpoint?.data
      );

      // Stage 5: PICO analysis with full text
      const { topPapers, stats: picoStats } = await this._stagePicoAnalysis(
        enrichedTopPapers,
        resumeCheckpoint?.data
      );

      // Stage 6: Validate (pass 2) — depends on PICO analysis
      const { validated: validatedPico, qualityReport } = await this._stageValidate2(
        topPapers, allScoredPapers, validStats
      );

      // Stage 7: Report — depends on all upstream stages
      const totalElapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const executionStats = {
        sessionId: this.sessionId,
        searchDays: Number(process.env.SEARCH_DAYS ?? 180),
        totalElapsed: Number(totalElapsed),
        stages: this.executionLog,
        collect: collectStats,
        validate: validStats,
        pico: picoStats,
      };

      const payload = {
        topPapers: validatedPico,
        allScoredPapers,
        qualityReport,
        executionStats,
        generatedAt: new Date().toISOString(),
      };

      const { jsonPath, htmlPath } = await this._stageReport(this.sessionId, payload);

      // Stage 7a: 가이드라인 캐치업 (non-fatal, 없으면 null)
      const guidelineCard = await this._stageGuideline(todayStr);

      // 리뷰는 데일리 코어의 부가 arm이다. 큐 읽기·저장 어느 쪽이 실패해도 논문 발행은 계속한다.
      // ★ 리뷰 결과를 **발행 경로로 넘긴다.** 넘기지 않으면 큐만 소비되고 화면에는
      //   아무것도 안 나온다 — 2026-08-16 까지 실제로 그 상태였다(테스트는 전부 초록).
      let reviewItem = null;
      let reviewRollback = null;
      try {
        const r = await this._stageReview(todayStr);
        if (r?.outcome === 'published') { reviewItem = r.item; reviewRollback = r.rollback ?? null; }
      } catch (error) { this.logger.warn('Review stage failed (non-fatal)', { err: error.message }); }

      // 제외목록·가이드라인 기록을 publish 전에 저장 — publish가 이 파일들을
      // 커밋/푸시하므로, 순서가 뒤면 원격 목록이 항상 하루 늦어 중복 선정된다.
      // 단, 분석 실패(analysisError) fallback 카드는 제외목록에 넣지 않는다 —
      // 넣으면 제대로 분석 못 한 좋은 논문이 후보풀에서 영구 소진되므로, 다음 실행에서
      // 재선정·재분석되도록 남겨둔다.
      const excludable = validatedPico.filter((p) => !p.analysisError);
      if (excludable.length) await this._saveExcludePmids(excludable, rerank);
      if (guidelineCard) await this._saveGuideline(guidelineCard, todayStr);

      // Stage 7b: GitHub Pages 누적 업데이트 (optional — GITHUB_TOKEN 설정 시)
      const pagesUrl = await this._stagePublish(validatedPico, guidelineCard, reviewItem);
      // ★ 발행이 실패했으면 리뷰 큐 소비를 되돌린다 (코드리뷰 발견 B14).
      //   큐 전이는 발행보다 **먼저** 일어나고 `_stagePublish` 는 예외를 삼켜 null 을
      //   돌려준다. 되돌리지 않으면 그 리뷰는 published 로 기록돼 다시는 큐 머리에
      //   오지 않는데 카드는 어디에도 없다 — **화면에 한 번도 안 나온 채 영구 소멸한다.**
      //   논문 쪽은 같은 위험을 알고 제외목록 저장을 막아뒀는데 리뷰만 보호가 없었다.
      if (reviewItem && !pagesUrl && reviewRollback) {
        try {
          await reviewRollback();
          this.logger.warn('발행 실패 — 리뷰 큐 소비를 되돌렸다', { pmid: reviewItem.pmid ?? reviewItem.id });
        } catch (error) {
          this.logger.warn('리뷰 큐 롤백 실패 — 다음 실행에서 수동 확인 필요', { err: error.message });
        }
      }

      // Stage 8: Notify (optional — Google Drive 업로드, ENABLE_DRIVE 시에만)
      const notifyResult = await this._stageNotify(
        this.sessionId,
        { htmlPath, jsonPath },
        validatedPico,
        pagesUrl
      );

      this.state = STAGES.DONE;
      this.logger.info(`Pipeline DONE in ${totalElapsed}s`, { jsonPath, htmlPath });

      // Save execution log
      await this.logger.saveSession(this.sessionId);

      return this._buildResult(
        validatedPico, allScoredPapers, qualityReport, executionStats,
        { jsonPath, htmlPath },
        {
          ...(pagesUrl && { pagesUrl }),
          ...(notifyResult && { notification: notifyResult }),
          // ★ 가이드라인·리뷰를 결과에 실어 보낸다 (2026-08-18). 진입점이 그날 md 첨부를
          //   만들려면 **세 트랙 분석이 다 있어야** 한다 — 종전에는 `topPapers` 만 나가서
          //   진입점이 논문 말고는 아무것도 볼 수 없었다. 발행에 쓰인 것과 **같은 객체**를
          //   그대로 넘긴다(다시 만들면 첨부와 화면이 갈린다).
          guideline: guidelineCard ?? null,
          review: reviewItem ?? null,
        }
      );
    } catch (err) {
      this.state = STAGES.FAILED;
      this.logger.error('Pipeline FAILED', { err: err.message, state: this.state });
      await this.logger.saveSession(this.sessionId);
      throw err;
    }
  }

  /**
   * 논문 트랙이 쉬는 날의 실행 (순차진행 ON 또는 논문 토글 OFF).
   *
   * ★ 왜 별도 경로인가 (코드리뷰 발견 B9) — 종전에는 전체 파이프라인을 다 돌린 뒤
   *   결과만 버렸다. LLM 비용이 그대로 나가고, 무엇보다 리포트·텔레그램이 **버려질
   *   논문을 그대로 알렸다.** PeterJ 는 "오늘의 논문" 알림을 받는데 페이지에는 그
   *   논문이 없는 상태가 된다. 여기서는 **애초에 논문을 안 뽑는다.**
   *
   * ★ 가이드라인·리뷰는 그대로 돈다. 순차진행의 요지가 "하루 한 트랙" 이므로
   *   논문이 쉬는 날은 다른 트랙 차례다.
   * ★ `topPapers` 는 빈 배열로 돌려준다 — 진입점이 이 값으로 텔레그램을 만들기 때문에,
   *   비워야 "논문 없음" 이 그대로 전달된다.
   */
  async _runWithoutPapers(todayStr) {
    let guidelineCard = null;
    try { guidelineCard = await this._stageGuideline(todayStr); }
    catch (error) { this.logger.warn('Guideline stage failed (non-fatal)', { err: error.message }); }

    let reviewItem = null;
    let reviewRollback = null;
    try {
      const r = await this._stageReview(todayStr);
      if (r?.outcome === 'published') { reviewItem = r.item; reviewRollback = r.rollback ?? null; }
    } catch (error) { this.logger.warn('Review stage failed (non-fatal)', { err: error.message }); }

    if (guidelineCard) await this._saveGuideline(guidelineCard, todayStr);

    const pagesUrl = await this._stagePublish([], guidelineCard, reviewItem);
    if (reviewItem && !pagesUrl && reviewRollback) {
      try { await reviewRollback(); this.logger.warn('발행 실패 — 리뷰 큐 소비를 되돌렸다'); }
      catch (error) { this.logger.warn('리뷰 큐 롤백 실패', { err: error.message }); }
    }

    this.state = STAGES.DONE;
    return this._buildResult([], null, null, null, null, {
      pagesUrl,
      skipped: 'papers',
      // 그날 md 첨부는 논문이 쉬는 날에도 나가야 한다 — 그날 나간 것이 이 둘뿐이다.
      guideline: guidelineCard ?? null,
      review: reviewItem ?? null,
      guidelinePublished: Boolean(guidelineCard),
      reviewPublished: Boolean(reviewItem),
    });
  }

  _buildResult(topPapers, allPapers, qualityReport, stats, paths, extra = {}) {
    return {
      sessionId: this.sessionId,
      state: this.state,
      topPapers: topPapers ?? [],
      totalPapers: allPapers?.length ?? 0,
      qualityReport,
      executionStats: stats,
      outputPaths: paths,
      ...extra,
    };
  }

  // ── Partial re-execution: resume a failed session ─────────────────────────
  async resume(sessionId) {
    this.logger.info(`Attempting resume of session: ${sessionId}`);
    return this.run({ resumeFromSession: sessionId });
  }

  getState() {
    return {
      sessionId: this.sessionId,
      state: this.state,
      stages: this.executionLog,
      circuitBreakers: {
        pubmed: this.collector.cb.getStatus(),
        claude: this.filter.cb.getStatus(),
      },
    };
  }
}
