/**
 * 트랙3 리뷰 LLM 셀렉 (PeterJ 확정 2026-08-17 · 3-1).
 *
 * ★ 이 파일이 잠그는 것 두 가지가 이번 작업의 전부다:
 *   ① 리뷰 프롬프트가 "지침이 아니다" 를 감점 사유로 쓰지 않는다 —
 *      가이드라인 프롬프트를 재사용하면 397건이 **전건 격리**된다.
 *   ② 판정이 실제로 **픽과 화면을 움직인다** — 종전 리뷰 픽은 배열 머리를 집었고,
 *      그 상태로 셀렉만 붙이면 격리한 것이 그대로 발행된다(써지지만 아무도 안 본다).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REVIEW_FIT_TOOL, buildReviewFitPrompt, toReviewFitInput, reviewPriorityOf,
} from '../src/utils/reviewFit.js';
import {
  reviewRank, sortByReviewRank, publishableReviews, rankedPublishableReviews,
} from '../src/utils/reviewRank.js';
import { FIT_TOOL, FIT_SCHEMA_VERSION, unscoredItems, applyFitVerdicts } from '../src/utils/guidelineFit.js';
import { GuidelineFitAgent } from '../src/agents/GuidelineFitAgent.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

const fit = (score, keep) => ({ version: FIT_SCHEMA_VERSION, score, keep, reason: 'r', at: 'now' });
const rev = (pmid, extra = {}) => ({
  pmid, title: `리뷰 ${pmid}`, journal: 'BMJ', score: 8, topic: 'resp_airway', ...extra,
});

// ── ① 프롬프트 계약 — 여기가 무너지면 397건이 조용히 다 내려간다 ────────────────

test('★ 리뷰 프롬프트는 "지침이 아님" 을 감점 사유로 쓰지 않는다', () => {
  const p = buildReviewFitPrompt([toReviewFitInput(rev('1'), 0)]);
  // 가이드라인 프롬프트의 그 문구가 그대로 흘러들어오면 안 된다.
  assert.ok(!p.includes('지침이 아니라 지침을 연구한 논문'),
    '가이드라인 프롬프트의 감점 문구가 리뷰 프롬프트에 들어 있다');
  // 반대로 **명시적 면제**가 있어야 한다 — 없으면 모델이 알아서 깎는다.
  assert.match(p, /"지침이 아니다" 는 감점 사유가 \*\*아니다\./);
  assert.match(p, /학회 지침이 아니라는 이유로 점수를 깎지 마라/);
});

test('리뷰 프롬프트는 복습 용도와 전건 판정을 못 박는다', () => {
  const p = buildReviewFitPrompt([toReviewFitInput(rev('1'), 0)]);
  assert.match(p, /복습/);
  assert.match(p, /모든 index 에 대해 정확히 하나씩/);
  // 초록이 없는 큐이므로 "모르겠으면 낮은 점수" 를 막아야 한다.
  assert.match(p, /정보 부족과 부적합은 다르다/);
});

test('리뷰 도구는 가이드라인 도구와 다른 이름이다', () => {
  assert.equal(REVIEW_FIT_TOOL.name, 'review_fit');
  assert.notEqual(REVIEW_FIT_TOOL.name, FIT_TOOL.name);
  assert.deepEqual(REVIEW_FIT_TOOL.input_schema.properties.verdicts.items.required,
    ['index', 'fit', 'keep', 'reason']);
});

test('리뷰 입력 매퍼는 주제와 규칙 점수를 실어 보낸다 (초록이 없으니 그게 전부다)', () => {
  const input = toReviewFitInput(rev('7', { score: 8.9 }), 3);
  assert.equal(input.index, 3);
  assert.equal(input.topic, 'resp_airway');
  assert.equal(input.ruleScore, 8.9);
  assert.equal(input.journal, 'BMJ');
});

// ── ② 판정이 실제로 순서를 움직이나 ──────────────────────────────────────────

test('reviewRank: 격리된 것은 바닥으로, 미판정은 규칙 점수로 선다', () => {
  assert.ok(reviewRank(rev('a', { score: 9, llmFit: fit(10, false) })) < reviewRank(rev('b', { score: 0 })),
    'keep:false 가 무점수 항목보다 위에 있다');
  // 미판정은 0점 취급이 아니다 — 규칙 점수 그대로.
  assert.equal(reviewRank(rev('c', { score: 8.9 })), 8.9);
  // 적합도가 규칙 점수를 지배한다.
  assert.ok(reviewRank(rev('d', { score: 0, llmFit: fit(9, true) })) > reviewRank(rev('e', { score: 10 })));
});

test('★ status 가 없는 항목은 발행 가능으로 본다 (미판정 큐가 통째로 사라지면 안 된다)', () => {
  const queue = [rev('1'), rev('2'), rev('3')];
  assert.equal(publishableReviews(queue).length, 3);
  // 명시적 격리만 빠진다.
  const mixed = [rev('1'), rev('2', { status: 'needsReview' }), rev('3', { status: 'queued' })];
  assert.deepEqual(publishableReviews(mixed).map((x) => x.pmid), ['1', '3']);
});

test('sortByReviewRank 는 원본을 고치지 않는다', () => {
  const queue = [rev('low', { score: 1 }), rev('high', { score: 9 })];
  const sorted = sortByReviewRank(queue);
  assert.deepEqual(sorted.map((x) => x.pmid), ['high', 'low']);
  assert.deepEqual(queue.map((x) => x.pmid), ['low', 'high']);
});

test('unscoredItems: 리뷰는 score 로 줄을 세운다 (priorityOf 주입)', () => {
  const queue = [rev('낮음', { score: 2 }), rev('높음', { score: 9 })];
  const picked = unscoredItems(queue, { limit: 1, priorityOf: reviewPriorityOf });
  assert.deepEqual(picked.map((x) => x.pmid), ['높음']);
  // ★ 주입을 안 하면(=가이드라인 기본값) score 를 못 읽어 순서가 무의미해진다.
  //   그것이 이 인자가 있는 이유이므로 기본 동작도 못 박는다.
  const byPriority = unscoredItems(
    [{ id: 'a', priority: 1 }, { id: 'b', priority: 5 }], { limit: 1 },
  );
  assert.deepEqual(byPriority.map((x) => x.id), ['b']);
});

test('applyFitVerdicts 를 리뷰 항목에 걸면 status 가 새로 생긴다', () => {
  const queue = [rev('1'), rev('2')];
  const { items, scored } = applyFitVerdicts(queue, [
    { index: 0, fit: 9, keep: true, reason: '핵심 주제' },
    { index: 1, fit: 1, keep: false, reason: '기초과학' },
  ], { now: 'T' });
  assert.equal(scored, 2);
  assert.equal(items[0].status, 'queued');
  assert.equal(items[1].status, 'needsReview');
  // 격리는 rejected 가 아니다 — 되살릴 수 있어야 한다.
  assert.notEqual(items[1].status, 'rejected');
});

// ── ③ 픽이 배열 머리가 아니라 랭크를 본다 ────────────────────────────────────

const stateFile = (queue) => JSON.stringify({
  schemaVersion: 1, track: 'reviews', queue, published: [], rejected: [],
  lastRun: null, updatedAt: null,
});

async function setup(queue) {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-fit-'));
  const queueFile = path.join(dir, 'queue_reviews.json');
  await writeFile(queueFile, stateFile(queue));
  const o = new TrendReviewOrchestrator({
    queueReviewsPath: queueFile, controlStatePath: path.join(dir, 'control_state.json'),
  });
  return { o, queueFile };
}

test('★ 발행 픽이 큐 머리가 아니라 적합도 1위를 집는다', async () => {
  // 머리에 있는 것이 규칙 점수는 높지만 LLM 이 낮게 봤다.
  const { o, queueFile } = await setup([
    rev('머리', { title: 'Airway management of adults', score: 9, llmFit: fit(3, true) }),
    rev('적합', { title: 'Sepsis in adults', score: 1, llmFit: fit(10, true) }),
  ]);
  const result = await o._stageReview('2026-08-17');
  assert.equal(result.outcome, 'published');
  assert.equal(result.item.pmid, '적합');
  const saved = JSON.parse(await readFile(queueFile, 'utf8'));
  assert.deepEqual(saved.queue.map((x) => x.pmid), ['머리'], '발행분만 큐에서 빠져야 한다');
  assert.deepEqual(saved.published.map((x) => x.pmid), ['적합']);
});

test('★ 격리된 항목은 발행되지 않는다 (전부 격리면 empty)', async () => {
  const { o, queueFile } = await setup([
    rev('격리1', { title: 'Sepsis in adults', status: 'needsReview', llmFit: fit(2, false) }),
    rev('격리2', { title: 'Airway management of adults', status: 'needsReview', llmFit: fit(1, false) }),
  ]);
  const result = await o._stageReview('2026-08-17');
  assert.deepEqual(result, { outcome: 'empty', reason: 'all-quarantined' });
  const saved = JSON.parse(await readFile(queueFile, 'utf8'));
  assert.equal(saved.published.length, 0, '격리 항목이 발행됐다');
  assert.equal(saved.queue.length, 2, '격리 항목이 큐에서 사라졌다');
});

test('판정 없는 큐는 종전대로 규칙 점수 1위가 나간다 (회귀)', async () => {
  const { o } = await setup([
    rev('낮음', { title: 'Sepsis in adults', score: 2 }),
    rev('높음', { title: 'Airway management of adults', score: 9 }),
  ]);
  const result = await o._stageReview('2026-08-17');
  assert.equal(result.item.pmid, '높음');
});

// ── ④ 예고 리스트가 픽과 같은 것을 그리나 ────────────────────────────────────

test('★ 리뷰 예고가 발행 픽과 같은 순서를 그리고 격리분은 감춘다', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'review-upcoming-'));
  const out = path.join(dir, 'output');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'queue_reviews.json'), stateFile([
    rev('규칙높음', { title: '규칙점수 높은 것', score: 9, llmFit: fit(4, true) }),
    rev('엘엘엠', { title: 'LLM 이 고른 것', score: 1, llmFit: fit(10, true) }),
    rev('격리됨', { title: '격리된 것', score: 10, status: 'needsReview', llmFit: fit(1, false) }),
  ]));
  const publisher = new GitHubPublisher({ owner: 'o', repo: 'r', token: 't' });
  publisher._repoPath = dir;
  const html = await publisher._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-17');

  assert.ok(html.includes('LLM 이 고른 것'), '적합도 1위가 예고에 없다');
  assert.ok(!html.includes('격리된 것'), '격리된 항목이 예고에 떴다');
  assert.ok(html.indexOf('LLM 이 고른 것') < html.indexOf('규칙점수 높은 것'),
    '예고 순서가 발행 픽과 다르다');
});

// ── ⑤ 에이전트 주입 — 기본값(가이드라인)은 한 글자도 안 바뀐다 ────────────────

test('FitAgent 기본값은 가이드라인 도구·프롬프트다 (종전 호출부 무영향)', () => {
  const agent = new GuidelineFitAgent();
  assert.equal(agent.tool, FIT_TOOL);
  assert.equal(agent.label, 'guideline-fit');
  assert.ok(agent.buildPrompt([]).includes('진료지침 후보를 추린다'));
});

test('FitAgent 는 주입받은 리뷰 도구·프롬프트로 LLM 을 부른다', async () => {
  const seen = [];
  const agent = new GuidelineFitAgent({
    tool: REVIEW_FIT_TOOL,
    buildPrompt: buildReviewFitPrompt,
    toInput: toReviewFitInput,
    label: 'review-fit',
    llm: {
      callWithTool: async (messages, tool) => {
        seen.push({ prompt: messages[0].content, toolName: tool.name });
        return { verdicts: [{ index: 0, fit: 9, keep: true, reason: 'ok' }] };
      },
    },
    retry: { execute: (fn) => fn() },
    cb: { execute: (fn) => fn() },
  });
  const { items, scored } = await agent.score([rev('1')], { now: 'T' });
  assert.equal(scored, 1);
  assert.equal(items[0].llmFit.score, 9);
  assert.equal(seen[0].toolName, 'review_fit');
  assert.ok(seen[0].prompt.includes('복습'), '리뷰 프롬프트가 안 쓰였다');
  assert.ok(!seen[0].prompt.includes('진료지침 후보를 추린다'), '가이드라인 프롬프트가 쓰였다');
});
