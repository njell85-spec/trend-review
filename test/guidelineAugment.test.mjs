import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { buildDailyDigest } from '../src/utils/dailyDigest.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 웹 보강 강제 + 가이드라인 보강 축 — PeterJ 확정 2026-08-18:
//   "리뷰 및 가이드라인 보강은 웹서칭에 그 제목으로 검색해서 나오는 괜찮은
//    2차자료 가공 포함하자. 레퍼런스 달고."
//
// 실측(Actions run 32089367959): 보강 기능이 실전에서 한 번도 안 돌았다 —
// webSources 0건, 보강 절 0개. 원인은 LLMClient 프롬프트 꼬리의 "You MAY first use
// WebSearch…"(MAY = 안 해도 됨으로 읽힘). LLMClient 는 다른 호출부(PICO·rerank)가
// 같이 쓰므로 못 고친다 — 프롬프트 본문(_prompt)에서 must 로 강제한다.
// 이 파일이 그 강제를 못 박는다: 문구를 약화시키면 여기서 적색이 난다.
// ═══════════════════════════════════════════════════════════════════════════════

const agent = () => new GuidelineAnalyzerAgent({ llm: { callWithTool: async () => ({}) } });
const doc = { pmid: '9', title: 'Sepsis and septic shock', journal: 'Lancet', abstract: 'A seminar.', doi: '10.1/sep' };

// 인메모리 캐시 — 디스크(output/cache)를 건드리지 않는다.
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

// LLM 스텁 주입 — 실제 네트워크 금지. retry 는 지연 없는 통과로 교체(백오프 방지).
const mkAgent = (callWithTool) => {
  const a = new GuidelineAnalyzerAgent({ llm: { callWithTool }, cache: memCache() });
  a.retry = { execute: (fn) => fn() };
  return a;
};

const AUG = { heading_ko: '학회 요약', body_ko: 'SCCM 이 요약한 내용.', sourceLabel: 'SCCM 공식 요약', sourceUrl: 'https://sccm.org/summary' };
// ★ 픽스처도 **허용목록을 통과하는 실제 출처 모양**이어야 한다 (2026-08-18).
//   example.org 를 쓰면 신뢰 필터가 걷어내고, 그러면 이 파일의 게이트 검사들이
//   "웹 증거 없음" 으로 오판해 통째로 무의미해진다.
const WEB = [{ label: 'journal page', url: 'https://www.thelancet.com/article/x' }];
const glData = (over = {}) => ({
  pmid: '9', org: 'SSC', version: '2026', title_ko: '패혈증 지침', scope_ko: '성인 패혈증',
  summary: ['Give abx'], summary_ko: ['항생제'],
  keyChanges: [{ topic: '항생제', detail: '3h→1h', detail_ko: '3시간에서 1시간' }],
  practiceImpact: 'x', practiceImpact_ko: '임팩트', ...over,
});

// ── ① 검색 필수 — 검색어는 "그 제목" ─────────────────────────────────────────
test('★★ 리뷰·가이드라인 프롬프트에 제목 기반 검색어가 리터럴로 박힌다', () => {
  const a = agent();
  for (const mode of ['review', 'guideline']) {
    const p = a._prompt(doc, mode);
    assert.match(p, /WebSearch: "Sepsis and septic shock"\n/, `${mode}: 제목 그대로 검색어가 없다`);
    assert.match(p, /WebSearch: "Sepsis and septic shock" key points/, `${mode}: key points 검색어가 없다`);
    assert.match(p, /WebSearch: "Sepsis and septic shock" summary/, `${mode}: summary 검색어가 없다`);
  }
  const g = a._prompt(doc, 'guideline');
  assert.match(g, /WebSearch: "Sepsis and septic shock" what's new/, '가이드라인: what\'s new 검색어가 없다');
  assert.match(g, /WebSearch: "Sepsis and septic shock" executive summary/, '가이드라인: executive summary 검색어가 없다');
});

test('★ 제목이 바뀌면 검색어도 바뀐다 (하드코딩이 아니다)', () => {
  const p = agent()._prompt({ ...doc, title: 'Acute kidney injury' }, 'review');
  assert.match(p, /WebSearch: "Acute kidney injury"/);
  assert.doesNotMatch(p, /WebSearch: "Sepsis and septic shock"/);
});

test('★ 제목 안의 큰따옴표는 검색어 리터럴을 깨지 못한다', () => {
  const p = agent()._prompt({ ...doc, title: 'The "golden hour" myth' }, 'review');
  assert.match(p, /WebSearch: "The 'golden hour' myth"/, '따옴표 무해화가 안 됐다');
});

test('★★ 검색은 must 다 — MAY 식 약한 표현으로 되돌아가면 적색', () => {
  for (const mode of ['review', 'guideline']) {
    const p = agent()._prompt(doc, mode);
    assert.match(p, /MANDATORY WEB RESEARCH — THIS IS NOT OPTIONAL/, `${mode}: 필수 선언이 없다`);
    assert.match(p, /You MUST run at least these searches/, `${mode}: "must run" 강제가 없다`);
    // LLMClient 꼬리의 "You MAY first use…" 를 본문에서 무력화하는 문장이 있어야 한다.
    assert.match(p, /saying you "may" use web tools does NOT apply/i, `${mode}: MAY 무력화 문장이 없다`);
  }
});

test('★ 괜찮은 2차자료만 — 블로그·요약 사이트·AI 생성물 배제 + 정직 지시', () => {
  for (const mode of ['review', 'guideline']) {
    const p = agent()._prompt(doc, mode);
    assert.match(p, /official society\s+summaries|society\s+summaries\/statements/i, `${mode}: 학회 공식 요약 허용 목록이 없다`);
    assert.match(p, /editorials\/comments/i, `${mode}: 저널 editorial·comment 허용이 없다`);
    assert.match(p, /EXCLUDE personal blogs, content-farm\/summary sites, and\s*\nAI-generated pages/i, `${mode}: 배제 목록이 없다`);
    assert.match(p, /return empty arrays rather than pretending you searched/i, `${mode}: 빈 배열 정직 지시가 없다`);
    assert.match(p, /NEVER fabricate/i, `${mode}: 날조 금지가 없다`);
  }
});

test('★ 가이드라인 에스컬레이션 프리앰블 — escalate 때만 붙는다', () => {
  const a = agent();
  assert.doesNotMatch(a._prompt(doc, 'guideline'), /ESCALATION/, '평시 프롬프트에 에스컬레이션이 샜다');
  const esc = a._prompt(doc, 'guideline', { escalate: true });
  assert.match(esc, /★★ ESCALATION/, '에스컬레이션 프리앰블이 없다');
  assert.match(esc, /WebSearch: "Sepsis and septic shock"/, '에스컬레이션 프롬프트에도 검색어는 있어야 한다');
});

// ── ② 가이드라인 도구의 보강 축 ─────────────────────────────────────────────
test('★ 가이드라인 도구에 augmentedSections 가 있고, 리뷰 절 보강과 같은 계약이다', () => {
  const tool = agent()._tool('guideline');
  const aug = tool.input_schema.properties.augmentedSections;
  assert.ok(aug, '보강 축이 없다');
  assert.deepEqual(Object.keys(aug.items.properties).sort(), ['body_ko', 'heading_ko', 'sourceLabel', 'sourceUrl']);
  assert.deepEqual(aug.items.required.sort(), ['body_ko', 'heading_ko', 'sourceLabel', 'sourceUrl'],
    '출처 없는 보강을 스키마부터 막아야 한다');
  assert.ok(tool.input_schema.required.includes('augmentedSections'), '필수가 아니면 LLM 이 조용히 생략한다');
  // keyChanges(이전 판 대비)는 별개 축 — 그대로 있어야 한다.
  assert.ok(tool.input_schema.properties.keyChanges, 'keyChanges 가 사라졌다 — 보강은 별개 축이다');
  assert.ok(tool.input_schema.required.includes('keyChanges'));
  // 다른 모드로 새지 않는다.
  assert.equal(agent()._tool('review').input_schema.properties.augmentedSections, undefined,
    '리뷰는 sections[].origin 으로 보강한다 — 축이 중복되면 안 된다');
  assert.equal(agent()._tool('reference').input_schema.properties.augmentedSections, undefined);
});

test('★ webSources 설명이 "안 써도 정상" 으로 읽히지 않는다', () => {
  for (const mode of ['guideline', 'review']) {
    const d = agent()._tool(mode).input_schema.properties.webSources.description;
    assert.match(d, /Empty array ONLY if/i, `${mode}: 빈 배열이 예외 경로임이 명시돼야 한다`);
    assert.doesNotMatch(d, /only if you actually used web search|if you did not use web search/i,
      `${mode}: "안 쓰는 것이 정상" 으로 읽히는 옛 문구가 남았다`);
  }
});

test('★★ _toCard: 출처 없는(또는 http 아닌) 보강 항목은 버린다', () => {
  const card = agent()._toCard(doc, glData({
    augmentedSections: [
      AUG,
      { heading_ko: '무출처', body_ko: '어디서 온지 모를 문장.' },
      { heading_ko: '주입', body_ko: 'x', sourceLabel: 'x', sourceUrl: 'javascript:alert(1)' },
      { heading_ko: '빈 본문', body_ko: '  ', sourceLabel: 'y', sourceUrl: 'https://ok.org/' },
    ],
  }), 'guideline');
  assert.equal(card.augmentedSections.length, 1, '출처 없는/비-http 보강이 카드에 실렸다');
  assert.deepEqual(card.augmentedSections[0], AUG);
  // 원문 축은 그대로.
  assert.equal(card.keyChanges.length, 1, 'keyChanges 가 보강 처리에 휩쓸렸다');
  assert.equal(card.type, 'guideline');
});

test('★ 보강 축이 없던 구판 데이터도 그대로 카드가 된다 (빈 배열)', () => {
  const card = agent()._toCard(doc, glData(), 'guideline');
  assert.deepEqual(card.augmentedSections, []);
});

// ── ③ 렌더 — 카드(HTML)·md 양쪽에서 원문과 보강이 구분되고 레퍼런스가 달린다 ──
const pub = () => new GitHubPublisher({ owner: 'o', repo: 'r', token: 't' });
const glCard = (over = {}) => ({
  type: 'guideline', title_ko: '패혈증 지침', scope_ko: '성인',
  paper: { pmid: '9', title: 'Sepsis Guideline', journal: 'CCM', pubDate: '2026-08-01' },
  summary: ['Give abx'], summary_ko: ['항생제를 준다'],
  keyChanges: [{ topic: '항생제', detail: '3h→1h', detail_ko: '3시간에서 1시간' }],
  augmentedSections: [AUG],
  practiceImpact_ko: '임팩트', ...over,
});

test('★★ 가이드라인 카드: 🔎 웹 보강 (2차 자료) 블록 + 클릭 가능한 출처 앵커', () => {
  const html = pub()._buildGuidelineCard(glCard());
  assert.match(html, /🔎 웹 보강 \(2차 자료\)/, '보강 블록 제목이 없다');
  assert.match(html, /<a href="https:\/\/sccm\.org\/summary" target="_blank" rel="noopener"/, '출처가 앵커가 아니다');
  assert.match(html, /— 출처: SCCM 공식 요약/, '출처 라벨이 없다');
  assert.match(html, /SCCM 이 요약한 내용\./, '보강 본문이 없다');
  // 원문 축은 별개 블록으로 그대로 — 보강이 원문 자리(핵심 권고·변경점)에 섞이면 안 된다.
  const augIdx = html.indexOf('🔎 웹 보강');
  assert.ok(html.indexOf('핵심 권고') < augIdx, '보강 블록이 원문 축보다 앞에 섞였다');
  assert.ok(html.indexOf('이전 판 대비 주요 변경점') < augIdx, '보강 블록이 변경점 축과 섞였다');
  assert.ok(html.indexOf('SCCM 이 요약한 내용') > augIdx, '보강 본문이 보강 블록 밖에 있다');
  // 새 CSS 클래스가 아니라 인라인 스타일이어야 한다 (배포 페이지는 증분 패치).
  assert.match(html, /border-left:3px solid/, '보강 박스가 인라인 스타일이 아니다');
});

test('★ 보강이 없으면 블록 자체가 없다 / 렌더도 비-http 출처를 방어적으로 버린다', () => {
  const none = pub()._buildGuidelineCard(glCard({ augmentedSections: [] }));
  assert.doesNotMatch(none, /웹 보강/, '보강이 없는데 빈 블록이 떴다');
  const legacy = pub()._buildGuidelineCard(glCard({ augmentedSections: undefined }));
  assert.doesNotMatch(legacy, /웹 보강/, '구판 카드(축 없음)에 빈 블록이 떴다');
  const inject = pub()._buildGuidelineCard(glCard({
    augmentedSections: [{ heading_ko: 'x', body_ko: 'y', sourceLabel: 'z', sourceUrl: 'javascript:alert(1)' }],
  }));
  assert.doesNotMatch(inject, /javascript:alert/, '비-http 출처가 렌더를 통과했다');
  assert.doesNotMatch(inject, /웹 보강/, '출처가 무효인데 보강 블록이 떴다');
});

test('★★ 리뷰 카드: 보강 절 출처가 클릭 가능한 앵커다 (평문 괄호 표기가 아니다)', () => {
  // 에이전트(_publishableReviewSections)가 만드는 실제 데이터 모양 그대로:
  // 제목 표식 + 본문 끝 평문 출처 줄 + origin/sourceUrl 필드.
  const card = {
    type: 'review', title_ko: '패혈증 세미나', coverage: 'abstract-only',
    paper: { pmid: '9', title: 'Sepsis', journal: 'Lancet' },
    sections: [
      { heading_ko: '병태생리', body_ko: '원문이 말한 내용.' },
      {
        heading_ko: '[웹 보강] 치료 논점',
        body_ko: '학회가 말한 내용.\n— 보강 출처: SCC 성명 (https://sccm.org/x)',
        origin: 'augmented', sourceLabel: 'SCC 성명', sourceUrl: 'https://sccm.org/x',
      },
    ],
    practiceImpact_ko: '적용',
  };
  const html = pub()._buildGuidelineCard(card);
  assert.match(html, /<a href="https:\/\/sccm\.org\/x" target="_blank" rel="noopener"[^>]*>— 보강 출처: SCC 성명<\/a>/,
    '보강 출처가 클릭 가능한 앵커가 아니다');
  assert.doesNotMatch(html, /보강 출처: SCC 성명 \(https/, '평문 출처 줄이 앵커와 중복으로 떴다');
  assert.match(html, /\[웹 보강\] 치료 논점/, '보강 절 구분 표식이 사라졌다');
  // 원문 절은 표식·박스 없이 그대로.
  assert.match(html, /원문이 말한 내용\./);
  const artIdx = html.indexOf('병태생리');
  const boxIdx = html.indexOf('border-left:3px solid');
  assert.ok(boxIdx > artIdx, '원문 절에 보강 박스 스타일이 붙었다');
});

test('★★ md 첨부에도 같은 축이 실린다 — 가이드라인 보강 + Markdown 링크', () => {
  const out = buildDailyDigest({ dateStr: '2026-08-18', guideline: glCard() });
  assert.match(out, /## 🔎 웹 보강 \(2차 자료\)/, 'md 에 보강 절이 없다 — 첨부와 화면이 갈린다');
  assert.match(out, /\[— 출처: SCCM 공식 요약\]\(https:\/\/sccm\.org\/summary\)/, 'md 출처가 링크가 아니다');
  assert.match(out, /SCCM 이 요약한 내용\./);
  // 원문 축도 그대로.
  assert.match(out, /## 핵심 권고/);
  assert.match(out, /## 이전 판 대비 변경점/);
  const none = buildDailyDigest({ dateStr: '2026-08-18', guideline: glCard({ augmentedSections: [] }) });
  assert.doesNotMatch(none, /웹 보강/, '보강이 없는데 md 에 빈 절이 떴다');
});

test('★ md: 리뷰 보강 절 출처도 Markdown 링크다 (평문 중복 없음)', () => {
  const review = {
    card: {
      type: 'review', title_ko: '패혈증 세미나', coverage: 'abstract-only',
      paper: { pmid: '9', title: 'Sepsis', journal: 'Lancet' },
      sections: [{
        heading_ko: '[웹 보강] 치료 논점',
        body_ko: '학회가 말한 내용.\n— 보강 출처: SCC 성명 (https://sccm.org/x)',
        origin: 'augmented', sourceLabel: 'SCC 성명', sourceUrl: 'https://sccm.org/x',
      }],
    },
  };
  const out = buildDailyDigest({ dateStr: '2026-08-18', review });
  assert.match(out, /\[— 보강 출처: SCC 성명\]\(https:\/\/sccm\.org\/x\)/, '리뷰 보강 출처가 md 링크가 아니다');
  assert.doesNotMatch(out, /보강 출처: SCC 성명 \(https/, '평문 출처 줄이 링크와 중복으로 실렸다');
});

// ── ④ 에스컬레이션 — "웹을 안 열었다" 도 조건이다 ────────────────────────────
test('★★ 리뷰: 본문이 두꺼워도 webSources 가 비면 1회 에스컬레이션한다 (2026-08-18 실측 증상)', async () => {
  const prompts = [];
  const thick = () => [{ heading_ko: '본문', body_ko: '가'.repeat(4000) }];
  const a = mkAgent(async (messages) => {
    prompts.push(messages[0].content);
    return prompts.length === 1
      ? { pmid: '9', title_ko: 'x', scope_ko: 'x', coverage: 'web-augmented', sections: thick(), webSources: [] }
      : { pmid: '9', title_ko: 'x', scope_ko: 'x', coverage: 'web-augmented', sections: thick(), webSources: WEB };
  });
  const card = await a.analyze(doc, { mode: 'review' });
  assert.equal(prompts.length, 2, `webSources 빈 결과에 재시도가 안 났다 (호출 ${prompts.length}회)`);
  assert.match(prompts[1], /★★ ESCALATION/, '재시도가 에스컬레이션 프롬프트를 안 썼다');
  assert.ok(card.sources.some((s) => s.url === 'https://www.thelancet.com/article/x'), '웹 증거가 있는 재시도 결과가 채택되지 않았다');
});

test('★★ 가이드라인: 보강도 webSources 도 비면 정확히 1회 더 부르고, 좋은 재시도를 채택한다', async () => {
  const prompts = [];
  const a = mkAgent(async (messages) => {
    prompts.push(messages[0].content);
    return prompts.length === 1
      ? glData({ augmentedSections: [], webSources: [] })
      : glData({ augmentedSections: [AUG], webSources: WEB });
  });
  const card = await a.analyze(doc, { mode: 'guideline' });
  assert.equal(prompts.length, 2, `재시도가 안 났다 (호출 ${prompts.length}회)`);
  assert.doesNotMatch(prompts[0], /ESCALATION/, '첫 호출부터 에스컬레이션이면 게이트가 아니다');
  assert.match(prompts[1], /★★ ESCALATION/, '재시도가 에스컬레이션 프롬프트를 안 썼다');
  assert.equal(card.augmentedSections.length, 1, '보강 있는 재시도 결과가 채택되지 않았다');
});

test('★★ 가이드라인: 두 번째도 비면 더 부르지 않고 첫 결과로 발행한다 (데일리 코어 무영향)', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return glData({ augmentedSections: [], webSources: [] }); });
  const card = await a.analyze(doc, { mode: 'guideline' });
  assert.equal(calls, 2, `호출이 ${calls}회 — 정확히 2회여야 한다`);
  assert.ok(card, '보강이 없어도 카드는 발행돼야 한다');
  assert.equal(card.keyChanges.length, 1, '첫 결과의 원문 축이 사라졌다');
});

test('★ 가이드라인: 웹 증거(webSources 또는 보강)가 있으면 재시도하지 않는다', async () => {
  let calls = 0;
  const a = mkAgent(async () => { calls += 1; return glData({ augmentedSections: [AUG], webSources: [] }); });
  await a.analyze(doc, { mode: 'guideline' });
  assert.equal(calls, 1, '보강이 있는데 불필요한 재시도가 났다');
});

test('★ 가이드라인: 에스컬레이션 호출이 실패해도 첫 결과로 발행한다', async () => {
  let calls = 0;
  const a = mkAgent(async () => {
    calls += 1;
    if (calls === 1) return glData({ augmentedSections: [], webSources: [] });
    throw new Error('web tool unavailable');
  });
  const card = await a.analyze(doc, { mode: 'guideline' });
  assert.equal(calls, 3, 'web→text-only 폴백 포함 3회여야 한다 (1성공 + 에스컬레이션 2실패)');
  assert.ok(card, '에스컬레이션 실패가 카드를 죽였다');
});

test('★ 리뷰: 두꺼워도 웹 증거 없는 결과는 캐시에 굳히지 않는다', async () => {
  const a = mkAgent(async () => ({
    pmid: '9', title_ko: 'x', scope_ko: 'x', coverage: 'web-augmented',
    sections: [{ heading_ko: '본문', body_ko: '가'.repeat(4000) }], webSources: [],
  }));
  await a.analyze(doc, { mode: 'review' });
  assert.equal(a.cache.store.size, 0, '웹을 안 연 결과가 캐시에 굳었다 — 다음 실행도 그대로 나온다');
});

// ── ⑤ 실패해도 데일리가 죽지 않는다 ─────────────────────────────────────────
test('★★ 가이드라인 경로가 전부 실패해도 analyze() 는 throw 하지 않고 null 을 낸다', async () => {
  const a = mkAgent(async () => { throw new Error('LLM down'); });
  const card = await a.analyze(doc, { mode: 'guideline' });
  assert.equal(card, null, '실패 시 null 계약이 깨졌다 — 오케스트레이터 non-fatal 경계의 전제다');
});
