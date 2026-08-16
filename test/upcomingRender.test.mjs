import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

// ★ 3페이지 재구성(2026-08-16)으로 `_renderUpcoming` 이 **트랙 하나씩** 그리도록 바뀌었다.
//   각 페이지가 자기 트랙 블록만 맨 위에 들어야 하기 때문이다(PeterJ 요구 ②).
//   기존 테스트는 트랙 배열을 한 번에 넘겼으므로, 여기서 접어서 같은 뜻으로 만든다.
const renderAll = (pub, html, { from, days, tracks = [], sequential = false }) =>
  tracks.reduce((acc, t) => pub._renderUpcoming(acc, {
    from, days, sequential,
    track: t.key, label: t.label, cadence: t.cadence, mode: t.mode, state: t.state,
  }), html);

// ★ 이 저장소는 렌더가 **기존 내용을 지우는** 사고를 이미 한 번 냈다
// (GSECTION 8→7, 본문 679KB→572KB, LLM 이 뽑은 요약이 통째로 소실).
// 그래서 새 렌더는 **자기 블록만 갈아끼우고 나머지는 손대지 않는다**는 것을
// 실물 페이지로 못 박는다. 이 파일이 그 못이다.

const count = (html, re) => (html.match(re) || []).length;
const realHtml = () => readFile(new URL('../index.html', import.meta.url), 'utf8');
const render = (opts) => renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), '<!-- ARCHIVE_START -->', opts);
const oneTrack = () => ({ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
  state: { queue: [{ pmid: '1', title: '제목', journal: 'NEJM', score: 1 }] } });

const track = (key, label, cadence, mode, n) => ({
  key, label, cadence, mode,
  state: { queue: Array.from({ length: n }, (_, i) => ({
    pmid: `${key}${i}`, title: `${label} 후보 ${i}`, journal: 'J Test', score: 9 - i })) },
});

test('★ 실물 페이지에 예고를 그려도 기존 내용이 하나도 안 사라진다', async () => {
  const html = await realHtml();
  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  const out = renderAll(p, html, {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'on', 5)],
  });
  for (const [label, re] of [
    ['보관 섹션', /<details class="day/g],
    ['논문 표 행', /data-pmid=/g],
    ['읽음 체크박스', /class="readcb"/g],
  ]) {
    // ★ 기준값이 0이면 이 검사는 아무것도 지키지 않는다.
    //   실제로 그런 일이 있었다 — `data-guideline="1"` 로 재고 있었는데 그 행은
    //   페이지 분할로 guidelines.html 에 있어서 index.html 에는 0개였다.
    //   `0 >= 0` 이라 **행을 통째로 지우는 변이가 안 잡혔다.** 기준값부터 못 박는다.
    assert.ok(count(html, re) > 0, `${label} 기준값이 0이다 — 이 검사는 헛돈다`);
    assert.ok(count(out, re) >= count(html, re), `${label} 이 줄었다`);
  }
  // ★ 길이는 **예고 블록을 뺀 나머지**로 잰다.
  //   예고 블록은 설계상 매번 통째로 교체된다 — 트랙이 꺼지거나 큐가 짧아지면 블록이
  //   작아지는 게 정상이다. 전체 길이로 비교하면 그 정상 동작을 "본문이 줄었다" 로
  //   오판한다(실측: 실물 페이지에 블록이 이미 들어간 뒤 이 테스트가 빨개졌다).
  //   지켜야 할 것은 "예고 말고 나머지는 손대지 않는다" 이므로 그것만 잰다.
  // 구버전 마커(<!-- UPCOMING -->)도 함께 걷는다 — 렌더가 마이그레이션으로 그것을
  // 없애므로, 안 걷으면 "정상적인 구버전 제거" 를 "본문이 줄었다" 로 오판한다.
  const strip = (h) => h
    .replace(/<!-- UPCOMING:[a-z]+ -->[\s\S]*?<!-- \/UPCOMING:[a-z]+ -->/g, '')
    .replace(/<!-- UPCOMING -->[\s\S]*?<!-- \/UPCOMING -->/g, '');
  assert.ok(strip(out).length >= strip(html).length - 200,
    `예고 밖 본문이 줄었다 (${strip(html).length} → ${strip(out).length})`);
});

test('예고 블록이 실제로 들어간다', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
    from: '2026-08-16', days: 3,
    tracks: [track('papers', '논문', 'daily', 'on', 3)],
  });
  assert.match(out, /<!-- UPCOMING:papers -->/);
  assert.match(out, /논문 후보 0/);
});

test('★ 두 번 그려도 블록이 둘로 늘지 않는다 (멱등)', async () => {
  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  const args = { from: '2026-08-16', days: 3, tracks: [track('papers', '논문', 'daily', 'on', 3)] };
  const once = renderAll(p, await realHtml(), args);
  const twice = renderAll(p, once, { ...args, from: '2026-08-17' });
  assert.equal(count(twice, /<!-- UPCOMING:papers -->/g), 1);
  // ★ 페이지 본문에는 오늘 날짜가 여기저기 박혀 있다(데일리가 찍는다).
  //   그래서 전체 문서가 아니라 **예고 블록 안에서만** 검사해야 한다 —
  //   안 그러면 코드가 멀쩡해도 빨개진다(처음에 그렇게 짰다가 걸렸다).
  const blockOf = (h) => h.match(/<!-- UPCOMING:papers -->[\s\S]*?<!-- \/UPCOMING:papers -->/)?.[0] ?? '';
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
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), html, {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'off', 5)],   // 전부 off
  });
  assert.equal(count(out, /<!-- UPCOMING:papers -->/g), 1, '블록이 사라졌다');
  assert.match(out, /data-up-toggle/, '다시 켤 토글이 없다');
  assert.match(out, /up-empty/, '비었다는 안내가 없다');
});

test('off 인 트랙은 "꺼짐" 으로 표시되고 항목은 안 나온다', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
    from: '2026-08-16', days: 7,
    tracks: [track('papers', '논문', 'daily', 'off', 3), track('reviews', '리뷰', 'weekly', 'on', 2)],
  });
  assert.doesNotMatch(out, /논문 후보 0/, 'off 인데 항목이 나왔다');
  assert.match(out, /리뷰 후보 0/);
});

test('★ 제목의 HTML 특수문자가 이스케이프된다 (LLM·외부 입력이 들어오는 자리다)', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: '<img src=x onerror=alert(1)>', journal: 'J&J', score: 1 }] } }],
  });
  assert.doesNotMatch(out, /<img src=x/, '태그가 그대로 들어갔다');
  assert.match(out, /&lt;img/);
  assert.match(out, /J&amp;J/);
});

test('lowConfidence 항목에 ⚠ 가 붙는다 (계산만 되고 출구가 없던 값)', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: '약한 날', score: 1, lowConfidence: true }] } }],
  });
  assert.match(out, /⚠/);
});

test('항목마다 삭제·구동 버튼이 붙는다', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
    from: '2026-08-16', days: 2,
    tracks: [track('papers', '논문', 'daily', 'on', 2)],
  });
  assert.equal(count(out, /data-up-drop=/g), 2, '삭제 버튼이 항목 수만큼');
  assert.equal(count(out, /data-up-run=/g), 2, '구동 버튼이 항목 수만큼');
});

test('트랙마다 온오프 토글 버튼이 하나씩 붙는다', async () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), await realHtml(), {
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
  assert.ok(out.indexOf('<style>') < out.indexOf('<details class="upcoming"'),
    '스타일이 섹션보다 뒤에 있다');
});

// ★ 계약 변경 (PeterJ 지시 2026-08-17) — **제목을 자르지 않는다.**
//   종전에는 66자에서 잘랐는데, 그러면 무엇에 대한 지침인지가 잘려 나가
//   🗑 를 누를지 말지를 판단할 수 없다. 길어지는 문제는 블록 접힘으로 푼다.
test('★ 긴 제목이 잘리지 않고 전부 나온다 (삭제 판단에 필요)', () => {
  const long = '가'.repeat(300);
  const out = render({ from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: long, journal: 'J', score: 1 }] } }] });
  // 라벨(up-track)이 제목 span 안에 들어 있으므로 라벨 뒤부터 본다.
  const inner = out.match(/<span class="up-title"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="up-journal"|<button)/)?.[1] ?? '';
  const shown = inner.replace(/<span class="up-track">[^<]*<\/span>\s*/, '').replace(/<[^>]*>/g, '').trim();
  assert.equal(shown, long, `제목이 잘렸다 (${shown.length}자 / 원문 ${long.length}자)`);
  assert.ok(out.includes(`title="${long}"`), '전문이 title 속성에 없다');
  // 잘리지 않으므로 CSS 가 줄바꿈을 허용해야 한다 — 안 그러면 가로 스크롤이 생긴다
  assert.match(out, /\.up-title\{[^}]*overflow-wrap:anywhere/, '긴 제목 줄바꿈 규칙이 없다');
});

test('저널이 없으면 빈 칸을 그리지 않는다', () => {
  const out = render({ from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1 }] } }] });
  assert.ok(!out.includes('class="up-journal"'), '빈 저널 칸이 그려졌다');
});

test('터치 대상이 모바일 최소 크기(34px)를 지킨다', () => {
  const out = render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] });
  assert.match(out, /min-width:38px;min-height:38px/, '버튼이 너무 작다');
});

test('★ CSS 선택자가 실제 마크업의 클래스와 일치한다 (안 맞으면 스타일이 통째로 안 먹는다)', () => {
  // 실측으로 걸린 자리: CSS 는 `.up-row` 를 쓰는데 마크업은 `up-item` 이었다.
  // 스타일이 조용히 안 먹었고 테스트는 전부 초록이었다 — 미리보기 눈으로만 보였다.
  // 조건부로만 나오는 클래스(⚠·빈 목록)까지 덮으려면 여러 경우를 합쳐 봐야 한다.
  const cases = [
    render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] }),
    render({ from: '2026-08-16', days: 1, tracks: [{ key: 'papers', label: '논문',
      cadence: 'daily', mode: 'on', state: { queue: [{ pmid: '1', title: 't', score: 1, lowConfidence: true }] } }] }),
    // 빈 상태(.up-empty)를 덮는다. 트랙별 렌더로 바뀐 뒤로는 "트랙 배열이 비었다" 가
    // 아니라 **큐가 비었다** 가 그 자리를 대신한다.
    render({ from: '2026-08-16', days: 1,
      tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: { queue: [] } }] }),
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
  const out = render({ from: '2026-08-16', days: 7,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on', state: { queue: [] } }] });
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
  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-16T00:00:00Z');
  // ★ 세 트랙이 **각자** 블록을 갖는다(PeterJ 요구 ② — 각 페이지 맨 위).
  //   하나라도 빠지면 그 페이지는 예고 없이 나간다.
  for (const key of ['papers', 'guidelines', 'reviews']) {
    assert.match(out, new RegExp(`<!-- UPCOMING:${key} -->`), `${key} 예고 블록이 안 그려졌다`);
  }
  assert.match(out, /data-up-toggle/, '토글이 없다');
  assert.match(out, /data-up-seq/, '순차진행 토글이 없다');
});

test('★ 큐 파일이 하나도 없어도 페이지는 나간다 (예고는 부가물이다)', async () => {
  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  p._repoPath = '/tmp/존재하지-않는-경로-' + Date.now();
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-16T00:00:00Z');
  assert.match(out, /up-empty/, '빈 상태 안내가 없다');
});


/**
 * ★ 2026-08-16 실측 결함 — `publish()` 는 `generatedAt` 으로 **한국어 로케일 문자열**
 *   ("2026. 08. 16. 22:45")을 넘긴다. 종전 코드는 그것을 `.slice(0, 10)` 해서
 *   "2026. 08. 1" 을 날짜로 썼고, `addDays` 가 던진 예외를 `publish()` 의 try/catch 가
 *   삼켜 **예고 블록이 통째로 빠진 페이지가 조용히 나갔다.**
 *   빈 문자열이 아니라서 `|| 오늘` 폴백도 안 걸렸다 — "폴백이 있는데 안 도는" 부류다.
 */
test('★ publish 가 넘기는 한국어 로케일 시각으로도 예고가 그려진다', async () => {
  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  // publish() 안의 표현을 그대로 재현한다 — 형식이 바뀌면 여기서 같이 깨져야 한다.
  const generatedAt = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', generatedAt);
  assert.match(out, /<!-- UPCOMING:papers -->/, '예고 블록이 안 그려졌다');
  assert.doesNotMatch(out, /Invalid Date|NaN/, '날짜 계산이 깨졌다');
});


/**
 * ★ 코드리뷰 실측 — 가이드라인 예고가 큐 배열 **전체**를 그렸는데, 오케스트레이터는
 *   `status === 'queued'` 인 것 중 priority 순으로 고른다. 실물 큐가
 *   `needsReview 5 · queued 1` 이라 **화면은 검토 대기 항목이 오늘 나간다고 말하고
 *   실제로는 다른 것이 나갔다.** 결함 B2 와 같은 부류다.
 */
test('★ 가이드라인 예고는 실제 발행 대상(queued)만 보여준다', async () => {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const nodePath = (await import('node:path')).default;

  const dir = await mkdtemp(nodePath.join(tmpdir(), 'tr-up-'));
  await mkdir(nodePath.join(dir, 'output'), { recursive: true });
  await writeFile(nodePath.join(dir, 'output', 'selected_guidelines.json'), JSON.stringify({
    schemaVersion: 2,
    queue: [
      { id: 'a', pmid: 'a', title: '검토 대기 지침', status: 'needsReview', priority: 99 },
      { id: 'b', pmid: 'b', title: '실제로 나갈 지침', status: 'queued', priority: 5 },
    ],
    published: [], rejected: [],
  }));

  const p = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  const out = await p._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-17');
  const block = out.match(/<!-- UPCOMING:guidelines -->[\s\S]*?<!-- \/UPCOMING:guidelines -->/)[0];
  assert.ok(block.includes('실제로 나갈 지침'), '발행 대상이 예고에 없다');
  assert.equal(block.includes('검토 대기 지침'), false,
    '검토 대기 항목을 오늘 나간다고 예고했다 — 화면이 거짓말한다');
});


/**
 * ★ PeterJ 지시 2026-08-17 — 예고 리스트도 **기본 접힘**이다.
 *   논문이 누적되면 목록이 길어져 불편하다. 카드·누적표와 같은 규칙으로 통일한다.
 */
test('★ 예고 블록은 접힘이 기본이다', () => {
  const out = render({ from: '2026-08-16', days: 3, tracks: [track('papers', '논문', 'daily', 'on', 3)] });
  assert.match(out, /<details class="upcoming"/, '예고가 접힘 블록이 아니다');
  assert.doesNotMatch(out, /<details open class="upcoming"/, '예고가 펼쳐진 채로 나갔다');
  // 접혀 있어도 몇 건인지는 보여야 한다 — 안 그러면 열어봐야 빈지 아닌지를 안다
  assert.match(out, /<span class="n">3건<\/span>/, '접힌 상태에서 건수가 안 보인다');
});

/**
 * ★ 2026-08-17 실측 — 기기가 다크모드면 `.up-day{color:#d1d5db}`(다크 규칙)를
 *   제목이 **상속**해 흰 바탕에 흰 글씨가 됐다. 이 페이지는 배경이 라이트 전용이라
 *   다크 규칙 자체가 성립하지 않는다. 제목은 자기 색을 명시해야 한다.
 */
test('★ 제목이 자기 색을 갖는다 (상속에 맡기면 다크모드에서 안 보인다)', () => {
  const out = render({ from: '2026-08-16', days: 1, tracks: [oneTrack()] });
  const css = out.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.up-title\{[^}]*color:#/, '.up-title 에 색이 없다 — 상속되면 다크모드에서 사라진다');
  assert.equal(/prefers-color-scheme:\s*dark/.test(css), false,
    '라이트 전용 페이지에 다크 규칙이 있다 — 흰 바탕에 흰 글씨가 난다');
});
