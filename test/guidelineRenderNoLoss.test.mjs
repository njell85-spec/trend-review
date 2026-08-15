import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { migrateGuidelineState } from '../src/utils/guidelineState.js';

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
  const legacy = JSON.parse(await readFile(new URL('../output/selected_guidelines.json', import.meta.url), 'utf8'));
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

test('★ 검토함은 상태의 needsReview 를 판정 이유와 함께 보인다', async () => {
  const { html } = await realInputs();
  const state = {
    schemaVersion: 2, published: [], rejected: [], sourceHealth: {}, lastRun: null,
    updatedAt: 'x', configVersion: 'guideline-v2',
    queue: [{ id: 'pmid:1', pmid: '1', status: 'needsReview', title: 'Ambiguous statement on shock',
      organizationId: 'esicm', decisionReasons: ['insufficient-positive-evidence'] }],
  };
  const publisher = new GitHubPublisher();
  const out = publisher._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');
  assert.match(out, /검토함 1건/);
  assert.match(out, /insufficient-positive-evidence/);
  // 멱등 — 두 번 그려도 목록이 둘로 늘지 않는다
  const twice = publisher._renderGuidelineState(out, state, '2026-08-17T00:00:00Z');
  assert.equal(count(twice, /<!-- GNEEDSREVIEW -->/g), 1);
});

test('★ needsReview 가 0건이면 목록 자체를 넣지 않는다', async () => {
  const { html, state } = await realInputs();
  const publisher = new GitHubPublisher();
  const out = publisher._renderGuidelineState(html, state, '2026-08-16T00:00:00Z');
  assert.equal(count(out, /<!-- GNEEDSREVIEW -->/g), 0);
});
