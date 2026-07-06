import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fulltextDocName, htmlToText, fulltextSectionText, docUrlOf } from '../src/utils/fulltextDoc.js';

test('fulltextDocName/docUrlOf 형식', () => {
  assert.equal(fulltextDocName('2026-07'), 'Trend Review 전문 — 2026-07');
  assert.equal(docUrlOf('abc'), 'https://docs.google.com/document/d/abc/edit');
});

test('htmlToText: script/style 제거·태그 소거·공백 축약·상한', () => {
  const html = '<html><head><style>.x{}</style><script>var a=1<2;</script></head><body><h1>T</h1><p>hello&amp;world</p><div>next</div></body></html>';
  const t = htmlToText(html);
  assert.ok(!t.includes('var a'));
  assert.ok(!t.includes('.x{}'));
  assert.ok(t.includes('hello&world'));
  assert.ok(t.includes('T'));
  assert.equal(htmlToText(`<p>${'a'.repeat(50)}</p>`, 10).length, 10);
});

test('htmlToText: 이중 인코딩은 마크업으로 되살아나지 않고, nav/footer 보일러플레이트 제거', () => {
  // &amp;lt; 의 올바른 복원은 리터럴 '&lt;' 텍스트 — 이중 디코드로 '<b>'가 되살아나면 안 됨
  assert.equal(htmlToText('<p>&amp;lt;b&amp;gt;x</p>'), '&lt;b&gt;x');
  const t = htmlToText('<nav>MENU MENU</nav><header>HDR</header><p>real body</p><footer>FTR</footer>');
  assert.ok(t.includes('real body'));
  assert.ok(!t.includes('MENU') && !t.includes('HDR') && !t.includes('FTR'));
});

test('fulltextSectionText: fullText 있으면 섹션, 없고 webTexts 있으면 레퍼런스 섹션, 둘 다 없으면 null', () => {
  const base = { date: '2026-07-06', pmid: '1', title: 'T', journal: 'J' };
  const withFt = fulltextSectionText({ ...base, fullText: 'BODY', fullTextSource: 'PMC' });
  assert.ok(withFt.includes('PMID 1') && withFt.includes('BODY') && withFt.includes('PMC'));
  const withWeb = fulltextSectionText(base, [{ source: 'S', url: 'https://e.x', text: 'WEBBODY' }]);
  assert.ok(withWeb.includes('WEBBODY') && withWeb.includes('https://e.x'));
  assert.equal(fulltextSectionText(base, []), null);
});
