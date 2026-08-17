#!/usr/bin/env node
/**
 * 리뷰 저수지(트랙3)에 LLM 셀렉을 붙인다 (벌크).
 * PeterJ 확정 2026-08-17(3-1): *"트랙3 397건에도 LLM 셀렉 걸어라."*
 *
 *   node scripts/review-fit.mjs --limit 400
 *
 * ★ 가이드라인과 달리 **데일리 증분 판정이 없다.** 리뷰 큐를 채우는 것은 데일리가 아니라
 *   `scripts/build-review-queue.mjs` 이므로(데일리는 논문 큐만 채운다), 저수지를 새로
 *   지을 때 이것을 한 번 돌리면 된다. 데일리에 LLM 호출을 더 얹지 않는다.
 */
import path from 'node:path';
import { loadTrackQueue, saveTrackQueue } from '../src/utils/trackQueue.js';
import { loadGuidelineTopics } from '../src/utils/guidelineTopics.js';
import { unscoredItems } from '../src/utils/guidelineFit.js';
import {
  REVIEW_FIT_TOOL, buildReviewFitPrompt, toReviewFitInput, reviewPriorityOf,
} from '../src/utils/reviewFit.js';
import { GuidelineFitAgent } from '../src/agents/GuidelineFitAgent.js';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (args.includes('--help')) {
  console.log('Usage: node scripts/review-fit.mjs [--limit <n>] [--state <path>] [--dry-run]');
  process.exit(0);
}

const statePath = path.resolve(value('--state', 'output/queue_reviews.json'));
const limit = Number(value('--limit', '400'));
const dryRun = args.includes('--dry-run');

const state = await loadTrackQueue(statePath, 'reviews');
// ★ 규칙 점수 필드가 `score` 다(가이드라인은 `priority`). 안 넘기면 전건 0점으로 읽혀
//   예산이 모자라 잘리는 날 **아무 순서로** 판정이 붙는다.
const targets = unscoredItems(state.queue, { limit, priorityOf: reviewPriorityOf });
if (!targets.length) {
  console.log('· 판정할 것이 없다 (전부 판정 완료이거나 큐가 비었다)');
  process.exit(0);
}

let topicLabels = [];
try { topicLabels = Object.values(loadGuidelineTopics().groups).map((g) => g.label); } catch { /* 보조 정보다 */ }

console.log(`· 판정 대상 ${targets.length}건 / 큐 ${state.queue.length}건`);
const agent = new GuidelineFitAgent({
  tool: REVIEW_FIT_TOOL,
  buildPrompt: buildReviewFitPrompt,
  toInput: toReviewFitInput,
  label: 'review-fit',
});
const result = await agent.score(targets, { topicLabels });

// ★ 리뷰 큐의 식별자는 `pmid` 다(가이드라인은 `id`). 잘못 키면 판정이 **한 건도**
//   안 붙는데 로그는 성공으로 끝난다.
const byPmid = new Map(result.items.map((x) => [String(x.pmid), x]));
state.queue = state.queue.map((x) => byPmid.get(String(x.pmid)) ?? x);

const keep = state.queue.filter((x) => x.llmFit?.keep === true).length;
const drop = state.queue.filter((x) => x.llmFit?.keep === false).length;
const publishable = state.queue.filter((x) => x.status == null || x.status === 'queued').length;
console.log(`✔ 판정 ${result.scored}건 (배치 ${result.batches} · 실패 ${result.failed})`);
console.log(`  채택 ${keep} · 격리 ${drop} · 발행 가능 ${publishable} (= 예고에 뜰 수 있는 것)`);
if (result.error) console.error(`  ! 마지막 오류: ${result.error}`);

if (dryRun) { console.log('· --dry-run: 저장하지 않는다'); process.exit(0); }
state.updatedAt = new Date().toISOString();
await saveTrackQueue(statePath, state);
console.log(`· ${statePath} 저장 완료`);

// 전 배치가 실패했으면 초록으로 끝내지 않는다 — "돌렸는데 아무것도 안 붙었다" 를 숨기지 않는다.
if (result.batches && result.failed === result.batches) process.exitCode = 4;
