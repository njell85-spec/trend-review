import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSrt, cuesFromNarration, slideHtml } from '../src/utils/videoRender.js';

test('buildSrt — 표준 SRT 포맷 (HH:MM:SS,mmm)', () => {
  const srt = buildSrt([{ startSec: 0, endSec: 2.5, text: '안녕하세요' }]);
  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:02,500\n안녕하세요'));
});

test('cuesFromNarration — 슬라이드 경계 유지 + 문장별 글자수 비례 배분', () => {
  const cues = cuesFromNarration(['첫 문장. 둘째 문장이 훨씬 더 깁니다.', '다음 슬라이드.'], [10, 5]);
  assert.ok(Math.abs(cues.at(-1).endSec - 15) < 0.01);   // 총 길이 보존
  assert.ok(cues[0].endSec <= cues[1].startSec + 0.01);  // 순차
  assert.ok(cues.filter((c) => c.startSec < 10).length === 2); // 슬라이드1에 2문장
  assert.ok(cues.at(-1).startSec >= 10);                 // 슬라이드2는 10초 이후
  assert.ok(cues[0].endSec - cues[0].startSec < cues[1].endSec - cues[1].startSec); // 짧은 문장이 짧게
});

test('slideHtml — 제목·불릿 이스케이프 + 차트는 useChart일 때만', () => {
  const s = { heading: 'A<b>', bullets: ['x&y'], useChart: false };
  const html = slideHtml(s, { orientation: 'landscape' });
  assert.ok(html.includes('A&lt;b&gt;') && html.includes('x&amp;y'));
  assert.ok(!html.includes('<svg'));
  const withChart = slideHtml({ ...s, useChart: true }, { orientation: 'portrait', chartSvg: '<svg>c</svg>' });
  assert.ok(withChart.includes('<svg>c</svg>'));
});
