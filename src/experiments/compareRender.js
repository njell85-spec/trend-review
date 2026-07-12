// 승인된 더미 레이아웃(2026-07-11)을 실데이터로 렌더. 자립형·인라인 CSS.

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const arr = (x) => (Array.isArray(x) ? x : []);
const list = (items) => `<ul class="kf">${items.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`;

// Phase 1 대시보드와 동일한 깊이로 렌더한다:
// WHY IT MATTERS → PICO(P/I/C/O) → 핵심결과·2차결과·📊통계용어 → 제한점 → 임상결론·Practice Change.
// Arm1(아카이브)·Arm2(_analyzeSinglePaper) 모두 같은 전체 분석 객체를 받도록 스크립트가 보장한다.
function armColumn(cls, label, sub, a) {
  if (!a) {
    return `<div class="col fail"><span class="arm ${cls}">${label} <small>${esc(sub)}</small></span>
      <div class="failmsg">⚠ 이 날 선정 실패 / 픽 없음<br>PMID 검증 실패·6개월 창 밖·분석 실패 → 소프트 스킵.</div></div>`;
  }
  // Arm1(아카이브 엔트리)은 title/journal/pmid/doi가 최상위, Arm2(_analyzeSinglePaper 출력)는
  // a.paper 하위에 있다 — 둘 다 커버하도록 폴백한다.
  const p = a.paper ?? {};
  const titleEn = a.title || p.title || '';
  const titleKo = a.title_ko || '';
  const journal = a.journal || p.journal || '';
  const pmid = a.pmid || p.pmid || '';
  const doiVal = a.doi || p.doi || '';
  const doi = doiVal && doiVal.length > 3 ? ` · <a href="https://doi.org/${esc(doiVal)}">DOI</a>` : '';

  const picoKo = a.pico_ko && Object.keys(a.pico_ko).length ? a.pico_ko : {};
  const picoEn = a.pico ?? {};
  const picoRows = ['population', 'intervention', 'comparison', 'outcome'].map((k, i) => {
    const v = picoKo[k] || picoEn[k];
    return v ? `<div class="row"><span class="k">${'PICO'[i]}</span><span>${esc(v)}</span></div>` : '';
  }).join('');

  const cq = a.clinicalQuestion_ko || a.clinicalQuestion || '';
  const kf = arr(a.keyFindings_ko).length ? arr(a.keyFindings_ko) : arr(a.keyFindings);
  const sec = arr(a.secondaryOutcomes_ko).length ? arr(a.secondaryOutcomes_ko) : arr(a.secondaryOutcomes);
  const gloss = arr(a.statGlossary);
  const limits = a.limitations_ko || a.limitations || '';
  const takeaway = a.clinicalTakeaway_ko || a.clinicalTakeaway || '';
  const practice = arr(a.practiceChange_ko).length ? arr(a.practiceChange_ko) : arr(a.practiceChange);
  const srcBadge = a.evidenceSource || a.badge || '';

  return `<div class="col">
    <span class="arm ${cls}">${label} <small>${esc(sub)}</small></span>
    <div class="ttl">${esc(titleKo || titleEn)}</div>
    ${titleKo ? `<div class="ttl-en">${esc(titleEn)}</div>` : ''}
    <div class="meta">${esc(journal)} · PMID ${esc(pmid)}${doi}</div>
    <div class="badges"><span class="b ev">근거 ${esc(a.evidenceLevel || 'NR')}</span>${srcBadge ? `<span class="b">${esc(srcBadge)}</span>` : ''}</div>
    ${cq ? `<div class="seclbl">💡 WHY IT MATTERS</div><p class="txt">${esc(cq)}</p>` : ''}
    ${picoRows ? `<div class="seclbl">🎯 PICO</div><div class="pico">${picoRows}</div>` : ''}
    ${kf.length ? `<div class="seclbl">📈 핵심 결과</div>${list(kf)}` : ''}
    ${sec.length ? `<div class="subh">2차 결과</div>${list(sec)}` : ''}
    ${gloss.length ? `<div class="subh">📊 통계 용어</div><div class="gloss">${gloss.map((g) => `<div class="gi"><b>${esc(g.term)}</b> — ${esc(g.explanation_ko || g.explanation || '')}</div>`).join('')}</div>` : ''}
    ${limits ? `<div class="subh">제한점</div><p class="txt">${esc(limits)}</p>` : ''}
    ${takeaway ? `<div class="seclbl">✅ 임상 결론</div><p class="txt">${esc(takeaway)}</p>` : ''}
    ${practice.length ? `<div class="subh">Practice Change</div>${list(practice)}` : ''}
  </div>`;
}

function dayCard(rec) {
  const conv = rec.converged ? `<span class="conv">🔗 Arm1·Arm2 수렴</span>` : '';
  return `<section class="day">
    <div class="dayhead"><span class="date">${esc(rec.date)}</span>${conv}</div>
    <div class="cols">
      ${armColumn('a1', 'ARM 1', '결정적+rerank', rec.arm1)}
      ${armColumn('a2', 'ARM 2', 'Opus 자체선정', rec.arm2)}
      ${rec.arm3 ? armColumn('a3', 'ARM 3', 'ChatGPT', rec.arm3)
        : `<div class="emptyslot">Arm 3 (ChatGPT)<br>2주 뒤 PeterJ 리스트 병합</div>`}
    </div>
  </section>`;
}

export function renderComparisonHtml(comparison, { startDate, endDate, today } = {}) {
  const records = [...(comparison?.records ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const conv = records.filter((r) => r.converged).length;
  const fail = records.filter((r) => r.arm1 && !r.arm2).length;
  const CSS = `*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#1a2230;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;line-height:1.5}
@media(prefers-color-scheme:dark){body{background:#0f141b;color:#e6ebf2}.col{background:#161d27!important;border-color:#26303d!important}}
.wrap{max-width:1100px;margin:0 auto;padding:16px 14px 40px}
.hero{background:linear-gradient(135deg,#1e3a8a,#5b21b6);color:#fff;border-radius:16px;padding:18px;margin-bottom:14px}
.hero h1{margin:0 0 4px;font-size:19px}.hero .sub{font-size:12.5px;opacity:.9}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.stat{background:rgba(255,255,255,.14);border-radius:10px;padding:7px 11px;font-size:12px}.stat b{font-size:15px;display:block}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px;font-size:11.5px;color:#5b6675}
.dayhead{display:flex;align-items:center;gap:9px;margin:0 2px 9px;font-weight:700;font-size:14px}
.conv{background:#fff7ed;color:#b45309;border:1px solid #b45309;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:20px}
.day{margin-bottom:20px}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}
@media(max-width:760px){.cols{grid-template-columns:1fr}}
.col{background:#fff;border:1px solid #e3e8ef;border-radius:13px;padding:13px;display:flex;flex-direction:column;gap:8px}
.arm{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px;width:fit-content}
.arm.a1{background:#eff4ff;color:#2563eb}.arm.a2{background:#f5f0ff;color:#7c3aed}.arm.a3{background:#effcf9;color:#0d9488}
.arm small{font-weight:600;opacity:.75}.ttl{font-weight:700;font-size:13.5px}.ttl-en{font-size:11.5px;color:#5b6675;font-style:italic}
.meta{font-size:11.5px;color:#5b6675}.meta a{color:#2563eb;text-decoration:none}
.badges{display:flex;flex-wrap:wrap;gap:5px}.b{font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:#eff4ff;color:#2563eb}
.pico{border-top:1px dashed #e3e8ef;padding-top:8px;display:flex;flex-direction:column;gap:5px}
.pico .row{display:grid;grid-template-columns:20px 1fr;gap:7px;font-size:11.5px}.pico .k{font-weight:800;color:#5b6675;font-size:10px}
.kf{margin:2px 0 0;padding-left:16px;font-size:11.5px}.kf li{margin-bottom:2px}.emptyslot{display:flex;align-items:center;justify-content:center;text-align:center;color:#5b6675;font-size:11.5px;border:1px dashed #e3e8ef;border-radius:13px;min-height:120px;padding:14px}
.failmsg{font-size:12px;color:#5b6675;padding:6px 0}
.seclbl{font-size:10px;font-weight:800;letter-spacing:.04em;color:#7c3aed;margin:9px 0 2px;text-transform:uppercase}
.subh{font-size:10.5px;font-weight:700;color:#6b7688;margin:7px 0 2px}
.txt{font-size:11.5px;margin:2px 0;color:inherit}
.gloss{display:flex;flex-direction:column;gap:3px}.gi{font-size:11px;color:inherit}
.col.fail .seclbl{color:#9ca3af}`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>트랙 비교 실험 · Trend Review</title><style>${CSS}</style></head>
<body><div class="wrap">
<header class="hero"><h1>논문 선정 트랙 비교 실험</h1>
<div class="sub">${esc(startDate)} → ${esc(endDate)} (KST) · 오늘 ${esc(today)}</div>
<div class="stats"><div class="stat"><b>${records.length}</b>기록된 날</div><div class="stat"><b>${conv}</b>수렴</div><div class="stat"><b>${fail}</b>Arm 2 실패</div></div></header>
<div class="legend"><span>■ Arm 1 · 결정적+rerank(현행)</span><span>■ Arm 2 · Opus 자체선정</span><span>■ Arm 3 · ChatGPT(2주 뒤)</span></div>
${records.map(dayCard).join('\n')}
<footer style="margin-top:22px;font-size:11px;color:#5b6675;text-align:center">실험용 비교 페이지 · njell85-spec.github.io/trend-review/experiments/compare.html</footer>
</div></body></html>`;
}
