/**
 * ChartRenderer — 검증된 수치만 그린다 (재구성 기본 경로).
 * 입력 chartData는 VideoAgent의 스크립트 생성 단계가 리포트 수치에서 추출한 값
 * (LLM이 수치를 새로 만들지 않도록 프롬프트로 강제 — REPORT_SPEC §4-F).
 * 수치가 불충분하면 차트를 만들지 않는다(null) — 억지 시각화 금지.
 * 색은 대시보드 Sky 파스텔 팔레트 고정.
 */
import { esc } from './docBuilder.js';

const COLORS = ['#5b8fd9', '#5fb3a0'];
const W = 960, BAR_H = 64, GAP = 28, PAD = 48, LABEL_W = 240;

export function renderComparisonChart({ title, unit, groups, source }) {
  const max = Math.max(...groups.map((g) => g.value)) * 1.15 || 1;
  const plotW = W - PAD * 2 - LABEL_W - 90;
  const h = PAD * 2 + 72 + groups.length * (BAR_H + GAP);
  const bars = groups.map((g, i) => {
    const y = PAD + 72 + i * (BAR_H + GAP);
    const w = Math.max(2, (g.value / max) * plotW);
    const ci = Array.isArray(g.ci) && g.ci.length === 2
      ? `<line x1="${(PAD + LABEL_W + (g.ci[0] / max) * plotW).toFixed(1)}" x2="${(PAD + LABEL_W + (g.ci[1] / max) * plotW).toFixed(1)}" y1="${y + BAR_H / 2}" y2="${y + BAR_H / 2}" stroke="#334155" stroke-width="3"/>`
      : '';
    return `<text x="${PAD}" y="${y + BAR_H / 2 + 8}" font-size="26" fill="#334155">${esc(g.label)}</text>
<rect data-bar width="${w.toFixed(1)}" x="${PAD + LABEL_W}" y="${y}" height="${BAR_H}" rx="8" fill="${COLORS[i % 2]}"/>
${ci}<text x="${(PAD + LABEL_W + w + 14).toFixed(1)}" y="${y + BAR_H / 2 + 9}" font-size="28" font-weight="700" fill="#334155">${esc(String(g.value))}${esc(unit ?? '')}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">
<rect width="${W}" height="${h}" fill="#ffffff" rx="16"/>
<text x="${PAD}" y="${PAD + 10}" font-size="32" font-weight="700" fill="#3f72bf">${esc(title)}</text>
${bars}
<text x="${PAD}" y="${h - 16}" font-size="20" fill="#94a3b8">${esc(source)}</text></svg>`;
}

/** 스크립트 생성 산출 chartData({title,title_ko,unit,groups,source})를 언어에 맞춰 렌더 */
export function chartFromAnalysis(analysis, lang) {
  const d = analysis?.chartData;
  if (!d || !Array.isArray(d.groups) || d.groups.length < 2) return null;
  const title = lang === 'ko' ? (d.title_ko || d.title) : d.title;
  return { svg: renderComparisonChart({ ...d, title }), caption: title };
}
