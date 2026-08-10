import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';

// 스코어러 v2 축 개편 — PeterJ 확정 규칙의 구현 + 진단 F3/F5/F6 해소.
//
// 계기(2026-08-10 실측, 배제 적용 후 상위 20):
//   · 서술 리뷰 6편이 상위 20에 있었다 — "GRP78 dysregulation: 종양미세환경" 분자생물학
//     리뷰까지. PeterJ 확정 ①은 "리뷰는 flagship(최상위 종합지)만 예외"인데 미구현이었다.
//   · "주제 10" 이 남발됐다(20편 중 8편). 제목 2히트면 만점이라 저널 0.8짜리가 상위권에 온다.
//   · Emergencias 합의문서가 `N≈1704632` — 배경 문장의 인구수를 표본으로 읽었다(F5).

const s = new MetadataScorer();
const paper = (o) => ({ pmid: '1', title: '', abstract: '', journal: '', publicationTypes: [], pubDate: '2026-08-01', ...o });

// ── 설계 축: 리뷰 티어 조건부 (PeterJ 확정 ①) ──────────────────────────────
test('설계: 서술 리뷰는 최상위 종합지에서만 대접받는다', () => {
  const inNejm = s.scoreOne(paper({ title: 'Sepsis review', journal: 'The New England journal of medicine', publicationTypes: ['Review'] }));
  const inCc   = s.scoreOne(paper({ title: 'Sepsis review', journal: 'Critical care (London, England)', publicationTypes: ['Review'] }));
  assert.ok(inNejm.designPart > inCc.designPart + 1.0,
    `최상위 리뷰 ${inNejm.designPart} vs 그 외 리뷰 ${inCc.designPart} — 차이가 없다`);
  assert.ok(inCc.designPart < 0.5, `그 외 서술 리뷰가 아직 후하다: ${inCc.designPart}`);
});

test('설계: RCT·메타분석이 서술 리뷰를 확실히 이긴다', () => {
  const rct = s.scoreOne(paper({ title: 'Sepsis trial', journal: 'Critical care medicine', publicationTypes: ['Randomized Controlled Trial'] }));
  const rev = s.scoreOne(paper({ title: 'Sepsis review', journal: 'Critical care medicine', publicationTypes: ['Review'] }));
  assert.ok(rct.designPart >= 2.0, `RCT 설계 점수가 낮다: ${rct.designPart}`);
  assert.ok(rct.rawScore - rev.rawScore > 1.5, `같은 저널에서 RCT 와 리뷰 차이가 작다: ${rct.rawScore} vs ${rev.rawScore}`);
});

test('설계: 체계적 문헌고찰은 서술 리뷰와 다르게 취급한다', () => {
  const sr = s.scoreOne(paper({ title: 'Sepsis', journal: 'Critical care medicine', publicationTypes: ['Systematic Review'] }));
  const rev = s.scoreOne(paper({ title: 'Sepsis', journal: 'Critical care medicine', publicationTypes: ['Review'] }));
  assert.ok(sr.designPart > rev.designPart + 1.0, '체계적 고찰이 서술 종설과 같이 취급된다');
});

test('★ 설계: 전문지 RCT 가 대표지 서술리뷰를 이긴다 (F4 — 설계 축 무력 해소)', () => {
  const specialtyRct = s.scoreOne(paper({ title: 'Sepsis vasopressor trial', journal: 'Journal of critical care', publicationTypes: ['Randomized Controlled Trial'] }));
  const flagshipReview = s.scoreOne(paper({ title: 'Sepsis vasopressor review', journal: 'Critical care medicine', publicationTypes: ['Review'] }));
  assert.ok(specialtyRct.rawScore > flagshipReview.rawScore,
    `전문지 RCT ${specialtyRct.rawScore} 가 대표지 리뷰 ${flagshipReview.rawScore} 에 진다`);
});

// ── 주제 축: 탈포화 (F3) ────────────────────────────────────────────────
test('주제: 제목 2히트로는 만점이 안 된다 (포화 해소)', () => {
  const two = s.scoreOne(paper({ title: 'Sepsis and septic shock', journal: 'Critical care medicine' }));
  assert.ok(two.relevanceScore < 9.0, `제목 2히트가 사실상 만점이다: ${two.relevanceScore}/10`);
});

test('주제: 히트가 쌓이면 만점에 도달한다 (탈포화지 배제가 아님)', () => {
  const many = s.scoreOne(paper({
    title: 'Sepsis and septic shock: vasopressor and fluid resuscitation with lactate targets',
    journal: 'Critical care medicine',
  }));
  assert.ok(many.relevanceScore >= 9.5, `히트가 많아도 만점에 못 간다: ${many.relevanceScore}/10`);
});

test('주제: 초록·MeSH 만 걸린 논문은 제목 히트 논문을 못 이긴다', () => {
  const titleHit = s.scoreOne(paper({ title: 'Septic shock trial', journal: 'Critical care medicine' }));
  const metaOnly = s.scoreOne(paper({ title: 'A study', abstract: 'sepsis septic shock vasopressor lactate hemodynamic', journal: 'Critical care medicine' }));
  assert.ok(titleHit.relevanceScore > metaOnly.relevanceScore, '제목 히트 우위가 사라졌다');
});

test('주제: 관심 0매칭은 여전히 게이트로 배제된다 (회귀)', () => {
  const off = s.scoreOne(paper({ title: 'Dermatology cosmetic outcomes', journal: 'Critical care medicine' }));
  assert.equal(off.gated, true);
  assert.ok(off.rawScore < 0, `관심 밖 논문이 양수다: ${off.rawScore}`);
});

// ── 최신성·표본 축 삭제 (F5·F6) ────────────────────────────────────────
test('★ 표본 축 삭제: 초록의 인구수 오추출이 점수에 영향을 주지 않는다 (F5)', () => {
  const bogus = s.scoreOne(paper({
    title: 'Accidental hypothermia consensus', journal: 'Critical care medicine',
    abstract: 'Hypothermia affects 1704632 patients worldwide each year. We present consensus recommendations.',
  }));
  const plain = s.scoreOne(paper({
    title: 'Accidental hypothermia consensus', journal: 'Critical care medicine',
    abstract: 'We present consensus recommendations.',
  }));
  assert.equal(bogus.rawScore, plain.rawScore, '표본수 추출이 아직 점수를 움직인다');
});

test('★ 최신성 축 삭제: 호 발행일 오독이 점수에 영향을 주지 않는다 (F6)', () => {
  const oldIssue = s.scoreOne(paper({ title: 'Septic shock trial', journal: 'Critical care medicine', pubDate: '2025-01' }));
  const fresh = s.scoreOne(paper({ title: 'Septic shock trial', journal: 'Critical care medicine', pubDate: '2026-08-09' }));
  assert.equal(oldIssue.rawScore, fresh.rawScore, '최신성이 아직 점수를 움직인다');
});

test('보조 축이 주제·저널을 넘지 않는다 (PeterJ 우선순위 ①주제 ②저널)', () => {
  const best = s.scoreOne(paper({
    title: 'Sepsis and septic shock: vasopressor, fluid resuscitation, lactate targets',
    journal: 'The New England journal of medicine', publicationTypes: ['Randomized Controlled Trial'],
  }));
  assert.ok(best.designPart <= 2.0, `보조 축(설계)이 2.0 을 넘는다: ${best.designPart}`);
  assert.ok(best.designPart < 4.0, '보조 축이 주제·저널 축(4.0)과 맞먹는다');
});
