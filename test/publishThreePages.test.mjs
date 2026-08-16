import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

/**
 * ★ 발행 경로 전체를 실제로 한 번 돌린다.
 *
 * 이 저장소가 아홉 번 넘게 밟은 함정은 **"모듈은 옳은데 아무도 안 부른다"** 다.
 * `pageSplit` 단위 테스트가 아무리 초록이어도 `publish()` 가 그것을 안 부르면 화면은
 * 안 바뀐다 — 실제로 예고 렌더가 그 상태였고(아무도 안 불렀다), 리뷰 카드도 그랬다
 * (큐만 소비하고 렌더가 없었다). 그래서 여기서는 `publish()` 를 통째로 돌려
 * **파일 세 개가 실제로 기록되는지**를 본다.
 */

const ROOT = new URL('..', import.meta.url).pathname;

async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-pub3-'));
  await mkdir(path.join(dir, 'output'), { recursive: true });
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    if (existsSync(path.join(ROOT, f))) await copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  // 예고 렌더가 읽는 큐 — 프로덕션 파일을 건드리지 않기 위해 최소 픽스처를 쓴다.
  await writeFile(path.join(dir, 'output', 'queue_papers.json'),
    JSON.stringify({ schemaVersion: 1, track: 'papers', queue: [], published: [], rejected: [] }));
  return dir;
}

const PAPER = {
  paper: { pmid: '99999', title: 'E2E Test Paper', journal: 'NEJM', pubDate: '2026-08' },
  title_ko: 'E2E 시험 논문',
};
const REVIEW = { pmid: '88888', title: 'E2E Review Article', journal: 'Lancet', score: 9.1, topic: 'sepsis' };

const count = (h, re) => (h.match(re) ?? []).length;

async function runPublish() {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};   // 커밋은 이 검사의 대상이 아니다(publishStaging.test.mjs 가 본다)
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const read = async (f) => readFile(path.join(dir, f), 'utf8');
  return { index: await read('index.html'), guidelines: await read('guidelines.html'), reviews: await read('reviews.html') };
}

test('★ publish 한 번에 세 페이지가 모두 기록된다', async () => {
  const p = await runPublish();
  for (const [name, html] of Object.entries(p)) {
    assert.ok(html && html.length > 1000, `${name}.html 이 기록되지 않았다`);
  }
});

test('★ 카드가 제 페이지로 간다 — 논문은 index, 리뷰는 reviews', async () => {
  const p = await runPublish();
  assert.ok(p.index.includes('E2E 시험 논문'), '논문 카드가 index 에 없다');
  assert.equal(p.reviews.includes('E2E 시험 논문'), false, '논문 카드가 리뷰 페이지로 샜다');

  // ★ 이것이 B3 회귀다 — 리뷰는 발행되는데 화면에 아무것도 안 나오던 상태.
  assert.ok(p.reviews.includes('E2E Review Article'), '리뷰 카드가 화면에 안 나온다');
  assert.equal(count(p.reviews, /<!-- RSECTION:/g), 1, '리뷰 섹션이 정확히 하나가 아니다');
  assert.match(p.reviews, /data-kind="review"/, '리뷰 표 행이 없다');
  assert.equal(p.index.includes('E2E Review Article'), false, '리뷰가 논문 페이지로 샜다');
  assert.equal(p.guidelines.includes('E2E Review Article'), false, '리뷰가 가이드라인 페이지로 샜다');
});

test('★ 새로 발행한 오늘 카드도 접혀 있다 (요구 ③)', async () => {
  const p = await runPublish();
  for (const [name, html] of Object.entries(p)) {
    assert.equal(count(html, /<details open/g), 0, `${name}.html 에 펼쳐진 카드가 있다`);
  }
  assert.match(p.index, /<details class="day day-today">/, '오늘 카드 자체가 없다 — 이 검사는 헛돈다');
});

test('★ 페이지마다 자기 트랙 예고만 붙는다 (요구 ②)', async () => {
  const p = await runPublish();
  const own = { index: 'papers', guidelines: 'guidelines', reviews: 'reviews' };
  for (const [file, track] of Object.entries(own)) {
    assert.equal(count(p[file], new RegExp(`<!-- UPCOMING:${track} -->`, 'g')), 1,
      `${file}.html 에 ${track} 예고가 하나가 아니다`);
    for (const other of Object.values(own)) {
      if (other === track) continue;
      assert.equal(count(p[file], new RegExp(`<!-- UPCOMING:${other} -->`, 'g')), 0,
        `${file}.html 에 남의 트랙 예고(${other})가 있다`);
    }
  }
});

test('★ 두 번 발행해도 카드·행이 늘지 않는다 (멱등 — 같은 날 재실행)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const once = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const twice = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  assert.equal(count(twice, /<!-- RSECTION:/g), count(once, /<!-- RSECTION:/g), '리뷰 섹션이 늘었다');
  assert.equal(count(twice, /data-kind="review"/g), count(once, /data-kind="review"/g), '리뷰 표 행이 늘었다');

  const idx = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.equal(count(idx, /<!-- SECTION:2026-08-17 -->/g), 1, '같은 날 논문 섹션이 둘이 됐다');
});

test('★ 리뷰가 없는 날에도 세 페이지가 그대로 나간다 (데일리 코어 무영향)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], {});   // review 없음
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    const html = await readFile(path.join(dir, f), 'utf8');
    assert.ok(html.length > 1000, `${f} 가 기록되지 않았다`);
  }
  const idx = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.ok(idx.includes('E2E 시험 논문'), '리뷰가 없다고 논문이 안 나갔다');
});
