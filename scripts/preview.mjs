#!/usr/bin/env node
/**
 * preview.mjs — push 전 모바일 미리보기 (PeterJ는 모바일 전용 사용자)
 *
 * 1) index.html 을 폰(390px)·태블릿(800px) 뷰포트로 풀페이지 스크린샷
 *    → output/preview-phone.png, output/preview-tablet.png
 * 2) 카톡 메시지 "포맷" 미리보기 (REPORT_SPEC §2 5줄 구조·링크 위치 확인용 —
 *    상태파일 제목은 80자 절단·저널 미저장이라 실발송 텍스트·분할 건수와
 *    다를 수 있음. 출력에 경고를 함께 표시한다.)
 *
 * 사용: node scripts/preview.mjs   (어느 cwd에서 실행해도 저장소 루트 기준 동작)
 * 준비: playwright 미설치 시  npm i --no-save playwright
 *       브라우저 미설치 시(데스크탑)  npx playwright install chromium
 */
import { readFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

try {
  for (const [name, width] of [['phone', 390], ['tablet', 800]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + path.join(ROOT, 'index.html'), { waitUntil: 'load' });
    await page.screenshot({ path: `output/preview-${name}.png`, fullPage: true });
    console.log(`✓ output/preview-${name}.png (${width}px)`);
  }
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
