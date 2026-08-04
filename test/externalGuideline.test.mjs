import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHttpUrl, sourceIdOf, titleFromHtml, fetchSourceText, buildWebGuideline } from '../src/utils/externalGuideline.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const ok = (body, type = 'text/html') => Promise.resolve({
  ok: true, headers: { get: () => type }, text: () => Promise.resolve(body),
});

test('isHttpUrl: URL만 참, PMID/DOI는 거짓', () => {
  assert.equal(isHttpUrl('https://www.idsociety.org/practice-guideline/amr-guidance/'), true);
  assert.equal(isHttpUrl('http://x.org/a'), true);
  assert.equal(isHttpUrl('39108079'), false);
  assert.equal(isHttpUrl('10.1093/cid/ciae403'), false);
  assert.equal(isHttpUrl(''), false);
  assert.equal(isHttpUrl(null), false);
});

test('sourceIdOf: 안정적이고 숫자 PMID와 충돌하지 않는 키', () => {
  const id = sourceIdOf('https://www.idsociety.org/practice-guideline/amr-guidance/');
  assert.equal(id, sourceIdOf('https://www.idsociety.org/practice-guideline/amr-guidance/'));
  assert.ok(id.startsWith('web:'));
  assert.ok(!/^\d+$/.test(id));
  assert.notEqual(id, sourceIdOf('https://www.idsociety.org/practice-guideline/other/'));
});

test('titleFromHtml: <title> 추출, 없으면 null', () => {
  assert.equal(titleFromHtml('<html><head><title> IDSA 2026  Guidance </title></head>'), 'IDSA 2026 Guidance');
  assert.equal(titleFromHtml('<html><body>no title</body></html>'), null);
});

test('fetchSourceText: HTML은 텍스트화, PDF/차단/타임아웃은 소프트 실패', async () => {
  const html = await fetchSourceText('https://x.org/a', { fetchImpl: () => ok(`<p>guidance body ${'x'.repeat(300)}</p>`) });
  assert.ok(html.text.includes('guidance body'));

  const pdf = await fetchSourceText('https://x.org/a.pdf', { fetchImpl: () => ok('%PDF-1.7', 'application/pdf') });
  assert.equal(pdf.text, '');

  const blocked = await fetchSourceText('https://x.org/deny', {
    fetchImpl: () => Promise.resolve({ ok: false, headers: { get: () => 'text/html' }, text: () => Promise.resolve('') }),
  });
  assert.equal(blocked.text, '');

  const thrown = await fetchSourceText('https://x.org/timeout', { fetchImpl: () => Promise.reject(new Error('timeout')) });
  assert.equal(thrown.text, '');
});

test('buildWebGuideline: pmid는 비고 sourceUrl/sourceId로 식별, 본문 없으면 안내 문구', () => {
  const g = buildWebGuideline({ url: 'https://www.idsociety.org/practice-guideline/amr-guidance/', title: 'IDSA 2026 Guidance', org: 'IDSA', pubDate: '2026-03', text: '' });
  assert.equal(g.pmid, '');
  assert.equal(g.sourceUrl, 'https://www.idsociety.org/practice-guideline/amr-guidance/');
  assert.ok(g.sourceId.startsWith('web:'));
  assert.equal(g.journal, 'IDSA');
  assert.equal(g.fullText, '');
  assert.equal(g.fullTextSource, 'none');
  assert.ok(!/undefined/.test(g.abstract));

  const withText = buildWebGuideline({ url: 'https://x.org/g', text: `body ${'y'.repeat(300)}` });
  assert.ok(withText.fullText.length > 200);
  assert.equal(withText.title, 'x.org'); // 제목 미지정 → 호스트 폴백
});

// ── 렌더 회귀: PMID 없는 가이드 카드가 죽은 링크('#')를 만들지 않아야 한다 ───────
const webCard = {
  type: 'guideline',
  paper: {
    pmid: '', title: 'IDSA 2026 Guidance on AMR Gram-Negative Infections', journal: 'IDSA',
    pubDate: '2026-03', sourceUrl: 'https://www.idsociety.org/practice-guideline/amr-guidance/',
    sourceId: 'web:idsociety-org-practice-guideline-amr-guidance',
  },
  org: 'IDSA', version: '2026 (v4.0)', title_ko: 'IDSA 2026 그람음성 내성균 치료 가이던스',
  scope_ko: '범위', summary: ['a'], summary_ko: ['가'], keyChanges: [{ topic: 't', detail: 'd', detail_ko: 'ㄷ' }],
  practiceImpact: 'i', practiceImpact_ko: '임팩트',
  sources: [{ label: '원문 — 발행기관 공개 문서', url: 'https://www.idsociety.org/practice-guideline/amr-guidance/' }],
};

test('가이드 카드: PMID 없으면 원문 링크로, PubMed 죽은 링크 없음', () => {
  const html = new GitHubPublisher()._buildGuidelineCard(webCard);
  assert.ok(html.includes('href="https://www.idsociety.org/practice-guideline/amr-guidance/"'));
  assert.ok(html.includes('원문 (발행기관)'));
  assert.ok(!html.includes('href="#"'));
  assert.ok(!html.includes('PMID '));
});

test('가이드 카드: PMID 있으면 기존 PubMed 링크 유지(회귀 고정)', () => {
  const pmCard = { ...webCard, paper: { pmid: '39108079', title: 'T', journal: 'Clin Infect Dis', pubDate: '2024-08', doi: '10.1093/cid/ciae403' } };
  const html = new GitHubPublisher()._buildGuidelineCard(pmCard);
  assert.ok(html.includes('https://pubmed.ncbi.nlm.nih.gov/39108079/'));
  assert.ok(html.includes('PubMed 39108079'));
  assert.ok(html.includes('PMID 39108079'));
});

test('누적 표 행: PMID 없는 가이드는 sourceId를 행 키로, 링크는 원문', () => {
  const rows = new GitHubPublisher()._tableRows('2026-08-04', [], webCard, { manual: true });
  assert.ok(rows.includes('data-pmid="web:idsociety-org-practice-guideline-amr-guidance"'));
  assert.ok(rows.includes('href="https://www.idsociety.org/practice-guideline/amr-guidance/"'));
  assert.ok(rows.includes('data-guideline="1"'));
  assert.ok(!rows.includes('href="#"'));
});
