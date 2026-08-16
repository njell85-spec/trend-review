#!/usr/bin/env node
// 가이드라인 시장조사 — PubMed 에 1년간 지침이 몇 편이나 나오나.
//
// esearch 의 `count` 만 읽는다. PMID 목록도 초록도 안 받으므로 **사실상 무료**이고 LLM 0 이다.
// 우리 파이프라인이 실제로 쓰는 쿼리(`PT_TERM`·`EXPANDED_TERM`)를 그대로 import 해서 센다 —
// 따로 쓴 쿼리로 세면 "시장은 큰데 우리가 못 걷는다" 인지 "시장 자체가 작다" 인지 안 갈린다.
//
// 축을 넷으로 나눠 본다:
//   ① 현행 경로        = PT + EM/CCM MeSH        (지금 자동 경로가 보는 전부)
//   ② 개편 경로        = ① ∪ 확장(제목·유형)     (넓힌 그물)
//   ③ EM/CCM 무관 전체 = PT only                  (분야 제한을 풀면 얼마나 되나)
//   ④ 기관별           = ③ ∩ 기관명              (승인 학회 9곳이 얼마나 내나)

import { readFileSync } from 'node:fs';
import { PT_TERM, EXPANDED_TERM } from '../src/utils/guidelinePubmed.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PT_ONLY = '(("practice guideline"[Publication Type]) OR ("guideline"[Publication Type]))';

// ★ PeterJ 관심주제(`config/interests.json`)를 그대로 쿼리 축으로 쓴다.
//   EM/CCM MeSH 만 보면 관심 질환 지침이 통째로 빠진다 — DKA·뇌졸중·소화관 출혈 지침이
//   "emergency medicine"[MeSH] 를 안 달고 나오는 일이 흔하다. 주제어로 직접 잡는다.
//   지침 형식(PT 또는 확장 표현)과 AND 로 묶어 논문까지 딸려 오지 않게 한다.
const interestsCfg = JSON.parse(readFileSync(new URL('../config/interests.json', import.meta.url), 'utf8'));
const INTEREST_TERMS = Object.values(interestsCfg.topicGroups ?? {})
  .flatMap((g) => g.terms ?? [])
  .map((t) => String(t).trim())
  .filter(Boolean);
const TOPIC_AXIS = `(${INTEREST_TERMS.map((t) => `"${t}"[Title/Abstract]`).join(' OR ')})`;
const GUIDELINE_FORM = `(${PT_ONLY} OR (guideline[Title] OR guidelines[Title] OR "consensus statement"[Title] `
  + `OR "scientific statement"[Title] OR "position statement"[Title] OR "focused update"[Title] `
  + `OR recommendations[Title]))`;
const TOPIC_TERM = `${TOPIC_AXIS} AND ${GUIDELINE_FORM}`;

// ── 트랙3(리뷰 아티클) 축 ────────────────────────────────────────────────────
// 복습·개념 정리용 **내러티브 리뷰**만 센다. systematic review·meta-analysis 는
// 제목·PT 양쪽으로 빼낸다 — 그건 논문 트랙(arm F)의 몫이고, 겹치면 같은 걸 두 번 본다.
const REVIEW_CORE4 = ['N Engl J Med', 'JAMA', 'Lancet', 'BMJ'];
const REVIEW_CCM = ['Intensive Care Med', 'Crit Care Med'];
const REVIEW_WIDE = ['Ann Emerg Med', 'Chest', 'Am J Respir Crit Care Med', 'Circulation'];
const REVIEW_JOURNAL_SETS = {
  core4: REVIEW_CORE4,
  core4_plus_ccm: [...REVIEW_CORE4, ...REVIEW_CCM],
  wide: [...REVIEW_CORE4, ...REVIEW_CCM, ...REVIEW_WIDE],
};
const REVIEW_FORM = '(Review[Publication Type]) NOT ("systematic review"[Publication Type] '
  + 'OR "meta-analysis"[Publication Type] OR "systematic review"[Title] OR "meta-analysis"[Title])';
const reviewTerm = (journals) =>
  `(${journals.map((j) => `"${j}"[Journal]`).join(' OR ')}) AND ${REVIEW_FORM}`;
const apiKey = process.env.PUBMED_API_KEY ?? '';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const days = Number(arg('days', 365));
const listOut = arg('list', '');   // 지정하면 제목 목록까지 받아 JSON 으로 쓴다
const withCountry = process.argv.includes('--countries');   // efetch 로 국가까지 받는다
const withReviews = process.argv.includes('--reviews');     // 트랙3(리뷰 아티클) 시장조사
const asDate = (d) => d.toISOString().slice(0, 10).replaceAll('-', '/');

// esearch 로 PMID 를 회수한다. count 세기와 달리 retmax 가 필요하다.
// 관심주제 쿼리는 4KB 가 넘어 GET URL 한계를 넘는다 — esearch 는 POST 를 받는다.
//
// PubMed 는 API 키 없이 **초당 3회**, 키가 있어도 10회가 상한이다. 축이 늘면서 요청이
// 60개를 넘어가자 러너에서 429 로 통째로 죽었다(2026-08-16 실측). 그래서 둘을 건다:
//   ① 매 요청 사이 최소 간격 — 키 유무에 따라 120ms / 350ms
//   ② 429·5xx 는 지수 백오프로 4회까지 재시도 (그 뒤에도 안 되면 진짜 실패다)
const MIN_GAP_MS = apiKey ? 120 : 350;
let lastCallAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

/** 429·5xx 만 재시도한다. 400·404 는 쿼리가 틀린 것이므로 즉시 던진다. */
async function fetchRetry(url, init, label) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    const res = await fetch(url, init);
    if (res.ok) return res;
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1000 * 2 ** attempt);   // 1s · 2s · 4s · 8s
  }
  throw new Error(`PubMed HTTP ${lastStatus} (${label})`);
}

async function esearchPost(params) {
  const res = await fetchRetry(`${BASE}/esearch.fcgi`, {
    method: 'POST', body: new URLSearchParams(params),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, 'esearch');
  return res.json();
}

async function ids(term, minDate, maxDate, retmax) {
  const out = [];
  // esearch retmax 상한은 10000. 그보다 많으면 retstart 로 넘긴다.
  for (let start = 0; start < retmax; start += 9999) {
    const p = {
      db: 'pubmed', term, mindate: minDate, maxdate: maxDate,
      datetype: 'pdat', retmode: 'json', sort: 'date',
      retmax: String(Math.min(9999, retmax - start)), retstart: String(start),
      ...(apiKey && { api_key: apiKey }),
    };
    const list = (await esearchPost(p))?.esearchresult?.idlist ?? [];
    out.push(...list.map(String));
    if (list.length < 9999) break;
  }
  return out;
}

// esummary 로 제목·저널·발행일만 받는다. 초록은 안 받는다(가볍게).
async function summaries(pmids) {
  const BATCH = 200;
  const out = [];
  for (let i = 0; i < pmids.length; i += BATCH) {
    const p = new URLSearchParams({
      db: 'pubmed', id: pmids.slice(i, i + BATCH).join(','), retmode: 'json',
      ...(apiKey && { api_key: apiKey }),
    });
    const res = await fetchRetry(`${BASE}/esummary.fcgi?${p}`, undefined, 'esummary');
    const r = (await res.json())?.result ?? {};
    for (const uid of r.uids ?? []) {
      const rec = r[uid];
      if (!rec) continue;
      out.push({
        pmid: String(uid),
        title: rec.title ?? '',
        journal: rec.source ?? '',
        date: rec.pubdate ?? '',
        types: rec.pubtype ?? [],
      });
    }
  }
  return out;
}


// ── 국가 판정 ────────────────────────────────────────────────────────────────
// esummary 에는 국가가 없다. efetch XML 의 두 곳을 본다:
//   ① MedlineJournalInfo/Country — **저널 발행국**
//   ② 첫 Affiliation 문자열 끝의 국가명 — **저자 소속국**
// 지침이 "어디서 나왔나" 는 ②가 더 가깝다(독일 학회 지침이 영국 저널에 실릴 수 있다).
// ②가 없으면 ①로 떨어진다. 둘 다 추정이라는 것을 리포트에 밝힌다.

const EUROPE = new Set(['england','scotland','wales','northern ireland','ireland','united kingdom','uk',
  'germany','france','italy','spain','netherlands','switzerland','sweden','norway','denmark','finland',
  'austria','belgium','poland','portugal','greece','czech republic','czechia','hungary','slovakia','slovenia',
  'croatia','serbia','romania','bulgaria','iceland','luxembourg','estonia','latvia','lithuania','malta','cyprus']);
const US = new Set(['united states','usa','u.s.a.','u.s.','united states of america']);
const KOREA = new Set(['korea (south)','south korea','republic of korea','korea','korea, republic of']);

function bucketOf(name) {
  const v = String(name ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!v) return null;
  if (US.has(v)) return 'us';
  if (KOREA.has(v)) return 'kr';
  if (EUROPE.has(v)) return 'eu';
  return 'other';
}

// Affiliation 문자열 끝에서 국가명을 뽑는다: "..., Boston, MA, USA."
function countryFromAffiliation(aff) {
  if (!aff) return null;
  const parts = String(aff).replace(/\.\s*$/, '').split(/,\s*/);
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
    const b = bucketOf(parts[i]);
    if (b && b !== 'other') return { bucket: b, raw: parts[i].trim() };
    if (b === 'other' && i === parts.length - 1) return { bucket: 'other', raw: parts[i].trim() };
  }
  return null;
}

async function fetchCountries(pmids) {
  const BATCH = 200;
  const out = new Map();
  for (let i = 0; i < pmids.length; i += BATCH) {
    const batch = pmids.slice(i, i + BATCH);
    const body = new URLSearchParams({
      db: 'pubmed', id: batch.join(','), retmode: 'xml',
      ...(apiKey && { api_key: apiKey }),
    });
    const res = await fetchRetry(`${BASE}/efetch.fcgi`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, 'efetch');
    const xml = await res.text();
    // 레코드 단위로 자른다. 정규식 파싱이지만 필요한 필드가 둘뿐이라 파서를 끌어오지 않는다.
    for (const chunk of xml.split(/<PubmedArticle[\s>]/).slice(1)) {
      const pmid = (chunk.match(/<PMID[^>]*>(\d+)<\/PMID>/) ?? [])[1];
      if (!pmid) continue;
      const jc = (chunk.match(/<MedlineJournalInfo>[\s\S]*?<Country>([^<]*)<\/Country>/) ?? [])[1] ?? '';
      const aff = (chunk.match(/<Affiliation>([\s\S]*?)<\/Affiliation>/) ?? [])[1] ?? '';
      const fromAff = countryFromAffiliation(aff.replace(/&amp;/g, '&'));
      out.set(String(pmid), {
        jc, jcBucket: bucketOf(jc),
        ac: fromAff?.raw ?? '', acBucket: fromAff?.bucket ?? null,
      });
    }
    console.log(`[country] ${Math.min(i + BATCH, pmids.length)}/${pmids.length}`);
  }
  return out;
}

async function count(term, minDate, maxDate) {
  const data = await esearchPost({
    db: 'pubmed', term, mindate: minDate, maxdate: maxDate,
    datetype: 'pdat', retmode: 'json', retmax: '0',
    ...(apiKey && { api_key: apiKey }),
  });
  const n = Number(data?.esearchresult?.count);
  if (!Number.isFinite(n)) throw new Error('esearch 응답에 count 가 없다');
  return n;
}

const now = new Date();
const maxDate = asDate(now);
const minDate = asDate(new Date(now.getTime() - days * 86_400_000));

const orgs = loadGuidelineOrgs();
const lines = [];
const push = (s) => { lines.push(s); console.log(s); };

push(`## 가이드라인 시장조사 — 최근 ${days}일 (${minDate} ~ ${maxDate})`);
push('');
push('esearch `count` 만 읽는다. 우리 파이프라인이 실제로 쓰는 쿼리 그대로다.');
push('');

const axes = [
  ['① 현행 자동 경로 (PT + EM/CCM MeSH)', PT_TERM],
  ['② 확장분만 (제목·유형 + EM/CCM MeSH)', EXPANDED_TERM],
  ['③ 개편 경로 합집합 (① OR ②)', `(${PT_TERM}) OR (${EXPANDED_TERM})`],
  ['④ 분야 제한 없는 PubMed 전체 지침 (PT only)', PT_ONLY],
  ['⑤ 관심주제 지침 (interests.json 주제어 + 지침 형식)', TOPIC_TERM],
];
push('');
push(`관심주제 축은 \`config/interests.json\` 의 주제어 **${INTEREST_TERMS.length}개**를 그대로 쓴다.`);

push('| 축 | 최근 1년 편수 |');
push('|---|---|');
const totals = {};
for (const [label, term] of axes) {
  const n = await count(term, minDate, maxDate);
  totals[label] = n;
  push(`| ${label} | **${n.toLocaleString()}** |`);
}

// 월별 분포 — 몰려 나오는지(AHA Parts 처럼) 고르게 나오는지
push('');
push('### ③ 개편 경로의 월별 분포 (30일 구간 12개)');
push('');
push('| 구간 | 기간 | 편수 |');
push('|---|---|---|');
const monthly = [];
for (let m = 0; m < Math.floor(days / 30); m++) {
  const end = new Date(now.getTime() - m * 30 * 86_400_000 - (m > 0 ? 86_400_000 : 0));
  const start = new Date(now.getTime() - (m + 1) * 30 * 86_400_000);
  const n = await count(`(${PT_TERM}) OR (${EXPANDED_TERM})`, asDate(start), asDate(end));
  monthly.push(n);
  push(`| M${m} | ${asDate(start)}~${asDate(end)} | ${n} |`);
}
const sum = monthly.reduce((a, b) => a + b, 0);
push('');
push(`월 평균 **${(sum / monthly.length).toFixed(1)}편** · 최소 ${Math.min(...monthly)} · 최대 ${Math.max(...monthly)}`);

// 기관별 — 승인 학회가 실제로 얼마나 내나 (분야 제한 없이 기관명으로)
push('');
push('### ④ 승인 기관별 지침 발행 편수 (분야 제한 없음 · PT only ∩ 기관명)');
push('');
push('| 기관 | tier | 최근 1년 |');
push('|---|---|---|');
for (const org of orgs.organizations) {
  const names = [org.name, ...(org.aliases ?? [])].filter(Boolean);
  const nameTerm = names.map((v) => `"${v}"[All Fields]`).join(' OR ');
  const n = await count(`${PT_ONLY} AND (${nameTerm})`, minDate, maxDate);
  push(`| ${org.name} (${org.id}) | ${org.tier} | ${n} |`);
}

push('');
push('> **주의**: ④의 기관명 매칭은 저자 소속·본문 언급까지 잡으므로 **과대추정**이다.');
push('> 발행 주체 판정은 파이프라인의 `matchOrganization` + 문서 성격 판정이 따로 한다.');

// ── 트랙3 시장조사 (--reviews) ──────────────────────────────────────────────
if (withReviews) {
  push('');
  push('### ⑥ 트랙3 후보 — 유명 저널 리뷰 아티클 (SR·메타 제외)');
  push('');
  push('| 저널 묶음 | 최근 1년 | 최근 3년 | 최근 5년 |');
  push('|---|---|---|---|');
  for (const [name, journals] of Object.entries(REVIEW_JOURNAL_SETS)) {
    const cells = [];
    for (const d of [365, 365 * 3, 365 * 5]) {
      const from = asDate(new Date(now.getTime() - d * 86_400_000));
      cells.push(await count(reviewTerm(journals), from, maxDate));
    }
    push(`| ${name} (${journals.length}종) | ${cells[0]} | ${cells[1]} | ${cells[2]} |`);
  }
  push('');
  push('> SR·메타분석은 제외했다 — 그건 논문 트랙(arm F)의 몫이고 겹치면 같은 걸 두 번 본다.');

  // ★ 위 숫자는 **주제 필터가 없는 전량**이다. NEJM·JAMA·Lancet·BMJ 는 전 의학 분야를
  //   다루므로 그대로는 슬롯 주기를 못 정한다 — 관심주제로 좁힌 뒤라야 "주에 몇 편"이 나온다.
  push('');
  push('### ⑦ 트랙3 — 관심주제로 좁힌 리뷰 (슬롯 주기를 정하는 숫자)');
  push('');
  push('| 저널 묶음 | 최근 1년 | 최근 3년 | 최근 5년 | 주당(5년 기준) |');
  push('|---|---|---|---|---|');
  for (const [name, journals] of Object.entries(REVIEW_JOURNAL_SETS)) {
    const cells = [];
    for (const d of [365, 365 * 3, 365 * 5]) {
      const from = asDate(new Date(now.getTime() - d * 86_400_000));
      cells.push(await count(`${TOPIC_AXIS} AND ${reviewTerm(journals)}`, from, maxDate));
    }
    const perWeek = (cells[2] / (365 * 5 / 7)).toFixed(1);
    push(`| ${name} (${journals.length}종) | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${perWeek} |`);
  }
  push('');
  push('> 관심주제 축은 ⑤와 같은 `config/interests.json` 주제어를 쓴다(Title/Abstract).');
}

// ── 목록 회수 (--list <경로>) ────────────────────────────────────────────────
if (listOut) {
  const { writeFileSync } = await import('node:fs');
  const axisList = [
    ['pt_emccm', '① 현행 자동 경로 (PT + EM/CCM MeSH)', PT_TERM],
    ['expanded_emccm', '② 확장분만 (제목·유형 + EM/CCM MeSH)', EXPANDED_TERM],
    ['union_emccm', '③ 개편 경로 합집합', `(${PT_TERM}) OR (${EXPANDED_TERM})`],
    ['pt_all', '④ 분야 제한 없는 PubMed 전체 지침 (PT only)', PT_ONLY],
    ['topic', '⑤ 관심주제 지침', TOPIC_TERM],
  ];
  const payload = { generatedAt: new Date().toISOString(), days, minDate, maxDate, axes: {} };
  for (const [key, label, term] of axisList) {
    const total = totals[label] ?? await count(term, minDate, maxDate);
    const pmids = await ids(term, minDate, maxDate, total);
    const items = await summaries(pmids);
    payload.axes[key] = { label, term, total, fetched: items.length, items };
    console.log(`[list] ${key}: count=${total} fetched=${items.length}`);
  }
  if (withCountry) {
    // 국가는 축을 가로질러 같은 PMID 를 공유하므로 **한 번만** 받는다.
    const allPmids = [...new Set(Object.values(payload.axes).flatMap((a) => a.items.map((x) => x.pmid)))];
    console.log(`[country] 대상 ${allPmids.length}건`);
    const map = await fetchCountries(allPmids);
    let hit = 0;
    for (const axis of Object.values(payload.axes)) {
      for (const it of axis.items) {
        const c = map.get(it.pmid);
        if (!c) continue;
        hit += 1;
        it.jc = c.jc; it.jcb = c.jcBucket; it.ac = c.ac; it.acb = c.acBucket;
      }
    }
    console.log(`[country] 채워진 항목 ${hit}건`);
  }
  writeFileSync(listOut, JSON.stringify(payload));
  console.log(`[list] wrote ${listOut}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
