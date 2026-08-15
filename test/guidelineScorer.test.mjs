import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGuidelineOrgs, matchOrganization, validateGuidelineOrgs } from '../src/utils/guidelineOrgs.js';
import { scoreGuideline, suggestStatus } from '../src/utils/GuidelineScorer.js';

const interests = JSON.parse(await readFile(new URL('../config/interests.json', import.meta.url), 'utf8'));

function config() {
  return loadGuidelineOrgs();
}

function candidate(overrides = {}) {
  return {
    title: 'AHA Scientific Statement on Cardiac Arrest and Resuscitation',
    abstract: 'Recommendations for post-cardiac arrest intensive care.',
    meshTerms: ['Heart Arrest', 'Cardiopulmonary Resuscitation'],
    pubDate: new Date().toISOString().slice(0, 10),
    discoveredBy: ['pubmed-title'],
    signals: { normativeContent: true },
    ...overrides,
  };
}

function minimalConfig(organizations) {
  return {
    schemaVersion: 1,
    policy: {
      authorityWeight: 1, topicWeight: 1, recencyWeight: 1,
      unmatchedTier1Policy: 'needsReview', autoPublishThreshold: 6, reviewThreshold: 3,
    },
    organizations,
  };
}

function org(id, sources = [], extra = {}) {
  return {
    id, name: id, aliases: [], tier: 1, authorityScore: 4,
    domains: [], pubmedMatchers: {}, sources, ...extra,
  };
}

test('권위 우선과 주제 우선은 설정만 바꿔 후보 순위를 뒤집는다', () => {
  const orgs = config();
  const tier1Peripheral = candidate({
    title: 'AHA Scientific Statement on Population Wellness', abstract: '', meshTerms: [],
  });
  const tier2Topical = candidate({
    title: 'Neurocritical Care Society Clinical Practice Recommendations for Stroke',
    abstract: 'Stroke thrombectomy and thrombolysis recommendations.', meshTerms: ['Stroke'],
  });

  orgs.policy.authorityWeight = 2;
  orgs.policy.topicWeight = 0.25;
  const authorityRanking = [tier1Peripheral, tier2Topical]
    .map((item) => scoreGuideline(item, { orgs, interests }).priority);
  assert.ok(authorityRanking[0] > authorityRanking[1]);

  orgs.policy.authorityWeight = 0.25;
  orgs.policy.topicWeight = 2;
  const topicRanking = [tier1Peripheral, tier2Topical]
    .map((item) => scoreGuideline(item, { orgs, interests }).priority);
  assert.ok(topicRanking[0] < topicRanking[1]);
});

test('주제 무매칭 tier-1은 기본 정책에서 needsReview에 보존된다', () => {
  const orgs = config();
  const scored = scoreGuideline(candidate({ title: 'AHA Statement on Population Wellness', abstract: '', meshTerms: [] }), { orgs, interests });
  assert.equal(suggestStatus(scored, { policy: orgs.policy, topicMatched: false, tier: 1 }), 'needsReview');
});

test('unmatchedTier1Policy만 queue로 바꾸면 같은 후보가 queued가 된다', () => {
  const orgs = config();
  const scored = scoreGuideline(candidate({ title: 'AHA Statement on Population Wellness', abstract: '', meshTerms: [] }), { orgs, interests });
  orgs.policy.unmatchedTier1Policy = 'queue';
  assert.equal(suggestStatus(scored, { policy: orgs.policy, topicMatched: false, tier: 1 }), 'queued');
});

test('저널, 연구설계, 표본 크기는 priority에 전혀 들어가지 않는다', () => {
  const orgs = config();
  const first = scoreGuideline(candidate({ journal: 'New England Journal of Medicine', studyType: 'RCT', sampleSize: 50000 }), { orgs, interests });
  const second = scoreGuideline(candidate({ journal: 'Unknown Journal', studyType: 'case report', sampleSize: 1 }), { orgs, interests });
  assert.equal(first.priority, second.priority);
  assert.deepEqual(first.breakdown, second.breakdown);
});

test('기관 매칭은 제목·소속과 sourceUrl 도메인을 구분해 보고한다', () => {
  const orgs = config();
  assert.deepEqual(matchOrganization({ title: 'ACEP Clinical Policy' }, orgs), { organizationId: 'acep', matchedBy: 'title' });
  assert.deepEqual(matchOrganization({ affiliations: ['Infectious Diseases Society of America'] }, orgs), { organizationId: 'idsa', matchedBy: 'affiliation' });
  assert.deepEqual(matchOrganization({ sourceUrl: 'https://cpr.heart.org/example' }, orgs), { organizationId: 'aha', matchedBy: 'sourceUrl' });
  assert.equal(matchOrganization({ title: 'heart.org is mentioned only in title' }, orgs), null);
});

test('검증기는 중복 organization id를 즉시 거부한다', () => {
  assert.throws(() => validateGuidelineOrgs(minimalConfig([org('same'), org('same')])) , /중복 organization id/);
});

test('검증기는 기관을 가로지르는 중복 source id를 거부한다', () => {
  const source = { id: 'global', type: 'manual-seed', url: 'https://example.org/seed' };
  assert.throws(() => validateGuidelineOrgs(minimalConfig([org('one', [source]), org('two', [{ ...source }])])) , /중복 source id/);
});

test('검증기는 알 수 없는 adapter를 거부한다', () => {
  const source = { id: 'bad-adapter', type: 'magic-html', url: 'https://example.org/list' };
  assert.throws(() => validateGuidelineOrgs(minimalConfig([org('one', [source])])) , /알 수 없는 adapter/);
});

test('검증기는 http(s)가 아닌 source URL을 거부한다', () => {
  const source = { id: 'bad-url', type: 'rss', url: 'ftp://example.org/feed' };
  assert.throws(() => validateGuidelineOrgs(minimalConfig([org('one', [source])])) , /http\(s\) URL/);
});

test('검증기는 tier와 authorityScore의 단조성 위반을 거부한다', () => {
  const organizations = [org('tier1', [], { authorityScore: 2 }), org('tier2', [], { tier: 2, authorityScore: 3 })];
  assert.throws(() => validateGuidelineOrgs(minimalConfig(organizations)), /단조성/);
});

test('검증기는 허용되지 않은 tier-1 무매칭 정책을 거부한다', () => {
  const cfg = minimalConfig([org('one')]);
  cfg.policy.unmatchedTier1Policy = 'publish';
  assert.throws(() => validateGuidelineOrgs(cfg), /needsReview, queue, reject/);
});

for (const documentType of [
  'consensus statement',
  'scientific statement',
  'focused update',
  'clinical practice recommendations',
]) {
  test(`확장 문서 유형 양성 fixture가 기관·주제 점수를 받는다: ${documentType}`, () => {
    const orgs = config();
    const scored = scoreGuideline(candidate({
      title: `AHA ${documentType} for cardiac arrest resuscitation`,
      abstract: 'Cardiac arrest and resuscitation recommendations.',
    }), { orgs, interests });
    assert.equal(scored.organizationId, 'aha');
    assert.equal(scored.breakdown.authority, 4);
    assert.ok(scored.breakdown.topic > 0);
    assert.ok(scored.priority > 0);
  });
}

// ── 세션 검수에서 추가한 것 ────────────────────────────────────────────────
// 하청 산출물에는 `suggestStatus` 가 tier·topicMatched 를 **호출자에게서만** 받는
// 경로가 있었다. G7 이 배선할 때 하나만 빠뜨려도 ②-C(주제 무매칭 tier-1 보존)가
// 아무 신호 없이 안 걸린다. 점수기가 길목에서 계산해 함께 내보내도록 고쳤다.

test('②-C 안전장치: 호출자가 tier·topicMatched 를 안 넘겨도 무매칭 tier-1 은 보존된다', () => {
  const orgs = config();
  const scored = scoreGuideline(
    candidate({ title: 'AHA Statement on Population Wellness', abstract: '', meshTerms: [] }),
    { orgs, interests },
  );
  assert.equal(scored.tier, 1, '점수기가 기관 tier 를 함께 내보내야 한다');
  assert.equal(scored.topicMatched, false);
  assert.equal(suggestStatus(scored, { policy: orgs.policy }), 'needsReview',
    '인자를 빠뜨리면 임계값 분기로 새어 rejected 가 된다 — ②-C 위반');
});

test('②-C 안전장치: 호출자가 명시로 넘기면 그 값이 이긴다', () => {
  const orgs = config();
  const scored = scoreGuideline(
    candidate({ title: 'AHA Statement on Population Wellness', abstract: '', meshTerms: [] }),
    { orgs, interests },
  );
  assert.equal(suggestStatus(scored, { policy: orgs.policy, topicMatched: true }), 'queued',
    '주제가 맞는다고 넘기면 정상 임계값 분기를 탄다');
});

test('검증기: manual-seed 는 URL 없이도 통과한다 (자동 수집 불가 기관 표시)', () => {
  const cfg = minimalConfig([org('one', [{ id: 'seed-only', type: 'manual-seed' }])]);
  assert.equal(validateGuidelineOrgs(cfg), cfg);
});

test('검증기: manual-seed 라도 URL 을 적었으면 형식을 검사한다', () => {
  const cfg = minimalConfig([org('one', [{ id: 'seed-bad', type: 'manual-seed', url: 'not-a-url' }])]);
  assert.throws(() => validateGuidelineOrgs(cfg), /http\(s\) URL/);
});
