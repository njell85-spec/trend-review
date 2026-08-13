import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';

const scorer = new MetadataScorer();
const paper = (journal) => ({ journal });

test('저널 exact 우선: 부분일치 오탐 방지와 대표지 유지', () => {
  const nursing = scorer._journalScore(paper('Intensive & critical care nursing'));
  assert.equal(nursing.excluded, true);

  assert.equal(scorer._journalScore(paper('Current opinion in critical care')).score, 0.8);
  assert.equal(scorer._journalScore(paper('J Am Coll Clin Pharm')).score, 0.8);
  assert.equal(scorer._journalScore(paper('Critical Care Medicine')).score, 3.2);
});

test('DEFAULT_QUERY에 sepsis MeSH 독립항이 없다', () => {
  const source = readFileSync(new URL('../src/agents/DataCollectorAgent.js', import.meta.url), 'utf8');
  const query = source.match(/const DEFAULT_QUERY\s*=\s*([\s\S]*?);/)?.[1] ?? '';
  assert.doesNotMatch(query, /["']sepsis["']\[MeSH\]/i);
});

test('stream B 설계 필터에 guideline이 없다', () => {
  const collection = JSON.parse(readFileSync(new URL('../config/collection.json', import.meta.url), 'utf8'));
  assert.deepEqual(collection.streamB.designTypes, [
    'randomized controlled trial',
    'meta-analysis',
    'systematic review',
  ]);
  assert.equal(collection.streamB.designTypes.some((type) => /guideline/i.test(type)), false);
});
