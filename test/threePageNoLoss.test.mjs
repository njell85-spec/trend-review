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

test('★ 세 페이지 모두 카드가 접혀 있다 (요구 ③ — 오늘 논문 포함)', async () => {
  const pages = await realPages();
  for (const [file, html] of Object.entries(pages)) {
    if (!html) continue;
    assert.equal(count(html, /<details open class="day/g), 0,
      `${file}.html 에 펼쳐진 카드가 남아 있다`);
  }
});

test('★ 누적 표는 접힘이 기본이다 (요구 ⑤)', async () => {
  const pages = await realPages();
  for (const [file, html] of Object.entries(pages)) {
    if (!html || !html.includes('arch-fold')) continue;
    const n = count(html, /<details class="arch-fold">/g);
    assert.ok(n > 0, `${file}.html 의 누적 표 접힘 기준값이 0이다`);
    assert.equal(count(html, /<details open class="arch-fold">/g), 0,
      `${file}.html 의 누적 표가 펼쳐진 채로 나갔다`);
  }
});
