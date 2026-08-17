import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { topicQuerySpecs, termClause, GUIDELINE_FORM_TERM } from '../src/utils/guidelineTopics.js';

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

// ── 검색축 빌더 (2026-08-17) ────────────────────────────────────────────────
// 이 설정은 08-15 에 만들어졌지만 **2026-08-17 까지 아무도 안 읽었다** —
// 저장소 전체에서 참조처가 이 테스트뿐이었고, 프로덕션 수집은 EM/CCM MeSH 8개에만
// 묶여 30일 창에서 8건을 건졌다. 아래 테스트들은 그 배선이 다시 끊기지 못하게 한다.

test('★ 주제 그룹마다 쿼리 하나가 나온다', async () => {
  const specs = topicQuerySpecs();
  assert.ok(specs.length >= 8, `그룹 수만큼 나와야 한다: ${specs.length}`);
  for (const spec of specs) {
    assert.match(spec.id, /^pubmed-topic:/);
    assert.equal(spec.discovery, 'pubmed-topic');
    assert.ok(spec.label, `${spec.id}: 라벨이 없다 — manifest 에서 어느 주제인지 못 읽는다`);
    // ★ 주제축만으로는 일반 논문이 딸려 온다. 지침 형식 축과 AND 로 묶여야 한다.
    assert.ok(spec.term.includes('AND ' + GUIDELINE_FORM_TERM),
      `${spec.id}: 지침 형식 축이 안 묶였다 — 주제만 맞는 논문이 전부 들어온다`);
    assert.ok(spec.term.includes('[Title]'), `${spec.id}: Title 축이 없다`);
  }
});

test('★ 넓은 단어가 쿼리에 안 들어간다 (PeterJ 확정 — 질병명 위주)', async () => {
  const term = topicQuerySpecs().map((s) => s.term).join(' ');
  for (const broad of ['"cardiac"[Title]', '"trauma"[Title]', '"airway"[Title]',
    '"transfusion"[Title]', '"triage"[Title]', '"resuscitation"[Title]']) {
    assert.ok(!term.includes(broad), `넓은 단어가 쿼리에 들어갔다: ${broad}`);
  }
  // 구체어는 그대로 있다
  assert.ok(term.includes('"cardiac arrest"[Title]'));
  assert.ok(term.includes('"massive transfusion"[Title]'));
});

test('★ excludeTitle 이 실제로 NOT 절이 된다', async () => {
  const term = topicQuerySpecs()[0].term;
  assert.match(term, / NOT \(/);
  assert.ok(term.includes('"veterinary"[Title]'), '수의학 배제가 쿼리에 안 붙었다');
});

test('★ 접두 stub 은 절단검색으로 나간다 (따옴표 안의 별표는 글자로 읽힌다)', async () => {
  assert.equal(termClause('antibiotic steward*', 'Title'), 'antibiotic steward*[Title]');
  assert.equal(termClause('cardiac arrest', 'Title'), '"cardiac arrest"[Title]');
  const term = topicQuerySpecs().map((s) => s.term).join(' ');
  assert.ok(!term.includes('"antibiotic steward*"'), '별표를 따옴표 안에 넣으면 0건이 된다');
});

test('★ MeSH 축은 설정 스위치를 따른다', async () => {
  const cfg = await load('guideline-topics.json');
  assert.equal(cfg.search.alsoSearchMeshTerms, true);
  assert.ok(topicQuerySpecs(cfg)[0].term.includes('[MeSH Terms]'));
  const off = structuredClone(cfg);
  off.search.alsoSearchMeshTerms = false;
  assert.ok(!topicQuerySpecs(off)[0].term.includes('[MeSH Terms]'));
});

test('★ 깨진 설정은 던진다 — 조용히 빈 축으로 돌면 0건과 구분이 안 된다', async () => {
  const cfg = await load('guideline-topics.json');
  const broken = structuredClone(cfg);
  broken.groups.cardiac_resus.terms = ['cardiac "arrest"'];
  assert.throws(() => topicQuerySpecs(broken), /따옴표/);
  const noTitle = structuredClone(cfg);
  noTitle.search.field = 'Title/Abstract';
  assert.throws(() => topicQuerySpecs(noTitle), /Title/);
});
