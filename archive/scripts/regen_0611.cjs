// Regenerate 2026-06-11 section in the current canonical card template.
// Ports the cloud routine's build_card/ek/sh/st logic to JS.
const fs = require('fs');

const papers = [
  {
    title: "Prehospital Resuscitation with Type O Whole Blood for Trauma and Hemorrhage",
    journal: "N Engl J Med", year: "2026", month: "", pmid: "42150044", doi: "",
    score: "8", evidence_level: "RCT", study_type: "RCT", n: "1020", baseline: "Balanced",
    why_en: "In a pragmatic, multicenter, phase 3 cluster-randomized trial, prehospital transfusion of type O whole blood did not significantly reduce 30-day mortality compared with blood components in trauma patients with hemorrhage.",
    why_ko: "병원 전 전혈 수혈은 혈액성분 제제 대비 30일 사망률을 유의하게 낮추지 못했다.",
    pico_en: {
      population: "Trauma patients with suspected hemorrhagic shock transported by air medical services (N=1020, 44 air bases randomized 2:1)",
      intervention: "Up to 2 units of prehospital type O whole blood (LTOWB)",
      comparison: "As-indicated blood components (plasma, red cells, or both)",
      outcome: "Death from any cause within 30 days: 25.9% (whole blood) vs 20.5% (components); OR 1.24 (95% CI, 0.87–1.76; P=0.24)"
    },
    pico_ko: {
      population: "출혈성 쇼크 의심 외상 환자 (헬기 이송, N=1,020, 44개 항공기지 2:1 배정)",
      intervention: "병원 전 O형 전혈(LTOWB) 최대 2단위 수혈",
      comparison: "필요 시 혈액성분 제제 수혈 (적혈구+혈장 등)",
      outcome: "30일 사망률: 전혈 25.9% vs 성분수혈 20.5% (OR 1.24; 95% CI 0.87–1.76; P=0.24)"
    },
    secondary_en: [], secondary_ko: [],
    glossary: [{term:"OR", ko:"오즈비 — 두 군의 사건 발생 가능성 비"}, {term:"95% CI", ko:"95% 신뢰구간"}, {term:"P", ko:"유의확률 (보통 <0.05면 유의)"}],
    limitations_en: "Cluster randomization at the air-base level; effects of blood storage age assessed only in an observational substudy; trial powered for all-cause mortality.",
    limitations_ko: "항공기지 단위 군집 무작위배정; 혈액 보관기간 효과는 관찰 하위연구로만 평가; 전체 사망률 기준 검정력 설계.",
    takeaway_en: "Blood components remain an equivalent standard of care to whole blood for prehospital resuscitation; the survival benefit lies in prehospital transfusion itself rather than in whole blood specifically.",
    takeaway_ko: "병원 전 전혈 수혈은 혈액성분 수혈 대비 30일 사망률을 유의하게 낮추지 못했다. 다만 두 군 모두 병원 전 수혈을 받지 못한 군보다 생존율이 높아 병원 전 수혈 자체의 이점은 유지된다. 전혈의 물류적 단순성에도 불구하고 혈액성분 제제가 동등한 표준 치료임을 확인했다.",
    practice_en: ["Continue prehospital transfusion in hemorrhagic trauma regardless of whole blood availability", "Do not prioritize whole blood over components on the basis of a mortality benefit"],
    practice_ko: ["전혈 가용 여부와 무관하게 출혈성 외상에서 병원 전 수혈을 지속한다", "사망률 이점을 근거로 전혈을 성분제제보다 우선할 필요는 없다"],
    rationale_ko: "다기관 무작위배정과 명확한 1차 결과(30일 사망률)로 내적 타당도가 높다."
  },
  {
    title: "Restrictive vs Liberal Physical Restraint Strategies in Critically Ill Patients: The R2D2-ICU Randomized Clinical Trial",
    journal: "JAMA", year: "2026", month: "", pmid: "41841304", doi: "",
    score: "7", evidence_level: "RCT", study_type: "RCT", n: "405", baseline: "Balanced",
    why_en: "A restrictive, low-use wrist-strap physical restraint strategy did not significantly improve delirium- and coma-free days compared with liberal restraint use in mechanically ventilated ICU patients.",
    why_ko: "ICU 신체 억제대 최소화 전략은 섬망·혼수 비발생일수를 개선하지 못했다.",
    pico_en: {
      population: "Adults receiving invasive mechanical ventilation across 10 ICUs in France (N=405)",
      intervention: "Restrictive, low-use wrist-strap physical restraint strategy (restraints avoided unless necessary)",
      comparison: "Liberal physical restraint use",
      outcome: "Delirium- and coma-free days within 14 days — no significant between-group difference"
    },
    pico_ko: {
      population: "기계호흡 중인 ICU 성인 환자 (프랑스 10개 ICU 다기관, N=405)",
      intervention: "신체 억제대 최소화(restrictive) 전략",
      comparison: "신체 억제대 자유 사용(liberal) 전략",
      outcome: "14일 이내 섬망·혼수 비발생일수(DAF) — 군간 유의한 차이 없음"
    },
    secondary_en: [], secondary_ko: [],
    glossary: [{term:"DAF", ko:"섬망·혼수 비발생일수 (delirium- and coma-free days)"}],
    limitations_en: "Open-label design; single-country (France); restraint use is difficult to blind and subject to unit culture.",
    limitations_ko: "비맹검 설계; 단일 국가(프랑스); 억제대 사용은 맹검이 어렵고 병동 문화의 영향을 받음.",
    takeaway_en: "Reducing physical restraint use alone did not prevent delirium; a multicomponent nonpharmacologic approach (e.g., the ABCDEF bundle) is likely required.",
    takeaway_ko: "기계호흡 ICU 환자에서 억제대 사용 최소화 전략은 섬망·혼수 비발생일수를 유의하게 개선시키지 못했다. 단순한 억제대 감소만으로는 섬망 예방이 어려우며, 비약물적 다학제 접근(ABCDEF 번들)을 병행해야 함을 시사한다.",
    practice_en: ["Do not rely on restraint minimization alone to prevent ICU delirium", "Pair restraint-reduction efforts with a full ABCDEF bundle"],
    practice_ko: ["ICU 섬망 예방을 억제대 최소화 단독에 의존하지 않는다", "억제대 감소는 ABCDEF 번들 전체와 함께 적용한다"],
    rationale_ko: "다기관 무작위배정이나 비맹검·단일국가로 일부 우려가 있다."
  },
  {
    title: "Fast Antimicrobial Susceptibility Testing for Gram-Negative Bacteremia: The FAST Randomized Clinical Trial",
    journal: "JAMA", year: "2026", month: "", pmid: "41999287", doi: "",
    score: "5", evidence_level: "RCT", study_type: "RCT", n: "", baseline: "Not reported",
    why_en: "Rapid antimicrobial susceptibility testing shortened time to optimal therapy but did not demonstrate superiority over standard testing on a DOOR-based clinical outcome in gram-negative bacteremia.",
    why_ko: "신속 항생제 감수성 검사는 최적 치료 시점을 앞당겼으나 임상 결과 우월성은 입증하지 못했다.",
    pico_en: {
      population: "Hospitalized adults and children with gram-negative bloodstream infections at 7 centers in high-resistance regions (Greece, India, Israel, Spain)",
      intervention: "Rapid antimicrobial susceptibility testing (rapid AST)",
      comparison: "Standard antimicrobial susceptibility testing (standard AST)",
      outcome: "Desirability of Outcome Ranking (DOOR)-based clinical outcome — no demonstrated superiority"
    },
    pico_ko: {
      population: "그람음성균 균혈증 입원 환자 (고내성균 유병 지역 7기관)",
      intervention: "신속 항생제 감수성 검사(rapid AST)",
      comparison: "표준 항생제 감수성 검사(standard AST)",
      outcome: "DOOR 기반 임상 결과 — 우월성 미입증"
    },
    secondary_en: [], secondary_ko: [],
    glossary: [{term:"AST", ko:"항생제 감수성 검사"}, {term:"DOOR", ko:"결과 바람직성 순위 (Desirability of Outcome Ranking)"}],
    limitations_en: "Open-label design; heterogeneous sites and resistance patterns; rapid AST advanced optimal therapy by 12–48 hours without a measurable DOOR benefit.",
    limitations_ko: "비맹검 설계; 기관·내성 양상의 이질성; 신속 AST는 최적 치료를 12~48시간 앞당겼으나 DOOR 이점은 측정되지 않음.",
    takeaway_en: "Rapid AST accelerates optimal antibiotic selection but, in this trial, did not translate into better patient-centered outcomes over standard AST.",
    takeaway_ko: "신속 AST는 최적 항생제 투여를 12~48시간 앞당겼으나 DOOR 지표에서 표준 AST 대비 우월성을 입증하지 못했다.",
    practice_en: ["Value rapid AST for faster optimal therapy, but temper expectations for outcome improvement", "Pair diagnostics with antimicrobial stewardship to realize benefit"],
    practice_ko: ["신속 AST는 빠른 최적 치료 측면에서 가치가 있으나 결과 개선 기대는 신중히 한다", "이점 실현을 위해 진단검사를 항생제 스튜어드십과 병행한다"],
    rationale_ko: "무작위배정이나 비맹검·기관 이질성과 1차 결과 미충족으로 근거 강도는 중간."
  }
];

const GEN = "2026. 06. 11. 09:11";
const DATE = "2026-06-11";
const NB = ['bg-gray-900','bg-gray-600','bg-gray-400'];

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ek(en, ko){
  let h = '<p class="text-[13px] text-gray-800 leading-relaxed">' + esc(en || '—') + '</p>';
  if (ko) h += '<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">' + esc(ko) + '</p>';
  return h;
}
function sh(label){ return '<div class="text-[13px] font-bold text-blue-700 mt-3 mb-1">' + label + '</div>'; }
function st(label){ return '<div class="text-[16px] font-black text-blue-900 mt-4 mb-1.5 pb-1 border-b border-gray-200">' + label + '</div>'; }

function build_card(p, i){
  const nb = NB[i];
  const ev = p.evidence_level || 'Other';
  const ev_s = (['High','RCT','Meta','Systematic Review'].includes(ev)) ? 'border border-gray-800 text-gray-800'
             : (['Moderate','Cohort','Validation'].includes(ev)) ? 'border border-gray-400 text-gray-600'
             : 'border border-gray-300 text-gray-400';
  const pico_en = p.pico_en || {}, pico_ko = p.pico_ko || {};
  const sec_en = p.secondary_en || [], sec_ko = p.secondary_ko || [];
  let sec_html = '';
  if (sec_en.length){
    let items = '';
    sec_en.forEach((s,k)=>{ const ko = sec_ko[k]||''; items += '<li class="mb-1.5 pl-2.5 border-l-2 border-gray-200"><p class="text-[13px] text-gray-800 leading-relaxed">'+esc(s)+'</p>'; if(ko) items+='<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">'+esc(ko)+'</p>'; items+='</li>'; });
    sec_html = '<div class="text-[12px] font-bold text-gray-500 uppercase mt-2 mb-0.5">Secondary</div><ul>'+items+'</ul>';
  }
  const gl = p.glossary || [];
  let gl_html = '';
  if (gl.length){
    const gi = gl.map(g=>'<div class="mb-0.5"><b class="text-gray-600">'+esc(g.term||'')+'</b> — '+esc(g.ko||'')+'</div>').join('');
    gl_html = '<div class="mt-2 bg-gray-50 rounded-lg px-3 py-2 text-[12px] text-gray-500 leading-relaxed"><div class="font-bold text-gray-600 mb-1">통계 용어 풀이</div>'+gi+'</div>';
  }
  const pr_en = p.practice_en || [], pr_ko = p.practice_ko || [];
  let pr_html = '';
  if (pr_en.length){
    let items = '';
    pr_en.forEach((t,k)=>{ const ko = pr_ko[k]||''; items += '<li class="mb-1.5 flex gap-1.5"><span class="text-blue-700 font-bold flex-shrink-0">·</span><div><p class="text-[13px] text-gray-800 leading-relaxed">'+esc(t)+'</p>'; if(ko) items+='<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">'+esc(ko)+'</p>'; items+='</div></li>'; });
    pr_html = sh('Practice Change') + '<ul class="mt-0.5">'+items+'</ul>';
  }
  const pmid = p.pmid||'';
  const pmurl = pmid ? ('https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/') : '#';
  const doi = p.doi||'';
  const doi_link = doi ? (' · <a href="https://doi.org/'+esc(doi)+'" target="_blank" class="text-blue-600 underline">DOI</a>') : '';
  const stype = p.study_type||'';
  const n = p.n||'';
  const baseline = p.baseline||'Not reported';
  const rationale = p.rationale_ko||'';
  let sc = parseFloat(p.score||0); if(isNaN(sc)) sc = 0;
  const val_label = (['High','RCT','Meta','Systematic Review'].includes(ev)) ? 'Low Risk' : (['Moderate','Cohort','Validation'].includes(ev)) ? 'Some Concerns' : 'High Risk';
  const ed_label = sc>=8 ? '적용 가능' : sc>=5 ? '부분 적용' : '적용 어려움';
  const head = '<div class="text-[12px] text-gray-500"><b class="text-gray-700">'+esc(p.journal||'')+'</b> · '+esc(p.year||'')+(p.month?('-'+p.month):'')+(stype?(' · '+esc(stype)):'')+' · <a href="'+pmurl+'" target="_blank" class="text-blue-600 underline">PubMed'+(pmid?(' '+pmid):'')+'</a>'+doi_link+'</div>';
  const base_line = '<div class="text-[13px] text-gray-700 mt-1">'+(n?('<b>n = '+esc(n)+'</b> · '):'')+'<span class="text-gray-500">Baseline —</span> <b>'+esc(baseline)+'</b></div>';
  const body = '<div class="slide-in px-4 pb-4 pt-2 bg-gray-50/60">'+head+sh('Why It Matters')+ek(p.why_en,p.why_ko)+st('PICO Framework')+sh('P — Patient')+ek(pico_en.population,pico_ko.population)+base_line+sh('I — Intervention')+ek(pico_en.intervention,pico_ko.intervention)+sh('C — Comparison')+ek(pico_en.comparison,pico_ko.comparison)+sh('O — Outcome &amp; Results')+'<div class="text-[12px] font-bold text-gray-500 uppercase mb-0.5">Primary</div>'+ek(pico_en.outcome,pico_ko.outcome)+sec_html+gl_html+st('Critical Appraisal &amp; Applicability')+'<div class="text-[13px] text-gray-800"><span class="font-bold text-blue-700">Internal Validity</span> — <b>'+val_label+'</b></div>'+(rationale?('<div class="text-[13px] text-gray-600 mt-0.5"><span class="text-gray-500">Reason :</span> '+esc(rationale)+'</div>'):'')+sh('Limitations')+ek(p.limitations_en,p.limitations_ko)+'<div class="text-[13px] text-gray-800 mt-2"><span class="font-bold text-blue-700">ED Applicability</span> — <b>'+ed_label+'</b></div>'+st('Clinical Bottom Line')+ek(p.takeaway_en,p.takeaway_ko)+pr_html+'</div>';
  const summary = '<details class="group"><summary class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition select-none"><span class="w-6 h-6 rounded-full '+nb+' text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">'+String(i+1).padStart(2,'0')+'</span><div class="flex-1 min-w-0"><div class="text-[16px] font-black text-blue-900 leading-snug">'+esc(p.title||'')+'</div><div class="text-[12px] text-gray-400 mt-0.5">'+esc(p.journal||'')+' · '+esc(p.year||'')+'</div></div><div class="flex items-center gap-2 flex-shrink-0"><span class="text-[10px] '+ev_s+' px-1.5 py-0.5 rounded-full">'+esc(ev)+'</span><svg class="chev w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg></div></summary>';
  return summary + body + '</details>';
}

const si = papers.slice(0,3).map((p,i)=>'<div class="text-xs font-medium text-gray-700 mt-1">'+String.fromCharCode(0x2460+i)+' '+esc(p.title||'')+'</div><div class="text-[10px] text-gray-400 pl-3">'+esc(p.journal||'')+' · '+esc(p.year||'')+esc(p.month?('-'+p.month):'')+(p.pmid?(' · PMID '+p.pmid):'')+'</div>').join('');
const cards = papers.slice(0,3).map((p,i)=>build_card(p,i)).join('');

const sec = '<!-- SECTION:'+DATE+' -->\n'+
'<details class="rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-white">\n'+
'<summary class="px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition select-none">\n'+
'<div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-2.5">\n'+
'<span class="font-bold text-gray-900 text-sm">'+DATE+'</span>\n'+
'<span class="text-gray-400 text-xs">· '+papers.slice(0,3).length+'편</span>\n'+
'<span class="text-gray-300 text-[10px] ml-auto">생성 '+GEN+'</span>\n'+
'</div><div class="space-y-1">'+si+'</div></div>\n'+
'<svg class="chev w-4 h-4 text-gray-400 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>\n'+
'</summary>\n'+
'<div class="slide-in border-t border-gray-200 divide-y divide-gray-100">'+cards+'</div>\n'+
'</details>\n'+
'<!-- /SECTION:'+DATE+' -->';

fs.writeFileSync('section_0611.html', sec, {encoding:'utf8'});
console.log('Wrote section_0611.html ('+sec.length+' chars)');
