/**
 * pool-census.mjs — 수집 풀 실측 (일회성 진단 · 데일리 코어 무영향)
 *
 * 목적(HANDOFF [2026-08-13] "다음 세션 첫 스텝 — 수집 풀 기준부터 확정한다"):
 *   "180일 전체를 같은 품질 문턱으로 구간 균등 표집" 이 성립하는지를 **추측이 아니라 숫자로**
 *   확인한다. 설계토론에 넘길 쟁점 ⓐ(단일 문턱=설계 필터?) ⓑ(최신 구간 가중) ⓒ(초반 밀린
 *   대작 소화)는 아래 4개 실측 없이는 못 정한다.
 *
 * 재는 것:
 *   ① 30일×6구간 구간별 총 편수 (esearch retmax=0 의 count 만 — 레코드를 안 받아 싸다)
 *   ② 구간별 설계 유형 분포 (RCT·메타·SR / 관찰 / 진단 / 가이드라인 / 기타)
 *   ③ 구간별 저널 티어 분포 (top / flagship / specialty / 그외)
 *   ④ 구간별 "엄격 풀"(설계 필터 ∧ 상위 티어) 크기 + 최근 7·14·30일 일간 도착률
 *      → 최신 구간에 할당을 얼마 줘야 '오늘 나온 대작'을 안 놓치는지의 근거.
 *
 * 프로덕션 무영향: 상태 파일·발송·커밋 없음. 결과는 job summary + output/experiments JSON.
 * 환경변수: PUBMED_API_KEY · PUBMED_EMAIL · CENSUS_OUT(기본 output/experiments)
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { DEFAULT_QUERY } from '../src/agents/DataCollectorAgent.js';
import { kstDateStr } from '../src/utils/dates.js';

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const OUT = process.env.CENSUS_OUT ?? 'output/experiments';
const API_KEY = process.env.PUBMED_API_KEY ?? '';
const EMAIL = process.env.PUBMED_EMAIL ?? 'research@example.com';
const SLICE_DAYS = 30;
const SLICES = 6;

const journals = JSON.parse(readFileSync(new URL('../config/journals.json', import.meta.url), 'utf8'));

const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* non-fatal */ }
  }
  console.log(md);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 설계 유형 축 ────────────────────────────────────────────────────────────
// 현행 streamB 의 designTypes 와 같은 3종을 "설계 필터"로 두고, 그 필터가 통째로
// 떨어뜨리는 것이 무엇인지를 보려고 관찰·진단·가이드라인을 따로 센다.
const DESIGN_FILTER =
  '"randomized controlled trial"[Publication Type] OR "meta-analysis"[Publication Type] OR "systematic review"[Publication Type]';
const OBSERVATIONAL =
  '"cohort studies"[MeSH] OR "case-control studies"[MeSH] OR "observational study"[Publication Type] OR "prospective studies"[MeSH] OR "retrospective studies"[MeSH]';
const DIAGNOSTIC =
  '"sensitivity and specificity"[MeSH] OR "predictive value of tests"[MeSH] OR "roc curve"[MeSH]';
const GUIDELINE =
  '"guideline"[Publication Type] OR "practice guideline"[Publication Type] OR "consensus development conference"[Publication Type]';

// ── 색인 지연 프로브 ────────────────────────────────────────────────────────
// 프로덕션 쿼리(DEFAULT_QUERY)는 **MeSH 전용**이고 MeSH 는 발행 몇 주~몇 달 뒤에 붙는다.
// 그래서 "최신 구간이 마르다"가 ⓐ진짜 재고 부족인지 ⓑ색인이 아직 안 붙은 것인지
// 구분이 안 된다. 최신 구간 가중(쟁점 ⓑ)은 이 구분 없이는 못 정한다.
// 같은 구간을 MeSH 를 안 쓰는 두 축으로 다시 세어 가른다:
//   - TIAB: 제목·초록 텍스트 (색인 없이 발행 즉시 검색된다)
//   - 저널 단독: [Journal] 필드 (색인과 무관하게 즉시 붙는다)
const TIAB_QUERY =
  '"emergency department"[tiab] OR "emergency service"[tiab] OR "emergency medicine"[tiab] OR ' +
  '"critical illness"[tiab] OR "critically ill"[tiab] OR "intensive care"[tiab] OR ' +
  '"critical care"[tiab] OR "resuscitation"[tiab]';

const TIERS = ['top_general', 'em_ccm_flagship', 'specialty'];
const tierTerm = (tier) => {
  const ta = journals.tiers?.[tier]?.pubmedTa ?? [];
  return ta.map((j) => `"${j}"[Journal]`).join(' OR ');
};

let calls = 0;
async function esearchCount({ term, minDate, maxDate, datetype = 'edat' }) {
  const params = new URLSearchParams({
    db: 'pubmed', term, retmax: '0', retmode: 'json',
    mindate: minDate, maxdate: maxDate, datetype,
    tool: 'TrendReviewPoolCensus', email: EMAIL,
    ...(API_KEY && { api_key: API_KEY }),
  });
  const url = `${PUBMED_BASE}/esearch.fcgi?${params}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const count = Number(data?.esearchresult?.count);
      if (!Number.isFinite(count)) throw new Error('no count in response');
      calls++;
      // api_key 있으면 10 req/s, 없으면 3 req/s 가 상한이다.
      await sleep(API_KEY ? 120 : 380);
      return count;
    } catch (err) {
      if (attempt === 5) throw new Error(`esearch failed after 5 attempts: ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
}

const slash = (d) => d.toISOString().slice(0, 10).replaceAll('-', '/');

export async function runCensus() {
  const now = new Date();
  mkdirSync(OUT, { recursive: true });
  const BASE = DEFAULT_QUERY;
  const AND = (a, b) => `((${a})) AND ((${b}))`;
  const NOT = (a, b) => `((${a})) NOT ((${b}))`;

  const slices = [];
  for (let i = 0; i < SLICES; i++) {
    const end = new Date(now.getTime() - i * SLICE_DAYS * 86_400_000);
    const start = new Date(now.getTime() - (i + 1) * SLICE_DAYS * 86_400_000);
    slices.push({ index: i, label: `S${i} (${i * SLICE_DAYS}~${(i + 1) * SLICE_DAYS}일 전)`,
      minDate: slash(start), maxDate: slash(end) });
  }

  const rows = [];
  for (const s of slices) {
    const win = { minDate: s.minDate, maxDate: s.maxDate };
    const q = (term, datetype) => esearchCount({ term, ...win, datetype });

    // ① 총 편수 — edat(PubMed 등재일)·pdat(발행일) 둘 다. 재생/수집이 쓰는 날짜축이
    //    달라서 같은 구간도 편수가 갈린다. 그 차이 자체가 설계 판단 재료다.
    const totalEdat = await q(BASE, 'edat');
    const totalPdat = await q(BASE, 'pdat');

    // ② 설계 유형 (edat 기준으로 통일)
    const design = await q(AND(BASE, DESIGN_FILTER), 'edat');
    const observational = await q(AND(BASE, OBSERVATIONAL), 'edat');
    const diagnostic = await q(AND(BASE, DIAGNOSTIC), 'edat');
    const guideline = await q(AND(BASE, GUIDELINE), 'edat');
    const other = await q(
      NOT(BASE, `${DESIGN_FILTER} OR ${OBSERVATIONAL} OR ${DIAGNOSTIC} OR ${GUIDELINE}`), 'edat');

    // ③ 저널 티어
    const tiers = {};
    for (const t of TIERS) tiers[t] = await q(AND(BASE, tierTerm(t)), 'edat');
    tiers.rest = totalEdat - TIERS.reduce((n, t) => n + tiers[t], 0);

    // ④ 엄격 풀 = 설계 필터 ∧ 상위 티어
    const strict = {};
    for (const t of TIERS) strict[t] = await q(AND(AND(BASE, DESIGN_FILTER), tierTerm(t)), 'edat');
    strict.topPlusFlagship = strict.top_general + strict.em_ccm_flagship;
    strict.allTiers = strict.topPlusFlagship + strict.specialty;

    rows.push({ ...s, totalEdat, totalPdat, design, observational, diagnostic, guideline, other, tiers, strict });
    console.error(`[census] ${s.label} 완료 (누적 esearch ${calls}회)`);
  }

  // ④-b 최근 도착률 — '오늘 나온 대작'을 놓치지 않으려면 하루에 몇 편이 도착하는지
  const arrival = {};
  for (const days of [7, 14, 30]) {
    const win = { minDate: slash(new Date(now.getTime() - days * 86_400_000)), maxDate: slash(now) };
    const topFlag = `${tierTerm('top_general')} OR ${tierTerm('em_ccm_flagship')}`;
    const strictN = await esearchCount({ term: AND(AND(BASE, DESIGN_FILTER), topFlag), ...win, datetype: 'edat' });
    const anyTier = await esearchCount({
      term: AND(AND(BASE, DESIGN_FILTER), `${topFlag} OR ${tierTerm('specialty')}`), ...win, datetype: 'edat' });
    arrival[`d${days}`] = { days, strictTopFlagship: strictN, strictAllTiers: anyTier,
      perDayTopFlagship: Number((strictN / days).toFixed(2)), perDayAllTiers: Number((anyTier / days).toFixed(2)) };
  }

  // ⑤ 색인 지연 프로브 — 같은 구간을 MeSH 없이 다시 센다.
  const topFlagTerm = `${tierTerm('top_general')} OR ${tierTerm('em_ccm_flagship')}`;
  for (const r of rows) {
    const win = { minDate: r.minDate, maxDate: r.maxDate };
    r.probe = {
      tiabTotal: await esearchCount({ term: TIAB_QUERY, ...win, datetype: 'edat' }),
      journalOnly: await esearchCount({ term: topFlagTerm, ...win, datetype: 'edat' }),
      journalDesign: await esearchCount({ term: AND(topFlagTerm, DESIGN_FILTER), ...win, datetype: 'edat' }),
    };
    console.error(`[probe] ${r.label} 완료 (누적 esearch ${calls}회)`);
  }

  // ⑥ 저널 약어 검증 — `pubmedTa` 는 PubMed `[Journal]` 검색어(MEDLINE 약어)다.
  // 약어가 틀리면 에러가 아니라 **조용히 0건**이 되고, 그 저널은 수집에서 통째로 빠진 채
  // 아무도 모른다. 2026-08-13 에 exact 69종 대 pubmedTa 28종으로 벌어져 있던 것을
  // 발견했다. 180일 전체에서 0건인 약어를 찾아내 이름을 지적한다.
  const journalCheck = [];
  const wholeWindow = { minDate: slash(new Date(now.getTime() - 180 * 86_400_000)), maxDate: slash(now) };
  for (const tier of TIERS) {
    for (const ta of journals.tiers?.[tier]?.pubmedTa ?? []) {
      const n = await esearchCount({ term: `"${ta}"[Journal]`, ...wholeWindow, datetype: 'edat' });
      journalCheck.push({ tier, pubmedTa: ta, count180: n });
    }
  }
  const deadAbbrevs = journalCheck.filter((j) => j.count180 === 0);
  console.error(`[journals] ${journalCheck.length}종 검증 · 0건 ${deadAbbrevs.length}종`);

  const doc = { generatedAt: new Date().toISOString(), kstDate: kstDateStr(), query: BASE,
    sliceDays: SLICE_DAYS, slices: SLICES, esearchCalls: calls, rows, arrival, journalCheck, deadAbbrevs };
  const path = `${OUT}/pool-census-${kstDateStr()}.json`;
  writeFileSync(path, JSON.stringify(doc, null, 2));
  summary(render(doc));
  console.error(`\n실측 JSON: ${path} (esearch ${calls}회)`);
}

export function render(doc) {
  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');
  let md = `# 수집 풀 실측 — ${doc.kstDate} (30일×${doc.slices}구간)\n\n`;
  md += `쿼리(프로덕션 동일): \`${doc.query}\`\n\n`;

  md += `## ① 구간별 총 편수\n\n| 구간 | 기간(edat) | 총(edat) | 총(pdat) |\n|---|---|---:|---:|\n`;
  for (const r of doc.rows) md += `| ${r.label} | ${r.minDate}~${r.maxDate} | ${r.totalEdat} | ${r.totalPdat} |\n`;

  md += `\n## ② 구간별 설계 유형 (edat 기준)\n\n`;
  md += `| 구간 | 총 | RCT·메타·SR | 관찰 | 진단 | 가이드라인 | 기타(어디에도 안 걸림) |\n|---|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of doc.rows) {
    md += `| ${r.label} | ${r.totalEdat} | ${r.design} (${pct(r.design, r.totalEdat)}) | ${r.observational} (${pct(r.observational, r.totalEdat)}) | ${r.diagnostic} (${pct(r.diagnostic, r.totalEdat)}) | ${r.guideline} (${pct(r.guideline, r.totalEdat)}) | ${r.other} (${pct(r.other, r.totalEdat)}) |\n`;
  }
  md += `\n> ⓐ 판단 근거: **설계 필터를 전체에 걸면 위 표의 "RCT·메타·SR" 열만 남는다.** 나머지 열이 통째로 사라진다.\n`;

  md += `\n## ③ 구간별 저널 티어\n\n| 구간 | top | flagship | specialty | 그외(default·low) |\n|---|---:|---:|---:|---:|\n`;
  for (const r of doc.rows) {
    md += `| ${r.label} | ${r.tiers.top_general} | ${r.tiers.em_ccm_flagship} | ${r.tiers.specialty} | ${r.tiers.rest} (${pct(r.tiers.rest, r.totalEdat)}) |\n`;
  }

  md += `\n## ④ 엄격 풀 = 설계 필터 ∧ 상위 티어 (구간 균등 표집의 실제 재고)\n\n`;
  md += `| 구간 | top∧설계 | flagship∧설계 | specialty∧설계 | top+flagship | 전 티어 |\n|---|---:|---:|---:|---:|---:|\n`;
  for (const r of doc.rows) {
    md += `| ${r.label} | ${r.strict.top_general} | ${r.strict.em_ccm_flagship} | ${r.strict.specialty} | ${r.strict.topPlusFlagship} | ${r.strict.allTiers} |\n`;
  }
  const minStrict = Math.min(...doc.rows.map((r) => r.strict.allTiers));
  md += `\n> 구간 균등 표집의 상한은 **가장 마른 구간**이 정한다 — 여기서는 ${minStrict}편/구간.\n`;

  md += `\n## ④-b 최근 도착률 (하루에 '대작'이 몇 편 오나)\n\n`;
  md += `| 창 | top+flagship∧설계 | /일 | 전 티어∧설계 | /일 |\n|---|---:|---:|---:|---:|\n`;
  for (const k of Object.keys(doc.arrival)) {
    const a = doc.arrival[k];
    md += `| 최근 ${a.days}일 | ${a.strictTopFlagship} | ${a.perDayTopFlagship} | ${a.strictAllTiers} | ${a.perDayAllTiers} |\n`;
  }
  md += `\n> ⓑ 판단 근거: 하루 1편만 발행하므로, **/일 값이 1보다 크면** 최신 구간 할당을 늘려도\n`;
  md += `> 적체가 생긴다(=ⓒ "밀린 대작 소화" 기간이 길어진다). 1보다 작으면 최신 구간만으로는 매일 못 채운다.\n`;
  if (doc.rows.every((r) => r.probe)) {
    md += `\n## ⑤ 색인 지연 프로브 — 최신 구간이 마른 것은 재고 부족인가, 색인 지연인가\n\n`;
    md += `| 구간 | MeSH 쿼리 총 | TIAB 총(색인 무관) | top+flagship 저널 단독 | 저널∧설계 | (참고) MeSH∧저널∧설계 |\n`;
    md += `|---|---:|---:|---:|---:|---:|\n`;
    for (const r of doc.rows) {
      md += `| ${r.label} | ${r.totalEdat} | ${r.probe.tiabTotal} | ${r.probe.journalOnly} | ${r.probe.journalDesign} | ${r.strict.topPlusFlagship} |\n`;
    }
    md += `\n> 읽는 법: **저널 단독**은 색인과 무관하게 즉시 붙는 필드다. 이 열이 구간마다 평평한데\n`;
    md += `> MeSH 쿼리 총만 최신 구간에서 꺼지면 **색인 지연**이다(재고는 있는데 쿼리가 못 본다).\n`;
    md += `> 저널 단독도 같이 꺼지면 그때가 **진짜 재고 부족**이다.\n`;
  }
  if (doc.journalCheck) {
    md += `\n## ⑥ 저널 약어 검증 (\`pubmedTa\` = PubMed [Journal] 검색어)\n\n`;
    md += `180일 전체에서 검증한 ${doc.journalCheck.length}종 중 **0건 ${doc.deadAbbrevs.length}종**`;
    md += doc.deadAbbrevs.length
      ? ` — 아래 약어는 틀렸거나 그 이름으로 색인되지 않는다. 고치기 전까지 그 저널은 수집에서 빠진다.\n\n`
      : ` (전부 살아 있다).\n\n`;
    if (doc.deadAbbrevs.length) {
      md += `| 티어 | pubmedTa | 180일 건수 |\n|---|---|---:|\n`;
      for (const j of doc.deadAbbrevs) md += `| ${j.tier} | \`${j.pubmedTa}\` | ${j.count180} |\n`;
    }
    const thin = doc.journalCheck.filter((j) => j.count180 > 0 && j.count180 < 10);
    if (thin.length) {
      md += `\n180일에 10건 미만(오타 의심): ${thin.map((j) => `\`${j.pubmedTa}\`(${j.count180})`).join(' · ')}\n`;
    }
  }
  md += `\n(esearch ${doc.esearchCalls}회 · 레코드 미수신 — count 만 읽음)\n`;
  return md;
}

if (process.argv[1]?.endsWith('pool-census.mjs')) {
  await runCensus();
}
