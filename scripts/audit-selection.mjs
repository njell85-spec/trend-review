// Offline audit of retained public repository data; never fetches or calls an LLM.
// Usage: node scripts/audit-selection.mjs [baseline-ref] > audit.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { scoreGuideline } from '../src/utils/GuidelineScorer.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';
import { topicTermMatches } from '../src/utils/topicTerms.js';
import { rankedPublishableGuidelines } from '../src/utils/guidelineRank.js';
const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const read = f => JSON.parse(fs.readFileSync(f,'utf8'));
const count = xs => xs.reduce((a,x)=>(a[x??'unknown']=(a[x??'unknown']||0)+1,a),{});
const unique = xs => [...new Set(xs)];
const dates = xs => { const ds=xs.filter(Boolean).map(String).sort(); return {first:ds[0]??null,last:ds.at(-1)??null}; };
const dupes = xs => Object.entries(count(xs.filter(Boolean))).filter(([,n])=>n>1);
const papers=read('output/selected_papers.json');
const guidelines=read('output/selected_guidelines.json');
const reviews=read('output/queue_reviews.json');
const pq=read('output/queue_papers.json');
const archive=read('output/analysis_archive.json').entries;
const hidden=read('output/curation_state.json').hidden;
const census=read('experiments/guideline-census.json');
const interests=read('config/interests.json'), journals=read('config/journals.json');
const scorer=new MetadataScorer({profile:interests,journals,now:'2026-10-18'});
const orgs=loadGuidelineOrgs();
const tracks={papers, guidelines:guidelines.published,reviews:reviews.published};
const result={asOf:'2026-10-18',baseline:process.argv[2]??'f816ce2',
  limitations:['Selected ledger is not a complete historical candidate pool.',
    'Census replay uses the retained 2026-08-16 metadata snapshot, not contemporaneous full abstracts or clinical relevance labels.',
    'Title-only topics are proxies, not clinical adjudication. No population omission rate or treatment recommendation is estimated.'], tracks:{},pages:{}};
for(const [track,items]of Object.entries(tracks)) {
 const ids=items.map(x=>String(x.pmid||x.id||x.sourceId||''));
 result.tracks[track]={count:items.length,dates:dates(items.map(x=>x.date||x.publishedAt)),duplicates:dupes(ids),
   storedTopics:count(items.map(x=>x.topic)),
   titleOnlyTopics:count(items.map(x=>scorer.scoreOne({title:x.title}).primaryTopic)),
   metadataCoverage:{pubDate:items.filter(x=>x.pubDate).length,journal:items.filter(x=>x.journal).length,
     publicationTypes:items.filter(x=>x.publicationTypes?.length).length,abstract:items.filter(x=>x.abstract).length},
   selectionModes:count(items.map(x=>x.selectionMode)),lowConfidence:items.filter(x=>x.lowConfidence===true).length,
   monthly:count(items.map(x=>(x.date||x.publishedAt||'unknown').slice(0,7))),
   studyTypes:count(items.map(x=>x.publicationTypes?.length?scorer.scoreOne(x).studyType:'unknown')),
   sourceYears:count(items.map(x=>(x.pubDate??x.card?.paper?.pubDate)?.match(/\d{4}/)?.[0])),
   coverage:count(items.map(x=>x.card?.coverage)),
   llmFit:count(items.map(x=>x.llmFit?`${x.llmFit.keep}:${x.llmFit.score}`:'unknown'))};
}
for(const [track,file]of Object.entries({papers:'index.html',guidelines:'guidelines.html',reviews:'reviews.html'})) {
 const html=fs.readFileSync(file,'utf8');
 const rowIds=[...html.matchAll(/<tr\s+[^>]*data-pmid="([^"]+)"/g)].map(m=>m[1]);
 const cardCount=[...html.matchAll(/<article class="(?:paper|guideline)-card"/g)].length;
 const keys=[...html.matchAll(/<!-- ((?:G|R)?SECTION):([^>]+) -->/g)].map(m=>`${m[1]}:${m[2]}`);
 const cardIds=[...html.matchAll(/<!-- ((?:G|R)?SECTION):([^>]+) -->([\s\S]*?)<!-- \/\1:\2 -->/g)]
   .map(m=>m[3].match(/<div class="meta">([\s\S]*?)<\/div>/)?.[1]?.match(/PMID\s*(\d+)/)?.[1]
     ?? m[3].match(/data-guideline-id="([^"]+)"/)?.[1]
     ?? (m[2].includes('-m-') ? m[2].split('-m-').slice(1).join('-m-') : null)).filter(Boolean);
 const missing=tracks[track].filter(x=>!rowIds.includes(String(x.pmid||x.id||x.sourceId||''))).map(x=>{
   const id=String(x.pmid||x.id||x.sourceId||'');
   const tag={papers:'SECTION',guidelines:'GSECTION',reviews:'RSECTION'}[track];
   return {id,date:x.date||x.publishedAt,hidden:Object.values(hidden).some(h=>String(h.pmid)===id)
     || Boolean(hidden[`${tag}:${x.date||x.publishedAt}`])};
 });
 result.pages[track]={file,cardCount,tableRows:rowIds.length,duplicateRows:dupes(rowIds),duplicateSections:dupes(keys),
   orphanTableIds:rowIds.filter(id=>!cardIds.includes(id)),cardIdsWithoutTable:cardIds.filter(id=>!rowIds.includes(id)),
   sectionDates:dates(keys.map(k=>k.split(':')[1].slice(0,10))),missingFromTable:missing,
   emptyPubmedLinks:[...html.matchAll(/href="#"[^>]*>PubMed<\/a>/g)].length};
}
result.crossTrackDuplicates={papersGuidelines:papers.filter(p=>p.pmid&&guidelines.published.some(g=>g.pmid===p.pmid)).map(p=>p.pmid),
 papersReviews:papers.filter(p=>reviews.published.some(g=>g.pmid===p.pmid)).map(p=>p.pmid),
 guidelinesReviews:guidelines.published.filter(g=>g.pmid&&reviews.published.some(r=>r.pmid===g.pmid)).map(g=>g.pmid)};
result.paperQueue={count:pq.queue.length,lastRun:pq.lastRun,updatedAt:pq.updatedAt};
result.paperArchive={count:archive.length,dates:dates(archive.map(x=>x.date)),
 evidenceLevels:count(archive.map(x=>x.evidenceLevel)),journals:count(archive.map(x=>x.journal)),
 provenance:'Existing pipeline assessments, not an independent clinical evidence adjudication.'};
result.guidelineQueue={count:guidelines.queue.length,status:count(guidelines.queue.map(x=>x.status)),
 publishableAfterGuard:rankedPublishableGuidelines(guidelines.queue).length,
 staleQueuedNegativeFit:guidelines.queue.filter(x=>x.status==='queued'&&x.llmFit?.keep===false).map(x=>x.pmid),
 unpublishedWithoutFit:guidelines.queue.filter(x=>!x.llmFit).length,sourceHealth:guidelines.sourceHealth};
result.census={generatedAt:census.generatedAt,axes:Object.fromEntries(Object.entries(census.axes).map(([k,v])=>[k,{total:v.total,fetched:v.fetched,minDate:v.minDate,maxDate:v.maxDate}]))};
// Retrospective descriptive split of the same retained pool, not an isolated
// holdout or temporal validation. No complete historical pool or clinical labels.
const pool=[...new Map(Object.values(census.axes).flatMap(a=>a.items).map(x=>[String(x.pmid),{
 pmid:String(x.pmid),title:x.title,journal:x.journal,pubDate:x.date,publicationTypes:x.types??[]}])).values()];
const oldSource=execFileSync('git',['show',`${result.baseline}:src/utils/MetadataScorer.js`],{encoding:'utf8'});
const {MetadataScorer:OldScorer}=await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const old=new OldScorer({profile:interests,journals,now:'2026-10-18'});
const oldGSource=execFileSync('git',['show',`${result.baseline}:src/utils/GuidelineScorer.js`],{encoding:'utf8'})
 .replace("'./guidelineOrgs.js'",JSON.stringify(new URL('../src/utils/guidelineOrgs.js',import.meta.url).href));
const {scoreGuideline:oldG}=await import(`data:text/javascript;base64,${Buffer.from(oldGSource).toString('base64')}`);
result.replay={poolCount:pool.length,poolSha256:createHash('sha256').update(JSON.stringify(pool)).digest('hex'),
 split:'Retrospective: Number(PMID) % 5 === 0 -> pmid_subset; all others diagnostic; no learned weights',
 splitLimitations:['No evidence of preregistration or pre-analysis isolation.','Not temporal validation.','No complete historical candidate pool or independent clinical ground truth.'],partitions:{}};
for(const name of ['diagnostic','pmid_subset']) {
 const subset=pool.filter(x=>(Number(x.pmid)%5===0)===(name==='pmid_subset'));
 const scored=subset.map(p=>{
   const oldTopic=oldG(p,{orgs,interests}).breakdown.topic;
   const revised=scoreGuideline(p,{orgs,interests,now:'2026-10-18'});
   return {p,before:old.scoreOne(p),after:scorer.scoreOne(p),oldTopic,newTopic:revised.breakdown.topic,
     // Freeze the clock for both versions; topic matching is the only changed axis.
     guidelineBefore:revised.priority+orgs.policy.topicWeight*(oldTopic-revised.breakdown.topic),
     guidelineAfter:revised.priority};
 });
 const rank=key=>[...scored].sort((a,b)=>b[key].rawScore-a[key].rawScore||a.p.pmid.localeCompare(b.p.pmid)).slice(0,20).map(x=>x.p.pmid);
 const before=rank('before'), after=rank('after');
 const guidelineRank=key=>[...scored].sort((a,b)=>b[key]-a[key]||a.p.pmid.localeCompare(b.p.pmid)).slice(0,20).map(x=>x.p.pmid);
 const gb=guidelineRank('guidelineBefore'),ga=guidelineRank('guidelineAfter');
 const changes=scored.filter(x=>x.before.rawScore!==x.after.rawScore||x.oldTopic!==x.newTopic).map(x=>({
   pmid:x.p.pmid,title:x.p.title,before:x.before.rawScore,after:x.after.rawScore,
   guidelineTopicBefore:x.oldTopic,guidelineTopicAfter:x.newTopic,
   removedSubstringTerms:unique(Object.values(interests.topicGroups).flatMap(g=>g.terms).filter(t=>
      x.p.title.toLowerCase().includes(t)&&!topicTermMatches(x.p.title,t)))}));
 result.replay.partitions[name]={count:subset.length,changed:changes.length,top20Overlap:before.filter(x=>after.includes(x)).length,
   guidelineTop20Overlap:gb.filter(x=>ga.includes(x)).length,
   beforeTop20:before,afterTop20:after,changes};
}
console.log(JSON.stringify(result,null,2));
