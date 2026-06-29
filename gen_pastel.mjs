/**
 * gen_pastel.mjs — Aurora Light(A) 기반, 키컬러를 파스텔톤으로 낮춘 변형 시안.
 * 레이아웃/구성은 A와 동일, 팔레트만 교체.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANS = `'NanumSquare','NanumBarunGothic','NanumGothic',-apple-system,sans-serif`;

const D = {
  date:'2026-06-29', genAt:'07:00', window:'최근 6개월', windowDays:180,
  screened:300, selected:1, model:'Claude Opus',
  titleEn:'Cefazolin vs Antistaphylococcal Penicillin for MSSA Bacteremia',
  titleKo:'MSSA 균혈증 — 세파졸린 vs 항포도상구균 페니실린',
  trial:'SNAP Trial', journal:'N Engl J Med', pubDate:'2026', pmid:'42308484',
  score:9.5, evidence:'RCT',
  whyKo:'메티실린 감수성 황색포도상구균(MSSA) 균혈증에서 세파졸린이 표준 항포도상구균 페니실린 대비 90일 사망에 비열등하면서 신독성은 더 적은가?',
  pico:{ p:'MSSA 균혈증으로 입원한 성인 (다국가 RCT, N = 1,287)', i:'세파졸린(cefazolin) 정주 — 1일 3회',
    c:'항포도상구균 페니실린(플루클록사실린 등)', o:'90일 전원인 사망 — 보정 OR 0.81 (95% CrI 0.59–1.12), 비열등 확률 99.2%' },
  viz:{ primary:{title:'90일 전원인 사망',a:{l:'세파졸린',v:15.0,n:'97/645'},b:{l:'페니실린',v:17.0,n:'109/642'},tag:'비열등 99.2%'},
        aki:{title:'14일 내 급성신손상',a:{l:'세파졸린',v:13.9,n:'92/660'},b:{l:'페니실린',v:19.6,n:'127/648'},tag:'우월 99.7%'} },
  takeawayKo:'세파졸린은 MSSA 균혈증 90일 사망에서 비열등하며(99.2%), 급성신손상 위험이 유의하게 낮다(OR 0.67). 1일 3회 투여와 우수한 신장 안전성으로 1차 선택 약제로 권장된다.',
};
const footer = `AI Literature Pipeline · ${D.model} · PubMed ${D.window} · 1편/일`;
const I = {
  star:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="${c}" width="100%" height="100%"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z"/></svg>`,
  pulse:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>`,
  users:(c)=>'',
  scale:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M12 3v18M5 7h14M5 7l-3 6h6zM19 7l-3 6h6zM8 21h8"/></svg>`,
  target:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" width="100%" height="100%"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="${c}"/></svg>`,
  book:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5"/></svg>`,
  bulb:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10c1 1 1.5 1.5 1.5 3h5c0-1.5.5-2 1.5-3a6 6 0 00-4-10z"/></svg>`,
  filter:(c='currentColor')=>`<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>`,
};
function bars({title,a,b,tag}, accent, muted, opt={}) {
  const max=Math.max(a.v,b.v)*1.18, w=(v)=>`${(v/max*100).toFixed(1)}%`;
  const labelCol=opt.labelCol||'#7c8aa5', valCol=opt.valCol||'#334155', trackBg=opt.trackBg||'rgba(148,163,184,.16)';
  const tagCol=opt.tagCol||accent, tagBg=opt.tagBg||`${accent}22`;
  const row=(x,col)=>`<div style="display:flex;align-items:center;gap:8px;margin:5px 0">
    <span style="width:52px;flex:none;font-size:11px;color:${labelCol};text-align:right">${x.l}</span>
    <div style="flex:1;height:18px;background:${trackBg};border-radius:6px;overflow:hidden;position:relative">
      <div style="height:100%;width:${w(x.v)};background:${col};border-radius:6px"></div>
      <span style="position:absolute;left:8px;top:0;line-height:18px;font-size:10.5px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.18)">${x.v}%</span>
    </div>
    <span style="width:50px;flex:none;font-size:10px;color:${labelCol};font-variant-numeric:tabular-nums">${x.n}</span></div>`;
  return `<div style="margin-top:8px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
    <span style="font-size:11.5px;font-weight:800;color:${valCol}">${title}</span>
    <span style="margin-left:auto;font-size:10px;font-weight:800;color:${tagCol};background:${tagBg};padding:3px 8px;border-radius:99px">${tag}</span>
    </div>${row(a,accent)}${row(b,muted)}</div>`;
}

// 팔레트 정의 — 파스텔 키컬러
const palettes = [
  { id:'1', name:'Lavender 라벤더', hd:'radial-gradient(120% 90% at 0% 0%,#b9a9f2 0%,#a08fe6 42%,#9182dd 72%),radial-gradient(80% 70% at 100% 0%,#e9defc88 0%,transparent 60%)',
    key:'#8b78d9', key2:'#a78bfa', soft:'#efeafc', softTxt:'#6d5cc4', page:'#f5f2fc', ey:'#ece6fb', aki:'#5fb3a0', akiTag:'#3f9b86' },
  { id:'2', name:'Sky 스카이', hd:'radial-gradient(120% 90% at 0% 0%,#9ec7f5 0%,#7aa9ec 44%,#6f9be6 74%),radial-gradient(80% 70% at 100% 0%,#d9ecfd88 0%,transparent 60%)',
    key:'#5b8fd9', key2:'#7dabe8', soft:'#e9f2fd', softTxt:'#3f72bf', page:'#eef4fc', ey:'#e3effb', aki:'#5fb3a0', akiTag:'#3f9b86' },
  { id:'3', name:'Blush 블러시', hd:'radial-gradient(120% 90% at 0% 0%,#f2afc9 0%,#e592b4 44%,#dc83a8 74%),radial-gradient(80% 70% at 100% 0%,#fbdcec88 0%,transparent 60%)',
    key:'#d772a0', key2:'#ec9bc0', soft:'#fbeaf3', softTxt:'#c25b8a', page:'#fcf2f7', ey:'#fbe2ee', aki:'#7d9fd9', akiTag:'#5f84c9' },
  { id:'4', name:'Peach 피치', hd:'radial-gradient(120% 90% at 0% 0%,#f9bfa6 0%,#f3a085 44%,#ec9075 74%),radial-gradient(80% 70% at 100% 0%,#fde4d588 0%,transparent 60%)',
    key:'#e5825f', key2:'#f2a384', soft:'#fcece3', softTxt:'#cf6c49', page:'#fcf4ef', ey:'#fbe5da', aki:'#6fa9cf', akiTag:'#5089b3' },
];

function render(p){
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}html{-webkit-font-smoothing:antialiased}
body{font-family:${SANS};line-height:1.5;background:${p.page};color:#0f172a}
.ic{display:inline-block;vertical-align:middle}
.wrap{max-width:430px;margin:0 auto;min-height:100vh;padding-bottom:30px}
.hd{position:relative;padding:30px 22px 64px;overflow:hidden;color:#fff;background:${p.key};background-image:${p.hd}}
.hd .ey{font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:${p.ey};font-weight:800}
.hd h1{font-size:23px;font-weight:800;margin-top:5px;letter-spacing:-.6px}
.hd .fn{display:inline-flex;align-items:center;gap:7px;margin-top:12px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);padding:6px 12px;border-radius:99px;font-size:11px;font-weight:700;backdrop-filter:blur(6px)}
.fn .ic{width:13px;height:13px}
.stats{display:flex;gap:10px;margin:-44px 18px 0;position:relative;z-index:2}
.sc{flex:1;background:rgba(255,255,255,.9);backdrop-filter:blur(12px);border:1px solid #fff;border-radius:16px;padding:13px;text-align:center;box-shadow:0 12px 30px -8px ${p.key}40}
.sc .n{font-size:21px;font-weight:800;color:${p.key};font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.sc .l{font-size:9px;color:#64748b;margin-top:3px;letter-spacing:.5px;text-transform:uppercase}
.sec{padding:20px 18px 0}
.day{display:flex;align-items:center;gap:8px;margin-bottom:13px}
.pill{background:linear-gradient(90deg,${p.key},${p.key2});color:#fff;font-size:10px;font-weight:800;padding:4px 11px;border-radius:8px;box-shadow:0 4px 12px -2px ${p.key}66}
.date{font-weight:800;font-size:15px}
.gen{color:#94a3b8;font-size:11px;margin-left:auto}
.card{background:#fff;border-radius:20px;border:1px solid ${p.soft};box-shadow:0 20px 50px -22px ${p.key}55;overflow:hidden}
.ct{padding:20px 20px 16px;background:linear-gradient(180deg,${p.page},#fff)}
.medal{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -6px #f59e0baa}
.medal .ic{width:22px;height:22px;color:#fff}
.ttl{font-size:17px;font-weight:800;line-height:1.32;margin-top:12px;letter-spacing:-.3px}
.ttle{font-size:11.5px;color:#94a3b8;margin-top:5px}
.meta{display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;margin-top:9px}
.meta .ic{width:13px;height:13px;color:#94a3b8}
.tags{display:flex;gap:6px;margin-top:13px}
.tag{font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:8px}
.tag.sc{background:linear-gradient(90deg,${p.key},${p.key2});color:#fff}
.tag.ev{background:${p.soft};color:${p.softTxt}}
.tag.ap{background:#ecfdf5;color:#059669}
.bd{padding:18px 20px}
.lbl{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:${p.key};letter-spacing:.5px;margin:16px 0 7px}
.lbl:first-child{margin-top:0}.lbl .ic{width:15px;height:15px}
.txt{font-size:13px;color:#334155;line-height:1.65}
.pico{display:flex;flex-direction:column;gap:1px;background:${p.soft};border-radius:12px;overflow:hidden;margin-top:2px}
.pr{display:flex;gap:10px;background:#fff;padding:10px 12px}
.pk{width:22px;height:22px;border-radius:7px;background:${p.soft};color:${p.softTxt};flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px}
.pv{font-size:12.5px;color:#334155;line-height:1.45}
.viz{background:${p.page};border:1px solid ${p.soft};border-radius:14px;padding:14px}
.ft{text-align:center;font-size:10px;color:#94a3b8;padding:24px}
</style></head><body><div class="wrap">
  <div class="hd"><div class="ey">AI Literature Pipeline</div>
    <h1>EM/CCM Trend Review</h1>
    <div class="fn"><span class="ic">${I.filter('#fff')}</span>${D.windowDays}일 · ${D.screened}편 스크리닝 → ${D.selected}편 선정</div></div>
  <div class="stats">
    <div class="sc"><div class="n">${D.windowDays}</div><div class="l">일 윈도우</div></div>
    <div class="sc"><div class="n">${D.screened}</div><div class="l">스크리닝</div></div>
    <div class="sc"><div class="n">${D.selected}</div><div class="l">선정</div></div></div>
  <div class="sec">
    <div class="day"><span class="pill">TODAY</span><span class="date">${D.date}</span><span class="gen">생성 ${D.genAt}</span></div>
    <div class="card">
      <div class="ct"><div class="medal"><span class="ic">${I.star('#fff')}</span></div>
        <div class="ttl">${D.titleKo}</div>
        <div class="ttle">${D.titleEn} · ${D.trial}</div>
        <div class="meta"><span class="ic">${I.book()}</span>${D.journal} · ${D.pubDate} · PMID ${D.pmid}</div>
        <div class="tags"><span class="tag sc">${D.score}점</span><span class="tag ev">${D.evidence}</span><span class="tag ap">적용 가능</span></div></div>
      <div class="bd">
        <div class="lbl"><span class="ic">${I.bulb()}</span>WHY IT MATTERS</div><div class="txt">${D.whyKo}</div>
        <div class="lbl"><span class="ic">${I.target()}</span>PICO</div>
        <div class="pico">
          <div class="pr"><span class="pk">P</span><span class="pv">${D.pico.p}</span></div>
          <div class="pr"><span class="pk">I</span><span class="pv">${D.pico.i}</span></div>
          <div class="pr"><span class="pk">C</span><span class="pv">${D.pico.c}</span></div>
          <div class="pr"><span class="pk">O</span><span class="pv">${D.pico.o}</span></div></div>
        <div class="lbl"><span class="ic">${I.pulse()}</span>핵심 결과</div>
        <div class="viz">
          ${bars(D.viz.primary,p.key,'#cbd5e1',{tagCol:p.key,tagBg:p.soft})}
          <div style="height:10px"></div>
          ${bars(D.viz.aki,p.aki,'#cbd5e1',{tagCol:p.akiTag,tagBg:`${p.aki}1f`})}
        </div>
        <div class="lbl"><span class="ic">${I.bulb()}</span>임상 결론</div><div class="txt">${D.takeawayKo}</div>
      </div></div></div>
  <div class="ft">${footer}</div>
</div></body></html>`;
}

const outDir = path.join(__dirname,'designs','pastel');
await mkdir(outDir,{recursive:true});
for (const p of palettes){
  await writeFile(path.join(outDir,`pastel${p.id}.html`), render(p),'utf8');
  console.log(`✓ pastel${p.id}.html — ${p.name}`);
}
console.log('done');
