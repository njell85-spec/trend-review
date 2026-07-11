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
