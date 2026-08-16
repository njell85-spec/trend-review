import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { migrateGuidelineState } from '../src/utils/guidelineState.js';
import { readPublishedLegacy } from './helpers/guidelineProduction.mjs';

// ★ B1 재현 회귀 — 병합 전 코드리뷰가 실물 측정으로 잡은 치명 결함.
//
// 첫 구현의 `_renderGuidelineState()` 는 GSECTION 블록과 `data-guideline` 표 행을
// **전부 지운 뒤** `state.published` 로 다시 그렸다. 실물로 재면 이렇게 됐다:
//   GSECTION 8 → 7 · data-guideline 행 8 → 7 · '핵심 권고' 7 → 0 ·
//   '이전 판 대비 주요 변경점' 7 → 0 · 본문 679KB → 572KB
// 두 가지가 동시에 사라진다:
//   ① 마이그레이션된 옛 발행 7건은 `card` 가 없어(옛 배열엔 pmid/title/org/date 뿐)
//      빈 껍데기로 재생성된다 — LLM 이 뽑아 발행한 요약·변경점·임상영향이 **소실**된다.
//      복구 원천이 git 히스토리뿐이 된다.
//   ② PeterJ 가 수동 지정한 참고자료는 `selected_references.json` 에 있고 가이드라인
//      상태에는 없다. 지우고 다시 그리면 **매 데일리마다** 화면에서 사라진다.
// 확정 ③-C 는 "구판 발행 기록을 삭제하지 않는다" 이므로 지우는 설계 자체가 위반이다.
// 게다가 이 경로는 `ENABLE_GUIDELINE_AUTOPUBLISH` 와 **무관하게** 매 publish 마다 돈다.
//
// 그래서 렌더는 **덧붙이기만 하고 지우지 않는다.** 이 테스트가 그것을 실물로 못 박는다.

const count = (html, re) => (html.match(re) || []).length;

async function realInputs() {
  const html = await readFile(new URL('../guidelines.html', import.meta.url), 'utf8');
  const legacy = await readPublishedLegacy();
  return { html, state: migrateGuidelineState(legacy) };
}

test('★ 실물 페이지에 마이그레이션 상태를 먹여도 아무것도 사라지지 않는다', async () => {
  const { html, state } = await realInputs();
  const publisher = new GitHubPublisher();
  const out = publisher._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');

  const metrics = [
    ['GSECTION 블록', /<!-- GSECTION:/g],
    ['가이드·기타 표 행', /data-guideline="1"/g],
    ['핵심 권고 본문', /핵심 권고/g],
    ['직접 지정 배지(수동 참고자료)', /직접 지정/g],
  ];
  for (const [label, re] of metrics) {
    const before = count(html, re);
    const after = count(out, re);
    assert.ok(after >= before,
      `${label}이 줄었다: ${before} → ${after} (렌더가 지우고 있다 — 확정 ③-C 위반)`);
  }
  assert.ok(out.length >= html.length * 0.98,
    `본문이 줄었다: ${html.length} → ${out.length} 바이트`);
});

test('★ card 가 없는 레거시 발행분을 빈 껍데기로 다시 그리지 않는다', async () => {
  const { html, state } = await realInputs();
  assert.ok(state.published.every((x) => !x.card),
    '이 회귀의 전제: 마이그레이션된 항목에는 card 가 없다');
  const publisher = new GitHubPublisher();
  const out = publisher._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');
  assert.equal(count(out, /<!-- GSECTION:state-/g), 0,
    'card 없는 항목으로 새 섹션을 만들면 기존 카드의 내용이 빈 껍데기로 대체된다');
});

test('★ 재발행해도 배지가 중복되지 않는다 (멱등)', async () => {
  const { html } = await realInputs();
  const state = {
    schemaVersion: 2, queue: [], rejected: [], sourceHealth: {}, lastRun: null,
    updatedAt: 'x', configVersion: 'guideline-v2',
    published: [
      { id: 'pmid:41122895', pmid: '41122895', status: 'superseded', supersededBy: 'pmid:41122894', publishedAt: '2026-07-30' },
      { id: 'pmid:41122894', pmid: '41122894', status: 'current', publishedAt: '2026-08-11' },
    ],
  };
  const publisher = new GitHubPublisher();
  const once = publisher._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');
  const twice = publisher._renderGuidelineState(once, state, '2026-08-17T00:00:00Z');
  assert.equal(count(once, /gl-superseded/g), count(twice, /gl-superseded/g),
    '재발행마다 배지가 쌓인다');
  assert.ok(count(once, /gl-superseded/g) > 0, '배지가 아예 안 붙었다 — ③-C 미구현');
});

/**
 * ★ 계약 변경 (PeterJ 지시 2026-08-17) — **검토함 블록을 없앴다.**
 *   자동 발행 기준을 통과 못 한 후보를 판정 이유와 함께 나열하던 상자인데,
 *   분류기 진단이지 PeterJ 가 읽고 무엇을 하는 화면이 아니었다.
 *   데이터는 `selected_guidelines.json` 큐에 그대로 남는다 — 화면에서만 뺐다.
 */
test('★ needsReview 가 있어도 검토함을 그리지 않는다', async () => {
  const { html } = await realInputs();
  const state = {
    schemaVersion: 2, published: [], rejected: [], sourceHealth: {}, lastRun: null,
    updatedAt: 'x', configVersion: 'guideline-v2',
    queue: [{ id: 'pmid:1', pmid: '1', status: 'needsReview', title: 'Ambiguous statement on shock',
      organizationId: 'esicm', decisionReasons: ['insufficient-positive-evidence'] }],
  };
  const out = new GitHubPublisher()._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');
  // ★ 이 함수가 책임지는 것은 GNEEDSREVIEW 블록 하나다. 실물 페이지에 남아 있는
  //   pageSplit 쪽 검토함(`guideline-review`)은 다음 분할에서 재생성되지 않는 방식으로
  //   사라지므로 여기서 재지 않는다 — 그건 아래 발행 경로 검사가 본다.
  assert.equal(count(out, /<!-- GNEEDSREVIEW -->/g), 0, '검토함 블록이 그려졌다');
  // ★ 지우는 것 말고는 아무것도 안 지켰는지 확인 — 본문은 그대로여야 한다
  assert.ok(out.length >= html.length * 0.98, `본문이 줄었다: ${html.length} → ${out.length}`);
});

test('★ 이미 배포된 페이지의 검토함 블록은 걷어낸다 (유령 방지)', async () => {
  const { html, state } = await realInputs();
  const ghost = html.replace('<!-- ARCHIVE_START -->',
    '<!-- ARCHIVE_START -->\n<!-- GNEEDSREVIEW -->\n<details>옛 검토함</details>\n<!-- /GNEEDSREVIEW -->');
  assert.match(ghost, /GNEEDSREVIEW/, '픽스처에 유령이 없다 — 이 검사는 헛돈다');
  const out = new GitHubPublisher()._renderGuidelineState(ghost, state, '2026-08-17T00:00:00Z');
  assert.equal(count(out, /GNEEDSREVIEW/g), 0, '배포본에 남은 검토함이 안 걷혔다');
});


/**
 * pageSplit 쪽 검토함은 **재생성되지 않는 방식**으로 사라진다.
 * split 이 페이지를 다시 조립하면서 그 블록을 더는 만들지 않기 때문이다.
 * 배포 실물에 아직 남아 있으므로, 한 번 갈라보면 사라지는지 여기서 확인한다.
 */
test('★ 페이지를 다시 가르면 검토함이 사라진다', async () => {
  const { splitPages } = await import('../src/utils/pageSplit.js');
  const html = await readFile(new URL('../guidelines.html', import.meta.url), 'utf8');
  const { readFile: rf } = await import('node:fs/promises');
  const index = await rf(new URL('../index.html', import.meta.url), 'utf8');
  const { mergePages } = await import('../src/utils/pageSplit.js');
  const reviews = await rf(new URL('../reviews.html', import.meta.url), 'utf8');

  const merged = mergePages(index, html, reviews);
  const out = splitPages(merged, { refIds: null });
  assert.ok(out.guidelines, '분할이 안 됐다 — 이 검사는 헛돈다');
  assert.equal(count(out.guidelines, /class="guideline-review"/g), 0, '검토함이 남았다');
  assert.equal(count(out.guidelines, /검토함/g), 0, '검토함 문구가 남았다');
});
