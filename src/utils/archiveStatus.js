/**
 * archiveStatus — 대시보드 "아카이브 저장 현황" 섹션 (REPORT_SPEC §4-E).
 *
 * analysis_archive.json(entries + driveState)을 읽어, 논문 건별로 무엇이 어디까지
 * 저장됐는지(본문 출처 종류 · OA PDF 적재 · 전문 Doc 포함)를 한눈에 보여준다.
 *
 * 설계 원칙:
 * - **메타데이터만** 노출한다 — 본문/전문 텍스트는 절대 넣지 않는다(Drive 비공개 전용, §3).
 * - **나만 보기 게이트**: 큐레이션 PAT(localStorage 'tr_pat')가 있을 때만 표시.
 *   토큰이 없으면 섹션 자체가 렌더되지 않는다(기본 display:none + 스크립트 해제).
 *   ※ 공개 정적 페이지라 소스를 열면 보인다 — "굳이 숨길 정보 아님"(PeterJ) 전제의
 *     가벼운 개인 패널이지 기밀 게이트가 아니다.
 * - **삭제와 무관**: 대시보드 삭제(숨김)와 별개로 아카이브 전체를 비춘다 — 삭제한 논문도
 *   Drive·Doc엔 누적되므로 여기엔 "저장됨"으로 남는다.
 * - **소프트**: 데이터가 없거나 깨져도 호출측이 원본 html을 그대로 쓰도록 한다(데일리 코어 무영향).
 */

export const ARCHIVE_STATUS_VERSION = 'v1';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const monthOf = (d) => String(d ?? '').slice(0, 7);

/** 본문 출처 분류 — OA본문 / 웹레퍼런스(페이월) / 초록만. entry에서 파생 가능한 정보만 사용. */
function classify(e) {
  const src = e.fullTextSource ?? '';
  if (e.fullText) return { k: 'oa', label: `본문: ${src || '확보'}`, cls: 'as-oa' };
  if ((e.dossier?.length ?? 0) > 0) return { k: 'web', label: '본문: 웹레퍼런스(페이월)', cls: 'as-web' };
  return { k: 'abs', label: '본문: 초록만', cls: 'as-abs' };
}

/**
 * 건별 행 + 요약 카운트 계산. 최신 선정일 우선 정렬.
 * @returns {{ rows: string, counts: {total:number, oa:number, web:number, abs:number, pdf:number} }}
 */
export function buildArchiveStatusRows(archive) {
  const entries = Array.isArray(archive?.entries) ? archive.entries : [];
  const ds = archive?.driveState ?? {};
  const pdfFiles = ds.pdfFiles ?? {};
  const fulltextDone = ds.fulltextDone ?? {};

  const sorted = [...entries].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  const counts = { total: 0, oa: 0, web: 0, abs: 0, pdf: 0 };
  const yes = '<span class="as-b as-y">✓</span>';
  const no = '<span class="as-b as-n">–</span>';

  const rows = sorted.map((e) => {
    const pmid = e.pmid ?? '';
    const title = e.title_ko || e.title || '(제목 없음)';
    const sc = classify(e);
    const hasPdf = !!(pmid && pdfFiles[pmid]);
    const inDoc = !!(pmid && (fulltextDone[monthOf(e.date)] ?? []).includes(pmid));
    counts.total += 1;
    counts[sc.k] += 1;
    if (hasPdf) counts.pdf += 1;
    return `<div class="as-row">
      <div class="as-t">${esc(title)} <span class="as-pmid">PMID ${esc(pmid || '—')}</span></div>
      <div class="as-meta"><span class="as-date">${esc(e.date ?? '')}</span>`
      + `<span class="as-src ${sc.cls}">${esc(sc.label)}</span>`
      + `<span class="as-kv">PDF ${hasPdf ? yes : no}</span>`
      + `<span class="as-kv">전문Doc ${inDoc ? yes : no}</span>`
      + `</div>
    </div>`;
  }).join('');

  return { rows, counts };
}

/** "아카이브 저장 현황" 섹션 HTML(버전 마커 포함). 게이트·접힘 상태로 렌더. */
export function archiveStatusBlock(archive) {
  const { rows, counts } = buildArchiveStatusRows(archive);
  const listHtml = rows || '<div class="as-row"><div class="as-t" style="color:#94a3b8;font-weight:600">아직 아카이브된 항목이 없습니다.</div></div>';
  return `<!-- ARCHIVE_STATUS ${ARCHIVE_STATUS_VERSION} -->
<div class="as-wrap" id="as-wrap" style="display:none">
<style>
.as-wrap{margin:14px 18px 0}
.as-box{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 8px 22px -16px #64748b44}
.as-box>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:13px 16px;background:linear-gradient(90deg,#475569,#64748b);color:#fff}
.as-box>summary::-webkit-details-marker{display:none}
.as-title{font-size:13px;font-weight:800}
.as-lock{font-size:10px;font-weight:700;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);padding:2px 8px;border-radius:99px}
.as-cnt{margin-left:auto;font-size:11px;font-weight:700;opacity:.92}
.as-sum{padding:10px 16px;font-size:11px;color:#475569;background:#f8fafc;border-bottom:1px solid #eef2f7;display:flex;gap:10px;flex-wrap:wrap}
.as-sum b{color:#334155}
.as-list{padding:4px 12px 10px}
.as-row{padding:11px 4px;border-bottom:1px solid #f1f5f9}
.as-row:last-child{border-bottom:0}
.as-t{font-size:12.5px;font-weight:700;color:#1e293b;line-height:1.4}
.as-pmid{font-size:10px;font-weight:700;color:#94a3b8;white-space:nowrap}
.as-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}
.as-date{font-size:10.5px;color:#94a3b8;font-variant-numeric:tabular-nums}
.as-src{font-size:10px;font-weight:800;padding:3px 9px;border-radius:7px}
.as-oa{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}
.as-web{background:#fff7ed;color:#c2620c;border:1px solid #fed7aa}
.as-abs{background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0}
.as-kv{font-size:10px;font-weight:700;color:#64748b;display:inline-flex;align-items:center;gap:3px}
.as-b{font-weight:800}.as-y{color:#059669}.as-n{color:#cbd5e1}
.as-note{padding:8px 16px 12px;font-size:10px;color:#94a3b8;line-height:1.5}
</style>
<details class="as-box">
  <summary><span class="as-title">📦 아카이브 저장 현황</span><span class="as-lock">🔒 나만 보기</span><span class="as-cnt">${counts.total}건</span></summary>
  <div class="as-sum"><span>총 <b>${counts.total}건</b></span><span>OA본문 <b>${counts.oa}</b></span><span>웹레퍼런스 <b>${counts.web}</b></span><span>초록만 <b>${counts.abs}</b></span><span>PDF적재 <b>${counts.pdf}</b></span></div>
  <div class="as-list">${listHtml}</div>
  <div class="as-note">※ 삭제한 논문도 여기엔 "저장됨"으로 남습니다(Drive·Doc은 삭제와 무관 누적). 본문 텍스트는 표시하지 않고 저장 여부만 보여줍니다.</div>
</details>
</div>
<script>(function(){try{if(localStorage.getItem('tr_pat')){document.getElementById('as-wrap').style.display='block';}}catch(e){}})();</script>
<!-- /ARCHIVE_STATUS -->`;
}

/**
 * 배포 index.html에 섹션을 보장(멱등) — 누적 표 다음(푸터 앞)에 주입/교체.
 * 데이터가 매일 바뀌므로 마커가 이미 있어도 **항상 최신 블록으로 교체**한다
 * (on-demand 위젯은 정적이라 스킵하지만, 이 섹션은 갱신형).
 * 앵커(<div class="ft">)가 없고 기존 블록도 없으면 원본을 그대로 반환(소프트).
 */
export function ensureArchiveStatus(html, archive) {
  const block = archiveStatusBlock(archive);
  const re = /<!-- ARCHIVE_STATUS(?: v\d+)? -->[\s\S]*?<!-- \/ARCHIVE_STATUS -->/;
  if (re.test(html)) return html.replace(re, () => block);
  if (html.includes('<div class="ft">')) return html.replace('<div class="ft">', () => `${block}\n  <div class="ft">`);
  return html;
}
