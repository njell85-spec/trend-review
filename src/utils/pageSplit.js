/**
 * pageSplit — 배포 페이지 3분할 (REPORT_SPEC §4-H · 스펙 §5.5-B)
 *
 *   index.html        ① 논문 (데일리 코어)          SECTION:  · data-kind=paper
 *   guidelines.html   ② 가이드라인                   GSECTION: · data-kind=guideline
 *   reviews.html      ③ 리뷰 · 기타                  RSECTION: · data-kind=review
 *                                                   GSECTION(🔖) · data-kind=reference
 *
 * ★ 2 → 3 분할 (PeterJ 요구 ① · 2026-08-16). "기타" 가 가이드라인 쪽에서 리뷰 쪽으로
 *   옮겨간다. **마이그레이션은 공짜다**: `reviews.html` 이 없으면 merge 가 무시하고,
 *   split 이 기존 `guidelines.html` 의 기타 카드·행을 리뷰 페이지로 옮긴다.
 *
 * ★ 3분할의 진짜 함정은 **마커가 어느 파일에 있는지가 바뀐다는 것**이다. 지난 세션에
 *   정확히 이걸로 헛검사가 났다(`data-guideline` 이 index.html 엔 0개 → `0 >= 0` 이라
 *   행을 통째로 지우는 변이가 초록이었다). `test/threePageNoLoss.test.mjs` 가 못이다.
 *
 * ★ 왜 순수 함수인가 — `publish()` 는 단일 index.html 증분 패처이고, 그 안에는
 *   4주간 잡아온 로직이 쌓여 있다(지침 중복 제거·TODAY 강등·행 dedup·큐레이션 재적용).
 *   두 페이지용으로 쪼개면 그 로직이 두 벌이 되고 데일리 코어 불변식이 흔들린다.
 *   그래서 **합쳤다가 가른다**:
 *
 *     읽기  index + guidelines → mergePages() → 단일 본문
 *     처리  기존 publish() 로직을 그 본문에 그대로 적용   ← 무변경
 *     쓰기  splitPages() → 두 파일
 *
 *   부수효과로 **마이그레이션이 공짜다**: guidelines.html 이 없으면 merge 는 현행
 *   index.html 을 그대로 돌려주고, split 이 과거 카드·행까지 가른다. 배포된 HTML 이
 *   입력이므로 상태 파일에 없는 과거 저널명도 그대로 따라온다(스펙 §5.5-B 실측 제약).
 */

const A_START = '<!-- ARCHIVE_START -->';
const T_OPEN = '<div class="arch-table">';
const ROWS_START = '<!-- TABLE_ROWS_START -->';
const ROWS_END = '<!-- TABLE_ROWS_END -->';
// 버전을 하드코딩하지 않는다 — archiveStatus.js 가 버전 마커를 올리면(v1→v2)
// 하드코딩본은 블록을 못 찾아 guidelines 쪽에 현황 블록이 그대로 남는다(§4-H 5 위반).
const STATUS_BLOCK_RE = /<!-- ARCHIVE_STATUS(?: v\d+)? -->[\s\S]*?<!-- \/ARCHIVE_STATUS -->/;

const SEC_RE = /<!-- ([GR]?SECTION):([^\s>]+) -->[\s\S]*?<!-- \/\1:\2 -->/g;
const ROW_RE = /<tr data-pmid="([^"]*)"[^>]*>[\s\S]*?<\/tr>/g;
const ROW_KIND_RE = /<tr[^>]*\sdata-kind="([^"]*)"/;
/** 트랙별 예고 블록. split 이 이걸 보고 각자의 페이지 맨 위로 옮긴다. */
const UP_RE = /\n?<!-- UPCOMING:([a-z]+) -->[\s\S]*?<!-- \/UPCOMING:\1 -->/g;
/** 트랙 없는 구버전 블록(2026-08-16 이전 배포본). 보이면 걷어낸다. */
const UP_LEGACY_RE = /\n?<!-- UPCOMING -->[\s\S]*?<!-- \/UPCOMING -->/g;
/** 어느 페이지가 어느 트랙 예고를 갖는가. */
const PAGE_TRACK = { papers: 'papers', guides: 'guidelines', reviews: 'reviews' };

/** 타워 톤 (tower-home · tower-plan · master-plan 공통 디자인 언어) */
/**
 * ★ 버전 마커를 반드시 올릴 것 (2026-08-17 실측 사고).
 *   `ensureTowerTone` 은 "이미 있으면 그대로" 라 **새 규칙이 배포본에 영원히 안 들어간다.**
 *   지난 카드 묶음(.past-fold)을 넣었는데 화면에 스타일 없는 맨몸으로 나왔다.
 *   ONDEMAND_WIDGET 이 같은 이유로 버전을 달고 있다 — 같은 규율을 여기도 적용한다.
 *   **이 파일의 CSS 를 고치면 이 숫자를 올려라.**
 */
export const TOWER_TONE_VERSION = 3;
export const TOWER_TONE = `<style id="tower-tone" data-v="3">
/* ── 타워 톤 — 웜뉴트럴 지면 + 무지개 라디얼 + 글래스 카드 ── */
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
.hd{background:none;background-image:none;color:var(--t-ink);padding:26px 20px 16px;overflow:visible}
.hd .ey{color:var(--t-ink3);font-size:10px;letter-spacing:2.2px}
.hd h1{font-size:25px;font-weight:750;letter-spacing:-.02em;margin-top:6px}
.hd .fn{background:var(--t-glass);border:1px solid var(--t-edge);color:var(--t-ink2);
  box-shadow:var(--t-shadow);-webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur);font-weight:650}
.hd .fn .i svg{stroke:var(--t-ink3)}
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
.pgnav a.on{background:rgba(255,255,255,.86);border-color:#fff;color:var(--t-ink);font-weight:800;
  box-shadow:var(--t-shadow),0 0 0 2px rgba(95,127,192,.30);
  -webkit-backdrop-filter:var(--t-blur);backdrop-filter:var(--t-blur)}
.pgnav a.on .sub{color:var(--t-blue);font-weight:750;opacity:1}
.pgnav a:active{transform:scale(.985)}
/* 섹션 헤더 */
.tsec{margin:22px 18px 2px}
.tsec .t{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:800;color:var(--t-ink);letter-spacing:-.012em}
.tsec .n{font-size:11px;font-weight:700;color:var(--t-ink3);background:rgba(255,255,255,.6);
  border:1px solid var(--t-edge);border-radius:999px;padding:2px 9px}
.tsec .d{font-size:12px;color:var(--t-ink2);margin-top:4px;line-height:1.5}
/* 카드 */
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
.t-badge{background:var(--t-violet);color:var(--t-violet-ink);border:1px solid var(--t-edge);
  border-radius:999px;box-shadow:none;font-size:10px;letter-spacing:.04em;font-weight:800}
.t-badge[style]{background:var(--t-amber)!important;color:var(--t-amber-ink)!important;
  border:1px solid var(--t-edge)!important;box-shadow:none!important}
.t-badge.gl-badge{background:var(--t-teal);color:var(--t-teal-ink)}
.gl-tag{color:var(--t-ink2);font-weight:700}
.gl-tag.ref{color:var(--t-amber-ink)}
.chip{border-radius:999px;letter-spacing:.02em}
/* 누적 표 */
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
/* 누적 표 접힘 토글 — 헤더가 그대로 summary 가 된다(요구 ⑤) */
.arch-fold{border-radius:22px}
.arch-fold>summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px}
.arch-fold>summary::-webkit-details-marker{display:none}
.arch-fold>summary::after{content:'▾';color:var(--t-ink3);font-size:12px;transition:transform .15s ease}
.arch-fold[open]>summary::after{transform:rotate(180deg)}
/* ★ 지난 묶음을 열면 그 안 카드 제목이 통째로 사라지던 것 (2026-08-17 PeterJ 지적).
   원본 CSS 의 details[open] .day-prev 규칙은 **자손 선택자**라,
   바깥 묶음(details.past-fold)이 열리면 **안쪽 닫힌 카드들의 미리보기까지** 숨겼다.
   "그래야 찾아 들어가지" — 날짜만 남으면 목록의 쓸모가 없다.
   ① 그 규칙을 되돌리고 ② **자기 카드가 열렸을 때만** 숨기도록 좁힌다.
   (자식 결합자 > 로 자기 summary 안의 것만 잡는다.) */
details[open] .day-prev{display:flex}
details.day[open] > summary .day-prev{display:none}
/* 지난 카드 묶음 접힘 (요구 ④) */
.past-fold{margin:10px 18px 0;background:rgba(255,255,255,.34);border:1px solid var(--t-edge);
  border-radius:20px;padding:2px 14px}
.past-fold>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;
  padding:11px 2px;font-size:13.5px;font-weight:700;color:var(--t-ink)}
.past-fold>summary::-webkit-details-marker{display:none}
.past-fold>summary::after{content:'▾';margin-left:auto;color:var(--t-ink3);font-size:12px;transition:transform .15s ease}
.past-fold[open]>summary::after{transform:rotate(180deg)}
.past-fold>summary .n{font-size:11px;font-weight:700;color:var(--t-ink3);
  background:rgba(255,255,255,.6);border:1px solid var(--t-edge);border-radius:999px;padding:2px 9px}
.tempty{margin:8px 18px 0;padding:18px;text-align:center;font-size:13px;color:var(--t-ink3);
  background:rgba(255,255,255,.28);border:1px dashed rgba(150,142,133,.5);border-radius:22px}
.ft{color:var(--t-ink3)}
.ft a{color:var(--t-ink2)}
</style>`;

/** 두 페이지가 공유하는 탭 바. 현재 페이지만 활성 — 한쪽이 하위 링크로 보이지 않게. */
export function pageNav(active, { papers = 0, guidelines = 0, others = 0, reviews = 0 } = {}) {
  const tab = (href, on, label, sub) =>
    `<a href="${href}"${on ? ' class="on" aria-current="page"' : ''}><span>${label}</span><span class="sub">${sub}</span></a>`;
  return `<nav class="pgnav">
  ${tab('index.html', active === 'papers', '📄 논문', `${papers}편`)}
  ${tab('guidelines.html', active === 'guides', '📋 가이드라인', `${guidelines}건`)}
  ${tab('reviews.html', active === 'reviews', '📰 리뷰 · 기타', `${reviews} · ${others}건`)}
</nav>
`;
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

/** 본문에서 카드 섹션을 종류별로 뽑는다. */
function classifySections(body) {
  const papers = [];
  const guidelines = [];
  const others = [];
  const reviews = [];
  for (const m of body.matchAll(SEC_RE)) {
    if (m[1] === 'SECTION') papers.push(m[0]);
    else if (m[1] === 'RSECTION') reviews.push(m[0]);
    // 참고자료 카드는 '🔖 참고자료' 칩을 단다(_buildGuidelineCard 의 isRef 분기).
    else if (m[0].includes('🔖 참고자료')) others.push(m[0]);
    else guidelines.push(m[0]);
  }
  return { papers, guidelines, others, reviews };
}

/**
 * 표 행을 종류별로 뽑는다.
 * 신규 행은 data-kind 를 달고 나오지만, **마이그레이션 전 구본 행에는 없다** —
 * 그때만 `data-guideline` + 참고자료 식별자 대조로 갈린다.
 */
function classifyRows(rowsHtml, refIds) {
  const paper = [];
  const guideline = [];
  const reference = [];
  const review = [];
  for (const m of rowsHtml.matchAll(ROW_RE)) {
    const row = m[0];
    const kind = row.match(ROW_KIND_RE)?.[1];
    if (kind === 'reference') reference.push(row);
    else if (kind === 'review') review.push(row);
    else if (kind === 'guideline') guideline.push(row);
    else if (kind === 'paper') paper.push(row);
    else if (!row.includes('data-guideline')) paper.push(row);
    else if (refIds?.has(m[1])) reference.push(row);
    else guideline.push(row);
  }
  return { paper, guideline, reference, review };
}

/**
 * `<tbody>` 안의 행 영역을 **전부** 이어붙여 돌려준다.
 * guidelines.html 은 표가 둘(가이드·기타)이라 첫 구간만 보면 기타 행이 통째로 샌다.
 */
function rowsRegion(html) {
  let out = '';
  let i = 0;
  for (;;) {
    const a = html.indexOf(ROWS_START, i);
    if (a < 0) break;
    const b = html.indexOf(ROWS_END, a);
    if (b < 0) break;
    out += html.slice(a + ROWS_START.length, b);
    i = b + ROWS_END.length;
  }
  return out;
}

/**
 * 종류 마커를 심는다(멱등).
 *
 * ★ 속성 순서 계약 — 어기면 데일리가 조용히 깨진다:
 *   ⓐ `data-pmid` 는 **`<tr ` 바로 다음 첫 속성**이어야 한다. publish() 의 행 dedup 과
 *     curation.js 의 삭제 패치가 전부 `<tr data-pmid="…"[^>]*>` 로 잡는다.
 *   ⓑ **논문 행에는 아무것도 붙이지 않는다.** 같은 날 재실행 시 그날 행을 갈아끼우는
 *     정규식이 `<tr data-pmid="[^"]*"><td class="c-date">…` — 속성이 하나라도 더 붙으면
 *     매치가 깨져 행이 중복 누적된다(가이드 행이 이 교체에서 보호되는 원리가 바로 그것).
 *     논문은 "data-guideline 이 없음"으로 판별되므로 마커가 필요 없다.
 */
function markRow(row, kind) {
  if (kind === 'paper') return row; // ⓑ — 논문 행은 바이트 그대로 둔다
  const marked = ROW_KIND_RE.test(row)
    ? row
    : row.replace(/(<tr data-pmid="[^"]*")/, `$1 data-kind="${kind}"`); // ⓐ — pmid 뒤에
  // 참고자료 행은 종전에 가이드라인과 같은 '📋' 를 달고 나갔다 — 아이콘도 바로잡는다.
  return kind === 'reference'
    ? marked.replace('<td class="c-jour">📋 ', '<td class="c-jour">🔖 ')
    : marked;
}

/** 참고자료 섹션의 접힌 헤더 라벨 교정(구본은 '📋 가이드라인' 하드코딩). */
function fixRefSection(block) {
  return block.replace(
    '<span class="gl-tag">📋 가이드라인</span>',
    '<span class="gl-tag ref">🔖 기타 자료</span>',
  );
}

/**
 * 누적 표. **접힘이 기본이다** (PeterJ 요구 ⑤ · 2026-08-16).
 *
 * ★ `<details>` 를 `.arch-table` **바깥**에 두지 않고 그 자리에 그대로 씌운다 —
 *   `splitPages` 가 `<div class="arch-table">` 로 표 시작점을 찾고 `endOfTableContainer`
 *   가 div 균형으로 끝점을 찾기 때문이다. 밖에 씌우면 그 계산이 어긋나 표가 통째로
 *   복제되거나 `</div>` 가 엇갈린다(리뷰 실측으로 이미 한 번 난 사고다).
 *   그래서 details 는 `.arch-table` **안쪽 맨 위**에 들어간다.
 */
function tableHtml(title, count, unit, rows) {
  return `  <div class="arch-table">
    <details class="arch-fold">
    <summary class="at-head"><span class="at-title">${title}</span><span class="at-count">${count}${unit}</span></summary>
    <div class="at-scroll"><table>
      <thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
      <tbody>${ROWS_START}${rows.join('')}${ROWS_END}</tbody>
    </table></div>
    </details>
  </div>
`;
}

const secHead = (icon, label, n, desc) => `<div class="tsec">
  <div class="t"><span>${icon} ${label}</span><span class="n">${n}건</span></div>
  <div class="d">${desc}</div>
</div>
`;

const emptyBox = (t) => `<div class="tempty">${t}</div>\n`;

/**
 * 오늘 것만 밖에 두고 **지난 것은 한 번 더 접는다** (PeterJ 지시 2026-08-17).
 *
 * 카드가 이미 각각 접혀 있어도 날마다 한 줄씩 쌓이면 목록이 길어져 스크롤이 불편하다.
 * 그래서 지난 것들을 묶어 한 겹 더 접는다. 오늘 카드는 `day-today` 로 판별한다 —
 * `splitPages` 는 날짜를 모르고, 그 클래스가 이미 "오늘" 의 유일한 표식이다.
 *
 * ★ 접기만 한다. 카드를 지우거나 순서를 바꾸지 않는다 — 다음 실행의 merge 가 이
 *   래퍼를 그대로 통과해야 하므로(정규식은 섹션 단위로 잡는다) 감싸는 것 이상은 안 한다.
 */
function foldPast(sections, label) {
  const today = sections.filter((b) => b.includes('day day-today'));
  const past = sections.filter((b) => !b.includes('day day-today'));
  const head = today.join('\n');
  if (!past.length) return head;
  return `${head}\n<details class="past-fold"><summary>지난 ${label} <span class="n">${past.length}건</span></summary>\n${past.join('\n')}\n</details>`;
}

/**
 * 지난 실행이 심은 탭을 걷어낸다.
 * ★ 통계 교체보다 **먼저** 불러야 한다. 2회차부터는 `.stats` 와 `.archive` 사이에
 *   이 <nav> 가 끼어 있어서, 그걸 안 걷고 통계 정규식을 돌리면 매치가 실패하고
 *   guidelines 페이지 통계가 index 것(분석일수·선정 논문)으로 되돌아간다.
 */
function stripNav(html) {
  return html.replace(/<nav class="pgnav">[\s\S]*?<\/nav>\s*/g, '');
}

/** 탭을 통계 바로 아래(.archive 직전)에 넣는다. */
function withNav(html, navHtml) {
  // 치환문에 사용자 데이터가 섞이므로 함수형 replacer — 문자열이면 $&·$` 가 해석된다.
  return stripNav(html).replace('<div class="archive">', () => `${navHtml}  <div class="archive">`);
}

/**
 * `<div class="arch-table">` 컨테이너가 닫히는 지점(바로 뒤 인덱스)을 균형 계산으로 찾는다.
 * ★ 종전엔 `ARCHIVE_STATUS` 마커를 경계로 썼고, 마커가 없으면
 *   `indexOf('</div>', iTable)` 로 폴백했다. 그 폴백은 표 **안쪽** div 를 잡아
 *   낡은 표 전체가 두 페이지에 통째로 복제되고 `</div>` 도 어긋났다(리뷰 실측).
 */
function endOfTableContainer(html, start) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)) !== null; ) {
    if (m[0] === '</div>') {
      depth -= 1;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth += 1;
    }
  }
  return -1;
}

/**
 * 모든 카드를 접는다 (PeterJ 요구 ③ · 2026-08-16 — **오늘 논문 포함**).
 *
 * ★ 새로 만드는 카드는 `_buildSection`/`_buildGuidelineSection` 이 이미 `open` 없이
 *   낸다. 그런데 **배포본에는 지난 실행이 남긴 `open` 이 그대로 있다** — 증분 패치라
 *   과거 카드는 다시 만들어지지 않기 때문이다. 그래서 여기서 한 번 걷는다.
 * ★ `day-today` / `day-past` 클래스는 건드리지 않는다. 접힘만 바꾸고 시각적 강조는 둔다.
 */
export function collapseAllCards(html) {
  return String(html).replace(/<details open class="day/g, '<details class="day');
}

/** 타워 톤을 </head> 직전에(원본 스타일 뒤에) 얹는다. 이미 있으면 그대로. */
export function ensureTowerTone(html) {
  if (!html) return html;
  // 같은 버전이 이미 있으면 그대로 둔다.
  if (html.includes(`id="tower-tone" data-v="${TOWER_TONE_VERSION}"`)) return html;
  // 구버전(버전 없는 최초 배포본 포함)은 **통째로 갈아끼운다.**
  const stripped = html.replace(/<style id="tower-tone"(?: data-v="\d+")?>[\s\S]*?<\/style>\s*/g, '');
  return stripped.replace('</head>', () => `${TOWER_TONE}\n</head>`);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 세 페이지를 단일 본문으로 합친다(기존 publish 로직이 볼 입력).
 *
 * 없는 페이지는 그냥 건너뛴다 — 그 자체가 **마이그레이션 경로**다.
 *   · guidelines 도 reviews 도 없으면 구 index.html 하나가 전부를 품고 있다.
 *   · reviews 만 없으면 guidelines.html 이 가이드+기타를 품고 있고, split 이 가른다.
 */
export function mergePages(indexHtml, guidelinesHtml, reviewsHtml) {
  if (!indexHtml) return indexHtml;

  // ★ 예고 블록은 **매 실행 재생성**된다. 병합 입력에서 통째로 걷어낸다 —
  //   안 걷으면 guidelines/reviews 쪽 블록이 index 본문에 섞여 들어와 한 페이지에
  //   같은 트랙 블록이 둘씩 남는다.
  const strip = (h) => String(h ?? '').replace(UP_RE, '').replace(UP_LEGACY_RE, '');

  let out = strip(indexHtml);
  const gBlocks = [];
  const gRows = [];

  for (const page of [guidelinesHtml, reviewsHtml]) {
    if (!page || !page.includes(A_START)) continue;
    const cleaned = strip(page);
    const { guidelines, others, reviews } = classifySections(cleaned);
    gBlocks.push(...guidelines, ...reviews, ...others);
    const r = classifyRows(rowsRegion(cleaned), null);
    gRows.push(...r.guideline, ...r.review, ...r.reference);
  }

  // 카드: .archive 영역 끝(누적 표 직전)에 붙인다. 그룹 내 상대 순서는 보존된다.
  if (gBlocks.length) {
    const iTable = out.indexOf(T_OPEN);
    if (iTable > 0) {
      const head = out.slice(0, iTable);
      const rest = out.slice(iTable);
      const mClose = head.match(/\s*<\/div>\s*$/);
      const close = mClose ? mClose[0] : '\n  </div>\n';
      const body = mClose ? head.slice(0, mClose.index) : head;
      out = `${body}\n${gBlocks.join('\n')}${close}${rest}`;
    }
  }
  // 행: index 표의 끝에 붙인다.
  if (gRows.length && out.includes(ROWS_END)) {
    // 함수형 replacer 필수 — 보관된 행 HTML 에 `$&`·`` $` `` 가 있으면 문자열
    // 치환은 그걸 특수 패턴으로 해석해 본문을 망가뜨린다(esc() 도 못 막는다).
    out = out.replace(ROWS_END, () => `${gRows.join('')}${ROWS_END}`);
  }
  return out;
}

/**
 * 병합 본문을 세 페이지로 가른다.
 * @param {string} html   병합 본문(= 기존 publish 로직을 통과한 index 형태 페이지)
 * @param {{refIds?:Set<string>, needsReview?:Array<object>}} opts
 * @returns {{index:string, guidelines:string, reviews:string, counts:object}}
 */
export function splitPages(html, { refIds = null } = {}) {
  if (!html || !html.includes(A_START) || !html.includes(T_OPEN)) {
    // 스캐폴드가 아니면 가르지 않는다(소프트) — 원본을 그대로 index 로 둔다.
    return { index: html, guidelines: null, reviews: null, counts: null };
  }
  // ★ 카드 접힘 정규화는 **가르기 전에** 한 번만 한다(요구 ③ — 오늘 논문 포함).
  const themed = collapseAllCards(ensureTowerTone(html));

  const iArch = themed.indexOf(A_START);
  const iTable = themed.indexOf(T_OPEN);
  const iTableEnd = endOfTableContainer(themed, iTable);
  if (iTableEnd < 0) return { index: html, guidelines: null, reviews: null, counts: null }; // 소프트
  // 탭은 여기서 한 번 걷어낸다 — 아래 통계 교체가 그 다음이어야 한다(위 stripNav 주석).
  let headRaw = stripNav(themed.slice(0, iArch + A_START.length));
  const sectionsRaw = themed.slice(iArch + A_START.length, iTable);
  const afterTable = themed.slice(iTableEnd);

  // ★ 예고 블록을 트랙별로 걷어내 보관한다. 각 페이지에 **자기 것만** 다시 넣는다
  //   (PeterJ 요구 ② — 각 페이지 맨 위에 그 트랙 예고와 그 버튼).
  const upByTrack = new Map();
  for (const m of headRaw.matchAll(UP_RE)) upByTrack.set(m[1], m[0]);
  headRaw = headRaw.replace(UP_RE, '').replace(UP_LEGACY_RE, '');

  /** 그 페이지가 맡은 예고 블록을 ARCHIVE_START 바로 앞(= 카드 위)에 넣는다. */
  const withUpcoming = (head, page) => {
    const block = upByTrack.get(PAGE_TRACK[page]);
    if (!block) return head;
    return head.replace(A_START, () => `${block}\n${A_START}`);
  };

  const mClose = sectionsRaw.match(/\s*<\/div>\s*$/);
  // ★ 닫는 태그 주변 공백은 **정규화한다.** 원본을 그대로 물려주면 그 뒤에 오는
  //   `tableHtml()` 이 자기 들여쓰기를 또 붙여, **왕복마다 공백이 2칸씩 쌓인다.**
  //   매일 도는 경로라 파일이 무한히 자라고, 바이트로 무손실을 재는 검사가 늘 "늘었다" 로
  //   흔들린다(2026-08-16 실측: 렌더를 돌릴 때마다 정확히 +4바이트).
  const archiveClose = '\n  </div>\n';
  const sectionsBody = mClose ? sectionsRaw.slice(0, mClose.index) : sectionsRaw;

  const sec = classifySections(sectionsBody);
  const rows = classifyRows(rowsRegion(themed), refIds);

  const counts = {
    papers: sec.papers.length,
    guidelines: sec.guidelines.length,
    others: sec.others.length,
    reviews: sec.reviews.length,
    paperRows: rows.paper.length,
    guidelineRows: rows.guideline.length,
    referenceRows: rows.reference.length,
    reviewRows: rows.review.length,
  };

  // ── ① index.html (논문) ──
  const indexOut =
    withUpcoming(withNav(headRaw, pageNav('papers', counts)), 'papers') +
    foldPast(sec.papers, '논문') +
    archiveClose +
    tableHtml('📚 논문 누적', rows.paper.length, '편', rows.paper.map((r) => markRow(r, 'paper'))) +
    afterTable;

  // 히어로·탭·스타일·위젯을 그대로 재사용하는 것이 '대등한 병렬 페이지' 의 실체다.
  // 통계 3칸만 자기 것으로 바꾼다. (stat-*-count 클래스는 index 전용이므로 떼어낸다 —
  // publish() 의 통계 갱신 정규식이 다른 페이지를 건드리지 않게.)
  const statsBlock = (a, b) => `<div class="stats">
    <div class="sc"><div class="n">${a[1]}</div><div class="l">${a[0]}</div></div>
    <div class="sc"><div class="n">${b[1]}</div><div class="l">${b[0]}</div></div>
    <div class="sc"><div class="n" style="font-size:13px;line-height:1.3;padding-top:4px"><span class="g-updated">${extractUpdated(themed)}</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <div class="archive">`;

  // ⚠ 통계 교체는 **탭 주입 전**에 해야 한다 — 주입 후엔 `.stats` 뒤가 <nav> 라
  //   앵커(`<div class="archive">`)가 안 맞아 원본 카드가 남는다(미리보기에서 실측).
  const gStatsRe = /<div class="stats">[\s\S]*?<\/div>\s*<div class="archive">/;
  const headWith = (stats) => (gStatsRe.test(headRaw) ? headRaw.replace(gStatsRe, () => stats) : headRaw);

  const retitle = (head, title, fn) => head
    .replace('<title>EM/CCM Trend Review</title>', `<title>${title} — EM/CCM Trend Review</title>`)
    .replace(/<div class="fn">[\s\S]*?<\/div>\s*<\/header>/, `<div class="fn">${fn}</div>\n  </header>`);

  // ── ② guidelines.html (가이드라인) ──
  const gHead = withUpcoming(
    retitle(withNav(headWith(statsBlock(['가이드라인', counts.guidelines], ['누적 행', counts.guidelineRows])),
      pageNav('guides', counts)), '가이드라인', '공식 발행기관의 진료지침 캐치업'),
    'guides',
  );

  const guidelinesOut =
    gHead +
    secHead('📋', '가이드라인', counts.guidelines, '공식 발행기관의 진료지침 — 캐치업 큐에서 순차 소개') +
    (sec.guidelines.length ? foldPast(sec.guidelines, '가이드라인') : emptyBox('아직 소개된 가이드라인이 없습니다.')) +
    archiveClose +
    tableHtml('📋 가이드라인 누적', rows.guideline.length, '건', rows.guideline.map((r) => markRow(r, 'guideline'))) +
    stripArchiveStatus(afterTable);

  // ── ③ reviews.html (리뷰 · 기타) ──
  const rHead = withUpcoming(
    retitle(withNav(headWith(statsBlock(['리뷰', counts.reviews], ['기타 자료', counts.others])),
      pageNav('reviews', counts)), '리뷰 및 기타', '주요 저널 리뷰 아티클 · 직접 지정 참고자료'),
    'reviews',
  );

  const reviewsOut =
    rHead +
    secHead('📰', '리뷰', counts.reviews, '주요 저널의 리뷰 아티클 — 저수지에서 순차 소개') +
    (sec.reviews.length ? foldPast(sec.reviews, '리뷰') : emptyBox('아직 소개된 리뷰가 없습니다.')) +
    secHead('🔖', '기타 자료', counts.others, '직접 지정한 참고자료 — 공인 문서가 아닐 수 있습니다(카드의 “출처 성격” 참고)') +
    (sec.others.length ? foldPast(sec.others.map(fixRefSection), '기타 자료') : emptyBox('아직 등록된 기타 자료가 없습니다.')) +
    archiveClose +
    tableHtml('📰 리뷰 누적', rows.review.length, '건', rows.review.map((r) => markRow(r, 'review'))) +
    tableHtml('🔖 기타 자료 누적', rows.reference.length, '건', rows.reference.map((r) => markRow(r, 'reference'))) +
    stripArchiveStatus(afterTable);

  return { index: indexOut, guidelines: guidelinesOut, reviews: reviewsOut, counts };
}

/**
 * ★ '검토함' 블록은 **제거했다** (PeterJ 지시 2026-08-17).
 *
 * 무엇이었나 — 자동 발행 기준을 통과하지 못한 지침 후보(`status: needsReview`)를
 * 판정 이유(`insufficient-positive-evidence` 등)와 함께 나열하던 상자다. 분류기의
 * 진단 정보이지 PeterJ 가 읽고 무엇을 하는 화면이 아니었다.
 *
 * **데이터는 그대로 남는다** — `output/selected_guidelines.json` 의 큐에 계속 쌓이고,
 * 판정 기준을 손보면 그대로 되살아난다. 화면에서만 뺐다.
 */

/** 아카이브 저장 현황(§4-E)은 논문 아카이브 기준이라 index 에만 둔다. */
function stripArchiveStatus(tailHtml) {
  return tailHtml.replace(STATUS_BLOCK_RE, '');
}

function extractUpdated(html) {
  return html.match(/<span class="stat-updated-time">([^<]*)<\/span>/)?.[1] ?? '';
}
