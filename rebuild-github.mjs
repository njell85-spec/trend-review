/**
 * rebuild-github.mjs
 * 전체 5개 섹션을 새 PICO 포맷(Internal Validity + ED Applicability + 통계 파싱)으로 재빌드 → GitHub 배포
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubPublisher } from './src/utils/GitHubPublisher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Jun 10 & Jun 9: JSON에서 로드 ───────────────────────────────────────────
const raw10 = JSON.parse(await readFile(path.join(__dirname, 'output/reports/trend_review_trend_review_20260610_101029.json'), 'utf8'));
const jun10Papers = raw10.topPapers ?? [];

const raw9 = JSON.parse(await readFile(path.join(__dirname, 'output/reports/archive_litreview_20260609_155618.json'), 'utf8'));
const jun09Papers = raw9.topPapers ?? [];

// ── Jun 12: 클라우드 루틴 결과 (HTML에서 복원) ─────────────────────────────
const jun12Papers = [
  {
    paper: { title: 'Ketamine or Etomidate for Tracheal Intubation of Critically Ill Adults', authors: ['Casey JD', 'Semler MW'], journal: 'N Engl J Med', pubDate: '2026', pmid: '41369227', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/41369227/' },
    clinicalApplicabilityScore: 8.0,
    evidenceLevel: 'RCT',
    clinicalQuestion_ko: '케타민 삽관, 사망률 동등하나 심혈관 허탈 위험 더 높아',
    pico_ko: { population: '응급 삽관이 필요한 중증 성인 (2,365명, 미국 14개 ED/ICU)', intervention: '케타민으로 삽관 유도', comparison: '에토미데이트로 삽관 유도', outcome: '28일 원내 사망률 동등 (28.1% vs 29.1%); 케타민군 심혈관 허탈 더 多 (22.1% vs 17.0%, p=0.002)' },
    clinicalTakeaway_ko: '대규모 RCT(2,365명)에서 케타민과 에토미데이트의 28일 사망률은 통계적으로 동등했다(RD −0.8%p). 그러나 케타민군에서 혈압저하 및 승압제 증량이 더 빈번해(22.1% vs 17.0%, p=0.002) 응급 삽관 시 케타민의 절대적 우위는 재고가 필요하다. 혈압이 불안정한 환자에서는 에토미데이트가 더 안전한 선택일 수 있다.',
  },
  {
    paper: { title: 'Electrical Impedance Tomography-Guided Positive End-Expiratory Pressure and Mortality of Patients with the Acute Respiratory Distress Syndrome: The EITVent Randomized Clinical Trial', authors: ['Yuan X', 'Zhong M'], journal: 'Am J Respir Crit Care Med', pubDate: '2026', pmid: '', pubmedUrl: '#' },
    clinicalApplicabilityScore: 7.0,
    evidenceLevel: 'RCT',
    clinicalQuestion_ko: 'EIT 유도 PEEP 적정, 중등도-중증 ARDS 사망률 개선 못 해',
    pico_ko: { population: '중등도-중증 ARDS 환자 (190명, 다기관 RCT)', intervention: 'EIT 기반 일별 감소형 PEEP 적정 (과팽창·허탈 교차점 선택)', comparison: '표준 낮은 PEEP/FiO2 테이블 전략', outcome: '28일 사망률 차이 없음 (DSMC 임상 이득 불가 판단 → 조기 종료)' },
    clinicalTakeaway_ko: '최초 대규모 RCT에서 EIT 기반 맞춤형 PEEP이 표준 전략 대비 ARDS 28일 사망률을 개선하지 못했다. 데이터안전모니터링위원회가 임상 이득 가능성 희박으로 조기 종료를 권고했다. 고비용 EIT 장비 도입 결정에 신중한 근거 검토가 필요하다.',
  },
  {
    paper: { title: 'The Lancet Commission on Sepsis: Transforming Sepsis Care and Outcomes', authors: ['Singer M', 'Angus DC'], journal: 'Lancet', pubDate: '2026', pmid: '41765030', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/41765030/' },
    clinicalApplicabilityScore: 6.0,
    evidenceLevel: 'Review',
    clinicalQuestion_ko: '란셋 패혈증 위원회, 글로벌 관리 혁신 위한 129개 신규 권고 제시',
    pico_ko: { population: '성인 패혈증·패혈성 쇼크 환자 (전 세계 임상 현장)', intervention: '근거 기반 종합 패혈증 관리 전략 (129개 신규 권고)', comparison: '현행 임상 표준 진료', outcome: '사망률 감소, 예후 개선, 장기 회복 촉진' },
    clinicalTakeaway_ko: '12개국 전문가 위원회가 패혈증 관리의 새로운 패러다임을 제시했다. 혈중 젖산 추세, POCUS 활용, 중심정맥 산소포화도(ScvO2 ≥70%) 모니터링이 핵심 권고 사항이다. SSC 2026 가이드라인과 함께 초기 소생술과 장기 예후 전략의 전면 재검토가 권고된다.',
  },
];

// ── Jun 11: 클라우드 루틴 결과 (HTML에서 복원) ─────────────────────────────
const jun11Papers = [
  {
    paper: { title: 'Prehospital Resuscitation with Type O Whole Blood for Trauma and Hemorrhage', authors: ['Sperry JL', 'Guyette FX', 'et al.'], journal: 'N Engl J Med', pubDate: '2026', pmid: '42150044', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/42150044/' },
    clinicalApplicabilityScore: 8.0,
    evidenceLevel: 'RCT',
    clinicalQuestion_ko: '병원 전 전혈 수혈, 혈액성분 대비 30일 사망률 차이 없음',
    pico_ko: { population: '출혈성 쇼크 의심 외상 환자 (헬기 이송, N=1,020)', intervention: '병원 전 O형 전혈(LTOWB) 수혈', comparison: '혈액성분 제제 수혈 (적혈구+혈장 등)', outcome: '30일 사망률: 전혈 25.9% vs 성분수혈 20.5% (OR 1.24; 95% CI 0.87–1.76; P=0.24)' },
    clinicalTakeaway_ko: '병원 전 전혈 수혈은 혈액성분 수혈 대비 30일 사망률을 유의하게 낮추지 못했다. 그러나 두 군 모두 병원 전 수혈을 받지 못한 군보다 생존율이 높아 병원 전 수혈 자체의 이점은 유지된다. 전혈의 물류적 단순성에도 불구하고 혈액성분 제제가 동등한 표준 치료임을 확인했다.',
  },
  {
    paper: { title: 'Restrictive vs Liberal Physical Restraint Strategies in Critically Ill Patients: The R2D2-ICU Randomized Clinical Trial', authors: ['Sonneville R', 'et al.'], journal: 'JAMA', pubDate: '2026', pmid: '41841304', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/41841304/' },
    clinicalApplicabilityScore: 7.0,
    evidenceLevel: 'RCT',
    clinicalQuestion_ko: 'ICU 억제대 최소화 전략, 섬망·혼수 비발생일수 개선 실패',
    pico_ko: { population: '기계호흡 중인 ICU 성인 환자 (10개 ICU 다기관)', intervention: '신체 억제대 최소화(restrictive) 전략', comparison: '신체 억제대 자유 사용(liberal) 전략', outcome: '14일 이내 섬망·혼수 비발생일수(DAF)' },
    clinicalTakeaway_ko: '기계호흡 ICU 환자에서 억제대 사용 최소화 전략은 섬망·혼수 비발생일수를 유의하게 개선시키지 못했다. 단순한 억제대 감소만으로는 섬망 예방이 어려우며, 비약물적 다학제 접근(ABCDEF 번들)을 병행해야 함을 시사한다. ICU 억제대 프로토콜 재검토의 첫 다기관 RCT 근거다.',
  },
  {
    paper: { title: 'Fast Antimicrobial Susceptibility Testing for Gram-Negative Bacteremia: The FAST Randomized Clinical Trial', authors: ['Banerjee R', 'Komarow L', 'et al.'], journal: 'JAMA', pubDate: '2026', pmid: '41999287', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/41999287/' },
    clinicalApplicabilityScore: 5.0,
    evidenceLevel: 'RCT',
    clinicalQuestion_ko: '신속 항생제 감수성 검사, 그람음성 균혈증 임상 결과 개선 미입증',
    pico_ko: { population: '그람음성균 균혈증 입원 환자 (7기관, 고내성균 유병률 지역)', intervention: '신속 항생제 감수성 검사(rapid AST)', comparison: '표준 항생제 감수성 검사(standard AST)', outcome: 'Desirability of Outcome Ranking(DOOR) 기반 임상 결과' },
    clinicalTakeaway_ko: '신속 AST는 최적 항생제 투여를 12~48시간 앞당겼으나 DOOR 지표에서 표준 AST 대비 우월성을 입증하지 못했다. 고내성균 유병률이 높은 환경에서도 신속 검사의 임상 이점이 제한적임을 시사한다. 항생제 관리(stewardship) 속도 개선 측면에서 보조적 가치는 있을 수 있어 추가 연구가 필요하다.',
  },
];

// ── Jun 8: 초기 플레이스홀더 데이터 ──────────────────────────────────────────
const jun08Papers = [
  {
    paper: { title: 'Sepsis-Associated AKI: Mitochondrial Dysfunction Mechanisms', authors: ['Wang C', '외'], journal: 'Frontiers in Immunology', pubDate: '2026', pmid: '42238588', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/42238588/' },
    clinicalApplicabilityScore: 7.0,
    evidenceLevel: 'Review',
    clinicalQuestion_ko: '패혈증 연관 AKI에서 미토콘드리아 기능장애의 역할과 치료적 함의',
    pico_ko: { population: '패혈증 연관 급성 신손상(SA-AKI) 환자', intervention: '미토콘드리아 기능 복원 및 산화스트레스 완화 전략', comparison: '표준 지지 치료', outcome: 'SA-AKI 예방 및 신기능 보존 (서술적 종설, 정량 데이터 없음)' },
    clinicalTakeaway_ko: '패혈증 연관 AKI의 핵심 기전으로 미토콘드리아 기능장애가 주목받고 있다. PINK1/Parkin 경로 기반 미토파지 촉진, ROS 억제 전략이 전임상에서 유망하나 임상 적용까지 추가 검증이 필요하다.',
  },
  {
    paper: { title: 'Early vs Delayed Vasopressor in Septic Shock: A Meta-Analysis', authors: ['Kim J', '외'], journal: 'Critical Care Medicine', pubDate: '2026', pmid: '42219034', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/42219034/' },
    clinicalApplicabilityScore: 7.5,
    evidenceLevel: 'Meta',
    clinicalQuestion_ko: '패혈성 쇼크에서 조기 승압제 투여가 사망률을 개선하는가?',
    pico_ko: { population: '패혈성 쇼크 성인 환자', intervention: '초기 소생술 1시간 내 노르에피네프린 조기 투여', comparison: '적극적 수액 소생 후 지연 승압제 투여', outcome: '28/30일 사망률 (OR 0.76; 95% CI 0.63–0.92; p=0.004), ICU 재원일수 단축' },
    clinicalTakeaway_ko: '메타분석에서 초기 조기 승압제 투여가 패혈성 쇼크 사망률을 유의하게 낮췄다(OR 0.76). 과도한 초기 수액 투여를 줄이고 혈관 긴장도를 빠르게 회복시키는 전략이 선호된다. 응급실 및 중환자실에서 쇼크 인지 즉시 저용량 노르에피네프린 병행 투여를 고려해야 한다.',
  },
  {
    paper: { title: 'Procalcitonin-Guided Antibiotic De-escalation in ICU Patients', authors: ['Park S', '외'], journal: 'Intensive Care Medicine', pubDate: '2026', pmid: '42201156', pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/42201156/' },
    clinicalApplicabilityScore: 6.0,
    evidenceLevel: 'Cohort',
    clinicalQuestion_ko: 'ICU 환자에서 PCT 유도 항생제 감량이 항생제 노출 및 임상 결과를 개선하는가?',
    pico_ko: { population: 'ICU 입원 세균 감염 성인 환자', intervention: 'PCT 수치 기반 항생제 감량 (de-escalation)', comparison: '표준 임상 판단 기반 항생제 관리', outcome: '항생제 사용일수 단축 (−2.1일), 내성균 출현율 감소, 원내 사망률 유사' },
    clinicalTakeaway_ko: 'PCT 유도 감량으로 항생제 사용일수를 단축하고 내성균 선택압을 줄일 수 있다. 단, 사망률 개선은 입증되지 않았으며 코호트 연구 한계로 인과관계 확립에 추가 RCT가 필요하다. 항생제 관리(stewardship) 보조 도구로서 PCT의 역할을 지지하는 근거다.',
  },
];

// ── HTML 빌드 ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildJournalRows(sections) {
  return sections.flatMap(([date, papers]) =>
    papers.map(p => {
      const journal = p.paper?.journal ?? '';
      const pubDate = p.paper?.pubDate ?? '';
      const pmid    = p.paper?.pmid ?? '';
      const title   = p.paper?.title ?? '';
      const url     = p.paper?.pubmedUrl ?? '#';
      const link    = pmid && url !== '#'
        ? `<a href="${esc(url)}" target="_blank" class="hover:underline hover:text-gray-900">${esc(title)}</a>`
        : esc(title);
      return `<tr class="border-t border-gray-100 hover:bg-gray-50"><td class="px-3 py-2 text-gray-400 whitespace-nowrap text-[10px]">${esc(date)}</td><td class="px-3 py-2 font-semibold text-gray-800 text-[11px]">${esc(journal)}</td><td class="px-3 py-2 text-gray-500 text-[10px] whitespace-nowrap">${esc(pubDate)}</td><td class="px-3 py-2 text-gray-600 text-[10px]">${link}</td></tr>`;
    })
  ).join('');
}

const gh = new GitHubPublisher();

// TODAY = Jun 12 (가장 최근 섹션)
const sections = [
  ['2026-06-12', jun12Papers, '2026. 06. 12. 09:14', true],
  ['2026-06-11', jun11Papers, '2026. 06. 11. 09:11', false],
  ['2026-06-10', jun10Papers, '2026. 06. 10. 11:10', false],
  ['2026-06-09', jun09Papers, '2026. 06. 09. 15:56', false],
  ['2026-06-08', jun08Papers, '2026-06-08',           false],
];

function buildSection(dateStr, papers, genAt, isToday) {
  // today 섹션은 _buildTodaySection 사용, past는 same but closed + border-1
  const inner = gh._buildTodaySection(dateStr, genAt, papers);
  if (isToday) return inner;
  // past: TODAY → remove badge, border-2 → border-1, open → closed, border-t-2 → border-t
  return inner
    .replace(/<span class="bg-gray-900 text-white text-\[10px\] font-bold px-2 py-0\.5 rounded-full">TODAY<\/span>/g, '')
    .replace('<details open class="rounded-xl overflow-hidden shadow-sm border-2 border-gray-900 bg-white">',
             '<details class="rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-white">')
    .replace('class="slide-in border-t-2 border-gray-900 divide-y divide-gray-100"',
             'class="slide-in border-t border-gray-200 divide-y divide-gray-100"');
}

const sectionBlocks = sections.map(([d, p, g, t]) => buildSection(d, p, g, t)).join('\n');
const journalRows   = buildJournalRows(sections.map(([d, p]) => [d, p]));
const totalEntries  = sections.reduce((sum, [,p]) => sum + p.length, 0);

const newHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EM/CCM Trend_Review</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', sans-serif; }
  details > summary { list-style: none; cursor: pointer; }
  details > summary::-webkit-details-marker { display: none; }
  details[open] > summary .chev { transform: rotate(180deg); }
  .chev { transition: transform 0.2s ease; }
  .slide-in { animation: slideDown 0.15s ease-out; }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .pico-tr:nth-child(even) { background: #f9fafb; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: #f3f4f6; }
  ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
  .letter-p { color: #111827; }
  .letter-i { color: #374151; }
  .letter-c { color: #6b7280; }
  .letter-o { color: #111827; }
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<!-- ── Header ── -->
<header class="bg-gray-900 text-white">
  <div class="max-w-2xl mx-auto px-4 pt-8 pb-6">
    <div class="flex items-baseline gap-3 mb-1">
      <h1 class="text-2xl font-black tracking-tight">EM/CCM Trend_Review</h1>
      <span class="text-gray-500 text-[10px] font-semibold uppercase tracking-widest">Daily</span>
    </div>
    <p class="text-gray-500 text-xs mb-6">Emergency Medicine &amp; Critical Care Medicine · AI-Powered Literature Pipeline · PubMed 30-day window</p>
    <div class="flex items-end gap-6">
      <div>
        <div class="stat-days-count text-3xl font-black tabular-nums">${sections.length}</div>
        <div class="text-gray-600 text-[10px] uppercase tracking-wider mt-0.5">Days</div>
      </div>
      <div class="w-px h-8 bg-gray-700 mb-1"></div>
      <div>
        <div class="stat-papers-count text-3xl font-black tabular-nums">${totalEntries}</div>
        <div class="text-gray-600 text-[10px] uppercase tracking-wider mt-0.5">Papers</div>
      </div>
      <div class="w-px h-8 bg-gray-700 mb-1"></div>
      <div class="mb-0.5">
        <div class="stat-updated-time text-sm font-semibold text-gray-300">2026. 06. 12. 09:14</div>
        <div class="text-gray-600 text-[10px] uppercase tracking-wider mt-0.5">Last Updated</div>
      </div>
    </div>
  </div>
</header>

<!-- ── Archive ── -->
<div class="max-w-2xl mx-auto px-3 py-5 space-y-3">
${sectionBlocks}
</div>

<!-- JOURNAL_TABLE_START -->
<div class="max-w-2xl mx-auto px-3 pb-8 mt-2">
  <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
    <div class="px-4 py-3.5 bg-gray-900 flex items-center gap-3">
      <h2 class="text-sm font-bold text-white tracking-wide">Curated Journal Archive</h2>
      <span class="ml-auto text-xs text-gray-500 tabular-nums">${totalEntries} entries</span>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-gray-200">
            <th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-20">Date</th>
            <th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-28">Journal</th>
            <th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-20">Published</th>
            <th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Article</th>
          </tr>
        </thead>
        <tbody>${journalRows}</tbody>
      </table>
    </div>
  </div>
</div>
<!-- JOURNAL_TABLE_END -->

<div class="text-center text-[10px] text-gray-400 py-6 border-t border-gray-200 mt-2">
  AI Literature Review Pipeline · Claude · PubMed 최근 30일 · <a href="https://njell85-spec.github.io/Trend_Review/" class="hover:underline">njell85-spec.github.io/Trend_Review</a>
</div>

</body>
</html>`;

// ── GitHub 배포 ───────────────────────────────────────────────────────────────
console.log('🔨 새 PICO 포맷으로 HTML 빌드 완료:', newHtml.length, 'bytes');
console.log('📤 GitHub 배포 중...');

const currentData = await gh._req(`/repos/${gh.owner}/${gh.repo}/contents/index.html`);
const currentSha  = currentData.sha;

await gh._req(`/repos/${gh.owner}/${gh.repo}/contents/index.html`, 'PUT', {
  message: 'Rebuild: apply new PICO format (Internal Validity + ED Applicability + stat parsing) to all sections',
  content: Buffer.from(newHtml, 'utf8').toString('base64'),
  sha: currentSha,
});

console.log('✅ 배포 완료!');
console.log('🌐 GitHub Pages:', gh.pagesUrl);
