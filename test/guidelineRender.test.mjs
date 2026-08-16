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
/**
 * ★ 계약 변경 (PeterJ 지시 2026-08-17) — **검토함 블록을 없앴다.**
 *   자동 발행 기준을 통과 못 한 후보를 판정 이유와 함께 나열하던 상자인데,
 *   분류기 진단이지 PeterJ 가 읽고 무엇을 하는 화면이 아니었다.
 *   데이터는 `selected_guidelines.json` 큐에 그대로 남는다 — 화면에서만 뺐다.
 */
test('★ 검토함 블록은 화면에 나오지 않는다', () => {
  const out = render();
  assert.doesNotMatch(out, /class="guideline-review"/, 'pageSplit 쪽 검토함이 남았다');
  assert.doesNotMatch(out, /GNEEDSREVIEW/, '렌더 쪽 검토함이 남았다');
  assert.doesNotMatch(out, /검토함/, '검토함 문구가 남았다');
  // 전제 확인 — 픽스처에 needsReview 가 실제로 있어야 이 검사가 의미를 갖는다
  assert.ok(state.queue.some((x) => x.status === 'needsReview'),
    '픽스처에 needsReview 가 없다 — 이 검사는 헛돈다');
});

test('★ 이미 배포된 페이지에 남은 검토함 블록은 걷어낸다 (유령 방지)', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const withGhost = '<!-- ARCHIVE_START -->\n<!-- GNEEDSREVIEW -->\n<details>옛 검토함</details>\n<!-- /GNEEDSREVIEW -->';
  const out = new GitHubPublisher()._renderGuidelineState(withGhost, state, '2026-08-17');
  assert.doesNotMatch(out, /GNEEDSREVIEW/, '배포본에 남은 검토함이 안 걷혔다');
  assert.doesNotMatch(out, /옛 검토함/);
});
