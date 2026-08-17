import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';
import { buildWebGuideline, sourceIdOf, isHttpUrl } from '../src/utils/externalGuideline.js';

// G0 — 가이드라인 선정 개편의 회귀 보호막.
//
// 계획서(`docs/superpowers/plans/2026-08-14-guideline-selection-redesign-plan.md`) G0.
// 이 파일은 **현행 동작을 고정**한다. G1~G10 이 무엇을 바꾸든, 여기서 적색이 나면
// 그 변경은 계약을 깬 것이다. 특히 지켜야 할 것 넷:
//   ① 7일 게이트 (G7 이 의도적으로 교체할 때까지)
//   ② 배열 상태 = v2 마이그레이션의 입력 (G3 이 무손실로 승격해야 하는 실물 모양)
//   ③ 수동 URL = PeterJ 최종 승인 — 기관·도메인 검증을 붙이지 않는다 (⑤-A 확정)
//   ④ non-fatal 경계 — 가이드라인이 무엇으로 실패하든 논문 데일리는 계속된다
//
// ★ 이 테스트는 런타임 배선을 바꾸지 않는다. 지금 코드가 하는 일을 그대로 적었다.

async function orchestratorInTmp() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-gl-contract-'));
  const o = new TrendReviewOrchestrator();
  o.outputDir = dir;
  o.guidelineListPath = path.join(dir, 'selected_guidelines.json');
  o.excludeListPath = path.join(dir, 'selected_papers.json');
  return { o, file: o.guidelineListPath };
}

// 프로덕션 `output/selected_guidelines.json` 의 실물 모양을 그대로 옮긴 것.
// PubMed 항목 5건 + org 없는 항목 1건 + PMID 가 빈 수동 웹 항목 1건 = 7건.
// G3 무손실 마이그레이션이 통과해야 하는 입력이 바로 이 배열이다.
const LEGACY_STATE = [
  { pmid: '41869844', title: 'Surviving Sepsis Campaign International Guidelines for the Management of Pediatr', org: 'Surviving Sepsis Campaign (SCCM/ESICM)', date: '2026-07-02' },
  { pmid: '42373461', title: '[The 2026 Surviving Sepsis Campaign guidelines: from evidence updates to practice implementation].', date: '2026-07-06' },
  { pmid: '41942818', title: 'Guidelines for Neuroprognostication in Critically ill Adults with Acute Ischemic', org: 'NCS/DGNI', date: '2026-07-13' },
  { pmid: '41236566', title: 'ESICM guidelines on circulatory shock and hemodynamic monitoring 2025.', org: 'ESICM', date: '2026-07-23' },
  { pmid: '41122895', title: 'Part 12: Resuscitation Education Science: 2025 American Heart Association Guidel', org: 'AHA (ILCOR-informed)', date: '2026-07-30' },
  { pmid: '', title: 'IDSA 2026 Guidance on the Treatment of Antimicrobial Resistant Gram-Negative Infections', date: '2026-08-04', sourceUrl: 'https://www.idsociety.org/practice-guideline/amr-guidance/', sourceId: 'web:www-idsociety-org-practice-guideline-amr-guidance' },
  { pmid: '41122894', title: 'Part 11: Post-Cardiac Arrest Care: 2025 American Heart Association Guidelines fo', org: 'AHA (American Heart Association)', date: '2026-08-11' },
];

// ── ① 매일 시도 · 빈 큐 skip (G7 확정 ④-D) ───────────────────────────────
// G0 은 여기에 7일 게이트를 못 박아 두었다. G7 이 **의도적으로** 그것을 없앴으므로
// 이 절만 새 계약으로 다시 썼다. 나머지 절(상태·수동 URL·non-fatal·논문 불변)은 그대로다.
//
// ★ 소스 문자열 정규식으로 때우지 않는다 — `outcome: 'empty'` 라는 글자가 파일에 있다는
//   것과 빈 큐일 때 실제로 그 값이 남는다는 것은 다른 말이다. 이 저장소가 F1 에서
//   4주 동안 당한 것이 바로 "플래그를 찍고 실행 증거로 착각한" 실패다. 행위로 본다.

const V2_EMPTY = () => ({ schemaVersion: 2, queue: [], published: [], rejected: [],
  sourceHealth: {}, lastRun: null, updatedAt: '2026-08-01T00:00:00.000Z', configVersion: 'guideline-v2' });

async function dailyStage(queue = [], overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-gl-gate-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify({ ...V2_EMPTY(), queue }));
  const o = new TrendReviewOrchestrator();
  o.outputDir = dir;
  o.guidelineListPath = file;
  process.env.ENABLE_GUIDELINE_AUTOPUBLISH = overrides.autoPublish ?? 'true';
  // ★ 이 파일은 게이트·상태 계약을 본다. LLM 셀렉은 자기 테스트가 따로 보므로
  //   여기서는 끈다 — 안 그러면 테스트가 **실제 LLM 을 때리고**, 판정 결과에 따라
  //   초록/적색이 갈리는 비결정 테스트가 된다.
  process.env.ENABLE_GUIDELINE_LLM_FIT = 'false';
  o._guidelineInputs = overrides.inputs ?? (async () => ({ candidates: [], manifest: { ptPmids: [] } }));
  o.guideline = { analyze: overrides.analyze ?? (async (paper) => ({ paper, org: 'AHA' })) };
  o.fullText = { run: async (papers) => ({ papers }) };
  return { o, file };
}

const queued = (pmid, priority) => ({ id: `pmid:${pmid}`, pmid, priority, status: 'queued',
  title: `AHA cardiac arrest guideline 2026 ${pmid}`, pubDate: '2026-08-01', attempts: 0 });

test('★ 관찰 전용 기본값: 게이트가 꺼져 있으면 큐가 차도 발행하지 않는다', async () => {
  const { o, file } = await dailyStage([queued('1', 10)], { autoPublish: 'false' });
  const card = await o._stageGuideline('2026-08-15');
  assert.equal(card, null, '수집 확대와 자동 발행이 같이 켜지면 오탐이 곧바로 발행된다');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.published.length, 0);
  assert.equal(state.lastRun.outcome, 'observe-only');
  assert.equal(state.queue.length, 1, '관찰 모드에서도 큐는 그대로 쌓인다');
});

test('★ 관찰 전용에서도 분석기(LLM)는 부르지 않는다', async () => {
  let calls = 0;
  const { o } = await dailyStage([queued('1', 10)],
    { autoPublish: 'false', analyze: async () => { calls += 1; return null; } });
  await o._stageGuideline('2026-08-15');
  assert.equal(calls, 0);
});

test('게이트: 7일 주기 판정을 가이드라인 단계가 더는 호출하지 않는다 (④-D)', () => {
  const src = readFileSync(new URL('../src/orchestrator/TrendReviewOrchestrator.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async _stageGuideline('), src.indexOf('async _stagePublish('));
  assert.equal(body.includes('_guidelineDue('), false, '주기 게이트가 되살아났다');
});

test('게이트: 어제 발행했어도 오늘 또 발행한다 (매일 시도)', async () => {
  const { o, file } = await dailyStage([queued('1', 10), queued('2', 9)]);
  await o._stageGuideline('2026-08-15');
  await o._stageGuideline('2026-08-16');   // 종전 계약이라면 7일 게이트에 막혔을 날
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(state.published.map((x) => x.id), ['pmid:1', 'pmid:2']);
});

test('게이트: 하루에 한 편을 넘기지 않는다', async () => {
  const { o, file } = await dailyStage([queued('1', 10), queued('2', 9), queued('3', 8)]);
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.published.length, 1, '하루 한 편 계약이 깨졌다');
  assert.equal(state.published[0].id, 'pmid:1', 'priority 최상위가 아니다');
});

test('게이트: 빈 큐면 outcome 이 empty 로 남는다 (행위로 확인)', async () => {
  const { o, file } = await dailyStage([]);
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(state.lastRun.outcome, 'empty');
  assert.equal(state.published.length, 0);
});

test('게이트: 빈 큐면 분석기를 한 번도 부르지 않는다 (LLM 0)', async () => {
  let calls = 0;
  const { o } = await dailyStage([], { analyze: async () => { calls += 1; return null; } });
  await o._stageGuideline('2026-08-15');
  assert.equal(calls, 0, '빈 큐인데 LLM 을 태우면 매일 시도가 매일 과금이 된다');
});

// ── ② 배열 상태 = v2 마이그레이션 입력 ──────────────────────────────────────

test('상태: 현행 배열은 손실 없이 그대로 읽힌다 (G3 마이그레이션 입력)', async () => {
  const { o, file } = await orchestratorInTmp();
  await writeFile(file, JSON.stringify(LEGACY_STATE, null, 2));
  const seen = await o._loadSeenGuidelines();
  assert.deepEqual(seen, LEGACY_STATE, '한 필드라도 사라지면 발행 이력이 사라진다');
  assert.equal(seen.length, 7);
});

test('상태: PMID 가 빈 수동 웹 항목의 sourceUrl·sourceId 가 보존된다', async () => {
  const { o, file } = await orchestratorInTmp();
  await writeFile(file, JSON.stringify(LEGACY_STATE, null, 2));
  const seen = await o._loadSeenGuidelines();
  const web = seen.find((s) => !s.pmid);
  assert.ok(web, '수동 웹 항목이 사라졌다');
  assert.equal(web.sourceUrl, 'https://www.idsociety.org/practice-guideline/amr-guidance/');
  assert.equal(web.sourceId, 'web:www-idsociety-org-practice-guideline-amr-guidance');
});

test('상태: org 가 없는 항목도 그대로 남는다 (필수 필드가 아니다)', async () => {
  const { o, file } = await orchestratorInTmp();
  await writeFile(file, JSON.stringify(LEGACY_STATE, null, 2));
  const seen = await o._loadSeenGuidelines();
  const noOrg = seen.find((s) => s.pmid === '42373461');
  assert.ok(noOrg);
  assert.equal('org' in noOrg, false);
});

test('상태: 파일이 없으면 빈 배열이다 (첫 실행)', async () => {
  const { o } = await orchestratorInTmp();
  assert.deepEqual(await o._loadSeenGuidelines(), []);
});

test('상태: 저장은 기존 항목을 지우지 않고 뒤에 붙인다', async () => {
  const { o, file } = await orchestratorInTmp();
  await writeFile(file, JSON.stringify(LEGACY_STATE, null, 2));
  await o._saveGuideline({ paper: { pmid: '99999999', title: 'New guideline' }, org: 'ACEP' }, '2026-08-15');
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(after.length, 8, '발행 이력은 누적만 한다 — 덮어쓰기 금지');
  assert.deepEqual(after.slice(0, 7), LEGACY_STATE);
  assert.deepEqual(after[7], { pmid: '99999999', title: 'New guideline', org: 'ACEP', date: '2026-08-15' });
});

// ── ③ 수동 URL = PeterJ 최종 승인 (⑤-A 확정) ───────────────────────────────
// 자동 C 경로(승인 학회 사이트)의 도메인 검증을 이 경로에 재사용하면 안 된다.
// PeterJ 가 폰에서 넘긴 URL 은 그 자체로 공식성 판정이 끝난 것이다.

test('수동 URL: 승인 기관 목록에 없는 도메인도 그대로 문서가 된다', () => {
  const doc = buildWebGuideline({
    url: 'https://guidelines.example-society.org/2026/airway',
    title: 'Example Society Airway Guideline 2026',
    org: 'Example Society',
    text: 'We recommend videolaryngoscopy as the first attempt device.',
  });
  assert.ok(doc, '도메인 검증이 붙으면 PeterJ 의 수동 승인이 막힌다');
  assert.equal(doc.title, 'Example Society Airway Guideline 2026');
  assert.ok(String(doc.pmid ?? '') === '', '수동 웹 문서에는 PMID 가 없다');
});

test('수동 URL: sourceId 는 도메인 승인 여부와 무관하게 만들어진다', () => {
  const id = sourceIdOf('https://random-unapproved-domain.test/some/guideline');
  assert.ok(id.startsWith('web:'), `sourceId 형식이 바뀌었다: ${id}`);
});

test('수동 URL: 입력 검증은 URL 형식과 kind 뿐이다 (기관 검증 없음)', () => {
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  assert.match(src, /DOC_KINDS/, 'kind 게이트가 사라졌다');
  for (const forbidden of ['guideline-orgs', 'approvedDomains', 'isApprovedOrg', 'verifyOrg']) {
    assert.equal(src.includes(forbidden), false,
      `수동 URL 경로에 기관 검증(${forbidden})이 붙었다 — ⑤-A 확정 위반`);
  }
});

test('수동 URL: guideline·reference 만 URL 을 받는다', () => {
  assert.equal(isHttpUrl('https://www.idsociety.org/practice-guideline/amr-guidance/'), true);
  assert.equal(isHttpUrl('41236566'), false, 'PMID 를 URL 로 오인하면 논문 경로가 깨진다');
});

// ── ④ non-fatal 경계 ────────────────────────────────────────────────────────
// 가이드라인 단계는 무엇으로 실패하든 throw 하지 않고 null 을 돌려준다.
// 이것이 깨지면 가이드라인 장애가 그날 논문 데일리를 통째로 죽인다.

function stubStage(o, { collect, select, analyze } = {}) {
  o.collector = { collectGuidelines: collect ?? (async () => []) };
  o.guideline = {
    selectNew: select ?? (() => null),
    analyze: analyze ?? (async () => null),
  };
  o.fullText = { run: async (papers) => ({ papers }) };
}

test('non-fatal: 수집기가 throw 해도 null 을 돌려주고 끝난다', async () => {
  const { o } = await orchestratorInTmp();
  stubStage(o, { collect: async () => { throw new Error('PubMed 500'); } });
  assert.equal(await o._stageGuideline('2026-08-15'), null);
});

test('non-fatal: 선정기가 throw 해도 null 을 돌려주고 끝난다', async () => {
  const { o } = await orchestratorInTmp();
  stubStage(o, {
    collect: async () => [{ pmid: '1', title: 'g' }],
    select: () => { throw new Error('scorer boom'); },
  });
  assert.equal(await o._stageGuideline('2026-08-15'), null);
});

test('non-fatal: 분석이 null 이면 발행 없이 건너뛴다', async () => {
  const { o } = await orchestratorInTmp();
  stubStage(o, {
    collect: async () => [{ pmid: '1', title: 'g' }],
    select: () => ({ pmid: '1', title: 'g' }),
    analyze: async () => null,
  });
  assert.equal(await o._stageGuideline('2026-08-15'), null);
});

test('non-fatal: 본문 확보가 실패해도 초록으로 분석을 계속한다', async () => {
  const { o } = await orchestratorInTmp();
  stubStage(o, {
    collect: async () => [{ pmid: '1', title: 'g' }],
    select: () => ({ pmid: '1', title: 'g' }),
    analyze: async (p) => ({ paper: p, org: 'AHA' }),
  });
  o.fullText = { run: async () => { throw new Error('PMC down'); } };
  const card = await o._stageGuideline('2026-08-15');
  assert.ok(card, '본문 실패가 분석까지 죽이면 안 된다');
  assert.equal(card.org, 'AHA');
});

test('non-fatal: 이제는 매일 수집을 시도한다 (④-D — 종전 주기 게이트 폐지)', async () => {
  let called = 0;
  const { o } = await dailyStage([], { inputs: async () => { called += 1; return { candidates: [], manifest: { ptPmids: [] } }; } });
  await o._stageGuideline('2026-08-15');
  assert.equal(called, 1, '매일 시도가 계약이다 — 안 부르면 큐가 영영 안 찬다');
});

// ── ⑤ 논문 데일리 경로 불변 ────────────────────────────────────────────────
// 개편은 가이드라인 전용 경로만 만든다. 논문 수집·채점은 한 글자도 바뀌면 안 된다.

test('논문 불변: 가이드라인 선정이 입력 논문 객체를 변형하지 않는다', () => {
  const agent = new GuidelineAnalyzerAgent();
  const input = [
    { pmid: '1', title: 'ESICM guidelines on circulatory shock 2025', journal: 'Intensive care medicine', pubDate: '2025-11-01' },
    { pmid: '2', title: 'AHA focused update on cardiac arrest', journal: 'Circulation', pubDate: '2025-10-01' },
  ];
  const before = JSON.parse(JSON.stringify(input));
  agent.selectNew(input, []);
  assert.deepEqual(input, before, '선정기가 후보 객체를 오염시키면 논문 경로로 번진다');
});

test('논문 불변: selectNew 는 이미 본 PMID 를 배제한다', () => {
  const agent = new GuidelineAnalyzerAgent();
  const input = [
    { pmid: '1', title: 'ESICM guidelines on circulatory shock 2025', journal: 'Intensive care medicine' },
    { pmid: '2', title: 'AHA guidelines for CPR 2025', journal: 'Circulation' },
  ];
  const pick = agent.selectNew(input, ['1']);
  assert.equal(pick.pmid, '2');
  assert.equal(agent.selectNew(input, ['1', '2']), null, '남은 후보가 없으면 null 이다');
});

test('논문 불변: 후보가 없으면 LLM 을 부르지 않고 null 이다', () => {
  const agent = new GuidelineAnalyzerAgent();
  assert.equal(agent.selectNew([], []), null);
  assert.equal(agent.selectNew(null, []), null);
});

test('논문 불변: 가이드라인 수집은 논문 수집과 별개 메서드다', async () => {
  const src = readFileSync(new URL('../src/agents/DataCollectorAgent.js', import.meta.url), 'utf8');
  assert.match(src, /collectGuidelines\s*\(/, '가이드라인 수집 메서드가 사라졌다');
  // run() 본문이 collectGuidelines 를 부르면 가이드라인 장애가 논문 수집을 오염시킨다.
  const runBody = src.slice(src.indexOf('\n  async run('));
  const nextMethod = runBody.indexOf('\n  async ', 10);
  assert.equal(
    runBody.slice(0, nextMethod > 0 ? nextMethod : undefined).includes('collectGuidelines'),
    false,
    'run() 이 가이드라인 수집을 부르면 두 경로가 묶인다',
  );
});
