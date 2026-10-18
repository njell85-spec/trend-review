import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { topicTermMatches } from '../src/utils/topicTerms.js';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { scoreGuideline } from '../src/utils/GuidelineScorer.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { emptyQueue, loadTrackQueue } from '../src/utils/trackQueue.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { rankedPublishableGuidelines } from '../src/utils/guidelineRank.js';

test('short topic abbreviations do not match words, including metadata', () => {
  for (const [word, token] of [['standards','ards'], ['towards','ards'], ['microscopy','rosc'], ['impaction','ipf']]) {
    assert.equal(topicTermMatches(word, token), false);
  }
  for (const text of ['ARDS', '(ARDS)', 'ARDS-related', 'COVID-19/ARDS']) assert.ok(topicTermMatches(text, 'ards'));
  assert.ok(topicTermMatches('haemodynamics', 'haemodynamic'), 'long configured stems remain supported');
  const s = new MetadataScorer();
  for (const p of [{ title: 'Standards for wellness' }, { title: '', abstract: 'Towards wellness', meshTerms: ['Standards'] }]) {
    assert.equal(s.scoreOne(p).contributions.relevance, 0);
  }
  const interests = JSON.parse(awaitReadInterests());
  assert.equal(scoreGuideline({title:'Standards for wellness'}, {orgs:loadGuidelineOrgs(), interests}).breakdown.topic, 0);
});

// Read once without a runtime service or LLM dependency.
import { readFileSync } from 'node:fs';
function awaitReadInterests() { return readFileSync(new URL('../config/interests.json', import.meta.url), 'utf8'); }

test('consumed candidates cannot exhaust monthly slots or the fourteen queue slots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-selection-audit-'));
  const file = path.join(dir, 'queue.json');
  const st = {...emptyQueue('papers'), published:[{pmid:'1'}], rejected:[{pmid:'2'}]};
  await writeFile(file, JSON.stringify(st));
  const o = new TrendReviewOrchestrator({outputDir:dir, queuePapersPath:file});
  const candidates = Array.from({length:30},(_,i)=>({pmid:String(i+1), title:'Sepsis', pubDate:new Date().toISOString().slice(0,10)}));
  o.filter.scorer.scorePapers = ps => ps.map(p=>({pmid:p.pmid, score:31-Number(p.pmid),rawScore:31-Number(p.pmid)}));
  o.filter.scorer.isExcludedJournal = () => false;
  o.collectionMode = 'monthly12'; o.monthlyConfig = {months:12, keepPerMonth:3};
  const excluded = candidates.slice(0,14).map(p=>p.pmid);
  assert.deepEqual(o._buildSelectionPool(candidates, {}, excluded).map(p=>p.pmid), ['15','16','17']);
  await o._saveTrack1Queue(candidates, '2026-10-18', excluded.slice(2));
  const saved = await loadTrackQueue(file, 'papers');
  assert.equal(saved.queue.length,14);
  assert.deepEqual(saved.queue.slice(0,2).map(p=>p.pmid),['15','16']);
});

test('a refill with no eligible candidates is not reported as success', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-empty-refill-'));
  const o = new TrendReviewOrchestrator({outputDir:dir,queuePapersPath:path.join(dir,'queue.json')});
  o._stageCollect = async()=>({papers:[{pmid:'1'}],stats:{}});
  o._stageValidate1 = async papers=>({papers});
  const result = await o._refillPaperQueue('2026-10-18',['1']);
  assert.equal(result.refilled,false);
  assert.equal(result.reason,'no-eligible-papers');
});

test('post-publication state commit includes the newly refilled queues', async () => {
  const workflow = await readFile(new URL('../.github/workflows/daily-review.yml',import.meta.url),'utf8');
  const commit = workflow.split('- name: Commit daily state')[1].split('- name:')[0];
  for(const file of ['queue_papers.json','queue_reviews.json']) assert.ok(commit.includes(`output/${file}`));
});

test('synthesis footer does not offer an empty PubMed target', () => {
  const pub = new GitHubPublisher();
  const html = pub._buildGuidelineCard({type:'synthesis',title:'Comparison',paper:{},documents:[]});
  assert.doesNotMatch(html,/href="#"[^>]*>PubMed<\/a>/);
  assert.match(html,/출처: 위 문헌별 링크/);
});

test('negative guideline fit cannot be published by stale queued status; human overrides survive', () => {
  const rejectedFit={id:'negative',status:'queued',priority:10,llmFit:{keep:false,score:2}};
  assert.deepEqual(rankedPublishableGuidelines([rejectedFit]),[]);
  const manual={...rejectedFit,id:'manual',promotedAt:'2026-10-18'};
  const approved={...rejectedFit,id:'approved',manualApproved:true};
  const unscored={id:'unscored',status:'queued',priority:4};
  const review={id:'review',status:'needsReview',priority:100};
  assert.deepEqual(new Set(rankedPublishableGuidelines([rejectedFit,manual,approved,unscored,review]).map(x=>x.id)),
    new Set(['manual','approved','unscored']));
  assert.equal(rejectedFit.status,'queued','do not rewrite the ledger');
});
