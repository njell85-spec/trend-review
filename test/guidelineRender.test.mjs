import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { splitPages } from '../src/utils/pageSplit.js';

const publisher = new GitHubPublisher();
const state = {
  published: [
    { id: 'pmid:old', pmid: 'old', title: 'Old', publishedAt: '2020-01-01', status: 'superseded', supersededBy: 'pmid:new', card: { paper: { pmid: 'old', title: 'Old' }, org: 'AHA' } },
    { id: 'pmid:new', pmid: 'new', title: 'New', publishedAt: '2026-01-01', status: 'current', supersedes: ['pmid:old'], card: { paper: { pmid: 'new', title: 'New' }, org: 'AHA' } },
  ],
  queue: [{ id: 'review:1', status: 'needsReview', title: 'Ambiguous', organizationId: 'AHA', reasons: ['same-year-ambiguous'] }],
};

function render(s = state) {
  const merged = publisher._renderGuidelineState(publisher.buildPage('', { tableRows: '' }), s, 'now');
  return splitPages(merged, { needsReview: s.queue?.filter((x) => x.status === 'needsReview') }).guidelines;
}

test('published 전량을 보존하고 superseded 배지와 상호 링크를 렌더한다', () => {
  const html = render();
  assert.match(html, /id="pmid:old"[^>]*data-guideline-id="pmid:old"/);
  assert.match(html, /superseded/);
  assert.match(html, /href="#pmid:new"/);
  assert.match(html, /href="#pmid:old"/);
  assert.equal((html.match(/class="guideline-card"/g) ?? []).length, state.published.length);
});
test('표 행 계약과 카드 ID↔published ID를 유지한다', () => {
  const html = render();
  for (const id of ['old', 'new']) assert.match(html, new RegExp(`<tr data-pmid="${id}" data-kind="guideline" data-guideline="1">`));
  const ids = [...html.matchAll(/data-guideline-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), state.published.map((x) => x.id).sort());
});
test('재렌더해도 superseded 배지가 사라지지 않는다', () => assert.match(render(), /chip superseded/));
test('needsReview는 이유와 건수를 보이고 0건이면 목록을 숨긴다', () => {
  assert.match(render(), /검토함 <span class="n">1건/);
  assert.match(render(), /판정 이유: same-year-ambiguous/);
  assert.doesNotMatch(render({ ...state, queue: [] }), /class="guideline-review"/);
});
