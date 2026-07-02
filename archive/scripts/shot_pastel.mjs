import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url'; import { mkdir } from 'fs/promises';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ids=['1','2','3','4'];
const shotDir=path.join(__dirname,'designs','pastel','shots'); await mkdir(shotDir,{recursive:true});
const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined});
const ctx=await b.newContext({viewport:{width:412,height:900},deviceScaleFactor:2}); const pg=await ctx.newPage();
for(const id of ids){ await pg.goto(pathToFileURL(path.join(__dirname,'designs','pastel',`pastel${id}.html`)).href,{waitUntil:'networkidle'}); await pg.waitForTimeout(200); await pg.screenshot({path:path.join(shotDir,`pastel${id}.png`),fullPage:true}); console.log('shot',id);}
await b.close();
