import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInterestKeywords } from '../src/experiments/trackCompare.js';
import { buildArm2SelectPrompt, ARM2_PICK_TOOL } from '../src/experiments/trackCompare.js';

test('extractInterestKeywords: 라벨과 대표 용어를 포함한 문자열', () => {
  const profile = {
    topicGroups: {
      cardiac_resus: { label: '심혈관·소생', weight: 1.0, terms: ['cardiac arrest', 'resuscitation', 'ecmo', 'stemi', 'cpr'] },
      sepsis_shock: { label: '패혈증·쇼크', weight: 1.0, terms: ['sepsis', 'septic shock', 'vasopressor'] },
    },
  };
  const out = extractInterestKeywords(profile);
  assert.match(out, /cardiac arrest/);
  assert.match(out, /sepsis/);
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 10);
});

test('extractInterestKeywords: 인자 없으면 config/interests.json 사용', () => {
  const out = extractInterestKeywords();
  assert.match(out, /sepsis|cardiac|resuscitation/i);
});

test('ARM2_PICK_TOOL: 필수 필드 스키마', () => {
  assert.equal(ARM2_PICK_TOOL.name, 'submit_track_pick');
  assert.deepEqual(ARM2_PICK_TOOL.input_schema.required, ['pmid', 'title', 'journal', 'whyChosen']);
});

test('buildArm2SelectPrompt: 창 날짜·관심·제외·가드 포함', () => {
  const p = buildArm2SelectPrompt({
    sinceDate: '2026-01-11',
    keywords: '패혈증: sepsis, septic shock',
    excludePmids: ['111', '222'],
  });
  assert.match(p, /2026-01-11/);          // 6개월 창
  assert.match(p, /sepsis/);               // 관심 힌트
  assert.match(p, /111/);                  // 제외 목록
  assert.match(p, /222/);
  assert.match(p, /PubMed/i);              // 실재 PMID 가드
  assert.match(p, /ONE/);                  // 정확히 1편
});

test('buildArm2SelectPrompt: 제외 없으면 안내 문구', () => {
  const p = buildArm2SelectPrompt({ sinceDate: '2026-01-11', keywords: 'x', excludePmids: [] });
  assert.match(p, /None/i);
});

import { parseYearMonth, verifyPick } from '../src/experiments/trackCompare.js';

test('parseYearMonth: 다양한 포맷', () => {
  assert.equal(parseYearMonth('2026-05').getUTCFullYear(), 2026);
  assert.equal(parseYearMonth('2026/05').getUTCMonth(), 4);
  assert.equal(parseYearMonth('2026-05-20').getUTCMonth(), 4);
  assert.equal(parseYearMonth('garbage'), null);
});

const paper = (over = {}) => ({ pmid: '900', title: 'T', journal: 'NEJM', pubDate: '2026-05', abstract: 'a', authors: [], meshTerms: [], keywords: [], doi: '', ...over });

test('verifyPick: 정상 → ok, paper 반환', async () => {
  const v = await verifyPick({ pmid: '900' }, {
    fetchArticles: async (ids) => [paper({ pmid: ids[0] })],
    sinceDate: '2026-01-01',
  });
  assert.equal(v.ok, true);
  assert.equal(v.paper.pmid, '900');
});

test('verifyPick: pmid 없음 → ok:false', async () => {
  const v = await verifyPick({ pmid: '' }, { fetchArticles: async () => [], sinceDate: '2026-01-01' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /pmid/i);
});

test('verifyPick: PubMed 미존재(빈 배열) → ok:false', async () => {
  const v = await verifyPick({ pmid: '900' }, { fetchArticles: async () => [], sinceDate: '2026-01-01' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not found|없|PubMed/i);
});

test('verifyPick: 6개월 창 밖 → ok:false', async () => {
  const v = await verifyPick({ pmid: '900' }, {
    fetchArticles: async () => [paper({ pubDate: '2025-01' })],
    sinceDate: '2026-01-01',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /window|창|old|date/i);
});

import { assembleRecord, upsertRecord, isPastEndDate } from '../src/experiments/trackCompare.js';

test('assembleRecord: 수렴 계산', () => {
  const r = assembleRecord({ date: '2026-07-14', arm1: { pmid: '5' }, arm2: { pmid: '5' } });
  assert.equal(r.converged, true);
  assert.equal(r.arm3, null);
});
test('assembleRecord: 발산·null', () => {
  assert.equal(assembleRecord({ date: 'd', arm1: { pmid: '5' }, arm2: { pmid: '9' } }).converged, false);
  assert.equal(assembleRecord({ date: 'd', arm1: { pmid: '5' }, arm2: null }).converged, false);
  assert.equal(assembleRecord({ date: 'd', arm1: null, arm2: null }).converged, false);
});
test('upsertRecord: 같은 날 교체', () => {
  let c = { records: [] };
  c = upsertRecord(c, { date: 'd1', arm1: { pmid: '1' } });
  c = upsertRecord(c, { date: 'd1', arm1: { pmid: '2' } });
  assert.equal(c.records.length, 1);
  assert.equal(c.records[0].arm1.pmid, '2');
});
test('upsertRecord: comparison 없으면 초기화', () => {
  const c = upsertRecord(undefined, { date: 'd1' });
  assert.equal(c.records.length, 1);
});
test('isPastEndDate', () => {
  assert.equal(isPastEndDate('2026-07-26', '2026-07-25'), true);
  assert.equal(isPastEndDate('2026-07-25', '2026-07-25'), false);
  assert.equal(isPastEndDate('2026-07-25', ''), false);
});

import { runOnce } from '../src/experiments/trackCompare.js';

const okPaper = { pmid: '900', title: 'T', journal: 'NEJM', pubDate: '2026-05', abstract: 'a', authors: [], meshTerms: [], keywords: [], doi: '' };
const analyzerStub = { _analyzeSinglePaper: async (p) => ({ pmid: p.pmid, title_ko: '제목', pico: {}, evidenceLevel: 'High', paper: p }) };
const collectorStub = { fetchArticles: async (ids) => [{ ...okPaper, pmid: ids[0] }] };
const base = { today: '2026-07-14', sinceDate: '2026-01-14', arm2History: [], comparison: { records: [] }, logger: { warn(){}, info(){} } };

test('runOnce: 정상 → arm2 분석 + 레코드', async () => {
  const llm = { callWithTool: async () => ({ pmid: '900', title: 'T', journal: 'NEJM', whyChosen: 'x' }) };
  const out = await runOnce({ ...base, arm1Entry: { pmid: '900' }, llm, collector: collectorStub, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, '900');
  assert.equal(out.record.converged, true);          // arm1도 900
  assert.equal(out.comparison.records.length, 1);
});

test('runOnce: 첫 픽 검증 실패 → 재시도 성공', async () => {
  let call = 0;
  const llm = { callWithTool: async () => (++call === 1 ? { pmid: 'bad', title: 'T', journal: 'J', whyChosen: 'x' } : { pmid: '900', title: 'T', journal: 'NEJM', whyChosen: 'x' }) };
  const collector = { fetchArticles: async (ids) => (ids[0] === '900' ? [{ ...okPaper }] : []) };
  const out = await runOnce({ ...base, arm1Entry: null, llm, collector, analyzer: analyzerStub });
  assert.equal(call, 2);
  assert.equal(out.arm2Pmid, '900');
});

test('runOnce: 재시도도 실패 → arm2=null (소프트)', async () => {
  const llm = { callWithTool: async () => ({ pmid: 'bad', title: 'T', journal: 'J', whyChosen: 'x' }) };
  const collector = { fetchArticles: async () => [] };
  const out = await runOnce({ ...base, arm1Entry: { pmid: '1' }, llm, collector, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, null);
  assert.equal(out.record.arm2, null);
  assert.equal(out.record.arm1.pmid, '1');
});

test('runOnce: llm 예외도 소프트(arm2=null)', async () => {
  const llm = { callWithTool: async () => { throw new Error('429'); } };
  const out = await runOnce({ ...base, arm1Entry: null, llm, collector: collectorStub, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, null);
});
