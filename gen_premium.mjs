/**
 * gen_premium.mjs — 프리미엄 디자인 시안 (가독성·완성도 강화판)
 * SVG 아이콘 + 결과 비교 막대 시각화 + 정제된 타입스케일/깊이감.
 * 폰트: 로컬 설치된 Nanum 계열(Square/Round/Myeongjo) — 스크린샷/배포 모두 안정 렌더.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SANS   = `'NanumSquare','NanumBarunGothic','NanumGothic',-apple-system,sans-serif`;
const ROUND  = `'NanumSquareRound','NanumSquare','NanumGothic',sans-serif`;
const SERIF  = `'NanumMyeongjo','Nanum Myeongjo',Georgia,serif`;
const MONO   = `'NanumGothicCoding',ui-monospace,monospace`;

// ── 데이터 (오늘의 1편) ───────────────────────────────────────────────────────
const D = {
  date: '2026-06-29', genAt: '07:00', window: '최근 6개월', windowDays: 180,
  screened: 300, selected: 1, model: 'Claude Opus',
  titleEn: 'Cefazolin vs Antistaphylococcal Penicillin for MSSA Bacteremia',
  titleKo: 'MSSA 균혈증 — 세파졸린 vs 항포도상구균 페니실린',
  trial: 'SNAP Trial', journal: 'N Engl J Med', pubDate: '2026', pmid: '42308484',
  score: 9.5, evidence: 'RCT',
  whyKo: '메티실린 감수성 황색포도상구균(MSSA) 균혈증에서 세파졸린이 표준 항포도상구균 페니실린 대비 90일 사망에 비열등하면서 신독성은 더 적은가?',
  pico: {
    p: 'MSSA 균혈증으로 입원한 성인 (다국가 RCT, N = 1,287)',
    i: '세파졸린(cefazolin) 정주 — 1일 3회',
    c: '항포도상구균 페니실린(플루클록사실린 등)',
    o: '90일 전원인 사망 — 보정 OR 0.81 (95% CrI 0.59–1.12), 비열등 확률 99.2%',
  },
  // 시각화용 수치 (낮을수록 좋음)
  viz: {
    primary: { title: '90일 전원인 사망', a:{l:'세파졸린',v:15.0,n:'97/645'}, b:{l:'페니실린',v:17.0,n:'109/642'}, tag:'비열등 99.2%' },
    aki:     { title: '14일 내 급성신손상', a:{l:'세파졸린',v:13.9,n:'92/660'}, b:{l:'페니실린',v:19.6,n:'127/648'}, tag:'우월 99.7%' },
  },
  takeawayKo: '세파졸린은 MSSA 균혈증 90일 사망에서 비열등하며(99.2%), 급성신손상 위험이 유의하게 낮다(OR 0.67). 1일 3회 투여와 우수한 신장 안전성으로 1차 선택 약제로 권장된다.',
};
const footer = `AI Literature Pipeline · ${D.model} · PubMed ${D.window} · 1편/일`;

// ── SVG 아이콘 ────────────────────────────────────────────────────────────────
const I = {
  star:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="${c}" width="100%" height="100%"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z"/></svg>`,
  pulse:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>`,
  flask:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/></svg>`,
  users:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0M16 6a3 3 0 010 6M21 20a6 6 0 00-4-5.6"/></svg>`,
  scale:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M12 3v18M5 7h14M5 7l-3 6h6zM19 7l-3 6h6zM8 21h8"/></svg>`,
  target:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" width="100%" height="100%"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="${c}"/></svg>`,
  book:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5"/></svg>`,
  bulb:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10c1 1 1.5 1.5 1.5 3h5c0-1.5.5-2 1.5-3a6 6 0 00-4-10z"/></svg>`,
  filter:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>`,
};

// ── 결과 비교 막대 (낮을수록 좋음, a가 우수) ──────────────────────────────────
// accent: 우수군 색, muted: 대조군 색
function bars({title,a,b,tag}, accent, muted, opt={}) {
  const max = Math.max(a.v,b.v)*1.18;
  const w=(v)=>`${(v/max*100).toFixed(1)}%`;
  const labelCol = opt.labelCol || '#64748b';
  const valCol = opt.valCol || '#0f172a';
  const trackBg = opt.trackBg || 'rgba(148,163,184,.18)';
  const tagCol = opt.tagCol || accent;
  const tagBg = opt.tagBg || `${accent}1f`;
  const row=(x,col,strong)=>`
    <div style="display:flex;align-items:center;gap:8px;margin:5px 0">
      <span style="width:52px;flex:none;font-size:11px;color:${labelCol};text-align:right">${x.l}</span>
      <div style="flex:1;height:18px;background:${trackBg};border-radius:6px;overflow:hidden;position:relative">
        <div style="height:100%;width:${w(x.v)};background:${col};border-radius:6px;transition:.3s"></div>
        <span style="position:absolute;left:8px;top:0;line-height:18px;font-size:10.5px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.25)">${x.v}%</span>
      </div>
      <span style="width:50px;flex:none;font-size:10px;color:${labelCol};font-variant-numeric:tabular-nums">${x.n}</span>
    </div>`;
  return `<div style="margin-top:8px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:11.5px;font-weight:800;color:${valCol}">${title}</span>
      <span style="margin-left:auto;font-size:10px;font-weight:800;color:${tagCol};background:${tagBg};padding:3px 8px;border-radius:99px">${tag}</span>
    </div>
    ${row(a,accent,true)}${row(b,muted,false)}
  </div>`;
}

function page(css, body, font=SANS) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{font-family:${font};line-height:1.5}
.ic{display:inline-block;vertical-align:middle}
${css}</style></head><body>${body}</body></html>`;
}

const designs = [
  { id:'A', name:'Aurora Light', desc:'프리미엄 라이트 · 오로라 그라데이션 · 글래스 · 결과 막대', render:aurora },
  { id:'B', name:'Onyx Gold',    desc:'럭셔리 다크 · 골드 악센트 · 명조 타이틀 · 글래스', render:onyx },
  { id:'C', name:'The Lancet',   desc:'학술 저널 · 명조 세리프 · 크림지 · 크림슨 · 드롭캡', render:lancet },
  { id:'D', name:'Clinical Mint',desc:'프레시 클리닉 · 에메랄드 · 라운드 · 초고가독성', render:mint },
  { id:'E', name:'Slate Pro',    desc:'정제 모노 슬레이트 · 일렉트릭 블루 · 데이터 중심', render:slate },
  { id:'F', name:'Vivid Gradient',desc:'볼드 모던 · 비비드 그라데이션 · 큰 타이포 · 펀치', render:vivid },
];

// 헤더 펀넬 칩 (공통 텍스트 컴포넌트)
const funnelTxt = `${D.windowDays}일 · ${D.screened}편 스크리닝 → ${D.selected}편 선정`;

// ════════════════ A. Aurora Light ════════════════
function aurora(){
  return page(`
  body{background:#eef1f8;color:#0f172a}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
  .hd{position:relative;padding:30px 22px 64px;overflow:hidden;color:#fff;
      background:#4338ca;background-image:radial-gradient(120% 90% at 0% 0%,#6366f1 0%,#4338ca 40%,#3730a3 70%),radial-gradient(80% 70% at 100% 0%,#a78bfa66 0%,transparent 60%)}
  .hd .ey{font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:#c7d2fe;font-weight:800}
  .hd h1{font-size:23px;font-weight:800;margin-top:5px;letter-spacing:-.6px}
  .hd .fn{display:inline-flex;align-items:center;gap:7px;margin-top:12px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);padding:6px 12px;border-radius:99px;font-size:11px;font-weight:700;backdrop-filter:blur(6px)}
  .fn .ic{width:13px;height:13px}
  .stats{display:flex;gap:10px;margin:-44px 18px 0;position:relative;z-index:2}
  .sc{flex:1;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border:1px solid #fff;border-radius:16px;padding:13px;text-align:center;box-shadow:0 12px 30px -8px rgba(67,56,202,.28)}
  .sc .n{font-size:21px;font-weight:800;color:#4338ca;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
  .sc .l{font-size:9px;color:#64748b;margin-top:3px;letter-spacing:.5px;text-transform:uppercase}
  .sec{padding:20px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:13px}
  .pill{background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;font-size:10px;font-weight:800;padding:4px 11px;border-radius:8px;box-shadow:0 4px 12px -2px #8b5cf688}
  .date{font-weight:800;font-size:15px}
  .gen{color:#94a3b8;font-size:11px;margin-left:auto}
  .card{background:#fff;border-radius:20px;border:1px solid #e9ecf5;box-shadow:0 20px 50px -20px rgba(30,27,75,.25);overflow:hidden}
  .ct{padding:20px 20px 16px;background:linear-gradient(180deg,#fafaff,#fff)}
  .medal{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -6px #f59e0baa}
  .medal .ic{width:22px;height:22px;color:#fff}
  .ttl{font-size:17px;font-weight:800;line-height:1.32;margin-top:12px;letter-spacing:-.3px}
  .ttle{font-size:11.5px;color:#94a3b8;margin-top:5px}
  .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-top:9px}
  .meta .ic{width:13px;height:13px;color:#94a3b8}
  .tags{display:flex;gap:6px;margin-top:13px}
  .tag{font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:8px}
  .tag.sc{background:linear-gradient(90deg,#4338ca,#6366f1);color:#fff}
  .tag.ev{background:#eef2ff;color:#4338ca}
  .tag.ap{background:#ecfdf5;color:#059669}
  .bd{padding:18px 20px}
  .lbl{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#6366f1;letter-spacing:.5px;margin:16px 0 7px}
  .lbl:first-child{margin-top:0}
  .lbl .ic{width:15px;height:15px}
  .txt{font-size:13px;color:#334155;line-height:1.65}
  .pico{display:flex;flex-direction:column;gap:1px;background:#eef1f8;border-radius:12px;overflow:hidden;margin-top:2px}
  .pr{display:flex;gap:10px;background:#fff;padding:10px 12px}
  .pk{width:22px;height:22px;border-radius:7px;background:#eef2ff;color:#4338ca;flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px}
  .pv{font-size:12.5px;color:#334155;line-height:1.45}
  .viz{background:#f8fafc;border:1px solid #eef1f8;border-radius:14px;padding:14px}
  .ft{text-align:center;font-size:10px;color:#94a3b8;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><div class="ey">AI Literature Pipeline</div>
      <h1>EM/CCM Trend Review</h1>
      <div class="fn"><span class="ic">${I.filter('#fff')}</span>${funnelTxt}</div></div>
    <div class="stats">
      <div class="sc"><div class="n">${D.windowDays}</div><div class="l">일 윈도우</div></div>
      <div class="sc"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
      <div class="sc"><div class="n">${D.selected}</div><div class="l">선정</div></div>
    </div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="ct">
          <div class="medal"><span class="ic">${I.star('#fff')}</span></div>
          <div class="ttl">${D.titleKo}</div>
          <div class="ttle">${D.titleEn} · ${D.trial}</div>
          <div class="meta"><span class="ic">${I.book()}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
          <div class="tags"><span class="tag sc">${D.score}점</span><span class="tag ev">${D.evidence}</span><span class="tag ap">적용 가능</span></div>
        </div>
        <div class="bd">
          <div class="lbl"><span class="ic">${I.bulb()}</span>WHY IT MATTERS</div>
          <div class="txt">${D.whyKo}</div>
          <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
          <div class="pico">
            <div class="pr"><span class="pk">P</span><span class="pv">${D.pico.p}</span></div>
            <div class="pr"><span class="pk">I</span><span class="pv">${D.pico.i}</span></div>
            <div class="pr"><span class="pk">C</span><span class="pv">${D.pico.c}</span></div>
            <div class="pr"><span class="pk">O</span><span class="pv">${D.pico.o}</span></div>
          </div>
          <div class="lbl"><span class="ic">${I.pulse()}</span>핵심 결과</div>
          <div class="viz">
            ${bars(D.viz.primary,'#4338ca','#cbd5e1')}
            <div style="height:10px"></div>
            ${bars(D.viz.aki,'#059669','#cbd5e1',{tagCol:'#059669',tagBg:'#05966918'})}
          </div>
          <div class="lbl"><span class="ic">${I.bulb()}</span>임상 결론</div>
          <div class="txt">${D.takeawayKo}</div>
        </div>
      </div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SANS);
}

// ════════════════ B. Onyx Gold ════════════════
function onyx(){
  return page(`
  body{background:#0c0d12;color:#e8e6e1}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
  .hd{padding:32px 22px 22px;background:radial-gradient(120% 80% at 100% 0%,#1c1a17 0%,#0c0d12 55%);border-bottom:1px solid #1f2027}
  .ey{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b89758;font-weight:800}
  h1{font-family:${SERIF};font-size:25px;font-weight:700;margin-top:8px;color:#f5f3ee;letter-spacing:-.3px}
  .fn{display:inline-flex;align-items:center;gap:7px;margin-top:13px;border:1px solid #34302a;background:#15140f;padding:6px 13px;border-radius:99px;font-size:11px;font-weight:700;color:#d8c9a8}
  .fn .ic{width:13px;height:13px;color:#b89758}
  .stats{display:flex;margin:18px 0 0;border:1px solid #26272f;border-radius:14px;overflow:hidden;background:#101117}
  .sc{flex:1;padding:13px;text-align:center;border-right:1px solid #20212a}
  .sc:last-child{border-right:0}
  .sc .n{font-size:20px;font-weight:800;color:#cbab6e;font-variant-numeric:tabular-nums}
  .sc .l{font-size:9px;color:#6b6d78;margin-top:3px;letter-spacing:.5px;text-transform:uppercase}
  .sec{padding:8px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin:16px 2px 13px}
  .pill{background:linear-gradient(90deg,#b89758,#d8b878);color:#1a1305;font-size:10px;font-weight:800;padding:4px 11px;border-radius:7px}
  .date{font-weight:800;font-size:15px;color:#f5f3ee}
  .gen{color:#555763;font-size:11px;margin-left:auto}
  .card{background:#101117;border:1px solid #22232c;border-radius:18px;overflow:hidden}
  .ct{padding:20px;border-bottom:1px solid #1c1d25;background:linear-gradient(180deg,#15161d,#101117)}
  .medal{width:42px;height:42px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#e8cd8e,#b89758);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px #b8975820}
  .medal .ic{width:22px;height:22px;color:#3a2c0c}
  .ttl{font-family:${SERIF};font-size:19px;font-weight:700;line-height:1.35;margin-top:13px;color:#f5f3ee}
  .ttle{font-size:11.5px;color:#7a7c87;margin-top:6px}
  .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#8a8c97;margin-top:10px}
  .meta .ic{width:13px;height:13px;color:#b89758}
  .tags{display:flex;gap:6px;margin-top:13px}
  .tag{font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:7px;border:1px solid #34302a}
  .tag.sc{background:#b89758;color:#1a1305;border-color:#b89758}
  .tag.ev{color:#d8c9a8}
  .tag.ap{color:#86b08a;border-color:#2c3a2e}
  .bd{padding:18px 20px}
  .lbl{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;color:#b89758;letter-spacing:1px;margin:17px 0 7px;text-transform:uppercase}
  .lbl:first-child{margin-top:0}
  .lbl .ic{width:14px;height:14px}
  .txt{font-size:13px;color:#bdbbb4;line-height:1.7}
  .pr{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #1c1d25}
  .pk{font-family:${SERIF};color:#cbab6e;font-weight:700;width:16px;flex:none;font-size:14px}
  .pv{font-size:12.5px;color:#bdbbb4;line-height:1.5}
  .viz{background:#0c0d12;border:1px solid #20212a;border-radius:13px;padding:14px;margin-top:3px}
  .ft{text-align:center;font-size:10px;color:#4a4c57;padding:26px}`,
  `<div class="wrap">
    <div class="hd"><div class="ey">EM · Critical Care · Daily</div>
      <h1>Trend Review</h1>
      <div class="fn"><span class="ic">${I.filter()}</span>${funnelTxt}</div>
      <div class="stats">
        <div class="sc"><div class="n">${D.windowDays}일</div><div class="l">윈도우</div></div>
        <div class="sc"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="sc"><div class="n">${D.selected}편</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="ct">
          <div class="medal"><span class="ic">${I.star()}</span></div>
          <div class="ttl">${D.titleKo}</div>
          <div class="ttle">${D.titleEn} · ${D.trial}</div>
          <div class="meta"><span class="ic">${I.book()}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
          <div class="tags"><span class="tag sc">${D.score}점</span><span class="tag ev">${D.evidence}</span><span class="tag ap">적용 가능</span></div>
        </div>
        <div class="bd">
          <div class="lbl"><span class="ic">${I.bulb()}</span>Why It Matters</div><div class="txt">${D.whyKo}</div>
          <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
          <div>
            <div class="pr"><span class="pk">P</span><span class="pv">${D.pico.p}</span></div>
            <div class="pr"><span class="pk">I</span><span class="pv">${D.pico.i}</span></div>
            <div class="pr"><span class="pk">C</span><span class="pv">${D.pico.c}</span></div>
            <div class="pr" style="border:0"><span class="pk">O</span><span class="pv">${D.pico.o}</span></div>
          </div>
          <div class="lbl"><span class="ic">${I.pulse()}</span>핵심 결과</div>
          <div class="viz">
            ${bars(D.viz.primary,'#cbab6e','#3a3b45',{labelCol:'#8a8c97',valCol:'#e8e6e1',trackBg:'#1c1d25',tagCol:'#cbab6e',tagBg:'#b8975820'})}
            <div style="height:10px"></div>
            ${bars(D.viz.aki,'#86b08a','#3a3b45',{labelCol:'#8a8c97',valCol:'#e8e6e1',trackBg:'#1c1d25',tagCol:'#86b08a',tagBg:'#2c3a2e'})}
          </div>
          <div class="lbl"><span class="ic">${I.bulb()}</span>Clinical Bottom Line</div><div class="txt">${D.takeawayKo}</div>
        </div>
      </div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SANS);
}

// ════════════════ C. The Lancet ════════════════
function lancet(){
  return page(`
  body{background:#ddd8cd;color:#211d18}
  .wrap{max-width:430px;margin:0 auto;background:#f7f3e9;min-height:100vh;box-shadow:0 0 40px rgba(0,0,0,.12)}
  .hd{padding:28px 26px 0;text-align:center}
  .rule-top{height:4px;background:#9b1c1c;margin:0 0 18px}
  .ey{font-size:10px;letter-spacing:3.5px;text-transform:uppercase;color:#9b1c1c;font-weight:800}
  h1{font-family:${SERIF};font-size:32px;font-weight:700;margin:6px 0;letter-spacing:-.5px}
  .tagline{font-family:${SERIF};font-size:12px;color:#6b6356;font-style:italic}
  .meta-strip{display:flex;justify-content:center;gap:18px;font-size:11px;color:#4a4338;padding:12px 0 14px;border-top:1px solid #cfc7b5;border-bottom:2px solid #211d18;margin:16px 26px 0}
  .meta-strip b{font-family:${SERIF};color:#9b1c1c}
  .sec{padding:22px 26px}
  .day{font-family:${SERIF};font-size:12.5px;color:#6b6356;display:flex;justify-content:space-between;border-bottom:1px solid #cfc7b5;padding-bottom:9px;margin-bottom:16px;font-style:italic}
  .rank{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#9b1c1c;font-style:normal;font-family:${SANS}}
  .rank .ic{width:14px;height:14px}
  .feat{font-family:${SERIF};font-size:23px;font-weight:700;line-height:1.25;letter-spacing:-.3px}
  .featk{font-size:12.5px;color:#4a4338;margin-top:8px;font-weight:600}
  .ref{font-size:10.5px;color:#857a68;margin-top:9px;font-family:${SERIF};font-style:italic;padding-bottom:14px;border-bottom:1px solid #cfc7b5}
  .h{font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#9b1c1c;margin:20px 0 7px;display:flex;align-items:center;gap:7px}
  .h .ic{width:14px;height:14px}
  .lede{font-family:${SERIF};font-size:14.5px;line-height:1.7;color:#211d18}
  .lede::first-letter{font-family:${SERIF};font-size:50px;font-weight:700;float:left;line-height:.82;padding:5px 9px 0 0;color:#9b1c1c}
  .pr{display:flex;gap:10px;font-size:12.5px;line-height:1.55;padding:6px 0;border-bottom:1px dotted #cfc7b5}
  .pk{font-family:${SERIF};font-weight:700;color:#9b1c1c;width:74px;flex:none;font-style:italic}
  .viz{background:#efe9da;border:1px solid #ddd5c2;border-radius:6px;padding:14px;margin-top:6px}
  .txt{font-family:${SERIF};font-size:13.5px;line-height:1.7;color:#2b2620}
  .ft{font-family:${SERIF};font-style:italic;text-align:center;font-size:10px;color:#9b9484;padding:22px;border-top:2px solid #211d18;margin:0 26px}`,
  `<div class="wrap">
    <div class="hd"><div class="rule-top"></div><div class="ey">Emergency &amp; Critical Care Medicine</div>
      <h1>The Trend Review</h1>
      <div class="tagline">A Daily Curation of the Literature · ${D.model}</div></div>
    <div class="meta-strip"><span>윈도우 <b>${D.windowDays}일</b></span><span>스크리닝 <b>${D.screened}편</b></span><span>선정 <b>${D.selected}편</b></span></div>
    <div class="sec">
      <div class="day"><span class="rank"><span class="ic">${I.star('#9b1c1c')}</span>오늘의 선정</span><span>${D.date}</span></div>
      <div class="feat">${D.titleEn}</div>
      <div class="featk">${D.titleKo} · ${D.trial}</div>
      <div class="ref">${D.journal}, ${D.pubDate} · PMID ${D.pmid} · 임상적용성 ${D.score}/10 · ${D.evidence}</div>
      <div class="h"><span class="ic">${I.bulb('#9b1c1c')}</span>Why It Matters</div>
      <div class="lede">${D.whyKo}</div>
      <div class="h"><span class="ic">${I.target('#9b1c1c')}</span>PICO Framework</div>
      <div>
        <div class="pr"><span class="pk">Patient</span><span>${D.pico.p}</span></div>
        <div class="pr"><span class="pk">Intervention</span><span>${D.pico.i}</span></div>
        <div class="pr"><span class="pk">Comparison</span><span>${D.pico.c}</span></div>
        <div class="pr" style="border:0"><span class="pk">Outcome</span><span>${D.pico.o}</span></div>
      </div>
      <div class="h"><span class="ic">${I.pulse('#9b1c1c')}</span>Results</div>
      <div class="viz">
        ${bars(D.viz.primary,'#9b1c1c','#bbb09a',{labelCol:'#6b6356',valCol:'#211d18',trackBg:'#ddd5c2',tagCol:'#9b1c1c',tagBg:'#9b1c1c14'})}
        <div style="height:10px"></div>
        ${bars(D.viz.aki,'#3f6b4a','#bbb09a',{labelCol:'#6b6356',valCol:'#211d18',trackBg:'#ddd5c2',tagCol:'#3f6b4a',tagBg:'#3f6b4a14'})}
      </div>
      <div class="h"><span class="ic">${I.scale('#9b1c1c')}</span>Clinical Bottom Line</div>
      <div class="txt">${D.takeawayKo}</div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SERIF);
}

// ════════════════ D. Clinical Mint ════════════════
function mint(){
  return page(`
  body{background:#eafaf3;color:#0d2b22}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
  .hd{background:linear-gradient(140deg,#059669,#10b981 60%,#34d399);color:#fff;padding:30px 22px 26px;border-radius:0 0 28px 28px;box-shadow:0 14px 34px -14px #05966988}
  .hd h1{font-size:22px;font-weight:800;letter-spacing:-.4px}
  .fn{display:inline-flex;align-items:center;gap:7px;margin-top:11px;background:rgba(255,255,255,.2);padding:6px 13px;border-radius:99px;font-size:11px;font-weight:700}
  .fn .ic{width:13px;height:13px}
  .stats{display:flex;gap:10px;margin-top:18px}
  .sc{flex:1;background:rgba(255,255,255,.16);border-radius:16px;padding:13px;text-align:center}
  .sc .n{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
  .sc .l{font-size:9.5px;color:#d1fae5;margin-top:3px}
  .sec{padding:22px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:14px}
  .pill{background:#059669;color:#fff;font-size:10px;font-weight:800;padding:5px 12px;border-radius:99px}
  .date{font-weight:800;font-size:15px;color:#0d2b22}
  .gen{color:#6aa394;font-size:11px;margin-left:auto}
  .card{background:#fff;border-radius:22px;padding:22px;box-shadow:0 16px 40px -18px rgba(5,150,105,.3)}
  .medal{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -6px #f59e0b99}
  .medal .ic{width:23px;height:23px;color:#fff}
  .ttl{font-size:18px;font-weight:800;line-height:1.34;margin-top:13px;color:#0d2b22;letter-spacing:-.3px}
  .ttle{font-size:11.5px;color:#7aa89b;margin-top:6px}
  .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#5e9082;margin-top:10px}
  .meta .ic{width:13px;height:13px;color:#10b981}
  .tags{display:flex;gap:6px;margin-top:14px}
  .tag{font-size:11px;font-weight:800;padding:6px 12px;border-radius:10px}
  .tag.sc{background:#059669;color:#fff}
  .tag.ev{background:#d1fae5;color:#047857}
  .tag.ap{background:#fef3c7;color:#b45309}
  .lbl{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#059669;margin:18px 0 8px}
  .lbl .ic{width:16px;height:16px}
  .txt{font-size:13.5px;color:#1f4a3d;line-height:1.7}
  .pico{background:#f0fdf8;border-radius:16px;padding:6px 14px;margin-top:2px}
  .pr{display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #dcf3ea}
  .pr:last-child{border:0}
  .pk{width:26px;height:26px;border-radius:9px;background:#059669;color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
  .pv{font-size:13px;color:#1f4a3d;line-height:1.5}
  .viz{background:#f0fdf8;border-radius:16px;padding:15px;margin-top:2px}
  .ft{text-align:center;font-size:10px;color:#6aa394;padding:24px}`,
  `<div class="wrap">
    <div class="hd"><h1>EM/CCM Trend Review</h1>
      <div class="fn"><span class="ic">${I.filter('#fff')}</span>${funnelTxt}</div>
      <div class="stats">
        <div class="sc"><div class="n">${D.windowDays}일</div><div class="l">윈도우</div></div>
        <div class="sc"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="sc"><div class="n">${D.selected}편</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="medal"><span class="ic">${I.star('#fff')}</span></div>
        <div class="ttl">${D.titleKo}</div>
        <div class="ttle">${D.titleEn} · ${D.trial}</div>
        <div class="meta"><span class="ic">${I.book()}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
        <div class="tags"><span class="tag sc">${D.score}점</span><span class="tag ev">${D.evidence}</span><span class="tag ap">적용 가능</span></div>
        <div class="lbl"><span class="ic">${I.bulb()}</span>왜 중요한가</div><div class="txt">${D.whyKo}</div>
        <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
        <div class="pico">
          <div class="pr"><span class="pk">P</span><span class="pv">${D.pico.p}</span></div>
          <div class="pr"><span class="pk">I</span><span class="pv">${D.pico.i}</span></div>
          <div class="pr"><span class="pk">C</span><span class="pv">${D.pico.c}</span></div>
          <div class="pr"><span class="pk">O</span><span class="pv">${D.pico.o}</span></div>
        </div>
        <div class="lbl"><span class="ic">${I.pulse()}</span>핵심 결과</div>
        <div class="viz">
          ${bars(D.viz.primary,'#059669','#a7d8c8',{labelCol:'#5e9082',trackBg:'#dcf3ea',tagCol:'#059669',tagBg:'#05966915'})}
          <div style="height:10px"></div>
          ${bars(D.viz.aki,'#0ea5e9','#a7d8c8',{labelCol:'#5e9082',trackBg:'#dcf3ea',tagCol:'#0ea5e9',tagBg:'#0ea5e915'})}
        </div>
        <div class="lbl"><span class="ic">${I.scale()}</span>임상 결론</div><div class="txt">${D.takeawayKo}</div>
      </div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SANS);
}

// ════════════════ E. Slate Pro ════════════════
function slate(){
  return page(`
  body{background:#f1f5f9;color:#0f172a}
  .wrap{max-width:430px;margin:0 auto;background:#fff;min-height:100vh}
  .hd{padding:30px 24px 22px;border-bottom:1px solid #e2e8f0}
  .top{display:flex;align-items:center;gap:9px}
  .logo{width:30px;height:30px;border-radius:9px;background:#0f172a;display:flex;align-items:center;justify-content:center}
  .logo .ic{width:17px;height:17px;color:#38bdf8}
  h1{font-size:18px;font-weight:800;letter-spacing:-.4px}
  .sub{font-size:11px;color:#64748b;margin-top:2px}
  .funnel{display:flex;align-items:stretch;margin-top:20px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
  .fcell{flex:1;padding:11px 12px;border-right:1px solid #e2e8f0}
  .fcell:last-child{border:0;background:#0f172a}
  .fcell .n{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
  .fcell:last-child .n{color:#38bdf8}
  .fcell .l{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .fcell:last-child .l{color:#cbd5e1}
  .sec{padding:22px 24px}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:14px}
  .pill{background:#0284c7;color:#fff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:6px}
  .date{font-weight:800;font-size:14px}
  .gen{margin-left:auto;font-size:11px;color:#94a3b8}
  .accent{height:3px;width:40px;background:#0284c7;border-radius:99px}
  .medal{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#b45309;margin-top:14px}
  .medal .ic{width:15px;height:15px;color:#f59e0b}
  .ttl{font-size:18px;font-weight:800;line-height:1.3;letter-spacing:-.4px;margin-top:6px}
  .ttle{font-size:11.5px;color:#94a3b8;margin-top:6px}
  .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-top:11px;padding-bottom:14px;border-bottom:1px solid #e2e8f0}
  .meta .ic{width:13px;height:13px;color:#94a3b8}
  .chips{display:flex;gap:6px;margin:12px 0 4px}
  .chip{font-size:10.5px;font-weight:800;padding:5px 10px;border-radius:6px;border:1px solid #e2e8f0;color:#475569}
  .chip.k{background:#0f172a;color:#fff;border-color:#0f172a}
  .lbl{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;color:#0284c7;letter-spacing:1px;text-transform:uppercase;margin:18px 0 7px}
  .lbl .ic{width:14px;height:14px}
  .txt{font-size:13px;color:#334155;line-height:1.65}
  .pr{display:grid;grid-template-columns:74px 1fr;gap:8px;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;line-height:1.5}
  .pk{font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#0284c7}
  .viz{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-top:3px}
  .ft{text-align:center;font-size:10px;color:#94a3b8;padding:22px;border-top:1px solid #e2e8f0}`,
  `<div class="wrap">
    <div class="hd">
      <div class="top"><div class="logo"><span class="ic">${I.pulse('#38bdf8')}</span></div>
        <div><h1>EM/CCM Trend Review</h1><div class="sub">${D.model} · Daily Literature Intelligence</div></div></div>
      <div class="funnel">
        <div class="fcell"><div class="n">${D.windowDays}</div><div class="l">일 윈도우</div></div>
        <div class="fcell"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="fcell"><div class="n">${D.selected}</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
      <div class="accent"></div>
      <div class="medal"><span class="ic">${I.star('#f59e0b')}</span>오늘의 1편</div>
      <div class="ttl">${D.titleKo}</div>
      <div class="ttle">${D.titleEn} · ${D.trial}</div>
      <div class="meta"><span class="ic">${I.book()}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
      <div class="chips"><span class="chip k">${D.score}점</span><span class="chip">${D.evidence}</span><span class="chip">적용 가능</span></div>
      <div class="lbl"><span class="ic">${I.bulb()}</span>Why It Matters</div><div class="txt">${D.whyKo}</div>
      <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
      <div>
        <div class="pr"><span class="pk">Patient</span><span>${D.pico.p}</span></div>
        <div class="pr"><span class="pk">Interv.</span><span>${D.pico.i}</span></div>
        <div class="pr"><span class="pk">Compar.</span><span>${D.pico.c}</span></div>
        <div class="pr" style="border:0"><span class="pk">Outcome</span><span>${D.pico.o}</span></div>
      </div>
      <div class="lbl"><span class="ic">${I.pulse()}</span>Results</div>
      <div class="viz">
        ${bars(D.viz.primary,'#0284c7','#cbd5e1',{tagCol:'#0284c7',tagBg:'#0284c714'})}
        <div style="height:10px"></div>
        ${bars(D.viz.aki,'#0d9488','#cbd5e1',{tagCol:'#0d9488',tagBg:'#0d948814'})}
      </div>
      <div class="lbl"><span class="ic">${I.scale()}</span>Clinical Bottom Line</div><div class="txt">${D.takeawayKo}</div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SANS);
}

// ════════════════ F. Vivid Gradient ════════════════
function vivid(){
  return page(`
  body{background:#0f0a1e;color:#f8fafc}
  .wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px;
    background:radial-gradient(90% 50% at 100% 0%,#7c2d9233 0,transparent 60%),radial-gradient(80% 40% at 0% 10%,#2563eb33 0,transparent 55%)}
  .hd{padding:32px 22px 20px}
  .ey{display:inline-block;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#0f0a1e;background:linear-gradient(90deg,#f0abfc,#a78bfa);padding:4px 10px;border-radius:6px}
  h1{font-size:30px;font-weight:800;line-height:1.05;margin-top:14px;letter-spacing:-1px;
     background:linear-gradient(90deg,#fff,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent}
  .fn{font-size:11.5px;color:#a5b4fc;margin-top:12px;font-weight:700}
  .stats{display:flex;gap:9px;margin-top:20px}
  .sc{flex:1;background:linear-gradient(160deg,rgba(124,58,237,.25),rgba(37,99,235,.12));border:1px solid #ffffff1f;border-radius:16px;padding:13px;text-align:center;backdrop-filter:blur(6px)}
  .sc .n{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;background:linear-gradient(90deg,#f0abfc,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}
  .sc .l{font-size:9px;color:#94a3b8;margin-top:3px;text-transform:uppercase;letter-spacing:.5px}
  .sec{padding:18px 18px 0}
  .day{display:flex;align-items:center;gap:8px;margin-bottom:13px}
  .pill{background:linear-gradient(90deg,#d946ef,#8b5cf6);color:#fff;font-size:10px;font-weight:800;padding:5px 12px;border-radius:99px;box-shadow:0 6px 18px -4px #d946ef88}
  .date{font-weight:800;font-size:15px}
  .gen{margin-left:auto;font-size:11px;color:#64748b}
  .card{background:linear-gradient(180deg,#1a1230,#150f26);border:1px solid #ffffff14;border-radius:22px;padding:22px;box-shadow:0 24px 60px -24px #7c2d9266}
  .medal{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#fde047,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px -2px #f59e0b88}
  .medal .ic{width:23px;height:23px;color:#3a2c0c}
  .ttl{font-size:19px;font-weight:800;line-height:1.32;margin-top:14px;letter-spacing:-.4px}
  .ttle{font-size:11.5px;color:#8b8ca8;margin-top:6px}
  .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#a5b4fc;margin-top:11px}
  .meta .ic{width:13px;height:13px}
  .tags{display:flex;gap:6px;margin-top:14px}
  .tag{font-size:10.5px;font-weight:800;padding:5px 12px;border-radius:99px}
  .tag.sc{background:linear-gradient(90deg,#d946ef,#8b5cf6);color:#fff}
  .tag.ev{background:#ffffff14;color:#c4b5fd;border:1px solid #ffffff22}
  .tag.ap{background:#10b98122;color:#6ee7b7;border:1px solid #10b98144}
  .lbl{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.5px;margin:18px 0 7px;
       background:linear-gradient(90deg,#f0abfc,#a5b4fc);-webkit-background-clip:text;background-clip:text;color:transparent}
  .lbl .ic{width:15px;height:15px;color:#c4b5fd}
  .txt{font-size:13px;color:#cbd5e1;line-height:1.66}
  .pr{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #ffffff10}
  .pk{width:24px;height:24px;border-radius:8px;background:#ffffff12;color:#c4b5fd;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;flex:none}
  .pv{font-size:12.5px;color:#cbd5e1;line-height:1.5}
  .viz{background:#0f0a1e80;border:1px solid #ffffff14;border-radius:14px;padding:14px;margin-top:3px}
  .ft{text-align:center;font-size:10px;color:#5b5470;padding:26px}`,
  `<div class="wrap">
    <div class="hd"><span class="ey">AI Literature Pipeline</span>
      <h1>EM/CCM<br>Trend Review</h1>
      <div class="fn">${funnelTxt} · ${D.model}</div>
      <div class="stats">
        <div class="sc"><div class="n">${D.windowDays}</div><div class="l">일 윈도우</div></div>
        <div class="sc"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
        <div class="sc"><div class="n">${D.selected}</div><div class="l">선정</div></div>
      </div></div>
    <div class="sec">
      <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
      <div class="card">
        <div class="medal"><span class="ic">${I.star()}</span></div>
        <div class="ttl">${D.titleKo}</div>
        <div class="ttle">${D.titleEn} · ${D.trial}</div>
        <div class="meta"><span class="ic">${I.book('#a5b4fc')}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
        <div class="tags"><span class="tag sc">${D.score}점</span><span class="tag ev">${D.evidence}</span><span class="tag ap">적용 가능</span></div>
        <div class="lbl"><span class="ic">${I.bulb()}</span>WHY IT MATTERS</div><div class="txt">${D.whyKo}</div>
        <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
        <div>
          <div class="pr"><span class="pk">P</span><span class="pv">${D.pico.p}</span></div>
          <div class="pr"><span class="pk">I</span><span class="pv">${D.pico.i}</span></div>
          <div class="pr"><span class="pk">C</span><span class="pv">${D.pico.c}</span></div>
          <div class="pr" style="border:0"><span class="pk">O</span><span class="pv">${D.pico.o}</span></div>
        </div>
        <div class="lbl"><span class="ic">${I.pulse()}</span>핵심 결과</div>
        <div class="viz">
          ${bars(D.viz.primary,'#a855f7','#3f3a52',{labelCol:'#8b8ca8',valCol:'#f8fafc',trackBg:'#ffffff12',tagCol:'#c4b5fd',tagBg:'#a855f72a'})}
          <div style="height:10px"></div>
          ${bars(D.viz.aki,'#22d3ee','#3f3a52',{labelCol:'#8b8ca8',valCol:'#f8fafc',trackBg:'#ffffff12',tagCol:'#67e8f9',tagBg:'#22d3ee2a'})}
        </div>
        <div class="lbl"><span class="ic">${I.scale()}</span>임상 결론</div><div class="txt">${D.takeawayKo}</div>
      </div>
    </div>
    <div class="ft">${footer}</div>
  </div>`,SANS);
}

// ── 실행 ──────────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname,'designs','premium');
await mkdir(outDir,{recursive:true});
for (const d of designs){
  await writeFile(path.join(outDir,`premium${d.id}.html`), d.render(),'utf8');
  console.log(`✓ premium${d.id}.html — ${d.name}`);
}
await writeFile(path.join(outDir,'_designs.json'), JSON.stringify(designs.map(({id,name,desc})=>({id,name,desc})),null,2));
console.log('done');
