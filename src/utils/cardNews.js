/**
 * cardNews — 인스타 카드뉴스(1080×1350, 세로) 이미지 생성.
 * 영상 숏폼 스크립트(slides)를 재사용해 카드 HTML을 만들고 chromium으로 렌더한다.
 * 원문 그림 미사용·자체 디자인·검증 수치만(REPORT_SPEC §4-F 준수).
 * 표지(0번) + 본문(각 슬라이드) + 출처 카드 구성.
 */
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { esc } from './docBuilder.js';

const W = 1080, H = 1350;

/** 한 장의 카드 HTML — kind: 'cover' | 'body' | 'source' */
export function cardHtml({ kind, brand = 'Trend Review', heading, bullets = [], index, total, source, chartSvg = null }) {
  const badge = kind === 'cover'
    ? `<div style="font-size:30px;font-weight:800;color:#5b8fd9;letter-spacing:.08em">${esc(brand)} · EM/CCM</div>`
    : `<div style="display:flex;justify-content:space-between;font-size:26px;color:#94a3b8"><span style="font-weight:800;color:#5b8fd9">${esc(brand)}</span><span>${index}/${total}</span></div>`;
  const body = kind === 'source'
    ? `<div style="font-size:38px;line-height:1.6;color:#334155">${(bullets).map((b) => `<div style="margin:16px 0">${esc(b)}</div>`).join('')}</div>`
    : `<ul style="font-size:${kind === 'cover' ? 46 : 42}px;line-height:1.55;color:#334155;padding-left:1.1em;margin:0">${bullets.map((b) => `<li style="margin:18px 0">${esc(b)}</li>`).join('')}</ul>`;
  const headingSize = kind === 'cover' ? 74 : 58;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:${W}px;height:${H}px;box-sizing:border-box;padding:88px 72px;
       background:linear-gradient(160deg,#e9f2fd,#ffffff);
       font-family:"Noto Sans KR","Apple SD Gothic Neo",sans-serif;
       display:flex;flex-direction:column;gap:36px}
  h1{font-size:${headingSize}px;line-height:1.28;margin:0;color:#1e293b;font-weight:800}
  .chart svg{width:100%;height:auto;border-radius:20px;box-shadow:0 8px 30px rgba(91,143,217,.2)}
  .foot{margin-top:auto;font-size:24px;color:#94a3b8}
  </style></head><body>
  ${badge}
  ${heading ? `<h1>${esc(heading)}</h1>` : ''}
  ${chartSvg ? `<div class="chart">${chartSvg}</div>` : ''}
  ${body}
  ${source ? `<div class="foot">${esc(source)}</div>` : ''}
  </body></html>`;
}

const CARD_TEXT = {
  en: { cover: ['Daily EM/CCM paper review', 'Verified figures only'], disclaimer: 'Not medical advice — for education.' },
  ko: { cover: ['EM/CCM 데일리 논문 리뷰', '검증된 수치만 사용'], disclaimer: '의학적 조언 아님 — 교육용.' },
};

/** 숏폼 스크립트 → 카드 정의 배열 (표지 + 본문 슬라이드 + 출처). 보일러플레이트는 언어별. */
export function cardsFromScript(script, { title, pmid, lang = 'en' }) {
  const t = CARD_TEXT[lang] ?? CARD_TEXT.en;
  const slides = script.slides ?? [];
  const cards = [];
  cards.push({ kind: 'cover', heading: title, bullets: t.cover });
  slides.forEach((s) => cards.push({
    kind: 'body', heading: s.heading, bullets: s.bullets ?? [], useChart: s.useChart,
  }));
  cards.push({ kind: 'source', bullets: [`PubMed: pubmed.ncbi.nlm.nih.gov/${pmid}/`, t.disclaimer] });
  return cards;
}

/** 카드 배열 → PNG 파일 배열 (chromium, 재사용 브라우저 옵션) */
export async function renderCards(cards, { outDir, chartSvg = null, browser = null }) {
  let own = null;
  if (!browser) {
    let chromium;
    try { ({ chromium } = await import('playwright')); }
    catch { throw new Error('playwright 미설치 — npm i --no-save playwright'); }
    const pre = '/opt/pw-browsers/chromium';
    own = existsSync(pre) ? await chromium.launch({ executablePath: pre }) : await chromium.launch();
    browser = own;
  }
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await mkdir(outDir, { recursive: true });
    const files = [];
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const html = cardHtml({
        ...c, index: i, total: cards.length,
        chartSvg: c.useChart ? chartSvg : null,
      });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const f = path.join(outDir, `card-${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    return files;
  } finally {
    if (own) await own.close();
  }
}
