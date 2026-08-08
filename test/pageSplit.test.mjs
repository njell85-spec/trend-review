/**
 * pageSplit — 배포 페이지 2분할(§4-H)의 서버측 계약 검증.
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
  </div>
  <div class="arch-table">
    <div class="at-head"><span class="at-title">📚 누적 아카이브</span><span class="at-count">2편</span></div>
    <div class="at-scroll"><table>
      <thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
      <tbody><!-- TABLE_ROWS_START --><tr data-pmid="111"><td class="c-date">2026-08-08</td><td class="c-jour">NEJM</td><td class="c-title"><a href="#">P1</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="222"><td class="c-date">2026-08-07</td><td class="c-jour">JAMA</td><td class="c-title"><a href="#">P2</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="333" data-guideline="1"><td class="c-date">2026-08-04</td><td class="c-jour">📋 IDSA</td><td class="c-title"><a href="#">G1</a></td><td class="c-read"><input class="readcb"></td></tr><tr data-pmid="${REF_ID}" data-guideline="1"><td class="c-date">2026-08-07</td><td class="c-jour">📋 NEJM</td><td class="c-title"><a href="#">R1</a></td><td class="c-read"><input class="readcb"></td></tr><!-- TABLE_ROWS_END --></tbody>
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

test('가른 뒤 카드가 손실 없이 두 페이지에 나뉜다', () => {
  const { index, guidelines, counts } = splitPages(samplePage(), { refIds });
  assert.equal(counts.papers, 2);
  assert.equal(counts.guidelines, 1);
  assert.equal(counts.others, 1);
  // index 에는 논문만, guidelines 에는 가이드·기타만
  assert.equal(count(index, /<!-- SECTION:/g), 2);
  assert.equal(count(index, /<!-- GSECTION:/g), 0);
  assert.equal(count(guidelines, /<!-- SECTION:/g), 0);
  assert.equal(count(guidelines, /<!-- GSECTION:/g), 2);
});

test('표 행도 손실 0 — 원본 4행이 3/1 로 갈린다', () => {
  const before = count(samplePage(), ROWS);
  const { index, guidelines, counts } = splitPages(samplePage(), { refIds });
  assert.equal(before, 4);
  assert.equal(counts.paperRows, 2);
  assert.equal(counts.guidelineRows, 1);
  assert.equal(counts.referenceRows, 1);
  assert.equal(count(index, ROWS) + count(guidelines, ROWS), before);
});

test('구본 행(data-kind 없음)도 참고자료 식별자로 갈린다 — 마이그레이션', () => {
  const { guidelines } = splitPages(samplePage(), { refIds });
  // 기타 표에만 REF_ID 행이 있고, 아이콘이 🔖 로 교정된다
  const refRow = guidelines.match(new RegExp(`<tr[^>]*data-pmid="${REF_ID}"[^>]*>[\\s\\S]*?</tr>`))[0];
  assert.match(refRow, /data-kind="reference"/);
  assert.match(refRow, /🔖 NEJM/);
  assert.doesNotMatch(refRow, /📋 NEJM/);
});

test('refIds 없이도 data-kind 가 있으면 그것으로 갈린다', () => {
  const once = splitPages(samplePage(), { refIds });
  // 두 번째 판정은 refIds 를 주지 않는다 — 첫 판정이 심은 data-kind 만으로 갈려야 한다.
  const merged = mergePages(once.index, once.guidelines);
  const twice = splitPages(merged, { refIds: null });
  assert.equal(twice.counts.referenceRows, 1);
  assert.equal(twice.counts.guidelineRows, 1);
  assert.equal(twice.counts.paperRows, 2);
});

test('왕복 안정 — split → merge → split 이 같은 개수를 낸다', () => {
  const a = splitPages(samplePage(), { refIds });
  const merged = mergePages(a.index, a.guidelines);
  const b = splitPages(merged, { refIds });
  assert.deepEqual(b.counts, a.counts);
  // 3회차까지 흔들리지 않는다(매일 도는 경로다)
  const c = splitPages(mergePages(b.index, b.guidelines), { refIds });
  assert.deepEqual(c.counts, a.counts);
});

test('guidelines 가 없으면 merge 는 index 를 그대로 돌려준다 — 첫 실행/마이그레이션', () => {
  const src = samplePage();
  assert.equal(mergePages(src, null), src);
  assert.equal(mergePages(src, ''), src);
  assert.equal(mergePages(src, '<html>스캐폴드 아님</html>'), src);
});

test('참고자료 섹션의 접힌 헤더 라벨이 기타 자료로 교정된다', () => {
  const { guidelines } = splitPages(samplePage(), { refIds });
  const refBlock = guidelines.match(/<!-- GSECTION:2026-08-07-m-999 -->[\s\S]*?<!-- \/GSECTION:2026-08-07-m-999 -->/)[0];
  assert.match(refBlock, /<span class="gl-tag ref">🔖 기타 자료<\/span>/);
  assert.doesNotMatch(refBlock, /<span class="gl-tag">📋 가이드라인<\/span>/);
  // 가이드라인 섹션은 종전 라벨 유지
  const glBlock = guidelines.match(/<!-- GSECTION:2026-08-04 -->[\s\S]*?<!-- \/GSECTION:2026-08-04 -->/)[0];
  assert.match(glBlock, /<span class="gl-tag">📋 가이드라인<\/span>/);
});

test('두 페이지가 같은 탭 바를 갖고 현재 페이지만 활성 — 대등한 병렬 페이지', () => {
  const { index, guidelines } = splitPages(samplePage(), { refIds });
  for (const p of [index, guidelines]) {
    assert.equal(count(p, /<nav class="pgnav">/g), 1);
    assert.match(p, /href="index\.html"/);
    assert.match(p, /href="guidelines\.html"/);
  }
  assert.match(index, /<a href="index\.html" class="on"/);
  assert.match(guidelines, /<a href="guidelines\.html" class="on"/);
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
  const nav = pageNav('papers', { papers: 35, guidelines: 6, others: 1 });
  assert.match(nav, /35편/);
  assert.match(nav, /6 · 1건/);
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

test('가이드·기타 행의 data-pmid 는 첫 속성으로 남는다(삭제 패치 계약)', () => {
  const { guidelines } = splitPages(samplePage(), { refIds });
  for (const m of guidelines.matchAll(/<tr ([^>]*)>/g)) {
    assert.match(m[1], /^data-pmid="/, `data-pmid 가 첫 속성이 아님: <tr ${m[1]}>`);
  }
  // curation.js 의 삭제 패치 정규식으로도 잡혀야 한다
  assert.match(guidelines, new RegExp(`<tr data-pmid="${REF_ID}"[^>]*>[\\s\\S]*?</tr>`));
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
