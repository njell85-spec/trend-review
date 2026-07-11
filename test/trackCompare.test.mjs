import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInterestKeywords } from '../src/experiments/trackCompare.js';

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
