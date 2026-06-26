/**
 * Full-pipeline test: full-text enrichment → bilingual PICO → HTML
 * Uses existing archive's top 3 papers (skips PubMed re-fetch and re-scoring).
 */
import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { FullTextAgent } from './src/agents/FullTextAgent.js';
import { FilterAnalyzerAgent } from './src/agents/FilterAnalyzerAgent.js';
import { ReportGeneratorAgent } from './src/agents/ReportGeneratorAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, 'output', 'reports');

// Load latest archive
const files = await readdir(reportsDir);
const archives = files
  .filter(f => f.startsWith('archive_') && f.endsWith('.json') && !f.includes('preview') && !f.includes('test'))
  .sort().reverse();

if (!archives.length) { console.error('No archive found'); process.exit(1); }

console.log('📂 Archive:', archives[0]);
const data = JSON.parse(await readFile(path.join(reportsDir, archives[0]), 'utf8'));

// Patch papers with real DOI/PMCID (archive predates DataCollectorAgent update)
const ID_PATCH = {
  '42228369': { pmcid: 'PMC13231296', doi: '10.1001/jamanetworkopen.2026.16305' },
  '42223936': { pmcid: 'PMC13227316', doi: '10.1001/jamanetworkopen.2026.16134' },
  '42230073': { pmcid: '',            doi: '10.1016/j.tvir.2026.101114' },
};
const rawPapers = data.topPapers.map(tp => ({
  ...tp.paper,
  ...(ID_PATCH[tp.paper?.pmid] ?? {}),
}));

// Step 1: Full-text enrichment
console.log('\n🌐 Step 1: Fetching full text (PMC + Unpaywall)…');
const ftAgent = new FullTextAgent();
const { papers: enriched, stats: ftStats } = await ftAgent.run(rawPapers);
console.log(`   PMC: ${ftStats.pmc}  |  Unpaywall: ${ftStats.unpaywall}  |  Abstract-only: ${ftStats.abstractOnly}`);

// Step 2: Bilingual PICO with full text
// Clear pico_v2 cache so Claude re-analyzes with new full-text context
console.log('\n🤖 Step 2: PICO analysis (bilingual, full text included)…');
const filter = new FilterAnalyzerAgent({ topN: enriched.length });
const picoResults = await filter.analyzePico(enriched);

// Step 3: Generate HTML
console.log('\n📊 Step 3: Generating dashboard…');
const sessionId = `litreview_fulltext_test_${Date.now()}`;
const reporter = new ReportGeneratorAgent();
const htmlPath = await reporter.saveHtmlDashboard(sessionId, { ...data, topPapers: picoResults });

console.log('\n✅ Done!', htmlPath);
import('child_process').then(({ exec }) => exec(`start "" "${htmlPath}"`));
