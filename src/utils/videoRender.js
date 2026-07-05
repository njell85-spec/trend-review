/**
 * videoRender — 슬라이드 HTML 템플릿(Sky 파스텔), chromium 스크린샷, SRT 생성,
 * ffmpeg 합성(자막 번인). 순수부(slideHtml·buildSrt·cuesFromNarration)는 단위 테스트 대상.
 * 자막은 captions API 대신 번인 — youtube.force-ssl 스코프 회피(REPORT_SPEC §4-F).
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { esc } from './docBuilder.js';

const run = promisify(execFile);
const SIZE = { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 } };

export function slideHtml(slide, { orientation, chartSvg = null, brand = 'Trend Review' } = {}) {
  const { w, h } = SIZE[orientation];
  const portrait = orientation === 'portrait';
  const bullets = (slide.bullets ?? []).map((b) => `<li>${esc(b)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:${w}px;height:${h}px;background:linear-gradient(160deg,#e9f2fd,#ffffff);
       font-family:"Noto Sans KR","Apple SD Gothic Neo",sans-serif;color:#334155;display:flex;flex-direction:column;
       padding:${portrait ? '120px 72px' : '96px 120px'};box-sizing:border-box}
  .brand{font-size:${portrait ? 34 : 28}px;font-weight:700;color:#5b8fd9;letter-spacing:.06em}
  h1{font-size:${portrait ? 66 : 64}px;line-height:1.25;margin:28px 0;color:#1e293b}
  ul{font-size:${portrait ? 44 : 40}px;line-height:1.6;padding-left:1.1em;margin:0}
  li{margin:14px 0}
  .chart{margin-top:36px}
  .chart svg{width:100%;height:auto;box-shadow:0 6px 24px rgba(91,143,217,.18);border-radius:16px}
  </style></head><body>
  <div class="brand">${esc(brand)}</div><h1>${esc(slide.heading)}</h1><ul>${bullets}</ul>
  ${slide.useChart && chartSvg ? `<div class="chart">${chartSvg}</div>` : ''}
  </body></html>`;
}

export async function renderSlidePngs(slides, { orientation, chartSvg, outDir }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('playwright 미설치 — npm i --no-save playwright 후 재시도');
  }
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser = existsSync(preinstalled)
    ? await chromium.launch({ executablePath: preinstalled })
    : await chromium.launch();
  try {
    const { w, h } = SIZE[orientation];
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await mkdir(outDir, { recursive: true });
    const files = [];
    for (let i = 0; i < slides.length; i++) {
      await page.setContent(slideHtml(slides[i], { orientation, chartSvg }), { waitUntil: 'networkidle' });
      const f = path.join(outDir, `slide-${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    return files;
  } finally {
    await browser.close();
  }
}

const ts = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

export const buildSrt = (cues) =>
  cues.map((c, i) => `${i + 1}\n${ts(c.startSec)} --> ${ts(c.endSec)}\n${c.text}\n`).join('\n');

/** 슬라이드별 내레이션·실측 길이 → 문장 단위 자막 큐(글자수 비례 배분, 슬라이드 경계 보존) */
export function cuesFromNarration(narration, durations) {
  const cues = [];
  let base = 0;
  narration.forEach((text, i) => {
    const sentences = String(text).split(/(?<=[.!?。])\s+|(?<=다\.)\s*/).map((s) => s.trim()).filter(Boolean);
    const total = sentences.reduce((s, x) => s + x.length, 0) || 1;
    let t = base;
    for (const s of sentences) {
      const d = (s.length / total) * durations[i];
      cues.push({ startSec: t, endSec: Math.min(t + d, base + durations[i]), text: s });
      t += d;
    }
    base += durations[i];
  });
  return cues;
}

export async function probeDurationSec(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const n = Number(stdout.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`ffprobe 길이 측정 실패: ${file}`);
  return n;
}

/** 슬라이드 PNG + 슬라이드별 mp3 → 자막 번인 mp4 (concat demuxer 2트랙) */
export async function assembleVideo({ pngs, mp3s, durations, srtPath, outPath }) {
  const dir = path.dirname(outPath);
  await mkdir(dir, { recursive: true });
  const vlist = pngs.map((f, i) => `file '${f}'\nduration ${durations[i].toFixed(3)}`).join('\n')
    + `\nfile '${pngs.at(-1)}'`; // concat demuxer 규칙: 마지막 프레임 한 번 더
  const alist = mp3s.map((f) => `file '${f}'`).join('\n');
  const vPath = path.join(dir, 'v.txt');
  const aPath = path.join(dir, 'a.txt');
  await writeFile(vPath, vlist);
  await writeFile(aPath, alist);
  await run('ffmpeg', ['-y',
    '-f', 'concat', '-safe', '0', '-i', vPath,
    '-f', 'concat', '-safe', '0', '-i', aPath,
    '-vf', `subtitles=${srtPath}:force_style='FontSize=18,Outline=1',format=yuv420p`,
    '-c:v', 'libx264', '-r', '30', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
    outPath,
  ], { maxBuffer: 32 * 1024 * 1024 });
}
