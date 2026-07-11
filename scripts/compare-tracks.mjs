// scripts/compare-tracks.mjs
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { kstDateStr } from '../src/utils/dates.js';
import { LLMClient, ANTHROPIC_ANALYSIS_MODEL } from '../src/utils/LLMClient.js';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';
import { runOnce, isPastEndDate } from '../src/experiments/trackCompare.js';
import { renderComparisonHtml } from '../src/experiments/compareRender.js';

const EXP_DIR = 'experiments';
const CMP_PATH = path.join(EXP_DIR, 'track-comparison.json');
const HIST_PATH = path.join(EXP_DIR, 'arm2-history.json');
const HTML_PATH = path.join(EXP_DIR, 'compare.html');
const ARCHIVE_PATH = path.join('output', 'analysis_archive.json');

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

async function main() {
  if (process.env.ENABLE_TRACK_COMPARE !== 'true') { console.log('ENABLE_TRACK_COMPARE!=true — no-op'); return; }
  const today = kstDateStr();
  const endDate = process.env.TRACK_COMPARE_END ?? '';
  if (isPastEndDate(today, endDate)) { console.log(`${today} > TRACK_COMPARE_END(${endDate}) — 실험 종료, no-op`); return; }

  const sinceDate = kstDateStr(new Date(Date.now() - 183 * 86_400_000));

  // Arm1: 프로덕션 archive에서 오늘 엔트리(읽기 전용)
  const archive = await readJson(ARCHIVE_PATH, { entries: [] });
  const arm1Entry = (archive.entries ?? []).find((e) => e.date === today) ?? null;
  if (!arm1Entry) console.log(`⚠ 오늘(${today}) Arm1 archive 엔트리 없음 — arm1=null 기록`);

  const comparison = await readJson(CMP_PATH, { startDate: today, endDate, records: [] });
  comparison.startDate ??= today; comparison.endDate = endDate;
  const history = await readJson(HIST_PATH, { pmids: [] });

  const llm = new LLMClient({ provider: 'anthropic', model: ANTHROPIC_ANALYSIS_MODEL });
  const collector = new DataCollectorAgent();
  const analyzer = new FilterAnalyzerAgent();
  const logger = { warn: (m) => console.warn('WARN', m), info: (m) => console.log(m) };

  const { record, arm2Pmid, comparison: updated } = await runOnce({
    today, sinceDate, arm1Entry, arm2History: history.pmids ?? [], comparison, llm, collector, analyzer, logger,
  });
  if (arm2Pmid && !(history.pmids ?? []).includes(arm2Pmid)) (history.pmids ??= []).push(arm2Pmid);

  await mkdir(EXP_DIR, { recursive: true });
  await writeFile(CMP_PATH, JSON.stringify(updated, null, 2));
  await writeFile(HIST_PATH, JSON.stringify(history, null, 2));
  await writeFile(HTML_PATH, renderComparisonHtml(updated, { startDate: updated.startDate, endDate, today }));

  // Job summary (폰에서 Actions로 확인)
  const sum = `## 트랙 비교 ${today}\n- Arm1: ${arm1Entry ? `${arm1Entry.journal} · PMID ${arm1Entry.pmid}` : '없음'}\n- Arm2: ${arm2Pmid ? `PMID ${arm2Pmid}` : '선정 실패'}\n- 수렴: ${record.converged ? '예 🔗' : '아니오'}\n- URL: https://njell85-spec.github.io/trend-review/experiments/compare.html\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, sum, { flag: 'a' });
  console.log(sum);

  // 커밋·안전 푸시(데일리 커밋과 경합 회피)
  try {
    git(['add', CMP_PATH, HIST_PATH, HTML_PATH]);
    const staged = git(['diff', '--cached', '--name-only']);
    if (!staged) { console.log('변경 없음 — 커밋 스킵'); return; }
    git(['commit', '-m', `experiment: 트랙 비교 ${today}`]);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        git(['pull', '--rebase', 'origin', 'main']);
        git(['push', 'origin', 'HEAD:main']);
        console.log('푸시 완료'); return;
      } catch (err) {
        console.warn(`push 재시도 ${attempt}: ${err.message}`);
        if (attempt === 4) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  } catch (err) {
    console.error('커밋/푸시 실패(소프트):', err.message);  // 데일리 코어 무영향 — 종료코드 0 유지
  }
}

await main();
