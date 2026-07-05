#!/usr/bin/env node
/**
 * preview.mjs — push 전 모바일 미리보기 (PeterJ는 모바일 전용 사용자)
 *
 * 1) index.html 을 폰(390px)·태블릿(800px)으로 **2배 해상도(레티나)** 스크린샷.
 *    세로가 길면 폰에서 확대해도 뭉개지지 않도록 **여러 조각으로 분할** 저장:
 *      → output/preview-phone-1.png, -2.png … / output/preview-tablet-1.png …
 *      (한 화면에 다 들어가면 인덱스 없이 output/preview-phone.png)
 *    ※ 긴 1장을 폰에서 클릭하면 다운스케일돼 글자가 깨지는 문제(PeterJ 피드백,
 *      2026-07-05)를 막기 위한 설계. 각 조각은 위아래 OVERLAP 만큼 겹쳐 경계
 *      내용이 잘리지 않는다.
 * 2) 카톡 메시지 "포맷" 미리보기 (REPORT_SPEC §2 5줄 구조·링크 위치 확인용 —
 *    상태파일 제목은 80자 절단·저널 미저장이라 실발송 텍스트·분할 건수와
 *    다를 수 있음. 출력에 경고를 함께 표시한다.)
 *
 * 사용: node scripts/preview.mjs   (어느 cwd에서 실행해도 저장소 루트 기준 동작)
 * 준비: playwright 미설치 시  npm i --no-save playwright
 *       브라우저 미설치 시(데스크탑)  npx playwright install chromium
 */
import { readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 조각 분할 파라미터 — SEG=조각당 CSS px 높이, OVERLAP=조각 경계 겹침(내용 안 잘림).
const SEG_PX = 1080;
const OVERLAP_PX = 40;
const SCALE = 2; // deviceScaleFactor — 폰에서 확대해도 선명하도록 2배 해상도

// 모든 경로를 저장소 루트에 고정 — cwd 의존 제거 (리뷰 확정 결함 반영).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('✖ playwright 미설치 — 먼저 실행: npm i --no-save playwright');
  process.exit(2);
}

mkdirSync('output', { recursive: true });

// 리모트 환경은 Chromium 프리설치(/opt/pw-browsers/chromium 심링크) — 있으면
// 그것을 쓰고(버전 불일치 회피), 없으면(데스크탑 등) playwright 기본 탐색.
// npm 설치만으로는 브라우저가 안 깔리므로 launch 실패를 반드시 안내한다.
const preinstalled = '/opt/pw-browsers/chromium';
let browser;
try {
  browser = existsSync(preinstalled)
    ? await chromium.launch({ executablePath: preinstalled })
    : await chromium.launch();
} catch (e) {
  console.error('✖ Chromium 실행 실패 — 브라우저 미설치로 보입니다.');
  console.error('  해결: npx playwright install chromium');
  console.error(`  (원인: ${String(e.message).split('\n')[0]})`);
  process.exit(2);
}

// 이전 실행의 조각 파일을 먼저 정리 — 이번에 더 짧아지면 옛 조각이 남아 오인된다.
for (const f of readdirSync('output')) {
  if (/^preview-(phone|tablet)(-\d+)?\.png$/.test(f)) {
    try { rmSync(path.join('output', f)); } catch { /* non-fatal */ }
  }
}

// 전체 높이를 뷰포트로 만든 뒤 clip 으로 조각을 잘라야 clip 이 항상 뷰포트 안에 든다.
async function shoot(name, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load' });
  const total = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width, height: total });
  await page.waitForTimeout(150); // 뷰포트 확대 후 레이아웃/폰트 안정화

  const saved = [];
  if (total <= SEG_PX) {
    const file = `output/preview-${name}.png`;
    await page.screenshot({ path: file });
    saved.push(file);
  } else {
    let i = 0, y = 0;
    while (y < total) {
      const top = y > 0 ? y - OVERLAP_PX : 0;
      const h = Math.min(SEG_PX + (y > 0 ? OVERLAP_PX : 0), total - top);
      const file = `output/preview-${name}-${++i}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: top, width, height: h } });
      saved.push(file);
      y += SEG_PX;
    }
  }
  await ctx.close();
  console.log(`✓ ${name} (${width}px @${SCALE}x) — ${saved.length}장: ${saved.map((f) => path.basename(f)).join(', ')}`);
}

try {
  await shoot('phone', 390);
  await shoot('tablet', 800);
} finally {
  await browser.close();
}

// ── 카톡 메시지 포맷 미리보기 (실패해도 스크린샷 산출물은 유효) ───────────────
try {
  const mod = await import(new URL('../src/agents/KakaoNotifier.js', import.meta.url));
  const KakaoNotifier = mod.KakaoNotifier ?? mod.default;
  const sel = JSON.parse(readFileSync('output/selected_papers.json', 'utf8'));
  const last = sel[sel.length - 1] ?? {};
  const msgs = KakaoNotifier.buildReportMessages({
    dateStr: last.date ?? 'YYYY-MM-DD',
    topPaper: { title_ko: last.title, paper: { title: last.title, journal: '(저널)', pmid: last.pmid } },
  });
  console.log('\n── 카톡 메시지 포맷 미리보기 (최근 선정 논문 기준) ──');
  msgs.forEach((m, i) => console.log(`[메시지 ${i + 1}/${msgs.length}]\n${m}\n`));
  console.log('※ 상태파일 기준(제목 80자 절단·저널 미저장) — 실발송의 한글 제목·저널·1/2건 분할 여부는 다를 수 있습니다. 5줄 구조·링크 위치 확인용입니다.');
} catch (e) {
  console.log(`(카톡 미리보기 건너뜀: ${e.message})`);
}
