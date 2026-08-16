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
const render = (opts) => new GitHubPublisher()._renderUpcoming('<!-- ARCHIVE_START -->', opts);
const oneTrack = () => ({ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
  state: { queue: [{ pmid: '1', title: '제목', journal: 'NEJM', score: 1 }] } });

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

// ★ 판단을 뒤집었다 (2026-08-16, 미리보기 중).
// 처음엔 "비면 빈 상자를 만들지 말자" 로 짰는데, 그러면 **트랙을 전부 껐을 때 토글
// 버튼까지 같이 사라져서 다시 켤 방법이 없어진다.** 화면에서 나가는 유일한 스위치를
// 화면이 비었다는 이유로 치우는 셈이다. 빈 상자보다 그게 훨씬 나쁘다.
// 그래서 **비어도 블록은 그리고 "없다" 고 말한다.**
test('★ 트랙을 전부 꺼도 블록과 토글은 남는다 (다시 켤 스위치가 사라지면 안 된다)', async () => {
  const html = await realHtml();
  const out = new GitHubPublisher()._renderUpcoming(html, {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'off', 5)],   // 전부 off
  });
  assert.equal(count(out, /<!-- UPCOMING -->/g), 1, '블록이 사라졌다');
  assert.match(out, /data-up-toggle/, '다시 켤 토글이 없다');
  assert.match(out, /up-empty/, '비었다는 안내가 없다');
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

// ★ 미리보기에서 잡은 것 두 가지 (push 전, 2026-08-16).
// ① 스타일을 아예 안 넣어서 **맨몸 HTML** 로 나왔다. 이 블록은 교체식으로 끼워지므로
//    스타일이 블록 안에 같이 있어야 한다 — 밖에 두면 블록만 갱신될 때 안 따라온다.
// ② 지침 제목이 200자를 넘어 폰 화면 절반을 한 줄이 먹었다. 예고는 훑어보는 목록이다.
test('★ 예고 블록은 자기 스타일을 들고 다닌다 (맨몸으로 나가지 않는다)', () => {
  const out = render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] });
  assert.match(out, /<style>[\s\S]*\.up-item[\s\S]*<\/style>/, '블록에 스타일이 없다');
  assert.ok(out.indexOf('<style>') < out.indexOf('<section class="upcoming">'),
    '스타일이 섹션보다 뒤에 있다');
});

test('★ 긴 제목은 잘리고 전문은 title 속성에 남는다', () => {
  const long = '가'.repeat(300);
  const out = render({ from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: long, journal: 'J', score: 1 }] } }] });
  // 라벨(up-track)이 제목 span 안에 들어 있으므로 라벨 뒤부터 본다.
  const inner = out.match(/<span class="up-title"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="up-journal"|<button)/)?.[1] ?? '';
  const shown = inner.replace(/<span class="up-track">[^<]*<\/span>\s*/, '').replace(/<[^>]*>/g, '');
  assert.ok(shown.length <= 67, `제목이 안 잘렸다 (${shown.length}자)`);
  assert.ok(shown.endsWith('…'), '말줄임표가 없다');
  assert.ok(out.includes(`title="${long}"`), '전문이 title 속성에 없다');
});

test('저널이 없으면 빈 칸을 그리지 않는다', () => {
  const out = render({ from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1 }] } }] });
  assert.ok(!out.includes('class="up-journal"'), '빈 저널 칸이 그려졌다');
});

test('터치 대상이 모바일 최소 크기(34px)를 지킨다', () => {
  const out = render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] });
  assert.match(out, /min-width:34px;min-height:34px/, '버튼이 너무 작다');
});

test('★ CSS 선택자가 실제 마크업의 클래스와 일치한다 (안 맞으면 스타일이 통째로 안 먹는다)', () => {
  // 실측으로 걸린 자리: CSS 는 `.up-row` 를 쓰는데 마크업은 `up-item` 이었다.
  // 스타일이 조용히 안 먹었고 테스트는 전부 초록이었다 — 미리보기 눈으로만 보였다.
  // 조건부로만 나오는 클래스(⚠·빈 목록)까지 덮으려면 여러 경우를 합쳐 봐야 한다.
  const cases = [
    render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] }),
    render({ from: '2026-08-16', days: 1, tracks: [{ key: 'papers', label: '논문',
      cadence: 'daily', mode: 'on', state: { queue: [{ pmid: '1', title: 't', score: 1, lowConfidence: true }] } }] }),
    render({ from: '2026-08-16', days: 1, tracks: [] }),
  ];
  const markup = new Set(cases.flatMap((h) => [...h.replace(/<style>[\s\S]*?<\/style>/, '')
    .matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))));
  const css = new Set([...(cases[0].match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '')
    .matchAll(/\.(up-[a-z-]+)/g)].map((m) => m[1]));
  for (const cls of css) {
    assert.ok(markup.has(cls), `CSS 에 .${cls} 가 있는데 어떤 경우에도 마크업에 안 나온다`);
  }
});

test('★ 예고할 것이 없으면 "없다" 고 말한다 (빈 화면은 고장과 구분이 안 된다)', () => {
  const out = render({ from: '2026-08-16', days: 7, tracks: [] });
  assert.match(out, /up-empty/);
  assert.match(out, /예고할 것이 없습니다/);
});

test('트랙이 전부 꺼져 있어도 빈 상태를 그린다', () => {
  const out = render({ from: '2026-08-16', days: 7,
    tracks: [{ ...oneTrack(), mode: 'off' }] });
  assert.match(out, /up-empty/);
});

// ── ★ 발행 경로 배선 회귀 ───────────────────────────────────────────────────
// 이 저장소는 **"모듈은 옳은데 아무도 안 부른다"** 로 두 번 데였다
// (지역 판정 모듈 · 예고 렌더). 유닛 테스트는 둘 다 초록이었다.
// 게다가 배선하면서 import 를 빠뜨려도 `node --check` 는 통과하고(ESM 은 미정의
// 식별자를 파싱 시점에 못 잡는다) 테스트도 그 경로를 안 타면 초록이다.
// 그래서 **실제로 호출해서** 터지지 않는지 본다.
test('★ 디스크에서 큐를 읽어 예고를 그리는 경로가 실제로 돈다 (import 누락 포함)', async () => {
  const p = new GitHubPublisher();
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-16T00:00:00Z');
  assert.match(out, /<!-- UPCOMING -->/, '예고 블록이 안 그려졌다');
  assert.match(out, /data-up-toggle/, '토글이 없다');
});

test('★ 큐 파일이 하나도 없어도 페이지는 나간다 (예고는 부가물이다)', async () => {
  const p = new GitHubPublisher();
  p._repoPath = '/tmp/존재하지-않는-경로-' + Date.now();
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-16T00:00:00Z');
  assert.match(out, /up-empty/, '빈 상태 안내가 없다');
});
