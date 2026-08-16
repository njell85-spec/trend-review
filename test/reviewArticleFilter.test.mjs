import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isNarrativeReview, notReviewReason, buildReviewQueue } from '../src/utils/reviewQueue.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

/**
 * ★ PeterJ 지적 2026-08-17 — 트랙3 첫 발행분이
 *   "A consensus of international experts on ... obtained by the Delphi method:
 *    the SAVECMO study" 였다. **리뷰 아티클이 아니다.**
 *   PubMed 의 `Review[Publication Type]` 은 합의문·Delphi·지침까지 포함하는데
 *   종전 쿼리는 SR·메타만 뺐다. 트랙3은 복습용 종설이고 지침은 트랙2의 몫이라,
 *   섞이면 같은 것을 두 트랙이 다룬다.
 */

// 저수지에서 실제로 뽑은 제목들 — 판정이 흔들리면 여기서 잡힌다.
const NOT_REVIEWS = [
  'A consensus of international experts on definition, sampling, treatment, and prevention of peripheral extracorporeal membrane oxygenation cannula-site infection obtained by the Delphi method: the SAVECMO study.',
  'Society of Critical Care Medicine Clinical Practice Guidelines for Rapid Sequence Intubation in the Critically Ill Adult Patient.',
  'Platelet Transfusion: 2025 AABB and ICTMG International Clinical Practice Guidelines.',
  'Consensus on identifying and ranking ventilator asynchronies in invasively ventilated ICU patients: a modified Delphi study (SYNAPsE).',
  'Pharmacological Research Agenda on Adult Extracorporeal Membrane Oxygenation Using the Delphi Method: A Position Paper of the ECMO Pharmacology Network.',
  'European Resuscitation Council and European Society of Intensive Care Medicine guidelines 2025: post-resuscitation care.',
];

const REAL_REVIEWS = [
  '60 years of ARDS and the evolution of extracorporeal lung support - from ECMO to ECCO(2)R.',
  'Prehospital airway and ventilatory management: a collaborative and narrative review.',
  'PEEP and alveolar recruitment after 60 years of acute respiratory distress syndrome.',
  // ★ 오탐 방어 — 'standard of care' 는 문서 성격이 아니라 주제를 가리키는 말이다.
  'Current standard of care for septic shock.',
  'Traumatic brain injury management in the intensive care unit: standard of care and knowledge gaps.',
  'Syncope.',
];

test('★ 합의문·지침류는 리뷰가 아니다', () => {
  for (const title of NOT_REVIEWS) {
    assert.equal(isNarrativeReview({ title }), false, `걸러지지 않았다: ${title.slice(0, 60)}`);
    assert.ok(notReviewReason({ title }), '이유가 없다 — 장부에 남길 근거가 사라진다');
  }
});

test('★ 진짜 종설은 통과한다 (과잉 차단이면 저수지가 마른다)', () => {
  for (const title of REAL_REVIEWS) {
    assert.equal(isNarrativeReview({ title }), true, `과잉 차단: ${title.slice(0, 60)}`);
    assert.equal(notReviewReason({ title }), null);
  }
});

test('제목이 없으면 리뷰로 보지 않는다', () => {
  assert.equal(isNarrativeReview({}), false);
  assert.equal(isNarrativeReview({ title: '  ' }), false);
});

test('★ 저수지를 만들 때 걸러진다', () => {
  const papers = [...NOT_REVIEWS, ...REAL_REVIEWS].map((title, i) => ({ pmid: `p${i}`, title, date: '2026' }));
  // scorer 계약은 `{ scorePapers }` 다 — 기존 테스트(test/reviewQueue.test.mjs)와 같은 모양.
  const scorer = { scorePapers: (list) => list.map((paper) => ({ paper, score: 5 })) };
  const out = buildReviewQueue({ papers, scorer, limit: 100, today: '2026-08-17' });
  const titles = out.queue.map((x) => x.title);
  assert.ok(titles.length > 0, '저수지가 통째로 비었다 — 이 검사는 헛돈다');
  for (const t of NOT_REVIEWS) assert.equal(titles.includes(t), false, `저수지에 들어갔다: ${t.slice(0, 50)}`);
});

// ── 발행 직전 정화 (이미 쌓인 저수지용) ─────────────────────────────────────
async function setup(queue) {
  // ★ `output/` 이 경로에 들어가면 `assertNotProductionInTest` 가 막는다 —
  //   테스트가 프로덕션 큐를 오염시킨 사고가 있어서 심어둔 가드다. 임시 폴더 바로 밑에 쓴다.
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-rev-'));
  const qf = path.join(dir, 'queue_reviews.json');
  await writeFile(qf, JSON.stringify({
    schemaVersion: 1, track: 'reviews', queue, published: [], rejected: [], lastRun: null, updatedAt: '2026-08-16',
  }));
  const cf = path.join(dir, 'control_state.json');
  await writeFile(cf, JSON.stringify({ tracks: {} }));
  return { o: new TrendReviewOrchestrator({ queueReviewsPath: qf, controlStatePath: cf }), qf };
}

test('★ 저수지 머리에 합의문이 있으면 건너뛰고 진짜 종설을 발행한다', async () => {
  const { o, qf } = await setup([
    { pmid: 'bad1', title: NOT_REVIEWS[0] },
    { pmid: 'bad2', title: NOT_REVIEWS[1] },
    { pmid: 'good', title: REAL_REVIEWS[0] },
  ]);
  const r = await o._stageReview('2026-08-17');
  assert.equal(r.outcome, 'published');
  assert.equal(r.item.pmid, 'good', '합의문이 그대로 발행됐다');

  const saved = JSON.parse(await readFile(qf, 'utf8'));
  assert.deepEqual(saved.rejected.map((x) => x.pmid), ['bad1', 'bad2'], '뺀 것이 rejected 에 안 남았다');
  assert.ok(saved.rejected[0].rejectedReason, '뺀 이유가 안 남았다');
  assert.deepEqual(saved.published.map((x) => x.pmid), ['good']);
});

test('★ 저수지가 전부 합의문이면 발행하지 않는다 (억지로 내보내지 않는다)', async () => {
  const { o, qf } = await setup(NOT_REVIEWS.map((title, i) => ({ pmid: `b${i}`, title })));
  const r = await o._stageReview('2026-08-17');
  assert.equal(r.outcome, 'empty');
  const saved = JSON.parse(await readFile(qf, 'utf8'));
  assert.equal(saved.queue.length, 0);
  assert.equal(saved.published.length, 0, '리뷰가 아닌 것을 발행했다');
});


/**
 * ★ 배선 회귀 — 분석기를 부르는 경로가 실제로 도는가.
 *   "모듈은 옳은데 아무도 안 부른다" 가 이 저장소의 고질병이라, 큐 전이만 보지 않고
 *   **분석 결과가 발행 항목에 실리는지**까지 본다.
 */
test('★ 발행되는 리뷰에 번역 카드가 실린다', async () => {
  const { o, qf } = await setup([{ pmid: '12345', title: REAL_REVIEWS[0] }]);
  o.collector = { fetchArticles: async () => [{ pmid: '12345', title: REAL_REVIEWS[0], journal: 'Intensive Care Med' }] };
  o.fullText = { run: async (papers) => ({ papers }) };
  let mode = null;
  o.guideline = { analyze: async (doc, opts) => { mode = opts?.mode; return { type: 'reference', title_ko: '번역된 제목', paper: doc }; } };

  const r = await o._stageReview('2026-08-17');
  assert.equal(r.outcome, 'published');
  assert.equal(mode, 'reference', "분석기를 'reference' 모드로 안 불렀다 — 종설에 권고 틀을 씌운다");
  assert.equal(r.item.card?.title_ko, '번역된 제목', '카드가 발행 항목에 안 실렸다');

  const saved = JSON.parse(await readFile(qf, 'utf8'));
  assert.equal(saved.published[0].card?.title_ko, '번역된 제목', '카드가 상태에 안 남았다');
});

test('★ 분석이 실패해도 발행은 계속된다 (데일리를 막지 않는다)', async () => {
  const { o } = await setup([{ pmid: '12345', title: REAL_REVIEWS[0] }]);
  o.collector = { fetchArticles: async () => { throw new Error('pubmed down'); } };
  const r = await o._stageReview('2026-08-17');
  assert.equal(r.outcome, 'published', '분석 실패가 발행을 막았다');
  assert.equal(r.item.card, null);
});

test('★ 원문을 못 구해도 초록으로 카드를 만든다', async () => {
  const { o } = await setup([{ pmid: '12345', title: REAL_REVIEWS[0] }]);
  o.collector = { fetchArticles: async () => [{ pmid: '12345', title: REAL_REVIEWS[0], abstract: '초록만 있다' }] };
  o.fullText = { run: async () => { throw new Error('paywall'); } };
  let seen = null;
  o.guideline = { analyze: async (doc) => { seen = doc; return { type: 'reference', title_ko: 'ok', paper: doc }; } };
  const r = await o._stageReview('2026-08-17');
  assert.equal(r.item.card?.title_ko, 'ok', '원문 실패가 카드를 통째로 날렸다');
  assert.equal(seen.abstract, '초록만 있다', '초록이 분석기에 안 갔다');
});
