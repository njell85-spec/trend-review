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
