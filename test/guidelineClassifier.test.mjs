import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGuidelineDocument } from '../src/utils/guidelineClassifier.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const corpus = JSON.parse(await readFile(new URL('./fixtures/guideline-corpus.json', import.meta.url)));
const orgs = loadGuidelineOrgs();

test('guideline corpus classifications all match their expected verdict', async (t) => {
  for (const candidate of corpus) {
    await t.test(candidate.title, () => {
      const result = classifyGuidelineDocument(candidate, { orgs });
      assert.equal(result.verdict, candidate.expect, `${candidate.title}: actual verdict=${result.verdict}`);
      assert.ok(Array.isArray(result.reasons));
      assert.equal(typeof result.evidence.format, 'boolean');
      assert.equal(typeof result.evidence.publisher, 'boolean');
      assert.equal(typeof result.evidence.normative, 'boolean');
      assert.equal(typeof result.evidence.official, 'boolean');
    });
  }
});

// ── F1+F3 회귀: PT 로 찾아온 문서가 "PT 가 아님" 으로 판정되면 안 된다 ────────────
//
// 2026-08-17 실물: `manifest.ptPmids` 에 42522393 이 들어 있는데 상태 파일에는
// `documentType: null` · `insufficient-positive-evidence` 로 앉아 있었다.
// 원인은 esummary 필드명 오타로 `publicationTypes` 가 전건 빈 배열이던 것(F1).
// 분류기가 PT 근거를 **publicationTypes 하나에만** 걸어 두었기 때문에 그 오타 하나가
// format·official 두 축을 통째로 꺼 버렸다. 발견 경로를 두 번째 근거로 세운다(F3).
test('F3: pubmed-pt 로 발견된 문서는 publicationTypes 가 비어도 공식 문서로 인정된다', () => {
  const out = classifyGuidelineDocument({
    pmid: '42522393',
    title: 'Consensus document on the management of patients with accidental hypothermia',
    publicationTypes: [],                     // ← esummary 가 못 준 날 (실제로 매일 그랬다)
    discoveredBy: ['pubmed-pt', 'pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.official, true, 'PT 쿼리 결과인데 공식 색인 축이 꺼져 있다');
  assert.equal(out.evidence.format, true, 'PT 쿼리 결과인데 문서형식 축이 꺼져 있다');
  assert.equal(out.documentType, 'guideline');
  assert.equal(out.verdict, 'guideline', '두 축이 서면 격리가 아니라 통과여야 한다');
});

test('F3: 확장(제목) 경로만으로 발견된 것은 여전히 승격되지 않는다', () => {
  const out = classifyGuidelineDocument({
    pmid: '41705512',
    title: 'The impact of physician factors on treatment recommendations in sports medicine.',
    publicationTypes: [],
    discoveredBy: ['pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.official, false, 'PT 가 아닌 것까지 공식으로 인정하면 F3 이 너무 넓다');
  assert.equal(out.verdict, 'needsReview');
});

test('F1+F2: publicationTypes 와 초록이 채워지면 확장 경로도 두 축을 채운다', () => {
  const out = classifyGuidelineDocument({
    pmid: '41942814',
    title: 'Teleneurocritical Care (TeleNCC) Consensus Statement',
    publicationTypes: ['Journal Article'],
    abstract: 'This consensus statement provides recommendations for teleneurocritical care programs.',
    discoveredBy: ['pubmed-title'],
  }, { orgs });
  assert.equal(out.evidence.format, true);      // 제목 → consensus
  assert.equal(out.evidence.normative, true);   // 초록 → recommendations  (보강 전에는 항상 false 였다)
  assert.equal(out.verdict, 'guideline');
});

// ── 오탐 5유형 (2026-08-17 관심주제 축 첫 실측) ───────────────────────────────
//
// 주제축을 켜자 그물이 넓어지면서 **"제목에 guideline 이 들어간 연구논문"** 이
// 한꺼번에 `queued` 로 올라왔다. 실측 3개월치에서 정정문 6건이 priority 10~10.8 로
// 상위권에 앉아 있었다 — 그대로 두면 그것이 발행된다.
// 아래 제목들은 전부 **실측 그대로**다.

const HARD_REJECT_CASES = [
  ['correction-or-erratum', 'Correction to: 2026 Guideline for the Early Management of Patients With Acute Ischemic Stroke: A Guideline From the American Heart Association/American Stroke Association.'],
  ['correction-or-erratum', 'Corrigendum to: 2025 ESC/EACTS Guidelines for the management of valvular heart disease.'],
  ['registry-named-guidelines', "Extracorporeal-Cardiopulmonary Resuscitation Deployment in the Pediatric Emergency Department Setting: 2000-2023 Report For the American Heart Association's Get With the Guidelines®-Resuscitation Investigators."],
  ['registry-named-guidelines', 'Advancing in-hospital mortality prediction for acute myocardial infarction: An analysis from the American Heart Association Get With The Guidelines-Coronary Artery Disease Registry.'],
  ['guideline-uptake-study', 'Adherence to strong recommendations of the German Polytrauma Guideline: an analysis of TraumaRegister DGU data over a decade.'],
  ['guideline-uptake-study', 'Third-generation cephalosporin use is frequently non-guideline-concordant in severe community-acquired pneumonia: Findings from a French critical care cohort.'],
  ['guideline-uptake-study', 'Real-world adoption of the 2023 European Society of Cardiology guidelines regarding antiplatelet strategies in acute coronary syndromes: Insights from the European READAPT-2 survey.'],
  ['guideline-uptake-study', 'Temporal changes in clinical practice and mortality in aneurysmal subarachnoid hemorrhage following the 2012 AHA/ASA guidelines: a retrospective cohort study using the MIMIC database.'],
  ['llm-benchmark-study', 'ChatGPT response consistency to the 2025 ESC/EACTS guidelines for the management of valvular heart disease: A test-retest study.'],
  ['llm-benchmark-study', 'A comparative evaluation of large language models in aligning with European Respiratory Society (ERS) guidelines for high-flow nasal cannula in acute respiratory failure.'],
];

// PT 가 붙은 상태로 낸다 — F3 이후 `guidelineType` 이 발견경로로도 켜지므로,
// 그 조건에서도 기각인지가 이 검사의 요점이다(격리로 새면 needsReview 에 쌓이기만 한다).
const asPtDoc = (title) => ({
  pmid: '1', title, publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'],
  abstract: 'We recommend early therapy. Level of evidence A.',
});

for (const [code, title] of HARD_REJECT_CASES) {
  test(`★ 기각: ${code} — ${title.slice(0, 55)}…`, () => {
    const out = classifyGuidelineDocument(asPtDoc(title), { orgs });
    assert.equal(out.verdict, 'rejected', `격리가 아니라 기각이어야 한다 (${out.reasons?.join('+')})`);
    assert.equal(out.reasons[0], code);
  });
}

// ★ 이 목록이 이 개편의 안전장치다. 그물을 좁히다 진짜 지침을 자르면 공급이 도로 마른다.
//   특히 'get with the guidelines' 패턴이 일반 guidelines 를 삼키면 전멸한다.
const MUST_KEEP = [
  '2026 Guideline for the Early Management of Patients With Acute Ischemic Stroke: A Guideline From the American Heart Association/American Stroke Association.',
  'Guidelines for Seizure Prophylaxis in Patients with Aneurysmal Subarachnoid Hemorrhage: A Statement for Healthcare Professionals from the Neurocritical Care Society.',
  'American Heart Association 2025 Guidelines: Basic life support, advanced cardiovascular life support, pediatric advanced life support, and neonatal resuscitation.',
  'Surviving Sepsis Campaign International Guidelines for the Management of Sepsis and Septic Shock.',
  'Management of Patients at Risk of Ischemic Stroke With Left Ventricular Systolic Dysfunction in the Absence of Intracardiac Thrombus: A Scientific Statement From the American Heart Association.',
  'Noninvasive Respiratory Support for Adult Patients with Acute Respiratory Failure. An Official American Thoracic Society Clinical Practice Guideline.',
  'Strategies to prevent ventilator-associated pneumonia in critically ill mechanically ventilated patients: a SIAARTI consensus statement.',
  'ESICM guidelines on circulatory shock and hemodynamic monitoring 2025.',
  'Part 11: Post-Cardiac Arrest Care: 2025 American Heart Association Guidelines for Cardiopulmonary Resuscitation.',
];

test('★ 진짜 지침은 하나도 안 잘린다 (그물을 좁히다 공급이 마르면 안 된다)', () => {
  for (const title of MUST_KEEP) {
    const out = classifyGuidelineDocument(asPtDoc(title), { orgs });
    assert.equal(out.verdict, 'guideline', `진짜 지침이 ${out.verdict} 로 떨어졌다 (${out.reasons?.join('+')}): ${title.slice(0, 60)}`);
  }
});

test('★ 해설·요약 새 표현은 기각이 아니라 격리다 (공식 요약본일 수 있다)', () => {
  for (const title of [
    "The 'ten commandments' for the 2025 ESC/EACTS guidelines for the management of valvular heart disease.",
    'The 2026 AHA/ASA Guideline Updates to Management of Patients with Acute Ischemic Stroke: A Guide for Radiologists.',
    'Ethical Complexities in Extracorporeal Life Support Management: Pearls From the New American Heart Association Ethics Guidelines.',
  ]) {
    const out = classifyGuidelineDocument(asPtDoc(title), { orgs });
    assert.equal(out.verdict, 'needsReview', `${title.slice(0, 50)} — 버리지 말고 격리해야 한다`);
    assert.equal(out.reasons[0], 'guideline-commentary-or-digest');
  }
});

test('★ 순서 계약 — HARD_REJECT 넷이 기존 완화 패턴보다 먼저 걸린다', () => {
  // 실측: "A comparative evaluation of large language models…" 이 `evaluation of` 에 먼저
  // 걸려 LLM 벤치마크인데 격리로 샜다. 배열 순서를 바꿔 고쳤고 그것을 여기서 잠근다.
  const out = classifyGuidelineDocument(
    asPtDoc('A comparative evaluation of large language models in aligning with ERS guidelines.'), { orgs });
  assert.equal(out.reasons[0], 'llm-benchmark-study',
    'commentary-or-evaluation 이 먼저 걸리면 기각이 격리로 완화된다');
});
