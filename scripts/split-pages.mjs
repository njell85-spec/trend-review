#!/usr/bin/env node
/**
 * split-pages.mjs — 배포 페이지 2분할 (스펙 §5.5-B) · 미리보기 전용
 *
 *   index.html        → ① 논문 (데일리 코어)
 *   guidelines.html   → ② 가이드라인 및 기타 (안에서 섹션 분리)
 *
 * 왜 상태 파일이 아니라 배포된 HTML을 파싱하나:
 *   selected_papers.json 은 {pmid,title,date} 뿐이라 **저널명이 없다**(38건 중 9건이
 *   analysis_archive.json 에도 없음). 현재 index.html 표 행에는 전부 박혀 있으므로
 *   HTML 을 정본으로 삼아야 데이터 손실이 0 이다. (스펙 §5.5-B "과거 행 포함")
 *
 * 가르는 키:
 *   카드  — <!-- SECTION:… --> = 논문 / <!-- GSECTION:… --> = 가이드라인·기타
 *           그중 카드에 '🔖 참고자료' 칩이 있으면 기타
 *   표 행 — data-guideline="1" 이 가이드라인·기타 (둘 다 붙는다 · 아래 주의)
 *
 * ⚠ 현행 퍼블리셔는 참고자료 행에도 data-guideline="1" + '📋' 를 붙인다(구분 마커 없음).
 *   그래서 기타 행 판별은 output/selected_references.json 의 pmid/sourceId 대조로 한다.
 *   프로덕션 반영 시에는 행에 data-kind 마커를 추가해 이 대조를 없애야 한다.
 *
 * 사용: node scripts/split-pages.mjs [출력디렉터리]   (기본 output/preview-split)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const OUT_DIR = process.argv[2] ?? 'output/preview-split';
mkdirSync(OUT_DIR, { recursive: true });

const html = readFileSync('index.html', 'utf8');

// ── 참고자료 식별자 수집 (행 판별용) ────────────────────────────────────────
let refIds = new Set();
try {
  const refs = JSON.parse(readFileSync('output/selected_references.json', 'utf8'));
  refIds = new Set(refs.map((r) => r.pmid || r.sourceId).filter(Boolean));
} catch {
  // 파일이 없으면 기타 0건으로 본다 — 분할 자체는 성립한다.
}

// ── 영역 분해 ──────────────────────────────────────────────────────────────
const A_START = '<!-- ARCHIVE_START -->';
const T_OPEN = '<div class="arch-table">';
const S_STATUS = '<!-- ARCHIVE_STATUS v1 -->';

const iArch = html.indexOf(A_START);
const iTable = html.indexOf(T_OPEN);
const iStatus = html.indexOf(S_STATUS);
if (iArch < 0 || iTable < 0 || iStatus < 0) {
  console.error('✖ 앵커를 찾지 못했습니다 (ARCHIVE_START / arch-table / ARCHIVE_STATUS).');
  process.exit(2);
}

const head = html.slice(0, iArch + A_START.length); // <head> + 히어로 + 통계 + 위젯
const sectionsRaw = html.slice(iArch + A_START.length, iTable);
const tableBlock = html.slice(iTable, iStatus);
const tail = html.slice(iStatus); // 아카이브 현황 + 큐레이션 블록 + </body>

// sectionsRaw 끝의 '.archive' 닫는 태그를 분리해 둔다 (양쪽 페이지에서 재사용).
const mClose = sectionsRaw.match(/\s*<\/div>\s*$/);
const archiveClose = mClose ? mClose[0] : '\n  </div>\n';
const sectionsBody = mClose ? sectionsRaw.slice(0, mClose.index) : sectionsRaw;

// ── 카드 섹션 분류 ─────────────────────────────────────────────────────────
const SEC_RE = /<!-- (G?SECTION):([^\s>]+) -->[\s\S]*?<!-- \/\1:\2 -->/g;
const papers = [];
const guidelines = [];
const others = [];
for (const m of sectionsBody.matchAll(SEC_RE)) {
  const block = m[0];
  if (m[1] === 'SECTION') papers.push(block);
  else if (block.includes('🔖 참고자료')) others.push(block);
  else guidelines.push(block);
}

// ── 표 행 분류 ─────────────────────────────────────────────────────────────
const ROW_RE = /<tr data-pmid="([^"]*)"[^>]*>[\s\S]*?<\/tr>/g;
const paperRows = [];
const glRows = [];
const otherRows = [];
for (const m of tableBlock.matchAll(ROW_RE)) {
  const row = m[0];
  if (!row.includes('data-guideline')) paperRows.push(row);
  else if (refIds.has(m[1])) otherRows.push(row);
  else glRows.push(row);
}

// 참고자료 행의 '📋' 는 가이드라인 표식이므로 기타 섹션에서는 '🔖' 로 바꾼다.
const fixOtherRow = (r) => r.replace('<td class="c-jour">📋 ', '<td class="c-jour">🔖 ');

// ── 표 스캐폴드 ────────────────────────────────────────────────────────────
function tableHtml(title, count, unit, rows) {
  return `  <div class="arch-table">
    <div class="at-head"><span class="at-title">${title}</span><span class="at-count">${count}${unit}</span></div>
    <div class="at-scroll"><table>
      <thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </div>
`;
}

// ── ① index.html (논문) ────────────────────────────────────────────────────
const navToGuidelines = `
<a href="guidelines.html" class="xpage" style="display:block;max-width:960px;margin:14px auto 0;padding:0 16px;text-decoration:none">
  <div style="background:#fff;border:1px solid #d9e4f0;border-radius:12px;padding:13px 15px;display:flex;align-items:center;gap:10px">
    <span style="font-size:18px">📋</span>
    <div style="flex:1">
      <div style="font-weight:800;font-size:14px;color:#1e3a5f">가이드라인 및 기타</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">공식 가이드라인 ${guidelines.length}건 · 기타 자료 ${others.length}건</div>
    </div>
    <span style="color:#7dabe8;font-weight:800">→</span>
  </div>
</a>
`;

const indexOut =
  head +
  navToGuidelines +
  papers.join('\n') +
  archiveClose +
  tableHtml('📚 누적 아카이브', paperRows.length, '편', paperRows) +
  tail;

// ── ② guidelines.html (가이드라인 및 기타) ─────────────────────────────────
// 히어로·통계만 갈아끼우고 나머지 스캐폴드(스타일·위젯)는 그대로 재사용한다.
let gHead = head
  .replace('<title>EM/CCM Trend Review</title>', '<title>가이드라인 및 기타 — EM/CCM Trend Review</title>')
  .replace('<h1>EM/CCM Trend Review</h1>', '<h1>가이드라인 및 기타</h1>')
  .replace(
    /<div class="fn">[\s\S]*?<\/div>\s*<\/header>/,
    '<div class="fn">공식 가이드라인 캐치업 · 직접 지정 참고자료</div>\n  </header>',
  )
  .replace(
    /<div class="stats">[\s\S]*?<\/div>\s*<\/div>\s*<div class="archive">/,
    `<div class="stats">
    <div class="sc"><div class="n">${guidelines.length}</div><div class="l">가이드라인</div></div>
    <div class="sc"><div class="n">${others.length}</div><div class="l">기타 자료</div></div>
    <div class="sc"><div class="n" style="font-size:13px;line-height:1.3;padding-top:4px"><span class="stat-updated-time">—</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <a href="index.html" style="display:block;max-width:960px;margin:12px auto 0;padding:0 18px;color:#3f72bf;font-weight:700;font-size:13px;text-decoration:none">← 논문 (데일리)</a>
  <div class="archive">`,
  );

// 최종 업데이트 시각은 원본 index 의 값을 그대로 가져온다.
const mUpd = html.match(/<span class="stat-updated-time">([^<]*)<\/span>/);
if (mUpd) gHead = gHead.replace('<span class="stat-updated-time">—</span>', `<span class="stat-updated-time">${mUpd[1]}</span>`);

const secHead = (icon, label, desc, n) => `
<div style="max-width:960px;margin:20px auto 6px;padding:0 18px">
  <div style="display:flex;align-items:baseline;gap:8px">
    <span style="font-size:15px;font-weight:800;color:#1e3a5f">${icon} ${label}</span>
    <span style="font-size:12px;color:#64748b">${n}건</span>
  </div>
  <div style="font-size:12px;color:#94a3b8;margin-top:3px">${desc}</div>
</div>
`;

const emptyBox = (t) =>
  `<div style="max-width:960px;margin:8px auto;padding:0 18px"><div style="background:#fff;border:1px dashed #cbd5e1;border-radius:12px;padding:18px;text-align:center;color:#94a3b8;font-size:13px">${t}</div></div>`;

const guidelinesOut =
  gHead +
  secHead('📋', '가이드라인', '공식 발행기관의 진료지침 — 캐치업 큐에서 순차 소개', guidelines.length) +
  (guidelines.length ? guidelines.join('\n') : emptyBox('아직 소개된 가이드라인이 없습니다.')) +
  secHead('🔖', '기타 자료', 'PeterJ가 직접 지정한 참고자료 — 공인 문서가 아닐 수 있습니다(카드의 "출처 성격" 참고)', others.length) +
  (others.length ? others.join('\n') : emptyBox('아직 등록된 기타 자료가 없습니다.')) +
  archiveClose +
  tableHtml('📋 가이드라인 누적', glRows.length, '건', glRows) +
  tableHtml('🔖 기타 자료 누적', otherRows.length, '건', otherRows.map(fixOtherRow)) +
  tail;

// ── 저장 ───────────────────────────────────────────────────────────────────
writeFileSync(path.join(OUT_DIR, 'index.html'), indexOut);
writeFileSync(path.join(OUT_DIR, 'guidelines.html'), guidelinesOut);

console.log(`✓ 분할 완료 → ${OUT_DIR}/`);
console.log(`  index.html       카드 ${papers.length}  표 ${paperRows.length}행`);
console.log(`  guidelines.html  가이드라인 카드 ${guidelines.length} / 기타 카드 ${others.length}`);
console.log(`                   표 가이드 ${glRows.length}행 / 기타 ${otherRows.length}행`);
const before = (html.match(ROW_RE) ?? []).length;
const after = paperRows.length + glRows.length + otherRows.length;
console.log(`  행 보존 검증: 원본 ${before} → 분할 합계 ${after} ${before === after ? '✓ 손실 0' : '✖ 불일치!'}`);
