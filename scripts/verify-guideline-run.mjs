import { readFile, writeFile } from 'node:fs/promises';
import { verifyGuidelineRun } from '../src/utils/guidelineManifest.js';

const statePath = process.argv[2] ?? 'output/selected_guidelines.json';
const htmlPath = process.argv[3] ?? 'guidelines.html';
const artifactPath = process.argv[4] ?? 'guideline-run-manifest.json';

let state = null;
let html = '';
try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch { /* verifier reports absence */ }
try { html = await readFile(htmlPath, 'utf8'); } catch { /* verifier reports missing cards */ }
const manifest = state?.lastRun?.manifest ?? null;
const result = verifyGuidelineRun({ state, html, manifest });
await writeFile(artifactPath, `${JSON.stringify({ runId: state?.lastRun?.runId ?? null, outcome: state?.lastRun?.outcome ?? null, manifest, verification: result }, null, 2)}\n`);
for (const item of result.findings) console.log(`::${item.severity === 'error' ? 'error' : 'warning'} title=Guideline ${item.code}::${item.detail}`);
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;
