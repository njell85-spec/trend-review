// Normalize every date section to the canonical template classes, then rebuild
// the cumulative journal table and stat counts. Fetches/pushes via GitHub API.
const TOKEN = "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";
const OWNER = "njell85-spec", REPO = "Trend_Review";
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/index.html`;
const H = { Authorization: "token " + TOKEN, Accept: "application/vnd.github+json", "User-Agent": "TR", "Content-Type": "application/json" };

// exact class-string replacements applied ONLY inside section blocks
const REPL = [
  // summary-index title  (big extrabold -> canonical small medium)
  ['text-[16px] font-extrabold text-gray-700 mt-1', 'text-xs font-medium text-gray-700 mt-1'],
  // summary-index meta  (12px -> 10px ; this is what the journal-table parser needs)
  ['text-[12px] text-gray-400 pl-3', 'text-[10px] text-gray-400 pl-3'],
  // section header date  (16px blue black/bold -> canonical 14px gray bold)
  ['font-black text-blue-900 text-[16px]', 'font-bold text-gray-900 text-sm'],
  ['font-bold text-blue-900 text-[16px]', 'font-bold text-gray-900 text-sm'],
  // header "· N편" count
  ['text-gray-400 text-[12px]', 'text-gray-400 text-xs'],
  // header generation timestamp
  ['text-gray-300 text-[12px] ml-auto', 'text-gray-300 text-[10px] ml-auto'],
  // number badges  (w-7 12px -> w-6 10px)
  ['w-7 h-7 rounded-full bg-gray-900 text-white text-[12px] font-bold', 'w-6 h-6 rounded-full bg-gray-900 text-white text-[10px] font-bold'],
  ['w-7 h-7 rounded-full bg-gray-600 text-white text-[12px] font-bold', 'w-6 h-6 rounded-full bg-gray-600 text-white text-[10px] font-bold'],
  ['w-7 h-7 rounded-full bg-gray-400 text-white text-[12px] font-bold', 'w-6 h-6 rounded-full bg-gray-400 text-white text-[10px] font-bold'],
  // evidence pills  (12px -> 10px) for all tier color variants
  ['text-[12px] border border-gray-800 text-gray-800 px-1.5 py-0.5 rounded-full', 'text-[10px] border border-gray-800 text-gray-800 px-1.5 py-0.5 rounded-full'],
  ['text-[12px] border border-gray-400 text-gray-600 px-1.5 py-0.5 rounded-full', 'text-[10px] border border-gray-400 text-gray-600 px-1.5 py-0.5 rounded-full'],
  ['text-[12px] border border-gray-300 text-gray-400 px-1.5 py-0.5 rounded-full', 'text-[10px] border border-gray-300 text-gray-400 px-1.5 py-0.5 rounded-full'],
];

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

(async () => {
  const g = await (await fetch(API, { headers: H })).json();
  const sha = g.sha;
  let html = Buffer.from(g.content, 'base64').toString('utf8');

  // 1) section-scoped class normalization
  const secRx = /<!-- SECTION:\d{4}-\d{2}-\d{2} -->[\s\S]*?<!-- \/SECTION:\d{4}-\d{2}-\d{2} -->/g;
  html = html.replace(secRx, (block) => {
    let b = block;
    for (const [from, to] of REPL) b = b.split(from).join(to);
    return b;
  });

  // 2) rebuild cumulative journal table from canonical summary indices (document order)
  const entries = [];
  const secRx2 = /<!-- SECTION:(\d{4}-\d{2}-\d{2}) -->([\s\S]*?)<!-- \/SECTION:\1 -->/g;
  let m;
  while ((m = secRx2.exec(html)) !== null) {
    const date = m[1], shtml = m[2];
    const titles = [...shtml.matchAll(/class="text-xs font-medium text-gray-700 mt-1">[①②③④⑤] ([^<]+)<\/div>/g)].map(x => x[1]);
    const metas  = [...shtml.matchAll(/class="text-\[10px\] text-gray-400 pl-3">([^<]+)<\/div>/g)].map(x => x[1]);
    for (let i = 0; i < titles.length; i++) {
      const jp = metas[i] || '';
      const parts = jp.split('·').map(s => s.trim());
      const jrnl = parts[0] || '';
      const pub = parts[1] || '';
      let pmid = '';
      for (const p of parts) if (p.includes('PMID')) pmid = p.replace('PMID', '').trim();
      entries.push({ date, jrnl, pub, title: titles[i].trim(), pmid });
    }
  }
  let trows = '';
  for (const e of entries) {
    const short = e.title.length > 70 ? e.title.slice(0, 70) + '…' : e.title;
    const plink = e.pmid ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/" target="_blank" class="hover:underline hover:text-gray-900">${esc(short)}</a>` : esc(short);
    trows += `<tr class="border-t border-gray-100 hover:bg-gray-50"><td class="px-3 py-2 text-gray-400 whitespace-nowrap text-[10px]">${e.date}</td><td class="px-3 py-2 font-semibold text-gray-800 text-[11px]">${esc(e.jrnl)}</td><td class="px-3 py-2 text-gray-500 text-[10px] whitespace-nowrap">${esc(e.pub)}</td><td class="px-3 py-2 text-gray-600 text-[10px]">${plink}</td></tr>`;
  }
  const cnt = entries.length;
  const jtable = `<!-- JOURNAL_TABLE_START -->\n<div class="max-w-2xl mx-auto px-3 pb-8 mt-2"><div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"><div class="px-4 py-3.5 bg-gray-900 flex items-center gap-3"><h2 class="text-sm font-bold text-white tracking-wide">Curated Journal Archive</h2><span class="ml-auto text-xs text-gray-500 tabular-nums">${cnt} entries</span></div><div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="border-b border-gray-200"><th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-20">Date</th><th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-28">Journal</th><th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-20">Published</th><th class="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Article</th></tr></thead><tbody>${trows}</tbody></table></div></div></div>\n<!-- JOURNAL_TABLE_END -->`;
  html = html.replace(/<!-- JOURNAL_TABLE_START -->[\s\S]*?<!-- JOURNAL_TABLE_END -->/, jtable);

  // 3) stat counts
  const dc = (html.match(/<!-- SECTION:/g) || []).length;
  html = html.replace(/<div class="stat-days-count[^"]*">\d+<\/div>/, `<div class="stat-days-count text-3xl font-black tabular-nums">${dc}</div>`);
  html = html.replace(/<div class="stat-papers-count[^"]*">\d+<\/div>/, `<div class="stat-papers-count text-3xl font-black tabular-nums">${cnt}</div>`);

  // 4) push
  const body = JSON.stringify({ message: "Normalize all sections to canonical template + rebuild journal table", content: Buffer.from(html, 'utf8').toString('base64'), sha });
  const put = await (await fetch(API, { method: 'PUT', headers: H, body })).json();
  console.log('Pushed. Journal table entries: ' + cnt + ' / sections: ' + dc);
  console.log('Commit: ' + (put.commit ? put.commit.sha : JSON.stringify(put)));
})();
