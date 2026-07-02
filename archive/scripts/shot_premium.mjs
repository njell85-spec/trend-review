import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { mkdir } from 'fs/promises';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ids = ['A','B','C','D','E','F'];
const shotDir = path.join(__dirname,'designs','premium','shots');
await mkdir(shotDir,{recursive:true});
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport:{width:412,height:900}, deviceScaleFactor:2 });
const page = await ctx.newPage();
for (const id of ids){
  await page.goto(pathToFileURL(path.join(__dirname,'designs','premium',`premium${id}.html`)).href,{waitUntil:'networkidle'});
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shotDir,`premium${id}.png`), fullPage:true });
  console.log('shot',id);
}
await browser.close(); console.log('done');
