import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUpcoming, nextRunDates } from '../src/utils/upcomingSchedule.js';
import { trackRunsOn } from '../src/utils/trackCadence.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const from = '2026-10-19';
const success = (date = from) => ({ lastRun: { date, outcome: 'published', publishedId: 'done' } });
const queue = Array.from({ length: 10 }, (_, i) => ({ pmid: `next${i}`, title: `Next review ${i}` }));
const dates = (state, extra = {}) => nextRunDates({ from, days: 7, track: 'reviews', state, ...extra });

test('successful daily run consumes today without extending the requested window', () => {
  assert.deepEqual(dates(success()), ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.deepEqual(dates(success(), { days: 1 }), []);
  assert.deepEqual(dates(success(), { from: '2026-10-20', days: 2 }), ['2026-10-20', '2026-10-21']);
  assert.equal(dates(success('2026-10-18'))[0], from);
  assert.deepEqual(dates(success(), { days: 0 }), []);
  const state = { ...success(), queue };
  const before = structuredClone(state);
  const rows = buildUpcoming({ from, days: 7, tracks: [{ key: 'reviews', state }] });
  assert.equal(rows[0].date, '2026-10-20');
  assert.equal(rows[0].item.pmid, 'next0');
  assert.equal(rows.length, 6);
  assert.deepEqual(state, before, 'rendering must not change queue/history');
});

test('guideline success resolves only its publishedId, not updatedAt or a newer manual row', () => {
  const state = { lastRun: { outcome: 'published', publishedId: 'pmid:done' },
    published: [{ id: 'pmid:done', publishedAt: from }, { id: 'manual', publishedAt: '2026-10-22' }],
    updatedAt: '2026-10-23T10:00:00Z' };
  assert.equal(dates(state, { track: 'guidelines' })[0], '2026-10-20');
  assert.equal(dates({ ...state, lastRun: { ...state.lastRun, publishedId: 'missing' } }, { track: 'guidelines' })[0], from);
  assert.equal(dates({ ...state, lastRun: { outcome: 'published' } }, { track: 'guidelines' })[0], from);
});

test('failures, observation, manual-only history, invalid dates and promotions do not consume today', () => {
  for (const state of [null, {}, { updatedAt: from },
    { published: [{ publishedAt: from, manualApproved: true }] },
    { queue: [{ ...queue[0], promotedAt: from }] },
    ...['failed', 'empty', 'observe-only', 'nonfatal-failure'].map(outcome => ({
      lastRun: { date: from, outcome, publishedId: 'done' }, published: [{ pmid: 'done', publishedAt: from }],
    })),
    success('2026-02-31'), success('garbage'),
  ]) assert.equal(dates(state)[0], from, JSON.stringify(state));
  // On-demand adds a row but does not advance the prior successful daily marker.
  assert.equal(dates({ ...success('2026-10-18'), published: [{ pmid: 'manual', publishedAt: from }] })[0], from);
  assert.equal(dates({ ...success(), published: [{ pmid: 'manual', publishedAt: from }] })[0], '2026-10-20');
});

test('consumed dates still obey alternate, sequential and off gates', () => {
  for (const track of ['papers', 'guidelines', 'reviews']) {
    for (const mode of ['on', 'alternate', 'off']) {
      for (const sequential of [false, true]) {
        const out = dates(success(), { track, mode, sequential });
        assert.ok(!out.includes(from));
        assert.ok(out.every(d => d <= '2026-10-25' && trackRunsOn(track, d, { mode, sequential })));
        if (mode === 'off') assert.deepEqual(out, []);
      }
    }
  }
  // 10/20 has even calendar parity, but a review published on 10/19 must also
  // satisfy the runtime's two-day gap after switching to alternate mode.
  assert.deepEqual(dates(success(), { mode: 'alternate' }), ['2026-10-22', '2026-10-24']);
});

test('weekly compatibility remains one eligible slot inside the original window', () => {
  assert.deepEqual(dates(null, { cadence: 'weekly' }), [from]);
  assert.deepEqual(dates(success(), { cadence: 'weekly' }), []);
  assert.deepEqual(dates(success(), { cadence: 'weekly', days: 8 }), ['2026-10-26']);
  assert.deepEqual(dates(null, { cadence: 'weekly', mode: 'off' }), []);
});

test('disk renderer advances each track from its recorded daily success and is idempotent', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'upcoming-dates-'));
  try {
    await mkdir(path.join(dir, 'output'));
    const write = (file, value) => writeFile(path.join(dir, 'output', file), JSON.stringify(value));
    await write('queue_papers.json', { ...success(), queue });
    await write('queue_reviews.json', { ...success(), queue });
    await write('selected_guidelines.json', { lastRun: { outcome: 'published', publishedId: 'done' },
      queue: queue.map(x => ({ ...x, status: 'queued' })), published: [{ id: 'done', publishedAt: from }] });
    const p = new GitHubPublisher({ owner: 'o', repo: 'r', repoPath: dir });
    const html = '<!-- ARCHIVE_START --><article>Preserved body</article>';
    const once = await p._renderUpcomingFromDisk(html, from);
    const twice = await p._renderUpcomingFromDisk(once, from);
    for (const track of ['papers', 'guidelines', 'reviews']) {
      const pattern = new RegExp(`<!-- UPCOMING:${track} -->[\\s\\S]*?<!-- /UPCOMING:${track} -->`, 'g');
      const [block] = once.match(pattern) ?? [];
      assert.ok(block, track);
      assert.ok(!block.includes(from), `${track} repeated the consumed day`);
      assert.ok(block.includes('2026-10-20'), `${track} omitted the next day`);
      assert.ok(!block.includes('2026-10-26'), `${track} extended the window`);
      assert.deepEqual(twice.match(pattern), [block], `${track} changed or duplicated on rerender`);
    }
    assert.ok(once.endsWith(html));
    assert.ok(twice.endsWith(html));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('10/19 production-shaped review success places remaining head 42059919 on 10/20', () => {
  const state = { lastRun: { date: from, outcome: 'published', publishedId: '41841954' },
    published: [{ pmid: '41841954', publishedAt: from }],
    queue: [{ pmid: '42059919', title: 'Remaining review' }] };
  const rows = buildUpcoming({ from, days: 7, tracks: [{ key: 'reviews', state }] });
  assert.equal(rows[0].item.pmid, '42059919');
  assert.equal(rows[0].date, '2026-10-20');
});
