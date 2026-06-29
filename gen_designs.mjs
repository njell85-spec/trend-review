/**
 * gen_designs.mjs — 10가지 디자인 시안 생성기
 * 동일한 샘플 데이터(오늘의 선정 논문)로 10개 standalone HTML을 designs/ 에 출력.
 * 폰트 깨짐 방지를 위해 모든 CSS는 인라인, 폰트는 시스템 + Nanum 스택 사용.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KR = `'NanumSquare','NanumBarunGothic','NanumGothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif`;
const SERIF = `'Nanum Myeongjo','Noto Serif KR',Georgia,'Times New Roman',serif`;
const MONO = `'NanumGothicCoding','SFMono-Regular',Menlo,Consolas,monospace`;

// ── 공통 샘플 데이터 (오늘의 1편) ─────────────────────────────────────────────
const D = {
  date: '2026-06-29',
  genAt: '2026. 06. 29. 07:00',
  window: '최근 6개월',
  screened: 300,
  selected: 1,
  model: 'Claude Opus',
  paper: {
    rank: '🥇',
    titleEn: 'Cefazolin vs Antistaphylococcal Penicillin for MSSA Bacteremia',
    titleKo: 'MSSA 균혈증에서 세파졸린 vs 항포도상구균 페니실린',
    trial: 'SNAP Trial',
    journal: 'N Engl J Med',
    date: '2026',
    pmid: '42308484',
    score: 9.5,
    evidence: 'RCT',
    whyKo: '메티실린 감수성 황색포도상구균(MSSA) 균혈증에서 세파졸린이 표준 항포도상구균 페니실린 대비 90일 사망에 비열등한가, 그리고 신독성은 더 적은가?',
    pico: {
      p: '[호주·뉴질랜드 등 다국가] MSSA 균혈증으로 입원한 성인 (N=1,287, RCT)',
      i: '세파졸린(cefazolin) 정주',
      c: '항포도상구균 페니실린(플루클록사실린 등)',
      o: '90일 전원인 사망 15.0%(97/645) vs 17.0%(109/642) — 보정 OR 0.81 (95% CrI 0.59–1.12), 비열등 확률 99.2%',
      o2: '14일 내 급성신손상 13.9% vs 19.6% — 보정 OR 0.67 (95% CrI 0.50–0.89), 우월 확률 99.7%',
    },
    takeawayKo: '세파졸린은 MSSA 균혈증 90일 사망에서 항포도상구균 페니실린에 비열등하며(99.2%), 급성신손상 위험이 유의하게 낮다(OR 0.67). 1일 3회 투여와 우수한 신장 안전성으로 1차 선택 약제로 권장된다.',
  },
};

// ── 공통 푸터 텍스트 ──────────────────────────────────────────────────────────
const footerTxt = `AI Literature Pipeline · ${D.model} · PubMed ${D.window} · 1편/일`;

// 디자인별 메타
const designs = [
  { id:'01', name:'Clinical Mono',   desc:'정제된 그레이스케일 · 의학저널 감성',        render: clinicalMono },
  { id:'02', name:'Midnight Pro',    desc:'다크모드 · 시안 네온 · 글래스 카드',          render: midnightPro },
  { id:'03', name:'Journal Paper',   desc:'학술 논문 · 세리프 · 오프화이트',             render: journalPaper },
  { id:'04', name:'Teal Clinic',     desc:'소프트 틸/그린 · 둥근 카드 · 친근',           render: tealClinic },
  { id:'05', name:'Indigo SaaS',     desc:'인디고 그라데이션 · 모던 대시보드',            render: indigoSaas },
  { id:'06', name:'Terminal',        desc:'모노스페이스 · 터미널 · 데이터 밀집',          render: terminal },
  { id:'07', name:'Editorial',       desc:'매거진 · 빅 세리프 · 레드 악센트',            render: editorial },
  { id:'08', name:'Swiss Minimal',   desc:'스위스 · 흑백 · 여백 · 얇은 라인',            render: swissMinimal },
  { id:'09', name:'Soft Pastel',     desc:'파스텔 · 라운드 · 모바일 앱 카드',            render: softPastel },
  { id:'10', name:'Brief Timeline',  desc:'뉴스 브리핑 · 컴팩트 · 타임라인',             render: briefTimeline },
];

// ── HTML wrapper ──────────────────────────────────────────────────────────────
function page(css, body, font = KR) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:${font};-webkit-font-smoothing:antialiased}
${css}
</style></head><body>${body}</body></html>`;
}
const badge = (t) => t; // emoji passthrough

// ════════════════════════ 1. Clinical Mono ════════════════════════
function clinicalMono() {
  const p = D.paper;
  return page(`
  body{background:#f4f4f5;color:#18181b}
  .wrap{max-width:430px;margin:0 auto;background:#fff;min-height:100vh}
  .hd{background:#111827;color:#fff;padding:26px 22px 20px}
  .hd h1{font-size:21px;font-weight:800;letter-spacing:-.5px}
  .hd .sub{color:#9ca3af;font-size:11px;margin-top:4px}
  .stats{display:flex;gap:22px;margin-top:18px}
  .stat .n{font-size:24px;font-weight:800}
  .stat .l{font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px}
  .sec{padding:18px 22px}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .pill{background:#111827;color:#fff;font-size:10px;font-weight:700;padding:3px 9px;border-radius:99px}
  .date{font-weight:800;font-size:16px}
  .cnt{color:#9ca3af;font-size:12px;margin-left:auto}
  .card{border:1px solid #e4e4e7;border-radius:12px;overflow:hidden}
  .ctop{padding:16px}
  .medal{font-size:20px}
  .ttl{font-size:16px;font-weight:800;color:#111827;line-height:1.35;margin-top:6px}
  .meta{font-size:11px;color:#71717a;margin-top:5px}
  .tags{display:flex;gap:6px;margin-top:10px}
  .tag{font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;border:1px solid #d4d4d8;color:#3f3f46}
  .tag.dark{background:#111827;color:#fff;border-color:#111827}
  .body{border-top:1px solid #e4e4e7;background:#fafafa;padding:16px}
  .lbl{font-size:11px;font-weight:800;color:#52525b;letter-spacing:.5px;margin:12px 0 4px}
  .lbl:first-child{margin-top:0}
  .txt{font-size:13px;color:#27272a;line-height:1.6}
  .pico{display:grid;grid-template-columns:18px 1fr;gap:4px 8px;font-size:12.5px;line-height:1.5;margin-top:4px}
  .pico b{color:#111827}
  .ft{text-align:center;font-size:10px;color:#a1a1aa;padding:20px}`,
  `<div class="wrap">
    <div class="hd"><h1>EM/CCM Trend Review</h1>
      <div class="sub">Emergency &amp; Critical Care · ${D.window} ${D.screened}편 스크리닝 → ${D.selected}편 · ${D.model}</div>
      <div class="stats">
        <div class="stat"><div class="n">180</div><div class="l">Days Window</div></div>
        <div class="stat"><div class="n">${D.screened}</div><div class="l">Screened</div></div>
        <div class="stat"><div class="n">${D.selected}</div><div class="l">Selected</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="cnt">· 1편 · 생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="ctop">
          <div class="medal">${p.rank}</div>
          <div class="ttl">${p.titleEn} <span style="color:#9ca3af">(${p.trial})</span></div>
          <div class="meta">${p.titleKo}</div>
          <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
          <div class="tags"><span class="tag dark">${p.score}점</span><span class="tag">${p.evidence}</span><span class="tag">적용 가능</span></div>
        </div>
        <div class="body">
          <div class="lbl">WHY IT MATTERS</div><div class="txt">${p.whyKo}</div>
          <div class="lbl">PICO</div>
          <div class="pico"><b>P</b><span>${p.pico.p}</span><b>I</b><span>${p.pico.i}</span><b>C</b><span>${p.pico.c}</span><b>O</b><span><b>${p.pico.o}</b></span></div>
          <div class="lbl">CLINICAL BOTTOM LINE</div><div class="txt">${p.takeawayKo}</div>
        </div>
      </div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 2. Midnight Pro ════════════════════════
function midnightPro() {
  const p = D.paper;
  return page(`
  body{background:#0b0f1a;color:#e2e8f0}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding:0 0 30px}
  .hd{padding:30px 22px 22px;background:radial-gradient(120% 100% at 0% 0%,#0e2230 0%,#0b0f1a 60%)}
  .hd h1{font-size:22px;font-weight:800;color:#fff;letter-spacing:-.5px}
  .hd h1 span{color:#22d3ee}
  .sub{color:#64748b;font-size:11px;margin-top:5px}
  .stats{display:flex;gap:10px;margin-top:18px}
  .scard{flex:1;background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px}
  .scard .n{font-size:20px;font-weight:800;color:#22d3ee}
  .scard .l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .sec{padding:6px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin:14px 4px 12px}
  .pill{background:linear-gradient(90deg,#06b6d4,#3b82f6);color:#001016;font-size:10px;font-weight:800;padding:3px 10px;border-radius:99px}
  .date{font-weight:800;font-size:15px;color:#fff}
  .cnt{color:#475569;font-size:11px;margin-left:auto}
  .card{background:rgba(17,24,39,.7);backdrop-filter:blur(8px);border:1px solid #1f2937;border-radius:16px;padding:18px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .medal{font-size:22px}
  .ttl{font-size:16px;font-weight:800;color:#f1f5f9;line-height:1.35;margin-top:6px}
  .meta{font-size:11px;color:#64748b;margin-top:5px}
  .tags{display:flex;gap:6px;margin-top:12px}
  .tag{font-size:10px;font-weight:700;padding:4px 9px;border-radius:99px;background:#0f2733;color:#22d3ee;border:1px solid #164e5b}
  .tag.s{background:#1e1b4b;color:#a5b4fc;border-color:#3730a3}
  .lbl{font-size:10px;font-weight:800;color:#22d3ee;letter-spacing:1px;margin:16px 0 5px}
  .txt{font-size:13px;color:#cbd5e1;line-height:1.6}
  .pico{margin-top:4px}
  .prow{display:flex;gap:9px;font-size:12.5px;line-height:1.5;padding:5px 0;border-bottom:1px solid #1f2937}
  .pk{color:#22d3ee;font-weight:800;width:14px;flex:none}
  .pv{color:#cbd5e1}
  .ft{text-align:center;font-size:10px;color:#475569;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><h1>EM/CCM <span>Trend Review</span></h1>
      <div class="sub">응급의학·중환자의학 데일리 · ${D.window} ${D.screened}편 스크리닝 · ${D.model}</div>
      <div class="stats">
        <div class="scard"><div class="n">180일</div><div class="l">검색 윈도우</div></div>
        <div class="scard"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="scard"><div class="n">${D.selected}편</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="cnt">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="medal">${p.rank}</div>
        <div class="ttl">${p.titleKo}</div>
        <div class="meta">${p.titleEn} (${p.trial})</div>
        <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
        <div class="tags"><span class="tag">${p.score}점</span><span class="tag s">${p.evidence}</span><span class="tag s">적용 가능</span></div>
        <div class="lbl">WHY IT MATTERS</div><div class="txt">${p.whyKo}</div>
        <div class="lbl">PICO</div>
        <div class="pico">
          <div class="prow"><span class="pk">P</span><span class="pv">${p.pico.p}</span></div>
          <div class="prow"><span class="pk">I</span><span class="pv">${p.pico.i}</span></div>
          <div class="prow"><span class="pk">C</span><span class="pv">${p.pico.c}</span></div>
          <div class="prow"><span class="pk">O</span><span class="pv">${p.pico.o}</span></div>
        </div>
        <div class="lbl">CLINICAL BOTTOM LINE</div><div class="txt">${p.takeawayKo}</div>
      </div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 3. Journal Paper ════════════════════════
function journalPaper() {
  const p = D.paper;
  return page(`
  body{background:#e9e6df;color:#1c1917}
  .wrap{max-width:430px;margin:0 auto;background:#fbfaf7;min-height:100vh;border-left:1px solid #d6d3cd;border-right:1px solid #d6d3cd}
  .hd{padding:30px 26px 18px;border-bottom:3px double #1c1917;text-align:center}
  .hd .k{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#78716c}
  .hd h1{font-family:${SERIF};font-size:25px;font-weight:700;margin:6px 0;letter-spacing:-.3px}
  .hd .meta{font-size:11px;color:#57534e;font-style:italic}
  .strip{display:flex;justify-content:center;gap:16px;font-size:11px;color:#44403c;padding:10px 0;border-bottom:1px solid #d6d3cd}
  .strip b{font-family:${SERIF}}
  .sec{padding:22px 26px}
  .day{font-family:${SERIF};font-size:13px;color:#57534e;border-bottom:1px solid #d6d3cd;padding-bottom:8px;margin-bottom:16px;display:flex;justify-content:space-between}
  .medal{font-size:18px;float:left;margin-right:8px}
  .ttl{font-family:${SERIF};font-size:20px;font-weight:700;line-height:1.3}
  .ttlk{font-size:13px;color:#57534e;margin-top:6px;font-style:italic}
  .ref{font-size:11px;color:#78716c;margin-top:8px;font-family:${SERIF}}
  .rule{border:0;border-top:1px solid #d6d3cd;margin:16px 0}
  .h{font-family:${SERIF};font-size:13px;font-weight:700;font-variant:small-caps;letter-spacing:.5px;color:#1c1917;margin-bottom:5px}
  .txt{font-size:13.5px;line-height:1.7;color:#292524;text-align:justify}
  .pico p{font-size:12.5px;line-height:1.6;margin:3px 0}
  .pico b{font-family:${SERIF}}
  .drop{margin-top:6px}
  .ft{text-align:center;font-size:10px;color:#a8a29e;padding:22px;font-style:italic;border-top:1px solid #d6d3cd}`,
  `<div class="wrap">
    <div class="hd"><div class="k">Emergency &amp; Critical Care Medicine</div>
      <h1>The Trend Review</h1>
      <div class="meta">Daily Curated Literature · ${D.model}</div></div>
    <div class="strip"><span>윈도우 <b>180일</b></span><span>스크리닝 <b>${D.screened}편</b></span><span>선정 <b>${D.selected}편</b></span></div>
    <div class="sec">
      <div class="day"><span>${D.date} 발행</span><span>생성 ${D.genAt}</span></div>
      <div><span class="medal">${p.rank}</span><span class="ttl">${p.titleEn}</span></div>
      <div class="ttlk">${p.titleKo} — ${p.trial}</div>
      <div class="ref">${p.journal}, ${p.date} · PMID ${p.pmid} · 적용성 ${p.score}/10 · ${p.evidence}</div>
      <hr class="rule">
      <div class="h">Why It Matters</div><div class="txt">${p.whyKo}</div>
      <hr class="rule">
      <div class="h">PICO Framework</div>
      <div class="pico drop">
        <p><b>P —</b> ${p.pico.p}</p><p><b>I —</b> ${p.pico.i}</p>
        <p><b>C —</b> ${p.pico.c}</p><p><b>O —</b> ${p.pico.o}</p></div>
      <hr class="rule">
      <div class="h">Clinical Bottom Line</div><div class="txt">${p.takeawayKo}</div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 4. Teal Clinic ════════════════════════
function tealClinic() {
  const p = D.paper;
  return page(`
  body{background:#eefaf7;color:#0f2e2a}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
  .hd{background:linear-gradient(135deg,#0d9488,#14b8a6);color:#fff;padding:28px 22px 24px;border-radius:0 0 26px 26px}
  .hd h1{font-size:21px;font-weight:800}
  .sub{color:#cffafe;font-size:11px;margin-top:5px}
  .stats{display:flex;gap:10px;margin-top:18px}
  .scard{flex:1;background:rgba(255,255,255,.18);border-radius:14px;padding:12px;text-align:center}
  .scard .n{font-size:19px;font-weight:800}
  .scard .l{font-size:9px;color:#cffafe;margin-top:2px}
  .sec{padding:20px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:14px}
  .pill{background:#0d9488;color:#fff;font-size:10px;font-weight:700;padding:4px 11px;border-radius:99px}
  .date{font-weight:800;font-size:15px;color:#0f2e2a}
  .cnt{color:#5e9a92;font-size:11px;margin-left:auto}
  .card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 10px 30px rgba(13,148,136,.12)}
  .medal{font-size:22px}
  .ttl{font-size:16px;font-weight:800;color:#0f2e2a;line-height:1.35;margin-top:6px}
  .meta{font-size:11px;color:#5e9a92;margin-top:5px}
  .tags{display:flex;gap:6px;margin-top:12px}
  .tag{font-size:10px;font-weight:700;padding:5px 11px;border-radius:99px;background:#ccfbf1;color:#0f766e}
  .tag.s{background:#0d9488;color:#fff}
  .lbl{font-size:11px;font-weight:800;color:#0d9488;margin:16px 0 5px;display:flex;align-items:center;gap:6px}
  .lbl::before{content:'';width:6px;height:6px;border-radius:99px;background:#14b8a6}
  .txt{font-size:13px;color:#1f3d39;line-height:1.6}
  .pbox{background:#f0fdfa;border-radius:14px;padding:12px 14px;margin-top:4px}
  .prow{display:flex;gap:9px;font-size:12.5px;line-height:1.5;padding:4px 0}
  .pk{width:20px;height:20px;border-radius:99px;background:#14b8a6;color:#fff;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;flex:none}
  .ft{text-align:center;font-size:10px;color:#5e9a92;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><h1>EM/CCM Trend Review</h1>
      <div class="sub">응급·중환자 데일리 문헌 · ${D.window} ${D.screened}편 스크리닝 · ${D.model}</div>
      <div class="stats">
        <div class="scard"><div class="n">180일</div><div class="l">검색 윈도우</div></div>
        <div class="scard"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="scard"><div class="n">${D.selected}편</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="cnt">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="medal">${p.rank}</div>
        <div class="ttl">${p.titleKo}</div>
        <div class="meta">${p.titleEn} (${p.trial})</div>
        <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
        <div class="tags"><span class="tag s">${p.score}점</span><span class="tag">${p.evidence}</span><span class="tag">적용 가능</span></div>
        <div class="lbl">왜 중요한가</div><div class="txt">${p.whyKo}</div>
        <div class="lbl">PICO</div>
        <div class="pbox">
          <div class="prow"><span class="pk">P</span><span>${p.pico.p}</span></div>
          <div class="prow"><span class="pk">I</span><span>${p.pico.i}</span></div>
          <div class="prow"><span class="pk">C</span><span>${p.pico.c}</span></div>
          <div class="prow"><span class="pk">O</span><span>${p.pico.o}</span></div>
        </div>
        <div class="lbl">임상 결론</div><div class="txt">${p.takeawayKo}</div>
      </div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 5. Indigo SaaS ════════════════════════
function indigoSaas() {
  const p = D.paper;
  return page(`
  body{background:#f5f3ff;color:#1e1b4b}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
  .hd{background:linear-gradient(135deg,#4f46e5,#7c3aed 55%,#a21caf);color:#fff;padding:30px 22px 60px}
  .hd .k{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ddd6fe;font-weight:700}
  .hd h1{font-size:23px;font-weight:800;margin-top:4px;letter-spacing:-.5px}
  .sub{color:#ddd6fe;font-size:11px;margin-top:5px}
  .stats{display:flex;gap:10px;margin:-44px 18px 0}
  .scard{flex:1;background:#fff;border-radius:14px;padding:14px;box-shadow:0 10px 25px rgba(79,70,229,.18);text-align:center}
  .scard .n{font-size:20px;font-weight:800;background:linear-gradient(135deg,#4f46e5,#a21caf);-webkit-background-clip:text;background-clip:text;color:transparent}
  .scard .l{font-size:9px;color:#6b7280;margin-top:3px;text-transform:uppercase}
  .sec{padding:20px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:14px}
  .pill{background:linear-gradient(90deg,#4f46e5,#7c3aed);color:#fff;font-size:10px;font-weight:700;padding:4px 11px;border-radius:8px}
  .date{font-weight:800;font-size:15px}
  .cnt{color:#a5a3c4;font-size:11px;margin-left:auto}
  .card{background:#fff;border-radius:18px;padding:20px;box-shadow:0 4px 20px rgba(30,27,75,.08);border:1px solid #ece9fe}
  .medal{font-size:22px}
  .ttl{font-size:16px;font-weight:800;line-height:1.35;margin-top:6px}
  .meta{font-size:11px;color:#8b89ad;margin-top:5px}
  .tags{display:flex;gap:6px;margin-top:12px}
  .tag{font-size:10px;font-weight:700;padding:5px 10px;border-radius:8px;background:#ede9fe;color:#6d28d9}
  .tag.s{background:linear-gradient(90deg,#4f46e5,#7c3aed);color:#fff}
  .lbl{font-size:11px;font-weight:800;color:#7c3aed;margin:16px 0 5px}
  .txt{font-size:13px;color:#312e6b;line-height:1.6}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
  .pcell{background:#faf9ff;border:1px solid #ece9fe;border-radius:12px;padding:10px}
  .pcell .pk{font-size:10px;font-weight:800;color:#7c3aed}
  .pcell .pv{font-size:12px;color:#312e6b;line-height:1.45;margin-top:3px}
  .pcell.full{grid-column:1/-1}
  .ft{text-align:center;font-size:10px;color:#a5a3c4;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><div class="k">AI Literature Pipeline</div><h1>EM/CCM Trend Review</h1>
      <div class="sub">${D.window} ${D.screened}편 스크리닝 → ${D.selected}편 선정 · ${D.model}</div></div>
    <div class="stats">
      <div class="scard"><div class="n">180</div><div class="l">Days</div></div>
      <div class="scard"><div class="n">${D.screened}</div><div class="l">Screened</div></div>
      <div class="scard"><div class="n">${D.selected}</div><div class="l">Selected</div></div>
    </div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="cnt">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="medal">${p.rank}</div>
        <div class="ttl">${p.titleKo}</div>
        <div class="meta">${p.titleEn} (${p.trial})</div>
        <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
        <div class="tags"><span class="tag s">${p.score}점</span><span class="tag">${p.evidence}</span><span class="tag">적용 가능</span></div>
        <div class="lbl">WHY IT MATTERS</div><div class="txt">${p.whyKo}</div>
        <div class="lbl">PICO</div>
        <div class="grid">
          <div class="pcell"><div class="pk">P · 대상</div><div class="pv">${p.pico.p}</div></div>
          <div class="pcell"><div class="pk">I · 중재</div><div class="pv">${p.pico.i}</div></div>
          <div class="pcell"><div class="pk">C · 비교</div><div class="pv">${p.pico.c}</div></div>
          <div class="pcell"><div class="pk">O · 결과</div><div class="pv">${p.pico.o}</div></div>
          <div class="pcell full"><div class="pk">O · 2차</div><div class="pv">${p.pico.o2}</div></div>
        </div>
        <div class="lbl">CLINICAL BOTTOM LINE</div><div class="txt">${p.takeawayKo}</div>
      </div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 6. Terminal ════════════════════════
function terminal() {
  const p = D.paper;
  return page(`
  body{background:#0a0e0a;color:#7dd87d;font-family:${MONO}}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding:16px}
  .term{border:1px solid #1f3a1f;border-radius:8px;background:#0d130d;overflow:hidden}
  .bar{background:#132013;padding:8px 12px;display:flex;gap:6px;align-items:center;border-bottom:1px solid #1f3a1f}
  .dot{width:10px;height:10px;border-radius:99px}
  .bar .t{color:#4a7a4a;font-size:11px;margin-left:8px}
  .body{padding:14px;font-size:12.5px;line-height:1.7}
  .c{color:#4a7a4a}
  .g{color:#7dd87d}
  .y{color:#d8d87d}
  .w{color:#cfe8cf}
  .hl{color:#52e052;font-weight:700}
  .line{white-space:pre-wrap;word-break:break-word}
  .box{border:1px solid #1f3a1f;border-radius:6px;padding:10px;margin:10px 0;background:#0a100a}
  .k{color:#52e052;font-weight:700}
  .ft{text-align:center;font-size:10px;color:#3a5a3a;padding:18px}`,
  `<div class="wrap"><div class="term">
    <div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span class="t">trend-review — daily.sh</span></div>
    <div class="body">
      <div class="line"><span class="c">$</span> <span class="g">trend-review</span> <span class="y">--window</span> 180d <span class="y">--screen</span> ${D.screened} <span class="y">--select</span> ${D.selected} <span class="y">--model</span> opus</div>
      <div class="line"><span class="c"># </span><span class="w">scanning PubMed [${D.window}] ... ${D.screened} papers screened</span></div>
      <div class="line"><span class="c"># </span><span class="w">scoring with Claude Opus ... done</span></div>
      <div class="line"><span class="hl">✓ SELECTED 1/${D.screened}</span>  <span class="c">${D.date}  ${D.genAt}</span></div>
      <div class="box">
        <div class="line"><span class="k">[${p.rank} rank:1]</span> <span class="w">${p.titleKo}</span></div>
        <div class="line"><span class="c">en:</span> ${p.titleEn} (${p.trial})</div>
        <div class="line"><span class="c">src:</span> ${p.journal} ${p.date} | PMID ${p.pmid} | score=<span class="hl">${p.score}</span> | ${p.evidence}</div>
      </div>
      <div class="line"><span class="k">WHY&gt;</span> <span class="w">${p.whyKo}</span></div>
      <div class="box">
        <div class="line"><span class="k">P:</span> ${p.pico.p}</div>
        <div class="line"><span class="k">I:</span> ${p.pico.i}</div>
        <div class="line"><span class="k">C:</span> ${p.pico.c}</div>
        <div class="line"><span class="k">O:</span> <span class="hl">${p.pico.o}</span></div>
      </div>
      <div class="line"><span class="k">BOTTOM_LINE&gt;</span> <span class="w">${p.takeawayKo}</span></div>
      <div class="line"><span class="c">$</span> <span class="g">_</span></div>
    </div>
  </div><div class="ft">${footerTxt}</div></div>`, MONO);
}

// ════════════════════════ 7. Editorial ════════════════════════
function editorial() {
  const p = D.paper;
  return page(`
  body{background:#faf8f5;color:#1a1a1a}
  .wrap{max-width:430px;margin:0 auto;background:#faf8f5;min-height:100vh}
  .hd{padding:26px 24px 0}
  .kick{color:#dc2626;font-weight:800;font-size:11px;letter-spacing:2px;text-transform:uppercase}
  .hd h1{font-family:${SERIF};font-size:34px;font-weight:800;line-height:1.02;margin:6px 0 4px;letter-spacing:-1px}
  .sub{font-size:11px;color:#6b7280;border-bottom:2px solid #1a1a1a;padding-bottom:14px}
  .meta-row{display:flex;gap:14px;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;padding:10px 0;border-bottom:1px solid #e5e0d8;margin:0 24px}
  .meta-row b{color:#dc2626}
  .sec{padding:20px 24px}
  .medal{font-size:16px}
  .feat{font-family:${SERIF};font-size:25px;font-weight:800;line-height:1.18;letter-spacing:-.5px;margin:4px 0}
  .featk{font-size:13px;color:#4b5563;margin-top:8px;font-weight:600}
  .byline{font-size:11px;color:#9ca3af;margin-top:10px;padding-bottom:14px;border-bottom:1px solid #e5e0d8}
  .lede{font-family:${SERIF};font-size:15px;line-height:1.6;color:#1a1a1a;margin-top:14px}
  .lede::first-letter{font-size:46px;font-weight:800;float:left;line-height:.8;padding:4px 8px 0 0;color:#dc2626}
  .h{font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#dc2626;margin:18px 0 6px;border-top:2px solid #1a1a1a;padding-top:10px}
  .pico p{font-size:13px;line-height:1.6;margin:4px 0;color:#27272a}
  .pico b{color:#dc2626}
  .txt{font-size:13.5px;line-height:1.65;color:#27272a}
  .ft{text-align:center;font-size:10px;color:#9ca3af;padding:22px;border-top:2px solid #1a1a1a;margin:0 24px}`,
  `<div class="wrap">
    <div class="hd"><div class="kick">EM/CCM · 오늘의 단독 선정</div>
      <h1>Trend<br>Review</h1>
      <div class="sub">응급의학·중환자의학 데일리 리뷰 · ${D.model}</div></div>
    <div class="meta-row"><span>윈도우 <b>180일</b></span><span>스크리닝 <b>${D.screened}편</b></span><span>선정 <b>${D.selected}편</b></span><span style="margin-left:auto">${D.date}</span></div>
    <div class="sec">
      <div class="medal">${p.rank} 1위</div>
      <div class="feat">${p.titleEn}</div>
      <div class="featk">${p.titleKo} · ${p.trial}</div>
      <div class="byline">${p.journal}, ${p.date} · PMID ${p.pmid} · 적용성 ${p.score}/10 · ${p.evidence}</div>
      <div class="lede">${p.whyKo}</div>
      <div class="h">PICO 분석</div>
      <div class="pico"><p><b>대상 ·</b> ${p.pico.p}</p><p><b>중재 ·</b> ${p.pico.i}</p><p><b>비교 ·</b> ${p.pico.c}</p><p><b>결과 ·</b> ${p.pico.o}</p></div>
      <div class="h">임상 결론</div>
      <div class="txt">${p.takeawayKo}</div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 8. Swiss Minimal ════════════════════════
function swissMinimal() {
  const p = D.paper;
  return page(`
  body{background:#fff;color:#000;font-family:'Helvetica Neue',Arial,${KR}}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding:32px 24px}
  .top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:10px}
  .top h1{font-size:18px;font-weight:700;letter-spacing:-.3px}
  .top .d{font-size:11px;color:#888}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #000}
  .g3{padding:14px 0;border-right:1px solid #ddd}
  .g3:last-child{border-right:0}
  .g3 .n{font-size:26px;font-weight:700;letter-spacing:-1px}
  .g3 .l{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-top:2px}
  .num{font-size:11px;color:#888;margin:24px 0 4px;letter-spacing:1px}
  .medal{font-size:15px}
  .ttl{font-size:19px;font-weight:700;line-height:1.25;letter-spacing:-.4px;margin-top:4px}
  .ttlk{font-size:12.5px;color:#555;margin-top:8px}
  .meta{font-size:11px;color:#888;margin-top:10px;padding-bottom:6px}
  .ln{border:0;border-top:1px solid #000;margin:18px 0 0}
  .row{display:grid;grid-template-columns:80px 1fr;gap:10px;padding:12px 0;border-bottom:1px solid #e5e5e5;font-size:13px;line-height:1.5}
  .row .k{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  .ft{font-size:10px;color:#aaa;margin-top:30px;border-top:2px solid #000;padding-top:12px}`,
  `<div class="wrap">
    <div class="top"><h1>EM/CCM Trend Review</h1><span class="d">${D.date}</span></div>
    <div class="grid3">
      <div class="g3"><div class="n">180</div><div class="l">Days</div></div>
      <div class="g3"><div class="n">${D.screened}</div><div class="l">Screened</div></div>
      <div class="g3"><div class="n">${D.selected}</div><div class="l">Selected</div></div>
    </div>
    <div class="num">01 — TODAY · ${p.evidence} · ${p.score}/10</div>
    <div class="medal">${p.rank}</div>
    <div class="ttl">${p.titleEn}</div>
    <div class="ttlk">${p.titleKo} · ${p.trial}</div>
    <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
    <hr class="ln">
    <div class="row"><span class="k">Why</span><span>${p.whyKo}</span></div>
    <div class="row"><span class="k">P</span><span>${p.pico.p}</span></div>
    <div class="row"><span class="k">I</span><span>${p.pico.i}</span></div>
    <div class="row"><span class="k">C</span><span>${p.pico.c}</span></div>
    <div class="row"><span class="k">O</span><span>${p.pico.o}</span></div>
    <div class="row"><span class="k">Bottom line</span><span>${p.takeawayKo}</span></div>
    <div class="ft">${footerTxt}</div>
  </div>`, `'Helvetica Neue',Arial,${KR}`);
}

// ════════════════════════ 9. Soft Pastel ════════════════════════
function softPastel() {
  const p = D.paper;
  return page(`
  body{background:#fdf4ff;color:#3b0764;font-family:${KR}}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding:22px 16px 30px}
  .hd{background:#fff;border-radius:24px;padding:22px;box-shadow:0 8px 24px rgba(192,132,252,.15)}
  .hello{font-size:12px;color:#a855f7;font-weight:700}
  .hd h1{font-size:21px;font-weight:800;margin-top:2px;color:#581c87}
  .sub{font-size:11px;color:#9d7bb5;margin-top:6px}
  .stats{display:flex;gap:8px;margin-top:16px}
  .scard{flex:1;border-radius:16px;padding:12px;text-align:center}
  .scard.a{background:#ede9fe}.scard.b{background:#fae8ff}.scard.c{background:#fce7f3}
  .scard .n{font-size:18px;font-weight:800;color:#7e22ce}
  .scard .l{font-size:9px;color:#9d7bb5;margin-top:2px}
  .day{display:flex;align-items:center;gap:8px;margin:20px 6px 12px}
  .pill{background:#f0abfc;color:#581c87;font-size:10px;font-weight:800;padding:5px 12px;border-radius:99px}
  .date{font-weight:800;font-size:15px;color:#581c87}
  .cnt{color:#c4a8d6;font-size:11px;margin-left:auto}
  .card{background:#fff;border-radius:24px;padding:20px;box-shadow:0 8px 24px rgba(192,132,252,.15)}
  .medal{font-size:26px}
  .ttl{font-size:16px;font-weight:800;color:#581c87;line-height:1.4;margin-top:8px}
  .meta{font-size:11px;color:#a78bba;margin-top:6px}
  .tags{display:flex;gap:6px;margin-top:14px}
  .tag{font-size:10px;font-weight:800;padding:6px 12px;border-radius:99px;background:#f3e8ff;color:#7e22ce}
  .tag.s{background:#d946ef;color:#fff}
  .lbl{font-size:11px;font-weight:800;color:#a855f7;margin:18px 0 6px}
  .txt{font-size:13px;color:#4c1d6b;line-height:1.65}
  .pbox{background:#faf5ff;border-radius:18px;padding:14px;margin-top:4px}
  .prow{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.5;padding:6px 0}
  .pk{width:26px;height:26px;border-radius:99px;background:#e9d5ff;color:#7e22ce;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
  .ft{text-align:center;font-size:10px;color:#c4a8d6;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><div class="hello">오늘의 한 편 ✨</div><h1>EM/CCM Trend Review</h1>
      <div class="sub">${D.window} ${D.screened}편을 살펴보고 1편만 골랐어요 · ${D.model}</div>
      <div class="stats">
        <div class="scard a"><div class="n">180일</div><div class="l">윈도우</div></div>
        <div class="scard b"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="scard c"><div class="n">${D.selected}편</div><div class="l">선정</div></div>
      </div></div>
    <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="cnt">생성 ${D.genAt}</span></div>
    <div class="card">
      <div class="medal">${p.rank}</div>
      <div class="ttl">${p.titleKo}</div>
      <div class="meta">${p.titleEn} (${p.trial})</div>
      <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
      <div class="tags"><span class="tag s">${p.score}점</span><span class="tag">${p.evidence}</span><span class="tag">적용 가능</span></div>
      <div class="lbl">왜 중요할까요?</div><div class="txt">${p.whyKo}</div>
      <div class="lbl">PICO</div>
      <div class="pbox">
        <div class="prow"><span class="pk">P</span><span>${p.pico.p}</span></div>
        <div class="prow"><span class="pk">I</span><span>${p.pico.i}</span></div>
        <div class="prow"><span class="pk">C</span><span>${p.pico.c}</span></div>
        <div class="prow"><span class="pk">O</span><span>${p.pico.o}</span></div>
      </div>
      <div class="lbl">임상 결론</div><div class="txt">${p.takeawayKo}</div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ════════════════════════ 10. Brief Timeline ════════════════════════
function briefTimeline() {
  const p = D.paper;
  return page(`
  body{background:#fff;color:#111}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh}
  .hd{background:#111;color:#fff;padding:20px 20px 16px;position:sticky;top:0}
  .hd .row{display:flex;align-items:baseline;justify-content:space-between}
  .hd h1{font-size:17px;font-weight:800}
  .hd .d{font-size:11px;color:#9ca3af}
  .hd .sub{font-size:10px;color:#9ca3af;margin-top:6px;border-top:1px solid #333;padding-top:8px}
  .hd .sub b{color:#fbbf24}
  .tl{padding:8px 20px 30px;position:relative}
  .tl::before{content:'';position:absolute;left:28px;top:18px;bottom:30px;width:2px;background:#e5e7eb}
  .item{position:relative;padding:16px 0 16px 28px}
  .dot{position:absolute;left:-1px;top:20px;width:18px;height:18px;border-radius:99px;background:#111;border:3px solid #fff;box-shadow:0 0 0 2px #111;display:flex;align-items:center;justify-content:center;font-size:9px}
  .time{font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:.5px}
  .medal{font-size:14px}
  .ttl{font-size:16px;font-weight:800;line-height:1.3;margin-top:4px}
  .ttlk{font-size:12px;color:#6b7280;margin-top:4px}
  .meta{font-size:10.5px;color:#9ca3af;margin-top:6px}
  .tags{display:flex;gap:5px;margin-top:8px}
  .tag{font-size:9px;font-weight:800;padding:3px 7px;border-radius:5px;background:#111;color:#fff}
  .tag.o{background:#fff;color:#111;border:1px solid #d1d5db}
  .blk{background:#f9fafb;border-left:3px solid #111;border-radius:0 8px 8px 0;padding:10px 12px;margin-top:10px}
  .blk .h{font-size:9px;font-weight:800;letter-spacing:1px;color:#6b7280;text-transform:uppercase}
  .blk .t{font-size:12.5px;line-height:1.55;color:#27272a;margin-top:3px}
  .pico div{font-size:12px;line-height:1.5;margin:3px 0}
  .pico b{color:#111}
  .ft{text-align:center;font-size:10px;color:#9ca3af;padding:18px;border-top:1px solid #eee}`,
  `<div class="wrap">
    <div class="hd"><div class="row"><h1>EM/CCM Trend Review</h1><span class="d">${D.date}</span></div>
      <div class="sub">${D.window} <b>${D.screened}편</b> 스크리닝 → <b>${D.selected}편</b> 선정 · ${D.model}</div></div>
    <div class="tl">
      <div class="item">
        <div class="dot">${p.rank}</div>
        <div class="time">TODAY · ${D.genAt}</div>
        <div class="ttl">${p.titleKo}</div>
        <div class="ttlk">${p.titleEn} · ${p.trial}</div>
        <div class="meta">${p.journal} · ${p.date} · PMID ${p.pmid}</div>
        <div class="tags"><span class="tag">${p.score}점</span><span class="tag o">${p.evidence}</span><span class="tag o">적용 가능</span></div>
        <div class="blk"><div class="h">Why it matters</div><div class="t">${p.whyKo}</div></div>
        <div class="blk"><div class="h">PICO</div><div class="pico t">
          <div><b>P</b> · ${p.pico.p}</div><div><b>I</b> · ${p.pico.i}</div>
          <div><b>C</b> · ${p.pico.c}</div><div><b>O</b> · ${p.pico.o}</div></div></div>
        <div class="blk"><div class="h">Bottom line</div><div class="t">${p.takeawayKo}</div></div>
      </div>
    </div>
    <div class="ft">${footerTxt}</div>
  </div>`);
}

// ── 갤러리 인덱스 ─────────────────────────────────────────────────────────────
function gallery() {
  const cards = designs.map(d => `
    <a class="g" href="design${d.id}.html">
      <div class="t">${d.id}. ${d.name}</div>
      <div class="d">${d.desc}</div>
    </a>`).join('');
  return page(`
  body{background:#f4f4f5;color:#18181b;font-family:${KR}}
  .wrap{max-width:430px;margin:0 auto;padding:24px 18px}
  h1{font-size:20px;font-weight:800}
  p.s{font-size:12px;color:#71717a;margin:6px 0 18px}
  .g{display:block;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:14px 16px;margin-bottom:10px;text-decoration:none}
  .g .t{font-weight:800;color:#111827;font-size:14px}
  .g .d{font-size:11px;color:#71717a;margin-top:3px}`,
  `<div class="wrap"><h1>디자인 시안 10종</h1><p class="s">마음에 드는 번호를 알려주세요. 그 디자인으로 사이트 전체를 적용합니다.</p>${cards}</div>`);
}

// ── 실행 ──────────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, 'designs');
await mkdir(outDir, { recursive: true });
for (const d of designs) {
  await writeFile(path.join(outDir, `design${d.id}.html`), d.render(), 'utf8');
  console.log(`✓ design${d.id}.html — ${d.name}`);
}
await writeFile(path.join(outDir, 'index.html'), gallery(), 'utf8');
console.log('✓ designs/index.html (gallery)');
