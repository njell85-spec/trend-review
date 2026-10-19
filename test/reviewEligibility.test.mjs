import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rankedPublishableReviews } from '../src/utils/reviewRank.js';
import { isNarrativeReview } from '../src/utils/reviewQueue.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const narrative = {
  pmid: '41841954',
  title: 'The Effective Management of Shock: Moving From Physiology to Guidelines to Personalized Medicine.',
  status: 'queued', score: 3, llmFit: { score: 8, keep: true },
};
const guideline = {
  pmid: '41773929',
  title: 'Society of Critical Care Medicine Guidelines for the Administration of Neuromuscular Blockade in Adults With Acute Respiratory Distress Syndrome.',
  status: 'queued', score: 9, llmFit: { score: 10, keep: true },
};

async function setup(queue) {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-eligibility-'));
  const queueFile = path.join(dir, 'queue_reviews.json');
  const state = { schemaVersion: 1, track: 'reviews', queue, published: [],
    rejected: [{ pmid: 'historical-rejection' }], lastRun: null, updatedAt: null };
  await writeFile(queueFile, JSON.stringify(state));
  const o = new TrendReviewOrchestrator({ queueReviewsPath: queueFile,
    controlStatePath: path.join(dir, 'control_state.json') });
  const analyzed = [];
  o._analyzeReview = async (item) => { analyzed.push(item.pmid); return { coverage: 'abstract-only' }; };
  return { o, dir, queueFile, state, analyzed };
}

test('ranked guideline behind a narrative head is held, preview agrees, rollback restores history', async () => {
  const { o, dir, queueFile, state, analyzed } = await setup([narrative, guideline]);
  const output = path.join(dir, 'output');
  await mkdir(output);
  await writeFile(path.join(output, 'queue_reviews.json'), JSON.stringify(state));
  const publisher = new GitHubPublisher({ owner: 'o', repo: 'r', token: 'test' });
  publisher._repoPath = dir;
  const html = await publisher._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-10-19');
  assert.ok(html.includes(narrative.title));
  assert.ok(!html.includes(guideline.title));
  const result = await o._stageReview('2026-10-19');
  assert.equal(result.item.pmid, narrative.pmid);
  assert.deepEqual(analyzed, [narrative.pmid]);
  const saved = JSON.parse(await readFile(queueFile, 'utf8'));
  assert.deepEqual(saved.queue, [guideline]);
  assert.deepEqual(saved.rejected, state.rejected);
  await result.rollback();
  assert.deepEqual(JSON.parse(await readFile(queueFile, 'utf8')), state);
});

test('all held candidates leave state unchanged and never invoke analysis', async () => {
  const { o, queueFile, state, analyzed } = await setup([guideline]);
  assert.equal((await o._stageReview('2026-10-19')).outcome, 'empty');
  assert.deepEqual(analyzed, []);
  assert.deepEqual(JSON.parse(await readFile(queueFile, 'utf8')), state);
});

test('explicit promotion and manual approval bypass document-type filtering', async () => {
  for (const approval of [{ promotedAt: '2026-10-19' }, { manualApproved: true }]) {
    const approved = { ...guideline, ...approval, llmFit: { score: 2, keep: false } };
    const { o } = await setup([narrative, approved]);
    assert.equal(rankedPublishableReviews([narrative, approved])[0].pmid, approved.pmid);
    assert.equal((await o._stageReview('2026-10-19')).item.pmid, approved.pmid);
  }
});

test('guideline title grammar retains real guideline families while allowing guidelines as a topic', () => {
  for (const title of [guideline.title,
    'Use of dexmedetomidine for sedation in mechanically ventilated adult ICU patients: a rapid practice guideline.',
    'European Resuscitation Council and European Society of Intensive Care Medicine guidelines 2025: post-resuscitation care.',
    'Platelet Transfusion: 2025 AABB and ICTMG International Clinical Practice Guidelines.',
    'Executive Summary-Society of Critical Care Medicine Guideline and American Society of Health-System Pharmacists for the Prevention of Stress-Related Gastrointestinal Bleeding in Critically Ill Adults.',
    'A Focused Update to the Clinical Practice Guidelines for the Prevention and Management of Pain, Anxiety, Agitation/Sedation, Delirium, Immobility, and Sleep Disruption in Adult Patients in the ICU.',
  ]) assert.equal(isNarrativeReview({ title }), false, title);
  assert.equal(isNarrativeReview(narrative), true);
});
