import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthDocHtml, esc } from '../src/utils/docBuilder.js';

const entry = {
  date: '2026-07-06', pmid: '12345', title: 'Trial <script>alert(1)</script>',
  title_ko: '무작위 시험', journal: 'NEJM', doi: '10.1/x', badge: '본문(PMC)',
  clinicalQuestion_ko: '질문?', pico_ko: { patient: 'P', intervention: 'I', comparison: 'C', outcome: 'O' },
  keyFindings: ['finding A'], keyFindings_ko: ['소견 A'], evidenceLevel: '1b',
  references: [{ label: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' }],
  fullText: 'Body text', fullTextSource: 'PMC', dossier: null, pdfLink: 'https://drive.google.com/x',
};

test('제목의 HTML이 이스케이프된다 (XSS/문서 깨짐 방지)', () => {
  const html = buildMonthDocHtml('2026-07', [entry]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('날짜 역순 정렬 + 본문·근거배지·PDF 링크 포함', () => {
  const older = { ...entry, date: '2026-07-01', pmid: '99999', title: 'Old', fullText: null, fullTextSource: 'abstract-only' };
  const html = buildMonthDocHtml('2026-07', [older, entry]);
  assert.ok(html.indexOf('12345') < html.indexOf('99999')); // 최신이 먼저
  assert.ok(html.includes('본문(PMC)') && html.includes('Body text'));
  assert.ok(html.includes('https://drive.google.com/x'));
});

test('도시에 섹션은 dossier가 있을 때만 렌더된다', () => {
  const paywalled = {
    ...entry, fullText: null,
    dossier: [{ source: 'NEJM 공식', url: 'https://nejm.org/x', note: '1차 결과 수치' }],
  };
  const withD = buildMonthDocHtml('2026-07', [paywalled]);
  const withoutD = buildMonthDocHtml('2026-07', [entry]);
  assert.ok(withD.includes('근거 도시에') && withD.includes('https://nejm.org/x'));
  assert.ok(!withoutD.includes('근거 도시에'));
});

test('esc는 & < > " \' 를 치환한다 (GitHubPublisher.esc와 동일 집합)', () => {
  assert.equal(esc(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
});
