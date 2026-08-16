import test from 'node:test';
import assert from 'node:assert/strict';
import { filterByRegion, ALLOWED_REGIONS } from '../src/utils/guidelineRegionFilter.js';

// PeterJ 확정 2026-08-16: **미국·유럽·한국 발표 기관 지침만** 받는다.
//   "내가 브라질 가이드라인을 읽고 쓰지는 않을듯."
// 트랙1·3 은 저널 등급으로 이미 걸러지지만 트랙2 는 그 장치가 없어서 전 세계가 들어온다.
//
// ★ 판정 기준은 **발표 기관**이다(저자 소속국·저널 발행국이 아니다).
//   저널 발행국은 특히 나쁘다 — Elsevier=네덜란드, BMJ=영국이라 출판사 주소가 잡힌다.

const g = (title, extra = {}) => ({ title, ...extra });

test('미국·유럽·한국 지침은 통과한다', () => {
  const out = filterByRegion([
    g('2025 American Heart Association Guidelines for CPR'),
    g('European Resuscitation Council Guidelines 2025'),
    g('Korean Society of Critical Care Medicine guidelines on sedation'),
  ]);
  assert.equal(out.kept.length, 3);
  assert.equal(out.dropped.length, 0);
});

test('★ 그 외 지역은 배제된다 (PeterJ 확정)', () => {
  const out = filterByRegion([
    g('Brazilian Society of Cardiology guidelines on heart failure', { affiliationRegion: 'other' }),
    g('Japanese guidelines for sepsis management'),
    g('Chinese expert consensus on ARDS'),
  ]);
  assert.equal(out.kept.length, 0, '그 외 지역이 통과했다');
  assert.equal(out.dropped.length, 3);
});

test('★ 배제된 것은 이유가 남는다 (조용히 사라지면 왜 안 왔는지 못 묻는다)', () => {
  const out = filterByRegion([g('Brazilian guidelines', { affiliationRegion: 'other' })]);
  assert.ok(out.dropped[0].reason, '이유가 없다');
  assert.ok(out.dropped[0].title, '무엇이 빠졌는지 없다');
});

test('★ 지역 단서가 전혀 없으면 배제하되 따로 표시한다 (버리는 것과 못 가린 것은 다르다)', () => {
  const out = filterByRegion([g('Guidelines for the management of severe sepsis')]);
  assert.equal(out.kept.length, 0);
  assert.equal(out.dropped[0].region, null);
  assert.match(out.dropped[0].reason, /판정 불가|unknown/);
});

test('제목에 기관이 없으면 저자 소속국으로 내려간다', () => {
  const out = filterByRegion([g('Guidelines for shock', { affiliationRegion: 'us' })]);
  assert.equal(out.kept.length, 1);
  assert.equal(out.kept[0].region, 'us');
});

test('★ 수동 승인 항목은 지역 필터를 통째로 우회한다 (PeterJ 확정 ⑤-A)', () => {
  // PeterJ가 직접 URL 을 지정한 것은 최종 승인이다 — 자동 필터가 뒤집으면 안 된다.
  const out = filterByRegion([g('Brazilian guidelines', { manualApproved: true })]);
  assert.equal(out.kept.length, 1, '수동 승인이 필터에 걸렸다');
});

test('허용 지역 목록은 셋뿐이다', () => {
  assert.deepEqual([...ALLOWED_REGIONS].sort(), ['eu', 'kr', 'us']);
});

test('빈 입력에도 안 터진다', () => {
  const out = filterByRegion([]);
  assert.deepEqual(out.kept, []);
  assert.deepEqual(out.dropped, []);
  assert.deepEqual(filterByRegion(undefined).kept, []);
});

test('판정 근거(by)가 결과에 실린다 — 나중에 "왜 통과했나" 를 물을 수 있어야 한다', () => {
  const out = filterByRegion([g('2024 ESC Guidelines for atrial fibrillation')]);
  assert.equal(out.kept[0].by, 'org-acronym');
});

// ── ★ 배선 회귀 ─────────────────────────────────────────────────────────────
// 지역 판정 모듈(`guidelineRegion.js`)은 2026-08-15 에 만들어졌는데 **파이프라인에
// 걸리지 않은 채 census 분석용으로만 쓰이고 있었다.** 유닛 테스트는 전부 초록이었다 —
// 모듈이 옳게 동작했으니까. 옳은 모듈을 아무도 안 부르는 것을 유닛 테스트는 못 잡는다.
//
// 그래서 여기서는 **오케스트레이터를 실제로 돌려** 그 외 지역 후보가 큐에 안 남는지 본다.
// 배선을 되돌리는 변이가 이 파일에서 적색이 되어야 한다(안 그러면 또 조용히 빠진다).

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

const emptyState = () => ({ schemaVersion: 2, queue: [], published: [], rejected: [],
  sourceHealth: {}, lastRun: null, updatedAt: '2026-08-01T00:00:00.000Z', configVersion: 'guideline-v2' });

async function runStage(candidates) {
  const dir = await mkdtemp(path.join(tmpdir(), 'region-wire-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify(emptyState()));
  const o = new TrendReviewOrchestrator();
  o.guidelineListPath = file;
  process.env.ENABLE_GUIDELINE_AUTOPUBLISH = 'false';   // 관찰 전용 — 발행은 안 한다
  o._guidelineInputs = async () => ({ candidates, manifest: { ptPmids: [] } });
  o.guideline = { analyze: async (paper) => ({ paper, org: 'X' }) };
  o.fullText = { run: async (papers) => ({ papers }) };
  await o._stageGuideline('2026-08-16');
  return JSON.parse(await readFile(file, 'utf8'));
}

const cand = (pmid, title) => ({ id: `pmid:${pmid}`, pmid, title,
  pubDate: '2026-08-01', status: 'queued', priority: 10, attempts: 0,
  publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'] });

test('★ 배선 확인 — 파이프라인을 실제로 돌리면 그 외 지역 지침이 큐에 안 남는다', async () => {
  const state = await runStage([
    cand('1', '2026 American Heart Association guideline on cardiac arrest'),
    cand('2', 'Brazilian Society of Cardiology guideline on heart failure 2026'),
  ]);
  const all = [...state.queue, ...state.published].map((x) => x.pmid);
  assert.ok(all.includes('1'), '미국 지침이 사라졌다');
  assert.ok(!all.includes('2'), '브라질 지침이 큐에 들어왔다 — 지역 필터가 배선되지 않았다');
});

test('★ 유럽·한국도 실제 파이프라인에서 통과한다', async () => {
  const state = await runStage([
    cand('3', 'European Resuscitation Council Guidelines 2026 on advanced life support'),
    cand('4', 'Korean Society of Critical Care Medicine guideline on sedation 2026'),
  ]);
  const all = [...state.queue, ...state.published].map((x) => x.pmid);
  assert.deepEqual(all.sort(), ['3', '4']);
});
