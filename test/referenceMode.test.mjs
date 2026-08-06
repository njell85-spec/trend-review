/**
 * On-demand 범용 참고자료 모드 (`kind=reference`) — 회귀 테스트.
 *
 * 계획: docs/superpowers/plans/2026-08-06-ondemand-reference-mode.md
 *
 * 이 모드의 유일한 치명적 실패는 "없는 권위를 지어내는 것"이다. 그래서 검증의 무게는
 *   ① 출처 성격 필드(sourceNote_ko)가 스키마·프롬프트·카드에 실제로 존재하는가
 *   ② guideline 모드가 한 글자도 안 바뀌었는가 (데일리 코어 불변식)
 *   ③ 캐시키가 모드별로 갈리는가 (같은 URL을 두 모드로 돌릴 때 결과 재사용 방지)
 * 세 가지에 있다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const agent = new GuidelineAnalyzerAgent();
const pub = new GitHubPublisher({ token: 't', owner: 'o', repo: 'r' });

const WEB_DOC = {
  pmid: '',
  sourceId: 'web:example-org-guide',
  sourceUrl: 'https://example.org/guide',
  title: 'Some Clinical Reference',
  authors: [],
  journal: 'example.org',
  pubDate: '2026-03',
  meshTerms: [],
  abstract: 'Body text about vasopressors.',
  fullText: '',
  fullTextSource: 'none',
};

// ── ① 툴 스키마 ──────────────────────────────────────────────────────────────

test('reference 모드 툴: sourceNote_ko 를 필수로 요구한다', () => {
  const tool = agent._tool('reference');
  const props = tool.input_schema.properties;
  assert.ok(props.sourceNote_ko, 'sourceNote_ko 필드가 없다 — 이 모드의 존재 이유');
  assert.ok(
    tool.input_schema.required.includes('sourceNote_ko'),
    'sourceNote_ko 가 required 가 아니면 LLM 이 조용히 생략한다',
  );
  // 모르면 모른다고 적게 하는 지시가 설명에 있어야 한다.
  assert.match(props.sourceNote_ko.description, /모르|불명|확인되지 않/);
});

test('reference 모드 툴: keyChanges 를 요구하지 않는다 (가이드라인 전용 축)', () => {
  const tool = agent._tool('reference');
  assert.equal(tool.input_schema.properties.keyChanges, undefined);
  assert.ok(!tool.input_schema.required.includes('keyChanges'));
});

test('guideline 모드 툴은 종전과 동일하다 (데일리 코어 불변)', () => {
  const tool = agent._tool('guideline');
  assert.equal(tool.name, 'submit_guideline_catchup');
  assert.ok(tool.input_schema.required.includes('keyChanges'));
  assert.equal(tool.input_schema.properties.sourceNote_ko, undefined,
    'guideline 카드에 참고자료 전용 필드가 새면 안 된다');
});

test('_tool() 기본값은 guideline 이다 (인자 없는 기존 호출부 보호)', () => {
  assert.deepEqual(agent._tool(), agent._tool('guideline'));
});

// ── ② 프롬프트 ───────────────────────────────────────────────────────────────

test('reference 프롬프트: 출처 신뢰도를 캐묻고, 가이드라인 어휘를 쓰지 않는다', () => {
  const p = agent._prompt(WEB_DOC, 'reference');
  assert.match(p, /peer[- ]?review/i, '동료심사 여부를 묻지 않는다');
  assert.match(p, /sourceNote_ko/);
  assert.ok(!/GUIDELINE CATCH-UP/i.test(p), '가이드라인 브리프 지시가 새어 들어갔다');
  // PeterJ 가 직접 고른, 공인되지 않았을 수 있는 출처라는 전제가 프롬프트에 있어야 한다.
  assert.match(p, /not (necessarily )?(be )?authoritative|may not be authoritative|user-selected/i);
});

test('reference 프롬프트: 출처 URL 을 직접 읽으라고 지시한다', () => {
  const p = agent._prompt(WEB_DOC, 'reference');
  assert.ok(p.includes(WEB_DOC.sourceUrl), 'Source URL 이 프롬프트에 없다');
});

test('guideline 프롬프트는 종전대로 변경점을 요구한다', () => {
  const p = agent._prompt(WEB_DOC, 'guideline');
  assert.match(p, /keyChanges/);
  assert.match(p, /GUIDELINE CATCH-UP/i);
});

// ── ③ 캐시키 ─────────────────────────────────────────────────────────────────

test('캐시키가 모드별로 갈린다 — 같은 URL 의 두 모드가 결과를 공유하면 안 된다', () => {
  const g = agent._cacheKey(WEB_DOC, 'guideline');
  const r = agent._cacheKey(WEB_DOC, 'reference');
  assert.notEqual(g, r, '모드가 캐시키에 없다 — 먼저 돌린 쪽 결과가 재사용된다');
  assert.ok(g.includes(WEB_DOC.sourceId) && r.includes(WEB_DOC.sourceId));
});

test('PMID 없는 웹 문서도 캐시키가 충돌하지 않는다 (sourceId 폴백)', () => {
  const a = agent._cacheKey({ ...WEB_DOC, sourceId: 'web:a' }, 'reference');
  const b = agent._cacheKey({ ...WEB_DOC, sourceId: 'web:b' }, 'reference');
  assert.notEqual(a, b);
});

// ── ④ 카드 ───────────────────────────────────────────────────────────────────

const REF_CARD = {
  type: 'reference',
  paper: { pmid: '', title: 'Some Clinical Reference', journal: 'example.org', pubDate: '2026-03', sourceUrl: 'https://example.org/guide', sourceId: 'web:example-org-guide' },
  org: 'example.org', version: '2026-03', title_ko: '어떤 임상 참고자료',
  scope_ko: '승압제 사용에 관한 웹 문서.',
  summary: ['Norepinephrine first line.'], summary_ko: ['노르에피네프린 1차.'],
  sourceNote_ko: '동료심사를 거치지 않은 기관 웹 문서이며, 인용된 1차 근거가 표기되어 있지 않다.',
  practiceImpact: 'Use as orientation only.', practiceImpact_ko: '방향 참고용으로만 쓴다.',
  sources: [{ label: '원문', url: 'https://example.org/guide' }],
};

test('참고자료 카드: 🔖 배지와 출처 성격 블록이 렌더된다', () => {
  const html = pub._buildGuidelineCard(REF_CARD);
  assert.match(html, /🔖 참고자료/, '참고자료 배지가 없다');
  assert.ok(!html.includes('📋 가이드라인'), '가이드라인 배지가 같이 나오면 안 된다');
  assert.ok(html.includes(REF_CARD.sourceNote_ko), '출처 성격 본문이 카드에 없다');
  assert.match(html, /출처 성격/, '출처 성격 라벨이 없다');
});

test('참고자료 카드: 가이드라인 전용 문구가 새지 않는다', () => {
  const html = pub._buildGuidelineCard(REF_CARD);
  assert.ok(!/이전 판 대비/.test(html), '변경점 섹션은 참고자료에 무의미하다');
  assert.ok(!/가이드라인 캐치업/.test(html), '푸터가 가이드라인 문구다');
});

test('가이드라인 카드는 종전 그대로 렌더된다 (회귀)', () => {
  const g = {
    type: 'guideline',
    paper: { pmid: '41236566', title: 'ESICM shock', journal: 'ICM', pubDate: '2026-07' },
    org: 'ESICM', version: '2025', title_ko: '순환쇼크 지침',
    summary: ['Target MAP 65.'], summary_ko: ['MAP 65 목표.'],
    keyChanges: [{ topic: '승압제', detail: 'A → B', detail_ko: 'A → B' }],
    practiceImpact: 'x', practiceImpact_ko: 'x', sources: [],
  };
  const html = pub._buildGuidelineCard(g);
  assert.match(html, /📋 가이드라인/);
  assert.match(html, /이전 판 대비 주요 변경점/);
  assert.match(html, /가이드라인 캐치업/);
  assert.ok(!/🔖 참고자료/.test(html));
  assert.ok(!/출처 성격/.test(html));
});

test('type 이 없는 구 카드는 가이드라인으로 취급한다 (배포된 상태 하위호환)', () => {
  const legacy = {
    paper: { pmid: '1', title: 't', journal: 'j' },
    summary: [], summary_ko: [], keyChanges: [], practiceImpact: '', practiceImpact_ko: '', sources: [],
  };
  const html = pub._buildGuidelineCard(legacy);
  assert.match(html, /📋 가이드라인/);
});

// ── ⑤ 위젯 ───────────────────────────────────────────────────────────────────

test('위젯: URL 은 통과하되 kind 를 강제하지 않는다 (guideline/reference 선택)', () => {
  const src = pub._onDemandWidget();
  const m = src.match(/function classify\(v\)\{[\s\S]*?\n {2}\}/);
  assert.ok(m, 'classify() 추출 실패');
  // eslint-disable-next-line no-new-func
  const classify = new Function(`${m[0]}; return classify;`)();
  const c = classify('https://example.org/guide');
  assert.equal(c.ok, true);
  assert.equal(c.isUrl, true);
  // reference 모드가 생겼으므로 guideline 단일 강제는 더 이상 옳지 않다.
  assert.equal(c.kind, undefined, 'URL 의 종류는 사용자가 고른다');
  assert.equal(classify('41236566').ok, true);
  assert.equal(classify('sepsis').ok, false);
});
