/**
 * pageSplit — 배포 페이지 3분할(§4-H)의 서버측 계약 검증.
 *
 * ★ 2026-08-16 에 2 → 3 페이지로 바뀌었다(PeterJ 요구 ①):
 *     index.html = 논문 · guidelines.html = 가이드라인 · reviews.html = 리뷰 · 기타
 *   "기타(참고자료)" 가 가이드라인 쪽에서 **리뷰 쪽으로 옮겨간다.**
 *
 * 잠그는 것 셋:
 *  ① **손실 0** — 가른 뒤 카드·행의 합이 원본과 같다(과거 저널명이 배포 HTML 에만
 *    있으므로, 여기서 새면 복구 불가다).
 *  ② **왕복 안정** — split → merge → split 이 같은 결과를 낸다. publish() 가 매일
 *    이 왕복을 돌기 때문에, 어긋나면 카드가 매일 늘거나 사라진다.
 *  ③ **구본 마이그레이션** — data-kind 없는 구 행도 참고자료 식별자로 갈린다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPages, mergePages, ensureTowerTone, pageNav } from '../src/utils/pageSplit.js';

const REF_ID = '999';

function samplePage() {
  return `<!DOCTYPE html>
<html lang="ko"><head><title>EM/CCM Trend Review</title><style>x{}</style></head>
<body>
<div class="wrap">
  <header class="hd"><div class="ey">E</div><h1>EM/CCM Trend Review</h1>
    <div class="fn">180일 · 300편 스크리닝 → 1편/일 선정</div>
  </header>
  <div class="stats">
    <div class="sc"><div class="n stat-days-count">2</div><div class="l">분석일수</div></div>
    <div class="sc"><div class="n stat-papers-count">2</div><div class="l">선정 논문</div></div>
    <div class="sc"><div class="n"><span class="stat-updated-time">2026. 08. 08. 07:08</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <div class="archive">
<!-- ARCHIVE_START -->
<!-- SECTION:2026-08-08 -->
<details class="day day-today"><article class="paper-card">P1</article></details>
<!-- /SECTION:2026-08-08 -->
<!-- SECTION:2026-08-07 -->
<details class="day day-past"><article class="paper-card">P2</article></details>
<!-- /SECTION:2026-08-07 -->
<!-- GSECTION:2026-08-04 -->
<details class="day day-past"><summary><span class="gl-tag">📋 가이드라인</span></summary><article class="guideline-card"><span class="chip gl">📋 가이드라인</span>G1</article></details>
<!-- /GSECTION:2026-08-04 -->
<!-- GSECTION:2026-08-07-m-999 -->
<details class="day day-past"><summary><span class="gl-tag">📋 가이드라인</span></summary><article class="guideline-card"><span class="chip gl">🔖 참고자료</span>R1</article></details>
<!-- /GSECTION:2026-08-07-m-999 -->
<!-- RSECTION:2026-08-06 -->
<details class="day day-past"><summary><span class="gl-tag">📰 리뷰</span></summary><article class="guideline-card">V1</article></details>
<!-- /RSECTION:2026-08-06 -->
  </div>
  <div class="arch-table">
    <div class="at-head"><span class="at-title">📚 누적 아카이브</span><span class="at-count">2편</span></div>
    <div class="at-scroll"><table>
      <thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
      <tbody><!-- TABLE_ROWS_START --><tr data-pmid="111"><td class="c-date">2026-08-08</td><td class="c-jour">NEJM</td><td class="c-title"><a href="#">P1</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="222"><td class="c-date">2026-08-07</td><td class="c-jour">JAMA</td><td class="c-title"><a href="#">P2</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="333" data-guideline="1"><td class="c-date">2026-08-04</td><td class="c-jour">📋 IDSA</td><td class="c-title"><a href="#">G1</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="${REF_ID}" data-guideline="1"><td class="c-date">2026-08-07</td><td class="c-jour">📋 NEJM</td><td class="c-title"><a href="#">R1</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="444" data-kind="review"><td class="c-date">2026-08-06</td><td class="c-jour">📰 Lancet</td><td class="c-title"><a href="#">V1</a></td><td class="c-read"><input class="readcb"></td></tr><!-- TABLE_ROWS_END --></tbody>
    </table></div>
  </div>
  <!-- ARCHIVE_STATUS v1 -->
<div class="as-wrap">현황</div>
<!-- /ARCHIVE_STATUS -->
  <div class="ft">footer</div>
</div>
</body></html>`;
}

const refIds = new Set([REF_ID]);
const count = (s, re) => (s.match(re) ?? []).length;
const ROWS = /<tr [^>]*data-pmid=/g;

test('가른 뒤 카드가 손실 없이 세 페이지에 나뉜다', () => {
  const { index, guidelines, reviews, counts } = splitPages(samplePage(), { refIds });
  assert.equal(counts.papers, 2);
  assert.equal(counts.guidelines, 1);
  assert.equal(counts.others, 1);
  assert.equal(counts.reviews, 1);
  // 논문은 index 에만
  assert.equal(count(index, /<!-- SECTION:/g), 2);
  assert.equal(count(index, /<!-- GSECTION:/g), 0);
  assert.equal(count(index, /<!-- RSECTION:/g), 0);
  // 가이드라인 페이지에는 가이드 카드 하나뿐 — **기타는 여기 없다**(리뷰 쪽으로 갔다)
  assert.equal(count(guidelines, /<!-- GSECTION:/g), 1);
  assert.equal(count(guidelines, /🔖 참고자료/g), 0);
  // 리뷰 페이지에 리뷰 + 기타
  assert.equal(count(reviews, /<!-- RSECTION:/g), 1);
  assert.equal(count(reviews, /<!-- GSECTION:/g), 1);
});

test('표 행도 손실 0 — 원본 5행이 2/1/2 로 갈린다', () => {
  const before = count(samplePage(), ROWS);
  const { index, guidelines, reviews, counts } = splitPages(samplePage(), { refIds });
  assert.equal(before, 5);
  assert.equal(counts.paperRows, 2);
  assert.equal(counts.guidelineRows, 1);
  assert.equal(counts.referenceRows, 1);
  assert.equal(counts.reviewRows, 1);
  // ★ 세 페이지를 **전부** 더해야 한다. 2페이지 시절 식(index+guidelines)을 그대로
  //   두면 리뷰·기타 행이 통째로 사라져도 합이 맞아 초록이 된다.
  assert.equal(count(index, ROWS) + count(guidelines, ROWS) + count(reviews, ROWS), before);
});

test('구본 행(data-kind 없음)도 참고자료 식별자로 갈린다 — 마이그레이션', () => {
  const { guidelines, reviews } = splitPages(samplePage(), { refIds });
  // ★ 참고자료 행은 이제 **reviews.html** 로 간다(3분할). guidelines 에는 없어야 한다.
  assert.equal(count(guidelines, new RegExp(`data-pmid="${REF_ID}"`, 'g')), 0,
    '참고자료 행이 가이드라인 페이지에 남았다');
  const refRow = reviews.match(new RegExp(`<tr[^>]*data-pmid="${REF_ID}"[^>]*>[\\s\\S]*?</tr>`))[0];
  assert.match(refRow, /data-kind="reference"/);
  assert.match(refRow, /🔖 NEJM/);
  assert.doesNotMatch(refRow, /📋 NEJM/);
});

test('refIds 없이도 data-kind 가 있으면 그것으로 갈린다', () => {
  const once = splitPages(samplePage(), { refIds });
  // 두 번째 판정은 refIds 를 주지 않는다 — 첫 판정이 심은 data-kind 만으로 갈려야 한다.
  const merged = mergePages(once.index, once.guidelines, once.reviews);
  const twice = splitPages(merged, { refIds: null });
  assert.equal(twice.counts.referenceRows, 1);
  assert.equal(twice.counts.guidelineRows, 1);
  assert.equal(twice.counts.paperRows, 2);
});

test('왕복 안정 — split → merge → split 이 같은 개수를 낸다', () => {
  const a = splitPages(samplePage(), { refIds });
  const merged = mergePages(a.index, a.guidelines, a.reviews);
  const b = splitPages(merged, { refIds });
  assert.deepEqual(b.counts, a.counts);
  // 3회차까지 흔들리지 않는다(매일 도는 경로다)
  const c = splitPages(mergePages(b.index, b.guidelines, b.reviews), { refIds });
  assert.deepEqual(c.counts, a.counts);
});

test('없는 페이지는 건너뛴다 — 첫 실행/마이그레이션', () => {
  const src = samplePage();
  // 예고 블록이 없는 입력이므로 strip 은 아무것도 안 바꾼다 = 원본 그대로여야 한다.
  assert.equal(mergePages(src, null, null), src);
  assert.equal(mergePages(src, '', ''), src);
  assert.equal(mergePages(src, '<html>스캐폴드 아님</html>', null), src);
});

test('참고자료 섹션의 접힌 헤더 라벨이 기타 자료로 교정된다', () => {
  const { guidelines, reviews } = splitPages(samplePage(), { refIds });
  const refBlock = reviews.match(/<!-- GSECTION:2026-08-07-m-999 -->[\s\S]*?<!-- \/GSECTION:2026-08-07-m-999 -->/)[0];
  assert.match(refBlock, /<span class="gl-tag ref">🔖 기타 자료<\/span>/);
  assert.doesNotMatch(refBlock, /<span class="gl-tag">📋 가이드라인<\/span>/);
  // 가이드라인 섹션은 종전 라벨 유지
  const glBlock = guidelines.match(/<!-- GSECTION:2026-08-04 -->[\s\S]*?<!-- \/GSECTION:2026-08-04 -->/)[0];
  assert.match(glBlock, /<span class="gl-tag">📋 가이드라인<\/span>/);
});

test('세 페이지가 같은 탭 바를 갖고 현재 페이지만 활성 — 대등한 병렬 페이지', () => {
  const { index, guidelines, reviews } = splitPages(samplePage(), { refIds });
  for (const p of [index, guidelines, reviews]) {
    assert.equal(count(p, /<nav class="pgnav">/g), 1);
    assert.match(p, /href="index\.html"/);
    assert.match(p, /href="guidelines\.html"/);
    assert.match(p, /href="reviews\.html"/);
  }
  assert.match(index, /<a href="index\.html" class="on"/);
  assert.match(guidelines, /<a href="guidelines\.html" class="on"/);
  assert.match(reviews, /<a href="reviews\.html" class="on"/);
  // 같은 히어로를 쓴다(제목을 바꾸면 하위 페이지처럼 보인다)
  assert.match(guidelines, /<h1>EM\/CCM Trend Review<\/h1>/);
});

test('guidelines 통계는 자기 것이고 index 통계 클래스를 물려받지 않는다', () => {
  const { guidelines } = splitPages(samplePage(), { refIds });
  assert.equal(count(guidelines, /class="sc"/g), 3); // 원본 카드 잔존(중복) 회귀 방지
  assert.doesNotMatch(guidelines, /stat-days-count/);
  assert.doesNotMatch(guidelines, /stat-papers-count/);
  assert.match(guidelines, /<div class="l">가이드라인<\/div>/);
});

test('아카이브 저장 현황(§4-E)은 index 에만 남는다', () => {
  const { index, guidelines } = splitPages(samplePage(), { refIds });
  assert.match(index, /ARCHIVE_STATUS v1/);
  assert.doesNotMatch(guidelines, /ARCHIVE_STATUS v1/);
});

test('타워 톤은 원본 스타일 뒤에 한 번만 얹힌다', () => {
  const once = ensureTowerTone(samplePage());
  assert.equal(count(once, /id="tower-tone"/g), 1);
  assert.equal(ensureTowerTone(once), once); // 멱등
  // 원본 <style> 보다 뒤에 와야 이긴다
  assert.ok(once.indexOf('id="tower-tone"') > once.indexOf('<style>x{}</style>'));
});

test('스캐폴드가 아니면 가르지 않는다(소프트)', () => {
  const r = splitPages('<html>없음</html>', { refIds });
  assert.equal(r.guidelines, null);
  assert.equal(r.index, '<html>없음</html>');
});

test('pageNav 는 건수를 그대로 노출한다', () => {
  const nav = pageNav('papers', { papers: 35, guidelines: 6, others: 1, reviews: 4 });
  assert.match(nav, /35편/);
  assert.match(nav, /6건/);
  assert.match(nav, /4 · 1건/);
  assert.equal(count(nav, /<a href=/g), 3, '탭이 셋이어야 한다');
});

/**
 * ★ 속성 순서 계약 — 이게 깨지면 데일리가 조용히 깨진다(행 중복 누적).
 * publish() 의 같은-날짜 행 교체는 `<tr data-pmid="[^"]*"><td class="c-date">…` 로
 * 잡는다. 논문 행에 속성이 하나라도 더 붙으면 매치가 사라진다.
 */
test('논문 행은 바이트 그대로 — 마커를 붙이지 않는다(같은 날 재실행 안전)', () => {
  const { index } = splitPages(samplePage(), { refIds });
  assert.doesNotMatch(index, /data-kind="paper"/);
  // 데일리가 쓰는 바로 그 정규식으로 잡히는지 직접 확인한다
  const dailyRe = /<tr data-pmid="[^"]*"><td class="c-date">2026-08-08<\/td>[\s\S]*?<\/tr>/g;
  assert.equal(count(index, dailyRe), 1);
});

test('가이드·리뷰·기타 행의 data-pmid 는 첫 속성으로 남는다(삭제 패치 계약)', () => {
  const { guidelines, reviews } = splitPages(samplePage(), { refIds });
  for (const page of [guidelines, reviews]) {
    for (const m of page.matchAll(/<tr ([^>]*)>/g)) {
      assert.match(m[1], /^data-pmid="/, `data-pmid 가 첫 속성이 아님: <tr ${m[1]}>`);
    }
  }
  // curation.js 의 삭제 패치 정규식으로도 잡혀야 한다
  assert.match(reviews, new RegExp(`<tr data-pmid="${REF_ID}"[^>]*>[\\s\\S]*?</tr>`));
});

/**
 * 회귀 — `this.logger` 미설정으로 push 실패 폴백이 첫 줄에서 죽던 문제.
 * 생성자가 logger 를 안 넣어 `this.logger.warn(...)` 이 TypeError 를 던졌고,
 * 그래서 Contents API 폴백(상태 JSON 업로드 포함)이 한 번도 실행될 수 없었다.
 */
test('퍼블리셔는 로거 없이 생성해도 로그 호출이 죽지 않는다', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const pub = new GitHubPublisher({ token: 't', owner: 'o', repo: 'r' });
  assert.equal(typeof pub.logger?.info, 'function');
  assert.equal(typeof pub.logger?.warn, 'function');
  assert.doesNotThrow(() => pub.logger.warn('x', { a: 1 }));
  assert.doesNotThrow(() => pub.logger.info('x'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 코드리뷰(2026-08-08 high) 지적 회귀 — 전부 "조용히 망가지는" 종류다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 2회차 발행부터 guidelines 통계가 index 것으로 되돌아가던 문제.
 * 통계 교체 정규식은 `</div><div class="archive">` 를 찾는데, 2회차부터는 그 사이에
 * 지난 실행이 심은 <nav class="pgnav"> 가 끼어 매치가 조용히 실패했다.
 * 종전 왕복 테스트는 **개수만** 셌기 때문에 이걸 못 잡았다 — 문구를 본다.
 */
test('2회차 이후에도 guidelines 통계가 자기 것으로 유지된다', () => {
  const a = splitPages(samplePage(), { refIds });
  let idx = a.index, gui = a.guidelines, rev = a.reviews;
  for (let i = 0; i < 3; i++) {
    const r = splitPages(mergePages(idx, gui, rev), { refIds });
    idx = r.index; gui = r.guidelines; rev = r.reviews;
    assert.match(gui, /<div class="l">가이드라인<\/div>/, `${i + 2}회차에서 통계가 되돌아감`);
    assert.match(rev, /<div class="l">기타 자료<\/div>/);
    assert.doesNotMatch(gui, /stat-days-count/);
    assert.doesNotMatch(gui, /stat-papers-count/);
    assert.doesNotMatch(gui, /<div class="l">분석일수<\/div>/);
    assert.equal(count(gui, /class="sc"/g), 3);
    assert.equal(count(gui, /<nav class="pgnav">/g), 1); // 탭도 누적되지 않는다
    assert.equal(count(idx, /<nav class="pgnav">/g), 1);
    assert.equal(count(rev, /<nav class="pgnav">/g), 1);
  }
});

/**
 * ★ ARCHIVE_STATUS 마커가 없을 때 표 전체가 두 페이지에 복제되던 문제.
 * 경계를 `indexOf('</div>')` 로 폴백하면 표 **안쪽** div 를 잡는다.
 * 이제는 컨테이너를 균형 계산으로 닫는다.
 */
test('아카이브 현황 블록이 없어도 표가 복제되지 않는다', () => {
  const noStatus = samplePage().replace(/<!-- ARCHIVE_STATUS v1 -->[\s\S]*?<!-- \/ARCHIVE_STATUS -->/, '');
  const before = count(noStatus, ROWS);
  const { index, guidelines, reviews } = splitPages(noStatus, { refIds });
  assert.equal(before, 5);
  assert.equal(count(index, ROWS) + count(guidelines, ROWS) + count(reviews, ROWS), before);
  assert.equal(count(index, /<div class="arch-table">/g), 1);
  assert.equal(count(guidelines, /<div class="arch-table">/g), 1);   // 가이드라인 하나
  assert.equal(count(reviews, /<div class="arch-table">/g), 2);      // 리뷰 + 기타
});

/** 현황 블록 버전이 올라도(v1→v2) guidelines 에서 제거된다. */
test('아카이브 현황 제거가 버전에 묶여 있지 않다', () => {
  const v2 = samplePage().replace('<!-- ARCHIVE_STATUS v1 -->', '<!-- ARCHIVE_STATUS v2 -->');
  const { index, guidelines } = splitPages(v2, { refIds });
  assert.match(index, /ARCHIVE_STATUS v2/);
  assert.doesNotMatch(guidelines, /ARCHIVE_STATUS/);
});

/**
 * ★ 행 HTML 에 `$&`·`` $` `` 가 있으면 문자열 치환이 특수 패턴으로 해석해 본문이 깨진다.
 * esc() 는 `$` 를 건드리지 않으므로 논문 제목에 실제로 들어올 수 있다.
 */
test('행 제목에 $& 가 있어도 병합이 본문을 망가뜨리지 않는다', () => {
  const EVIL_TITLE = '비용 $& 효과 $` 분석';
  // ⚠ 픽스처를 만들 때도 함수형 replacer 를 써야 한다 — 문자열로 쓰면 여기서부터
  //   `$&`·`` $` `` 가 펼쳐져 픽스처가 이미 망가진다(실제로 4행 → 7행이 됐다).
  //   이 한 줄이 이 테스트가 막으려는 위험 그 자체다.
  const evil = samplePage().replace('<a href="#">G1</a>', () => `<a href="#">${EVIL_TITLE}</a>`);
  assert.equal(count(evil, ROWS), 5, '픽스처가 이미 훼손됨');
  const a = splitPages(evil, { refIds });
  const merged = mergePages(a.index, a.guidelines, a.reviews);
  assert.equal(count(merged, ROWS), 5);
  assert.ok(merged.includes(EVIL_TITLE), '치환으로 제목이 훼손됨');
  const b = splitPages(merged, { refIds });
  assert.deepEqual(b.counts, a.counts);
});


/**
 * ★ 2026-08-17 실측 사고 — `ensureTowerTone` 이 "이미 있으면 그대로" 라서
 *   새로 넣은 CSS 규칙(.past-fold)이 **배포본에 영원히 안 들어갔다.** 화면에는
 *   스타일 없는 맨몸으로 나왔고 테스트는 전부 초록이었다(단위 테스트는 늘 새 페이지를 만든다).
 *   이제 버전 마커로 갈아끼운다 — **CSS 를 고치면 TOWER_TONE_VERSION 을 올려야 한다.**
 */
test('★ 구버전 타워 톤은 통째로 갈아끼운다 (새 CSS 가 배포본에 들어간다)', async () => {
  const { TOWER_TONE_VERSION } = await import('../src/utils/pageSplit.js');
  const old = '<html><head><style id="tower-tone">.old{color:red}</style></head><body></body></html>';
  const out = ensureTowerTone(old);
  assert.equal(count(out, /<style id="tower-tone"/g), 1, '스타일이 둘로 늘었다');
  assert.equal(out.includes('.old{color:red}'), false, '구버전 규칙이 남았다');
  assert.ok(out.includes(`data-v="${TOWER_TONE_VERSION}"`), '버전 마커가 없다');
  assert.match(out, /\.past-fold\{/, '새 규칙이 안 들어갔다');
});

test('★ 같은 버전이면 건드리지 않는다 (멱등)', async () => {
  const once = ensureTowerTone('<html><head></head><body></body></html>');
  assert.equal(ensureTowerTone(once), once, '같은 버전인데 다시 썼다');
});

test('★ 배포된 세 페이지가 모두 최신 타워 톤을 갖는다', async () => {
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { TOWER_TONE_VERSION } = await import('../src/utils/pageSplit.js');
  let checked = 0;
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    const url = new URL(`../${f}`, import.meta.url);
    if (!existsSync(url)) continue;
    const html = await readFile(url, 'utf8');
    assert.ok(html.includes(`data-v="${TOWER_TONE_VERSION}"`),
      `${f} 의 타워 톤이 낡았다 — 새 CSS 가 화면에 안 먹는다`);
    checked += 1;
  }
  assert.ok(checked >= 3, `검사한 페이지가 ${checked}개다 — 이 검사는 헛돈다`);
});


/**
 * ★ 2026-08-17 실측 사고 — TOWER_TONE 이 **문자열이 아니라 `true` 였다.**
 *   주석에 백틱(`)을 하나 넣는 순간 템플릿 리터럴이 거기서 끝나고 나머지가 식으로
 *   해석돼 boolean 이 됐다. `node --check` 는 **문법상 유효해서 통과**하고,
 *   `ensureTowerTone` 은 구버전을 걷어낸 뒤 빈 것을 끼워 넣어 **배포 페이지의 스타일이
 *   통째로 사라졌다**(각 페이지 -6.5KB). 이 저장소의 CSS 는 전부 이런 템플릿이라
 *   같은 사고가 언제든 재발한다.
 */
test('★ 타워 톤은 문자열이고 스타일 태그로 닫힌다 (백틱 사고 방지)', async () => {
  const { TOWER_TONE, TOWER_TONE_VERSION } = await import('../src/utils/pageSplit.js');
  assert.equal(typeof TOWER_TONE, 'string', 'TOWER_TONE 이 문자열이 아니다 — 템플릿이 조기 종료됐다');
  assert.ok(TOWER_TONE.length > 1000, `너무 짧다 (${TOWER_TONE.length}자) — 중간에 끊겼다`);
  assert.match(TOWER_TONE, /^<style id="tower-tone" data-v="\d+">/);
  assert.match(TOWER_TONE, /<\/style>$/, '스타일 태그가 안 닫혔다');
  assert.ok(TOWER_TONE.includes(`data-v="${TOWER_TONE_VERSION}"`),
    '마커 버전과 상수가 어긋났다 — 갈아끼우기가 영영 안 돈다');
});

test('★ 톤을 얹으면 페이지가 줄지 않는다 (빈 것을 끼워 넣지 않는다)', async () => {
  const before = '<html><head><style id="tower-tone" data-v="1">.x{}</style></head><body>본문</body></html>';
  const after = ensureTowerTone(before);
  assert.ok(after.length > before.length, `본문이 줄었다: ${before.length} → ${after.length}`);
  assert.match(after, /<style id="tower-tone" data-v="\d+">[\s\S]+<\/style>\s*<\/head>/,
    '스타일이 head 안에 안 들어갔다');
});

/**
 * ★ PeterJ 지적 2026-08-17 — "지난 논문" 묶음을 열면 **날짜만 남고 제목이 사라졌다.**
 *   원본 CSS 의 details[open] .day-prev 는 자손 선택자라, 바깥 묶음이 열리면
 *   안쪽 **닫힌** 카드들의 미리보기까지 숨겼다. "그래야 찾아 들어가지."
 */
test('★ 지난 묶음을 열어도 안쪽 카드 제목은 보인다', async () => {
  const { TOWER_TONE } = await import('../src/utils/pageSplit.js');
  // ① 넓은 규칙을 되돌린다
  assert.match(TOWER_TONE, /details\[open\] \.day-prev\{display:flex\}/,
    '자손 선택자 규칙을 안 되돌렸다 — 묶음을 열면 제목이 통째로 사라진다');
  // ② 자기 카드가 열렸을 때만 숨긴다 (자식 결합자)
  assert.match(TOWER_TONE, /details\.day\[open\] > summary \.day-prev\{display:none\}/,
    '자기 카드 열림 시 숨김 규칙이 없다 — 펼친 카드에 제목이 두 번 나온다');
});
