import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuidelineTitle, lineageKeyOf, resolveSupersede } from '../src/utils/guidelineLineage.js';

const orgs = { organizations: [{ id: 'alpha', name: 'Alpha Society', aliases: ['AS'] }, { id: 'beta', name: 'Beta Society', aliases: ['BS'] }] };
const item = (id, year, org = 'alpha', title = `${year} Shock Guidelines`) => ({ id, title, organizationId: org, versionYear: year, status: 'current' });

test('normalization removes years, editions, formats and punctuation', () => assert.equal(normalizeGuidelineTitle('2026 Shock Guidelines (2nd edition), v4.0'), 'shock'));
test('same title at different organizations has separate lineage', () => assert.notEqual(lineageKeyOf(item('a', 2026, 'alpha'), { orgs }), lineageKeyOf(item('b', 2026, 'beta'), { orgs })));

test('new edition supersedes queue and published predecessors without deletion', () => {
  const state = { queue: [item('q', 2025)], published: [item('p', 2024)] };
  const before = state.published.length;
  const result = resolveSupersede(state, item('new', 2026), { orgs });
  assert.deepEqual(result.supersedes.sort(), ['p', 'q']);
  assert.equal(result.confident, true);
  assert.ok([...state.queue, ...state.published].every((x) => x.status === 'superseded' && x.supersededBy === 'new'));
  assert.equal(state.published.length, before);
});

test('focused update remains in the base guideline lineage', () => assert.equal(lineageKeyOf(item('a', 2026), { orgs }), lineageKeyOf(item('b', 2025, 'alpha', '2025 Focused Update: Shock Guideline'), { orgs })));
test('substantially renamed title does not join and is not confident', () => assert.equal(resolveSupersede({ queue: [item('old', 2025)] }, item('new', 2026, 'alpha', '2026 Airway Management Recommendations'), { orgs }).confident, false));
test('unknown date/version and same-year editions never auto supersede', () => {
  assert.equal(resolveSupersede({ published: [item('old', 2025)] }, { id: 'new', title: 'Shock focused update', organizationId: 'alpha' }, { orgs }).confident, false);
  assert.equal(resolveSupersede({ published: [item('old', 2025)] }, item('new', 2025), { orgs }).confident, false);
});
