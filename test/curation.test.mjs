/**
 * curation(R4) — 블록 멱등 주입·삭제 패치·통계 재계산 검증.
 * 카드·표 렌더는 클라이언트 스크립트라 여기서는 서버측 계약을 검증한다:
 * ① 블록 버전 교체 규칙(위젯과 동일) ② 섹션·행 제거의 멱등성 ③ 통계 정합.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  curationBlock, ensureCurationBlock, removeSectionFromHtml, recountStats,
} from '../src/utils/curation.js';

const OPTS = { owner: 'o', repo: 'r' };

function samplePage() {
  return `<body>
<div class="stats"><div class="n stat-days-count">2</div><div class="n stat-papers-count">2</div></div>
<div class="archive">
<!-- ARCHIVE_START -->
<!-- SECTION:2026-07-05 -->
<details class="day day-past"><article class="paper-card">A<div class="pc-foot"><a href="https://pubmed.ncbi.nlm.nih.gov/111/">PubMed</a></div></article></details>
<!-- /SECTION:2026-07-05 -->
<!-- SECTION:2026-07-06-m-222 -->
<details class="day day-past"><article class="paper-card">B<div class="pc-foot"><a href="https://pubmed.ncbi.nlm.nih.gov/222/">PubMed</a></div></article></details>
<!-- /SECTION:2026-07-06-m-222 -->
</div>
<div class="arch-table"><div class="at-head"><span class="at-count">2편</span></div><table>
<thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
<tbody><!-- TABLE_ROWS_START --><tr data-pmid="111"><td class="c-date">2026-07-05</td><td class="c-jour">J</td><td class="c-title"><a href="#">t</a></td><td class="c-read"></td></tr><tr data-pmid="222"><td class="c-date">2026-07-06</td><td class="c-jour">J</td><td class="c-title"><a href="#">t</a></td><td class="c-read"></td></tr><!-- TABLE_ROWS_END --></tbody>
</table></div>
</body>`;
}

// ── 블록 주입 ────────────────────────────────────────────────────────────────
test('블록이 없으면 </body> 앞에 주입한다', () => {
  const out = ensureCurationBlock('<body>x</body>', OPTS);
  assert.match(out, /<!-- CURATION_BLOCK v\d+ -->[\s\S]*<!-- \/CURATION_BLOCK -->\n<\/body>/);
});

test('현재 버전이 이미 있으면 그대로 반환한다(멱등)', () => {
  const once = ensureCurationBlock('<body>x</body>', OPTS);
  assert.equal(ensureCurationBlock(once, OPTS), once);
});

test('구버전 블록은 현재 버전으로 교체된다', () => {
  const once = ensureCurationBlock('<body>x</body>', OPTS);
  const older = once.replace(/<!-- CURATION_BLOCK v\d+ -->/, '<!-- CURATION_BLOCK v0 -->');
  const out = ensureCurationBlock(older, OPTS);
  assert.ok(!out.includes('CURATION_BLOCK v0'));
  assert.equal(out.match(/<!-- \/CURATION_BLOCK -->/g).length, 1, '블록은 정확히 1개');
});

test('블록에 owner/repo가 dispatch 대상으로 들어간다', () => {
  const b = curationBlock({ owner: 'njell85-spec', repo: 'trend-review' });
  assert.ok(b.includes("OWNER='njell85-spec'"));
  assert.ok(b.includes('curate-remove.yml'));
  assert.ok(b.includes('materialize.yml'));
  assert.ok(b.includes('curation_state.json'), '상태 파일을 fetch해야 카드·표가 같은 소스를 그린다');
});

// ── 삭제 패치 ────────────────────────────────────────────────────────────────
test('섹션 제거: 블록·표 행이 사라지고 통계가 준다', () => {
  const out = removeSectionFromHtml(samplePage(), { sectionKey: '2026-07-05', pmid: '111' });
  assert.ok(!out.includes('SECTION:2026-07-05 '), '섹션 마커 잔존 금지');
  assert.ok(!out.includes('data-pmid="111"'), '표 행 잔존 금지');
  assert.ok(out.includes('SECTION:2026-07-06-m-222'), '다른 섹션은 보존');
  assert.ok(out.includes('<div class="n stat-days-count">0</div>'), '데일리 일수는 수동 섹션을 세지 않는다');
  assert.ok(out.includes('<div class="n stat-papers-count">1</div>'));
  assert.ok(out.includes('<span class="at-count">1편</span>'));
});

test('수동 섹션 키(-m-pmid)도 특수문자 이스케이프로 정확히 제거된다', () => {
  const out = removeSectionFromHtml(samplePage(), { sectionKey: '2026-07-06-m-222', pmid: '222' });
  assert.ok(!out.includes('SECTION:2026-07-06-m-222'));
  assert.ok(out.includes('SECTION:2026-07-05'), '날짜 섹션은 보존');
});

test('삭제는 멱등 — 없는 키를 지워도 페이지가 변하지 않는다(통계 재계산 제외)', () => {
  const once = removeSectionFromHtml(samplePage(), { sectionKey: '2026-07-05', pmid: '111' });
  const twice = removeSectionFromHtml(once, { sectionKey: '2026-07-05', pmid: '111' });
  assert.equal(twice, once);
});

test('GSECTION(가이드라인) 블록도 같은 키 규칙으로 제거된다', () => {
  const html = `<body><div class="n stat-days-count">0</div><div class="n stat-papers-count">0</div><span class="at-count">0편</span>
<!-- GSECTION:2026-07-04 -->
<details><article class="guideline-card">G</article></details>
<!-- /GSECTION:2026-07-04 -->
<tr data-pmid="333"><td class="c-date">2026-07-04</td></tr></body>`;
  const out = removeSectionFromHtml(html, { sectionKey: '2026-07-04', pmid: '333' });
  assert.ok(!out.includes('GSECTION:2026-07-04'));
  assert.ok(!out.includes('data-pmid="333"'));
});

// ── 통계 재계산 ──────────────────────────────────────────────────────────────
test('recountStats: 논문 카드 0이면 일수로 폴백한다(publisher 규칙 동일)', () => {
  const html = `<div class="n stat-days-count">9</div><div class="n stat-papers-count">9</div><span class="at-count">9편</span>
<!-- SECTION:2026-07-01 --><details></details><!-- /SECTION:2026-07-01 -->`;
  const out = recountStats(html);
  assert.ok(out.includes('stat-days-count">1<'));
  assert.ok(out.includes('stat-papers-count">1<'));
});
