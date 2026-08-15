#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BACKFILL_WINDOWS, runGuidelineBackfill } from '../src/utils/guidelineBackfill.js';

function help() {
  console.log(`Usage: node scripts/guideline-backfill.mjs [options]

Options:
  --windows <list>  Day-offset windows (default: ${DEFAULT_BACKFILL_WINDOWS})
  --out <path>      JSON report path (required)
  --apply           Apply candidates to output/selected_guidelines.json
  --help            Show this help`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) { help(); process.exit(0); }
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const out = value('--out');
if (!out) { help(); process.exitCode = 2; }
else {
  const apiKey = process.env.PUBMED_API_KEY;
  const fetchJson = async (url) => {
    const target = new URL(url);
    if (apiKey) target.searchParams.set('api_key', apiKey);
    const response = await fetch(target, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`PubMed HTTP ${response.status}`);
    return response.json();
  };
  const report = await runGuidelineBackfill({ windows: value('--windows') ?? DEFAULT_BACKFILL_WINDOWS, fetchJson, apply: args.includes('--apply'), statePath: path.resolve('output/selected_guidelines.json') });
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  const failed = report.failedWindows ?? [];
  console.log(`Wrote ${target} (창 ${report.windows.length}개 중 판정 가능 ${report.evaluatedWindows}개 · `
    + `수집 실패 ${failed.length}개${failed.length ? ` [${failed.join(', ')}]` : ''} · `
    + `정지 신호 ${report.stopSignals.length}건)`);
  for (const signal of report.stopSignals) console.error(`  STOP  ${signal}`);
  // ★ 실패한 실험이 성공한 실험처럼 보이면 안 된다 — 리포트는 남기되 종료 코드로 알린다.
  if (failed.length) process.exitCode = 3;
  else if (report.stopSignals.length) process.exitCode = 4;
}
