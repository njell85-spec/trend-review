// Offline evidence inspection; no queue/HTML writes, network or LLM calls.
// node scripts/audit-selection-followup.mjs > followup-evidence.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lineageKeyOf, resolveSupersede } from '../src/utils/guidelineLineage.js';
import { filterByRegion } from '../src/utils/guidelineRegionFilter.js';
import { rankedPublishableReviews } from '../src/utils/reviewRank.js';
import { isTrustedSourceUrl } from '../src/utils/sourceTrust.js';
import { applyFitVerdicts } from '../src/utils/guidelineFit.js';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const baseline = '5dc5d166b9a45be9c2d0841913a53c8c9664aece';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const files = ['output/selected_papers.json', 'output/selected_guidelines.json', 'output/queue_reviews.json', 'experiments/guideline-census.json'];
const [papers, g, r, census] = files.map(read);
const orgs = read('config/guideline-orgs.json');
const count = xs => xs.reduce((a,x) => (a[x ?? 'unknown']=(a[x ?? 'unknown']??0)+1,a),{});
const brief = x => ({ id:x.id ?? x.pmid, title:x.title, status:x.status, pubDate:x.pubDate,
  publishedAt:x.publishedAt, topic:x.topic, fit:x.llmFit, supersedes:x.supersedes });
const oldSource = execFileSync('git',['show',`${baseline}:src/utils/guidelineLineage.js`],{encoding:'utf8'});
const old = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const ketamine = g.published.find(x => x.pmid === '39207913');
const oldKetamine = g.queue.find(x => x.pmid === '39198198');
const history = { queue:[oldKetamine], published:[] };
const stripTime = result => ({ ...result, transitions:result.transitions.map(({supersededAt,...x})=>x) });
const groups = new Map();
for (const item of [...g.queue,...g.published]) {
  const key=lineageKeyOf(item,{orgs}); groups.set(key,[...(groups.get(key)??[]),item]);
}
const padis=r.queue.find(x=>x.pmid==='39982143');
const ranked=rankedPublishableReviews(r.queue);
const summary={
  baseline, snapshotDate:'2026-10-18',
  limitations:['Current retained snapshot, not complete historical candidate pools.',
    'Stored topic tags and model coverage claims are not independent clinical adjudication.',
    'No holdout, clinical gold standard, population omission rate or new LLM ranking is claimed.',
    'Current filter replay does not establish the historical cause of an absent ledger entry.'],
  inputs:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),
  counts:{papers:papers.length,guidelines:g.published.length,reviews:r.published.length},
  topics:{papers:count(papers.map(x=>x.topic)),reviewsPublished:count(r.published.map(x=>x.topic)),
    reviewsNext20:count(ranked.slice(0,20).map(x=>x.topic))},
  rationale:{papersWithSelectionMode:papers.filter(x=>x.selectionMode).length,
    guidelinesWithFitReason:g.published.filter(x=>x.llmFit?.reason).length,
    reviewsWithFitReason:r.published.filter(x=>x.llmFit?.reason).length},
  coverage:{distribution:count(r.published.map(x=>x.card?.coverage)),
    inconsistentClaims:r.published.filter(x=>x.card?.coverage==='full-text'&&x.card?.fullTextSource==='abstract-only')
      .map(x=>({pmid:x.pmid,title:x.title,coverage:x.card.coverage,source:x.card.fullTextSource,
        untrustedWebHosts:(x.card.sources??[]).filter(s=>s.label?.startsWith('웹')&&!isTrustedSourceUrl(s.url)).map(s=>new URL(s.url).hostname)}))},
  lineage:{collisionGroups:[...groups].filter(([,v])=>v.length>1).map(([key,items])=>({key,ids:items.map(x=>x.id)})),
    ketamine:{prior:brief(oldKetamine),candidate:brief(ketamine),
      before:stripTime(old.resolveSupersede(history,ketamine,{orgs})),after:stripTime(resolveSupersede(history,ketamine,{orgs})),
      officialSource:'https://ssai.info/wp-content/uploads/acta-anaesthesiol-scand-2024-amer-ketamine-analgo-sedation-for-mechanically-ventilated-critically-ill-adults-a-rapid.pdf',
      sourceLocation:'Page 1 states co-publication in Acta Anaesthesiologica Scandinavica and Anesthesia & Analgesia.'},
    positiveFitGuard:applyFitVerdicts([{id:'example',status:'needsReview',lineageReview:true,lineageReason:'candidate-year-unknown'}],
      [{index:0,fit:9,keep:true,reason:'Relevant'}],{now:'2026-10-18T00:00:00Z'}).items[0]},
  priorityFollowup:{padis:{...brief(padis),reviewQueueRank:ranked.findIndex(x=>x.pmid===padis.pmid)+1,
    guidelineLedgerPresent:[...g.queue,...g.published,...g.rejected].some(x=>x.pmid===padis.pmid),
    censusAxes:Object.entries(census.axes).filter(([,v])=>v.items?.some(x=>x.pmid===padis.pmid)).map(([axis,v])=>({axis,minDate:v.minDate,maxDate:v.maxDate})),
    currentTitleOnlyRegionReplay:filterByRegion([padis]),
    officialSource:'https://www.sccm.org/clinical-resources/guidelines/guidelines/focused-update-padis-guideline'},
    nmbaFamily:g.published.filter(x=>['41773929','41773928'].includes(x.pmid)).map(brief),
    corticosteroids2024:{pmid:'38240492',anyLedgerPresent:[...papers,...g.queue,...g.published,...g.rejected,...r.queue,...r.published,...r.rejected].some(x=>x.pmid==='38240492'),
      officialSource:'https://www.sccm.org/clinical-resources/guidelines/guidelines/use-of-corticosteroids-in-sepsis-ards-cap',
      note:'Official publication January 2024, outside the current daily 30-day window and 2025-08-16 census guideline window; no omission rate inferred.'}},
};
console.log(JSON.stringify(summary,null,2));
