import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

// ★ 이 저장소는 렌더가 **기존 내용을 지우는** 사고를 이미 한 번 냈다
// (GSECTION 8→7, 본문 679KB→572KB, LLM 이 뽑은 요약이 통째로 소실).
// 그래서 새 렌더는 **자기 블록만 갈아끼우고 나머지는 손대지 않는다**는 것을
// 실물 페이지로 못 박는다. 이 파일이 그 못이다.

const count = (html, re) => (html.match(re) || []).length;
const realHtml = () => readFile(new URL('../index.html', import.meta.url), 'utf8');

const track = (key, label, cadence, mode, n) => ({
  key, label, cadence, mode,
  state: { queue: Array.from({ length: n }, (_, i) => ({
    pmid: `${key}${i}`, title: `${label} 후보 ${i}`, journal: 'J Test', score: 9 - i })) },
});

test('★ 실물 페이지에 예고를 그려도 기존 내용이 하나도 안 사라진다', async () => {
  const html = await realHtml();
  const p = new GitHubPublisher();
  const out = p._renderUpcoming(html, {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'on', 5)],
  });
  for (const [label, re] of [
    ['보관 섹션', /<details class="day/g],
    ['누적 표 행', /data-guideline="1"/g],
    ['읽음 체크박스', /class="readcb"/g],
  ]) {
    assert.ok(count(out, re) >= count(html, re), `${label} 이 줄었다`);
  }
  assert.ok(out.length >= html.length - 200, '본문이 통째로 줄었다');
});

test('예고 블록이 실제로 들어간다', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 3,
    tracks: [track('papers', '논문', 'daily', 'on', 3)],
  });
  assert.match(out, /<!-- UPCOMING -->/);
  assert.match(out, /논문 후보 0/);
});

test('★ 두 번 그려도 블록이 둘로 늘지 않는다 (멱등)', async () => {
  const p = new GitHubPublisher();
  const args = { from: '2026-08-16', days: 3, tracks: [track('papers', '논문', 'daily', 'on', 3)] };
  const once = p._renderUpcoming(await realHtml(), args);
  const twice = p._renderUpcoming(once, { ...args, from: '2026-08-17' });
  assert.equal(count(twice, /<!-- UPCOMING -->/g), 1);
  // ★ 페이지 본문에는 오늘 날짜가 여기저기 박혀 있다(데일리가 찍는다).
  //   그래서 전체 문서가 아니라 **예고 블록 안에서만** 검사해야 한다 —
  //   안 그러면 코드가 멀쩡해도 빨개진다(처음에 그렇게 짰다가 걸렸다).
  const blockOf = (h) => h.match(/<!-- UPCOMING -->[\s\S]*?<!-- \/UPCOMING -->/)?.[0] ?? '';
  const b = blockOf(twice);
  assert.match(b, /2026-08-17/, '새 내용으로 갱신돼야 한다');
  assert.doesNotMatch(b, /2026-08-16/, '옛 예고가 블록에 남으면 안 된다');
});

test('★ 예고가 하나도 없으면 블록 자체를 넣지 않는다 (빈 상자 금지)', async () => {
  const html = await realHtml();
  const out = new GitHubPublisher()._renderUpcoming(html, {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'off', 5)],   // 전부 off
  });
  assert.equal(count(out, /<!-- UPCOMING -->/g), 0);
});

test('off 인 트랙은 "꺼짐" 으로 표시되고 항목은 안 나온다', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'off', 3), track('reviews', '리뷰', 'weekly', 'on', 2)],
  });
  assert.doesNotMatch(out, /논문 후보 0/, 'off 인데 항목이 나왔다');
  assert.match(out, /리뷰 후보 0/);
});

test('★ 제목의 HTML 특수문자가 이스케이프된다 (LLM·외부 입력이 들어오는 자리다)', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: '<img src=x onerror=alert(1)>', journal: 'J&J', score: 1 }] } }],
  });
  assert.doesNotMatch(out, /<img src=x/, '태그가 그대로 들어갔다');
  assert.match(out, /&lt;img/);
  assert.match(out, /J&amp;J/);
});

test('lowConfidence 항목에 ⚠ 가 붙는다 (계산만 되고 출구가 없던 값)', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: '약한 날', score: 1, lowConfidence: true }] } }],
  });
  assert.match(out, /⚠/);
});

test('항목마다 삭제·구동 버튼이 붙는다', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 2,
    tracks: [track('papers', '논문', 'daily', 'on', 2)],
  });
  assert.equal(count(out, /data-up-drop=/g), 2, '삭제 버튼이 항목 수만큼');
  assert.equal(count(out, /data-up-run=/g), 2, '구동 버튼이 항목 수만큼');
});

test('트랙마다 온오프 토글 버튼이 하나씩 붙는다', async () => {
  const out = new GitHubPublisher()._renderUpcoming(await realHtml(), {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'on', 2), track('reviews', '리뷰', 'weekly', 'on', 2)],
  });
  assert.equal(count(out, /data-up-toggle=/g), 2);
});
