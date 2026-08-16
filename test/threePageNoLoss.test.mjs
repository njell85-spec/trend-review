import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { splitPages, mergePages } from '../src/utils/pageSplit.js';

/**
 * ★ 3페이지 분할의 무손실 못.
 *
 * 이 저장소가 반복해서 밟은 함정은 **"마커가 어느 파일에 있는지가 바뀌는 것"** 이다.
 * 2페이지로 가를 때 `data-guideline="1"` 로 누적 표를 지키는 검사가 있었는데, 그 행은
 * 분할로 `guidelines.html` 에 가버려 `index.html` 에는 0개였다. `0 >= 0` 이라
 * **행을 통째로 지우는 변이가 초록이었다.** 3분할은 같은 일을 한 번 더 한다.
 *
 * 그래서 여기서는 세 가지를 동시에 잠근다.
 *   ① 어느 마커가 **어느 페이지에 있어야 하는지**를 표로 명시한다.
 *   ② 기준값이 0이면 **테스트가 스스로 실패한다**(헛검사 금지).
 *   ③ 합계 보존 — 세 페이지를 **전부** 더해야 원본과 같다.
 *
 * ★ 대리 마커를 쓰지 않는다. 종전 검사는 참고자료를 `직접 지정` 이라는 문구로 셌는데
 *   그 문구는 정적 UI 에도 있어서 **참고자료 카드가 전멸해도 기준값이 0이 아니었다** —
 *   0 가드로도 못 잡는 거짓 양성이다. 여기서는 `data-kind="reference"` 처럼
 *   그 대상에만 붙는 마커만 쓴다.
 */

const count = (h, re) => (String(h).match(re) ?? []).length;

async function realPages() {
  const read = async (f) => (existsSync(new URL(`../${f}`, import.meta.url)) ? readFile(new URL(`../${f}`, import.meta.url), 'utf8') : null);
  return {
    index: await read('index.html'),
    guidelines: await read('guidelines.html'),
    reviews: await read('reviews.html'),
  };
}

/**
 * 마커 → 그것이 있어야 할 페이지. 3분할의 계약 그 자체다.
 *
 * ★ 대상에만 붙는 마커만 쓴다. `<!-- GSECTION:` 은 **가이드라인과 참고자료가 함께** 쓰는
 *   마커라(참고자료 카드도 같은 빌더가 만든다) 페이지 귀속을 못 가린다 — 그런 것을
 *   쓰면 한쪽이 전멸해도 다른 쪽 덕분에 기준값이 0이 아니어서 초록으로 지나간다.
 *   그게 지난 세션의 `직접 지정` 마커가 낸 거짓 양성이다.
 */
const HOME = [
  ['논문 카드 섹션', /<!-- SECTION:/g, 'index'],
  ['논문 표 행', /<tr data-pmid="[^"]*"><td class="c-date">/g, 'index'],
  ['가이드라인 표 행', /data-kind="guideline"/g, 'guidelines'],
  ['참고자료 카드', /🔖 참고자료/g, 'reviews'],
  ['참고자료 표 행', /data-kind="reference"/g, 'reviews'],
];

test('★ 실물 세 페이지: 마커가 제 페이지에 있고, 남의 페이지엔 없다', async () => {
  const pages = await realPages();
  assert.ok(pages.index, 'index.html 이 없다');
  for (const [label, re, home] of HOME) {
    const page = pages[home];
    if (!page) continue;                    // 아직 안 만들어진 페이지는 건너뛴다
    const n = count(page, re);
    // ★ 기준값 0 가드 — 이게 없으면 이 검사는 아무것도 안 지킨다.
    assert.ok(n > 0, `${label} 기준값이 0이다 (${home}.html) — 이 검사는 헛돈다`);
    for (const other of ['index', 'guidelines', 'reviews']) {
      if (other === home || !pages[other]) continue;
      assert.equal(count(pages[other], re), 0,
        `${label} 이 ${other}.html 에도 있다 — 분할이 새고 있다`);
    }
  }
});

test('★ 가이드라인 페이지에는 가이드 카드만 있고 기타는 리뷰 쪽으로 갔다', async () => {
  const pages = await realPages();
  if (!pages.guidelines) return;
  const gsec = count(pages.guidelines, /<!-- GSECTION:/g);
  assert.ok(gsec > 0, '가이드라인 카드 기준값이 0이다 — 이 검사는 헛돈다');
  assert.equal(count(pages.guidelines, /🔖 참고자료/g), 0,
    '참고자료 카드가 가이드라인 페이지에 남았다');
  assert.equal(count(pages.guidelines, /data-kind="reference"/g), 0,
    '참고자료 표 행이 가이드라인 페이지에 남았다');
});

test('★ 왕복(merge → split)에서 카드·행이 한 개도 사라지지 않는다', async () => {
  const pages = await realPages();
  if (!pages.guidelines) return;   // 2페이지 이전 상태면 이 검사는 의미가 없다

  const merged = mergePages(pages.index, pages.guidelines, pages.reviews);
  const out = splitPages(merged, { refIds: null });
  assert.ok(out.guidelines && out.reviews, '3분할이 안 됐다 — 소프트 폴백으로 떨어졌다');

  const ROWS = /<tr [^>]*data-pmid=/g;
  const SECS = /<!-- [GR]?SECTION:/g;

  const beforeRows = count(merged, ROWS);
  const beforeSecs = count(merged, SECS);
  // ★ 기준값 0 가드를 합계에도 건다. 빈 입력이면 0 === 0 으로 자명하게 통과한다.
  assert.ok(beforeRows > 0, '표 행 기준값이 0이다 — 이 검사는 헛돈다');
  assert.ok(beforeSecs > 0, '카드 섹션 기준값이 0이다 — 이 검사는 헛돈다');

  const afterRows = count(out.index, ROWS) + count(out.guidelines, ROWS) + count(out.reviews, ROWS);
  const afterSecs = count(out.index, SECS) + count(out.guidelines, SECS) + count(out.reviews, SECS);
  assert.equal(afterRows, beforeRows, `표 행이 샜다: ${beforeRows} → ${afterRows}`);
  assert.equal(afterSecs, beforeSecs, `카드 섹션이 샜다: ${beforeSecs} → ${afterSecs}`);
});

test('★ 예고 블록은 페이지마다 자기 트랙 것 하나만 있다 (요구 ②)', async () => {
  const pages = await realPages();
  const expect = { index: 'papers', guidelines: 'guidelines', reviews: 'reviews' };
  for (const [file, track] of Object.entries(expect)) {
    const html = pages[file];
    if (!html || !html.includes('<!-- UPCOMING:')) continue;
    assert.equal(count(html, new RegExp(`<!-- UPCOMING:${track} -->`, 'g')), 1,
      `${file}.html 에 ${track} 예고 블록이 정확히 하나가 아니다`);
    for (const other of Object.values(expect)) {
      if (other === track) continue;
      assert.equal(count(html, new RegExp(`<!-- UPCOMING:${other} -->`, 'g')), 0,
        `${file}.html 에 남의 트랙(${other}) 예고가 있다`);
    }
    // 구버전(트랙 없는) 블록이 남아 있으면 두 벌이 공존한다.
    assert.equal(count(html, /<!-- UPCOMING -->/g), 0,
      `${file}.html 에 구버전 예고 블록이 남았다`);
  }
});

/**
 * ★ 여기부터는 **합성 픽스처**로 검사한다 (2026-08-16 코드리뷰 발견 B5).
 *
 * 종전에는 배포된 실물 HTML 을 픽스처로 썼는데, 그것은 **이미 기능이 적용된 결과물**이라
 * 기능을 통째로 없애는 변이를 넣어도 검사가 그대로 초록이었다:
 *   · `collapseAllCards` 를 항등함수로 바꿔도 → 실물엔 이미 `open` 이 0개라 통과
 *   · 누적표 접힘을 없애도 → `if (!html.includes('arch-fold')) continue` 로 전부 skip
 *   · 예고 라우팅을 없애도 → `if (!html.includes('<!-- UPCOMING:')) continue` 로 전부 skip
 * **"기능이 완전히 죽으면 검사도 같이 사라지는"** 구조였다. 그래서 입력에 그 기능이
 * 아직 적용되지 않은 상태를 **일부러 만들어** 넣고, 출력에서 적용되었는지 본다.
 */
const FIXTURE = () => `<!DOCTYPE html>
<html lang="ko"><head><title>EM/CCM Trend Review</title></head><body>
<div class="wrap">
  <header class="hd"><h1>EM/CCM Trend Review</h1><div class="fn">x</div></header>
  <div class="stats"><div class="sc"><div class="n">1</div><div class="l">a</div></div></div>
  <div class="archive">
<!-- UPCOMING -->구버전 블록<!-- /UPCOMING -->
<!-- ARCHIVE_START -->
<!-- SECTION:2026-08-17 -->
<details open class="day day-today"><article class="paper-card">P</article></details>
<!-- /SECTION:2026-08-17 -->
<!-- GSECTION:2026-08-10 -->
<details open class="day day-today"><summary><span class="gl-tag">📋 가이드라인</span></summary><article class="guideline-card">G</article></details>
<!-- /GSECTION:2026-08-10 -->
<!-- GSECTION:2026-08-09-m-9 -->
<details class="day day-past"><summary><span class="gl-tag">📋 가이드라인</span></summary><article class="guideline-card"><span class="chip gl">🔖 참고자료</span>R</article></details>
<!-- /GSECTION:2026-08-09-m-9 -->
<!-- RSECTION:2026-08-08 -->
<details open class="day day-today"><summary><span class="gl-tag">📰 리뷰</span></summary><article class="guideline-card">V</article></details>
<!-- /RSECTION:2026-08-08 -->
  </div>
  <div class="arch-table">
    <div class="at-head"><span class="at-title">📚 누적</span><span class="at-count">1편</span></div>
    <div class="at-scroll"><table><tbody><!-- TABLE_ROWS_START --><tr data-pmid="1"><td class="c-date">2026-08-17</td><td class="c-jour">NEJM</td><td class="c-title"><a href="#">P</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="2" data-kind="guideline" data-guideline="1"><td class="c-date">2026-08-10</td><td class="c-jour">📋 IDSA</td><td class="c-title"><a href="#">G</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="9" data-kind="reference" data-guideline="1"><td class="c-date">2026-08-09</td><td class="c-jour">🔖 X</td><td class="c-title"><a href="#">R</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="3" data-kind="review" data-guideline="1"><td class="c-date">2026-08-08</td><td class="c-jour">📰 Lancet</td><td class="c-title"><a href="#">V</a></td><td class="c-read"><input class="readcb"></td></tr><!-- TABLE_ROWS_END --></tbody></table></div>
  </div>
</div></body></html>`;

test('★ 펼쳐진 카드가 든 입력을 넣어도 출력은 전부 접혀 나온다 (요구 ③)', () => {
  const src = FIXTURE();
  // ★ 기준값 확인 — 입력에 펼침이 없으면 이 검사는 아무것도 안 지킨다.
  assert.ok(count(src, /<details open class="day/g) >= 3,
    '픽스처에 펼쳐진 카드가 없다 — 이 검사는 헛돈다');

  const out = splitPages(src, { refIds: null });
  for (const page of ['index', 'guidelines', 'reviews']) {
    assert.ok(out[page], `${page} 가 안 나왔다`);
    assert.equal(count(out[page], /<details open class="day/g), 0,
      `${page} 에 펼쳐진 카드가 남았다`);
  }
  // 카드 자체는 살아 있어야 한다(접는다고 지우면 안 된다)
  assert.match(out.index, /<details class="day day-today">/);
});

test('★ 누적 표는 접힘 토글로 나온다 (요구 ⑤)', () => {
  const out = splitPages(FIXTURE(), { refIds: null });
  const folds = ['index', 'guidelines', 'reviews'].map((p) => count(out[p], /<details class="arch-fold">/g));
  assert.deepEqual(folds, [1, 1, 2], `누적 표 접힘 개수가 다르다: ${folds}`);
  for (const page of ['index', 'guidelines', 'reviews']) {
    assert.equal(count(out[page], /<details open class="arch-fold">/g), 0,
      `${page} 의 누적 표가 펼쳐진 채로 나갔다`);
    // 표 알맹이가 살아 있는지 — 접기만 하고 지우면 안 된다
    assert.match(out[page], /<!-- TABLE_ROWS_START -->/);
  }
});

test('★ 예고 블록이 각 페이지로 라우팅된다 (요구 ② · 구버전 블록은 걷힌다)', () => {
  // 트랙별 블록이 든 입력을 만든다 — 이것이 없으면 라우팅 검사가 skip 으로 빠진다(B5).
  const withBlocks = FIXTURE().replace('<!-- ARCHIVE_START -->', [
    '<!-- UPCOMING:papers -->논문예고<!-- /UPCOMING:papers -->',
    '<!-- UPCOMING:guidelines -->지침예고<!-- /UPCOMING:guidelines -->',
    '<!-- UPCOMING:reviews -->리뷰예고<!-- /UPCOMING:reviews -->',
    '<!-- ARCHIVE_START -->',
  ].join('\n'));

  const out = splitPages(withBlocks, { refIds: null });
  const own = { index: ['papers', '논문예고'], guidelines: ['guidelines', '지침예고'], reviews: ['reviews', '리뷰예고'] };
  for (const [file, [track, marker]] of Object.entries(own)) {
    assert.equal(count(out[file], new RegExp(`<!-- UPCOMING:${track} -->`, 'g')), 1,
      `${file} 에 ${track} 예고가 하나가 아니다`);
    assert.ok(out[file].includes(marker), `${file} 에 ${track} 예고 내용이 없다`);
    for (const [otherTrack, otherMarker] of Object.values(own)) {
      if (otherTrack === track) continue;
      assert.equal(out[file].includes(otherMarker), false,
        `${file} 에 남의 트랙(${otherTrack}) 예고가 있다`);
    }
    // 구버전(트랙 없는) 블록은 걷혀야 한다 — 안 걷으면 두 벌이 공존한다
    assert.equal(out[file].includes('구버전 블록'), false, `${file} 에 구버전 예고가 남았다`);
  }
});


/**
 * ★ PeterJ 지시 2026-08-17 — 지난 카드는 **한 번 더 접는다.**
 *   카드가 각각 접혀 있어도 날마다 한 줄씩 쌓이면 스크롤이 불편하다.
 *   오늘 것만 밖에 두고 나머지는 묶어서 접는다.
 */
test('★ 오늘 카드는 밖에, 지난 카드는 한 겹 더 접힌다 (요구 ④)', () => {
  const src = FIXTURE();
  assert.ok(count(src, /<!-- SECTION:/g) >= 1, '픽스처에 논문 카드가 없다 — 이 검사는 헛돈다');

  // 지난 논문 카드를 하나 더 넣어 "오늘 1 + 지난 1" 을 만든다
  const withPast = src.replace('<!-- GSECTION:2026-08-10 -->', [
    '<!-- SECTION:2026-08-15 -->',
    '<details class="day day-past"><article class="paper-card">지난 논문</article></details>',
    '<!-- /SECTION:2026-08-15 -->',
    '<!-- GSECTION:2026-08-10 -->',
  ].join('\n'));

  const out = splitPages(withPast, { refIds: null });
  assert.equal(count(out.index, /<details class="past-fold">/g), 1, '지난 논문 묶음이 없다');
  assert.match(out.index, /지난 논문 <span class="n">1건/, '지난 건수가 안 보인다');
  assert.doesNotMatch(out.index, /<details open class="past-fold">/, '지난 묶음이 펼쳐져 나갔다');

  // ★ 오늘 카드는 묶음 **밖**에 있어야 한다 — 안에 들어가면 매일 두 번 열어야 한다
  const fold = out.index.match(/<details class="past-fold">[\s\S]*?<\/details>/)[0];
  assert.equal(fold.includes('SECTION:2026-08-17'), false, '오늘 카드가 지난 묶음에 들어갔다');
  assert.ok(fold.includes('SECTION:2026-08-15'), '지난 카드가 묶음에 안 들어갔다');
  // 손실 0 — 접는다고 카드가 사라지면 안 된다
  assert.equal(count(out.index, /<!-- SECTION:/g), 2, '카드가 사라졌다');
});

test('★ 지난 것이 없으면 묶음을 만들지 않는다 (빈 상자 금지)', () => {
  const out = splitPages(FIXTURE(), { refIds: null });
  // ★ 요소로 센다. `past-fold` 라는 글자는 스타일시트에도 있어서, 문자열로 세면
  //   CSS 규칙을 요소로 착각해 늘 실패한다(처음에 그렇게 짰다가 걸렸다).
  assert.equal(count(out.index, /<details class="past-fold">/g), 0, '지난 것이 없는데 빈 묶음이 생겼다');
});
