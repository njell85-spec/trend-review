import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { splitPages } from '../src/utils/pageSplit.js';

/**
 * ★★ PeterJ 실측 2026-08-18 — *"1·2번 트랙은 오늘자 논문·가이드라인 제목이 나오는데
 *   3번 트랙 리뷰는 오늘자가 접혀서 있음."*
 *
 * 원인: `_buildReviewSection` 이 `day day-past` **하드코딩**이었다. `foldPast` 는
 * `day day-today` 유무로 오늘/지난을 가르므로, 리뷰 카드는 **발행 당일부터** '지난 리뷰'
 * 묶음 안으로 들어갔다. 논문·가이드라인은 호출부에서 `isToday: true` 를 받는데
 * **리뷰만 그 인자가 아예 없었다.**
 *
 * 이 저장소의 단골 부류다 — 트랙이 셋인데 하나만 규칙에서 빠진다(RSECTION 이
 * 삭제 경로 여덟 자리에서 빠졌던 것과 같은 얼굴). 그래서 **세 트랙을 한 검사에서
 * 같이** 본다. 하나만 검사하면 다음에 또 하나가 조용히 빠진다.
 */

const PAPER = { paper: { pmid: '111', title: 'Paper', journal: 'NEJM', pubDate: '2026-08-18' }, title_ko: '오늘 논문' };
const GUIDE = { paper: { pmid: '222', title: 'Guideline', journal: 'Stroke' }, title_ko: '오늘 가이드라인', org: 'AHA' };
const REVIEW = { pmid: '333', journal: 'Lancet', card: { title_ko: '오늘 리뷰', paper: { pmid: '333', journal: 'Lancet' }, sections: [{ heading_ko: '서론', body_ko: '본문' }] } };

/**
 * ★ `<style>` 블록을 걷고 본다. `past-fold` 라는 낱말이 **CSS 주석에도** 있어서
 *   `indexOf('past-fold')` 는 실제 접힘보다 훨씬 앞을 가리킨다(처음에 이 검사가
 *   그래서 거짓 적색을 냈다). 찾을 것은 **여는 태그**다.
 */
const FOLD_OPEN = '<details class="past-fold">';
const stripStyle = (h) => h.replace(/<style>[\s\S]*?<\/style>/g, '');

function publisher(repoPath) {
  const p = new GitHubPublisher({ owner: 'o', repo: 'r', repoPath });
  p._gitPush = () => {};
  return p;
}

test('★★ 세 트랙 모두 오늘자 섹션이 day-today 로 나온다 (한 트랙만 빠지는 것을 막는다)', () => {
  const p = publisher('/tmp');
  const built = {
    논문: p._buildSection('2026-08-18', 'gen', [PAPER], { isToday: true }),
    가이드라인: p._buildGuidelineSection('2026-08-18', 'gen', GUIDE, { isToday: true }),
    리뷰: p._buildReviewSection('2026-08-18', 'gen', REVIEW, { isToday: true, sectionKey: '2026-08-18-r-333' }),
  };
  // ★ 대상을 3개 미만으로 찾으면 검사가 헛돈다 — 이 저장소의 관례.
  assert.equal(Object.keys(built).length, 3, '트랙 셋을 다 보지 않는다 — 검사가 헛돈다');
  for (const [track, html] of Object.entries(built)) {
    assert.match(html, /<details class="day day-today">/,
      `${track} 오늘 카드가 day-today 가 아니다 — 발행 당일부터 '지난' 묶음에 접힌다`);
  }
});

test('★ 지난 날짜는 세 트랙 모두 day-past 다', () => {
  const p = publisher('/tmp');
  for (const [track, html] of Object.entries({
    논문: p._buildSection('2026-08-01', 'gen', [PAPER], {}),
    가이드라인: p._buildGuidelineSection('2026-08-01', 'gen', GUIDE, {}),
    리뷰: p._buildReviewSection('2026-08-01', 'gen', REVIEW, { sectionKey: '2026-08-01-r-333' }),
  })) {
    assert.match(html, /<details class="day day-past">/, `${track} 지난 카드가 day-past 가 아니다`);
  }
});

// ── 발행 경로를 실제로 태워 화면 결과까지 본다 ────────────────────────────────
// 순수 빌더만 검사하면 "호출부가 isToday 를 안 넘긴다" 를 못 잡는다 — 그게 이번 결함이다.
test('★★ publish() 를 태우면 리뷰가 접히지 않고 제목이 보인다 (호출부 배선)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-today-'));
  const p = publisher(dir);
  await p.publish('2026-08-18', [PAPER], { guideline: GUIDE, review: REVIEW });

  const reviews = stripStyle(readFileSync(path.join(dir, 'reviews.html'), 'utf8'));
  const i = reviews.indexOf('<!-- RSECTION:2026-08-18-r-333 -->');
  assert.ok(i > 0, '리뷰 섹션이 reviews.html 에 없다');
  const fold = reviews.indexOf(FOLD_OPEN);
  assert.ok(fold === -1 || i < fold,
    '오늘 리뷰가 "지난 리뷰" 접힘 안으로 들어갔다 — PeterJ 가 지적한 그 증상이다');
  assert.ok(reviews.includes('오늘 리뷰'), '리뷰 제목이 화면에 없다');
});

test('★ 세 페이지에서 오늘 카드가 접힘 밖에 있다 (논문·가이드라인·리뷰)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-today2-'));
  const p = publisher(dir);
  await p.publish('2026-08-18', [PAPER], { guideline: GUIDE, review: REVIEW });

  for (const [file, marker, title] of [
    ['index.html', '<!-- SECTION:2026-08-18 -->', '오늘 논문'],
    ['guidelines.html', '<!-- GSECTION:2026-08-18 -->', '오늘 가이드라인'],
    ['reviews.html', '<!-- RSECTION:2026-08-18-r-333 -->', '오늘 리뷰'],
  ]) {
    const html = stripStyle(readFileSync(path.join(dir, file), 'utf8'));
    const i = html.indexOf(marker);
    const fold = html.indexOf(FOLD_OPEN);
    assert.ok(i > 0, `${file} 에 오늘 섹션이 없다`);
    assert.ok(fold === -1 || i < fold, `${file} 의 오늘 카드가 접힘 안에 있다`);
    assert.ok(html.includes(title), `${file} 에 오늘 제목이 없다`);
  }
});

// ── 다음 날 강등 ─────────────────────────────────────────────────────────────
test('★ 다음 날 발행하면 어제 리뷰가 day-past 로 내려간다 (TODAY 가 둘이 되지 않는다)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-today3-'));
  const p = publisher(dir);
  await p.publish('2026-08-18', [PAPER], { review: REVIEW });
  const R2 = { pmid: '444', journal: 'NEJM', card: { title_ko: '내일 리뷰', paper: { pmid: '444', journal: 'NEJM' } } };
  await p.publish('2026-08-19', [], { review: R2 });

  const html = readFileSync(path.join(dir, 'reviews.html'), 'utf8');
  const todays = (html.match(/<details class="day day-today">/g) ?? []).length;
  assert.equal(todays, 1, `day-today 가 ${todays}개 — 어제 것이 강등되지 않았다`);
  assert.ok(html.includes('내일 리뷰'));
});

// ── 배포 실물 ────────────────────────────────────────────────────────────────
test('★ 생성기에 day-past 하드코딩이 남아 있지 않다', () => {
  const src = readFileSync(new URL('../src/utils/GitHubPublisher.js', import.meta.url), 'utf8');
  const start = src.indexOf('_buildReviewSection(');
  const end = src.indexOf('_buildSection(dateStr', start);
  const body = src.slice(start, end);
  assert.ok(!/<details class="day day-past">/.test(body),
    '리뷰 섹션에 day-past 가 하드코딩돼 있다 — 오늘 카드가 발행 당일부터 접힌다');
  assert.match(body, /isToday \? 'day day-today' : 'day day-past'/,
    '리뷰 섹션이 다른 두 트랙과 같은 규칙을 쓰지 않는다');
});
