import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toArchiveEntry, upsertEntry, monthOf, pdfFileName } from '../src/agents/ArchiveAgent.js';

// FilterAnalyzerAgent 실산출 필드명 기준: evidenceSource(배지) · sources(출처, 웹보강은 '웹 — ' 접두)
const analysis = {
  pmid: '12345', title_ko: '제목', clinicalQuestion_ko: 'Q', pico: { patient: 'adults' }, pico_ko: {},
  keyFindings: ['a'], keyFindings_ko: ['ㄱ'], evidenceLevel: '1b',
  evidenceSource: '본문(PMC)',
  sources: [{ label: 'PubMed — PMID 12345', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' }],
  paper: { title: 'T', journal: 'NEJM', doi: '10.1/x', pmid: '12345', fullText: 'body', fullTextSource: 'PMC' },
};

test('toArchiveEntry가 Doc 스키마 필드를 채운다 (badge=evidenceSource, references=sources)', () => {
  const e = toArchiveEntry(analysis, { pdfLink: 'L', todayKST: '2026-07-06' });
  assert.equal(e.date, '2026-07-06');
  assert.equal(e.pmid, '12345');
  assert.equal(e.badge, '본문(PMC)');
  assert.equal(e.references[0].label, 'PubMed — PMID 12345');
  assert.equal(e.pdfLink, 'L');
  assert.equal(e.fullTextSource, 'PMC');
  assert.equal(e.pico.patient, 'adults'); // 영어 PICO 보존 (영상 EN 대본 입력)
  assert.equal(e.dossier, null); // 본문 있으면 도시에 없음
});

test('페이월 + 웹보강 소스("웹 — " 접두)면 dossier가 생성된다', () => {
  const paywalled = {
    ...analysis, evidenceSource: '초록 + 웹보강',
    sources: [
      { label: 'PubMed — PMID 12345', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' },
      { label: '웹 — NEJM 공식', url: 'https://nejm.org/x' },
    ],
    paper: { ...analysis.paper, fullText: null, fullTextSource: 'abstract-only' },
  };
  const e = toArchiveEntry(paywalled, { pdfLink: null, todayKST: '2026-07-06' });
  assert.equal(e.dossier.length, 1);
  assert.equal(e.dossier[0].url, 'https://nejm.org/x');
  assert.equal(e.dossier[0].source, 'NEJM 공식'); // '웹 — ' 접두 제거
});

test('upsertEntry — 같은 날짜+pmid는 교체(재실행 안전), 다른 건 추가', () => {
  const e1 = { date: '2026-07-06', pmid: '1' };
  const list = upsertEntry([e1], { date: '2026-07-06', pmid: '1', title: 'new' });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'new');
  assert.equal(upsertEntry(list, { date: '2026-07-07', pmid: '2' }).length, 2);
});

test('monthOf·pdfFileName (금지문자 치환 · 80자 절단)', () => {
  assert.equal(monthOf('2026-07-06'), '2026-07');
  assert.equal(
    pdfFileName({ date: '2026-07-06', pmid: '12345', title: 'A/B: study?' }),
    '2026-07-06_12345_A-B- study-.pdf',
  );
  const long = pdfFileName({ date: '2026-07-06', pmid: '1', title: 'x'.repeat(200) });
  assert.ok(long.length <= '2026-07-06_1_'.length + 80 + 4);
});
