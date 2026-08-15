import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 가이드라인 검색축 전용 목록. 논문 선정용 `interests.json` 과 **별개 파일**이다
// (PeterJ 확정 2026-08-15). 이 테스트는 그 분리가 조용히 무너지지 못하게 막는다.

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../config/${name}`, import.meta.url), 'utf8'));

test('가이드라인 주제 목록이 존재하고 형태가 맞다', async () => {
  const cfg = await load('guideline-topics.json');
  assert.equal(cfg.schemaVersion, 1);
  assert.ok(Object.keys(cfg.groups ?? {}).length >= 8, '그룹이 너무 적다');
  for (const [id, g] of Object.entries(cfg.groups)) {
    assert.ok(g.label, `${id}: label 없음`);
    assert.ok(Array.isArray(g.terms) && g.terms.length, `${id}: terms 비었음`);
    for (const t of g.terms) {
      assert.equal(typeof t, 'string');
      assert.equal(t, t.trim(), `${id}: 앞뒤 공백 — "${t}"`);
      assert.ok(t.length >= 3, `${id}: 너무 짧은 단어는 오탐을 부른다 — "${t}"`);
    }
  }
});

test('★ 검색 필드는 Title 이다 (초록까지 보면 38%가 곁가지로 들어온다)', async () => {
  const cfg = await load('guideline-topics.json');
  assert.equal(cfg.search.field, 'Title',
    'Title/Abstract 로 재니 2,894편 중 1,097편이 제목이 아니라 초록에서만 걸렸다');
});

test('★ 논문 선정용 interests.json 을 대체하지 않는다 (두 파일이 따로 산다)', async () => {
  const interests = await load('interests.json');
  assert.ok(interests.topicGroups, 'interests.json 의 topicGroups 가 사라졌다 — 논문 선정이 깨진다');
  assert.ok(interests.scoring, 'interests.json 의 scoring 이 사라졌다');
  // 논문 선정은 여전히 자기 목록을 쓴다.
  const paperTerms = Object.values(interests.topicGroups).flatMap((g) => g.terms ?? []);
  assert.ok(paperTerms.length >= 100, `논문 선정 주제어가 줄었다: ${paperTerms.length}`);
});

test('★ 검색축을 지배하던 넓은 단어를 지침 목록에서는 뺐다', async () => {
  const cfg = await load('guideline-topics.json');
  const terms = new Set(Object.values(cfg.groups).flatMap((g) => g.terms.map((t) => t.toLowerCase())));
  // 실측에서 단독으로 수십~백 건씩 끌어오던 것들. 구체어가 대신 덮는다.
  for (const broad of ['cardiac', 'trauma', 'airway', 'transfusion', 'triage',
    'emergency department', 'emergency medicine', 'acute care', 'critically ill',
    'intensive care unit', 'blunt', 'penetrating', 'resuscitation']) {
    assert.equal(terms.has(broad), false, `넓은 단어가 다시 들어왔다: "${broad}"`);
  }
});

test('구체어가 그 자리를 덮는다', async () => {
  const cfg = await load('guideline-topics.json');
  const terms = new Set(Object.values(cfg.groups).flatMap((g) => g.terms.map((t) => t.toLowerCase())));
  for (const specific of ['cardiac arrest', 'cardiopulmonary resuscitation', 'airway management',
    'massive transfusion', 'major trauma', 'penetrating trauma']) {
    assert.ok(terms.has(specific), `구체어가 없다: "${specific}"`);
  }
});

test('지침이 많이 나오는데 논문 목록에 없던 주제를 채웠다', async () => {
  const cfg = await load('guideline-topics.json');
  const terms = new Set(Object.values(cfg.groups).flatMap((g) => g.terms.map((t) => t.toLowerCase())));
  for (const added of ['delirium', 'acute kidney injury', 'poisoning', 'neuroprognostication',
    'anticoagulation reversal', 'nutrition support', 'hyperkalemia']) {
    assert.ok(terms.has(added), `보강 주제가 빠졌다: "${added}"`);
  }
});

test('중복 주제어가 없다', async () => {
  const cfg = await load('guideline-topics.json');
  const all = Object.values(cfg.groups).flatMap((g) => g.terms.map((t) => t.toLowerCase()));
  const dup = all.filter((t, i) => all.indexOf(t) !== i);
  assert.deepEqual([...new Set(dup)], [], '중복 주제어는 쿼리만 길게 만든다');
});
