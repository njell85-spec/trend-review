/**
 * curation — 대시보드 큐레이션(R4): 🗑 삭제 · 🎬 자료화 버튼 + 자료화 상태 표시.
 *
 * 렌더는 클라이언트 스크립트 블록 1개(CURATION_BLOCK)가 담당한다:
 * 카드 하단·누적 표 양쪽에 같은 상태 객체(output/curation_state.json)를 그리므로
 * 두 위치가 어긋날 수 없다. 과거 카드·행도 페이지 로드 시 일괄 주입되어
 * 서버측 카드별 패치가 필요 없다. (배포 index.html은 증분 패치라 블록은
 * on-demand 위젯과 동일한 버전 마커 + 멱등 교체 패턴을 쓴다.)
 *
 * 섹션 식별 = 태그+키 쌍. 주간 가이드라인이 있는 날은 SECTION:날짜 와
 * GSECTION:날짜 가 같은 키로 공존하므로(publisher gKey=dateStr), 키만으로
 * 지우면 논문·가이드 카드가 함께 소멸한다(리뷰 C1). 숨김 상태의 키도
 * "SECTION:2026-07-06" / "GSECTION:2026-07-06" 형태의 태그 접두 키를 쓴다.
 *
 * 서버측은 삭제 반영(removeSectionFromHtml)과 상태 파일 IO만 제공한다.
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

export const CURATION_STATE_PATH = path.join('output', 'curation_state.json');

// ── 상태 파일 IO ─────────────────────────────────────────────────────────────
export async function loadCurationState(file = CURATION_STATE_PATH) {
  try {
    const s = JSON.parse(await readFile(file, 'utf8'));
    return { hidden: s.hidden ?? {}, materialized: s.materialized ?? {} };
  } catch {
    return { hidden: {}, materialized: {} };
  }
}

export async function saveCurationState(state, file = CURATION_STATE_PATH) {
  await writeFile(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── 삭제: 섹션 블록 + 표 행 제거 + 통계 재계산 ───────────────────────────────
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 대시보드 HTML에서 지정 태그의 섹션과 해당 pmid의 표 행을 제거하고
 * 통계(분석일수·논문 수)를 재계산한다. 멱등 — 이미 없으면 그대로.
 * tag를 좁혀 받는 이유: SECTION/GSECTION이 같은 날짜 키로 공존할 수 있다(C1).
 */
export function removeSectionFromHtml(html, { sectionKey, pmid = '', tag = 'SECTION' }) {
  if (!['SECTION', 'GSECTION'].includes(tag)) return html;
  let out = html;
  const re = new RegExp(`\\n?<!-- ${tag}:${reEsc(sectionKey)} -->[\\s\\S]*?<!-- /${tag}:${reEsc(sectionKey)} -->`, 'g');
  out = out.replace(re, '');
  if (pmid) {
    // 표는 pmid 기준 중복 제거돼 있어(publisher ② 단계) 행은 최대 1개다.
    const rowRe = new RegExp(`<tr data-pmid="${reEsc(pmid)}"[^>]*>[\\s\\S]*?</tr>`, 'g');
    out = out.replace(rowRe, '');
  }
  return recountStats(out);
}

/** 숨김 상태 키("TAG:sectionKey") → {tag, sectionKey}. 형식 밖이면 null. */
export function parseHiddenKey(hiddenKey) {
  const m = String(hiddenKey).match(/^(G?SECTION):(.+)$/);
  return m ? { tag: m[1], sectionKey: m[2] } : null;
}

/** 통계 재계산 — publisher의 카운트 규칙과 동일(데일리 섹션만 일수로 센다). */
export function recountStats(html) {
  const dayCount = (html.match(/<!-- SECTION:\d{4}-\d{2}-\d{2} -->/g) ?? []).length;
  const paperCount = (html.match(/class="paper-card"/g) ?? []).length || dayCount;
  return html
    .replace(/<div class="n stat-days-count">[^<]*<\/div>/, `<div class="n stat-days-count">${dayCount}</div>`)
    .replace(/<div class="n stat-papers-count">[^<]*<\/div>/, `<div class="n stat-papers-count">${paperCount}</div>`)
    .replace(/<span class="at-count">[^<]*<\/span>/, `<span class="at-count">${paperCount}편</span>`);
}

// ── 클라이언트 블록 ──────────────────────────────────────────────────────────
/**
 * 버전 마커 규칙(온디맨드 위젯과 동일): 클라이언트 코드를 고치면 반드시 버전을
 * 올릴 것 — 안 올리면 증분 패치되는 배포 페이지에 영원히 반영되지 않는다.
 */
export function curationBlock({ owner, repo }) {
  return `<!-- CURATION_BLOCK v4 -->
<script>
(function(){
  var OWNER='${owner}', REPO='${repo}';
  var API='https://api.github.com/repos/'+OWNER+'/'+REPO;
  var PEND_TTL=45*60*1000; // 요청됨 표시 유지 시간 — 이 안에 상태 파일이 갱신된다
  var state={hidden:{},materialized:{}};

  function pat(force){
    var t=localStorage.getItem('tr_pat');
    if(!t||force){ t=prompt('GitHub Fine-grained PAT (이 저장소 actions:write 한정)\\n최초 1회만 — 이 브라우저에만 저장됩니다.'); if(t){localStorage.setItem('tr_pat',t.trim());} }
    return localStorage.getItem('tr_pat');
  }
  function pending(pmid,set){
    var k='tr_cur_p_'+pmid;
    if(set){ try{localStorage.setItem(k,String(Date.now()));}catch(e){} return true; }
    var v=Number(localStorage.getItem(k)||0);
    if(!v) return false;
    if(Date.now()-v>PEND_TTL || (state.materialized&&state.materialized[pmid])){ try{localStorage.removeItem(k);}catch(e){} return false; }
    return true;
  }
  function statusOf(pmid){
    var m=state.materialized&&state.materialized[pmid];
    if(m) return {k:'done',date:String(m.date||'').slice(5)};
    if(pending(pmid)) return {k:'pending'};
    return {k:'none'};
  }
  function chipHtml(st,small){
    var pad=small?'3px 8px':'5px 11px', fs=small?'10px':'10.5px';
    if(st.k==='done') return '<span style="font-size:'+fs+';font-weight:800;padding:'+pad+';border-radius:99px;background:#ecfdf5;color:#059669;border:1px solid #b6e6da;white-space:nowrap">\\uD83C\\uDFAC \\uC790\\uB8CC\\uD654\\uB428'+(st.date?' \\u00B7 '+st.date:'')+'</span>';
    if(st.k==='pending') return '<span style="font-size:'+fs+';font-weight:800;padding:'+pad+';border-radius:99px;background:#fef9c3;color:#a16207;white-space:nowrap">\\u23F3 \\uC694\\uCCAD\\uB428</span>';
    return small?'<span style="color:#cbd5e1">\\u2014</span>':'<span style="font-size:'+fs+';font-weight:800;padding:'+pad+';border-radius:99px;background:#f1f5f9;color:#94a3b8;white-space:nowrap">\\uBBF8\\uC790\\uB8CC\\uD654</span>';
  }
  function dispatch(workflow,inputs,done){
    var t=pat(false); if(!t){alert('\\uD1A0\\uD070\\uC774 \\uD544\\uC694\\uD569\\uB2C8\\uB2E4 \\u2014 \\uC704\\uC82F\\uC758 "\\uC9C1\\uC811 \\uC785\\uB825 \\u00B7 \\uD1A0\\uD070 \\uC124\\uC815"\\uC5D0\\uC11C \\uB4F1\\uB85D\\uD558\\uC138\\uC694.');return;}
    fetch(API+'/actions/workflows/'+workflow+'/dispatches',{
      method:'POST',
      headers:{'Authorization':'Bearer '+t,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({ref:'main',inputs:inputs})
    }).then(function(r){
      if(r.status===204){done();}
      else if(r.status===401||r.status===403){alert('\\u2716 \\uD1A0\\uD070 \\uC778\\uC99D \\uC2E4\\uD328 \\u2014 \\uC704\\uC82F\\uC5D0\\uC11C \\uD1A0\\uD070\\uC744 \\uC7AC\\uC124\\uC815\\uD558\\uC138\\uC694.');}
      else{alert('\\u2716 \\uC694\\uCCAD \\uC2E4\\uD328 (HTTP '+r.status+')');}
    }).catch(function(){alert('\\u2716 \\uB124\\uD2B8\\uC6CC\\uD06C \\uC624\\uB958');});
  }
  function pmidOfCard(card){
    var a=card.querySelector('.pc-foot a[href*="pubmed.ncbi.nlm.nih.gov"]');
    var m=a&&a.href.match(/pubmed\\.ncbi\\.nlm\\.nih\\.gov\\/(\\d+)/);
    return m?m[1]:'';
  }
  // details 요소의 정체성 = 자신을 감싸는 첫 번째 G?SECTION 주석 (태그+키 쌍).
  // 형제 체인 전체를 특정 키로 스캔하면 더 오래된 섹션이 전부 오인된다(리뷰 M1).
  function sectionInfoOfDetails(el){
    var n=el&&el.previousSibling;
    while(n){
      if(n.nodeType===8){
        var m=String(n.nodeValue).match(/^\\s*(G?SECTION):(\\S+)/);
        if(m) return {tag:m[1],key:m[2]};
      }
      n=n.previousSibling;
    }
    return null;
  }
  function sectionInfoOf(card){
    var el=card.closest('details');
    return el?sectionInfoOfDetails(el):null;
  }
  function onRemove(info,pmid,hideEls){
    if(!info){alert('\\uC139\\uC158 \\uD0A4\\uB97C \\uCC3E\\uC9C0 \\uBABB\\uD588\\uC2B5\\uB2C8\\uB2E4.');return;}
    if(!confirm('\\uC774 \\uD56D\\uBAA9\\uC744 \\uB300\\uC2DC\\uBCF4\\uB4DC\\uC5D0\\uC11C \\uC0AD\\uC81C\\uD560\\uAE4C\\uC694?\\n(\\uC544\\uCE74\\uC774\\uBE0C\\u00B7\\uC7AC\\uC120\\uC815 \\uBC29\\uC9C0 \\uBAA9\\uB85D\\uC740 \\uC720\\uC9C0\\uB429\\uB2C8\\uB2E4)'))return;
    dispatch('curate-remove.yml',{sectionKey:info.key,tag:info.tag,pmid:pmid},function(){
      hideEls.forEach(function(el){if(el)el.style.display='none';});
    });
  }
  function onMaterialize(pmid,refresh){
    if(!pmid){alert('PMID\\uB97C \\uCC3E\\uC9C0 \\uBABB\\uD588\\uC2B5\\uB2C8\\uB2E4.');return;}
    if(statusOf(pmid).k==='done')return;
    if(!confirm('\\uCE74\\uB4DC\\uB274\\uC2A4\\u00B7\\uC601\\uC0C1\\uC744 \\uC0DD\\uC131\\uD558\\uACE0 YouTube \\uBE44\\uACF5\\uAC1C \\uC5C5\\uB85C\\uB4DC\\uD560\\uAE4C\\uC694?\\n(\\uC218 \\uBD84 \\uC18C\\uC694 \\u2014 \\uC644\\uB8CC \\uD6C4 \\uC0C1\\uD0DC\\uAC00 \\uC790\\uB8CC\\uD654\\uB428\\uC73C\\uB85C \\uBC14\\uB01D\\uB2C8\\uB2E4)'))return;
    dispatch('materialize.yml',{pmid:pmid},function(){ pending(pmid,true); refresh(); });
  }
  function btn(label,kind,small){
    var b=document.createElement('button');
    b.textContent=label;
    b.style.cssText = kind==='del'
      ? 'font-size:'+(small?'13px':'12px')+';font-weight:800;padding:'+(small?'4px 8px':'7px 13px')+';border-radius:8px;border:1px solid #fdba74;background:#fff7ed;color:#b45309;cursor:pointer'
      : 'font-size:'+(small?'13px':'12px')+';font-weight:800;padding:'+(small?'4px 8px':'7px 13px')+';border-radius:8px;border:0;background:linear-gradient(90deg,#5b8fd9,#7dabe8);color:#fff;cursor:pointer';
    return b;
  }
  function addCardControls(){
    var cards=document.querySelectorAll('.paper-card,.guideline-card');
    for(var i=0;i<cards.length;i++)(function(card){
      if(card.querySelector('.cur-row'))return;
      var foot=card.querySelector('.pc-foot'); if(!foot)return;
      var pmid=pmidOfCard(card), info=sectionInfoOf(card);
      var row=document.createElement('div');
      row.className='cur-row';
      row.style.cssText='display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap';
      var chip=document.createElement('span');
      function paint(){
        var st=statusOf(pmid);
        chip.innerHTML=chipHtml(st,false);
        mat.disabled=(st.k!=='none');
        if(st.k==='done'){mat.style.background='#e2e8f0';mat.style.color='#94a3b8';mat.textContent='\\uD83C\\uDFAC \\uC790\\uB8CC\\uD654\\uB428';}
        else if(st.k==='pending'){mat.style.opacity='.55';}
      }
      var box=document.createElement('span');
      box.style.cssText='margin-left:auto;display:flex;gap:8px';
      var del=btn('\\uD83D\\uDDD1 \\uC0AD\\uC81C','del',false);
      var mat=btn('\\uD83C\\uDFAC \\uC790\\uB8CC\\uD654','mat',false);
      del.addEventListener('click',function(){
        var tr=pmid?document.querySelector('.arch-table tr[data-pmid="'+pmid+'"]'):null;
        onRemove(info,pmid,[card.closest('details'),tr]);
      });
      mat.addEventListener('click',function(){onMaterialize(pmid,repaintAll);});
      box.appendChild(del);box.appendChild(mat);
      row.appendChild(chip);row.appendChild(box);
      foot.parentNode.insertBefore(row,foot);
      card._curPaint=paint; paint();
    })(cards[i]);
  }
  function addTableControls(){
    var table=document.querySelector('.arch-table table'); if(!table)return;
    // 컬럼 2개 추가로 제목 컬럼이 눌려 세로로 길게 감기는 것 방지 —
    // 제목에 최소 폭을 주고 넘치는 폭은 기존 가로 스크롤(.at-scroll)이 흡수한다.
    // 폰 폭에서는 저널 컬럼을 숨겨 제목·자료화 상태가 스와이프 없이 보이게 한다
    // (저널은 카드에 있고, 표의 목적은 스캔+큐레이션 — 태블릿 이상은 전 컬럼).
    if(!document.getElementById('cur-style')){
      var st=document.createElement('style'); st.id='cur-style';
      st.textContent='.arch-table .c-title{min-width:170px}.arch-table .c-cur button{vertical-align:middle}'
        +'@media(max-width:699px){.arch-table .c-jour,.arch-table thead th:nth-child(2){display:none}}'
        +'@media(min-width:700px){.arch-table .c-jour{white-space:normal;max-width:150px}}';
      document.head.appendChild(st);
    }
    var head=table.querySelector('thead tr');
    if(head&&!head.querySelector('.th-cur')){
      var thS=document.createElement('th'); thS.className='th-cur'; thS.textContent='\\uC790\\uB8CC\\uD654'; thS.style.textAlign='center';
      var thM=document.createElement('th'); thM.className='th-cur'; thM.textContent='\\uAD00\\uB9AC'; thM.style.textAlign='center';
      var thRead=head.querySelector('.th-read');
      head.insertBefore(thS,thRead); head.appendChild(thM);
    }
    var rows=table.querySelectorAll('tbody tr[data-pmid]');
    for(var i=0;i<rows.length;i++)(function(tr){
      if(tr.querySelector('.c-cur'))return;
      var pmid=tr.getAttribute('data-pmid')||'';
      var tdS=document.createElement('td'); tdS.className='c-cur'; tdS.style.cssText='text-align:center;white-space:nowrap';
      var tdM=document.createElement('td'); tdM.className='c-cur'; tdM.style.cssText='text-align:center;white-space:nowrap';
      function paint(){
        var st=statusOf(pmid);
        tdS.innerHTML=chipHtml(st,true);
        mat.disabled=(st.k!=='none');
        mat.style.opacity=(st.k==='none')?'1':'.45';
      }
      var del=btn('\\uD83D\\uDDD1','del',true); del.title='\\uC0AD\\uC81C';
      var mat=btn('\\uD83C\\uDFAC','mat',true); mat.title='\\uC790\\uB8CC\\uD654';
      del.addEventListener('click',function(){
        // 표에서 삭제 시 대응 카드의 섹션 태그+키는 카드 쪽에서 역탐색
        var info=null,cardEl=null;
        var cards=document.querySelectorAll('.paper-card,.guideline-card');
        for(var j=0;j<cards.length;j++){ if(pmidOfCard(cards[j])===pmid){cardEl=cards[j];info=sectionInfoOf(cards[j]);break;} }
        onRemove(info,pmid,[cardEl&&cardEl.closest('details'),tr]);
      });
      mat.addEventListener('click',function(){onMaterialize(pmid,repaintAll);});
      tdM.appendChild(del);tdM.appendChild(document.createTextNode(' '));tdM.appendChild(mat);
      var tdRead=tr.querySelector('.c-read');
      tr.insertBefore(tdS,tdRead); tr.appendChild(tdM);
      tr._curPaint=paint; paint();
    })(rows[i]);
  }
  function repaintAll(){
    var els=document.querySelectorAll('.paper-card,.guideline-card,.arch-table tbody tr[data-pmid]');
    for(var i=0;i<els.length;i++){ if(els[i]._curPaint)els[i]._curPaint(); }
  }
  function applyHidden(){
    // 상태 파일이 먼저 갱신되고 HTML 패치·배포가 늦는 구간의 표시 정합.
    // 각 details의 "자기" 마커(태그:키)를 구해 숨김 목록과 대조한다 —
    // 키 하나로 형제 체인을 훑으면 더 오래된 섹션까지 전부 숨는다(리뷰 M1).
    var hid=state.hidden||{};
    var all=document.querySelectorAll('.archive details');
    for(var i=0;i<all.length;i++){
      var info=sectionInfoOfDetails(all[i]);
      if(info&&hid[info.tag+':'+info.key]) all[i].style.display='none';
    }
    Object.keys(hid).forEach(function(k){
      var pm=(hid[k]||{}).pmid;
      if(pm){var tr=document.querySelector('.arch-table tr[data-pmid="'+pm+'"]'); if(tr)tr.style.display='none';}
    });
  }
  function init(){
    fetch('output/curation_state.json?t='+Date.now())
      .then(function(r){return r.ok?r.json():null})
      .then(function(j){ if(j){state.hidden=j.hidden||{};state.materialized=j.materialized||{};} })
      .catch(function(){})
      .then(function(){ applyHidden(); addCardControls(); addTableControls(); });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
</script>
<!-- /CURATION_BLOCK -->`;
}

/**
 * 배포 페이지에 큐레이션 블록 보장(멱등) — 현재 버전 있으면 그대로,
 * 구버전이면 교체, 없으면 </body> 앞에 주입. (_ensureOnDemandWidget과 동일 규칙)
 */
export function ensureCurationBlock(html, { owner, repo }) {
  const block = curationBlock({ owner, repo });
  const currentMarker = block.match(/<!-- CURATION_BLOCK v\d+ -->/)[0];
  if (html.includes(currentMarker)) return html;
  const re = /<!-- CURATION_BLOCK(?: v\d+)? -->[\s\S]*?<!-- \/CURATION_BLOCK -->/;
  if (re.test(html)) return html.replace(re, () => block);
  return html.replace('</body>', () => `${block}\n</body>`);
}
