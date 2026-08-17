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
 * - **삭제를 따라간다** (PeterJ 확정 2026-08-17: *"삭제하면 누적리스트 및 분석내용 모두 삭제"*).
 *   종전 설계는 그 반대였다 — 삭제한 논문도 여기엔 "저장됨"으로 남겼다. 그런데 PeterJ 가
 *   28건을 지운 뒤 이 목록에 그대로 있는 것을 보고 "반영이 안 됐다" 고 했다. 지운 것을
 *   계속 보여줄 이유가 없다.
 *   ★ **재선정 방지 목록은 별개 파일이라 그대로 둔다**(`output/selected_papers.json`).
 *     둘을 같은 것으로 착각하면 "지운 논문이 다시 뽑히는" 회귀를 만든다 — 실제로 종전
 *     안내 문구가 그 둘을 한 덩어리로 묶어 놨다.
 *   ★ Drive·Doc 은 이미 append 된 것을 여기서 되돌릴 수 없다(누적). 로컬 아카이브와
 *     화면에서만 지운다 — 그렇게 안내한다.
 * - **소프트**: 데이터가 없거나 깨져도 호출측이 원본 html을 그대로 쓰도록 한다(데일리 코어 무영향).
 */

export const ARCHIVE_STATUS_VERSION = 'v3';

/**
 * 대시보드에서 지운 항목을 아카이브에서도 뺀다 (PeterJ 확정 2026-08-17).
 *
 * ★ **숨김 목록 전체를 매번 훑는다** — "이번에 지운 것 하나" 만 빼지 않는다.
 *   그래야 ⓐ 멱등이고 ⓑ **이미 지나간 삭제도 다음 실행에서 소급 정리된다.**
 *   실측 시점에 숨김 31건 중 28건이 아카이브에 그대로 남아 있었다 — 한 건씩만
 *   처리하는 설계였다면 그 28건은 손으로 치우는 수밖에 없었다.
 * ★ pmid 가 빈 숨김 기록(`''`)은 **아무것도 지우지 않는다.** 빈 문자열을 그대로
 *   비교하면 pmid 없는 아카이브 항목이 통째로 날아간다.
 *
 * @returns {{archive: object, removed: string[]}} 새 객체(원본 불변)
 */
export function pruneArchiveByHidden(archive, hidden) {
  const entries = Array.isArray(archive?.entries) ? archive.entries : null;
  if (!entries) return { archive, removed: [] };
  const drop = new Set(
    Object.values(hidden ?? {})
      .map((v) => String(v?.pmid ?? '').trim())
      .filter((p) => /^\d+$/.test(p)),
  );
  if (!drop.size) return { archive, removed: [] };
  const kept = entries.filter((e) => !drop.has(String(e?.pmid ?? '').trim()));
  if (kept.length === entries.length) return { archive, removed: [] };
  const removed = entries
    .filter((e) => drop.has(String(e?.pmid ?? '').trim()))
    .map((e) => String(e.pmid));
  return { archive: { ...archive, entries: kept }, removed };
}

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

/**
 * "분석 보관 현황" 섹션 HTML(버전 마커 포함). 게이트·접힘 상태로 렌더.
 * ★ 이것은 **누적리스트가 아니다** — 누적리스트는 페이지 아래 표(읽음·삭제·자료화)이고,
 *   이 패널은 그 분석이 어디까지 보관됐는지(OA본문·웹·초록만·PDF적재)를 보여주는 내부용이다.
 *   종전 이름("아카이브 저장 현황")이 누적리스트와 헷갈려서 바꿨다(PeterJ 명칭 확정 2026-08-18).
 */
export function archiveStatusBlock(archive) {
  const { rows, counts } = buildArchiveStatusRows(archive);
  const listHtml = rows || '<div class="as-row"><div class="as-t" style="color:#94a3b8;font-weight:600">아직 보관된 분석이 없습니다.</div></div>';
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
  <summary><span class="as-title">📦 분석 보관 현황</span><span class="as-lock">🔒 나만 보기</span><span class="as-cnt">${counts.total}건</span></summary>
  <div class="as-sum"><span>총 <b>${counts.total}건</b></span><span>OA본문 <b>${counts.oa}</b></span><span>웹레퍼런스 <b>${counts.web}</b></span><span>초록만 <b>${counts.abs}</b></span><span>PDF적재 <b>${counts.pdf}</b></span></div>
  <div class="as-list">${listHtml}</div>
  <div class="as-note">※ 누적리스트에서 삭제한 논문은 이 목록에서도 빠집니다(재선정 방지 목록은 유지 — 지운 논문이 다시 뽑히지 않습니다). 이미 Drive·Doc에 올라간 것은 되돌리지 않습니다. 본문 텍스트는 표시하지 않고 저장 여부만 보여줍니다.</div>
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
