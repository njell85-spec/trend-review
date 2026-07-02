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
    this.filter = new FilterAnalyzerAgent({ topN: options.topN });
    this.guideline = new GuidelineAnalyzerAgent();
    this.fullText = new FullTextAgent();
    this.validator = new ValidationAgent();
    this.reporter = new ReportGeneratorAgent({ outputDir: this.outputDir });
    this.notifier = options.notify
      ? new NotificationAgent({
          credentialsPath: options.credentialsPath,
          recipientEmail: options.notifyEmail,
        })
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
    // 가이드라인 캐치업 노출 기록 (주 1회 게이트 + 중복 방지)
    this.guidelineListPath = path.join(this.outputDir, 'selected_guidelines.json');
    this.guidelineIntervalDays = options.guidelineIntervalDays ?? 7;
  }

  // ── 가이드라인 노출 기록 ──────────────────────────────────────────────────────
  async _loadSeenGuidelines() {
    try {
      const raw = await readFile(this.guidelineListPath, 'utf8');
      return JSON.parse(raw);
    } catch { return []; }
  }

  // 주 1회 게이트: 마지막 가이드라인 노출이 N일 이상 지났거나(또는 없음) 시도.
  _guidelineDue(seen, todayStr) {
    if (!seen.length) return true;
    const last = seen.reduce((a, b) => (a.date > b.date ? a : b));
    const days = Math.round((new Date(todayStr) - new Date(last.date)) / 86_400_000);
    return days >= this.guidelineIntervalDays;
  }

  async _saveGuideline(card, todayStr) {
    const seen = await this._loadSeenGuidelines();
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

  async _saveExcludePmids(newPapers) {
    let existing = [];
    try {
      const raw = await readFile(this.excludeListPath, 'utf8');
      existing = JSON.parse(raw);
    } catch { /* first run */ }

    const today = new Date().toISOString().slice(0, 10);
    const added = newPapers.map((p) => ({
      pmid: p.paper?.pmid ?? p.pmid,
      title: (p.paper?.title ?? p.title ?? '').slice(0, 80),
      date: today,
    }));

    const merged = [...existing, ...added];
    if (!existsSync(this.outputDir)) await mkdir(this.outputDir, { recursive: true });
    await writeFile(this.excludeListPath, JSON.stringify(merged, null, 2));
    this.logger.info(`Exclusion list updated: ${merged.length} total PMIDs tracked`);
  }

  _newSessionId() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `trend_review_${date}_${time}`;
  }

  // ── Checkpoint persistence ────────────────────────────────────────────────
  async _saveCheckpoint(stage, data) {
    if (!existsSync(this.checkpointDir))
      await mkdir(this.checkpointDir, { recursive: true });
    const filePath = path.join(this.checkpointDir, `${this.sessionId}.json`);
    const checkpoint = { sessionId: this.sessionId, stage, savedAt: new Date().toISOString(), data };
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
        return resumeData;
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

  async _stageAnalyze(papers, excludePmids = [], resumeData = null) {
    const entry = this._stageStart(STAGES.ANALYZING);
    try {
      if (resumeData?.allScoredPapers) {
        this.logger.info('Resuming from checkpoint — skipping scoring');
        this._stageEnd(entry, 'resumed');
        return resumeData;
      }

      const result = await this.filter.runScoringOnly(papers, excludePmids);
      await this._saveCheckpoint(STAGES.ANALYZING, {
        topPapers: result.topPapers,
        allScoredPapers: result.allScoredPapers,
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

  // ── 가이드라인 캐치업 (주 1회, 없으면 건너뜀) ────────────────────────────────
  // 실패해도 데일리 논문 파이프라인에 영향 없도록 완전 non-fatal.
  async _stageGuideline(todayStr) {
    const entry = this._stageStart('GUIDELINE');
    try {
      const seen = await this._loadSeenGuidelines();
      if (!this._guidelineDue(seen, todayStr)) {
        this.logger.info('Guideline gate: not due yet — skipping');
        this._stageEnd(entry, 'skipped', { reason: 'not-due' });
        return null;
      }

      const guidelines = await this.collector.collectGuidelines();
      const pick = this.guideline.selectNew(guidelines, seen.map((s) => s.pmid));
      if (!pick) {
        this.logger.info('No new guideline available — skipping');
        this._stageEnd(entry, 'skipped', { reason: 'none-new' });
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

      const card = await this.guideline.analyze(enriched);
      if (!card) {
        this._stageEnd(entry, 'skipped', { reason: 'analysis-failed' });
        return null;
      }
      this._stageEnd(entry, 'ok', { pmid: card.paper?.pmid, org: card.org });
      return card;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      this.logger.warn('Guideline stage failed (non-fatal)', { err: err.message });
      return null;
    }
  }

  async _stagePublish(topPapers, guideline = null) {
    if (!this.githubPublisher) return null;
    const entry = this._stageStart(STAGES.PUBLISHING);
    try {
      // KST 기준 날짜 사용 (21:30 UTC = 06:30 KST → UTC 날짜는 하루 빠름)
      const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      const pagesUrl = await this.githubPublisher.publish(dateStr, topPapers, { guideline });
      this._stageEnd(entry, 'ok', { pagesUrl });
      this.logger.info(`GitHub Pages 업데이트 완료: ${pagesUrl}`);
      return pagesUrl;
    } catch (err) {
      this._stageEnd(entry, 'error', { err: err.message });
      this.logger.warn('GitHub Pages 업데이트 실패 (파이프라인은 계속)', { err: err.message });
      return null;
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
        this.logger.info(`Resuming session from stage: ${resumeCheckpoint.stage}`);
      }
    }

    try {
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
      const { topPapers: scoredTopPapers, allScoredPapers } = await this._stageAnalyze(
        validPapers,
        excludePmids,
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

      // Stage 5: Report — depends on all upstream stages
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

      // Stage 7a: 가이드라인 캐치업 (주 1회, non-fatal, 없으면 null)
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      const guidelineCard = await this._stageGuideline(todayStr);

      // Stage 7b: GitHub Pages 누적 업데이트 (optional — GITHUB_TOKEN 설정 시)
      const pagesUrl = await this._stagePublish(validatedPico, guidelineCard);

      // Save newly-published PMIDs to exclusion list
      if (validatedPico.length) await this._saveExcludePmids(validatedPico);
      if (guidelineCard) await this._saveGuideline(guidelineCard, todayStr);

      // Stage 8: Notify (optional — Drive + Gmail + KakaoTalk)
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

      return this._buildResult(validatedPico, allScoredPapers, qualityReport, executionStats, {
        jsonPath,
        htmlPath,
        ...(notifyResult && { notification: notifyResult }),
      });
    } catch (err) {
      this.state = STAGES.FAILED;
      this.logger.error('Pipeline FAILED', { err: err.message, state: this.state });
      await this.logger.saveSession(this.sessionId);
      throw err;
    }
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
