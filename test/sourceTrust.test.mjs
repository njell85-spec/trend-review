import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTrustedSourceUrl, filterTrustedSources } from '../src/utils/sourceTrust.js';

/**
 * ★★ 실측 2026-08-18 — 웹검색을 고치자마자 리뷰 카드가 1,119 → 5,173자로 좋아졌는데
 *   그 근거로 붙은 출처가 이것이었다:
 *     https://waltersport.com/wp-content/uploads/2026/03/LANCET-Sepsis-Singer-et-al.-2026.pdf
 *   Lancet 논문 PDF 가 무단 게재된 **미러 사이트**다. 내용이 맞더라도 인용할 곳이
 *   아니고, 링크가 언제 사라질지 모르며, 진본 보증도 없다.
 *   프롬프트의 "블로그·콘텐츠팜·AI 생성물 배제" 는 PDF 미러를 못 걸렀다.
 *   **말로 막지 말고 코드로 막는다.**
 */

test('★★ 실측 그 미러가 차단된다', () => {
  assert.equal(isTrustedSourceUrl(
    'https://waltersport.com/wp-content/uploads/2026/03/LANCET-Sepsis-Singer-et-al.-2026.pdf'), false);
});

test('★ 정당한 출처는 통과한다 (출판사·색인·학회·대학·정부)', () => {
  for (const u of [
    'https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(25)02422-5/fulltext',
    'https://pubmed.ncbi.nlm.nih.gov/41765030/',
    'https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/',
    'https://doi.org/10.1016/S0140-6736(25)02422-5',
    'https://www.sccm.org/surviving-sepsis-campaign',
    'https://www.esicm.org/statement',
    'https://www.nejm.org/doi/full/10.1056/NEJMx',
    'https://med.stanford.edu/sepsis',
    'https://www.cdc.gov/sepsis',
    'https://www.nice.org.uk/guidance/ng51',
  ]) assert.equal(isTrustedSourceUrl(u), true, `막히면 안 되는 출처가 막혔다: ${u}`);
});

test('★ 허용목록 밖은 막는다 (모르는 곳은 안 쓴다가 기본값)', () => {
  for (const u of [
    'https://some-blog.medium.com/sepsis-summary',
    'https://randomclinic.co/uploads/lancet.pdf',
    'https://ai-summaries.example.net/sepsis',
  ]) assert.equal(isTrustedSourceUrl(u), false, `막혔어야 할 출처가 통과했다: ${u}`);
});

test('★ 비-http 스킴·빈 값·쓰레기는 막는다', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '', null, undefined, 'not a url'])
    assert.equal(isTrustedSourceUrl(u), false, `통과하면 안 된다: ${String(u)}`);
});

test('하위도메인은 자동 포함, 유사 도메인은 아니다', () => {
  assert.equal(isTrustedSourceUrl('https://academic.oup.com/x'), true);
  assert.equal(isTrustedSourceUrl('https://www.bmj.com/content/x'), true);
  // 접미사 흉내: `nejm.org.evil.com` 은 nejm 이 아니다
  assert.equal(isTrustedSourceUrl('https://nejm.org.evil.com/x'), false);
  assert.equal(isTrustedSourceUrl('https://evilnejm.org/x'), false);
});

test('filterTrustedSources: 걷어낸 것을 함께 돌려준다', () => {
  const { kept, dropped } = filterTrustedSources([
    { sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/1/' },
    { sourceUrl: 'https://waltersport.com/x.pdf' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
});

// ── 배선 계약 ────────────────────────────────────────────────────────────────
// 판정기를 만들어 놓고 **부르지 않는** 것이 이 저장소의 최다 반복 함정이다.
// 그리고 세 자리(webSources · 리뷰 보강 절 · 가이드라인 보강 축)가 **같은 기준**을
// 써야 한다 — 한 곳만 느슨하면 그리로 미심쩍은 출처가 새어 들어온다.
test('★★ 출처를 받는 세 자리가 모두 같은 판정기를 쓴다 (배선 계약)', () => {
  const src = readFileSync(new URL('../src/agents/GuidelineAnalyzerAgent.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/utils\/sourceTrust\.js'/, '판정기를 import 하지 않는다');
  const hits = (src.match(/isTrustedSourceUrl\(/g) ?? []).length;
  // ★ 3자리 미만이면 검사가 헛돌고 있는 것이다 — 이 저장소의 관례.
  assert.ok(hits >= 3, `판정기를 ${hits}곳에서만 쓴다 — webSources·리뷰 보강·가이드 보강 셋 다 필요하다`);
  // 느슨한 http 검사만 남은 자리가 없어야 한다.
  assert.ok(!/if \(!\/\^https\?:\\\/\\\/\/i\.test\(url\)\) return null;/.test(src),
    'http 검사만 하는 자리가 남았다 — 그리로 해적판 미러가 들어온다');
});

// ── 표식 중복 (실측 2026-08-18) ──────────────────────────────────────────────
// 화면에 `[웹 보강] [보강] Sepsis-3 진단 기준 …` 으로 표식이 **두 번** 찍혔다.
// 모델이 제목에 스스로 `[보강]` 을 붙여 오는데 우리도 `[웹 보강]` 을 붙였기 때문이다.
// 표식은 **우리가 붙이는 것 하나**여야 한다.
test('★ 모델이 붙인 앞머리 표식을 걷어내고 우리 표식만 남긴다', async () => {
  const { GuidelineAnalyzerAgent } = await import('../src/agents/GuidelineAnalyzerAgent.js');
  const a = new GuidelineAnalyzerAgent();
  const secs = a._publishableReviewSections({
    sections: [{
      origin: 'augmented', heading_ko: '[보강] Sepsis-3 진단 기준',
      body_ko: '본문', sourceLabel: 'SCCM', sourceUrl: 'https://www.sccm.org/x',
    }],
  });
  assert.equal(secs.length, 1);
  assert.equal((secs[0].heading_ko.match(/\[/g) ?? []).length, 1,
    `표식이 겹쳤다: ${secs[0].heading_ko}`);
  assert.match(secs[0].heading_ko, /^\[웹 보강\] Sepsis-3 진단 기준$/);
});
