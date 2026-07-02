/**
 * GitHub Pages 아카이브 정리:
 * - 오늘(2026-06-09) 중복 섹션 → 1개로 통합 (TODAY)
 * - 어제(2026-06-08) 섹션 추가 (past)
 * - 나머지 중복/테스트 섹션 제거
 * - 통계 업데이트 (2일, 6편)
 */

import { readFile } from 'fs/promises';
import { createRequire } from 'module';

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO  = process.env.GITHUB_REPO;
const API   = 'https://api.github.com';

async function ghReq(path, method = 'GET', body = null) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `token ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const data = await ghReq(`/repos/${OWNER}/${REPO}/contents/index.html`);
const sha  = data.sha;
const html = Buffer.from(data.content, 'base64').toString('utf8');

// 모든 SECTION 블록 추출
const sectionRe = /<!-- SECTION:(.*?) -->[\s\S]*?<!-- \/SECTION:\1 -->/g;
const allSections = [...html.matchAll(sectionRe)];

console.log(`발견된 섹션 수: ${allSections.length}`);
allSections.forEach((m, i) => {
  const id = m[0].match(/<!-- SECTION:(.*?) -->/)[1];
  console.log(`  [${i}] SECTION:${id}`);
});

// 첫 번째 2026-06-09 섹션만 유지 (TODAY)
const todaySec = allSections.find(m => m[0].includes('SECTION:2026-06-09'));
if (!todaySec) throw new Error('2026-06-09 섹션을 찾을 수 없습니다');

// 2026-06-08 past 섹션 생성 (TODAY 섹션을 변환)
let yesterdaySec = todaySec[0]
  .replace(/<!-- SECTION:2026-06-09 -->/g, '<!-- SECTION:2026-06-08 -->')
  .replace(/<!-- \/SECTION:2026-06-09 -->/g, '<!-- /SECTION:2026-06-08 -->')
  // TODAY 배지 → past 배지
  .replace(
    /bg-green-500 text-white text-\[10px\] font-bold px-2 py-0\.5 rounded-full">TODAY/g,
    'bg-slate-200 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">past'
  )
  // 헤더 날짜 텍스트 변경 (font-bold text-blue-900 text-sm 안에 있는 날짜)
  .replace(
    /(<span class="font-bold text-blue-900 text-sm">)2026-06-09(<\/span>)/,
    '$12026-06-08$2'
  )
  // open details → 닫힌 상태
  .replace('<details open class="rounded-xl overflow-hidden shadow-sm border border-blue-200',
           '<details class="rounded-xl overflow-hidden shadow-sm border border-slate-200')
  // 내부 border-blue-200 → border-slate-200
  .replace(/border-blue-200/g, 'border-slate-200')
  // 생성 시각 텍스트 제거 (어제 날짜라 의미 없음)
  .replace(/생성 [\d. :]+/, '생성 2026-06-08');

console.log('\n2026-06-08 섹션 생성 완료');

// 모든 기존 섹션 제거 후 today + yesterday 삽입
let updated = html;
for (const sec of allSections) {
  updated = updated.replace(sec[0], '');
}

// 아카이브 컨테이너에 두 섹션 삽입
updated = updated.replace(
  /(<div class="max-w-2xl mx-auto px-3 py-5 space-y-3">)/,
  `$1\n${todaySec[0]}\n${yesterdaySec}`
);

// 통계 업데이트: 2일, 6편
updated = updated
  .replace(/누적 <b class="text-blue-700">\d+일<\/b>/, '누적 <b class="text-blue-700">2일</b>')
  .replace(/총 분석 <b class="text-blue-700">\d+편<\/b>/, '총 분석 <b class="text-blue-700">6편</b>')
  .replace(/최신 <b class="text-green-600">[\d. :]+<\/b>/, '최신 <b class="text-green-600">2026. 06. 09.</b>');

// 검증
const remaining = [...updated.matchAll(sectionRe)];
console.log(`\n정리 후 섹션 수: ${remaining.length}`);
remaining.forEach(m => {
  const id = m[0].match(/<!-- SECTION:(.*?) -->/)[1];
  console.log(`  SECTION:${id}`);
});

// GitHub에 푸시
const content = Buffer.from(updated, 'utf8').toString('base64');
await ghReq(`/repos/${OWNER}/${REPO}/contents/index.html`, 'PUT', {
  message: 'cleanup: keep 2026-06-08 and 2026-06-09 only (2 days × 3 papers)',
  content,
  sha,
});

console.log('\nGitHub Pages 업데이트 완료');
console.log('https://njell85-spec.github.io/Trend_Review/');
