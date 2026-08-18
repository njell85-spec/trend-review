import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuidelineAnalyzerAgent, REVIEW_THIN_BODY_CHARS } from '../src/agents/GuidelineAnalyzerAgent.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

// 트랙3(리뷰) 전용 번역 모드 — PeterJ 확정 2026-08-17:
//   "리뷰는 있는그대로 번역 제시. 원문 확보 어려우면 웹서칭통해서라도."
// 종전에는 `reference`(직접 지정 자료용)를 빌려 써서 **요약**이 나왔고, NEJM·Lancet 급
// 종설에 불필요한 '출처 성격' 평가가 붙었다. 이 파일은 세 트랙의 축이 섞이지 못하게 한다.

const agent = () => new GuidelineAnalyzerAgent({ llm: { callWithTool: async () => ({}) } });
const doc = { pmid: '1', title: 'Airway management in the critically ill', journal: 'ICM', abstract: 'A narrative review.', doi: '10.1/x' };

test('★ 세 모드가 서로 다른 도구를 쓴다 (축이 섞이면 안 된다)', () => {
  const a = agent();
  assert.equal(a._tool('guideline').name, 'submit_guideline_catchup');
  assert.equal(a._tool('reference').name, 'submit_reference_brief');
  assert.equal(a._tool('review').name, 'submit_review_translation');
});

test('★ 리뷰 도구는 요약(summary)·변경점(keyChanges)·출처평가(sourceNote)를 안 받는다', () => {
  const props = agent()._tool('review').input_schema.properties;
  for (const gone of ['summary', 'summary_ko', 'keyChanges', 'sourceNote_ko']) {
    assert.ok(!(gone in props), `리뷰 도구에 ${gone} 이 있다 — 번역이 요약으로 되돌아간다`);
  }
  assert.ok('sections' in props, '절별 번역 축이 없다');
  assert.ok('coverage' in props, '무엇을 보고 옮겼는지 남길 축이 없다');
  assert.deepEqual(props.coverage.enum, ['full-text', 'web-augmented', 'abstract-only']);
  assert.deepEqual(agent()._tool('review').input_schema.required.sort(),
    ['coverage', 'pmid', 'scope_ko', 'sections', 'title_ko']);
});

test('★ 리뷰 프롬프트가 요약을 금지하고 원문 확보를 지시한다', () => {
  const p = agent()._prompt(doc, 'review');
  assert.match(p, /TRANSLATION TASK, NOT A SUMMARY/i, '요약 금지 지시가 없다');
  assert.match(p, /WebSearch|WebFetch/, '원문 확보 어려울 때 웹서치 지시가 없다');
  assert.match(p, /source's OWN section order/i, '원문 절 순서를 따르라는 지시가 없다');
  assert.doesNotMatch(p, /previous version/i === null ? /$^/ : /changes versus the previous version(?! —)/i,
    '이전 판 변경점 축이 새어 들어왔다');
  // 가이드라인 프롬프트와 확실히 다른 문서여야 한다
  assert.notEqual(p, agent()._prompt(doc, 'guideline'));
  assert.notEqual(p, agent()._prompt(doc, 'reference'));
});

test('★ _toCard 가 리뷰를 review 타입으로 내고 축만 싣는다', () => {
  const card = agent()._toCard(doc, {
    title_ko: '중환자 기도관리', scope_ko: '성인 중환자',
    coverage: 'full-text',
    sections: [{ heading_ko: '서론', body_ko: '첫 문단\n둘째 문단' }, { heading_ko: '빈 절', body_ko: '  ' }],
    practiceImpact_ko: '침상에서 이렇게 바뀐다',
  }, 'review');
  assert.equal(card.type, 'review');
  assert.equal(card.sections.length, 1, '본문 없는 절은 버려야 한다 — 빈 줄이 카드에 뜬다');
  assert.equal(card.coverage, 'full-text');
  assert.ok(!('keyChanges' in card), '리뷰에 이전 판 변경점 축이 붙었다');
  assert.ok(!('sourceNote_ko' in card), '리뷰에 출처 성격 축이 붙었다');
});

test('★ coverage 는 화이트리스트 밖 값을 믿지 않는다', () => {
  const card = agent()._toCard(doc, { coverage: 'i-read-everything', sections: [] }, 'review');
  assert.equal(card.coverage, 'abstract-only', '모르는 값을 그대로 실으면 카드가 거짓말을 한다');
});

// ── 렌더 ─────────────────────────────────────────────────────────────────────
const pub = () => new GitHubPublisher({ owner: 'o', repo: 'r', token: 't' });
const reviewCard = (over = {}) => ({
  type: 'review', title_ko: '중환자 기도관리', scope_ko: '성인 중환자',
  paper: { pmid: '1', title: 'Airway management', journal: 'Intensive Care Med', pubDate: '2026-08-01' },
  coverage: 'full-text',
  sections: [{ heading_ko: '서론', body_ko: '첫 문단입니다.\n둘째 문단입니다.' }],
  // ★ summary 를 **일부러 넣는다.** 리뷰 카드는 이 값이 있어도 요약 라벨을 그리면 안 된다.
  //   안 넣으면 "요약 라벨을 안 쓴다" 검사가 빈 값 때문에 통과해서, 렌더러가 리뷰에도
  //   요약을 그리도록 되돌아가도 초록이 된다(변이 주입으로 실측).
  summary: ['Give oxygen'], summary_ko: ['산소를 준다'],
  practiceImpact_ko: '침상 적용', ...over,
});

test('★ 리뷰 카드가 절별 번역을 그리고 요약 라벨을 안 쓴다', () => {
  const html = pub()._buildGuidelineCard(reviewCard());
  assert.match(html, /📰 리뷰 아티클/);
  assert.match(html, /본문 번역/);
  assert.match(html, /서론/);
  assert.match(html, /첫 문단입니다/);
  assert.match(html, /둘째 문단입니다/, '문단 줄바꿈이 사라졌다');
  assert.doesNotMatch(html, /핵심 권고|핵심 내용/, '요약 라벨이 리뷰 카드에 떴다');
  assert.doesNotMatch(html, /출처 성격/, '참고자료 축이 리뷰 카드에 떴다');
  assert.match(html, /리뷰 아티클 번역/, '푸터가 트랙을 안 밝힌다');
});

test('★ 초록만 봤으면 카드가 그렇게 말한다 (전문을 옮긴 척하지 않는다)', () => {
  const html = pub()._buildGuidelineCard(reviewCard({ coverage: 'abstract-only' }));
  assert.match(html, /초록 범위/);
  const full = pub()._buildGuidelineCard(reviewCard({ coverage: 'full-text' }));
  assert.doesNotMatch(full, /초록 범위/, '전문을 봤는데 경고가 떴다');
  const web = pub()._buildGuidelineCard(reviewCard({ coverage: 'web-augmented' }));
  assert.match(web, /웹에서 본문을 확보/);
});

test('★ 절을 하나도 못 얻으면 지어내지 말고 그 사실을 적는다', () => {
  const html = pub()._buildGuidelineCard(reviewCard({ sections: [], summary: [], summary_ko: [] }));
  assert.match(html, /본문을 확보하지 못해/);
});

// ★ 구판 보존 (확정 ③-C). 2026-08-17 이전 리뷰는 reference 모드로 만들어져 sections 가
//   없고 summary 만 있다. 새 축만 그리면 그 카드들의 내용이 화면에서 사라진다.
test('★ 구판 리뷰 카드(sections 없음)는 내용을 잃지 않는다', () => {
  const html = pub()._buildGuidelineCard(reviewCard({ sections: [] }));
  assert.match(html, /📰 리뷰 아티클/, '리뷰 트랙 표기는 유지되어야 한다');
  assert.match(html, /핵심 내용/, '구판 요약을 그릴 자리가 없다');
  assert.match(html, /산소를 준다/, '구판 카드의 내용이 사라졌다');
  assert.doesNotMatch(html, /본문을 확보하지 못해/, '내용이 있는데 폴백 문구가 떴다');
});

test('★ 가이드라인·참고자료 카드는 그대로다 (축이 새면 안 된다)', () => {
  const gl = pub()._buildGuidelineCard({
    type: 'guideline', title_ko: '패혈증 지침', paper: { pmid: '2', title: 'Sepsis', journal: 'ICM' },
    summary: ['Give norepinephrine'], summary_ko: ['노르에피네프린'],
    keyChanges: [{ topic: '승압제', detail: 'a→b', detail_ko: 'a→b' }],
  });
  assert.match(gl, /📋 가이드라인/);
  assert.match(gl, /핵심 권고/);
  assert.match(gl, /이전 판 대비 주요 변경점/);
  assert.doesNotMatch(gl, /본문 번역/, '리뷰 축이 가이드라인 카드에 샜다');

  const ref = pub()._buildGuidelineCard({
    type: 'reference', title_ko: '참고', paper: { pmid: '3', title: 'Ref', journal: 'J' },
    summary: ['x'], summary_ko: ['ㄱ'], sourceNote_ko: '학회 웹문서',
  });
  assert.match(ref, /🔖 참고자료/);
  assert.match(ref, /출처 성격/);
  assert.doesNotMatch(ref, /본문 번역/, '리뷰 축이 참고자료 카드에 샜다');
});

// ── 배선 회귀 ────────────────────────────────────────────────────────────────
test('★ 데일리와 on-demand 가 둘 다 review 모드를 부른다 (reference 로 되돌아가면 안 된다)', async () => {
  const { readFile } = await import('node:fs/promises');
  const orch = await readFile(new URL('../src/orchestrator/TrendReviewOrchestrator.js', import.meta.url), 'utf8');
  const od = await readFile(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  const analyzeReview = orch.slice(orch.indexOf('async _analyzeReview'), orch.indexOf('async _stageReview'));
  assert.match(analyzeReview, /mode: 'review'/, '데일리 리뷰가 아직 reference 모드다');
  assert.match(od, /REVIEW_KIND[\s\S]{0,2000}?mode: 'review'/, 'on-demand 리뷰가 아직 reference 모드다');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2026-08-18 실측 후속 — "초록 치환" 방지 (검색 사다리 · 보강 구분 · 실질 게이트)
// PeterJ: "리뷰 초록만 있으면 내용이 너무 부실한데 웹서칭 등으로 보강이 안되나??"
// 실측: Lancet Seminar "Sepsis"(PMID 41765030) 카드가 sections 본문 합 1,119자로 발행됨.
// ═══════════════════════════════════════════════════════════════════════════════

// 인메모리 캐시 — 디스크(output/cache)를 건드리지 않고 set/get 을 관찰한다.
const memCache = () => {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); },
    getOrFetch: async (k, fn) => {
      if (store.has(k)) return { data: store.get(k), fromCache: true };
      const data = await fn();
      if (data !== undefined) store.set(k, data);
      return { data, fromCache: false };
    },
  };
};

// LLM 스텁 주입 에이전트 — 실제 네트워크 금지. retry 는 지연 없는 통과로 갈아끼운다
// (실물 RetryHelper 는 실패 시 3초 백오프라 테스트가 느려진다).
const mkAgent = (callWithTool) => {
  const a = new GuidelineAnalyzerAgent({ llm: { callWithTool }, cache: memCache() });
  a.retry = { execute: (fn) => fn() };
  return a;
};

const secOf = (chars) => [{ heading_ko: '본문', body_ko: '가'.repeat(chars) }];
const reviewData = (chars, over = {}) => ({
  pmid: '1', title_ko: '패혈증', scope_ko: '성인 패혈증',
  coverage: 'abstract-only', sections: secOf(chars), ...over,
});
// ④ 게이트가 "웹을 열었다"로 인정하는 증거 — 실제 http(s) 링크가 달린 webSources.
const WEB = [{ label: 'journal page', url: 'https://example.org/page' }];
const THIN = REVIEW_THIN_BODY_CHARS - 1;
const THICK = REVIEW_THIN_BODY_CHARS + 500;

// ── ① 검색 사다리 계약 ───────────────────────────────────────────────────────
test('★ 리뷰 프롬프트가 검색 사다리를 단계로 지시한다 (한 줄 지시로 되돌아가면 안 된다)', () => {
  const p = agent()._prompt(doc, 'review');
  assert.match(p, /SEARCH LADDER IN ORDER/i, '순서 있는 사다리 지시가 없다');
  assert.match(p, /1\.\s*DOI landing page \/ publisher page/i, '1단 DOI·출판사 단계가 없다');
  assert.match(p, /2\.\s*PubMed Central \/ Europe PMC/i, '2단 PMC 단계가 없다');
  assert.match(p, /3\.\s*Public companion material/i, '3단 학회·저널 공개 요약 단계가 없다');
  assert.match(p, /4\.\s*Authoritative secondary sources/i, '4단 권위 2차 출처 단계가 없다');
  assert.match(p, /editorials?\/comments/i, 'editorial·comment 예시가 없다');
  assert.match(p, /ONLY pages you actually opened/i, '"실제로 연 페이지만 webSources" 제한이 없다');
});

test('★ 리뷰 프롬프트가 보강분 구분·출처·coverage 정직을 지시한다 (②)', () => {
  const p = agent()._prompt(doc, 'review');
  assert.match(p, /origin "augmented"/, '보강 절 구분 지시가 없다');
  assert.match(p, /sourceLabel \+ sourceUrl/, '보강 출처 필수 지시가 없다');
  assert.match(p, /NEVER blend augmented material into an "article" section/i, '원문·보강 섞임 금지가 없다');
  assert.match(p, /NEVER upgrade/i, '보강이 coverage 를 올리면 안 된다는 지시가 없다');
  assert.match(p, /inside the topic scope of THIS article/i, '주제 이탈 금지가 없다');
});

test('★ escalate 옵션이 에스컬레이션 프리앰블을 붙인다 (평시에는 없다)', () => {
  const a = agent();
  assert.doesNotMatch(a._prompt(doc, 'review'), /ESCALATION/, '평시 프롬프트에 에스컬레이션이 샜다');
  const esc = a._prompt(doc, 'review', { escalate: true });
  assert.match(esc, /★★ ESCALATION/, '에스컬레이션 프리앰블이 없다');
  assert.match(esc, /SEARCH LADDER/i, '에스컬레이션 프롬프트에도 사다리는 있어야 한다');
});

// ── ② 보강 절 구분 ──────────────────────────────────────────────────────────
test('★ 스키마: sections 에 origin·sourceUrl 이 있고, summary·keyChanges 는 계속 없다', () => {
  const secProps = agent()._tool('review').input_schema.properties.sections.items.properties;
  assert.deepEqual(secProps.origin.enum, ['article', 'augmented']);
  assert.ok('sourceLabel' in secProps && 'sourceUrl' in secProps, '보강 출처 칸이 없다');
});

test('★ 보강 절은 카드에서 [웹 보강] 표식·출처 링크로 구분된다 — 원문 절은 그대로', () => {
  const card = agent()._toCard(doc, reviewData(100, {
    sections: [
      { heading_ko: '병태생리', body_ko: '원문이 말한 내용.' },
      { heading_ko: '치료 논점', body_ko: '학회 성명이 말한 내용.', origin: 'augmented', sourceLabel: 'SCC 성명', sourceUrl: 'https://sccm.org/x' },
    ],
  }), 'review');
  assert.equal(card.sections.length, 2);
  assert.equal(card.sections[0].heading_ko, '병태생리', '원문 절 제목이 변형됐다');
  assert.doesNotMatch(card.sections[0].body_ko, /보강 출처/, '원문 절에 보강 표식이 붙었다');
  assert.match(card.sections[1].heading_ko, /^\[웹 보강\]/, '보강 절 제목에 구분 표식이 없다');
  assert.match(card.sections[1].body_ko, /보강 출처: SCC 성명 \(https:\/\/sccm\.org\/x\)/, '보강 절에 출처 링크가 없다');
});

test('★ 출처 URL 없는(또는 http 아닌) 보강 절은 버린다 — 출처 없는 보강은 환각과 구분 불가', () => {
  const card = agent()._toCard(doc, reviewData(100, {
    sections: [
      { heading_ko: '원문', body_ko: '원문 내용.' },
      { heading_ko: '무출처 보강', body_ko: '어디서 왔는지 모를 문장.', origin: 'augmented' },
      { heading_ko: '주입 보강', body_ko: 'x', origin: 'augmented', sourceLabel: 'x', sourceUrl: 'javascript:alert(1)' },
    ],
  }), 'review');
  assert.equal(card.sections.length, 1, '출처 없는 보강 절이 카드에 실렸다');
  assert.equal(card.sections[0].heading_ko, '원문');
});

test('★ 보강 절이 coverage 를 올리지 못한다 (_toCard 화이트리스트 유지)', () => {
  const card = agent()._toCard(doc, reviewData(100, { coverage: 'abstract-only' }), 'review');
  assert.equal(card.coverage, 'abstract-only');
});

// ── ③ 실질 게이트 ───────────────────────────────────────────────────────────
test('★★ 얇은 카드(초록 치환)면 에스컬레이션 프롬프트로 정확히 1회 더 부른다', async () => {
  const prompts = [];
  const a = mkAgent(async (messages) => {
    prompts.push(messages[0].content);
    return prompts.length === 1 ? reviewData(THIN) : reviewData(THICK, { coverage: 'web-augmented', webSources: WEB });
  });
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(prompts.length, 2, `재시도가 안 일어났다 (호출 ${prompts.length}회)`);
  assert.doesNotMatch(prompts[0], /ESCALATION/, '첫 호출부터 에스컬레이션이면 게이트가 아니다');
  assert.match(prompts[1], /★★ ESCALATION/, '재시도가 에스컬레이션 프롬프트를 안 썼다');
  assert.equal(card.coverage, 'web-augmented', '두꺼운 재시도 결과가 채택되지 않았다');
  assert.ok(card.sections[0].body_ko.length >= REVIEW_THIN_BODY_CHARS, '재시도 본문이 실리지 않았다');
});

test('★★ 두 번째도 얇으면 더 부르지 않고 그대로 발행한다 (무한 재시도 금지 · 데일리 코어 무영향)', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return reviewData(THIN); });
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 2, `호출이 ${calls}회 — 정확히 2회여야 한다`);
  assert.ok(card, '얇아도 카드는 발행돼야 한다 (데일리를 죽이면 안 된다)');
  assert.equal(card.coverage, 'abstract-only');
});

test('★ 재시도가 더 짧으면 첫 결과를 쓴다', async () => {
  let calls = 0;
  const a = mkAgent(async () => {
    calls += 1;
    return calls === 1 ? reviewData(2000) : reviewData(300);
  });
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 2);
  assert.equal(card.sections[0].body_ko.length, 2000, '더 짧은 재시도 결과가 첫 결과를 밀어냈다');
});

test('★ 에스컬레이션 호출이 실패하면 첫 결과를 그대로 쓴다 (예외로 데일리를 죽이지 않는다)', async () => {
  let calls = 0;
  const a = mkAgent(async () => {
    calls += 1;
    if (calls === 1) return reviewData(THIN);
    throw new Error('web tool unavailable');
  });
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 3, 'web→text-only 폴백 포함 3회여야 한다 (1성공 + 2실패)');
  assert.ok(card, '에스컬레이션 실패가 카드 자체를 죽였다');
  assert.equal(card.sections.length, 1);
});

test('★ coverage=full-text 면 짧아도 게이트를 안 태운다 (전문 확보 카드를 트집잡지 않는다)', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return reviewData(800, { coverage: 'full-text' }); });
  await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 1, 'full-text 인데 재시도가 일어났다');
});

test('★ 리뷰 게이트는 guideline 모드에 안 샌다 — 웹 증거가 있으면 종전처럼 1회만 부른다', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return { org: 'AHA', version: '2026', title_ko: 'x', scope_ko: 'x', summary: [], summary_ko: [], keyChanges: [], webSources: WEB, practiceImpact: 'x', practiceImpact_ko: 'x' }; });
  await a.analyze(doc, { mode: 'guideline' });
  assert.equal(calls, 1, 'guideline 모드에 불필요한 재시도가 났다 (웹 증거가 있는데 게이트가 걸렸다)');
});

// ── ③ 캐시 — 얇은 결과가 굳으면 안 된다 ─────────────────────────────────────
test('★★ 얇은 최종 결과는 캐시에 저장하지 않는다 / 두꺼운 결과는 저장한다', async () => {
  const aThin = mkAgent(async () => reviewData(THIN));
  await aThin.analyze(doc, { mode: 'review' });
  assert.equal(aThin.cache.store.size, 0, '얇은 결과가 캐시에 굳었다 — 다음 실행도 얇게 나온다');

  const aThick = mkAgent(async () => reviewData(THICK, { coverage: 'web-augmented', webSources: WEB }));
  await aThick.analyze(doc, { mode: 'review' });
  assert.equal(aThick.cache.store.size, 1, '두꺼운 결과가 캐시에 저장되지 않았다');
});

test('★ 캐시에 남은 얇은 구버전 결과는 miss 취급하고 새로 시도한다', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return reviewData(THICK, { coverage: 'web-augmented', webSources: WEB }); });
  await a.cache.set(a._cacheKey(doc, 'review'), reviewData(THIN));
  const card = await a.analyze(doc, { mode: 'review' });
  assert.ok(calls >= 1, '얇은 캐시를 그대로 재사용했다');
  assert.equal(card.coverage, 'web-augmented');
});

test('★ 두꺼운 캐시는 재사용한다 (LLM 을 다시 부르지 않는다)', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return reviewData(THICK); });
  await a.cache.set(a._cacheKey(doc, 'review'), reviewData(THICK, { coverage: 'web-augmented', webSources: WEB }));
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(calls, 0, '캐시가 있는데 LLM 을 불렀다');
  assert.equal(card.coverage, 'web-augmented');
});
