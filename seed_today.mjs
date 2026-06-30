/**
 * seed_today.mjs — 과거 데이터 전부 리셋하고 오늘(2026-06-29)부터 새로 시작.
 * 오늘의 1편: HI-PEITHO (NEJM 2026) — Opus 셀렉·분석.
 * 출력: index.html (Sky 파스텔, 오늘 섹션만), output/selected_papers.json (오늘 1건).
 *  - git push 는 하지 않음 (사람이 검토 후 커밋).
 */
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubPublisher } from './src/utils/GitHubPublisher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dateStr = '2026-06-29';
const generatedAt = new Date().toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

// ── 오늘의 1편 (PubMed MCP로 수집 → Opus 분석) ───────────────────────────────
const today = {
  paper: {
    title: 'Ultrasound-Facilitated, Catheter-Directed Fibrinolysis for Acute Pulmonary Embolism',
    journal: 'N Engl J Med', pubDate: '2026-03', pmid: '41910345',
    pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/41910345/', doi: '10.1056/NEJMoa2516567',
    scoringData: {
      studyType: 'RCT',
      score: 9.0,
      rationale: '다국가 적응형 RCT, 7일 복합 임상결과와 안전성(두개내출혈 0건)을 명확히 보고 — 응급·중환자 PE 단계적 치료 결정에 직접 적용 가능.',
    },
  },
  title_ko: '급성 폐색전증의 초음파-유도 카테터 혈전용해 (HI-PEITHO)',
  trial: 'HI-PEITHO Trial',
  clinicalApplicabilityScore: 9.0,
  evidenceLevel: 'RCT',

  // 근거 출처 배지 + 보강 출처 (초록 + 웹 보강)
  evidenceSource: '초록 + 웹 보강',
  sources: [
    { label: 'PubMed 초록 — PMID 41910345 (NEJM 2026;394:1979-90, DOI 10.1056/NEJMoa2516567)', url: 'https://pubmed.ncbi.nlm.nih.gov/41910345/' },
    { label: 'TCTMD — HI-PEITHO 결과 보도 (기관·구성요소·전문가 코멘트)', url: 'https://www.tctmd.com/news/hi-peitho-catheter-directed-therapy-bests-anticoagulation-intermediate-risk-pe' },
    { label: 'American College of Cardiology — ACC.26 발표 요약', url: 'https://www.acc.org/latest-in-cardiology/articles/2026/03/25/21/27/sat-930am-hipeitho-acc-2026' },
    { label: 'ClinicalTrials.gov — NCT04790370', url: 'https://clinicaltrials.gov/study/NCT04790370' },
  ],

  clinicalQuestion: 'In acute intermediate-risk pulmonary embolism with cardiorespiratory distress, does ultrasound-facilitated, catheter-directed fibrinolysis plus anticoagulation reduce early adverse outcomes compared with anticoagulation alone?',
  clinicalQuestion_ko: '심폐 곤란 징후가 있는 중등도 위험 급성 폐색전증에서, 초음파-유도 카테터 혈전용해 + 항응고가 항응고 단독 대비 조기 악결과를 줄이는가?',

  pico: {
    population: '[Multinational — 59 sites, U.S. + 8 European countries] Adults with acute intermediate-risk PE (RV/LV end-diastolic diameter ratio ≥1.0 and elevated troponin) plus ≥2 signs of cardiorespiratory distress (SBP ≤110 mm Hg, HR ≥100 bpm, or RR >20). N=544; mean age 58.2±13.5 yr; 42.6% women.',
    intervention: 'Ultrasound-facilitated, catheter-directed fibrinolysis: catheter-administered 9-mg alteplase with concomitant ultrasound (EkoSonic) plus anticoagulation, per prespecified protocol.',
    comparison: 'Anticoagulation alone (control patients could receive rescue catheter-directed therapy on deterioration).',
    outcome: 'Composite of PE-related death, cardiorespiratory decompensation/collapse, or symptomatic recurrent PE within 7 days: 4.0% (11/273) vs 10.3% (28/271); relative risk 0.39 (95% CI 0.20–0.77; P=0.005).',
  },
  pico_ko: {
    population: '[다국가 — 59개 기관, 미국 + 유럽 8개국] 급성 중등도 위험 PE 성인 (우심실/좌심실 이완기말 직경비 ≥1.0 + 트로포닌 상승) + 심폐 곤란 징후 ≥2개(수축기혈압 ≤110, 심박수 ≥100, 호흡수 >20). N=544, 평균 58.2±13.5세, 여성 42.6%.',
    intervention: '초음파-유도 카테터 혈전용해: 카테터로 알테플라제 9 mg + 동시 초음파(EkoSonic) + 항응고 (사전 규정 프로토콜).',
    comparison: '항응고 단독 (대조군은 악화 시 카테터 치료를 구제요법으로 받을 수 있었음).',
    outcome: '7일 내 PE 관련 사망·심폐 대상부전/허탈·증상성 재발 PE 복합: 4.0%(11/273) vs 10.3%(28/271); 상대위험 0.39 (95% CI 0.20–0.77; P=0.005).',
  },

  secondaryOutcomes: [
    '"Hard" events — death, intubation, cardiac arrest, or recurrent PE — were rare and did not differ between groups; the composite benefit was driven by less cardiorespiratory decompensation/collapse.',
    'Major bleeding within 7 days: 4.1% (intervention) vs 2.2% (control), P=0.32; within 30 days 4.1% vs 3.0%, P=0.64.',
    'No intracranial hemorrhage occurred in either group.',
  ],
  secondaryOutcomes_ko: [
    '"Hard" 사건 — 사망·삽관·심정지·재발 PE — 은 드물었고 군간 차이 없음; 복합 결과의 이득은 심폐 대상부전/허탈 감소에서 비롯됨.',
    '7일 내 대량출혈: 중재군 4.1% vs 대조군 2.2% (P=0.32); 30일 4.1% vs 3.0% (P=0.64) — 유의한 차이 없음.',
    '양 군 모두 두개내출혈은 발생하지 않음.',
  ],

  statGlossary: [
    { term: 'RR', explanation_ko: '상대위험: 1보다 작으면 중재군에서 사건이 덜 발생. 예: RR 0.39 → 복합 악결과가 대조군의 약 39% 수준(약 61% 감소).' },
    { term: '95% CI', explanation_ko: '95% 신뢰구간: 참값이 있을 가능성이 높은 범위. 예: 0.20–0.77 전체가 1 미만 → 통계적으로 유의한 감소.' },
    { term: 'P', explanation_ko: 'P값: 결과가 우연일 확률. 예: P=0.005 → 우연으로 보기 어려움(유의).' },
  ],

  limitations: 'Open-label design; benefit driven by the softer decompensation/collapse component while "hard" events (death, intubation, arrest, recurrent PE) did not differ. Control patients who deteriorated could cross over to rescue catheter therapy, so it is unclear whether those deteriorations would have led to worse outcomes. No mortality benefit (short-term PE death is rare). Device-company funded; an accompanying editorial raised concerns about ultrasound efficacy and conflicts of interest. Applies to centers with catheter expertise and the specific eligibility criteria.',
  limitations_ko: '공개표지(open-label) 설계; 이득이 비교적 주관적인 대상부전/허탈 요소에 주도된 반면 "hard" 사건(사망·삽관·심정지·재발 PE)은 차이 없음. 대조군 악화 환자가 구제 카테터 치료로 교차될 수 있어, 그 악화가 실제 나쁜 결과로 이어졌을지는 불확실. 사망 이득 없음(단기 PE 사망 자체가 드묾). 기기회사(Boston Scientific) 후원이며, 동반 사설은 초음파 효능과 이해상충에 우려를 제기함. 카테터 역량 기관·특정 적격기준에 한해 적용.',

  clinicalTakeaway: 'In carefully selected intermediate-risk PE with cardiorespiratory distress, ultrasound-facilitated catheter-directed fibrinolysis lowered early decompensation without excess major bleeding or any intracranial hemorrhage — a targeted escalation option between anticoagulation alone and systemic thrombolysis.',
  clinicalTakeaway_ko: '심폐 곤란을 동반한 선별된 중등도 위험 PE에서 초음파-유도 카테터 혈전용해는 대량출혈 증가나 두개내출혈 없이 조기 대상부전을 낮췄다. 항응고 단독과 전신 혈전용해 사이의 표적 단계적 치료 선택지를 제시한다.',

  practiceChange: [
    'Consider US-facilitated catheter-directed fibrinolysis for intermediate-risk PE with ≥2 markers of cardiorespiratory distress at centers with the expertise.',
    'Reserve for patients meeting the trial’s hemodynamic/imaging criteria; anticoagulation alone remains standard for lower-risk intermediate PE.',
    'Activate a PE response team (PERT) for escalation and device decisions.',
  ],
  practiceChange_ko: [
    '카테터 치료 역량이 있는 기관에서, 심폐 곤란 지표 ≥2개를 가진 중등도 위험 PE에 초음파-유도 카테터 혈전용해를 고려.',
    '시험의 혈역학/영상 기준을 충족하는 환자에 한정; 더 낮은 위험의 중등도 PE는 항응고 단독이 여전히 표준.',
    '단계적 치료·기기 결정을 위해 PE 신속대응팀(PERT)을 가동.',
  ],

  // 결과 비교 막대 (낮을수록 좋음)
  viz: {
    primary: { title: '7일 복합 악결과', a: { l: '혈전용해', v: 4.0, n: '11/273' }, b: { l: '항응고', v: 10.3, n: '28/271' }, tag: 'RR 0.39 · P=0.005' },
    secondary: { title: '7일 대량출혈', a: { l: '혈전용해', v: 4.1, n: '11/273' }, b: { l: '항응고', v: 2.2, n: '6/271' }, tag: 'P=0.32 · 차이 없음' },
  },
};

// ── 1) exclusion list 리셋 (오늘 1건만) ──────────────────────────────────────
const exclusion = [{ pmid: today.paper.pmid, title: today.paper.title.slice(0, 80), date: dateStr }];
await writeFile(path.join(__dirname, 'output/selected_papers.json'), JSON.stringify(exclusion, null, 2));
console.log('✓ output/selected_papers.json 리셋 (1건)');

// ── 2) index.html 새로 생성 (오늘 섹션만) ────────────────────────────────────
const gh = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
const section = gh._buildSection(dateStr, generatedAt, [today], { isToday: true });
const tableRows = gh._tableRows(dateStr, [today]);
const pageHtml = gh.buildPage(section, { days: 1, papers: 1, updated: generatedAt, tableRows });
await writeFile(path.join(__dirname, 'index.html'), pageHtml, 'utf8');
console.log('✓ index.html 새로 생성 (Sky 파스텔, 오늘 1편)');
console.log('완료. git push는 수동 검토 후 진행하세요.');
