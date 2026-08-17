#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BACKFILL_WINDOWS, runGuidelineBackfill } from '../src/utils/guidelineBackfill.js';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';

function help() {
  console.log(`Usage: node scripts/guideline-backfill.mjs [options]

Options:
  --windows <list>  Day-offset windows, or monthly:<N> (default: ${DEFAULT_BACKFILL_WINDOWS})
                    예: monthly:24 = 2년치를 30일씩 24조각
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

  // ★ PubMed 는 키 없이 **초당 3회**, 키가 있어도 10회다. 2년 백필은 창 24개 ×
  //   쿼리 13개라 esearch 만 300회를 넘는다 — 종전의 맨 `fetch` 로는 429 로 통째로
  //   죽는다(census 가 실제로 그렇게 죽었다, HANDOFF 2026-08-16 함정 ③).
  //   ① 최소 간격을 지키고 ② 429·5xx 는 지수 백오프로 다시 친다.
  const minIntervalMs = apiKey ? 110 : 350;
  let gate = Promise.resolve();
  const throttled = (fn) => {
    const run = gate.then(fn);
    gate = run.then(() => new Promise((r) => setTimeout(r, minIntervalMs)), () => new Promise((r) => setTimeout(r, minIntervalMs)));
    return run;
  };
  const fetchJson = async (url) => {
    const target = new URL(url);
    if (apiKey) target.searchParams.set('api_key', apiKey);
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await throttled(() => fetch(target, { headers: { Accept: 'application/json' } }));
        if (response.status === 429 || response.status >= 500) throw new Error(`PubMed HTTP ${response.status}`);
        if (!response.ok) throw new Error(`PubMed HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        // 마지막 시도면 더 기다리지 않고 올린다 — 조용히 빈 결과로 넘어가면 안 된다.
        if (attempt === 4) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastError;
  };
  // ★ 초록·MeSH 보강은 **논문 트랙의 검증된 파서**를 그대로 쓴다(efetch XML).
  //   여기서 따로 파싱을 쓰면 같은 PubMed 응답을 두 파서가 다르게 읽는 날이 온다.
  //   보강이 없으면 분류기의 `normative` 축이 항상 0 이라 백필이 needsReview 만 쌓는다.
  const collector = new DataCollectorAgent();
  const fetchArticles = (pmids) => collector.fetchArticles(pmids);
  const report = await runGuidelineBackfill({ windows: value('--windows') ?? DEFAULT_BACKFILL_WINDOWS, fetchJson, fetchArticles, apply: args.includes('--apply'), statePath: path.resolve('output/selected_guidelines.json') });
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  const failed = report.failedWindows ?? [];
  if (args.includes('--apply')) console.log('--apply: output/selected_guidelines.json 에 반영했다');
  console.log(`Wrote ${target} (창 ${report.windows.length}개 중 판정 가능 ${report.evaluatedWindows}개 · `
    + `수집 실패 ${failed.length}개${failed.length ? ` [${failed.join(', ')}]` : ''} · `
    + `정지 신호 ${report.stopSignals.length}건)`);
  for (const signal of report.stopSignals) console.error(`  STOP  ${signal}`);
  // ★ 실패한 실험이 성공한 실험처럼 보이면 안 된다 — 리포트는 남기되 종료 코드로 알린다.
  if (failed.length) process.exitCode = 3;
  else if (report.stopSignals.length) process.exitCode = 4;
}
