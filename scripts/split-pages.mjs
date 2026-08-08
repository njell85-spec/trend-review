#!/usr/bin/env node
/**
 * split-pages.mjs — 배포 페이지 2분할 + 타워 톤 스킨 (스펙 §5.5-B) · 미리보기 전용
 *
 *   index.html        → ① 논문 (데일리 코어)
 *   guidelines.html   → ② 가이드라인 및 기타 (안에서 섹션 분리)
 *
 * 두 페이지는 **대등한 병렬 페이지**다. 상단에 같은 히어로 + 같은 탭 바를 두고
 * 현재 페이지만 활성 표시한다(한쪽이 다른 쪽의 하위 링크로 보이지 않게).
 *
 * 왜 상태 파일이 아니라 배포된 HTML을 파싱하나:
 *   selected_papers.json 은 {pmid,title,date} 뿐이라 **저널명이 없다**(38건 중 9건은
 *   analysis_archive.json 에도 없음). 현재 index.html 표 행에는 전부 박혀 있으므로
 *   HTML 을 정본으로 삼아야 데이터 손실이 0 이다. (스펙 §5.5-B "과거 행 포함")
 *
 * 가르는 키:
 *   카드  — <!-- SECTION:… --> = 논문 / <!-- GSECTION:… --> = 가이드라인·기타
 *           그중 카드에 '🔖 참고자료' 칩이 있으면 기타
 *   표 행 — data-guideline="1" 이 가이드라인·기타 (참고자료 행에도 붙는다)
 *           → 기타 판별은 selected_references.json 의 pmid/sourceId 대조
 *
 * 이 스크립트가 **미리보기 단계에서 함께 고치는 3건** (프로덕션 반영 시 생성기 수정 필요):
 *   ① 참고자료 섹션 헤더가 '📋 가이드라인' 하드코딩 → '🔖 기타 자료'
 *      (생성기: GitHubPublisher._buildGuidelineSection 이 type 을 안 받는다)
 *   ② 표 행에 가이드/기타 구분 마커 없음 → data-kind 부여
 *      (생성기: _tableRows 가 참고자료에도 data-guideline="1" + '📋' 를 붙인다)
 *   ③ 큐레이션 JS 가 표 1개 전제(querySelector) → 표 전부 순회
 *      (생성기: CURATION_BLOCK 의 addTableControls)
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

const headRaw = html.slice(0, iArch + A_START.length); // <head> + 히어로 + 통계 + 위젯
const sectionsRaw = html.slice(iArch + A_START.length, iTable);
const tableBlock = html.slice(iTable, iStatus);
let tail = html.slice(iStatus); // 아카이브 현황 + 큐레이션 블록 + </body>

// sectionsRaw 끝의 '.archive' 닫는 태그를 분리해 둔다 (양쪽 페이지에서 재사용).
const mClose = sectionsRaw.match(/\s*<\/div>\s*$/);
const archiveClose = mClose ? mClose[0] : '\n  </div>\n';
const sectionsBody = mClose ? sectionsRaw.slice(0, mClose.index) : sectionsRaw;

// ── 수정 ③ · 큐레이션 JS 가 표 전부를 순회하게 ─────────────────────────────
const CUR_OLD = `function addTableControls(){
    var table=document.querySelector('.arch-table table'); if(!table)return;`;
const CUR_NEW = `function addTableControls(){
    var _ts=document.querySelectorAll('.arch-table table');
    for(var _i=0;_i<_ts.length;_i++)addTableControlsOne(_ts[_i]);
  }
  function addTableControlsOne(table){
    if(!table)return;`;
const curPatched = tail.includes(CUR_OLD);
if (curPatched) tail = tail.replace(CUR_OLD, CUR_NEW);

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

// 수정 ① — 참고자료 섹션의 접힌 헤더 라벨이 '📋 가이드라인'으로 하드코딩돼 있다.
const fixRefSection = (b) =>
  b.replace('<span class="gl-tag">📋 가이드라인</span>', '<span class="gl-tag ref">🔖 기타 자료</span>');

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

// 수정 ② — 행에 종류 마커를 심는다(대조 없이 갈리게) + 기타 행 아이콘 교정.
const markRow = (r, kind) =>
  r.replace('<tr data-pmid=', `<tr data-kind="${kind}" data-pmid=`)
    .replace('<td class="c-jour">📋 ', kind === 'reference' ? '<td class="c-jour">🔖 ' : '<td class="c-jour">📋 ');

// ── 타워 톤 스킨 (TH 타워홈 · TP 타워플랜 · MP 마스터플랜 공통 디자인 언어) ──
// 웜뉴트럴 지면 + 무지개 라디얼 반사 · 글래스 카드 · 웜 잉크 · 알약 칩.
// 기존 스타일 뒤에 얹는 오버레이라 원본 CSS 는 손대지 않는다.
const THEME = `
<style id="tower-tone">
/* ── 타워 톤 (tower-home / tower-plan / master-plan 공통) ── */
:root{
  --t-ink:#2a2724; --t-ink2:#5c574f; --t-ink3:#6f6960;
  --t-glass:rgba(255,255,255,.52); --t-glass-strong:rgba(255,255,255,.68);
  --t-edge:rgba(255,255,255,.75); --t-edge-strong:rgba(255,255,255,.88);
  --t-shadow:0 1px 0 rgba(255,255,255,.9) inset,
             0 -8px 18px -14px rgba(255,255,255,.9) inset,
             0 18px 34px -22px rgba(80,68,60,.35);
  --t-blue:#5f7fc0; --t-violet-ink:#5b4a9e; --t-violet:rgba(214,198,236,.34);
  --t-amber-ink:#8a5f1e; --t-amber:rgba(222,168,96,.28);
  --t-teal-ink:#1f6b4e; --t-teal:rgba(169,216,191,.36);
  --t-sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;
  --t-blur:blur(26px) saturate(1.35);
}
body{
  font-family:var(--t-sans); color:var(--t-ink);
  background:
    radial-gradient(560px 480px at 10% 2%,  rgba(214,198,236,.55), transparent 68%),
    radial-gradient(620px 520px at 98% 14%, rgba(244,214,192,.50), transparent 70%),
    radial-gradient(640px 560px at 24% 58%, rgba(198,228,212,.45), transparent 70%),
    radial-gradient(560px 480px at 92% 74%, rgba(206,220,244,.45), transparent 70%),
    linear-gradient(165deg,#f6f5f4,#edebe9);
  background-attachment:fixed;
}
/* 히어로 — 색 블록을 걷어내고 지면 위에 글자만 (TH 방식) */
.hd{background:none;background-image:none;color:var(--t-ink);padding:26px 20px 16px;overflow:visible}
.hd .ey{color:var(--t-ink3);font-size:10px;letter-spacing:2.2px}
.hd h1{font-size:25px;font-weight:750;letter-spacing:-.02em;margin-top:6px}
.hd .fn{background:var(--t-glass);border:1px solid var(--t-edge);color:var(--t-ink2);
  box-shadow:var(--t-shadow);-webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur);font-weight:650}
.hd .fn .i svg{stroke:var(--t-ink3)}
/* 통계 — 히어로가 평평해졌으니 겹침(-44px) 해제 */
.stats{margin:2px 18px 0;gap:9px}
.sc{background:var(--t-glass);border:1px solid var(--t-edge);border-radius:20px;
  box-shadow:var(--t-shadow);-webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.sc .n{color:var(--t-blue)}
.sc .l{color:var(--t-ink3)}
/* 페이지 탭 — 두 페이지가 대등하게 보이는 장치 */
.pgnav{display:flex;gap:8px;margin:14px 18px 0}
.pgnav a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:54px;border-radius:999px;text-decoration:none;font-size:13px;font-weight:650;
  background:rgba(255,255,255,.26);border:1px solid rgba(255,255,255,.5);color:var(--t-ink3);
  box-shadow:none;transition:background .15s ease,transform .15s ease}
.pgnav a .sub{font-size:10.5px;font-weight:600;color:var(--t-ink3);margin-top:1px;letter-spacing:.02em;opacity:.85}
/* 활성 탭 — 유리로 떠오르고 블루 링이 한 겹 (대등하되 지금 어디인지는 분명하게) */
.pgnav a.on{background:rgba(255,255,255,.86);border-color:#fff;color:var(--t-ink);font-weight:800;
  box-shadow:var(--t-shadow),0 0 0 2px rgba(95,127,192,.30);
  -webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.pgnav a.on .sub{color:var(--t-blue);font-weight:750;opacity:1}
.pgnav a:active{transform:scale(.985)}
/* 섹션 헤더 (가이드라인 / 기타) */
.tsec{margin:22px 18px 2px}
.tsec .t{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:800;color:var(--t-ink);letter-spacing:-.012em}
.tsec .n{font-size:11px;font-weight:700;color:var(--t-ink3);background:rgba(255,255,255,.6);
  border:1px solid var(--t-edge);border-radius:999px;padding:2px 9px}
.tsec .d{font-size:12px;color:var(--t-ink2);margin-top:4px;line-height:1.5}
/* 카드 — 글래스 */
.archive{padding:12px 18px 0;gap:11px}
details{border-radius:24px}
.day-today{background:var(--t-glass-strong);border:1px solid var(--t-edge-strong);box-shadow:var(--t-shadow);
  -webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.day-past{background:var(--t-glass);border:1px solid var(--t-edge);box-shadow:var(--t-shadow);
  -webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.day-date{color:var(--t-ink)}
.day-cnt,.day-gen{color:var(--t-ink3)}
.day-prev-t{color:var(--t-ink)}
.day-prev-m{color:var(--t-ink2)}
.paper-card,.guideline-card{border-top:1px solid rgba(255,255,255,.65)}
/* 배지 — 알약 + 유리 (TODAY=바이올렛 / 직접지정=앰버 / 가이드 NEW=민트) */
.t-badge{background:var(--t-violet);color:var(--t-violet-ink);border:1px solid var(--t-edge);
  border-radius:999px;box-shadow:none;font-size:10px;letter-spacing:.04em;font-weight:800}
.t-badge[style]{background:var(--t-amber)!important;color:var(--t-amber-ink)!important;
  border:1px solid var(--t-edge)!important;box-shadow:none!important}
.t-badge.gl-badge{background:var(--t-teal);color:var(--t-teal-ink)}
.gl-tag{color:var(--t-ink2);font-weight:700}
.gl-tag.ref{color:var(--t-amber-ink)}
.chip{border-radius:999px;letter-spacing:.02em}
/* 누적 표 — 글래스 + 컬러바 제거 */
.arch-table{margin:16px 18px 0;background:var(--t-glass);border:1px solid var(--t-edge);
  border-radius:22px;box-shadow:var(--t-shadow);-webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.at-head{background:none;color:var(--t-ink);border-bottom:1px solid rgba(255,255,255,.65);padding:14px 16px}
.at-title{font-size:13.5px;font-weight:800;letter-spacing:-.01em}
.at-count{color:var(--t-ink3);font-weight:700}
.arch-table th{color:var(--t-ink3);border-bottom:1px solid rgba(255,255,255,.65)}
.arch-table td{border-bottom:1px solid rgba(255,255,255,.55)}
.c-date{color:var(--t-ink3)}
.c-jour{color:var(--t-ink2)}
.c-title a{color:var(--t-ink)}
/* 빈 섹션 안내 */
.tempty{margin:8px 18px 0;padding:18px;text-align:center;font-size:13px;color:var(--t-ink3);
  background:rgba(255,255,255,.28);border:1px dashed rgba(150,142,133,.5);border-radius:22px}
.ft{color:var(--t-ink3)}
.ft a{color:var(--t-ink2)}
</style>
`;

// ── 헤드 조립 (탭 삽입 + 스킨 주입) ────────────────────────────────────────
const nPapers = papers.length;
function navHtml(active) {
  const tab = (href, on, label, sub) =>
    `<a href="${href}"${on ? ' class="on" aria-current="page"' : ''}><span>${label}</span><span class="sub">${sub}</span></a>`;
  return `
<nav class="pgnav">
  ${tab('index.html', active === 'papers', '📄 논문', `${nPapers}편`)}
  ${tab('guidelines.html', active === 'guides', '📋 가이드라인 · 기타', `${guidelines.length} · ${others.length}건`)}
</nav>
`;
}

// 스킨은 원본 <style> 뒤에 와야 이긴다 → </head> 직전에 주입.
const headThemed = headRaw.replace('</head>', `${THEME}</head>`);
// 탭은 통계 바로 아래(.archive 열리기 직전)에.
const injectNav = (h, active) => h.replace('<div class="archive">', `${navHtml(active)}  <div class="archive">`);

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

const secHead = (icon, label, n, desc) => `
<div class="tsec">
  <div class="t"><span>${icon} ${label}</span><span class="n">${n}건</span></div>
  <div class="d">${desc}</div>
</div>
`;
const emptyBox = (t) => `<div class="tempty">${t}</div>`;

// ── ① index.html (논문) ────────────────────────────────────────────────────
const indexOut =
  injectNav(headThemed, 'papers') +
  papers.join('\n') +
  archiveClose +
  tableHtml('📚 논문 누적', paperRows.length, '편', paperRows.map((r) => markRow(r, 'paper'))) +
  tail;

// ── ② guidelines.html (가이드라인 및 기타) ─────────────────────────────────
// 히어로 문구·통계만 갈아끼우고 스캐폴드(스타일·탭·위젯)는 그대로 재사용 —
// 두 페이지가 같은 골격을 쓰는 것이 '대등한 병렬 페이지'의 실체다.
// ⚠ 통계 교체는 **탭 주입 전**에 한다 — 주입 후에는 `.stats` 뒤가 `<nav>` 로 바뀌어
//   앵커(`<div class="archive">`)가 안 맞고, 원본 카드 2개가 남아 중복된다(실측).
const gStats = `<div class="stats">
    <div class="sc"><div class="n">${guidelines.length}</div><div class="l">가이드라인</div></div>
    <div class="sc"><div class="n">${others.length}</div><div class="l">기타 자료</div></div>
    <div class="sc"><div class="n" style="font-size:13px;line-height:1.3;padding-top:4px"><span class="stat-updated-time">—</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <div class="archive">`;

const gStatsRe = /<div class="stats">[\s\S]*?<\/div>\s*<div class="archive">/;
if (!gStatsRe.test(headThemed)) {
  console.error('✖ 통계 블록 앵커를 찾지 못했습니다 — guidelines 통계가 중복될 수 있습니다.');
  process.exit(2);
}
let gHead = injectNav(headThemed.replace(gStatsRe, gStats), 'guides')
  .replace('<title>EM/CCM Trend Review</title>', '<title>가이드라인 및 기타 — EM/CCM Trend Review</title>')
  .replace(
    /<div class="fn">[\s\S]*?<\/div>\s*<\/header>/,
    '<div class="fn">공식 가이드라인 캐치업 · 직접 지정 참고자료</div>\n  </header>',
  );

// 최종 업데이트 시각은 원본 index 의 값을 그대로 가져온다.
const mUpd = html.match(/<span class="stat-updated-time">([^<]*)<\/span>/);
if (mUpd) gHead = gHead.replace('<span class="stat-updated-time">—</span>', `<span class="stat-updated-time">${mUpd[1]}</span>`);

const guidelinesOut =
  gHead +
  secHead('📋', '가이드라인', guidelines.length, '공식 발행기관의 진료지침 — 캐치업 큐에서 순차 소개') +
  (guidelines.length ? guidelines.join('\n') : emptyBox('아직 소개된 가이드라인이 없습니다.')) +
  secHead('🔖', '기타 자료', others.length, 'PeterJ가 직접 지정한 참고자료 — 공인 문서가 아닐 수 있습니다(카드의 “출처 성격” 참고)') +
  (others.length ? others.map(fixRefSection).join('\n') : emptyBox('아직 등록된 기타 자료가 없습니다.')) +
  archiveClose +
  tableHtml('📋 가이드라인 누적', glRows.length, '건', glRows.map((r) => markRow(r, 'guideline'))) +
  tableHtml('🔖 기타 자료 누적', otherRows.length, '건', otherRows.map((r) => markRow(r, 'reference'))) +
  tail;

// ── 저장 ───────────────────────────────────────────────────────────────────
writeFileSync(path.join(OUT_DIR, 'index.html'), indexOut);
writeFileSync(path.join(OUT_DIR, 'guidelines.html'), guidelinesOut);

console.log(`✓ 분할 + 타워 톤 스킨 → ${OUT_DIR}/`);
console.log(`  index.html       카드 ${papers.length}  표 ${paperRows.length}행`);
console.log(`  guidelines.html  가이드라인 카드 ${guidelines.length} / 기타 카드 ${others.length}`);
console.log(`                   표 가이드 ${glRows.length}행 / 기타 ${otherRows.length}행`);
const before = (html.match(ROW_RE) ?? []).length;
const after = paperRows.length + glRows.length + otherRows.length;
console.log(`  행 보존 검증: 원본 ${before} → 분할 합계 ${after} ${before === after ? '✓ 손실 0' : '✖ 불일치!'}`);
console.log(`  수정 ① 참고자료 섹션 라벨: ${others.length ? '적용' : '대상 없음'}`);
console.log(`  수정 ② 행 data-kind 마커: 적용 (paper/guideline/reference)`);
console.log(`  수정 ③ 큐레이션 표 전부 순회: ${curPatched ? '적용' : '✖ 앵커 불일치 — 확인 필요'}`);
