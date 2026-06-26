/**
 * One-shot: regenerate HTML from latest archive JSON using new ReportGeneratorAgent template.
 * Korean (_ko) fields will be absent in existing archive data,
 * so bilingual sections will show only English until next full run.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ReportGeneratorAgent } from './src/agents/ReportGeneratorAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, 'output', 'reports');

// Find latest archive JSON
const files = await readdir(reportsDir);
const archives = files
  .filter(f => f.startsWith('archive_') && f.endsWith('.json'))
  .sort()
  .reverse();

if (!archives.length) {
  console.error('No archive JSON found in', reportsDir);
  process.exit(1);
}

const latestArchive = archives[0];
const sessionId = latestArchive.replace('archive_', '').replace('.json', '') + '_preview';
console.log('Using archive:', latestArchive);

const raw = await readFile(path.join(reportsDir, latestArchive), 'utf8');
const data = JSON.parse(raw);

const agent = new ReportGeneratorAgent();
const htmlPath = await agent.saveHtmlDashboard(sessionId, data);
console.log('Generated:', htmlPath);

// Open in default browser
const { exec } = await import('child_process');
exec(`start "" "${htmlPath}"`);
