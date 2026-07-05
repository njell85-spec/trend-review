import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComparisonChart, chartFromAnalysis } from '../src/utils/ChartRenderer.js';

test('두 군 비교 막대 SVG — 값·라벨·출처 포함, 값에 비례한 막대', () => {
  const svg = renderComparisonChart({
    title: '28-day mortality', unit: '%',
    groups: [{ label: 'Intervention', value: 21.3 }, { label: 'Control', value: 27.9 }],
    source: 'PMID 12345',
  });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('21.3') && svg.includes('27.9') && svg.includes('PMID 12345'));
  const widths = [...svg.matchAll(/data-bar width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2);
  assert.ok(widths[0] < widths[1]); // 21.3 < 27.9 비례
});

test('CI가 있으면 오차 막대 라인이 그려진다', () => {
  const svg = renderComparisonChart({
    title: 't', unit: '%',
    groups: [{ label: 'A', value: 20, ci: [15, 25] }, { label: 'B', value: 28 }],
    source: 's',
  });
  assert.ok(svg.includes('<line'));
});

test('라벨의 특수문자는 이스케이프된다', () => {
  const svg = renderComparisonChart({ title: 'a<b', unit: '%', groups: [{ label: 'x&y', value: 1 }], source: 's' });
  assert.ok(!svg.includes('a<b') && svg.includes('a&lt;b') && svg.includes('x&amp;y'));
});

test('구조화 수치가 없으면 chartFromAnalysis는 null (억지 차트 금지)', () => {
  assert.equal(chartFromAnalysis({ chartData: null }, 'ko'), null);
  assert.equal(chartFromAnalysis({ chartData: { groups: [{ label: 'a', value: 1 }] } }, 'ko'), null); // 1군뿐
});

test('chartFromAnalysis — 언어별 제목 선택', () => {
  const a = { chartData: { title: '28-day mortality', title_ko: '28일 사망률', unit: '%', source: 'PMID 1',
    groups: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] } };
  assert.ok(chartFromAnalysis(a, 'ko').svg.includes('28일 사망률'));
  assert.ok(chartFromAnalysis(a, 'en').svg.includes('28-day mortality'));
});
