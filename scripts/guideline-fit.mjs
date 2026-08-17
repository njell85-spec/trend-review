#!/usr/bin/env node
/**
 * 풀 전체에 LLM 셀렉을 붙인다 (벌크).
 *
 * 데일리는 하루 40건까지만 판정한다 — 2년 풀은 수백 건이라 그 속도로는 몇 주가 걸린다.
 * 백필 직후 이 스크립트를 한 번 돌려 풀 전체에 판정을 붙이고, 그 뒤로는 데일리가
 * 새로 들어온 것만 따라잡는다.
 *
 *   node scripts/guideline-fit.mjs --limit 400
 */
import path from 'node:path';
import { loadGuidelineState, saveGuidelineState } from '../src/utils/guidelineState.js';
import { loadGuidelineTopics } from '../src/utils/guidelineTopics.js';
import { unscoredItems } from '../src/utils/guidelineFit.js';
import { GuidelineFitAgent } from '../src/agents/GuidelineFitAgent.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (args.includes('--help')) {
  console.log(`Usage: node scripts/guideline-fit.mjs [--limit <n>] [--state <path>] [--dry-run]`);
  process.exit(0);
}

const statePath = path.resolve(value('--state', 'output/selected_guidelines.json'));
const limit = Number(value('--limit', '400'));
const dryRun = args.includes('--dry-run');

const state = await loadGuidelineState(statePath);
const targets = unscoredItems(state.queue, { limit });
if (!targets.length) {
  console.log('· 판정할 것이 없다 (전부 판정 완료이거나 큐가 비었다)');
  process.exit(0);
}

let topicLabels = [];
try { topicLabels = Object.values(loadGuidelineTopics().groups).map((g) => g.label); } catch { /* 보조 정보다 */ }

console.log(`· 판정 대상 ${targets.length}건 / 큐 ${state.queue.length}건`);
const result = await new GuidelineFitAgent().score(targets, { topicLabels });

const byId = new Map(result.items.map((x) => [x.id, x]));
state.queue = state.queue.map((x) => byId.get(x.id) ?? x);

const keep = state.queue.filter((x) => x.llmFit?.keep === true).length;
const drop = state.queue.filter((x) => x.llmFit?.keep === false).length;
const queued = state.queue.filter((x) => x.status === 'queued').length;
console.log(`✔ 판정 ${result.scored}건 (배치 ${result.batches} · 실패 ${result.failed})`);
console.log(`  채택 ${keep} · 격리 ${drop} · 현재 queued ${queued} (= 예고에 뜰 수 있는 것)`);
if (result.error) console.error(`  ! 마지막 오류: ${result.error}`);

if (dryRun) { console.log('· --dry-run: 저장하지 않는다'); process.exit(0); }
state.updatedAt = new Date().toISOString();
await saveGuidelineState(statePath, state);
console.log(`· ${statePath} 저장 완료`);

// 전 배치가 실패했으면 초록으로 끝내지 않는다 — "돌렸는데 아무것도 안 붙었다" 를 숨기지 않는다.
if (result.batches && result.failed === result.batches) process.exitCode = 4;
