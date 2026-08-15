import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGuidelineDocument } from '../src/utils/guidelineClassifier.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

// ★ 라벨 없이 할 수 있는 가장 정직한 회귀 (Fable 판정 2026-08-15).
//
// 이 개편에는 "정답" 라벨이 없다. 과거 트랙 비교 실험(19일)이 라벨이 없어 승자 판정을
// 못 하고 폐기된 전례가 있다. 그런데 **현행 경로가 실제로 발행한 이력 7건**은 라벨은
// 아니어도 실물이다 — 새 분류기가 그 7건을 어떻게 판정하는지는 자기채점이 아니다.
//
// 이 테스트가 실제로 잡아낸 것 둘 (2026-08-15):
//   ① PMID 42373461 — 현행 경로가 **오탐을 발행했다.** 원 지침이 아니라 그 지침의
//      해설·적용 논문인데 PT 가 붙어 있어 통과했다. 새 분류기는 이제 걸러낸다.
//   ② 수동 웹 항목(IDSA) — 분류기가 `needsReview` 로 내리고 있었다. PeterJ 확정 ⑤-A
//      (수동 URL = 최종 승인) 정면 위반이라 `manualApproved` 우회로를 넣었다.
//
// 이 파일은 그 둘이 다시 새지 못하게 못을 박는다.

const HISTORY = new URL('../output/selected_guidelines.json', import.meta.url);

function asCandidate(entry) {
  // 현행 발행 이력에는 초록이 없다. 자동 경로로 들어온 것은 PT 가 있었다는 뜻이고,
  // 수동 웹 항목은 sourceId 를 가진다.
  const manual = !entry.pmid && Boolean(entry.sourceId);
  return {
    title: entry.title,
    sourceUrl: entry.sourceUrl,
    publicationTypes: entry.pmid ? ['Guideline'] : [],
    discoveredBy: entry.pmid ? ['pubmed-pt'] : ['manual-url'],
    abstract: '',
    manualApproved: manual,
  };
}

test('소급 판정: 현행 발행 이력 7건이 전부 분류된다', async () => {
  const orgs = loadGuidelineOrgs();
  const history = JSON.parse(await readFile(HISTORY, 'utf8'));
  assert.equal(history.length, 7, '발행 이력 건수가 바뀌었다 — 기대값을 다시 보라');
  for (const entry of history) {
    const verdict = classifyGuidelineDocument(asCandidate(entry), { orgs }).verdict;
    assert.ok(['guideline', 'needsReview', 'rejected'].includes(verdict), `알 수 없는 판정: ${verdict}`);
  }
});

test('★ 현행 경로가 발행한 오탐(PMID 42373461)을 새 분류기는 걸러낸다', async () => {
  const orgs = loadGuidelineOrgs();
  const history = JSON.parse(await readFile(HISTORY, 'utf8'));
  const entry = history.find((h) => h.pmid === '42373461');
  assert.ok(entry, '대상 이력이 사라졌다');
  const result = classifyGuidelineDocument(asCandidate(entry), { orgs });
  assert.notEqual(result.verdict, 'guideline',
    `지침 해설 논문이 다시 자동 발행 후보가 됐다: ${entry.title}`);
  assert.ok(result.reasons.includes('guideline-commentary-or-digest'),
    `기대한 근거 코드가 없다: ${result.reasons.join(',')}`);
});

test('★ 수동 승인 URL 은 자동 필터를 통째로 우회한다 (확정 ⑤-A)', async () => {
  const orgs = loadGuidelineOrgs();
  const history = JSON.parse(await readFile(HISTORY, 'utf8'));
  const web = history.find((h) => !h.pmid && h.sourceId);
  assert.ok(web, '수동 웹 항목이 사라졌다');
  const result = classifyGuidelineDocument(asCandidate(web), { orgs });
  assert.equal(result.verdict, 'guideline',
    'PeterJ 가 직접 넣은 URL 이 자동 필터에 막혔다 — ⑤-A 위반');
  assert.deepEqual(result.reasons, ['manual-approved']);
});

test('수동 승인은 명시적 부정 패턴보다도 우선한다 (승인이 곧 공식성)', () => {
  const orgs = loadGuidelineOrgs();
  const result = classifyGuidelineDocument({
    title: 'Commentary on the 2026 sepsis guidelines: a delphi study',
    manualApproved: true,
  }, { orgs });
  assert.equal(result.verdict, 'guideline',
    '수동 승인에 자동 판정을 다시 걸면 PeterJ 승인이 무의미해진다');
});

test('수동 승인 플래그가 없으면 같은 문서는 자동 판정을 그대로 받는다', () => {
  const orgs = loadGuidelineOrgs();
  const result = classifyGuidelineDocument({
    title: 'Commentary on the 2026 sepsis guidelines: a delphi study',
  }, { orgs });
  assert.notEqual(result.verdict, 'guideline', '우회로가 기본값이 되면 필터가 통째로 죽는다');
});

test('진짜 학회 지침은 소급 판정에서도 guideline 으로 남는다', async () => {
  const orgs = loadGuidelineOrgs();
  const history = JSON.parse(await readFile(HISTORY, 'utf8'));
  for (const pmid of ['41869844', '41236566', '41122894', '41122895']) {
    const entry = history.find((h) => h.pmid === pmid);
    assert.ok(entry, `이력에서 ${pmid} 가 사라졌다`);
    const result = classifyGuidelineDocument(asCandidate(entry), { orgs });
    assert.equal(result.verdict, 'guideline',
      `진짜 지침이 걸러졌다(과잉 차단): ${entry.title} → ${result.reasons.join(',')}`);
  }
});

// ── 재생 실험 W3(2025/12/18~2026/01/17) 실측에서 잡은 미탐 ──────────────────
// "Executive summary of the Brain Trauma Foundation Guidelines for the Management of
//  Penetrating Traumatic Brain Injury, Second Edition." 이 `summary of the` 에 걸려
// **기각**됐다. 지침의 공식 요약본은 지침 그 자체의 일부다 — 버리면 안 된다.
// 반대로 "지침을 소개하는 저널 글" 도 같은 표현을 쓴다. 제목만으로는 안 갈린다.
// 그래서 이 부류는 기각이 아니라 `needsReview` 격리로 내렸다(설계 §6.5 그대로).

test('★ 지침의 공식 요약본을 버리지 않는다 (기각 → 검토함)', () => {
  const orgs = loadGuidelineOrgs();
  // ★ PT 를 일부러 빼고 본다. PT 가 있으면 다른 분기로 새어 이 규칙을 판별하지 못한다
  //   (첫 시도의 테스트가 그래서 변이에 안 걸렸다). 확장 경로로 들어오는 문서가 정확히
  //   이 모양이고, 실험에서 실제로 기각된 것도 이 경로다.
  const result = classifyGuidelineDocument({
    title: 'Executive summary of the Brain Trauma Foundation Guidelines for the Management of Penetrating Traumatic Brain Injury, Second Edition.',
    discoveredBy: ['pubmed-title'],
  }, { orgs });
  assert.notEqual(result.verdict, 'rejected', '공식 요약본을 버리면 그 지침을 통째로 놓친다');
  assert.equal(result.verdict, 'needsReview');
});

test('★ 그래도 지침 해설 논문은 자동 발행 후보가 아니다', () => {
  const orgs = loadGuidelineOrgs();
  const result = classifyGuidelineDocument({
    title: '[The 2026 Surviving Sepsis Campaign guidelines: from evidence updates to practice implementation].',
    publicationTypes: ['Guideline'], discoveredBy: ['pubmed-pt'],
  }, { orgs });
  assert.notEqual(result.verdict, 'guideline');
});

test('★ 합의과정 연구는 여전히 기각이다 (격리로 완화되지 않는다)', () => {
  const orgs = loadGuidelineOrgs();
  const result = classifyGuidelineDocument({
    title: 'Quality indicators for the practice of emergency medicine in Europe (EUSEM-QI-V1): results of a European-wide expanded Delphi consensus process.',
  }, { orgs });
  assert.equal(result.verdict, 'rejected');
  assert.ok(result.reasons.includes('consensus-process-study'));
});
