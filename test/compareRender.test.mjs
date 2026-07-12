import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComparisonHtml } from '../src/experiments/compareRender.js';

const sample = {
  records: [
    { date: '2026-07-14', converged: true,
      arm1: { pmid: '42308484', title: 'Cefazolin for MSSA', title_ko: '세파졸린', journal: 'NEJM', doi: '10.x', evidenceLevel: 'High',
              pico: { population: '[USA] adults', intervention: 'cefazolin', outcome: 'mortality 12% vs 18%' }, keyFindings_ko: ['소견1'] },
      arm2: { pmid: '42308484', title: 'Cefazolin for MSSA', title_ko: '세파졸린', journal: 'NEJM', doi: '10.x', evidenceLevel: 'High',
              pico: { population: '[USA] adults', intervention: 'cefazolin', outcome: 'mortality 12% vs 18%' }, keyFindings_ko: ['소견'] },
      arm3: null },
    { date: '2026-07-13', converged: false,
      arm1: { pmid: '1', title: 'A', journal: 'JAMA', pico: {}, keyFindings_ko: [] }, arm2: null, arm3: null },
  ],
};

test('renderComparisonHtml: 핵심 요소 포함', () => {
  const html = renderComparisonHtml(sample, { startDate: '2026-07-12', endDate: '2026-07-25', today: '2026-07-14' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /ARM 1/);
  assert.match(html, /ARM 2/);
  assert.match(html, /42308484/);            // pmid 표시
  assert.match(html, /수렴/);                 // 수렴 뱃지
  assert.match(html, /max-width:760px/);      // 모바일 스택
  assert.match(html, /선정 실패|픽 없음/);     // Arm2 실패 안내
});

test('renderComparisonHtml: HTML 이스케이프', () => {
  const html = renderComparisonHtml({ records: [{ date: 'd', converged: false, arm1: { pmid: '1', title: '<script>x</script>', journal: 'J', pico: {}, keyFindings_ko: [] }, arm2: null }] }, { startDate: 'a', endDate: 'b', today: 'd' });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderComparisonHtml: 빈 records도 안전', () => {
  const html = renderComparisonHtml({ records: [] }, { startDate: 'a', endDate: 'b', today: 'c' });
  assert.match(html, /<!doctype html>/i);
});

test('renderComparisonHtml: 비배열 keyFindings도 크래시 없음', () => {
  const html = renderComparisonHtml({ records: [{ date: 'd', converged: false,
    arm1: { pmid: '1', title: 'T', journal: 'J', pico: {}, keyFindings_ko: 'oops-not-array' }, arm2: null }] },
    { startDate: 'a', endDate: 'b', today: 'd' });
  assert.match(html, /<!doctype html>/i);
});

test('renderComparisonHtml: Arm2 분석객체(title/journal이 .paper 하위)도 저널 표시', () => {
  const html = renderComparisonHtml({ records: [{ date: 'd', converged: false,
    arm1: null,
    arm2: { pmid: '41841715', title_ko: '고유량 산소', evidenceLevel: 'High', pico: { outcome: '28일 사망 14.6%' },
            keyFindings_ko: ['소견'], paper: { title: 'High-Flow Oxygen', journal: 'NEJM', doi: '10.1056/x' } } }] },
    { startDate: 'a', endDate: 'b', today: 'd' });
  assert.match(html, /NEJM/);          // .paper.journal 폴백
  assert.match(html, /41841715/);
  assert.match(html, /High-Flow Oxygen/); // .paper.title 폴백
  assert.match(html, /doi\.org\/10\.1056/);
});

test('renderComparisonHtml: Phase 1 전체 섹션 렌더(why/PICO C/통계용어/임상결론/practice)', () => {
  const a2 = { pmid: '9', title_ko: '제목', evidenceLevel: 'High', evidenceSource: '초록 + 웹보강',
    clinicalQuestion_ko: '왜 중요한가 설명', pico_ko: { population: 'P내용', intervention: 'I내용', comparison: 'C내용', outcome: 'O내용' },
    keyFindings_ko: ['핵심1'], secondaryOutcomes_ko: ['2차1'],
    statGlossary: [{ term: 'OR', explanation_ko: '오즈비 설명' }],
    limitations_ko: '한계 설명', clinicalTakeaway_ko: '임상 결론 설명', practiceChange_ko: ['적용점1'],
    paper: { title: 'T', journal: 'NEJM', doi: '' } };
  const html = renderComparisonHtml({ records: [{ date: 'd', converged: false, arm1: null, arm2: a2 }] },
    { startDate: 'a', endDate: 'b', today: 'd' });
  for (const needle of ['WHY IT MATTERS', '왜 중요한가', 'C내용', '통계 용어', '오즈비', '임상 결론', 'Practice Change', '적용점1', '초록 \\+ 웹보강']) {
    assert.match(html, new RegExp(needle));
  }
});
