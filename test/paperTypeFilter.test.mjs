import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isGuidelineLikePublication,
  looksLikeCanonicalGuidelineTitle,
  excludeGuidelineLike,
  EXCLUDED_PUBLICATION_TYPES,
} from '../src/utils/paperTypeFilter.js';

/**
 * ★ PeterJ 실측 2026-08-18 — 논문 트랙이 뽑아 발행한 것이 AHA 소생술 지침이었다.
 *   같은 날 가이드라인 트랙은 따로 AHA/ASA 뇌졸중 지침을 냈다. 화면 두 곳이 지침을
 *   냈고 한쪽은 "논문" 이라는 이름표를 달고 있었다.
 *   지침은 저명 저널에 실리고 주제 적합도가 높아 **점수가 잘 나온다** — 걸러지기는커녕
 *   상위로 올라온다(그날 IF 35.5 Circulation).
 */

const AHA_PART9 = 'Part 9: Adult Advanced Life Support: 2025 American Heart Association Guidelines for Cardiopulmonary Resuscitation and Emergency Cardiovascular Care.';
const AHA_STROKE = '2026 Guideline for the Early Management of Patients With Acute Ischemic Stroke: A Guideline From the American Heart Association/American Stroke Association.';

test('★★ 실측 그 문서가 배제된다 (PublicationType)', () => {
  assert.equal(isGuidelineLikePublication({
    title: AHA_PART9, publicationTypes: ['Journal Article', 'Practice Guideline'],
  }), true);
});

test('★★ PT 가 아직 안 붙었어도 제목 정형으로 배제된다 (색인 지연 창)', () => {
  // 갓 나온 지침은 NLM 색인이 늦어 PT 가 비거나 Journal Article 만 달고 들어온다.
  // 논문 트랙은 최신순으로 캐므로 **바로 그 창에 걸린 문서를 만난다.**
  assert.equal(isGuidelineLikePublication({ title: AHA_PART9, publicationTypes: [] }), true);
  assert.equal(isGuidelineLikePublication({ title: AHA_STROKE, publicationTypes: ['Journal Article'] }), true);
});

test('★★ 지침을 "연구한" 논문은 살린다 (이 규칙의 존재 이유)', () => {
  const keep = [
    'Adherence to 2021 Surviving Sepsis Campaign guidelines in a tertiary ICU: a cohort study',
    'Effect of guideline-directed medical therapy on mortality: a randomized trial',
    'Comparison of ESC and AHA guidelines for anticoagulation in atrial fibrillation',
    'Implementation of sepsis guidelines in low-resource settings: a stepped-wedge trial',
  ];
  for (const t of keep) {
    assert.equal(looksLikeCanonicalGuidelineTitle(t), false, `죽으면 안 되는 논문이 배제됐다: ${t}`);
    assert.equal(isGuidelineLikePublication({ title: t, publicationTypes: ['Randomized Controlled Trial'] }), false);
  }
});

test('★ 메타분석·체계적 고찰은 살린다 (Review PT 를 자르면 통째로 사라진다)', () => {
  assert.equal(isGuidelineLikePublication({
    title: 'Low-dose corticosteroids in severe pulmonary infection: a meta-analysis',
    publicationTypes: ['Meta-Analysis', 'Review', 'Journal Article'],
  }), false);
  assert.ok(!EXCLUDED_PUBLICATION_TYPES.includes('review'),
    'Review 를 배제 목록에 넣으면 메타분석이 통째로 사라진다');
});

test('평범한 원저는 그대로', () => {
  assert.equal(isGuidelineLikePublication({
    title: 'Conservative Oxygen Therapy after Cardiac Arrest',
    publicationTypes: ['Randomized Controlled Trial', 'Journal Article'],
  }), false);
  assert.equal(isGuidelineLikePublication({}), false);
  assert.equal(isGuidelineLikePublication(null), false);
});

test('excludeGuidelineLike: 걷어낸 것을 함께 돌려준다 (조용히 사라지면 못 쫓는다)', () => {
  const { kept, dropped } = excludeGuidelineLike([
    { pmid: '1', title: 'A trial', publicationTypes: ['Randomized Controlled Trial'] },
    { pmid: '41122884', title: AHA_PART9, publicationTypes: ['Practice Guideline'] },
    { pmid: '3', title: 'Another trial', publicationTypes: [] },
  ]);
  assert.deepEqual(kept.map((k) => k.pmid), ['1', '3']);
  assert.deepEqual(dropped.map((d) => d.pmid), ['41122884']);
});

test('빈 입력에도 안 죽는다', () => {
  assert.deepEqual(excludeGuidelineLike(undefined), { kept: [], dropped: [] });
});

// ── 배선 계약 ────────────────────────────────────────────────────────────────
// "모듈은 옳은데 아무도 안 부른다" 가 이 저장소의 최다 반복 함정이다.
// 수집 모드가 셋이라 **모드마다 따로 걸면 새 모드가 생긴 날 조용히 빠진다.**
test('★★ 수집기의 모든 반환 경로가 필터를 태운다 (배선 계약)', () => {
  const src = readFileSync(new URL('../src/agents/DataCollectorAgent.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/utils\/paperTypeFilter\.js'/, '필터를 import 하지 않는다');
  assert.match(src, /_dropGuidelineLike\s*\(/, '필터 헬퍼가 없다');

  // run() 본문에서 papers 를 돌려주는 return 이 전부 헬퍼를 거치는가.
  const runStart = src.indexOf('  async run() {');
  const runEnd = src.indexOf('  async _runSingleCollection(');
  assert.ok(runStart > 0 && runEnd > runStart, 'run() 범위를 못 찾았다 — 이 검사를 갱신하라');
  const body = src.slice(runStart, runEnd);
  const returns = body.match(/return\s+(?:await\s+)?[^;]+;/g) ?? [];
  const paperReturns = returns.filter((r) => /papers|fallback|_runSingleCollection/.test(r));
  // ★ 대상을 4개 미만으로 찾으면 검사가 헛돌고 있는 것이다 — 이 저장소의 관례.
  assert.ok(paperReturns.length >= 4,
    `run() 의 논문 반환 지점을 ${paperReturns.length}개만 찾았다 — 검사가 헛돈다`);
  for (const r of paperReturns) {
    assert.match(r, /_dropGuidelineLike/,
      `필터를 안 거치는 반환 경로가 있다: ${r.slice(0, 90)}`);
  }
});

test('★ 가이드라인 트랙에는 이 필터를 걸지 않는다 (트랙1 전용)', () => {
  const src = readFileSync(new URL('../src/agents/DataCollectorAgent.js', import.meta.url), 'utf8');
  const gStart = src.indexOf('  async collectGuidelines(');
  assert.ok(gStart > 0, 'collectGuidelines 를 못 찾았다 — 개명했으면 이 검사도 갱신하라');
  // 다음 메서드 선언까지만 본다. 넉넉히 자르면 run() 을 삼켜 검사가 헛돈다.
  const rest = src.slice(gStart + 10);
  const gEnd = rest.search(/\n  (?:async )?[A-Za-z_][\w]*\s*\(/);
  assert.ok(gEnd > 0, 'collectGuidelines 의 끝을 못 찾았다');
  const gBody = rest.slice(0, gEnd);
  assert.ok(!gBody.includes('_dropGuidelineLike'),
    '가이드라인 수집에 지침 배제를 걸면 트랙2 가 통째로 빈다');
});
