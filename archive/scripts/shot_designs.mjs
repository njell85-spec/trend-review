import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { mkdir } from 'fs/promises';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ids = ['01','02','03','04','05','06','07','08','09','10'];
const shotDir = path.join(__dirname, 'designs', 'shots');
await mkdir(shotDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

for (const id of ids) {
  const f = pathToFileURL(path.join(__dirname, 'designs', `design${id}.html`)).href;
  await page.goto(f, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const out = path.join(shotDir, `design${id}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log('shot', out);
}
await browser.close();
console.log('done');
