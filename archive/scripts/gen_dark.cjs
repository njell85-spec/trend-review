const fs = require('fs');

// each theme supplies full Tailwind class strings so we keep precise control
const themes = [
  {
    file: 'design_dark2.html', title: '다크 2 · Amber Luxe', footer: 'Dark / Amber Luxe',
    bg: '#14110b', card: '#1c1810', cardBorder: 'border-amber-900/40', accent: 'text-amber-400',
    badge: 'bg-amber-400 text-[#14110b]', glow: '0 0 0 1px rgba(251,191,36,.18),0 0 26px -12px rgba(251,191,36,.45)',
    numA: 'bg-amber-400/10 text-amber-400 border border-amber-400/30', numI: 'bg-stone-700/30 text-stone-300 border border-stone-700',
    base: 'text-stone-300', muted: 'text-stone-500', divide: 'divide-stone-800/60', tableJ: 'text-amber-400/80', dot: 'text-amber-400',
  },
  {
    file: 'design_dark3.html', title: '다크 3 · Violet Pop', footer: 'Dark / Violet Pop',
    bg: '#0f0a16', card: '#181022', cardBorder: 'border-fuchsia-500/20', accent: 'text-fuchsia-400',
    badge: 'bg-fuchsia-400 text-[#0f0a16]', glow: '0 0 0 1px rgba(232,121,249,.22),0 0 30px -10px rgba(232,121,249,.55)',
    numA: 'bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white', numI: 'bg-violet-900/30 text-violet-200 border border-violet-700/50',
    base: 'text-violet-100/90', muted: 'text-violet-300/40', divide: 'divide-violet-900/40', tableJ: 'text-fuchsia-400/80', dot: 'text-fuchsia-400',
  },
  {
    file: 'design_dark4.html', title: '다크 4 · Mono Slate', footer: 'Dark / Mono (no color)',
    bg: '#0e0f12', card: '#17181c', cardBorder: 'border-slate-700', accent: 'text-white',
    badge: 'bg-white text-black', glow: 'none',
    numA: 'bg-white/10 text-white border border-white/40', numI: 'bg-slate-800/60 text-slate-300 border border-slate-700',
    base: 'text-slate-300', muted: 'text-slate-500', divide: 'divide-slate-800', tableJ: 'text-slate-200', dot: 'text-white',
  },
  {
    file: 'design_dark5.html', title: '다크 5 · Midnight Navy', footer: 'Dark / Midnight Navy (soft)',
    bg: '#0a1124', card: '#111a33', cardBorder: 'border-sky-500/20', accent: 'text-sky-400',
    badge: 'bg-sky-400 text-[#0a1124]', glow: '0 0 0 1px rgba(56,189,248,.18),0 0 30px -12px rgba(56,189,248,.5)',
    numA: 'bg-sky-400/10 text-sky-300 border border-sky-400/30', numI: 'bg-slate-700/40 text-slate-300 border border-slate-700',
    base: 'text-slate-300', muted: 'text-slate-500', divide: 'divide-slate-700/50', tableJ: 'text-sky-400/80', dot: 'text-sky-400',
  },
  {
    file: 'design_dark6.html', title: '다크 6 · Soft Lime', footer: 'Dark / Soft Lime (옅은 라임)',
    bg: '#0a0e12', card: '#11161c', cardBorder: 'border-lime-300/20', accent: 'text-lime-300',
    badge: 'bg-lime-300 text-[#0a0e12]', glow: '0 0 0 1px rgba(190,242,100,.16),0 0 26px -12px rgba(190,242,100,.38)',
    numA: 'bg-lime-300/10 text-lime-300 border border-lime-300/30', numI: 'bg-slate-700/30 text-slate-300 border border-slate-700',
    base: 'text-slate-300', muted: 'text-slate-500', divide: 'divide-slate-800/60', tableJ: 'text-lime-300/80', dot: 'text-lime-300',
  },
];

const papers = [
  { n:'1', t:'The effects of mechanical ventilation during v-a ecmo support: a systematic review.', m:'CRIT CARE · 2026 · PMID 42249495', active:true },
  { n:'2', t:'Predictive validity of daily SOFA-2 score for 30-day mortality.', m:'CRIT CARE · 2026 · PMID 42226253', active:false },
  { n:'3', t:'2025 Korean Guidelines for CPR: Part 6. Post-cardiac arrest care.', m:'CLIN EXP EMERG MED · 2026 · PMID 42297409', active:false },
];

function page(x){
  const glowCss = x.glow === 'none' ? '' : `.glow{box-shadow:${x.glow};}`;
  const glowCls = x.glow === 'none' ? '' : 'glow';
  const items = papers.map(p=>{
    const cls = p.active ? x.numA : x.numI;
    return `        <div class="flex gap-3"><span class="mono w-7 h-7 rounded-lg ${cls} text-[13px] font-black flex items-center justify-center flex-shrink-0">${p.n}</span><div><div class="text-[15px] font-bold text-white leading-snug">${p.t}</div><div class="mono text-[10px] ${x.muted} mt-1">${p.m}</div></div></div>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${x.title}</title><script src="https://cdn.tailwindcss.com"><\/script>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',sans-serif;}.mono{font-family:'SF Mono',ui-monospace,Consolas,monospace;}
details>summary{list-style:none;cursor:pointer;}details>summary::-webkit-details-marker{display:none;}
details[open]>summary .chev{transform:rotate(180deg);}.chev{transition:transform .2s ease;}${glowCss}</style></head>
<body class="min-h-screen ${x.base}" style="background:${x.bg}">
<div class="max-w-2xl mx-auto px-4 py-8">
  <div class="mb-7">
    <div class="flex items-baseline gap-3"><h1 class="text-3xl font-black tracking-tight text-white">Trend<span class="${x.accent}">.</span>Review</h1><span class="mono text-[10px] ${x.accent} opacity-70 uppercase tracking-[0.2em]">daily</span></div>
    <p class="${x.muted} text-[13px] mt-1.5">Emergency · Critical Care · AI literature pipeline</p>
    <div class="flex gap-3 mt-5">
      <div class="rounded-xl px-4 py-3 border ${x.cardBorder}" style="background:${x.card}"><div class="text-2xl font-black ${x.accent} tabular-nums mono">10</div><div class="text-[10px] ${x.muted} uppercase tracking-wider">days</div></div>
      <div class="rounded-xl px-4 py-3 border ${x.cardBorder}" style="background:${x.card}"><div class="text-2xl font-black ${x.accent} tabular-nums mono">30</div><div class="text-[10px] ${x.muted} uppercase tracking-wider">papers</div></div>
      <div class="rounded-xl px-4 py-3 border ${x.cardBorder} ml-auto" style="background:${x.card}"><div class="text-sm font-bold ${x.base} mono pt-1.5">06.18</div><div class="text-[10px] ${x.muted} uppercase tracking-wider">updated</div></div>
    </div>
  </div>
  <details open class="rounded-2xl border ${x.cardBorder} ${glowCls} overflow-hidden mb-3" style="background:${x.card}">
    <summary class="px-4 py-4 select-none">
      <div class="flex items-center gap-2 mb-3.5"><span class="mono text-[10px] font-bold ${x.badge} px-2 py-0.5 rounded">TODAY</span><span class="font-bold text-white text-sm mono">2026-06-18</span><span class="${x.muted} text-xs">· 3편</span></div>
      <div class="space-y-3">
${items}
      </div>
    </summary>
    <div class="border-t ${x.cardBorder} px-4 py-4">
      <div class="mono text-[11px] font-bold ${x.accent} uppercase tracking-wider mb-1">// why it matters</div>
      <p class="text-[13px] ${x.base} leading-relaxed">VA-ECMO 중 폐보호 환기 전략이 생존·이탈에 미치는 영향을 종합한 체계적 리뷰.</p>
      <div class="text-[15px] font-black text-white mt-4 mb-2 pb-1 border-b ${x.cardBorder}">PICO</div>
      <div class="space-y-1.5">
        <div class="flex gap-2"><span class="mono ${x.accent} text-[12px] font-bold w-4">P</span><span class="text-[13px] ${x.base}">VA-ECMO 지원 중인 중증 심원성 쇼크 성인</span></div>
        <div class="flex gap-2"><span class="mono ${x.accent} text-[12px] font-bold w-4">I</span><span class="text-[13px] ${x.base}">폐보호 환기(저일회호흡량·낮은 구동압)</span></div>
        <div class="flex gap-2"><span class="mono ${x.accent} text-[12px] font-bold w-4">O</span><span class="text-[13px] ${x.base}">생존, ECMO 이탈 성공, 폐손상</span></div>
      </div>
    </div>
  </details>
  <div class="rounded-2xl border ${x.cardBorder} px-4 py-3.5 mb-3 flex items-center gap-2" style="background:${x.card}"><span class="font-bold ${x.base} text-sm mono">2026-06-17</span><span class="${x.muted} text-xs">· 3편</span><span class="ml-auto ${x.muted}">⌄</span></div>
  <div class="rounded-2xl border ${x.cardBorder} overflow-hidden" style="background:${x.card}">
    <div class="px-4 py-3 border-b ${x.cardBorder} flex items-center"><h2 class="text-sm font-bold text-white">Curated Journal Archive</h2><span class="ml-auto mono text-[10px] ${x.accent}">30 entries</span></div>
    <div class="divide-y ${x.divide}">
      <div class="flex gap-3 px-4 py-2.5 text-[12px]"><span class="mono ${x.muted} w-12">06-18</span><span class="${x.tableJ} font-semibold w-24">Crit Care</span><span class="${x.base} flex-1 truncate">Mechanical ventilation during VA-ECMO…</span></div>
      <div class="flex gap-3 px-4 py-2.5 text-[12px]"><span class="mono ${x.muted} w-12">06-18</span><span class="${x.tableJ} font-semibold w-24">Crit Care</span><span class="${x.base} flex-1 truncate">Predictive validity of SOFA-2…</span></div>
      <div class="flex gap-3 px-4 py-2.5 text-[12px]"><span class="mono ${x.muted} w-12">06-17</span><span class="${x.tableJ} font-semibold w-24">Resuscitation</span><span class="${x.base} flex-1 truncate">…</span></div>
    </div>
  </div>
  <p class="text-center mono text-[10px] ${x.muted} py-7">Trend Review · ${x.footer}</p>
</div></body></html>`;
}

for (const t of themes) { fs.writeFileSync(t.file, page(t), {encoding:'utf8'}); console.log('wrote ' + t.file); }
