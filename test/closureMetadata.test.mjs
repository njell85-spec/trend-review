import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { correctClosureMetadata } from '../scripts/correct-closure-metadata.mjs';

const clinical = { summary: ['historical clinical prose'], sections: [{ text: 'unchanged translation' }],
  sources: [{ label: 'Original source', url: 'https://example.org/original' }] };
function fixture() {
  return {
    guidelines: { schemaVersion: 2, queue: [
      { id: 'pmid:39198198', pmid: '39198198', status: 'superseded', lineageReview: true,
        lineageReason: 'candidate-not-newer', supersededBy: 'pmid:39207913', supersededAt: 'old-time' },
      { id: 'other', pmid: 'other', status: 'queued' },
    ], published: ['39207913', '41773929', '41773928'].map(pmid => ({
      id: `pmid:${pmid}`, pmid, status: 'current', publishedAt: 'historical-date',
      supersedes: pmid === '39207913' ? ['pmid:39198198'] : [], card: structuredClone(clinical),
    })), rejected: [{ pmid: 'old-rejection' }], lastRun: { date: 'historical-run' }, updatedAt: 'historical-update' },
    reviews: { schemaVersion: 1, track: 'reviews', queue: [
      { pmid: '39982143', status: 'queued' }, { pmid: '38748265', status: 'needsReview', llmFit: { keep: false } },
    ], published: [{ pmid: '36322846', publishedAt: 'historical-date',
      card: { ...structuredClone(clinical), coverage: 'full-text', fullTextSource: 'abstract-only' } }],
    rejected: [{ pmid: 'rejected' }], lastRun: { date: 'historical-run' }, updatedAt: 'historical-update' },
  };
}

test('proven relationship and coverage corrections are idempotent and keep held documents held', () => {
  const original = fixture();
  const before = structuredClone(original);
  const corrected = correctClosureMetadata(original);
  assert.deepEqual(original, before, 'pure calculation must not mutate the input');
  const held = corrected.guidelines.queue[0];
  assert.equal(held.status, 'needsReview');
  assert.equal(held.lineageReview, true);
  assert.equal(held.lineageReason, 'co-publication-not-new-edition');
  assert.ok(!('supersededBy' in held) && !('supersededAt' in held));
  assert.deepEqual(corrected.guidelines.published[0].supersedes, []);
  assert.match(corrected.guidelines.published[0].card.sources.at(-1).label, /공동출판/);
  assert.equal(corrected.guidelines.published[1].card.sources.at(-1).url, 'https://pubmed.ncbi.nlm.nih.gov/41773928/');
  assert.equal(corrected.guidelines.published[2].card.sources.at(-1).url, 'https://pubmed.ncbi.nlm.nih.gov/41773929/');
  assert.equal(corrected.reviews.published[0].card.coverage, 'unverified');
  assert.equal(correctClosureMetadata(corrected).changes.length, 0);
});

test('no adoption/rejection changes, clinical content changes, identifier loss or publication-history changes', () => {
  const original = fixture();
  const next = correctClosureMetadata(original);
  for (const key of ['queue', 'rejected', 'lastRun', 'updatedAt']) assert.deepEqual(next.reviews[key], original.reviews[key]);
  for (const key of ['rejected', 'lastRun', 'updatedAt']) assert.deepEqual(next.guidelines[key], original.guidelines[key]);
  assert.deepEqual(next.guidelines.queue[1], original.guidelines.queue[1]);
  for (const track of ['guidelines', 'reviews']) {
    assert.deepEqual(next[track].published.map(x => [x.pmid, x.publishedAt, x.status]),
      original[track].published.map(x => [x.pmid, x.publishedAt, x.status]));
    for (let i = 0; i < next[track].published.length; i++) {
      const strip = card => { const { sources, coverage, ...rest } = card; return rest; };
      assert.deepEqual(strip(next[track].published[i].card), strip(original[track].published[i].card));
    }
  }
});

test('new evidence, changed successor, missing or duplicate identities stop correction', () => {
  for (const mutate of [
    x => { x.reviews.published[0].card.fullTextSource = 'pmc'; },
    x => { x.reviews.published[0].card.coverageEvidence = { generatedAt: 'new-evidence' }; },
    x => { x.guidelines.queue[0].supersededBy = 'pmid:another-edition'; },
    x => { x.guidelines.queue[0].status = 'queued'; },
    x => { x.guidelines.published.pop(); },
    x => { x.guidelines.published.push(structuredClone(x.guidelines.published[0])); },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => correctClosureMetadata(input));
  }
});

test('retained real ledgers preserve population and clinical fields under the bounded correction', () => {
  const input = {
    guidelines: JSON.parse(fs.readFileSync(new URL('../output/selected_guidelines.json', import.meta.url))),
    reviews: JSON.parse(fs.readFileSync(new URL('../output/queue_reviews.json', import.meta.url))),
  };
  const next = correctClosureMetadata(input);
  for (const track of ['guidelines', 'reviews']) for (const bucket of ['queue', 'published', 'rejected']) {
    assert.equal(next[track][bucket].length, input[track][bucket].length);
    for (let i = 0; i < input[track][bucket].length; i++) {
      const old = input[track][bucket][i]; const updated = next[track][bucket][i];
      assert.equal(updated.pmid, old.pmid);
      if (!['39198198', '39207913', '41773929', '41773928', '36322846'].includes(old.pmid)) assert.deepEqual(updated, old);
      if (old.card) for (const [key, value] of Object.entries(old.card)) {
        if (!['sources', 'coverage'].includes(key)) assert.deepEqual(updated.card[key], value);
      }
      assert.equal(updated.publishedAt, old.publishedAt);
    }
  }
});
