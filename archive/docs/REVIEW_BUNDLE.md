# Trend Review — 코드 검토 묶음 (Source Bundle)

생성일: 2026-06-20 15:34

> 이 파일은 다른 LLM/Claude 웹에 코드 검토를 요청하기 위한 전체 소스 묶음입니다.
> 비밀키 파일(.env, credentials.json, google_token.json)과 output/ 캐시는 의도적으로 제외했습니다.

---

## 포함된 파일 목록

- `package.json`
- `src/index.js`
- `src/orchestrator/TrendReviewOrchestrator.js`
- `src/agents/DataCollectorAgent.js`
- `src/agents/ValidationAgent.js`
- `src/agents/FilterAnalyzerAgent.js`
- `src/agents/FullTextAgent.js`
- `src/agents/ReportGeneratorAgent.js`
- `src/agents/NotificationAgent.js`
- `src/utils/LLMClient.js`
- `src/utils/Cache.js`
- `src/utils/CircuitBreaker.js`
- `src/utils/RetryHelper.js`
- `src/utils/Logger.js`
- `src/utils/GitHubPublisher.js`
- `fetch_papers_action.yml`
- `fetch_papers_task.ps1`

---

## `package.json`

```json
{
  "name": "trend-review",
  "version": "1.0.0",
  "description": "Trend Review — EM/CCM Daily Literature Review System",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test:collector": "node --experimental-vm-modules src/agents/DataCollectorAgent.js",
    "test:filter": "node src/agents/FilterAnalyzerAgent.js",
    "test:validator": "node src/agents/ValidationAgent.js",
    "test:reporter": "node src/agents/ReportGeneratorAgent.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.36.0",
    "dotenv": "^16.4.0",
    "googleapis": "^173.0.0",
    "openai": "^6.42.0",
    "xml2js": "^0.6.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## `src/index.js`

```javascript
/**
 * Trend Review Agent — Entry Point
 *
 * Usage:
 *   node src/index.js                             # full run (last 30 days)
 *   node src/index.js --days 14                   # last 14 days
 *   node src/index.js --max 20 --top 5            # custom limits
 *   node src/index.js --resume trend_review_...   # resume failed session
 *   node src/index.js --dry-run                   # smoke test (no API calls)
 */
import 'dotenv/config';
import path from 'path';
import { TrendReviewOrchestrator } from './orchestrator/TrendReviewOrchestrator.js';
import { Logger } from './utils/Logger.js';

const log = new Logger('Main');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--days':       opts.searchDays = Number(args[++i]); break;
      case '--max':        opts.maxPapers  = Number(args[++i]); break;
      case '--top':        opts.topN       = Number(args[++i]); break;
      case '--resume':     opts.resumeFromSession = args[++i];  break;
      case '--dry-run':    opts.dryRun   = true;                break;
      case '--output':     opts.outputDir = args[++i];          break;
      case '--notify':     opts.notify = true; opts.notifyEmail = args[++i]; break;
      case '--credentials': opts.credentialsPath = args[++i];   break;
    }
  }
  return opts;
}

async function dryRun() {
  log.section('Dry Run — Smoke Test');
  log.info('Validating environment…');

  const checks = [
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', required: true },
    { key: 'PUBMED_API_KEY',    label: 'PubMed API Key',    required: false },
    { key: 'PUBMED_EMAIL',      label: 'PubMed Email',      required: false },
  ];

  let allOk = true;
  for (const { key, label, required } of checks) {
    const val = process.env[key];
    if (val) {
      log.info(`  ✓ ${label}: ${'*'.repeat(Math.min(val.length, 8))}…`);
    } else if (required) {
      log.error(`  ✗ ${label}: NOT SET (required)`);
      allOk = false;
    } else {
      log.warn(`  ○ ${label}: not set (optional)`);
    }
  }

  if (!allOk) {
    log.error('Missing required environment variables. Copy .env.example to .env and fill in your API key.');
    process.exit(1);
  }

  // Module import smoke test
  const { DataCollectorAgent } = await import('./agents/DataCollectorAgent.js');
  const { FilterAnalyzerAgent } = await import('./agents/FilterAnalyzerAgent.js');
  const { ValidationAgent } = await import('./agents/ValidationAgent.js');
  const { ReportGeneratorAgent } = await import('./agents/ReportGeneratorAgent.js');
  const { CircuitBreaker } = await import('./utils/CircuitBreaker.js');
  const { RetryHelper } = await import('./utils/RetryHelper.js');

  log.info('All modules imported successfully');

  // Validation agent smoke test (no API needed)
  const validator = new ValidationAgent();
  const mockPaper = {
    pmid: 'test001',
    title: 'Septic Shock Resuscitation in the Emergency Department: An RCT',
    abstract:
      'Background: Septic shock mortality remains high. Methods: We randomized 200 patients to restrictive vs liberal fluid resuscitation. Primary outcome: 28-day mortality. Results: 28-day mortality 22% vs 30% (p=0.04). ICU LOS reduced by 1.5 days.',
    authors: ['Smith J', 'Lee K'],
    journal: 'Ann Emerg Med',
    pubDate: '2024-11',
    meshTerms: ['Septic Shock', 'Emergency Medicine', 'Fluid Therapy'],
    keywords: ['sepsis'],
    pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/test001/',
    collectedAt: new Date().toISOString(),
  };
  const vResult = validator.validatePaper(mockPaper);
  log.info(`Validation smoke test: ${vResult.valid ? 'PASS' : 'FAIL'}`, {
    qualityScore: vResult.qualityScore,
  });

  // Circuit breaker smoke test
  const cb = new CircuitBreaker('test');
  let cbPassed = false;
  try {
    await cb.execute(async () => { throw new Error('test'); });
  } catch {
    cbPassed = true;
  }
  log.info(`Circuit breaker smoke test: ${cbPassed ? 'PASS' : 'FAIL'}`);

  log.info('\nDry run complete — system ready. Set ANTHROPIC_API_KEY and run without --dry-run to start.');
}

async function main() {
  const opts = parseArgs();

  if (opts.dryRun) {
    await dryRun();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY가 비활성화되어 있습니다 (의도된 설정).');
    log.info('분석은 API 과금이 아니라 Claude 구독으로 수행합니다:');
    log.info('  · 매일 자동 = 클라우드 루틴(trig_01VVjt2nEzy62dqQSoi55cA9)');
    log.info('  · 수동 실행 = Claude Code에 "Go" 입력 → 루틴 즉시 실행');
    log.info('굳이 로컬에서 API로 돌리려면 .env에 본인 명의 키를 넣으세요.');
    log.info('수집/발행 등 비-AI 단계만 검증하려면 --dry-run 사용.');
    process.exit(1);
  }

  const orchestrator = new TrendReviewOrchestrator({
    searchDays:      opts.searchDays,
    maxPapers:       opts.maxPapers,
    topN:            opts.topN,
    outputDir:       opts.outputDir,
    notify:          opts.notify,
    notifyEmail:     opts.notifyEmail ?? process.env.NOTIFY_EMAIL,
    credentialsPath: opts.credentialsPath ?? process.env.GOOGLE_CREDENTIALS_PATH,
  });

  try {
    let result;
    if (opts.resumeFromSession) {
      result = await orchestrator.resume(opts.resumeFromSession);
    } else {
      result = await orchestrator.run();
    }

    // ── Final summary ────────────────────────────────────────────────────
    log.section('Pipeline Complete');
    log.info(`Session: ${result.sessionId}`);
    log.info(`State:   ${result.state}`);
    log.info(`Papers:  ${result.totalPapers} collected → ${result.topPapers.length} top selected`);
    log.info(`Total time: ${result.executionStats?.totalElapsed}s`);

    if (result.outputPaths) {
      log.info('');
      log.info('Output files:');
      log.info(`  HTML Dashboard : ${result.outputPaths.htmlPath}`);
      log.info(`  JSON Archive   : ${result.outputPaths.jsonPath}`);
      log.info('');
      log.info('Open the HTML file in a browser to view the interactive dashboard.');
    }

    if (result.notification) {
      log.info('');
      log.info('Google 알림:');
      log.info(`  Drive 대시보드 : ${result.notification.driveHtmlUrl}`);
      log.info(`  Drive JSON    : ${result.notification.driveJsonUrl}`);
      log.info(`  이메일 발송   : ${result.notification.sentTo}`);
    }

    if (result.warning) {
      log.warn(result.warning);
    }

    process.exit(0);
  } catch (err) {
    log.error('Fatal pipeline error', { err: err.message });
    const state = orchestrator.getState();
    log.info(`Last completed stage: ${state.stages.at(-1)?.stage ?? 'none'}`);
    log.info(`재시작: node src/index.js --resume ${state.sessionId}`);
    process.exit(1);
  }
}

main();
```

## `src/orchestrator/TrendReviewOrchestrator.js`

```javascript
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

  async _stageAnalyze(papers, resumeData = null) {
    const entry = this._stageStart(STAGES.ANALYZING);
    try {
      if (resumeData?.allScoredPapers) {
        this.logger.info('Resuming from checkpoint — skipping scoring');
        this._stageEnd(entry, 'resumed');
        return resumeData;
      }

      const result = await this.filter.runScoringOnly(papers);
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

  async _stagePublish(topPapers) {
    if (!this.githubPublisher) return null;
    const entry = this._stageStart(STAGES.PUBLISHING);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const pagesUrl = await this.githubPublisher.publish(dateStr, topPapers);
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

      // Stage 3: Score + select top-N — depends on validated papers
      const { topPapers: scoredTopPapers, allScoredPapers } = await this._stageAnalyze(
        validPapers,
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
        searchDays: Number(process.env.SEARCH_DAYS ?? 30),
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

      // Stage 7: GitHub Pages 누적 업데이트 (optional — GITHUB_TOKEN 설정 시)
      const pagesUrl = await this._stagePublish(validatedPico);

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
```

## `src/agents/DataCollectorAgent.js`

```javascript
/**
 * DataCollectorAgent
 * MCP bindings: fetch (PubMed API), time (date window), filesystem (cache write)
 *
 * Collects EM/CCM/Sepsis papers from PubMed E-utilities for the past N days,
 * returning structured paper objects ready for downstream analysis.
 */
import { parseStringPromise } from 'xml2js';
import { Logger } from '../utils/Logger.js';
import { Cache } from '../utils/Cache.js';
import { CircuitBreaker } from '../utils/CircuitBreaker.js';
import { RetryHelper } from '../utils/RetryHelper.js';

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_QUERY =
  '"emergency medicine"[MeSH] OR "critical care"[MeSH] OR "sepsis"[MeSH]';

export class DataCollectorAgent {
  constructor(options = {}) {
    this.logger = new Logger('DataCollectorAgent', { logFile: 'data_collector.jsonl' });
    this.cache = new Cache({ ttlHours: Number(process.env.CACHE_TTL_HOURS ?? 24) });
    this.cb = new CircuitBreaker('PubMed-API');
    this.retry = new RetryHelper({ maxAttempts: 3, baseDelayMs: 2_000 });

    this.apiKey = process.env.PUBMED_API_KEY ?? '';
    this.email = process.env.PUBMED_EMAIL ?? 'research@example.com';
    this.maxPapers = options.maxPapers ?? Number(process.env.MAX_PAPERS ?? 50);
    this.searchDays = options.searchDays ?? Number(process.env.SEARCH_DAYS ?? 30);
    this.query = options.query ?? DEFAULT_QUERY;
  }

  // ── MCP: time — compute search date window ────────────────────────────────
  _getDateRange() {
    const now = new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - this.searchDays);
    const fmt = (d) =>
      `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    return { minDate: fmt(past), maxDate: fmt(now) };
  }

  _buildParams(extra = {}) {
    const p = new URLSearchParams({
      tool: 'TrendReviewAgent',
      email: this.email,
      ...(this.apiKey && { api_key: this.apiKey }),
      ...extra,
    });
    return p.toString();
  }

  // ── MCP: fetch — HTTP calls to PubMed ────────────────────────────────────
  async _fetchJson(url) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`PubMed HTTP ${res.status}: ${url}`);
          return res.json();
        },
        {
          label: 'PubMed-fetch',
          onRetry: ({ attempt, delay }) =>
            this.logger.warn(`Retry ${attempt} in ${Math.round(delay)}ms`, { url }),
        }
      )
    );
  }

  async _fetchXml(url) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`PubMed HTTP ${res.status}`);
          const text = await res.text();
          return parseStringPromise(text, { explicitArray: false, ignoreAttrs: false });
        },
        { label: 'PubMed-xml' }
      )
    );
  }

  // ── Search: get PMIDs ─────────────────────────────────────────────────────
  // Always fetches fresh results — esearch is a single fast call and the 30-day
  // window shifts daily, so caching PMIDs would risk serving stale candidate sets.
  async searchPmids() {
    const { minDate, maxDate } = this._getDateRange();
    this.logger.info('Searching PubMed (fresh)', { query: this.query, minDate, maxDate });

    const params = this._buildParams({
      db: 'pubmed',
      term: this.query,
      retmax: this.maxPapers,
      mindate: minDate,
      maxdate: maxDate,
      datetype: 'pdat',
      retmode: 'json',
      sort: 'date',
    });

    const data = await this._fetchJson(`${PUBMED_BASE}/esearch.fcgi?${params}`);
    const result = data?.esearchresult;
    if (!result) throw new Error('Unexpected PubMed esearch response');

    const ids = result.idlist ?? [];
    this.logger.info(`Found ${result.count} total, retrieved ${ids.length} PMIDs`, {
      count: result.count,
    });
    return ids;
  }

  // ── Fetch article details in batches ─────────────────────────────────────
  async fetchArticles(pmids) {
    const BATCH = 10;
    const articles = [];

    for (let i = 0; i < pmids.length; i += BATCH) {
      const batch = pmids.slice(i, i + BATCH);
      const cacheKey = `articles_${batch.join('_')}`;

      const { data: batchData, fromCache } = await this.cache.getOrFetch(
        cacheKey,
        async () => {
          this.logger.debug(`Fetching batch ${Math.floor(i / BATCH) + 1}`, {
            ids: batch,
          });

          const params = this._buildParams({
            db: 'pubmed',
            id: batch.join(','),
            rettype: 'abstract',
            retmode: 'xml',
          });

          const xml = await this._fetchXml(`${PUBMED_BASE}/efetch.fcgi?${params}`);
          return this._parseArticles(xml);
        }
      );

      if (fromCache) this.logger.debug(`Batch ${Math.floor(i / BATCH) + 1} from cache`);
      articles.push(...batchData);

      // Rate limit: PubMed allows 10 req/sec with API key, 3/sec without
      if (!this.apiKey && i + BATCH < pmids.length) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    return articles;
  }

  // ── XML → structured paper object ────────────────────────────────────────
  _parseArticles(xml) {
    const articles = [];
    const set = xml?.PubmedArticleSet?.PubmedArticle;
    if (!set) return articles;

    const items = Array.isArray(set) ? set : [set];

    for (const item of items) {
      try {
        const medline = item?.MedlineCitation;
        const article = medline?.Article;
        if (!article) continue;

        const pmid = medline?.PMID?._ ?? medline?.PMID ?? '';
        const title = article?.ArticleTitle?._ ?? article?.ArticleTitle ?? '';

        // Abstract
        let abstract = '';
        const ab = article?.Abstract?.AbstractText;
        if (Array.isArray(ab)) {
          abstract = ab
            .map((a) => {
              const label = a?.$?.Label ? `${a.$.Label}: ` : '';
              return `${label}${a?._ ?? a ?? ''}`;
            })
            .join('\n');
        } else {
          abstract = ab?._ ?? ab ?? '';
        }

        // Authors
        const authorList = article?.AuthorList?.Author;
        const authors = this._parseAuthors(authorList);

        // Journal
        const journal = article?.Journal;
        const journalName =
          journal?.Title ?? journal?.ISOAbbreviation ?? '';
        const pubDate = this._parsePubDate(journal?.JournalIssue?.PubDate);

        // MeSH
        const meshList = medline?.MeshHeadingList?.MeshHeading;
        const meshTerms = this._parseMesh(meshList);

        // Keywords
        const kwList = medline?.KeywordList?.Keyword;
        const keywords = kwList
          ? (Array.isArray(kwList) ? kwList : [kwList]).map(
              (k) => k?._ ?? k ?? ''
            )
          : [];

        // DOI + PMCID (for full-text retrieval)
        const articleIds = item?.PubmedData?.ArticleIdList?.ArticleId;
        const idList = Array.isArray(articleIds) ? articleIds : articleIds ? [articleIds] : [];
        const doi = idList.find((id) => id?.$?.IdType === 'doi')?._
          ?? idList.find((id) => id?.$?.IdType === 'doi')
          ?? '';
        const pmcid = idList.find((id) => id?.$?.IdType === 'pmc')?._
          ?? idList.find((id) => id?.$?.IdType === 'pmc')
          ?? '';

        articles.push({
          pmid: String(pmid),
          title: String(title),
          abstract: String(abstract),
          authors,
          journal: String(journalName),
          pubDate,
          meshTerms,
          keywords,
          doi: String(doi),
          pmcid: String(pmcid),
          pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          collectedAt: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn('Failed to parse article', { err: err.message });
      }
    }

    return articles;
  }

  _parseAuthors(authorList) {
    if (!authorList) return [];
    const items = Array.isArray(authorList) ? authorList : [authorList];
    return items
      .slice(0, 6)
      .map((a) => {
        const last = a?.LastName ?? '';
        const initials = a?.Initials ?? '';
        return `${last} ${initials}`.trim();
      })
      .filter(Boolean);
  }

  _parsePubDate(pubDate) {
    if (!pubDate) return '';
    const year = pubDate?.Year ?? '';
    const month = pubDate?.Month ?? pubDate?.MedlineDate?.split(' ')[1] ?? '';
    const day = pubDate?.Day ?? '';
    return [year, month, day].filter(Boolean).join('-');
  }

  _parseMesh(meshList) {
    if (!meshList) return [];
    const items = Array.isArray(meshList) ? meshList : [meshList];
    return items
      .map((m) => m?.DescriptorName?._ ?? m?.DescriptorName ?? '')
      .filter(Boolean)
      .slice(0, 10);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run() {
    this.logger.section('DataCollectorAgent — PubMed Collection');
    const start = Date.now();

    try {
      const pmids = await this.searchPmids();
      if (!pmids.length) {
        this.logger.warn('No PMIDs found for query');
        return { papers: [], stats: { pmidsFound: 0, articlesCollected: 0 } };
      }

      const papers = await this.fetchArticles(pmids);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      const stats = {
        pmidsFound: pmids.length,
        articlesCollected: papers.length,
        withAbstracts: papers.filter((p) => p.abstract.length > 50).length,
        elapsedSeconds: Number(elapsed),
        circuitBreaker: this.cb.getStatus(),
      };

      this.logger.info('Collection complete', stats);
      return { papers, stats };
    } catch (err) {
      this.logger.error('Collection failed', { err: err.message, stack: err.stack });
      throw err;
    }
  }
}

// ── Standalone test ───────────────────────────────────────────────────────
if (process.argv[1].endsWith('DataCollectorAgent.js')) {
  const agent = new DataCollectorAgent({ maxPapers: 5, searchDays: 30 });
  const result = await agent.run();
  console.log(`\nCollected ${result.papers.length} papers`);
  if (result.papers[0]) {
    console.log('\nFirst paper:', result.papers[0].title);
  }
}
```

## `src/agents/ValidationAgent.js`

```javascript
/**
 * ValidationAgent
 * MCP bindings: filesystem (read/write quality reports)
 *
 * Two-pass medical domain validation:
 *   Pass 1 (pre-analysis): filter incomplete papers before expensive Claude calls
 *   Pass 2 (post-analysis): verify PICO completeness and cross-check consistency
 */
import { Logger } from '../utils/Logger.js';

const EM_CCM_MESH_TERMS = new Set([
  'Emergency Medicine', 'Emergency Service, Hospital', 'Critical Care',
  'Intensive Care Units', 'Sepsis', 'Septic Shock', 'Shock, Septic',
  'Resuscitation', 'Cardiopulmonary Resuscitation', 'Heart Arrest',
  'Respiratory Insufficiency', 'Acute Kidney Injury', 'Multiple Organ Failure',
  'Airway Management', 'Intubation, Intratracheal', 'Fluid Therapy',
  'Mechanical Ventilation', 'Respiration, Artificial', 'Hemodynamics',
  'Vasopressors', 'Norepinephrine', 'Dopamine', 'Epinephrine',
  'Triage', 'Point-of-Care Testing', 'Ultrasound', 'Echocardiography',
  'Trauma', 'Wounds and Injuries', 'Burns', 'Poisoning',
  'Shock', 'Anaphylaxis', 'Stroke', 'Myocardial Infarction',
]);

const EM_CCM_KEYWORDS = [
  'emergency', 'critical care', 'intensive care', 'icu', 'sepsis',
  'septic shock', 'resuscitation', 'airway', 'intubation', 'ventilation',
  'hemodynamic', 'vasopressor', 'trauma', 'cardiac arrest', 'cpr',
  'triage', 'acute', 'shock', 'mortality', 'organ failure',
];

export class ValidationAgent {
  constructor(options = {}) {
    this.logger = new Logger('ValidationAgent', { logFile: 'validation.jsonl' });
    this.minAbstractLength = options.minAbstractLength ?? 100;
    this.minTitleLength = options.minTitleLength ?? 10;
    this.strictMode = options.strictMode ?? false;
  }

  // ── Pass 1: Pre-analysis paper validation ────────────────────────────────
  validatePaper(paper) {
    const issues = [];
    const warnings = [];

    // Required field checks
    if (!paper.pmid) issues.push('Missing PMID');
    if (!paper.title || paper.title.length < this.minTitleLength)
      issues.push(`Title too short (${paper.title?.length ?? 0} chars)`);
    if (!paper.abstract || paper.abstract.length < this.minAbstractLength)
      issues.push(`Abstract too short (${paper.abstract?.length ?? 0} chars)`);

    // EM/CCM relevance check
    const relevanceScore = this._computeRelevance(paper);
    if (relevanceScore === 0)
      warnings.push('No EM/CCM MeSH terms or keywords detected');
    else if (relevanceScore < 2)
      warnings.push('Low EM/CCM relevance signal');

    // Abstract quality checks
    if (paper.abstract && paper.abstract.length > 50) {
      const hasNumerics = /\d+(\.\d+)?%|\d+\/\d+|p\s*[<=>]\s*0\.\d+|OR|RR|HR|CI/i.test(paper.abstract);
      if (!hasNumerics) warnings.push('Abstract lacks quantitative results');
    }

    if (!paper.journal) warnings.push('Missing journal name');
    if (!paper.pubDate) warnings.push('Missing publication date');
    if (!paper.authors?.length) warnings.push('Missing authors');

    const qualityScore = this._computeQualityScore(paper, issues, warnings, relevanceScore);

    return {
      pmid: paper.pmid,
      valid: issues.length === 0,
      issues,
      warnings,
      qualityScore,
      relevanceScore,
      pass: 1,
    };
  }

  _computeRelevance(paper) {
    let score = 0;
    const textLower = `${paper.title} ${paper.abstract}`.toLowerCase();

    // MeSH term match (high weight)
    for (const mesh of paper.meshTerms ?? []) {
      if (EM_CCM_MESH_TERMS.has(mesh)) score += 2;
    }

    // Keyword match in text (lower weight)
    for (const kw of EM_CCM_KEYWORDS) {
      if (textLower.includes(kw)) score += 1;
    }

    return score;
  }

  _computeQualityScore(paper, issues, warnings, relevanceScore) {
    let score = 10;
    score -= issues.length * 3;
    score -= warnings.length * 1;
    score += Math.min(relevanceScore, 5);
    score += paper.abstract?.length > 300 ? 1 : 0;
    score += paper.meshTerms?.length > 3 ? 1 : 0;
    return Math.max(0, Math.min(10, score));
  }

  validatePapers(papers) {
    this.logger.section('ValidationAgent — Pass 1: Pre-analysis Filtering');
    const results = papers.map((p) => this.validatePaper(p));

    const valid = results.filter((r) => r.valid);
    const invalid = results.filter((r) => !r.valid);

    invalid.forEach((r) => {
      this.logger.warn(`PMID ${r.pmid} excluded`, { issues: r.issues });
    });

    this.logger.info(`Validation: ${valid.length}/${papers.length} papers passed`, {
      excluded: invalid.length,
      avgQuality: (valid.reduce((s, r) => s + r.qualityScore, 0) / (valid.length || 1)).toFixed(1),
    });

    const validPmids = new Set(valid.map((r) => r.pmid));
    return {
      papers: papers.filter((p) => validPmids.has(p.pmid)),
      validationResults: results,
      stats: {
        total: papers.length,
        valid: valid.length,
        excluded: invalid.length,
        avgQualityScore: parseFloat(
          (valid.reduce((s, r) => s + r.qualityScore, 0) / (valid.length || 1)).toFixed(1)
        ),
      },
    };
  }

  // ── Pass 2: Post-analysis PICO validation ────────────────────────────────
  validatePicoResults(picoResults) {
    this.logger.section('ValidationAgent — Pass 2: PICO Quality Assurance');
    const validated = picoResults.map((result) => this._validatePico(result));

    const passed = validated.filter((v) => v.picoQuality >= 6);
    this.logger.info(`PICO QA: ${passed.length}/${validated.length} results high quality`, {
      avgPicoQuality: (
        validated.reduce((s, v) => s + v.picoQuality, 0) / (validated.length || 1)
      ).toFixed(1),
    });

    return validated;
  }

  _validatePico(result) {
    const issues = [];
    const pico = result.pico ?? {};
    const checks = {
      population: { minLen: 20, label: 'Population' },
      intervention: { minLen: 15, label: 'Intervention' },
      comparison: { minLen: 5, label: 'Comparison' },
      outcome: { minLen: 20, label: 'Outcome' },
    };

    for (const [field, { minLen, label }] of Object.entries(checks)) {
      const val = pico[field] ?? '';
      if (val.length < minLen || val === 'Not analyzed')
        issues.push(`${label} PICO element incomplete`);
    }

    if (!result.clinicalTakeaway || result.clinicalTakeaway.length < 30)
      issues.push('Clinical takeaway too brief');
    if (!result.keyFindings?.length)
      issues.push('No key findings listed');
    if (!result.evidenceLevel)
      issues.push('Evidence level not specified');
    if (!result.limitations || result.limitations.length < 20)
      issues.push('Limitations not adequately described');

    // Score consistency check
    const scoreConsistent =
      !result.clinicalApplicabilityScore ||
      Math.abs(result.clinicalApplicabilityScore - (result.paper?.scoringData?.score ?? 0)) <= 3;
    if (!scoreConsistent)
      issues.push('Significant score inconsistency between passes');

    const picoQuality = Math.max(0, 10 - issues.length * 2);

    return {
      ...result,
      picoIssues: issues,
      picoQuality,
      picoValid: issues.length === 0,
    };
  }

  // ── Quality report ───────────────────────────────────────────────────────
  generateQualityReport(pass1Stats, pass2Results, allScoredPapers) {
    const scoreDistribution = { '1-3': 0, '4-6': 0, '7-8': 0, '9-10': 0 };
    for (const p of allScoredPapers) {
      const s = p.scoringData?.score ?? 0;
      if (s <= 3) scoreDistribution['1-3']++;
      else if (s <= 6) scoreDistribution['4-6']++;
      else if (s <= 8) scoreDistribution['7-8']++;
      else scoreDistribution['9-10']++;
    }

    const studyTypes = {};
    for (const p of allScoredPapers) {
      const t = p.scoringData?.studyType ?? 'Other';
      studyTypes[t] = (studyTypes[t] ?? 0) + 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      pass1: pass1Stats,
      pass2: {
        analyzed: pass2Results.length,
        highQuality: pass2Results.filter((r) => r.picoQuality >= 8).length,
        acceptable: pass2Results.filter((r) => r.picoQuality >= 6).length,
        avgPicoQuality: parseFloat(
          (
            pass2Results.reduce((s, r) => s + r.picoQuality, 0) / (pass2Results.length || 1)
          ).toFixed(1)
        ),
      },
      scoreDistribution,
      studyTypeBreakdown: studyTypes,
    };
  }
}
```

## `src/agents/FilterAnalyzerAgent.js`

```javascript
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
    this.topN = options.topN ?? Number(process.env.TOP_N ?? 3);
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
                  description: 'One-sentence beginner-friendly Korean explanation of the concept',
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
          'pmid', 'clinicalQuestion', 'clinicalQuestion_ko',
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
  async _callLLM(messages, tool, llm = this.llm) {
    return this.cb.execute(() =>
      this.retry.execute(
        async () => llm.callWithTool(messages, tool),
        {
          label: `${this.provider}-API`,
          onRetry: ({ attempt, delay }) =>
            this.logger.warn(`${this.provider} retry ${attempt} in ${Math.round(delay)}ms`),
        }
      )
    );
  }

  // ── Step 1: Score all papers in batches of 10 ───────────────────────────
  async scorePapers(papers) {
    const BATCH = 10;
    const allScores = [];

    for (let i = 0; i < papers.length; i += BATCH) {
      const batch = papers.slice(i, i + BATCH);
      const cacheKey = `scores_${batch.map((p) => p.pmid).join('_')}`;

      const providerCacheKey = `${this.provider}_${this.model}_${cacheKey}`;
      const { data: scores, fromCache } = await this.cache.getOrFetch(providerCacheKey, async () => {
        this.logger.debug(`Scoring batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(papers.length / BATCH)}`);

        const paperList = batch
          .map(
            (p, idx) =>
              `[${idx + 1}] PMID: ${p.pmid}\nTitle: ${p.title}\nJournal: ${p.journal} (${p.pubDate})\nAbstract: ${p.abstract.slice(0, 800)}`
          )
          .join('\n\n---\n\n');

        const prompt = `You are an expert emergency medicine physician and critical care specialist performing a systematic literature review.

Rate each paper below for CLINICAL APPLICABILITY in emergency medicine or critical care (1–10):
- 9–10: Practice-changing, directly applicable, robust evidence
- 7–8: Highly relevant, strong evidence or important topic
- 5–6: Relevant but limited generalizability or methodological concerns
- 3–4: Limited clinical relevance or preliminary data
- 1–2: Not applicable to EM/CCM practice

Prioritize: randomized trials, meta-analyses, high-impact observational studies on sepsis, resuscitation, airway, hemodynamics, toxicology, procedural interventions.

Papers to score:
${paperList}

Use the submit_paper_scores tool to return scores for ALL ${batch.length} papers.`;

        const result = await this._callLLM(
          [{ role: 'user', content: prompt }],
          this._scoringTool
        );

        return result.scores;
      });

      if (fromCache) this.logger.debug(`Batch ${Math.floor(i / BATCH) + 1} scores from cache`);
      allScores.push(...scores);
    }

    return allScores;
  }

  // ── Step 2: Select top-N papers ──────────────────────────────────────────
  _selectTopPapers(papers, scores) {
    const scoreMap = new Map(scores.map((s) => [s.pmid, s]));

    return papers
      .map((p) => ({
        ...p,
        scoringData: scoreMap.get(p.pmid) ?? { score: 0, rationale: '', studyType: 'Other' },
      }))
      .sort((a, b) => (b.scoringData.score ?? 0) - (a.scoringData.score ?? 0))
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
      return this._fallbackPico(topPapers[idx]);
    });
  }

  async _analyzeSinglePaper(paper) {
    const cacheKey = `pico_v4_${this.provider}_${this.picoModel}_${paper.pmid}`;
    const { data, fromCache } = await this.cache.getOrFetch(cacheKey, async () => {
      this.logger.info(`PICO analysis: ${paper.pmid} — ${paper.title.slice(0, 60)}…`);

      const hasFullText = paper.fullText && paper.fullText.length > 100;
      const fullTextSection = hasFullText
        ? `\n\n--- FULL TEXT (source: ${paper.fullTextSource}, ${Math.round(paper.fullTextLength / 1000)}k chars, truncated) ---\n${paper.fullText}\n---`
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
${paper.abstract}${fullTextSection}${figureSection}

Provide a complete structured analysis using the submit_pico_analysis tool.
Requirements:
1. ${hasFullText ? 'Full text is provided — use it to extract detailed methods, subgroup analyses, exact statistics, and figure/table data NOT in the abstract.' : 'Only abstract is available — note this limitation explicitly.'}
2. PICO fields must include specific numbers (sample sizes, ages, percentages, date ranges, cutoffs, effect sizes, p-values, confidence intervals). Prioritize numbers from full text over abstract when available.
3. Provide Korean translations for ALL text fields (_ko suffix). Medical terms, drug names, score names (e.g., SOFA, AUROC, PELOD-2), and statistics must remain in English within Korean text — translate only the surrounding prose.
4. Report ONLY values explicitly stated in the paper. NEVER derive, compute, or estimate new statistics yourself (e.g., do not calculate NNT or absolute risk differences unless the paper reports them). If a value is not reported, omit it rather than guessing.
5. For the English PICO fields (population/intervention/comparison/outcome), preserve the original wording of the source text as closely as possible — write them as near-verbatim excerpts, not free paraphrases.
6. statGlossary: for every statistical term that appears in your outcome/secondaryOutcomes text (e.g., OR, HR, 95% CI, p-value, AUROC, mRS), add one entry with a single-sentence plain-Korean explanation a junior clinician could understand. Do not include terms that do not appear.
7. practiceChange: 2–3 concrete, actionable bullets describing how this evidence should (or should not) change EM/CCM practice.`;

      return await this._callLLM(
        [{ role: 'user', content: prompt }],
        this._picoTool,
        this.picoLlm
      );
    });

    if (fromCache) this.logger.debug(`PICO from cache: ${paper.pmid}`);
    return { ...data, paper };
  }

  _fallbackPico(paper) {
    return {
      pmid: paper.pmid,
      paper,
      clinicalQuestion: 'Analysis unavailable — see abstract',
      pico: {
        population: 'Not analyzed',
        intervention: 'Not analyzed',
        comparison: 'Not analyzed',
        outcome: 'Not analyzed',
      },
      baseline: 'Not reported',
      secondaryOutcomes: [],
      secondaryOutcomes_ko: [],
      statGlossary: [],
      keyFindings: ['Analysis failed — refer to original abstract'],
      clinicalTakeaway: 'Manual review required',
      limitations: 'Automated analysis failed',
      practiceChange: [],
      practiceChange_ko: [],
      evidenceLevel: 'Very Low',
      clinicalApplicabilityScore: paper.scoringData?.score ?? 0,
      analysisError: true,
    };
  }

  // ── Scoring + selection only (no PICO) — used when full-text enrichment follows ──
  async runScoringOnly(papers) {
    this.logger.section('FilterAnalyzerAgent — Scoring & Selection (no PICO yet)');
    if (!papers.length) return { topPapers: [], allScoredPapers: [] };

    const scores = await this.scorePapers(papers);
    const topPapers = this._selectTopPapers(papers, scores);

    const scoreMap = new Map(scores.map((s) => [s.pmid, s]));
    const allScoredPapers = papers.map((p) => ({
      ...p,
      scoringData: scoreMap.get(p.pmid) ?? { score: 0, studyType: 'Other' },
    }));

    this.logger.info(`Selected top ${topPapers.length} papers for full-text enrichment`);
    return { topPapers, allScoredPapers };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run(papers) {
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

    // 2. Select top-N
    const topPapers = this._selectTopPapers(papers, scores);
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
if (process.argv[1].endsWith('FilterAnalyzerAgent.js')) {
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
```

## `src/agents/FullTextAgent.js`

```javascript
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

    const enriched = await Promise.all(papers.map((p) => this._enrich(p)));

    const stats = {
      pmc:          enriched.filter((p) => p.fullTextSource === 'PMC').length,
      unpaywall:    enriched.filter((p) => p.fullTextSource === 'Unpaywall').length,
      abstractOnly: enriched.filter((p) => p.fullTextSource === 'abstract-only').length,
    };
    this.logger.info('Full-text retrieval complete', stats);
    return { papers: enriched, stats };
  }

  // ── Per-paper enrichment ──────────────────────────────────────────────────
  async _enrich(paper) {
    const cacheKey = `ft_v1_${paper.pmid}`;
    const { data, fromCache } = await this.cache.getOrFetch(cacheKey, () => this._fetch(paper));
    if (fromCache) this.logger.debug(`Full text from cache: PMID ${paper.pmid}`);
    return { ...paper, ...data };
  }

  async _fetch(paper) {
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
          };
        }
      } catch (e) {
        this.logger.warn(`PMC failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    // ── Route 2: Unpaywall ──────────────────────────────────────────────────
    if (paper.doi && paper.doi.length > 3 && paper.doi !== 'undefined') {
      try {
        const oaUrl = await this._unpaywall(paper.doi);
        if (oaUrl) {
          const text = await this._fetchHtmlText(oaUrl);
          if (text && text.length > 300) {
            this.logger.info(`Unpaywall full text: PMID ${paper.pmid} — ${text.length} chars`);
            return {
              fullText: text.slice(0, MAX_FULLTEXT_CHARS),
              fullTextSource: 'Unpaywall',
              fullTextLength: text.length,
              figures: [],
              oaUrl,
            };
          }
        }
      } catch (e) {
        this.logger.warn(`Unpaywall failed (PMID ${paper.pmid}): ${e.message}`);
      }
    }

    this.logger.info(`Abstract-only: PMID ${paper.pmid} (pmcid=${paper.pmcid || 'none'}, doi=${paper.doi || 'none'})`);
    return { fullText: null, fullTextSource: 'abstract-only', fullTextLength: 0, figures: [] };
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
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
  async _unpaywall(doi) {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    const best = data?.best_oa_location;
    if (!best) return null;

    // Prefer HTML landing page (easier to parse) over direct PDF
    return best.url_for_landing_page ?? best.url_for_pdf ?? best.url ?? null;
  }

  // ── HTML text extraction ──────────────────────────────────────────────────
  async _fetchHtmlText(url) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': `TrendReviewAgent/1.0 (research; mailto:${this.email})`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
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
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
```

## `src/agents/ReportGeneratorAgent.js`

```javascript
/**
 * ReportGeneratorAgent
 * MCP bindings: filesystem (write reports), time (timestamp)
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const EVIDENCE_COLOR = {
  High: '#10b981', Moderate: '#3b82f6', Low: '#f59e0b', 'Very Low': '#ef4444',
};
const STUDY_ICON = {
  RCT: '🧪', 'Meta-analysis': '📊', 'Systematic Review': '📋',
  Observational: '🔍', 'Case Series': '📄', Guidelines: '📌', Other: '📝',
};

export class ReportGeneratorAgent {
  constructor(options = {}) {
    this.logger = new Logger('ReportGeneratorAgent', { logFile: 'report_generator.jsonl' });
    this.outputDir = options.outputDir ?? path.join(process.cwd(), 'output');
    this.reportsDir = path.join(this.outputDir, 'reports');
  }

  async _ensureDirs() {
    for (const dir of [this.outputDir, this.reportsDir]) {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    }
  }

  async saveJsonArchive(sessionId, data) {
    const filePath = path.join(this.reportsDir, `trend_review_${sessionId}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.info('JSON archive saved', { path: filePath });
    return filePath;
  }

  async saveHtmlDashboard(sessionId, data) {
    const html = this._buildHtml(data, sessionId);
    const filePath = path.join(this.reportsDir, `trend_review_${sessionId}.html`);
    await writeFile(filePath, html, 'utf8');
    this.logger.info('HTML dashboard saved', { path: filePath });
    return filePath;
  }

  _buildHtml(data, sessionId) {
    const { topPapers, allScoredPapers, qualityReport, executionStats } = data;
    const ts = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    return `<!DOCTYPE html>
<html lang="ko" class="scroll-smooth">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Trend Review — ${sessionId}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.13.3/dist/cdn.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>
<style>
  [x-cloak]{display:none!important}
  .pico-card{border-left:4px solid #3b82f6}
  .score-badge{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border-radius:9999px;font-weight:700;font-size:.875rem}
  .evidence-badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeIn .4s ease-out}
  .rec-card{border-color:#3b82f6!important;background:#fff}
  body{background-color:#f8fafc}
</style>
</head>
<body class="font-sans antialiased" x-data="app()" x-init="init()">
<header class="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white shadow-xl">
  <div class="max-w-7xl mx-auto px-6 py-6">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <div class="flex items-center gap-3 mb-1"><span class="text-3xl">🏥</span><h1 class="text-2xl font-bold tracking-tight">Trend Review</h1></div>
        <p class="text-blue-200 text-sm">응급의학·중환자의학 최신 논문 AI 분석 시스템</p>
      </div>
      <div class="flex flex-col items-end gap-1 text-right">
        <span class="text-xs text-blue-300">Session: <code class="text-blue-100">${sessionId}</code></span>
        <span class="text-xs text-blue-300">생성: ${ts}</span>
        <span class="text-xs text-blue-300">검색 기간: 최근 ${executionStats?.searchDays ?? 30}일</span>
      </div>
    </div>
  </div>
</header>
<div class="bg-white border-b shadow-sm">
  <div class="max-w-7xl mx-auto px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
    ${[
      { icon: '📚', label: '수집 논문', value: allScoredPapers.length, sub: 'PubMed 검색 결과' },
      { icon: '✅', label: '검증 통과', value: qualityReport?.pass1?.valid ?? allScoredPapers.length, sub: '품질 검증 통과' },
      { icon: '🏆', label: 'Top 선별', value: topPapers.length, sub: 'Claude AI 선정' },
      { icon: '⏱️', label: '처리 시간', value: `${executionStats?.totalElapsed ?? '—'}s`, sub: '총 실행 시간' },
    ].map((s) => `<div class="text-center"><div class="text-2xl mb-1">${s.icon}</div><div class="text-2xl font-bold text-gray-800">${s.value}</div><div class="text-xs font-semibold text-gray-600">${s.label}</div><div class="text-xs text-gray-400">${s.sub}</div></div>`).join('')}
  </div>
</div>
<main class="max-w-7xl mx-auto px-4 py-8 space-y-10">
<section>
  <h2 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
    <span>📰</span> 오늘의 추천 논문 ${topPapers.length}편
    <span class="text-sm font-normal text-gray-500 ml-2">EM/CCM 임상 적용성 기준 AI 선정</span>
  </h2>
  <div class="space-y-6">${topPapers.map((p, i) => this._buildPicoCard(p, i)).join('\n')}</div>
</section>
${this._buildSummaryTable(topPapers)}
<section class="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div class="bg-white rounded-xl shadow-sm border p-6"><h3 class="font-semibold text-gray-700 mb-4">점수 분포</h3><canvas id="scoreChart" height="220"></canvas></div>
  <div class="bg-white rounded-xl shadow-sm border p-6"><h3 class="font-semibold text-gray-700 mb-4">연구 유형</h3><canvas id="studyTypeChart" height="220"></canvas></div>
</section>
<section>
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
    <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2"><span>📋</span> 전체 논문 목록</h2>
    <div class="flex gap-2">
      <input x-model="search" type="text" placeholder="제목, 저널 검색…" class="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      <select x-model="filterStudy" class="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">전체 유형</option>
        ${[...new Set(allScoredPapers.map((p) => p.scoringData?.studyType ?? 'Other'))].map((t) => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <select x-model="minScore" class="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="0">전체 점수</option><option value="7">7점 이상</option><option value="5">5점 이상</option>
      </select>
    </div>
  </div>
  <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="px-4 py-3 text-left font-semibold text-gray-600 w-10">#</th>
            <th class="px-4 py-3 text-left font-semibold text-gray-600">제목</th>
            <th class="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">저널</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-20">점수</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-28 hidden md:table-cell">유형</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-20">링크</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="(p, i) in filteredPapers" :key="p.pmid">
            <tr class="border-b hover:bg-blue-50 transition-colors cursor-pointer" @click="expandPaper = expandPaper === p.pmid ? null : p.pmid">
              <td class="px-4 py-3 text-gray-400 text-xs" x-text="i+1"></td>
              <td class="px-4 py-3">
                <div class="font-medium text-gray-800 text-sm leading-snug" x-text="p.title"></div>
                <div class="text-xs text-gray-500 mt-0.5" x-text="p.authors?.slice(0,3).join(', ')"></div>
                <div x-show="expandPaper === p.pmid" x-cloak class="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 leading-relaxed" x-text="p.scoringData?.rationale || '—'"></div>
              </td>
              <td class="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">
                <div x-text="p.journal"></div><div class="text-gray-400" x-text="p.pubDate"></div>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="score-badge text-white" :style="'background:' + scoreColor(p.scoringData?.score ?? 0)" x-text="p.scoringData?.score ?? '—'"></span>
              </td>
              <td class="px-4 py-3 text-center hidden md:table-cell">
                <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full" x-text="p.scoringData?.studyType || '—'"></span>
              </td>
              <td class="px-4 py-3 text-center">
                <a :href="p.pubmedUrl" target="_blank" rel="noopener" class="text-blue-500 hover:text-blue-700 text-xs underline" @click.stop>PubMed</a>
              </td>
            </tr>
          </template>
          <tr x-show="filteredPapers.length === 0"><td colspan="6" class="px-4 py-8 text-center text-gray-400 text-sm">검색 결과 없음</td></tr>
        </tbody>
      </table>
    </div>
    <div class="px-4 py-2 bg-gray-50 text-xs text-gray-500 flex justify-between">
      <span x-text="filteredPapers.length + ' 건 표시'"></span><span>클릭하면 평가 근거 확인</span>
    </div>
  </div>
</section>
<section class="bg-white rounded-xl shadow-sm border p-6">
  <h2 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><span>🔬</span> 품질 보고서</h2>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
    ${[
      { label: 'Pass 1 통과율', value: `${qualityReport?.pass1?.valid ?? '—'}/${qualityReport?.pass1?.total ?? '—'}` },
      { label: '평균 품질 점수', value: qualityReport?.pass1?.avgQualityScore ?? '—' },
      { label: 'PICO 고품질', value: qualityReport?.pass2?.highQuality ?? '—' },
      { label: '평균 PICO 품질', value: qualityReport?.pass2?.avgPicoQuality ?? '—' },
    ].map((s) => `<div class="bg-gray-50 rounded-lg p-3"><div class="text-xl font-bold text-blue-600">${s.value}</div><div class="text-xs text-gray-500 mt-1">${s.label}</div></div>`).join('')}
  </div>
</section>
</main>
<footer class="mt-12 border-t bg-white py-6 text-center text-xs text-gray-400">
  <p>Trend Review Agent · Powered by Claude AI + PubMed E-utilities</p>
  <p class="mt-1">본 시스템의 분석 결과는 보조 도구이며, 임상 결정은 전문의 판단을 따르십시오.</p>
</footer>
<script>
const TOP_PAPERS = ${JSON.stringify(topPapers)};
const ALL_PAPERS = ${JSON.stringify(allScoredPapers)};
const QUALITY = ${JSON.stringify(qualityReport ?? {})};
function app() {
  return {
    search: '', filterStudy: '', minScore: '0', expandPaper: null,
    init() { this.$nextTick(() => { this.renderScoreChart(); this.renderStudyTypeChart(); }); },
    get filteredPapers() {
      return ALL_PAPERS.filter(p => {
        const q = this.search.toLowerCase();
        const matchSearch = !q || (p.title||'').toLowerCase().includes(q) || (p.journal||'').toLowerCase().includes(q) || (p.authors||[]).join(' ').toLowerCase().includes(q);
        const matchType = !this.filterStudy || p.scoringData?.studyType === this.filterStudy;
        const matchScore = (p.scoringData?.score ?? 0) >= Number(this.minScore);
        return matchSearch && matchType && matchScore;
      }).sort((a,b) => (b.scoringData?.score||0) - (a.scoringData?.score||0));
    },
    scoreColor(s) {
      if (s >= 9) return '#10b981'; if (s >= 7) return '#3b82f6';
      if (s >= 5) return '#f59e0b'; if (s >= 3) return '#f97316'; return '#ef4444';
    },
    renderScoreChart() {
      const dist = QUALITY.scoreDistribution || {'1-3':0,'4-6':0,'7-8':0,'9-10':0};
      new Chart(document.getElementById('scoreChart'), { type: 'bar', data: { labels: Object.keys(dist), datasets: [{ label: '논문 수', data: Object.values(dist), backgroundColor: ['#ef4444','#f59e0b','#3b82f6','#10b981'], borderRadius: 6 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
    },
    renderStudyTypeChart() {
      const types = QUALITY.studyTypeBreakdown || {};
      if (!Object.keys(types).length) return;
      const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316'];
      new Chart(document.getElementById('studyTypeChart'), { type: 'doughnut', data: { labels: Object.keys(types), datasets: [{ data: Object.values(types), backgroundColor: colors, borderWidth: 2 }] }, options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } } });
    }
  };
}
</script>
</body>
</html>`;
  }

  _buildFullTextBadge(result, paper) {
    const src = result.fullTextSource ?? 'abstract-only';
    const len = result.fullTextLength ?? 0;
    const figures = result.figures ?? [];
    if (src === 'PMC') {
      const figNote = figures.length ? ` · ${figures.length} figure/table caption${figures.length > 1 ? 's' : ''} extracted` : '';
      return `<div class="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4 text-xs text-green-800"><span>📄</span><span><strong>Full text available (PMC)</strong> — ${Math.round(len / 1000)}k chars analyzed${figNote} &nbsp;<a href="${this._esc(paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="underline hover:text-green-600">PubMed →</a></span></div>`;
    }
    if (src === 'Unpaywall') {
      return `<div class="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 text-xs text-blue-800"><span>🔓</span><span><strong>Open-access full text (Unpaywall)</strong> — ${Math.round(len / 1000)}k chars analyzed &nbsp;<a href="${this._esc(result.oaUrl ?? paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="underline hover:text-blue-600">Full text →</a></span></div>`;
    }
    return `<div class="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 mb-4 text-xs text-gray-500"><span>📃</span><span><strong>Abstract only</strong> &nbsp;<a href="${this._esc(paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-blue-500 underline hover:text-blue-700">PubMed →</a></span></div>`;
  }

  _extractN(populationText) {
    const m = (populationText ?? '').match(/n\s*[=:]\s*([\d,]+)/i)
      ?? (populationText ?? '').match(/([\d,]+)\s*(?:patients|participants|children|encounters|hospitalizations)/i);
    return m ? m[1] : null;
  }

  _firstSentence(text) {
    const s = (text ?? '').match(/^[^.!?]+[.!?]/);
    return s ? s[0] : (text ?? '').slice(0, 140) + ((text ?? '').length > 140 ? '…' : '');
  }

  _buildSummaryTable(topPapers) {
    const evColors = { High: '#10b981', Moderate: '#3b82f6', Low: '#f59e0b', 'Very Low': '#ef4444' };
    const rows = topPapers.map((result, i) => {
      const p = result.paper ?? {};
      const score = result.clinicalApplicabilityScore ?? p.scoringData?.score ?? 0;
      const evidence = result.evidenceLevel ?? 'Low';
      const evColor = evColors[evidence] ?? '#6b7280';
      const scoreColor = score >= 9 ? '#10b981' : score >= 7 ? '#3b82f6' : '#f59e0b';
      const studyType = p.scoringData?.studyType ?? 'Other';
      const nVal = this._extractN(result.pico?.population ?? '');
      const keyPointEn = this._firstSentence(result.keyFindings?.[0] ?? result.clinicalTakeaway ?? '');
      const keyPointKo = this._firstSentence(result.keyFindings_ko?.[0] ?? result.clinicalTakeaway_ko ?? '');
      const authors = (p.authors ?? []).slice(0, 2).join(', ') + ((p.authors?.length ?? 0) > 2 ? ' 외' : '');
      return `<tr class="border-b hover:bg-gray-50 transition-colors align-top">
  <td class="px-4 py-4 text-center"><span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold">${i + 1}</span></td>
  <td class="px-4 py-4"><a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="font-semibold text-gray-800 hover:text-blue-700 text-sm leading-snug block mb-1">${this._esc(p.title ?? '')}</a><div class="text-xs text-gray-400">${this._esc(authors)} · ${this._esc(p.journal ?? '')} (${this._esc(p.pubDate ?? '')})</div></td>
  <td class="px-4 py-4 text-center"><div class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full inline-block mb-1">${STUDY_ICON[studyType] ?? '📝'} ${this._esc(studyType)}</div><div><span class="evidence-badge text-white text-xs" style="background:${evColor}">${this._esc(evidence)}</span></div></td>
  <td class="px-4 py-4 text-center">${nVal ? `<span class="text-sm font-bold text-gray-700">N = ${this._esc(nVal)}</span>` : '<span class="text-xs text-gray-400">—</span>'}</td>
  <td class="px-4 py-4 text-center"><span class="score-badge text-white" style="background:${scoreColor}">${score}</span></td>
  <td class="px-4 py-4"><p class="text-sm text-gray-700 leading-snug">${this._esc(keyPointEn)}</p>${keyPointKo ? `<p class="text-xs text-gray-500 italic mt-1">${this._esc(keyPointKo)}</p>` : ''}</td>
</tr>`;
    });
    return `<section>
  <h2 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><span>📊</span> 오늘의 추천 논문 비교 요약</h2>
  <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
    <thead><tr class="bg-gradient-to-r from-blue-900 to-indigo-900 text-white text-xs uppercase tracking-wide">
      <th class="px-4 py-3 text-center w-12">#</th>
      <th class="px-4 py-3 text-left">Title / 제목</th>
      <th class="px-4 py-3 text-center w-32">Study Type / Evidence</th>
      <th class="px-4 py-3 text-center w-24">Sample Size</th>
      <th class="px-4 py-3 text-center w-20">Score</th>
      <th class="px-4 py-3 text-left">Top Finding / 핵심 결과</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div></div>
</section>`;
  }

  _bilingualBlock(enText, koText, opts = {}) {
    const { enClass = 'text-sm text-gray-700', koClass = 'text-sm text-gray-500 italic' } = opts;
    const ko = koText ? `<hr class="my-2 border-gray-200"/><p class="${koClass}">${this._esc(koText)}</p>` : '';
    return `<p class="${enClass}">${this._esc(enText)}</p>${ko}`;
  }

  // ── PICO 카드 헬퍼 ─────────────────────────────────────────────────────────

  _internalValidityLabel(evidenceLevel) {
    const map = { High: { label: 'Low Risk', color: '#10b981' }, Moderate: { label: 'Some Concerns', color: '#f59e0b' }, Low: { label: 'High Risk', color: '#ef4444' }, 'Very Low': { label: 'High Risk', color: '#ef4444' } };
    return map[evidenceLevel] ?? { label: 'Some Concerns', color: '#f59e0b' };
  }

  _edApplicabilityLabel(score) {
    if (score >= 8) return { label: '적용 가능', color: '#10b981' };
    if (score >= 5) return { label: '부분 적용', color: '#f59e0b' };
    return { label: '적용 어려움', color: '#ef4444' };
  }

  // ── PICO 카드 (논문 보고값 중심 · 영-한 병렬 · 차분한 타이포그래피) ──────────

  _buildPicoCard(result, rank) {
    const p = result.paper ?? {};
    const pico = result.pico ?? {};
    const picoKo = result.pico_ko ?? {};
    const evidence = result.evidenceLevel ?? 'Low';
    const studyType = p.scoringData?.studyType ?? 'Other';
    const score = result.clinicalApplicabilityScore ?? p.scoringData?.score ?? 0;
    const validity = this._internalValidityLabel(evidence);
    const edApplicability = this._edApplicabilityLabel(score);
    const baseline = result.baseline ?? 'Not reported';
    const nVal = this._extractN(pico.population ?? '');

    // 영어 원문(줄글) 위 + 한글 번역 아래 — 동일 양식, 블록 장식 없음
    const enKo = (en, ko) => `
      <p class="text-sm text-gray-800 leading-relaxed">${this._esc(en ?? '—')}</p>
      ${ko ? `<p class="text-sm text-gray-500 leading-relaxed mt-1">${this._esc(ko)}</p>` : ''}`;

    const sectionTitle = (label) =>
      `<h3 class="text-base font-bold text-blue-900 mt-7 mb-2 pb-1 border-b border-gray-200">${label}</h3>`;
    const subhead = (label) =>
      `<div class="text-sm font-bold text-blue-700 mt-4 mb-1.5">${label}</div>`;

    const secondaryItems = (result.secondaryOutcomes ?? []).map((s, i) => `
      <li class="mb-2 pl-3 border-l-2 border-gray-200">
        <p class="text-sm text-gray-800 leading-relaxed">${this._esc(s)}</p>
        ${result.secondaryOutcomes_ko?.[i] ? `<p class="text-sm text-gray-500 leading-relaxed mt-0.5">${this._esc(result.secondaryOutcomes_ko[i])}</p>` : ''}
      </li>`).join('');

    const glossaryItems = (result.statGlossary ?? []).map(
      (g) => `<div class="mb-1"><strong class="text-gray-600">${this._esc(g.term)}</strong> — ${this._esc(g.explanation_ko)}</div>`
    ).join('');
    const glossaryBlock = glossaryItems
      ? `<div class="mt-3 bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 leading-relaxed"><div class="font-bold text-gray-600 mb-1.5">통계 용어 풀이</div>${glossaryItems}</div>`
      : '';

    const practiceItems = (result.practiceChange ?? []).map((t, i) => `
      <li class="mb-2 flex gap-2">
        <span class="text-blue-700 font-bold flex-shrink-0">·</span>
        <div>
          <p class="text-sm text-gray-800 leading-relaxed">${this._esc(t)}</p>
          ${result.practiceChange_ko?.[i] ? `<p class="text-sm text-gray-500 leading-relaxed mt-0.5">${this._esc(result.practiceChange_ko[i])}</p>` : ''}
        </div>
      </li>`).join('');

    const doiLink = p.doi
      ? ` · <a href="https://doi.org/${this._esc(p.doi)}" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">DOI</a>`
      : '';

    return `
<div class="bg-white rounded-2xl shadow-md border p-7 fade-in" x-data="{open:true}">
  <div class="flex items-start justify-between gap-4">
    <div class="flex-1 min-w-0">
      <div class="text-xs font-semibold text-gray-400 tracking-wide mb-2">No. ${String(rank + 1).padStart(2, '0')} · ${this._esc(evidence)} Evidence · ${this._esc(studyType)}</div>
      <a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-lg font-bold text-blue-900 hover:text-blue-700 leading-snug block">${this._esc(p.title ?? '')}</a>
      <div class="text-sm text-gray-500 mt-1.5"><strong class="text-gray-600">${this._esc(p.journal ?? '—')}</strong> · ${this._esc(p.pubDate ?? '—')} · <a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">PubMed</a>${doiLink}</div>
    </div>
    <button @click="open=!open" class="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap mt-1">
      <span x-show="open">접기 ▲</span><span x-show="!open" x-cloak>펼치기 ▼</span>
    </button>
  </div>
  ${subhead('Why It Matters')}
  ${enKo(result.clinicalQuestion, result.clinicalQuestion_ko)}
  <div x-show="open" x-collapse>
    <div class="mt-5">${this._buildFullTextBadge(result, p)}</div>

    ${sectionTitle('PICO Framework')}
    ${subhead('P — Patient')}
    ${enKo(pico.population, picoKo.population)}
    <div class="text-sm text-gray-700 mt-2">
      ${nVal ? `<strong>n = ${this._esc(nVal)}</strong> · ` : ''}<span class="text-gray-500">Baseline —</span> <strong>${this._esc(baseline)}</strong>
    </div>
    ${subhead('I — Intervention')}
    ${enKo(pico.intervention, picoKo.intervention)}
    ${subhead('C — Comparison')}
    ${enKo(pico.comparison, picoKo.comparison)}
    ${subhead('O — Outcome & Results')}
    <div class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Primary</div>
    ${enKo(pico.outcome, picoKo.outcome)}
    ${secondaryItems ? `<div class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-3 mb-1">Secondary</div><ul>${secondaryItems}</ul>` : ''}
    ${glossaryBlock}

    ${sectionTitle('Critical Appraisal & Applicability')}
    <div class="text-sm text-gray-800 mb-2"><span class="font-bold text-blue-700">Internal Validity</span> — <strong>${this._esc(validity.label)}</strong></div>
    <div class="text-sm text-gray-700 mb-3"><span class="text-gray-500">Reason :</span> ${this._esc(p.scoringData?.rationale ?? '—')}</div>
    <div class="text-sm font-bold text-blue-700 mb-1">Limitations</div>
    ${enKo(result.limitations, result.limitations_ko)}
    <div class="text-sm text-gray-800 mt-3"><span class="font-bold text-blue-700">ED Applicability</span> — <strong>${this._esc(edApplicability.label)}</strong></div>

    ${sectionTitle('Clinical Bottom Line')}
    ${enKo(result.clinicalTakeaway, result.clinicalTakeaway_ko)}
    ${practiceItems ? `${subhead('Practice Change')}<ul class="mt-1">${practiceItems}</ul>` : ''}
  </div>
</div>`;
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async run(sessionId, data) {
    this.logger.section('ReportGeneratorAgent — Output Generation');
    await this._ensureDirs();
    const [jsonPath, htmlPath] = await Promise.all([
      this.saveJsonArchive(sessionId, data),
      this.saveHtmlDashboard(sessionId, data),
    ]);
    this.logger.info('Reports generated successfully', { jsonPath, htmlPath });
    return { jsonPath, htmlPath };
  }
}
```

## `src/agents/NotificationAgent.js`

```javascript
/**
 * NotificationAgent
 * Google Drive 업로드 + Gmail 발송 (googleapis OAuth2, ENABLE_GMAIL=true 시 활성)
 *
 * 첫 실행 시 브라우저 인증 → token.json 저장 → 이후 자동
 * KakaoTalk 알림은 Claude MCP(PlayMCP)를 통해 발송 — 이 에이전트에서는 처리하지 않음
 */
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import { exec } from 'child_process';
import http from 'http';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

export class NotificationAgent {
  constructor(options = {}) {
    this.logger = new Logger('NotificationAgent', { logFile: 'notification.jsonl' });
    this.credentialsPath = options.credentialsPath
      ?? process.env.GOOGLE_CREDENTIALS_PATH
      ?? './credentials.json';
    this.tokenPath = path.join(process.cwd(), 'output', 'google_token.json');
    this.recipientEmail = options.recipientEmail ?? process.env.NOTIFY_EMAIL;
    this.driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID ?? null;
  }

  // ── OAuth2 인증 ──────────────────────────────────────────────────────────
  async _getAuth() {
    const raw = await readFile(this.credentialsPath, 'utf8').catch(() => {
      throw new Error(`credentials.json을 찾을 수 없습니다: ${this.credentialsPath}`);
    });
    const creds = JSON.parse(raw);
    const { client_id, client_secret } = creds.installed ?? creds.web;

    // 로컬 서버 방식: redirect_uri = http://localhost:3000
    const REDIRECT = 'http://localhost:3000';
    const oAuth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT);

    // 저장된 토큰 재사용
    if (existsSync(this.tokenPath)) {
      const token = JSON.parse(await readFile(this.tokenPath, 'utf8'));
      oAuth2.setCredentials(token);
      this.logger.info('기존 Google 토큰 사용');
      return oAuth2;
    }

    return this._firstTimeAuth(oAuth2);
  }

  async _firstTimeAuth(oAuth2) {
    const authUrl = oAuth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    this.logger.info('최초 Google 인증 — 브라우저가 열립니다');

    // 로컬 HTTP 서버로 리디렉션 코드 자동 수신
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost:3000');
          const code = url.searchParams.get('code');
          if (!code) { res.end('코드 없음'); return; }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>✅ Google 인증 완료!</h2><p>이 창을 닫고 터미널로 돌아가세요.</p>');
          server.close();

          const { tokens } = await oAuth2.getToken(code);
          oAuth2.setCredentials(tokens);

          const dir = path.dirname(this.tokenPath);
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          await writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
          this.logger.info('Google 토큰 저장 완료');
          resolve(oAuth2);
        } catch (err) {
          res.end('오류: ' + err.message);
          server.close();
          reject(err);
        }
      });

      server.listen(3000, () => {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔐 브라우저에서 Google 계정으로 로그인 후');
        console.log('   권한을 허용하면 자동으로 완료됩니다.');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        exec(`start "" "${authUrl}"`);
      });

      // 5분 타임아웃
      setTimeout(() => { server.close(); reject(new Error('인증 타임아웃 (5분)')); }, 300_000);
    });
  }

  // ── Google Drive 업로드 ──────────────────────────────────────────────────
  async _uploadFile(auth, filePath, fileName, mimeType) {
    const drive = google.drive({ version: 'v3', auth });

    this.logger.info(`Drive 업로드: ${fileName}`);
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        ...(this.driveFolderId && { parents: [this.driveFolderId] }),
      },
      media: { mimeType, body: createReadStream(filePath) },
      fields: 'id,webViewLink,name',
    });

    // 링크 공유 (누구나 열람 가능)
    await drive.permissions.create({
      fileId: res.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    this.logger.info(`Drive 업로드 완료: ${res.data.webViewLink}`);
    return res.data;
  }

  // ── Gmail 발송 (본문 HTML + 첨부파일) ──────────────────────────────────
  async _sendEmail(auth, { to, subject, htmlBody, attachments = [] }) {
    const gmail = google.gmail({ version: 'v1', auth });
    const outer = `outer_${Date.now()}`;
    const inner = `inner_${Date.now()}`;

    // multipart/mixed: 본문 + 첨부
    const parts = [
      `To: ${to}`,
      `From: me`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      '',
      `--${outer}`,
      `Content-Type: multipart/alternative; boundary="${inner}"`,
      '',
      `--${inner}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(htmlBody, 'utf8').toString('base64'),
      `--${inner}--`,
    ];

    for (const att of attachments) {
      const content = (await readFile(att.path)).toString('base64');
      parts.push(
        `--${outer}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        content
      );
    }
    parts.push(`--${outer}--`);

    const raw = Buffer.from(parts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    this.logger.info(`이메일 발송 완료 → ${to}`);
  }

  // ── 이메일 본문: 요약 + 상세 PICO ───────────────────────────────────────
  _buildEmailHtml(sessionId, driveUrl, topPapers = []) {
    const medals = ['🥇', '🥈', '🥉'];
    const evidenceColor = { High:'#10b981', Moderate:'#3b82f6', Low:'#f59e0b', 'Very Low':'#ef4444' };

    const picoCards = topPapers.slice(0, 3).map((p, i) => {
      const score = p.clinicalApplicabilityScore ?? p.paper?.scoringData?.score ?? '—';
      const title = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const authors = (p.paper?.authors ?? []).slice(0, 3).join(', ');
      const pubDate = p.paper?.pubDate ?? '';
      const pico = p.pico ?? {};
      const evidence = p.evidenceLevel ?? '—';
      const evColor = evidenceColor[evidence] ?? '#6b7280';
      const findings = (p.keyFindings ?? []).map(f => `<li style="margin:4px 0">${f}</li>`).join('');
      const pmUrl = p.paper?.pubmedUrl ?? '#';

      return `
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px;border-left:4px solid #3b82f6">
  <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
    <span style="font-size:24px">${medals[i]}</span>
    <div style="flex:1">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <span style="background:#3b82f6;color:white;padding:2px 10px;border-radius:999px;font-weight:700;font-size:13px">${score}점</span>
        <span style="background:${evColor};color:white;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">${evidence}</span>
      </div>
      <a href="${pmUrl}" style="color:#1e3a5f;font-weight:700;font-size:15px;text-decoration:none">${title}</a>
      <div style="color:#6b7280;font-size:12px;margin-top:4px">${authors} · ${journal} (${pubDate})</div>
    </div>
  </div>

  <!-- 임상 질문 -->
  <div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 12px;border-radius:4px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:700;color:#2563eb;margin-bottom:4px">📌 임상 질문</div>
    <div style="font-size:13px;color:#374151">${p.clinicalQuestion ?? '—'}</div>
  </div>

  <!-- PICO -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px">
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151;width:28%">👥 P (대상)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.population ?? '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">💉 I (중재)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.intervention ?? '—'}</td>
    </tr>
    <tr style="background:#f8fafc">
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">⚖️ C (비교)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.comparison ?? '—'}</td>
    </tr>
    <tr>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;color:#374151">📊 O (결과)</td>
      <td style="padding:8px 10px;border:1px solid #e5e7eb;color:#374151">${pico.outcome ?? '—'}</td>
    </tr>
  </table>

  <!-- 핵심 결과 -->
  ${findings ? `<div style="margin-bottom:12px">
    <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">🔑 핵심 결과</div>
    <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px">${findings}</ul>
  </div>` : ''}

  <!-- 임상 적용 -->
  <div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 12px;border-radius:4px;margin-bottom:8px">
    <div style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px">⚡ 임상 적용 포인트</div>
    <div style="font-size:13px;color:#374151">${p.clinicalTakeaway ?? '—'}</div>
  </div>

  <div style="font-size:11px;color:#9ca3af"><strong>제한점:</strong> ${p.limitations ?? '—'}</div>
</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:0">
<div style="max-width:680px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px 36px;color:white">
    <div style="font-size:28px;margin-bottom:4px">🏥</div>
    <h1 style="margin:0;font-size:20px;font-weight:700">Trend Review 논문 분석 완료</h1>
    <p style="margin:8px 0 0;color:#bfdbfe;font-size:13px">최근 30일 응급의학·중환자의학 문헌 자동 분석 · Claude AI</p>
  </div>

  <div style="padding:32px 36px">
    <p style="color:#374151;margin-top:0">PubMed 최신 논문 <strong>50편</strong>을 분석하여 임상 적용성 기준 <strong>Top 3</strong>를 선정했습니다.<br>
    전체 인터랙티브 대시보드는 첨부된 HTML 파일 또는 Google Drive 링크에서 확인하세요.</p>

    <a href="${driveUrl}" style="display:block;background:#2563eb;color:white;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;text-align:center;margin-bottom:28px">
      📊 Google Drive에서 대시보드 열기
    </a>

    <h2 style="font-size:17px;color:#1e3a5f;border-bottom:2px solid #dbeafe;padding-bottom:10px;margin-bottom:20px">
      🏆 Top 3 논문 — PICO 상세 분석
    </h2>

    ${picoCards}

    <p style="margin-top:24px;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">
      Session: ${sessionId} · 생성: ${new Date().toLocaleString('ko-KR')}<br>
      본 분석 결과는 보조 도구이며, 임상 결정은 전문의 판단을 따르십시오.
    </p>
  </div>
</div>
</body></html>`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  async run(sessionId, { htmlPath, jsonPath }, topPapers = [], pagesUrl = null) {
    this.logger.section('NotificationAgent' + (process.env.ENABLE_GMAIL === 'true' ? ' — Drive & Gmail' : ' — (Gmail 비활성)'));

    // ── Google Drive + Gmail (ENABLE_GMAIL=true 일 때만) ──────────────────
    let driveHtmlUrl = null;
    if (process.env.ENABLE_GMAIL === 'true') {
      if (!this.recipientEmail) {
        throw new Error('NOTIFY_EMAIL이 설정되지 않았습니다 (.env 확인)');
      }

      const auth = await this._getAuth();

      const htmlFile = await this._uploadFile(
        auth, htmlPath,
        `Trend_Review_${sessionId}.html`, 'text/html'
      );
      driveHtmlUrl = htmlFile.webViewLink;

      await this._sendEmail(auth, {
        to: this.recipientEmail,
        subject: `[Trend Review] 최신 논문 분석 완료 — ${new Date().toLocaleDateString('ko-KR')}`,
        htmlBody: this._buildEmailHtml(sessionId, htmlFile.webViewLink, topPapers),
        attachments: [
          { path: htmlPath, filename: `Trend_Review_${sessionId}.html`, mimeType: 'text/html' },
        ],
      });
    }

    return {
      ...(driveHtmlUrl && { driveHtmlUrl, sentTo: this.recipientEmail }),
    };
  }
}
```

## `src/utils/LLMClient.js`

```javascript
/**
 * LLMClient — provider-agnostic wrapper for Anthropic and OpenAI tool-use calls.
 *
 * Accepts Anthropic-style tool definitions ({ name, description, input_schema })
 * and transparently translates them to OpenAI function-calling format.
 * Returns the parsed tool-result object from either provider.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const PROVIDER_DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

export class LLMClient {
  constructor({ provider = 'anthropic', model, apiKey } = {}) {
    this.provider = provider;
    this.model = model ?? PROVIDER_DEFAULTS[provider];

    if (provider === 'anthropic') {
      this._client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
    } else if (provider === 'openai') {
      this._client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    } else {
      throw new Error(`Unknown provider: "${provider}". Supported: "anthropic", "openai"`);
    }
  }

  get label() {
    return `${this.provider}/${this.model}`;
  }

  /**
   * Call the LLM with a single forced tool.
   *
   * @param {Array}  messages   - OpenAI/Anthropic-style message array
   * @param {object} tool       - Anthropic tool def { name, description, input_schema }
   * @param {object} opts
   * @param {number} opts.maxTokens
   * @returns {Promise<object>} - Parsed tool-result JSON
   */
  async callWithTool(messages, tool, { maxTokens = 8192 } = {}) {
    if (this.provider === 'anthropic') {
      return this._callAnthropic(messages, tool, maxTokens);
    }
    if (this.provider === 'openai') {
      return this._callOpenAI(messages, tool, maxTokens);
    }
  }

  async _callAnthropic(messages, tool, maxTokens) {
    const response = await this._client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages,
    });
    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error(`${this.label}: no tool_use block in response`);
    return block.input;
  }

  async _callOpenAI(messages, tool, maxTokens) {
    const openaiTool = {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        // Anthropic input_schema is standard JSON Schema — compatible as-is
        parameters: tool.input_schema,
      },
    };

    const response = await this._client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      tools: [openaiTool],
      tool_choice: { type: 'function', function: { name: tool.name } },
      messages,
    });

    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error(`${this.label}: no tool_call in response`);
    return JSON.parse(call.function.arguments);
  }
}
```

## `src/utils/Cache.js`

```javascript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

export class Cache {
  constructor(options = {}) {
    this.dir = options.dir ?? path.join(process.cwd(), 'output', 'cache');
    this.ttlMs = (options.ttlHours ?? Number(process.env.CACHE_TTL_HOURS ?? 24)) * 3_600_000;
    this.enabled = options.enabled !== false;
  }

  _keyToFile(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    const safe = key.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    return path.join(this.dir, `${safe}_${hash}.json`);
  }

  async get(key) {
    if (!this.enabled) return null;
    const file = this._keyToFile(key);
    try {
      const raw = await readFile(file, 'utf8');
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > this.ttlMs) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async set(key, data) {
    if (!this.enabled) return;
    try {
      if (!existsSync(this.dir)) await mkdir(this.dir, { recursive: true });
      const file = this._keyToFile(key);
      await writeFile(file, JSON.stringify({ ts: Date.now(), key, data }, null, 2));
    } catch { /* non-fatal */ }
  }

  async getOrFetch(key, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) return { data: cached, fromCache: true };
    const data = await fetchFn();
    await this.set(key, data);
    return { data, fromCache: false };
  }

  async invalidate(key) {
    const file = this._keyToFile(key);
    try {
      const { unlink } = await import('fs/promises');
      await unlink(file);
    } catch { /* non-fatal */ }
  }
}
```

## `src/utils/CircuitBreaker.js`

```javascript
/**
 * Circuit Breaker — prevents cascading failures in agent-to-service calls.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (recovery probe)
 */
export class CircuitBreaker {
  static STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  constructor(name, options = {}) {
    this.name = name;
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureThreshold = options.failureThreshold ?? Number(process.env.CB_FAILURE_THRESHOLD ?? 5);
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? Number(process.env.CB_RECOVERY_TIMEOUT_MS ?? 60_000);
    this.successThreshold = options.successThreshold ?? 2;

    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.stats = { calls: 0, successes: 0, failures: 0, rejected: 0 };
  }

  get isOpen() { return this.state === CircuitBreaker.STATES.OPEN; }
  get isClosed() { return this.state === CircuitBreaker.STATES.CLOSED; }
  get isHalfOpen() { return this.state === CircuitBreaker.STATES.HALF_OPEN; }

  async execute(fn) {
    this.stats.calls++;
    this._checkRecovery();

    if (this.isOpen) {
      this.stats.rejected++;
      throw new CircuitOpenError(`Circuit [${this.name}] is OPEN — service unavailable`);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _checkRecovery() {
    if (
      this.isOpen &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime >= this.recoveryTimeoutMs
    ) {
      this.state = CircuitBreaker.STATES.HALF_OPEN;
      this.successCount = 0;
    }
  }

  _onSuccess() {
    this.stats.successes++;
    this.failureCount = 0;

    if (this.isHalfOpen) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitBreaker.STATES.CLOSED;
        this.successCount = 0;
      }
    }
  }

  _onFailure() {
    this.stats.failures++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.isClosed && this.failureCount >= this.failureThreshold ||
      this.isHalfOpen
    ) {
      this.state = CircuitBreaker.STATES.OPEN;
    }
  }

  reset() {
    this.state = CircuitBreaker.STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      stats: { ...this.stats },
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
```

## `src/utils/RetryHelper.js`

```javascript
/**
 * Exponential backoff retry with jitter.
 * Respects circuit breaker state — stops retrying if circuit is open.
 */
export class RetryHelper {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? Number(process.env.RETRY_MAX_ATTEMPTS ?? 3);
    this.baseDelayMs = options.baseDelayMs ?? Number(process.env.RETRY_BASE_DELAY_MS ?? 1_000);
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitter = options.jitter !== false;
    this.retryableErrors = options.retryableErrors ?? null; // null = retry all
  }

  _delay(attempt) {
    const exponential = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    return this.jitter
      ? exponential * (0.5 + Math.random() * 0.5)
      : exponential;
  }

  _isRetryable(err) {
    if (err.name === 'CircuitOpenError') return false;
    if (!this.retryableErrors) return true;
    return this.retryableErrors.some(
      (e) => err instanceof e || err.code === e || err.status === e
    );
  }

  async execute(fn, { label = 'operation', onRetry } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastErr = err;
        if (attempt === this.maxAttempts || !this._isRetryable(err)) throw err;

        const delay = this._delay(attempt);
        if (onRetry) onRetry({ attempt, label, err, delay });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }
}

export async function withRetry(fn, options = {}) {
  return new RetryHelper(options).execute(fn);
}
```

## `src/utils/Logger.js`

```javascript
import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[36m',
  info:  '\x1b[32m',
  warn:  '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
  bold:  '\x1b[1m',
};

export class Logger {
  constructor(name, options = {}) {
    this.name = name;
    this.level = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;
    this.logDir = options.logDir ?? path.join(process.cwd(), 'output', 'logs');
    this.logFile = options.logFile ?? null;
    this.entries = [];
  }

  _format(level, message, meta) {
    const ts = new Date().toISOString();
    const entry = { ts, level, agent: this.name, message, ...(meta && { meta }) };
    this.entries.push(entry);
    return entry;
  }

  _print(level, entry) {
    if (LEVELS[level] < this.level) return;
    const c = COLORS[level];
    const ts = `${COLORS.dim}${entry.ts}${COLORS.reset}`;
    const tag = `${c}${COLORS.bold}[${level.toUpperCase()}]${COLORS.reset}`;
    const agent = `${COLORS.dim}[${this.name}]${COLORS.reset}`;
    const msg = level === 'error' ? `${COLORS.bold}${entry.message}${COLORS.reset}` : entry.message;
    console.log(`${ts} ${tag} ${agent} ${msg}`);
    if (entry.meta) {
      console.log(`       ${COLORS.dim}${JSON.stringify(entry.meta)}${COLORS.reset}`);
    }
  }

  async _persist(entry) {
    if (!this.logFile) return;
    try {
      if (!existsSync(this.logDir)) await mkdir(this.logDir, { recursive: true });
      await appendFile(
        path.join(this.logDir, this.logFile),
        JSON.stringify(entry) + '\n'
      );
    } catch { /* non-fatal */ }
  }

  _log(level, message, meta) {
    const entry = this._format(level, message, meta);
    this._print(level, entry);
    this._persist(entry);
    return entry;
  }

  debug(msg, meta) { return this._log('debug', msg, meta); }
  info(msg, meta)  { return this._log('info',  msg, meta); }
  warn(msg, meta)  { return this._log('warn',  msg, meta); }
  error(msg, meta) { return this._log('error', msg, meta); }

  section(title) {
    const line = '─'.repeat(60);
    console.log(`\n${COLORS.bold}${line}${COLORS.reset}`);
    console.log(`${COLORS.bold}  ${title}${COLORS.reset}`);
    console.log(`${COLORS.bold}${line}${COLORS.reset}\n`);
  }

  getEntries() { return [...this.entries]; }

  async saveSession(sessionId) {
    const sessionPath = path.join(this.logDir, `session_${sessionId}.jsonl`);
    try {
      if (!existsSync(this.logDir)) await mkdir(this.logDir, { recursive: true });
      for (const entry of this.entries) {
        await appendFile(sessionPath, JSON.stringify(entry) + '\n');
      }
      return sessionPath;
    } catch (err) {
      this.error('Failed to save session log', { err: err.message });
      return null;
    }
  }
}
```

## `src/utils/GitHubPublisher.js`

```javascript
/**
 * GitHubPublisher
 * 매일 실행 결과를 GitHub Pages의 index.html에 누적 업데이트
 */
import { readFile } from 'fs/promises';

const API = 'https://api.github.com';

export class GitHubPublisher {
  constructor({
    token  = process.env.GITHUB_TOKEN,
    owner  = process.env.GITHUB_OWNER,
    repo   = process.env.GITHUB_REPO,
  } = {}) {
    this.token = token;
    this.owner = owner;
    this.repo  = repo;
    this.pagesUrl = `https://${owner}.github.io/${repo}/`;
  }

  async _req(path, method = 'GET', body = null) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `token ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async _getIndex() {
    try {
      const data = await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`);
      return {
        sha: data.sha,
        html: Buffer.from(data.content, 'base64').toString('utf8'),
      };
    } catch {
      return { sha: null, html: null };
    }
  }

  // ── Static helpers (ReportGeneratorAgent.js 동기화) ──────────────────────

  static _extractN(populationText) {
    const m = (populationText ?? '').match(/n\s*[=:]\s*([\d,]+)/i)
      ?? (populationText ?? '').match(/([\d,]+)\s*(?:patients|participants|children|encounters|hospitalizations|adults|subjects)/i);
    return m ? m[1] : null;
  }

  static _internalValidityLabel(ev) {
    if (['High', 'RCT', 'Meta', 'Meta-analysis', 'Systematic Review'].includes(ev))
      return { label: 'Low Risk', cls: 'bg-gray-900 text-white' };
    if (['Moderate', 'Cohort', 'Validation'].includes(ev))
      return { label: 'Some Concerns', cls: 'bg-gray-600 text-white' };
    return { label: 'High Risk', cls: 'bg-gray-300 text-gray-800' };
  }

  static _edApplicabilityLabel(score) {
    const s = Number(score);
    if (s >= 8) return { label: '적용 가능', cls: 'bg-gray-900 text-white' };
    if (s >= 5) return { label: '부분 적용', cls: 'bg-gray-600 text-white' };
    return { label: '적용 어려움', cls: 'bg-gray-300 text-gray-800' };
  }

  // ── Section builder ───────────────────────────────────────────────────────

  _buildTodaySection(dateStr, generatedAt, topPapers) {
    const numBg  = ['bg-gray-900', 'bg-gray-600', 'bg-gray-400'];
    const evStyle = {
      High:               'border border-gray-800 text-gray-800',
      Moderate:           'border border-gray-400 text-gray-600',
      Low:                'border border-gray-300 text-gray-400',
      'Very Low':         'border border-gray-200 text-gray-400',
      RCT:                'border border-gray-800 text-gray-800',
      Meta:               'border border-gray-800 text-gray-800',
      'Meta-analysis':    'border border-gray-800 text-gray-800',
      'Systematic Review':'border border-gray-800 text-gray-800',
      Cohort:             'border border-gray-400 text-gray-600',
      Validation:         'border border-gray-400 text-gray-600',
      Review:             'border border-gray-300 text-gray-400',
      Other:              'border border-gray-200 text-gray-400',
    };

    const summaryList = topPapers.slice(0, 3).map((p, i) => {
      const circ  = ['①','②','③'][i];
      const title   = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const date    = p.paper?.pubDate ?? '';
      const pmid    = p.paper?.pmid ?? '';
      return `
        <div class="text-[16px] font-extrabold text-gray-700 mt-1">${circ} ${_esc(title)}</div>
        <div class="text-[12px] text-gray-400 pl-3">${_esc(journal)} · ${_esc(date)}${pmid ? ` · PMID ${pmid}` : ''}</div>`;
    }).join('');

    const paperCards = topPapers.slice(0, 3).map((p, i) => {
      const nb      = numBg[i];
      const title   = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const date    = p.paper?.pubDate ?? '';
      const pmid    = p.paper?.pmid ?? '';
      const pmurl   = p.paper?.pubmedUrl ?? '#';
      const studyType = p.paper?.scoringData?.studyType ?? '';
      const score   = p.clinicalApplicabilityScore ?? '—';
      const ev      = p.evidenceLevel ?? '—';
      const evCls   = evStyle[ev] ?? 'border border-gray-300 text-gray-400';
      const evShort = { 'Meta-analysis':'Meta','Systematic Review':'SR','Moderate':'Mod','Very Low':'V.Low' }[ev] ?? ev;

      const picoEn = p.pico ?? {};
      const picoKo = p.pico_ko ?? {};
      const baseline = p.baseline ?? 'Not reported';
      const nVal = GitHubPublisher._extractN(picoEn.population ?? picoKo.population ?? '');
      const validity = GitHubPublisher._internalValidityLabel(ev);
      const edApply  = GitHubPublisher._edApplicabilityLabel(score);

      // 영어 원문(위) + 한글 번역(아래) 병렬 — 동일 양식, 블록 장식 없음
      const enKo = (en, ko) => `
        <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(en ?? '—')}</p>
        ${ko ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(ko)}</p>` : ''}`;
      const subhead = (label) => `<div class="text-[15px] font-black text-blue-700 mt-3 mb-1">${label}</div>`;
      const sectionTitle = (label) => `<div class="text-[16px] font-black text-blue-900 mt-4 mb-1.5 pb-1 border-b border-gray-200">${label}</div>`;

      const secondaryItems = (p.secondaryOutcomes ?? []).map((s, k) => `
        <li class="mb-1.5 pl-2.5 border-l-2 border-gray-200">
          <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(s)}</p>
          ${p.secondaryOutcomes_ko?.[k] ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(p.secondaryOutcomes_ko[k])}</p>` : ''}
        </li>`).join('');

      const glossaryItems = (p.statGlossary ?? []).map(
        (g) => `<div class="mb-0.5"><b class="text-gray-600">${_esc(g.term)}</b> — ${_esc(g.explanation_ko)}</div>`
      ).join('');
      const glossaryBlock = glossaryItems
        ? `<div class="mt-2 bg-gray-50 rounded-lg px-3 py-2 text-[12px] text-gray-500 leading-relaxed"><div class="font-bold text-gray-600 mb-1">통계 용어 풀이</div>${glossaryItems}</div>`
        : '';

      const practiceItems = (p.practiceChange ?? []).map((t, k) => `
        <li class="mb-1.5 flex gap-1.5">
          <span class="text-blue-700 font-bold flex-shrink-0">·</span>
          <div>
            <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(t)}</p>
            ${p.practiceChange_ko?.[k] ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(p.practiceChange_ko[k])}</p>` : ''}
          </div>
        </li>`).join('');

      const numBadge = (i + 1).toString().padStart(2, '0');
      const doiLink = p.paper?.doi
        ? ` · <a href="https://doi.org/${_esc(p.paper.doi)}" target="_blank" class="text-blue-600 underline">DOI</a>`
        : '';

      return `
    <details class="group">
      <summary class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition select-none">
        <span class="w-7 h-7 rounded-full ${nb} text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0">${numBadge}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[16px] font-black text-blue-900 leading-snug">${_esc(title)}</div>
          <div class="text-[12px] text-gray-400 mt-0.5">${_esc(journal)} · ${_esc(date)}</div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[12px] ${evCls} px-1.5 py-0.5 rounded-full">${evShort}</span>
          <svg class="chev w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </summary>
      <div class="slide-in px-4 pb-4 pt-2 bg-gray-50/60">
        <div class="text-[12px] text-gray-500">
          <b class="text-gray-700">${_esc(journal)}</b> · ${_esc(date)}${studyType ? ` · ${_esc(studyType)}` : ''} · <a href="${pmurl}" target="_blank" class="text-blue-600 underline">PubMed${pmid ? ` ${pmid}` : ''}</a>${doiLink}
        </div>

        ${subhead('Why It Matters')}
        ${enKo(p.clinicalQuestion, p.clinicalQuestion_ko)}

        ${sectionTitle('PICO Framework')}
        ${subhead('P — Patient')}
        ${enKo(picoEn.population, picoKo.population)}
        <div class="text-[13px] text-gray-700 mt-1">${nVal ? `<b>n = ${_esc(nVal)}</b> · ` : ''}<span class="text-gray-500">Baseline —</span> <b>${_esc(baseline)}</b></div>
        ${subhead('I — Intervention')}
        ${enKo(picoEn.intervention, picoKo.intervention)}
        ${subhead('C — Comparison')}
        ${enKo(picoEn.comparison, picoKo.comparison)}
        ${subhead('O — Outcome & Results')}
        <div class="text-[12px] font-bold text-gray-500 uppercase mb-0.5">Primary</div>
        ${enKo(picoEn.outcome, picoKo.outcome)}
        ${secondaryItems ? `<div class="text-[12px] font-bold text-gray-500 uppercase mt-2 mb-0.5">Secondary</div><ul>${secondaryItems}</ul>` : ''}
        ${glossaryBlock}

        ${sectionTitle('Critical Appraisal & Applicability')}
        <div class="text-[13px] text-gray-800"><span class="font-bold text-blue-700">Internal Validity</span> — <b>${_esc(validity.label)}</b></div>
        ${p.paper?.scoringData?.rationale ? `<div class="text-[13px] text-gray-600 mt-0.5"><span class="text-gray-500">Reason :</span> ${_esc(p.paper.scoringData.rationale)}</div>` : ''}
        ${subhead('Limitations')}
        ${enKo(p.limitations, p.limitations_ko)}
        <div class="text-[13px] text-gray-800 mt-2"><span class="font-bold text-blue-700">ED Applicability</span> — <b>${_esc(edApply.label)}</b></div>

        ${sectionTitle('Clinical Bottom Line')}
        ${enKo(p.clinicalTakeaway, p.clinicalTakeaway_ko)}
        ${practiceItems ? `${subhead('Practice Change')}<ul class="mt-0.5">${practiceItems}</ul>` : ''}
      </div>
    </details>`;
    }).join('');

    return `
<!-- SECTION:${dateStr} -->
<details open class="rounded-xl overflow-hidden shadow-sm border-2 border-gray-900 bg-white">
  <summary class="px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition select-none">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-2.5">
        <span class="bg-gray-900 text-white text-[12px] font-bold px-2 py-0.5 rounded-full">TODAY</span>
        <span class="font-black text-gray-900 text-[18px]">${dateStr}</span>
        <span class="text-gray-400 text-[14px]">· ${topPapers.length}편</span>
        <span class="text-gray-300 text-[12px] ml-auto">생성 ${_esc(generatedAt)}</span>
      </div>
      <div class="space-y-1">${summaryList}
      </div>
    </div>
    <svg class="chev w-4 h-4 text-gray-400 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
  </summary>
  <div class="slide-in border-t-2 border-gray-900 divide-y divide-gray-100">
    ${paperCards}
  </div>
</details>
<!-- /SECTION:${dateStr} -->`;
  }

  async publish(dateStr, topPapers) {
    const { sha, html } = await this._getIndex();

    if (!html) {
      throw new Error('index.html을 GitHub에서 가져올 수 없습니다');
    }

    const generatedAt = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    // 같은 날짜의 기존 섹션 제거 (재실행 시 중복 방지)
    const dupSection = new RegExp(
      `<!-- SECTION:${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<!-- /SECTION:${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`,
      'g'
    );
    const deduped = html.replace(dupSection, '');

    // 기존 TODAY 배지 제거, 섹션을 past 스타일로 전환
    let updated = deduped
      .replace(/<span class="bg-gray-900 text-white text-\[10px\] font-bold px-2 py-0\.5 rounded-full">TODAY<\/span>/g, '')
      .replace(/<details open class="rounded-xl overflow-hidden shadow-sm border-2 border-gray-900 bg-white">/g,
               '<details class="rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-white">')
      .replace(/class="slide-in border-t-2 border-gray-900 divide-y divide-gray-100"/g,
               'class="slide-in border-t border-gray-200 divide-y divide-gray-100"');

    // 새 TODAY 섹션을 아카이브 컨테이너 맨 위에 삽입
    const todaySection = this._buildTodaySection(dateStr, generatedAt, topPapers);
    updated = updated.replace(
      /(<div class="max-w-2xl mx-auto px-3 py-5 space-y-3">)/,
      `$1\n${todaySection}`
    );

    // 통계 업데이트
    const dayCount   = (updated.match(/<!-- SECTION:/g) ?? []).length;
    const paperCount = dayCount * 3;
    updated = updated
      .replace(/<div class="stat-days-count[^"]*">\d+<\/div>/,
               `<div class="stat-days-count text-3xl font-black tabular-nums">${dayCount}</div>`)
      .replace(/<div class="stat-papers-count[^"]*">\d+<\/div>/,
               `<div class="stat-papers-count text-3xl font-black tabular-nums">${paperCount}</div>`)
      .replace(/<div class="stat-updated-time[^"]*">[^<]+<\/div>/,
               `<div class="stat-updated-time text-sm font-semibold text-gray-300">${generatedAt}</div>`);

    const content = Buffer.from(updated, 'utf8').toString('base64');
    await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`, 'PUT', {
      message: `Update archive: ${dateStr}`,
      content,
      sha,
    });

    return this.pagesUrl;
  }
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

## `fetch_papers_action.yml`

```yaml
name: Fetch Papers Daily

on:
  schedule:
    - cron: '30 21 * * *'   # 21:30 UTC = 06:30 KST (routine runs 07:00 KST)
  workflow_dispatch:          # allow manual run from Actions tab

permissions:
  contents: write             # GITHUB_TOKEN can push (no PAT needed)

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Fetch, screen, and pre-score EM/CCM papers
        run: |
          python3 - <<'EOF'
          import json, re, urllib.request, urllib.parse
          from datetime import datetime, timedelta, timezone

          # ---------- window ----------
          now   = datetime.now(timezone.utc)
          since = (now - timedelta(days=30)).strftime('%Y-%m-%d')
          today = now.strftime('%Y-%m-%d')

          # ---------- Stage 0+1: query with publication-type hard filter ----------
          topic = ('(emergency medicine OR emergency department OR critical care OR '
                   'intensive care OR resuscitation OR sepsis OR septic shock OR trauma OR '
                   'cardiac arrest OR mechanical ventilation OR acute respiratory)')
          incl  = ('(PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Meta-Analysis" OR '
                   'PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Multicenter Study" OR '
                   'PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline" OR '
                   'PUB_TYPE:"Comparative Study" OR PUB_TYPE:"Observational Study")')
          excl  = ('NOT (PUB_TYPE:"Case Reports" OR PUB_TYPE:"Editorial" OR PUB_TYPE:"Letter" OR '
                   'PUB_TYPE:"Comment" OR PUB_TYPE:"News" OR PUB_TYPE:"Published Erratum")')
          query = (f'{topic} AND {incl} {excl} AND '
                   f'(FIRST_PDATE:[{since} TO {today}]) AND (LANG:"eng") AND (SRC:"MED")')

          base = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
          params = {'query': query, 'resultType': 'core', 'pageSize': '200',
                    'format': 'json', 'sort': 'P_PDATE_D desc'}
          url = base + '?' + urllib.parse.urlencode(params)
          resp = json.loads(urllib.request.urlopen(url, timeout=40).read())
          results = resp.get('resultList', {}).get('result', [])

          # ---------- Stage 2: journal tier (EXACT abbreviation match) ----------
          # Keyed by normalized Medline abbreviation -> (tier, weight).
          # Exact match avoids 'BMJ Open'/'JAMA Surg' being mistaken for flagship BMJ/JAMA.
          JMAP = {
              # Tier 1 — general flagship (very high IF)
              'n engl j med': (1, 40), 'lancet': (1, 40), 'jama': (1, 40),
              'bmj': (1, 40), 'nat med': (1, 40),
              # Tier 2 — high-impact specialty / general
              'intensive care med': (2, 30), 'am j respir crit care med': (2, 30),
              'lancet respir med': (2, 30), 'lancet infect dis': (2, 30),
              'circulation': (2, 30), 'ann intern med': (2, 30), 'eur heart j': (2, 30),
              'jama intern med': (2, 30), 'jama cardiol': (2, 30), 'jama surg': (2, 30),
              'jama neurol': (2, 30),
              # Tier 3 — core EM / critical-care journals
              'ann emerg med': (3, 20), 'crit care med': (3, 20), 'crit care': (3, 20),
              'critical care': (3, 20), 'resuscitation': (3, 20), 'chest': (3, 20),
              'acad emerg med': (3, 20), 'emerg med j': (3, 20), 'shock': (3, 20),
              'ann intensive care': (3, 20), 'eur j emerg med': (3, 20), 'cjem': (3, 20),
              'jama netw open': (3, 18),
          }

          def journal_tier(abbrev, title):
              key = (abbrev or '').strip().rstrip('.').lower()
              if key in JMAP: return JMAP[key]
              tkey = (title or '').strip().rstrip('.').lower()
              if tkey in JMAP: return JMAP[tkey]
              return (4, 8)

          # ---------- Stage 2: EM/CCM relevance GATE + bonus ----------
          # Returns None to HARD-DROP a paper that is not genuinely EM/CCM.
          CORE = ['emergency department','emergency medicine','emergency physician','emergency care',
                  'intensive care','critical care','critically ill','critical illness',' icu ','icu,',
                  'sepsis','septic shock','resuscitation','cardiac arrest','cardiopulmonary',
                  'mechanical ventilation','out-of-hospital','prehospital','triage','vasopressor',
                  'intubation','acute respiratory distress','acute respiratory failure']
          VET = ['veterinar','bovine','swine','porcine','poultry','cattle','canine','feline',
                 'broiler','piglet','livestock']

          def relevance(title, abstract):
              t = (title or '').lower(); a = (abstract or '').lower(); s = t + ' ' + a
              if any(v in s for v in VET):
                  return None                         # off-domain (veterinary)
              hits = [c for c in CORE if c in s]
              if not hits:
                  return None                         # not EM/CCM -> drop
              score = min(len(hits) * 4, 20)
              if any(c in t for c in CORE):
                  score += 8                           # core topic appears in the title
              return score

          # ---------- Stage 2: study design ----------
          def design(pubtypes):
              s = ' '.join(pubtypes).lower()
              if 'meta-analysis' in s or 'systematic review' in s: return 25, 'Meta'
              if 'randomized controlled trial' in s:
                  return (25 if 'multicenter' in s else 18), 'RCT'
              if 'guideline' in s: return 20, 'Guideline'
              if 'observational' in s or 'cohort' in s: return 12, 'Cohort'
              return 5, 'Other'

          # ---------- Stage 2: rough sample size from abstract ----------
          def sample_size(abstract):
              if not abstract: return 0, ''
              nums = []
              for m in re.finditer(r'(?:n\s*=\s*|enrolled\s+|included\s+|randomi[sz]ed\s+|total\s+of\s+)([\d,]{2,})', abstract, re.I):
                  nums.append(int(m.group(1).replace(',', '')))
              for m in re.finditer(r'([\d,]{3,})\s+(?:patients|participants|subjects|adults)', abstract, re.I):
                  nums.append(int(m.group(1).replace(',', '')))
              if not nums: return 0, ''
              n = max(nums)
              w = 10 if n >= 1000 else 7 if n >= 500 else 4 if n >= 100 else 0
              return w, str(n)

          papers = []
          for r in results:
              pub  = r.get('firstPublicationDate', '')
              yr   = pub[:4] if pub else ''
              mo   = datetime.strptime(pub[5:7], '%m').strftime('%b') if len(pub) >= 7 else ''
              jrnl = (r.get('journalInfo', {}).get('journal', {}).get('medlineAbbreviation')
                      or r.get('journalInfo', {}).get('journal', {}).get('title')
                      or r.get('journalTitle', ''))
              pubtypes = r.get('pubTypeList', {}).get('pubType', []) or []
              if isinstance(pubtypes, str): pubtypes = [pubtypes]
              abstract = r.get('abstractText', '') or ''
              abstract = re.sub(r'<[^>]+>', '', abstract)

              rw = relevance(r.get('title', ''), abstract)
              if rw is None:
                  continue                             # hard-drop: not EM/CCM relevant
              jabbrev = (r.get('journalInfo', {}).get('journal', {}).get('medlineAbbreviation') or jrnl)
              tier, tw = journal_tier(jabbrev, jrnl)
              dw, stype = design(pubtypes)
              sw, n_est = sample_size(abstract)
              pre_score = tw + dw + sw + rw

              papers.append({
                  'pmid': r.get('pmid', ''),
                  'title': re.sub(r'<[^>]+>', '', r.get('title', '')),
                  'authors': r.get('authorString', ''),
                  'journal': jrnl,
                  'year': yr, 'month': mo,
                  'abstract': abstract,
                  'doi': r.get('doi', ''),
                  'pubDate': pub,
                  'journal_tier': tier,
                  'study_type': stype,
                  'n_est': n_est,
                  'pre_score': pre_score,
              })

          # ---------- Stage 2: rank, keep top 40 candidate pool ----------
          papers.sort(key=lambda p: p['pre_score'], reverse=True)
          papers = papers[:40]

          out = {'fetched_at': now.isoformat(), 'date': today,
                 'window_days': 30, 'candidate_count': len(papers), 'papers': papers}
          with open('data/raw_papers.json', 'w', encoding='utf-8') as f:
              json.dump(out, f, ensure_ascii=False)
          print(f'Fetched/screened -> {len(papers)} candidates (from {len(results)} raw)')
          EOF

      - name: Commit and push
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/raw_papers.json
          git diff --staged --quiet || git commit -m "Auto-fetch papers: $(date +%Y-%m-%d)"
          git push
```

## `fetch_papers_task.ps1`

```powershell
# Trend Review - Daily Paper Fetch (Windows Task Scheduler)
# Runs at 06:30 KST, fetches EM/CCM papers, pushes to GitHub raw_papers.json
# Scheduled via: Register-ScheduledTask (see registration command in project notes)

$TOKEN = "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"
$OWNER = "njell85-spec"
$REPO  = "Trend_Review"

$today = Get-Date
$since = $today.AddDays(-30).ToString("yyyy-MM-dd")
$toDay = $today.ToString("yyyy-MM-dd")

$logFile = "$env:TEMP\trend_review_fetch_$(Get-Date -Format 'yyyyMMdd').log"
"[$(Get-Date -Format 'HH:mm:ss')] Starting fetch for $toDay" | Out-File $logFile -Append

try {
    $query = "(emergency+medicine+OR+emergency+department+OR+critical+care+OR+intensive+care+OR+resuscitation+OR+sepsis+OR+trauma)+AND+(src:MED)+AND+(FIRST_PDATE:[${since}+TO+${toDay}])"
    $url   = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=$query&resultType=core&pageSize=50&format=json&sort=P_PDATE_D+desc"
    $resp  = Invoke-RestMethod -Uri $url -TimeoutSec 30

    $papers = @()
    foreach ($r in $resp.resultList.result) {
        $pub = if ($r.firstPublicationDate) { $r.firstPublicationDate } else { "" }
        $yr  = if ($pub -match '^(\d{4})') { $Matches[1] } else { "" }
        $mo  = if ($pub -match '^\d{4}-(\d{2})') { [datetime]::ParseExact($Matches[1],"MM",$null).ToString("MMM") } else { "" }
        $papers += [ordered]@{
            pmid     = if ($r.pmid) { "$($r.pmid)" } else { "" }
            title    = if ($r.title) { ($r.title -replace '<[^>]+>','') } else { "" }
            authors  = if ($r.authorString) { $r.authorString } else { "" }
            journal  = if ($r.journalAbbreviation) { $r.journalAbbreviation } elseif ($r.journalTitle) { $r.journalTitle } else { "" }
            year     = $yr
            month    = $mo
            abstract = if ($r.abstractText) { ($r.abstractText -replace '<[^>]+>','') } else { "" }
            doi      = if ($r.doi) { $r.doi } else { "" }
            pubDate  = $pub
        }
    }

    $payload = [ordered]@{
        fetched_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        date       = $toDay
        papers     = $papers
    }
    $json = $payload | ConvertTo-Json -Depth 5 -Compress

    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$OWNER/$REPO/contents/data/raw_papers.json" `
        -Headers @{Authorization="token $TOKEN"; Accept="application/vnd.github+json"}
    $encoded  = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    $body = @{message="Auto-fetch papers: $toDay"; content=$encoded; sha=$existing.sha} | ConvertTo-Json

    Invoke-RestMethod -Uri "https://api.github.com/repos/$OWNER/$REPO/contents/data/raw_papers.json" `
        -Method Put `
        -Headers @{Authorization="token $TOKEN"; Accept="application/vnd.github+json"; "Content-Type"="application/json"} `
        -Body $body | Out-Null

    "[$(Get-Date -Format 'HH:mm:ss')] SUCCESS — $($papers.Count) papers pushed to raw_papers.json" | Out-File $logFile -Append
} catch {
    "[$(Get-Date -Format 'HH:mm:ss')] ERROR: $_" | Out-File $logFile -Append
    exit 1
}
```

