#!/usr/bin/env node
/**
 * 배포 페이지에 **렌더 경로만** 적용한다 (분석·수집 없음, LLM 토큰 0).
 *
 * 왜 필요한가 — 이 저장소의 배포 페이지는 **증분 패처**가 만든다. 렌더 코드를 고쳐도
 * 다음 데일리가 돌기 전까지는 화면이 옛 모습 그대로다. 구조를 바꾼 날(2 → 3페이지,
 * 카드 접힘, 예고 위치)에는 그 하루가 그대로 "안 반영된 것처럼" 보인다.
 * 그래서 지금 배포본을 입력으로 **같은 렌더 경로를 한 번 태워** 결과를 커밋한다.
 *
 * ★ 무손실을 숫자로 확인하고, 줄었으면 **쓰지 않고 죽는다.** 이 저장소는 렌더가 기존
 *   내용을 통째로 지운 사고를 이미 냈다(GSECTION 8→7 · 679KB→572KB · LLM 요약 소실).
 *
 *   node scripts/apply-page-render.mjs [--dry]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { mergePages, splitPages } from '../src/utils/pageSplit.js';
import { loadCurationState, CURATION_STATE_PATH } from '../src/utils/curation.js';

const DRY = process.argv.includes('--dry');
const root = process.cwd();
const read = async (f) => (existsSync(path.join(root, f)) ? readFile(path.join(root, f), 'utf8') : null);
const count = (h, re) => (String(h ?? '').match(re) ?? []).length;

const before = {
  index: await read('index.html'),
  guidelines: await read('guidelines.html'),
  reviews: await read('reviews.html'),
};
if (!before.index) { console.error('✖ index.html 이 없다'); process.exit(1); }

// ★ 식별자를 반드시 넘긴다. 안 넘기면 `var OWNER='undefined'` 가 라이브 스크립트에
//   구워져 예고 버튼이 전부 죽는다 — 2026-08-16 PR #108 에서 실제로 일어난 사고다.
const publisher = new GitHubPublisher({
  owner: process.env.GITHUB_OWNER ?? 'njell85-spec',
  repo: process.env.GITHUB_REPO ?? 'trend-review',
  repoPath: root,
});

const merged = mergePages(before.index, before.guidelines, before.reviews);
const generatedAt = new Date().toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
let staged = await publisher._renderUpcomingFromDisk(merged, generatedAt);

// ★★ 클라이언트 블록도 여기서 최신판으로 맞춘다 (2026-08-18).
//   종전에는 예정리스트만 다시 그렸다. 그런데 버튼·삭제·읽음 코드는 **버전 마커가 붙은
//   클라이언트 블록**이고, 그 교체는 `publish()` 안에서만 일어난다 — 즉 **데일리가 돌기
//   전까지 배포본은 옛 코드 그대로**다. 실측(커밋 542cfd2):
//     · 생성기 CURATION_BLOCK v7 ↔ 배포 3페이지 v6 (삭제 확인 문구가 옛말을 하고 있었다)
//     · 읽음 스크립트에 `output/read_state.json` PUT 이 **배포본에 아예 없었다**
//   버튼 워크플로(🗑·큐제어)는 이 스크립트를 태우므로, 여기서 같이 맞추면 **버튼 한 번에
//   배포본이 최신 코드로 따라온다.** 순서는 `publish()` 와 같게 둔다(다르면 어느 날
//   두 경로가 다른 페이지를 만든다).
staged = publisher._ensureOnDemandWidget(staged);
staged = publisher._applyCuration(staged, await loadCurationState(path.join(root, CURATION_STATE_PATH)));
staged = await publisher._ensureArchiveStatus(staged);
staged = publisher._ensureReadScript(staged);

const out = splitPages(staged, { refIds: await publisher._referenceIds() });

if (!out.guidelines || !out.reviews) {
  console.error('✖ 3분할이 안 됐다 — 소프트 폴백으로 떨어졌다. 쓰지 않는다.');
  process.exit(1);
}

// ── 무손실 검사 (숫자로) ─────────────────────────────────────────────────────
const ROWS = /<tr [^>]*data-pmid=/g;
const SECS = /<!-- [GR]?SECTION:/g;
const sum = (re) => count(out.index, re) + count(out.guidelines, re) + count(out.reviews, re);

const checks = [
  ['표 행', count(merged, ROWS), sum(ROWS)],
  ['카드 섹션', count(merged, SECS), sum(SECS)],
];
let bad = false;
for (const [label, a, b] of checks) {
  const ok = a > 0 && b === a;   // 기준값 0이면 검사가 헛돈다 → 실패로 본다
  console.log(`${ok ? '✔' : '✖'} ${label}: ${a} → ${b}`);
  if (!ok) bad = true;
}
console.log(`· 분할 집계: ${JSON.stringify(out.counts)}`);
console.log(`· 바이트: index ${before.index.length} → ${out.index.length}`
  + ` · guidelines ${before.guidelines?.length ?? 0} → ${out.guidelines.length}`
  + ` · reviews ${before.reviews?.length ?? 0} → ${out.reviews.length}`);

if (/OWNER='undefined'|REPO='undefined'/.test(out.index + out.guidelines + out.reviews)) {
  console.error("✖ 스크립트에 'undefined' 식별자가 구워졌다 — 버튼이 죽는다");
  bad = true;
}
if (bad) { console.error('✖ 무손실 검사 실패 — 아무것도 쓰지 않는다'); process.exit(1); }
if (DRY) { console.log('· --dry 이므로 쓰지 않는다'); process.exit(0); }

await writeFile(path.join(root, 'index.html'), out.index, 'utf8');
await writeFile(path.join(root, 'guidelines.html'), out.guidelines, 'utf8');
await writeFile(path.join(root, 'reviews.html'), out.reviews, 'utf8');
console.log('✔ index.html · guidelines.html · reviews.html 기록');
