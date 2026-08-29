import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';

/**
 * 종합 카드 (kind=synthesis) — 관련 문헌 2~5건을 한 장으로 대조한다 (PeterJ 요구 2026-08-29).
 *
 * ★ 이 카드의 제1 실패는 **오귀속**이다 — "ESC 가 이렇게 말했다" 가 실은 합의문 내용인 것.
 *   화면에서는 정상으로 보이고, 틀린 줄을 알아채려면 원문을 다시 읽어야 한다.
 *   그래서 방어를 두 겹으로 두고 **두 겹을 다 검사한다**:
 *     ① 스키마 — refId 를 그 실행의 실제 목록으로 enum 고정 (`_synthesisTool`)
 *     ② 렌더·매핑 — 모르는 refId 는 버린다 (`_toCard`, `_buildGuidelineCard`)
 *   한 겹만 검사하면 다른 겹이 조용히 죽어도 초록으로 지나간다.
 */

const agent = () => new GuidelineAnalyzerAgent({ llm: { callWithTool: async () => ({}) } });

const DOCS = [
  { refId: 'D1', pmid: '111', title: 'ESC 2026 HF', journal: 'Eur Heart J', isBaseline: false },
  { refId: 'D2', pmid: '', sourceUrl: 'https://www.escardio.org/x', title: 'Universal Definition', journal: '', isBaseline: false },
  { refId: 'D3', pmid: '999', title: 'Old US guideline', journal: 'Circulation', isBaseline: true },
];

const DATA = {
  title_ko: '심부전 2026 세 문서 대조',
  version: '2026',
  scope_ko: '같은 주제로 연달아 나온 문서를 한 장에 놓는다.',
  documents: [
    { refId: 'D1', docType: 'guideline', docTypeNote_ko: '정식 지침', role_ko: '유럽 신판', shortLabel_ko: 'ESC 2026' },
    { refId: 'D2', docType: 'consensus', docTypeNote_ko: '다학회 합의문', role_ko: '공통 용어', shortLabel_ko: '통합정의' },
    { refId: 'D3', docType: 'guideline', docTypeNote_ko: '구판', role_ko: '기준선', shortLabel_ko: 'AHA 2022', isBaseline: true },
  ],
  commonGround: [
    { point: 'Mid-range band is no longer a separate silo.', point_ko: '중간 구간은 더 이상 별도 사일로가 아니다.' },
  ],
  comparisons: [
    {
      axis_ko: 'LVEF 표현형',
      positions: [
        { refIds: ['D1'], detail: 'Two phenotypes, HFmrEF abolished.', detail_ko: '2분류, HFmrEF 폐지.' },
        { refIds: ['D2'], detail: 'Steps back from fixed cut-offs.', detail_ko: '고정 절단값에서 물러섬.' },
      ],
      divergenceNote_ko: '같은 방향이되 방법이 다르다.',
    },
  ],
  gapNotes_ko: ['미국 정식 지침 갱신은 아직이다.'],
  practiceImpact: 'Treat below 50% as reduced.',
  practiceImpact_ko: '50% 미만을 감소군으로 다룬다.',
  augmentedSections: [],
  webSources: [],
};

const cardOf = (dataOverride = {}) => agent()._toCard(
  { docs: DOCS, sourceId: 'syn:111-web-999', title: 'ESC 2026 HF / Universal Definition' },
  { ...DATA, ...dataOverride },
  'synthesis',
);

test('종합 카드가 문헌 정체를 파이프라인에서 가져온다 — LLM 이 준 제목을 쓰지 않는다', () => {
  const card = cardOf();
  assert.equal(card.type, 'synthesis');
  assert.equal(card.documents.length, 3);
  const d1 = card.documents.find((d) => d.refId === 'D1');
  // 제목·PMID 는 supplied 목록에서 온다 (LLM 은 refId 로만 지칭했다)
  assert.equal(d1.pmid, '111');
  assert.equal(d1.title, 'ESC 2026 HF');
  assert.equal(d1.shortLabel_ko, 'ESC 2026');
});

test('★ 오귀속 차단 ① — 모르는 refId 를 든 문헌 항목은 버린다', () => {
  const card = cardOf({
    documents: [...DATA.documents, { refId: 'D9', docType: 'other', docTypeNote_ko: 'x', role_ko: 'x', shortLabel_ko: '유령' }],
  });
  assert.equal(card.documents.length, 3);
  assert.ok(!card.documents.some((d) => d.refId === 'D9'));
});

test('★ 오귀속 차단 ② — 모르는 refId 만 든 입장은 버리고, 남은 입장이 없으면 축까지 버린다', () => {
  const card = cardOf({
    comparisons: [
      {
        axis_ko: '유령 축',
        positions: [{ refIds: ['D9'], detail: 'ghost', detail_ko: '유령' }],
      },
      {
        axis_ko: '살아남는 축',
        positions: [
          { refIds: ['D9'], detail: 'ghost', detail_ko: '유령' },
          { refIds: ['D1'], detail: 'real', detail_ko: '실물' },
        ],
      },
    ],
  });
  assert.equal(card.comparisons.length, 1);
  assert.equal(card.comparisons[0].axis_ko, '살아남는 축');
  assert.equal(card.comparisons[0].positions.length, 1);
  assert.deepEqual(card.comparisons[0].positions[0].refIds, ['D1']);
});

test('★ 오귀속 차단 ③ — 렌더도 모르는 refId 를 그리지 않는다 (매핑을 우회한 구판 데이터 방어)', () => {
  // 상태 파일에 실린 과거/외부 데이터가 _toCard 를 안 거치고 바로 렌더될 수 있다.
  const card = cardOf();
  card.comparisons = [{
    axis_ko: '주입된 축',
    positions: [{ refIds: ['D9'], detail: 'ghost', detail_ko: '유령입장' }],
  }];
  const html = new GitHubPublisher()._buildGuidelineCard(card);
  assert.ok(!html.includes('유령입장'), '모르는 refId 의 입장이 렌더됐다');
  assert.ok(!html.includes('주입된 축'), '입장이 전부 버려진 축이 빈 채로 렌더됐다');
});

test('카드가 종합 축을 전부 그린다 — 칩·비교 문헌·공통 지반·쟁점·미해결', () => {
  const html = new GitHubPublisher()._buildGuidelineCard(cardOf());
  assert.ok(html.includes('🧩 종합'), '종합 칩이 없다');
  assert.ok(html.includes('비교 문헌 3건'));
  assert.ok(html.includes('공통 지반'));
  assert.ok(html.includes('쟁점별 비교'));
  assert.ok(html.includes('미해결·주의점'));
  assert.ok(html.includes('문헌 종합'), '꼬리 라벨이 다른 트랙 것이다');
  assert.ok(html.includes('왜 갈리나'));
  // 개별 문헌 링크가 실제 PubMed 로 걸린다
  assert.ok(html.includes('https://pubmed.ncbi.nlm.nih.gov/111/'));
  assert.ok(html.includes('https://www.escardio.org/x'));
});

test('기준선(구판)은 시각적으로 격리되고 공통 지반 수에서 빠진다', () => {
  const html = new GitHubPublisher()._buildGuidelineCard(cardOf());
  assert.ok(html.includes('기준선(구판)'), '기준선 배지가 없다');
  // D3 는 기준선이므로 신규는 2건이다 — "전부 합의" 로 읽히면 과장이 된다
  assert.ok(html.includes('신규 문헌 2건 공통'), '공통 지반 라벨이 기준선을 빼지 않았다');
});

test('종합 출처는 묶인 문헌 각각을 1차로 싣는다', () => {
  const card = cardOf();
  const labels = card.sources.map((s) => s.label);
  assert.ok(labels.some((l) => l.includes('ESC 2026') && l.includes('111')));
  assert.ok(labels.some((l) => l.includes('통합정의') && l.includes('원문')));
});

test('★ 실질 게이트 — 차이가 0인 종합은 요약 재탕이다', () => {
  const a = agent();
  assert.equal(a._needsSynthesisEscalation({ comparisons: [] }), true, '축이 없는데 통과했다');
  assert.equal(a._needsSynthesisEscalation({}), true);
  assert.equal(
    a._needsSynthesisEscalation({ comparisons: [{ positions: [{ refIds: ['D1'] }] }, { positions: [{ refIds: ['D2'] }] }] }),
    true,
    '모든 축이 단일 입장인데 통과했다',
  );
  assert.equal(
    a._needsSynthesisEscalation({ comparisons: [{ positions: [{ refIds: ['D1'] }, { refIds: ['D2'] }] }] }),
    false,
    '입장이 갈린 축이 있는데 재시도를 요구했다',
  );
});

test('스키마가 refId 를 그 실행의 실제 목록으로 못박는다', () => {
  const tool = agent()._tool('synthesis', { docs: DOCS });
  const props = tool.input_schema.properties;
  assert.equal(tool.name, 'submit_synthesis_brief');
  assert.deepEqual(props.documents.items.properties.refId.enum, ['D1', 'D2', 'D3']);
  assert.deepEqual(
    props.comparisons.items.properties.positions.items.properties.refIds.items.enum,
    ['D1', 'D2', 'D3'],
    'positions.refIds 가 enum 으로 안 묶였다 — 오귀속 1차 방어가 죽는다',
  );
});

test('다른 트랙 카드는 종합 축을 그리지 않는다 (데일리 코어 무영향)', () => {
  const html = new GitHubPublisher()._buildGuidelineCard({
    type: 'guideline', paper: { pmid: '222', title: 'G', journal: 'Stroke' },
    title_ko: '보통 가이드라인', org: 'AHA', summary: ['a'], summary_ko: ['가'],
    keyChanges: [{ topic: 't', detail: 'd', detail_ko: 'ㄷ' }],
  });
  assert.ok(html.includes('📋 가이드라인'));
  assert.ok(html.includes('핵심 권고'));
  assert.ok(!html.includes('🧩 종합'));
  assert.ok(!html.includes('비교 문헌'));
  assert.ok(!html.includes('공통 지반'));
});

/**
 * ★ 종합 분기는 **가이드라인 분기 뒤에** 있어야 한다 (2026-08-29 실측으로 배운 것).
 *
 * 처음에는 종합을 if-체인 맨 앞에 놨는데, 그러면 종합의
 * `publisher.publish(todayKST, [], { guideline: … })` 가 가이드라인 큐 소진보다 앞에 와서
 * `upcomingConsumed.test.mjs` 의 순서 계약이 적색이 됐다. 그 계약은 "큐 소진이 publish
 * 보다 앞이어야 커밋에 실린다" 는 것이고, 이 저장소가 두 번 데인 자리다.
 * 검사를 느슨하게 고치는 대신 분기를 옮겼다 — 여기서 그 위치를 못 박는다.
 */
test('★ 종합 발행 분기가 가이드라인 큐 소진보다 뒤에 있다 (순서 계약 보호)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  const gConsume = src.indexOf('dropFromGuidelineQueue(pmid');
  const synBranch = src.indexOf('} else if (kind === SYNTHESIS_KIND) {');
  assert.ok(gConsume > 0, '가이드라인 큐 소진이 없다');
  assert.ok(synBranch > gConsume,
    '종합 분기가 가이드라인 큐 소진보다 앞에 있다 — publish 순서 계약이 깨진다');
});

// ═══════════════════════════════════════════════════════════════════════════
// 코드리뷰 회귀 (2026-08-29 · /code-review high) — 아래는 전부 **실행으로 재현된
// 결함**이라 검사로 잠근다. 넷은 이 저장소가 이미 데인 부류다(카드 유실·오귀속).
// ═══════════════════════════════════════════════════════════════════════════
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCAFFOLD = `<!DOCTYPE html><html><body><div class="wrap">
  <div class="stats"><div class="sc"><div class="n stat-papers-count">1</div><div class="l">선정 논문</div></div></div>
  <div class="archive">
<!-- ARCHIVE_START -->
  </div>
  <div class="arch-table"><div class="at-head"><span class="at-title">📚 누적</span><span class="at-count">0편</span></div>
    <div class="at-scroll"><table><tbody><!-- TABLE_ROWS_START --><!-- TABLE_ROWS_END --></tbody></table></div></div>
</div></body></html>`;

async function pubSandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-syn-'));
  await mkdir(path.join(dir, 'output'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), SCAFFOLD);
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  return { dir, pub, guidelines: () => readFile(path.join(dir, 'guidelines.html'), 'utf8') };
}

const PLAIN_GUIDELINE = {
  type: 'guideline',
  paper: { pmid: '111', title: 'ESC 2026 HF', journal: 'Eur Heart J', pubDate: '2026-08' },
  title_ko: '개별 가이드라인', org: 'ESC', version: '2026',
  summary: ['a'], summary_ko: ['가'], keyChanges: [{ topic: 't', detail: 'd', detail_ko: 'ㄷ' }],
};

test('★★ 구성원 문헌을 개별 발행해도 종합 카드가 살아남는다 (카드 유실 회귀)', async () => {
  // 종합 카드 본문에는 묶인 문헌의 PubMed 링크가 전부 들어 있다. 지문이 PMID 하나뿐이던
  // 종전 코드에서는 구성원(111)을 개별 발행하는 순간 종합 카드가 통째로 지워졌다.
  const { pub, guidelines } = await pubSandbox();
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  assert.ok((await guidelines()).includes('data-synthesis-id='), '종합 카드가 발행되지 않았다');

  await pub.publish('2026-08-29', [], { guideline: PLAIN_GUIDELINE, manual: true });
  const html = await guidelines();
  assert.ok(html.includes('data-synthesis-id='), '★ 구성원 개별 발행이 종합 카드를 지웠다');
  assert.ok(html.includes('개별 가이드라인'), '개별 카드가 안 실렸다');
});

test('★★ 같은 종합을 다시 돌려도 카드가 쌓이지 않는다 (중복 누적 회귀)', async () => {
  const { pub, guidelines } = await pubSandbox();
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  const html = await guidelines();
  const cards = (html.match(/data-synthesis-id="/g) ?? []).length;
  assert.equal(cards, 1, `종합 카드가 ${cards}장 쌓였다`);
});

test('종합 발행이 다른 가이드라인 카드를 지우지 않는다', async () => {
  const { pub, guidelines } = await pubSandbox();
  await pub.publish('2026-08-29', [], { guideline: PLAIN_GUIDELINE, manual: true });
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  const html = await guidelines();
  assert.ok(html.includes('개별 가이드라인'), '종합 발행이 개별 카드를 지웠다');
  assert.ok(html.includes('data-synthesis-id='));
});

test('접힌 섹션 헤더가 카드와 같은 말을 한다 (🧩 종합)', async () => {
  const { pub, guidelines } = await pubSandbox();
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  const html = await guidelines();
  const head = html.slice(html.indexOf('<!-- GSECTION:'), html.indexOf('<article'));
  assert.ok(head.includes('🧩 종합'), '헤더가 종합이라고 말하지 않는다');
  assert.ok(!head.includes('📋 가이드라인'), '헤더가 여전히 가이드라인이라고 말한다');
});

test('누적 표 행이 죽은 # 가 아니라 제 카드로 걸린다', async () => {
  const { pub, guidelines } = await pubSandbox();
  await pub.publish('2026-08-29', [], { guideline: cardOf(), manual: true });
  const html = await guidelines();
  const row = html.slice(html.indexOf('<!-- TABLE_ROWS_START -->'), html.indexOf('<!-- TABLE_ROWS_END -->'));
  assert.ok(row.includes('href="#syn:111-web-999"'), `표 행 링크가 죽어 있다: ${row.slice(0, 200)}`);
});

test('★ 공통 지반 EN/KO 짝이 안 밀린다 (오귀속 회귀)', () => {
  // EN 만 filter 하면 인덱스가 밀려 "EN 2" 밑에 "한국어 1" 이 붙었다.
  const card = cardOf({
    commonGround: [
      { point: '', point_ko: '한국어 1' },
      { point: 'EN 2', point_ko: '한국어 2' },
    ],
  });
  assert.equal(card.summary.length, card.summary_ko.length, 'EN/KO 길이가 다르다');
  const i = card.summary.indexOf('EN 2');
  assert.ok(i >= 0);
  assert.equal(card.summary_ko[i], '한국어 2', '★ 다른 항목의 한국어가 붙었다');
});

test('★ 모델이 빠뜨린 문헌도 살아남는다 (입장 소실 회귀)', () => {
  // 목록의 정본은 파이프라인이 넘긴 docs 다. 종전에는 모델 반환값으로 목록을 만들어,
  // 모델이 문헌 하나를 안 적으면 그 문헌의 입장이 모든 축에서 조용히 사라졌다.
  const card = cardOf({ documents: DATA.documents.filter((d) => d.refId !== 'D1') });
  assert.equal(card.documents.length, 3, '빠뜨린 문헌이 목록에서 사라졌다');
  assert.ok(card.comparisons.some((c) => c.positions.some((p) => p.refIds.includes('D1'))),
    '★ 모델이 안 적은 문헌의 입장이 축에서 사라졌다');
});

test('같은 제목을 두 번 찍지 않는다 (원제 없는 카드)', () => {
  const html = new GitHubPublisher()._buildGuidelineCard(cardOf());
  const t = '심부전 2026 세 문서 대조';
  assert.equal((html.match(new RegExp(t, 'g')) ?? []).length, 1, '제목이 두 번 찍힌다');
  assert.ok(!html.includes('<div class="ttle"></div>'), '빈 부제 줄이 남았다');
});

test('★ URL 전용 묶음의 sourceId 가 서로 구분된다 (장부 충돌 회귀)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  assert.ok(!/d\.pmid \|\| 'web'/.test(src),
    "URL 문헌이 전부 'web' 으로 뭉개진다 — 같은 크기의 URL 묶음이 sourceId 를 공유한다");
  assert.match(src, /shortHash\(/, 'URL 구분용 해시가 없다');
});

test('★ sourceText 가 종합에서 조용히 무시되지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  assert.match(src, /kind === SYNTHESIS_KIND && String\(process\.env\.OD_SOURCE_TEXT/,
    '종합에서 sourceText 를 걸러내지 않는다 — 적용했다고 로그만 찍고 아무 일도 안 한다');
});
