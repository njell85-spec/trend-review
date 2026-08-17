/**
 * curation(R4) — 블록 멱등 주입·삭제 패치·통계 재계산 검증.
 * 카드·표 렌더는 클라이언트 스크립트라 여기서는 서버측 계약을 검증한다:
 * ① 블록 버전 교체 규칙(위젯과 동일) ② 섹션·행 제거의 멱등성 ③ 통계 정합.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  curationBlock, ensureCurationBlock, removeSectionFromHtml, recountStats, parseHiddenKey, SECTION_TAGS,
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
  // ★ 2026-08-18 — 카운트는 페이지당 하나다. 분석일수 칸은 **걷어낸다**(구판 배포본 정리).
  assert.ok(!out.includes('stat-days-count'), '분석일수 칸이 남았다 — 구판 잔재를 걷어야 한다');
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

test('GSECTION(가이드라인) 블록은 tag 지정으로 제거된다', () => {
  const html = `<body><div class="n stat-days-count">0</div><div class="n stat-papers-count">0</div><span class="at-count">0편</span>
<!-- GSECTION:2026-07-04 -->
<details><article class="guideline-card">G</article></details>
<!-- /GSECTION:2026-07-04 -->
<tr data-pmid="333"><td class="c-date">2026-07-04</td></tr></body>`;
  const out = removeSectionFromHtml(html, { sectionKey: '2026-07-04', pmid: '333', tag: 'GSECTION' });
  assert.ok(!out.includes('GSECTION:2026-07-04'));
  assert.ok(!out.includes('data-pmid="333"'));
});

// 리뷰 C1 회귀: 주간 가이드라인이 있는 날은 SECTION:날짜 + GSECTION:날짜가 공존한다.
// 태그를 좁히지 않으면 가이드 삭제가 그날 논문 섹션까지 영구 소멸시킨다.
test('같은 날짜 키의 SECTION·GSECTION 공존 시 지정 태그만 제거된다(C1)', () => {
  const html = `<body><div class="n stat-days-count">1</div><div class="n stat-papers-count">1</div><span class="at-count">1편</span>
<!-- SECTION:2026-07-06 -->
<details><article class="paper-card">P</article></details>
<!-- /SECTION:2026-07-06 -->
<!-- GSECTION:2026-07-06 -->
<details><article class="guideline-card">G</article></details>
<!-- /GSECTION:2026-07-06 -->
</body>`;
  const gOnly = removeSectionFromHtml(html, { sectionKey: '2026-07-06', tag: 'GSECTION' });
  assert.ok(gOnly.includes('<!-- SECTION:2026-07-06 -->'), '논문 섹션은 살아있어야 함');
  assert.ok(!gOnly.includes('GSECTION:2026-07-06'), '가이드 섹션만 제거');
  const sOnly = removeSectionFromHtml(html, { sectionKey: '2026-07-06', tag: 'SECTION' });
  assert.ok(sOnly.includes('GSECTION:2026-07-06'), '가이드 섹션은 살아있어야 함');
  assert.ok(!sOnly.includes('<!-- SECTION:2026-07-06 -->'));
});

test('잘못된 tag는 아무것도 제거하지 않는다', () => {
  const html = samplePage();
  assert.equal(removeSectionFromHtml(html, { sectionKey: '2026-07-05', tag: 'BOGUS' }), html);
});

test('parseHiddenKey: 태그 접두 키만 해석, 형식 밖은 null', () => {
  assert.deepEqual(parseHiddenKey('SECTION:2026-07-05'), { tag: 'SECTION', sectionKey: '2026-07-05' });
  assert.deepEqual(parseHiddenKey('GSECTION:2026-07-06-m-42373461'), { tag: 'GSECTION', sectionKey: '2026-07-06-m-42373461' });
  assert.equal(parseHiddenKey('2026-07-05'), null);
});

test('클라이언트 블록: 삭제 dispatch에 tag가 포함된다(C1 클라이언트측)', () => {
  const b = curationBlock(OPTS);
  assert.ok(b.includes('tag:info.tag'), '섹션 태그를 서버로 보내야 같은 날짜 논문·가이드가 구분된다');
  // ★ 종전에는 `(G?SECTION):` 리터럴을 봤다. 그 정규식이 **RSECTION 을 못 읽어서**
  //   리뷰 누적행의 🗑 가 "섹션 키를 찾지 못했습니다" 로 죽었다(2026-08-17 실측).
  //   문자열이 아니라 **정본 목록과 대조**한다 — 새 트랙이 생기면 여기가 적색이 된다.
  const re = b.match(/nodeValue\)\.match\((\/[^/]+\/)\)/)?.[1];
  assert.ok(re, '자기 마커의 태그+키를 캡처해야 함(M1)');
  for (const tag of SECTION_TAGS) {
    assert.ok(re.includes(tag), `클라이언트 정규식이 ${tag} 을 모른다: ${re}`);
  }
});

// ── 통계 재계산 ──────────────────────────────────────────────────────────────
test('recountStats: 논문 카드 0이면 일수로 폴백한다(publisher 규칙 동일)', () => {
  const html = `<div class="sc"><div class="n stat-days-count">9</div><div class="l">분석일수</div></div><div class="n stat-papers-count">9</div><span class="at-count">9편</span>
<!-- SECTION:2026-07-01 --><details></details><!-- /SECTION:2026-07-01 -->`;
  const out = recountStats(html);
  assert.ok(!out.includes('stat-days-count'), '분석일수 칸이 남았다 — 구판 잔재를 걷어야 한다');
  assert.ok(out.includes('stat-papers-count">1<'), '논문 카드가 0이면 날짜 섹션 수로 폴백한다');
});

// ── 퍼블리셔 연동 ────────────────────────────────────────────────────────────
test('publisher._applyCuration: 블록 보장 + 숨김 섹션 재출현 방어', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const pub = new GitHubPublisher({ token: 't', owner: 'o', repo: 'r' });
  const out = pub._applyCuration(samplePage(), {
    hidden: {
      'SECTION:2026-07-05': { pmid: '111' },
      'legacy-key-no-tag': { pmid: '222' }, // 형식 밖 키는 무시(파싱 실패 → skip)
    },
    materialized: {},
  });
  assert.match(out, /<!-- CURATION_BLOCK v\d+ -->/);
  assert.ok(!out.includes('SECTION:2026-07-05 '), '숨김 목록의 섹션은 발행마다 제거');
  assert.ok(!out.includes('data-pmid="111"'));
  assert.ok(out.includes('SECTION:2026-07-06-m-222'), '형식 밖 숨김 키는 아무것도 지우지 않는다');
});

test('publisher._applyCuration: 상태 없음(null)이어도 블록은 주입된다', async () => {
  const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
  const pub = new GitHubPublisher({ token: 't', owner: 'o', repo: 'r' });
  assert.match(pub._applyCuration('<body>x</body>', null), /CURATION_BLOCK v\d+/);
});

// ── 회귀: 숨김 기록이 다른 트랙 카드의 표 행을 잡아먹지 않는다 ────────────────
// 실측 사고(2026-08-07): PMID 42555934 의 논문 카드를 삭제한 뒤 같은 PMID 를
// 참고자료 카드로 다시 발행하자, 카드는 떴는데 누적 표 행만 사라졌다. publish() 가
// 매 발행마다 curation 을 재적용하는데 행 제거에 조건이 없어 새 행까지 지웠던 것.

test('섹션이 이미 없으면 같은 PMID 의 표 행을 지우지 않는다 (다른 트랙 카드 보호)', () => {
  const html = `<body>
<!-- GSECTION:2026-08-07-m-999 --><div>참고자료 카드</div><!-- /GSECTION:2026-08-07-m-999 -->
<tbody><!-- TABLE_ROWS_START --><tr data-pmid="999" data-guideline="1"><td class="c-date">2026-08-07</td></tr><!-- TABLE_ROWS_END --></tbody>
</body>`;
  // 숨김 기록은 '논문 섹션'(SECTION) 것이고, 그 섹션은 이미 지워져 이 문서에 없다.
  const out = removeSectionFromHtml(html, { sectionKey: '2026-08-07-m-999', pmid: '999', tag: 'SECTION' });
  assert.ok(out.includes('data-pmid="999"'), '없는 섹션의 숨김 기록이 다른 카드의 행을 지웠다');
  assert.ok(out.includes('GSECTION:2026-08-07-m-999'), '참고자료 카드 자체는 그대로여야 한다');
});

test('섹션을 실제로 지울 때는 표 행도 함께 지운다 (원래 의도 보존)', () => {
  const out = removeSectionFromHtml(samplePage(), { sectionKey: '2026-07-05', pmid: '111' });
  assert.ok(!out.includes('SECTION:2026-07-05 -->'));
  assert.ok(!out.includes('data-pmid="111"'));
});

// ── 리뷰 트랙(RSECTION) — 2026-08-17 PeterJ 실측 ─────────────────────────────
// 누적 리스트의 🗑 를 누르면 "섹션 키를 찾지 못했습니다" 로 죽었다.
// RSECTION 은 2026-08-16 3트랙 개편에서 생겼는데 **큐레이션 경로가 안 따라왔다** —
// 클라이언트 정규식 · removeSectionFromHtml 화이트리스트 · parseHiddenKey · 워크플로
// choice 목록, 넷 다 SECTION|GSECTION 만 알고 있었다.

test('★ 리뷰 섹션(RSECTION)도 지워진다', () => {
  const html = '<a>x</a>\n<!-- RSECTION:2026-08-17-r-41951238 -->카드<!-- /RSECTION:2026-08-17-r-41951238 -->\n<b>y</b>';
  const out = removeSectionFromHtml(html, { sectionKey: '2026-08-17-r-41951238', tag: 'RSECTION' });
  assert.ok(!out.includes('카드'), '리뷰 섹션이 안 지워졌다');
  assert.ok(out.includes('<a>x</a>') && out.includes('<b>y</b>'), '이웃까지 지웠다');
});

test('★ 리뷰 섹션을 지울 때 논문·가이드 섹션은 안 건드린다', () => {
  const html = '<!-- SECTION:2026-08-17 -->논문<!-- /SECTION:2026-08-17 -->'
    + '<!-- GSECTION:2026-08-17 -->지침<!-- /GSECTION:2026-08-17 -->'
    + '<!-- RSECTION:2026-08-17-r-1 -->리뷰<!-- /RSECTION:2026-08-17-r-1 -->';
  const out = removeSectionFromHtml(html, { sectionKey: '2026-08-17-r-1', tag: 'RSECTION' });
  assert.ok(out.includes('논문') && out.includes('지침'), '다른 트랙 카드가 같이 사라졌다');
  assert.ok(!out.includes('리뷰'));
});

test('★ 모르는 태그는 여전히 아무것도 안 지운다', () => {
  const html = '<!-- XSECTION:k -->x<!-- /XSECTION:k -->';
  assert.equal(removeSectionFromHtml(html, { sectionKey: 'k', tag: 'XSECTION' }), html);
});

test('★ 숨김 상태 키가 RSECTION 을 읽는다', () => {
  assert.deepEqual(parseHiddenKey('RSECTION:2026-08-17-r-41951238'),
    { tag: 'RSECTION', sectionKey: '2026-08-17-r-41951238' });
  // 앵커가 살아 있는지 — GSECTION 이 SECTION 으로 잘못 읽히면 안 된다
  assert.deepEqual(parseHiddenKey('GSECTION:2026-08-17'), { tag: 'GSECTION', sectionKey: '2026-08-17' });
  assert.equal(parseHiddenKey('NOPE'), null);
});

test('★ 클라이언트 스크립트가 RSECTION 주석을 알아본다', () => {
  const block = curationBlock({ owner: 'o', repo: 'r' });
  const re = block.match(/nodeValue\)\.match\((\/[^/]+\/)\)/)?.[1];
  assert.ok(re, '섹션 태그 정규식을 못 찾았다');
  assert.ok(re.includes('RSECTION'), `클라이언트가 RSECTION 을 모른다: ${re}`);
  // 실제로 매칭되는지 — 문자열만 들어 있고 안 걸리면 의미가 없다
  const live = new RegExp(re.slice(1, -1));
  assert.equal(' RSECTION:2026-08-17-r-1 '.match(live)?.[1], 'RSECTION');
  assert.equal(' GSECTION:2026-08-17 '.match(live)?.[1], 'GSECTION');
  assert.equal(' SECTION:2026-08-17 '.match(live)?.[1], 'SECTION');
});

// ── 섹션 키 형식 검증기 (2026-08-17 PeterJ 실측) ─────────────────────────────
//
// 리뷰 누적행의 🗑 를 눌러 **확인까지 눌렀는데** 항목이 그대로 남았다.
// 클라이언트는 정상 동작했고(확인 대화가 떴다) `curate-remove.yml` 로 디스패치도 됐다.
// 죽은 자리는 `scripts/curate-remove.mjs` 의 키 형식 정규식이었다:
//   CUR_SECTION_KEY: 2026-08-17-r-41504890 · CUR_TAG: RSECTION
//   → ✖ 잘못된 sectionKey
// `-m-`(수동)만 알고 `-r-`(리뷰)을 몰랐다. RSECTION 이 3트랙 개편에서 생겼는데
// 따라오지 않은 자리가 이것으로 다섯 번째다.
test('★ 섹션 키 검증기가 리뷰 키(-r-)를 받는다 — 형식 밖 입력은 여전히 거절', async () => {
  const src = await readFile(new URL('../scripts/curate-remove.mjs', import.meta.url), 'utf8');
  const m = src.match(/if \(!(\/\^.+?\/)\.test\(sectionKey\)\)/);
  assert.ok(m, '키 형식 정규식을 못 찾았다');
  const re = new RegExp(m[1].slice(1, -1));
  for (const ok of ['2026-08-17', '2026-08-17-m-42373461', '2026-08-17-m-x', '2026-08-17-r-41504890']) {
    assert.ok(re.test(ok), `받아야 하는 키를 거절했다: ${ok}`);
  }
  for (const bad of ['2026-08-17-z-1', '../../etc/passwd', '2026-08-17-r-', '2026-08-17-r-abc', '']) {
    assert.equal(re.test(bad), false, `거절해야 하는 키를 받았다: ${bad}`);
  }
});

test('★ 리뷰 삭제는 분석 카드와 누적표 행을 함께 지운다 (PeterJ 요구 2026-08-17)', () => {
  const html = [
    '<tr data-pmid="41504890" data-kind="review" data-guideline="1"><td>행</td></tr>',
    '<tr data-pmid="99999999"><td>남아야 하는 다른 행</td></tr>',
    '<!-- GSECTION:2026-08-17 -->가이드라인 카드<!-- /GSECTION:2026-08-17 -->',
    '<!-- RSECTION:2026-08-17-r-41504890 -->리뷰 분석 카드<!-- /RSECTION:2026-08-17-r-41504890 -->',
  ].join('\n');
  const out = removeSectionFromHtml(html, { sectionKey: '2026-08-17-r-41504890', pmid: '41504890', tag: 'RSECTION' });
  assert.ok(!out.includes('리뷰 분석 카드'), '분석 내용이 안 지워졌다');
  assert.ok(!out.includes('data-pmid="41504890"'), '누적표 행이 안 지워졌다');
  assert.ok(out.includes('가이드라인 카드'), '다른 트랙 카드가 같이 사라졌다');
  assert.ok(out.includes('data-pmid="99999999"'), '다른 행이 같이 사라졌다');
});
