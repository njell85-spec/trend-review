import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuidelineTitle, lineageKeyOf, resolveSupersede, applySupersede } from '../src/utils/guidelineLineage.js';

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
  // resolveSupersede 는 **변형하지 않고 전이 지시만** 돌려준다 — 호출자의 map 과 순서 다툼이
  // 나던 것을 끊은 것이다(코드리뷰 B5). 적용은 applySupersede 가 최종 배열에 한 번 한다.
  assert.ok([...state.queue, ...state.published].every((x) => x.status !== 'superseded'),
    'resolveSupersede 가 아직 원본을 제자리 변형한다');
  applySupersede(state, result.transitions);
  assert.ok([...state.queue, ...state.published].every((x) => x.status === 'superseded' && x.supersededBy === 'new'));
  assert.equal(state.published.length, before);
});

test('★ 큐 순서가 어떻든 전이가 최종 배열에 반영된다 (B5 — 구판이 앞에 있어도)', () => {
  // 구판 A 가 신판 B 보다 **앞**에 있는 배열. 종전 구현은 이 순서에서만 깨졌다.
  const older = item('A', 2025);
  const newer = item('B', 2026);
  const state = { queue: [older, newer], published: [] };
  const transitions = [];
  state.queue = state.queue.map((candidate) => {
    const r = resolveSupersede(state, candidate, { orgs });
    transitions.push(...r.transitions);
    return { ...candidate, supersedes: r.supersedes };
  });
  applySupersede(state, transitions);
  const a = state.queue.find((x) => x.id === 'A');
  const b = state.queue.find((x) => x.id === 'B');
  assert.equal(a.status, 'superseded', '구판이 앞에 있으면 전이가 유실되던 자리다');
  assert.equal(a.supersededBy, 'B');
  assert.deepEqual(b.supersedes, ['A']);
});

test('focused update remains in the base guideline lineage', () => assert.equal(lineageKeyOf(item('a', 2026), { orgs }), lineageKeyOf(item('b', 2025, 'alpha', '2025 Focused Update: Shock Guideline'), { orgs })));
test('substantially renamed title does not join and is not confident', () => assert.equal(resolveSupersede({ queue: [item('old', 2025)] }, item('new', 2026, 'alpha', '2026 Airway Management Recommendations'), { orgs }).confident, false));
test('unknown date/version and same-year editions never auto supersede', () => {
  assert.equal(resolveSupersede({ published: [item('old', 2025)] }, { id: 'new', title: 'Shock focused update', organizationId: 'alpha' }, { orgs }).confident, false);
  assert.equal(resolveSupersede({ published: [item('old', 2025)] }, item('new', 2025), { orgs }).confident, false);
});
