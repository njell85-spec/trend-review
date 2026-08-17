import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  unscoredItems, toFitInput, fitBatches, applyFitVerdicts, buildFitPrompt, FIT_SCHEMA_VERSION,
} from '../src/utils/guidelineFit.js';
import { guidelineRank, sortByGuidelineRank } from '../src/utils/guidelineRank.js';
import { GuidelineFitAgent } from '../src/agents/GuidelineFitAgent.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

// LLM 셀렉 — PeterJ 지시 2026-08-17 ("셀렉은 LLM 통해서 나한테 맞는거 리스트를 정하고").
// 이 파일 어디에서도 **실제 모델을 부르지 않는다.** 전부 주입한 스텁이다.

const item = (id, over = {}) => ({ id: `pmid:${id}`, pmid: id, title: `Doc ${id}`, status: 'queued', priority: 5, ...over });

// ── 판정 붙이기 ──────────────────────────────────────────────────────────────
test('판정이 붙으면 keep 은 queued, 아니면 needsReview 로 격리된다', () => {
  const items = [item('1'), item('2')];
  const { items: out, scored } = applyFitVerdicts(items, [
    { index: 0, fit: 9, keep: true, reason: '핵심 소생 지침' },
    { index: 1, fit: 2, keep: false, reason: '수의학' },
  ], { now: 'T' });
  assert.equal(scored, 2);
  assert.equal(out[0].status, 'queued');
  assert.equal(out[0].llmFit.score, 9);
  assert.equal(out[1].status, 'needsReview');
  assert.equal(out[1].llmFit.keep, false);
});

test('★ 안 맞는다고 rejected 로 내리지 않는다 — 되살릴 수 있어야 한다', () => {
  const { items: out } = applyFitVerdicts([item('1')], [{ index: 0, fit: 0, keep: false, reason: 'x' }]);
  assert.notEqual(out[0].status, 'rejected',
    'rejected 는 mergeCandidates 가 영구 배제로 다룬다 — 한 번 잘못 자르면 다시는 안 들어온다');
  assert.equal(out[0].status, 'needsReview');
});

test('★ 빠뜨린 판정은 0점이 아니라 무판정이다', () => {
  const items = [item('1'), item('2')];
  const { items: out, scored } = applyFitVerdicts(items, [{ index: 0, fit: 8, keep: true, reason: 'ok' }]);
  assert.equal(scored, 1);
  assert.equal(out[1].llmFit, undefined, 'LLM 이 한 건 빠뜨린 날 그 지침이 조용히 격리되면 안 된다');
  assert.equal(out[1].status, 'queued');
});

test('★ 점수가 숫자가 아니면 손대지 않는다', () => {
  const { items: out, scored } = applyFitVerdicts([item('1')], [{ index: 0, fit: 'high', keep: true, reason: 'x' }]);
  assert.equal(scored, 0);
  assert.equal(out[0].llmFit, undefined);
});

test('임계값 미만이면 keep:true 여도 안 올린다 · 점수는 0~10 으로 잘린다', () => {
  const { items: out } = applyFitVerdicts([item('1'), item('2')], [
    { index: 0, fit: 4, keep: true, reason: 'x' },
    { index: 1, fit: 99, keep: true, reason: 'y' },
  ], { threshold: 6 });
  assert.equal(out[0].status, 'needsReview');
  assert.equal(out[1].llmFit.score, 10);
});

// ── 판정 대상 고르기 ─────────────────────────────────────────────────────────
test('★ PeterJ 수동 승인은 판정에서 뺀다 (확정 ⑤-A)', () => {
  const targets = unscoredItems([item('1'), item('2', { manualApproved: true })]);
  assert.deepEqual(targets.map((x) => x.pmid), ['1'],
    '사람이 이미 고른 것을 기계가 다시 심사하면 그날 발행이 통째로 사라진다');
});

test('이미 판정받은 것은 다시 안 부른다 · 버전이 오르면 다시 받는다', () => {
  const scored = item('1', { llmFit: { version: FIT_SCHEMA_VERSION, score: 8, keep: true } });
  assert.equal(unscoredItems([scored]).length, 0);
  assert.equal(unscoredItems([scored], { version: FIT_SCHEMA_VERSION + 1 }).length, 1);
});

test('★ 예산이 모자라면 규칙 점수가 높은 것부터 판정받는다', () => {
  const targets = unscoredItems([item('1', { priority: 2 }), item('2', { priority: 9 }), item('3', { priority: 5 })], { limit: 2 });
  assert.deepEqual(targets.map((x) => x.pmid), ['2', '3'], '먼저 나갈 후보부터 판정이 붙어야 한다');
});

// ── 정렬 정본 ────────────────────────────────────────────────────────────────
test('★ 정렬은 LLM 적합도가 규칙 점수를 지배한다', () => {
  const high = item('1', { priority: 12, llmFit: { score: 3, keep: true } });
  const fit = item('2', { priority: 1, llmFit: { score: 9, keep: true } });
  assert.deepEqual(sortByGuidelineRank([high, fit]).map((x) => x.pmid), ['2', '1']);
});

test('★ keep:false 는 바닥으로 · 무판정은 규칙 점수만으로 선다 (0점 취급 아님)', () => {
  const dropped = item('1', { priority: 12, llmFit: { score: 9, keep: false } });
  const unrated = item('2', { priority: 4 });
  assert.deepEqual(sortByGuidelineRank([dropped, unrated]).map((x) => x.pmid), ['2', '1']);
  assert.equal(guidelineRank(unrated), 4);
});

// ── 배치·프롬프트 ────────────────────────────────────────────────────────────
test('배치는 크기대로 쪼개지고 index 는 전역이다', async () => {
  assert.deepEqual(fitBatches([1, 2, 3, 4, 5], 2).map((b) => b.length), [2, 2, 1]);
  assert.throws(() => fitBatches([1], 0), TypeError);
  const seen = [];
  const agent = new GuidelineFitAgent({
    batchSize: 2,
    llm: { callWithTool: async (messages) => {
      const idx = [...messages[0].content.matchAll(/"index":\s*(\d+)/g)].map((m) => Number(m[1]));
      seen.push(...idx);
      return { verdicts: idx.map((i) => ({ index: i, fit: 8, keep: true, reason: 'ok' })) };
    } },
  });
  const out = await agent.score([item('1'), item('2'), item('3')]);
  assert.deepEqual(seen, [0, 1, 2], '배치마다 0 부터 다시 세면 두 번째 배치 판정이 첫 배치에 붙는다');
  assert.equal(out.scored, 3);
  assert.equal(out.batches, 2);
});

test('프롬프트가 관심 영역과 후보를 싣는다', () => {
  const prompt = buildFitPrompt([toFitInput(item('1', { title: 'AHA CPR guideline', abstract: 'x'.repeat(900) }), 0)], { topicLabels: ['심혈관·소생'] });
  assert.ok(prompt.includes('심혈관·소생'));
  assert.ok(prompt.includes('AHA CPR guideline'));
  assert.ok(!prompt.includes('x'.repeat(600)), '초록은 잘라 보낸다');
});

// ── 실패는 소프트다 ──────────────────────────────────────────────────────────
test('★ 배치 하나가 죽어도 나머지는 판정되고, 죽은 묶음은 손대지 않는다', async () => {
  // ★ 호출 횟수로 실패를 흉내내면 안 된다 — `RetryHelper` 가 재시도해서 두 번째에
  //   성공해 버린다(실제로 그렇게 초록이 났다). **그 배치는 계속 죽는다** 를 흉내낸다.
  const agent = new GuidelineFitAgent({
    batchSize: 1,
    retry: { execute: (fn) => fn() },
    llm: { callWithTool: async (messages) => {
      if (/"index":\s*0\b/.test(messages[0].content)) throw new Error('LLM 429');
      return { verdicts: [{ index: 1, fit: 9, keep: true, reason: 'ok' }] };
    } },
  });
  const out = await agent.score([item('1'), item('2')]);
  assert.equal(out.failed, 1);
  assert.match(out.error, /429/);
  assert.equal(out.items[0].llmFit, undefined, '죽은 묶음은 규칙 점수로 남아야 한다');
  assert.equal(out.items[0].status, 'queued');
  assert.equal(out.items[1].llmFit.score, 9);
});

// ── 배선 회귀 — 모듈은 옳은데 아무도 안 부르는 함정 ───────────────────────────
async function stageWith(queue, fitStub) {
  const dir = await mkdtemp(path.join(tmpdir(), 'guideline-fit-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 2, queue, published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' }));
  const o = new TrendReviewOrchestrator();
  o.guidelineListPath = file;
  process.env.ENABLE_GUIDELINE_AUTOPUBLISH = 'true';
  process.env.ENABLE_GUIDELINE_LLM_FIT = 'true';
  o._guidelineInputs = async () => ({ candidates: [], manifest: { ptPmids: [] } });
  o.guideline = { analyze: async (paper) => ({ paper, org: 'X' }) };
  o.fullText = { run: async (papers) => ({ papers }) };
  o.guidelineFit = fitStub;
  await o._stageGuideline('2026-08-15');
  return JSON.parse(await readFile(file, 'utf8'));
}

test('★ 데일리가 LLM 셀렉을 실제로 부르고, 그 결과로 발행 대상이 갈린다', async () => {
  const calls = [];
  const fitStub = {
    score: async (items) => {
      calls.push(items.map((x) => x.pmid));
      // 규칙 점수는 1이 높지만 LLM 은 2를 고른다
      // ★ 둘 다 keep:true 로 둔다. 하나를 격리하면 `status==='queued'` 필터만으로
      //   답이 갈려서 **정렬을 priority 로 되돌려도 초록**이 된다(변이 주입으로 실측).
      //   순서 자체가 판정되게 하려면 둘 다 발행 대상이어야 한다.
      const applied = applyFitVerdicts(items, [
        { index: 0, fit: 6, keep: true, reason: '되긴 하는데 범위가 좁다' },
        { index: 1, fit: 9, keep: true, reason: '성인 소생 핵심' },
      ]);
      return { items: applied.items, scored: applied.scored, batches: 1, failed: 0, error: null };
    },
  };
  const state = await stageWith([item('1', { priority: 9 }), item('2', { priority: 1 })], fitStub);
  assert.deepEqual(calls, [['1', '2']], '셀렉이 아예 안 불렸다');
  assert.equal(state.lastRun.publishedId, 'pmid:2',
    '규칙 점수(9)가 높은 1이 아니라 LLM 적합도(9)가 높은 2가 먼저 나가야 한다');
  assert.equal(state.queue.find((x) => x.pmid === '1').status, 'queued', '1은 여전히 발행 대상이다 — 순서만 뒤다');
  assert.equal(state.lastRun.manifest.fit.scored, 2, '판정 증거가 manifest 에 안 남았다');
});

test('★ 셀렉이 통째로 죽어도 데일리는 규칙 점수로 발행한다 (코어 무영향)', async () => {
  const state = await stageWith([item('1', { priority: 9 }), item('2', { priority: 1 })], {
    score: async () => { throw new Error('claude CLI 없음'); },
  });
  assert.equal(state.lastRun.publishedId, 'pmid:1');
  assert.match(state.lastRun.manifest.fit.error, /claude CLI/);
});

test('★ 스위치를 끄면 셀렉을 안 부른다', async () => {
  let called = false;
  process.env.ENABLE_GUIDELINE_LLM_FIT = 'false';
  const dir = await mkdtemp(path.join(tmpdir(), 'guideline-fit-off-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 2, queue: [item('1')], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' }));
  const o = new TrendReviewOrchestrator();
  o.guidelineListPath = file;
  o._guidelineInputs = async () => ({ candidates: [], manifest: { ptPmids: [] } });
  o.guideline = { analyze: async (paper) => ({ paper, org: 'X' }) };
  o.fullText = { run: async (papers) => ({ papers }) };
  o.guidelineFit = { score: async () => { called = true; } };
  await o._stageGuideline('2026-08-15');
  assert.equal(called, false);
  process.env.ENABLE_GUIDELINE_LLM_FIT = 'true';
});

// ── 예고 리스트도 같은 정렬을 써야 한다 ─────────────────────────────────────
// ★ 화면과 게이트가 다른 순서를 보면 "내일 이것이 나갑니다" 가 거짓말이 된다
//   (2026-08-16 결함 B2 와 같은 부류). 두 곳이 같은 함수를 쓰는지 실물로 본다.
test('★ 예고 리스트가 발행 픽과 같은 순서를 그린다', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'guideline-upcoming-'));
  const out = path.join(dir, 'output');
  await mkdir(out, { recursive: true });
  const queue = [
    item('1', { priority: 12, title: '규칙점수 높은 것', llmFit: { version: FIT_SCHEMA_VERSION, score: 4, keep: true } }),
    item('2', { priority: 1, title: 'LLM 이 고른 것', llmFit: { version: FIT_SCHEMA_VERSION, score: 10, keep: true } }),
  ];
  await writeFile(path.join(out, 'selected_guidelines.json'), JSON.stringify({
    schemaVersion: 2, queue, published: [], rejected: [], sourceHealth: {},
    lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2',
  }));
  const publisher = new GitHubPublisher({ owner: 'o', repo: 'r', token: 't' });
  publisher._repoPath = dir;
  // 블록은 `<!-- ARCHIVE_START -->` 앞에 꽂힌다 — 그 앵커가 없으면 아무것도 안 들어간다.
  const html = await publisher._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-17');
  const first = html.indexOf('LLM 이 고른 것');
  const second = html.indexOf('규칙점수 높은 것');
  assert.ok(first > -1 && second > -1, '예고에 두 항목이 다 안 떴다');
  assert.ok(first < second, '예고가 발행 픽과 다른 순서를 그린다 — 화면이 거짓말을 한다');
});
