import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardHtml, cardsFromScript } from '../src/utils/cardNews.js';

test('cardHtml — 1080×1350 규격, 텍스트 이스케이프', () => {
  const html = cardHtml({ kind: 'body', heading: 'A<b>', bullets: ['x&y'], index: 1, total: 3 });
  assert.ok(html.includes('width:1080px') && html.includes('height:1350px'));
  assert.ok(html.includes('A&lt;b&gt;') && html.includes('x&amp;y'));
  assert.ok(html.includes('1/3'));
});

test('cardHtml — cover는 인덱스 대신 브랜드 배지', () => {
  const html = cardHtml({ kind: 'cover', heading: 'Title', bullets: ['a'] });
  assert.ok(html.includes('EM/CCM'));
  assert.ok(!html.includes('/undefined'));
});

test('cardsFromScript — 표지 + 슬라이드 + 출처 구성, useChart 전파', () => {
  const script = { slides: [
    { heading: 'H1', bullets: ['b1'], useChart: true },
    { heading: 'H2', bullets: ['b2'], useChart: false },
  ] };
  const cards = cardsFromScript(script, { titleEn: 'My Paper', pmid: '123' });
  assert.equal(cards.length, 4); // cover + 2 + source
  assert.equal(cards[0].kind, 'cover');
  assert.equal(cards[0].heading, 'My Paper');
  assert.equal(cards[1].useChart, true);
  assert.equal(cards.at(-1).kind, 'source');
  assert.ok(cards.at(-1).bullets[0].includes('pubmed.ncbi.nlm.nih.gov/123/'));
});
