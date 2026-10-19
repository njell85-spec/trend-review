import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyFitVerdicts } from '../src/utils/guidelineFit.js';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { emptyQueue, loadTrackQueue } from '../src/utils/trackQueue.js';

test('invalid fit evidence leaves review/guideline states and prior verdicts untouched', () => {
  for (const fit of [null, undefined, '', '  ', false, true, [], [9], {}, NaN, Infinity]) {
    for (const status of ['queued', 'needsReview', 'rejected']) {
      const item = { pmid: 'synthetic', status, manualApproved: status === 'queued',
        llmFit: { score: 7, keep: true, version: 0 } };
      const out = applyFitVerdicts([item], [{ index: 0, fit, keep: false }]);
      assert.equal(out.scored, 0, `invalid value ${String(fit)}`);
      assert.equal(out.items[0], item);
    }
  }
  for (const fit of [0, '0', 9, ' 9 ']) {
    const out = applyFitVerdicts([{ status: 'queued' }], [{ index: 0, fit, keep: true }]);
    assert.equal(out.scored, 1);
    assert.equal(out.items[0].status, Number(fit) >= 6 ? 'queued' : 'needsReview');
  }
});

test('title-only design scoring distinguishes negated randomization, preserving authoritative types', () => {
  const scorer = new MetadataScorer({ now: '2026-10-19' });
  const paper = title => ({ title, journal: 'Critical Care Medicine', publicationTypes: ['Journal Article'] });
  for (const title of ['Nonrandomized', 'Non-randomized', 'Non randomized', 'Non–randomised', 'Not randomized']) {
    const result = scorer.scoreOne(paper(`${title} comparison in septic shock`));
    assert.equal(result.studyType, 'Other', title);
    assert.ok(result.rawScore < scorer.scoreOne(paper('Randomized comparison in septic shock')).rawScore);
  }
  assert.equal(scorer.scoreOne(paper('Randomised comparison in septic shock')).studyType, 'RCT');
  assert.equal(scorer.scoreOne({ ...paper('Nonrandomized comparison in septic shock'),
    publicationTypes: ['Randomized Controlled Trial'] }).studyType, 'RCT');
  assert.equal(scorer.scoreOne(paper('Meta-analysis of nonrandomized studies in septic shock')).studyType, 'Meta-analysis');
});

async function setup(queue = [], history = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-quality-'));
  const file = path.join(dir, 'queue.json');
  await writeFile(file, JSON.stringify({ ...emptyQueue('papers'), queue,
    published: [{ pmid: 'published' }], rejected: [{ pmid: 'rejected' }] }));
  await writeFile(path.join(dir, 'selected_papers.json'), JSON.stringify(history));
  const o = new TrendReviewOrchestrator({ outputDir: dir, queuePapersPath: file });
  o.filter.scorer.scorePapers = papers => papers.map(p => ({ pmid: p.pmid,
    score: p.points, rawScore: p.points, primaryTopic: p.topic }));
  o.filter.scorer.isExcludedJournal = p => p.excluded === true;
  o.filter.topN = 1;
  o.filter.topicCooldownCfg = { days: 5, penalty: -2 };
  o.filter._rerankSelect = async () => { throw new Error('No model calls in deterministic refill'); };
  o._stageAnalyze = async () => { throw new Error('No clinical analysis during refill'); };
  return { o, file, dir };
}
const candidate = (pmid, points, topic = 'other') => ({ pmid, title: pmid, journal: 'Synthetic', points, topic });

test('actual refill applies saved topic history, preserves manual order/metadata, and fills only capacity', async () => {
  const survivors = [{ pmid: 'manual', score: 1, note: { human: 'first' }, addedAt: '2026-10-01' },
    { pmid: 'old', score: 10, custom: ['preserve'] }];
  const { o, file, dir } = await setup([...survivors, { pmid: 'published', score: 11 }],
    [{ topic: 'recent', date: '2026-10-18' }]);
  const historyBefore = await readFile(path.join(dir, 'selected_papers.json'), 'utf8');
  const pool = [candidate('recent', 8, 'recent'), candidate('different', 7),
    candidate('manual', 99), candidate('published', 99), candidate('rejected', 99), candidate('ledger', 99),
    ...Array.from({ length: 16 }, (_, i) => candidate(`new-${i}`, 4 - i / 100))];
  o._stageCollect = async () => ({ papers: pool, stats: {} });
  o._stageValidate1 = async papers => ({ papers });
  o._buildSelectionPool = (papers, stats, excluded) => {
    for (const id of ['manual', 'old', 'published', 'rejected', 'ledger']) assert.ok(excluded.includes(id));
    return papers; // Keep contaminated input to verify the final gate independently.
  };
  assert.deepEqual(o.filter._selectTopPapers(pool.slice(0, 2), o.filter.scorer.scorePapers(pool.slice(0, 2)),
    { limit: 2 }).map(p => p.pmid), ['recent', 'different']);
  const result = await o._refillPaperQueue('2026-10-19', ['ledger']);
  assert.equal(result.count, 14);
  const state = await loadTrackQueue(file, 'papers');
  assert.deepEqual(state.queue.slice(0, 2), survivors);
  assert.deepEqual(state.queue.slice(2, 4).map(p => p.pmid), ['different', 'recent']);
  assert.equal(state.queue[3].selectionEvidence.cooldownPenalty, -2);
  assert.equal(state.queue[3].selectionEvidence.rawScore, 6);
  assert.ok(state.queue.slice(2).every(p => p.lowConfidence === true && p.selectionEvidence.llmCalled === false));
  assert.equal(new Set(state.queue.map(p => p.pmid)).size, 14);
  assert.ok(!state.queue.some(p => ['published', 'rejected', 'ledger'].includes(p.pmid)));
  await o._saveTrack1Queue(pool, '2026-10-19', ['ledger']);
  assert.deepEqual((await loadTrackQueue(file, 'papers')).queue, state.queue, 'repeat cannot reorder or expand a full queue');
  assert.equal(await readFile(path.join(dir, 'selected_papers.json'), 'utf8'), historyBefore);
});

test('an oversized existing queue is preserved without scoring new candidates', async () => {
  const queue = Array.from({ length: 15 }, (_, i) => ({ pmid: `kept-${i}`, score: i, note: 'human' }));
  const { o, file } = await setup(queue);
  o.filter.scorer.scorePapers = () => { throw new Error('No capacity'); };
  await o._saveTrack1Queue([candidate('new', 99)], '2026-10-19');
  assert.deepEqual((await loadTrackQueue(file, 'papers')).queue, queue);
});

test('refill keeps the existing topN journal fallback and cooldown-disabled policy', async () => {
  const { o, file } = await setup();
  const banned = { ...candidate('excluded', 9), excluded: true };
  await o._saveTrack1Queue([banned, candidate('allowed', 7)], '2026-10-19');
  assert.deepEqual((await loadTrackQueue(file, 'papers')).queue.map(p => p.pmid), ['allowed']);
  const second = await setup([], [{ topic: 'recent', date: '2026-10-18' }]);
  second.o.filter.topicCooldownCfg = { days: 0, penalty: -2 };
  await second.o._saveTrack1Queue([{ ...banned, topic: 'recent' }], '2026-10-19');
  const queued = (await loadTrackQueue(second.file, 'papers')).queue;
  assert.equal(queued[0].pmid, 'excluded', 'fallback remains when fewer than topN allowed candidates');
  assert.equal(queued[0].selectionEvidence.cooldownPenalty, 0);
});
