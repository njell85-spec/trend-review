import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScriptMessages, validateScripts, VIDEO_SCRIPT_TOOL } from '../src/utils/videoScript.js';

test('프롬프트에 수치 생성 금지 규칙과 리포트 수치가 들어간다', () => {
  const msgs = buildScriptMessages({
    title_ko: '제목', keyFindings: ['mortality 21.3% vs 27.9%'], keyFindings_ko: ['사망률 21.3% vs 27.9%'],
    clinicalQuestion_ko: 'Q', pico: {}, pico_ko: {}, evidenceLevel: '1b',
    paper: { title: 'T', journal: 'NEJM', pmid: '1' },
  });
  const text = msgs.map((m) => m.content).join(' ');
  assert.ok(text.includes('절대 새로운 수치를 만들지 마라'));
  assert.ok(text.includes('21.3%'));
  assert.ok(text.includes('pubmed.ncbi.nlm.nih.gov/1'));
});

const slide = { heading: 'h', bullets: ['b'], useChart: false };
const okScripts = {
  midform: { ko: { slides: Array(6).fill(slide), narration: Array(6).fill('n') },
             en: { slides: Array(6).fill(slide), narration: Array(6).fill('n') } },
  short:   { ko: { slides: Array(3).fill(slide), narration: Array(3).fill('n') },
             en: { slides: Array(3).fill(slide), narration: Array(3).fill('n') } },
  chartData: null,
};

test('validateScripts — 정상 구조는 그대로 통과', () => {
  assert.deepEqual(validateScripts(okScripts), okScripts);
});

test('validateScripts — 숏폼 3장 아니면 throw', () => {
  const bad = structuredClone(okScripts);
  bad.short.ko.slides = Array(5).fill(slide);
  bad.short.ko.narration = Array(5).fill('n');
  assert.throws(() => validateScripts(bad), /short\.ko.*3/);
});

test('validateScripts — 중간폼 5~8장 범위 밖이면 throw', () => {
  const bad = structuredClone(okScripts);
  bad.midform.en.slides = Array(9).fill(slide);
  bad.midform.en.narration = Array(9).fill('n');
  assert.throws(() => validateScripts(bad), /midform\.en.*5~8/);
});

test('validateScripts — narration 길이 불일치면 throw', () => {
  const bad = structuredClone(okScripts);
  bad.midform.ko.narration = ['n'];
  assert.throws(() => validateScripts(bad), /narration/);
});

test('툴 스키마 — 3개 키 모두 required', () => {
  assert.deepEqual([...VIDEO_SCRIPT_TOOL.input_schema.required].sort(), ['chartData', 'midform', 'short'].sort());
});
