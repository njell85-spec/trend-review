import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPediatricOnly, filterPediatric } from '../src/utils/guidelinePediatric.js';

// 소아 전용 배제 (PeterJ 확정 2026-08-17 · 선택지 A-1).
// 제목은 전부 2026-08-17 3개월 dry-run 실측에서 queued 로 올라온 것들이다.

const PEDIATRIC_ONLY = [
  'Surviving Pediatric Cardiogenic Shock: Clinical Approach, Improving Outcomes, and Future Directions: A Scientific Statement From the American Heart Association.',
  'ACR Appropriateness Criteria® Gastrointestinal Bleeding-Child.',
  'An Update to the Classification, Evaluation, and Management of Childhood Interstitial Lung Disease in Infancy: An Official American Thoracic Society Clinical Practice Guideline.',
  'Physical Activity in Pediatric Cardiomyopathies: Moving for Health: A Scientific Statement From the American Heart Association.',
  '[Cardiotoxicity in children and adolescents with acute leukemia: Recommendations from the Leukemia Committee of the French Society of Childhood Cancer (SFCE)].',
  'Consensus statement of the Paediatric Anaesthesiology and Intensive Therapy Section of the Polish Society of Anaesthesiology and Intensive Therapy on the use of VV ECMO in paediatric patients for the treatment of acute respiratory failure.',
  'Comparing early-onset sepsis risk: risk calculator, American Academy of Pediatrics guidelines, and local care.',
];

for (const title of PEDIATRIC_ONLY) {
  test(`소아 전용 배제 — ${title.slice(0, 52)}…`, () => {
    assert.equal(isPediatricOnly({ title }), true);
  });
}

// ★ 이 목록이 안전장치다. 소아 낱말만 보고 자르면 핵심 지침이 통째로 사라진다.
test('★ 소아를 포함하는 성인 종합 지침은 남는다', () => {
  const combined = 'American Heart Association 2025 Guidelines: Basic life support, advanced cardiovascular life support, pediatric advanced life support, and neonatal resuscitation.';
  assert.equal(isPediatricOnly({ title: combined }), false,
    'ACLS 를 담은 통합 지침이다 — pediatric·neonatal 이 같이 있다고 자르면 안 된다');
});

test('★ 성인 지침은 전혀 안 걸린다', () => {
  for (const title of [
    'Noninvasive Respiratory Support for Adult Patients with Acute Respiratory Failure. An Official American Thoracic Society Clinical Practice Guideline.',
    '2026 Guideline for the Early Management of Patients With Acute Ischemic Stroke.',
    'Surviving Sepsis Campaign International Guidelines for the Management of Sepsis and Septic Shock.',
    'ESICM guidelines on circulatory shock and hemodynamic monitoring 2025.',
    'The 2026 AHA/ACC Guideline for the Evaluation and Management of Acute Pulmonary Embolism in Adults.',
  ]) assert.equal(isPediatricOnly({ title }), false, title.slice(0, 60));
});

test('★ PeterJ 수동 승인은 정책 필터가 뒤집지 않는다 (확정 ⑤-A)', () => {
  assert.equal(isPediatricOnly({ title: 'Pediatric sepsis guideline', manualApproved: true }), false);
  assert.equal(isPediatricOnly({ title: 'Pediatric sepsis guideline' }), true);
});

test('filterPediatric 은 배제한 것을 이유와 함께 돌려준다', () => {
  const out = filterPediatric([
    { pmid: '1', title: 'Pediatric shock guideline' },
    { pmid: '2', title: 'Adult sepsis guideline' },
  ]);
  assert.deepEqual(out.kept.map((x) => x.pmid), ['2']);
  assert.equal(out.dropped.length, 1);
  assert.equal(out.dropped[0].reason, '소아 전용');
  assert.equal(out.dropped[0].pmid, '1', '조용히 사라지면 왜 안 왔는지 못 묻는다');
});

// ── 배선 회귀 — 모듈은 옳은데 아무도 안 부르는 함정 ───────────────────────────
test('★ 데일리 수집 경로가 소아 필터를 실제로 태운다', async () => {
  const { TrendReviewOrchestrator } = await import('../src/orchestrator/TrendReviewOrchestrator.js');
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const dir = await mkdtemp(path.join(tmpdir(), 'guideline-ped-'));
  const file = path.join(dir, 'selected_guidelines.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: 'x', configVersion: 'guideline-v2' }));
  const o = new TrendReviewOrchestrator();
  o.guidelineListPath = file;
  process.env.ENABLE_GUIDELINE_LLM_FIT = 'false';
  o._guidelineInputs = async () => ({
    candidates: [
      { id: 'pmid:1', pmid: '1', title: 'AHA guidelines for pediatric cardiogenic shock in children', pubDate: '2026-08-01', journal: 'Circulation', publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'], abstract: 'We recommend x.' },
      { id: 'pmid:2', pmid: '2', title: 'AHA guidelines for adult cardiac arrest', pubDate: '2026-08-01', journal: 'Circulation', publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'], abstract: 'We recommend x.' },
    ],
    manifest: { ptPmids: [] },
  });
  o.guideline = { analyze: async (paper) => ({ paper, org: 'AHA' }) };
  o.fullText = { run: async (papers) => ({ papers }) };
  await o._stageGuideline('2026-08-15');
  const state = JSON.parse(await readFile(file, 'utf8'));
  const ids = [...state.queue, ...state.published, ...state.rejected].map((x) => x.pmid);
  assert.ok(!ids.includes('1'), '소아 전용이 파이프라인에 그대로 들어왔다 — 필터가 안 걸렸다');
  assert.ok(ids.includes('2'), '성인 지침까지 사라졌다');
});
