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

import { PT_TERM, EXPANDED_TERM } from '../src/utils/guidelinePubmed.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PT_ONLY = '(("practice guideline"[Publication Type]) OR ("guideline"[Publication Type]))';
const apiKey = process.env.PUBMED_API_KEY ?? '';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const days = Number(arg('days', 365));
const asDate = (d) => d.toISOString().slice(0, 10).replaceAll('-', '/');

async function count(term, minDate, maxDate) {
  const p = new URLSearchParams({
    db: 'pubmed', term, mindate: minDate, maxdate: maxDate,
    datetype: 'pdat', retmode: 'json', retmax: '0',
    ...(apiKey && { api_key: apiKey }),
  });
  const res = await fetch(`${BASE}/esearch.fcgi?${p}`);
  if (!res.ok) throw new Error(`PubMed HTTP ${res.status}`);
  const data = await res.json();
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
];

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

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
