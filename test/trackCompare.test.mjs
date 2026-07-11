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
