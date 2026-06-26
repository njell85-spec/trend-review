/**
 * Quick smoke test for FullTextAgent:
 * Manually injects known DOIs/PMCIDs for the 3 existing top papers
 * to verify PMC + Unpaywall routes work before the next full pipeline run.
 */
import 'dotenv/config';
import { FullTextAgent } from './src/agents/FullTextAgent.js';

// Known identifiers for the 3 top papers (JAMA Network Open papers are OA)
const mockPapers = [
  {
    pmid: '42228369',
    title: 'The Phoenix Criteria and Other Severity Scores in Identifying Pediatric Sepsis',
    pmcid: 'PMC13231296',
    doi: '10.1001/jamanetworkopen.2026.16305',
  },
  {
    pmid: '42223936',
    title: 'Multicenter Validation of Clinical Sepsis Phenotypes',
    pmcid: 'PMC13227316',
    doi: '10.1001/jamanetworkopen.2026.16134',
  },
  {
    pmid: '42230073',
    title: 'Management of Acute Hemorrhage and Damage-Control Resuscitation',
    pmcid: '',
    doi: '10.1016/j.tvir.2026.101114',
  },
];

const agent = new FullTextAgent();
const { papers, stats } = await agent.run(mockPapers);

console.log('\n=== Results ===');
for (const p of papers) {
  console.log(`\nPMID ${p.pmid}`);
  console.log(`  Source : ${p.fullTextSource}`);
  console.log(`  Length : ${p.fullTextLength ?? 0} chars`);
  console.log(`  Figures: ${p.figures?.length ?? 0}`);
  if (p.fullText) {
    console.log(`  Preview: ${p.fullText.slice(0, 200)}…`);
  }
}
console.log('\nStats:', stats);
