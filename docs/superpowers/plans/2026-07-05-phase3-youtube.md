# Phase 3 — YouTube 영상 (ChartRenderer + VideoAgent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 리포트에서 중간폼(3~5분 1920×1080)·숏폼(≤60초 1080×1920) × 한국어·영어 = 4편을 생성해 전용 채널에 비공개 업로드한다.

**Architecture:** `VideoAgent`가 리포트 JSON → (B1) LLM 1회 호출로 4종 스크립트 생성 → (B2) HTML 슬라이드를 chromium으로 렌더 → (B3) Cloud TTS 슬라이드별 합성 → (B4) 자막 타이밍 계산 → (B5) ffmpeg 합성(자막 번인) → (B6) googleapis로 업로드 → (B7) `output/video_log.json` 상태 기록. Phase 2의 `googleAuth`(이미 `youtube.upload` 스코프 포함)를 재사용한다.

**Tech Stack:** Node 20 ESM · googleapis · Google Cloud TTS REST(API 키) · playwright(chromium) · ffmpeg/ffprobe(러너 기본) · node:test

## Global Constraints (스펙 §0·§5·§8에서 발췌)

- 스크립트의 모든 수치는 리포트 값 그대로 — **새 수치 생성 금지** 규칙을 프롬프트에 명시(문구 고정, spec-lint가 존재 확인).
- 논문 원문 그림·표 이미지 미사용. 슬라이드는 전부 자체 제작(ChartRenderer 재구성 차트 포함) + 출처 표기.
- 업로드는 `privacyStatus: 'private'` 고정. 제목·설명에 PubMed·DOI·대시보드 링크.
- 숏폼 내레이션 목표 50초(상한 60초) — 스크립트 생성 프롬프트에 단어 수 제한 명시.
- 한국어판: 한국어 내레이션·한국어 자막(의학용어는 영어 표기 허용). 영어판: 영어 내레이션·영어 자막.
- **스펙과 다른 구현 결정 1건(승인 필요)**: 자막은 captions API 대신 **영상에 번인(ffmpeg subtitles 필터)**.
  이유: `captions.insert`는 `youtube.force-ssl` 스코프가 추가로 필요 → 최소 권한 원칙 위배 + 쿼터 절약.
  SRT 파일은 `output/`에 생성해 두므로 추후 캡션 업로드로 전환 가능.
- 소프트 실패: 4편 중 일부 실패해도 나머지는 진행, 코어·Phase 2에 영향 없음.
- 시크릿 로그 노출 금지 · LLM 출력 HTML 이스케이프 · KST 날짜 · 재실행 시 중복 업로드 금지.

## 파일 구조

| 경로 | 역할 |
|---|---|
| `src/utils/ChartRenderer.js` (신규) | 검증 수치 JSON → SVG 차트 (순수) |
| `src/utils/videoScript.js` (신규) | 스크립트 생성 프롬프트·툴 스키마·검증 (순수부 분리) |
| `src/utils/tts.js` (신규) | Cloud TTS REST 어댑터 (문단→mp3 buffer) |
| `src/utils/videoRender.js` (신규) | 슬라이드 HTML 템플릿·스크린샷·SRT·ffmpeg 합성 |
| `src/agents/VideoAgent.js` (신규) | B1~B7 오케스트레이션 + YouTube 업로드 + video_log |
| `scripts/video-sample.mjs` (신규) | 업로드 없이 샘플 mp4 생성 (승인 게이트용) |
| `test/chartRenderer.test.mjs` `test/videoScript.test.mjs` `test/srt.test.mjs` (신규) | 단위 테스트 |
| `github-actions-daily.mjs` `.github/workflows/daily-review.yml` (수정) | Phase 3 블록 + chromium 설치·캐시 + env |
| `REPORT_SPEC.md` `scripts/spec-lint.mjs` (수정) | 4-F 조항 + 린트 |

---

### Task 1: ChartRenderer — 재구성 차트 SVG (순수)

**Files:**
- Create: `src/utils/ChartRenderer.js`, `test/chartRenderer.test.mjs`

**Interfaces:**
- Produces: `renderComparisonChart({ title, unit, groups: [{label, value, ci?: [lo, hi]}], source }) → string(SVG)`,
  `chartFromAnalysis(analysis, lang) → {svg, caption} | null` — keyFindings에서 구조화 수치를 찾지 못하면 **null(차트 생략)**.
- 색: 대시보드 팔레트 고정 `#5b8fd9`(1군) `#5fb3a0`(2군) `#334155`(텍스트).

- [ ] **Step 1: 실패 테스트 작성**

```js
// test/chartRenderer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComparisonChart, chartFromAnalysis } from '../src/utils/ChartRenderer.js';

test('두 군 비교 막대 SVG — 값·라벨·출처 포함, 값에 비례한 막대', () => {
  const svg = renderComparisonChart({
    title: '28-day mortality', unit: '%',
    groups: [{ label: 'Intervention', value: 21.3 }, { label: 'Control', value: 27.9 }],
    source: 'PMID 12345',
  });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('21.3') && svg.includes('27.9') && svg.includes('PMID 12345'));
  const widths = [...svg.matchAll(/data-bar width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 2);
  assert.ok(widths[0] < widths[1]); // 21.3 < 27.9 비례
});

test('라벨의 특수문자는 이스케이프된다', () => {
  const svg = renderComparisonChart({ title: 'a<b', unit: '%', groups: [{ label: 'x&y', value: 1 }], source: 's' });
  assert.ok(!svg.includes('a<b') && svg.includes('a&lt;b') && svg.includes('x&amp;y'));
});

test('구조화 수치가 없으면 chartFromAnalysis는 null (억지 차트 금지)', () => {
  assert.equal(chartFromAnalysis({ chartData: null }, 'ko'), null);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` Expected: FAIL
- [ ] **Step 3: 구현**

```js
// src/utils/ChartRenderer.js
/** 검증된 수치만 그린다 — 입력 chartData는 VideoAgent가 리포트 수치에서 추출(생성 금지). */
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
    const ci = g.ci
      ? `<line x1="${PAD + LABEL_W + (g.ci[0] / max) * plotW}" x2="${PAD + LABEL_W + (g.ci[1] / max) * plotW}" y1="${y + BAR_H / 2}" y2="${y + BAR_H / 2}" stroke="#334155" stroke-width="3"/>`
      : '';
    return `<text x="${PAD}" y="${y + BAR_H / 2 + 8}" font-size="26" fill="#334155">${esc(g.label)}</text>
<rect data-bar width="${w.toFixed(1)}" x="${PAD + LABEL_W}" y="${y}" height="${BAR_H}" rx="8" fill="${COLORS[i % 2]}"/>
${ci}<text x="${PAD + LABEL_W + w + 14}" y="${y + BAR_H / 2 + 9}" font-size="28" font-weight="700" fill="#334155">${esc(String(g.value))}${esc(unit ?? '')}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" font-family="sans-serif">
<rect width="${W}" height="${h}" fill="#ffffff" rx="16"/>
<text x="${PAD}" y="${PAD + 10}" font-size="32" font-weight="700" fill="#3f72bf">${esc(title)}</text>
${bars}
<text x="${PAD}" y="${h - 16}" font-size="20" fill="#94a3b8">${esc(source)}</text></svg>`;
}

/** VideoAgent가 만든 chartData({title,title_ko,unit,groups,source})를 언어에 맞춰 렌더 */
export function chartFromAnalysis(analysis, lang) {
  const d = analysis.chartData;
  if (!d || !Array.isArray(d.groups) || d.groups.length < 2) return null;
  const title = lang === 'ko' ? (d.title_ko || d.title) : d.title;
  return { svg: renderComparisonChart({ ...d, title }), caption: title };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(phase3): ChartRenderer — 검증 수치 재구성 SVG"`

---

### Task 2: videoScript — 프롬프트·툴 스키마·검증 (B1 순수부)

**Files:**
- Create: `src/utils/videoScript.js`, `test/videoScript.test.mjs`

**Interfaces:**
- Produces: `VIDEO_SCRIPT_TOOL`(tool 스키마), `buildScriptMessages(analysis) → messages[]`,
  `validateScripts(raw) → {midform:{ko,en}, short:{ko,en}, chartData}` (형식 위반 시 throw).
- 스크립트 형태: `{slides: [{heading, bullets: string[], useChart: boolean}], narration: string[]}` — narration[i]가 slides[i]의 내레이션. 숏폼은 slides 3장 고정.
- Consumes(Task 4에서): `LLMClient.callWithTool(messages, tool, {maxTokens})` — `src/utils/LLMClient.js:64` 기존 시그니처.

- [ ] **Step 1: 실패 테스트 작성**

```js
// test/videoScript.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScriptMessages, validateScripts, VIDEO_SCRIPT_TOOL } from '../src/utils/videoScript.js';

test('프롬프트에 수치 생성 금지 규칙과 리포트 수치가 들어간다', () => {
  const msgs = buildScriptMessages({
    title_ko: '제목', keyFindings: ['mortality 21.3% vs 27.9%'], keyFindings_ko: ['사망률 21.3% vs 27.9%'],
    clinicalQuestion_ko: 'Q', pico: {}, pico_ko: {}, evidenceLevel: '1b',
    paper: { title: 'T', journal: 'NEJM', pmid: '1' },
  });
  const text = msgs.map((m) => m.content).join(' ');
  assert.ok(text.includes('절대 새로운 수치를 만들지 마라'));
  assert.ok(text.includes('21.3%'));
});

test('validateScripts — 숏폼 3장·중간폼 5~8장 아니면 throw', () => {
  const slide = { heading: 'h', bullets: ['b'], useChart: false };
  const ok = {
    midform: { ko: { slides: Array(6).fill(slide), narration: Array(6).fill('n') },
               en: { slides: Array(6).fill(slide), narration: Array(6).fill('n') } },
    short:   { ko: { slides: Array(3).fill(slide), narration: Array(3).fill('n') },
               en: { slides: Array(3).fill(slide), narration: Array(3).fill('n') } },
    chartData: null,
  };
  assert.deepEqual(validateScripts(ok), ok);
  const bad = structuredClone(ok); bad.short.ko.slides = Array(5).fill(slide);
  assert.throws(() => validateScripts(bad), /short.*3/);
  const bad2 = structuredClone(ok); bad2.midform.ko.narration = ['n']; // slides와 길이 불일치
  assert.throws(() => validateScripts(bad2), /narration/);
});

test('툴 스키마에 4종 키가 모두 required', () => {
  assert.deepEqual(VIDEO_SCRIPT_TOOL.input_schema.required.sort(), ['chartData', 'midform', 'short'].sort());
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` Expected: FAIL
- [ ] **Step 3: 구현**

```js
// src/utils/videoScript.js
/** B1 — 영상 스크립트 생성의 순수부. LLM 호출은 VideoAgent가 담당. */
const slideSchema = {
  type: 'object',
  properties: {
    slides: { type: 'array', items: { type: 'object', properties: {
      heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } },
      useChart: { type: 'boolean' } }, required: ['heading', 'bullets', 'useChart'] } },
    narration: { type: 'array', items: { type: 'string' } },
  },
  required: ['slides', 'narration'],
};
const langPair = { type: 'object', properties: { ko: slideSchema, en: slideSchema }, required: ['ko', 'en'] };

export const VIDEO_SCRIPT_TOOL = {
  name: 'submit_video_scripts',
  description: 'Daily paper-review video scripts (midform + short, ko + en).',
  input_schema: {
    type: 'object',
    properties: {
      midform: langPair,
      short: langPair,
      chartData: { type: ['object', 'null'], properties: {
        title: { type: 'string' }, title_ko: { type: 'string' }, unit: { type: 'string' },
        groups: { type: 'array', items: { type: 'object', properties: {
          label: { type: 'string' }, value: { type: 'number' },
          ci: { type: ['array', 'null'], items: { type: 'number' } } }, required: ['label', 'value'] } },
        source: { type: 'string' } } },
    },
    required: ['midform', 'short', 'chartData'],
  },
};

export function buildScriptMessages(a) {
  const p = a.paper ?? {};
  const facts = JSON.stringify({
    title: p.title, title_ko: a.title_ko, journal: p.journal, pmid: p.pmid,
    clinicalQuestion_ko: a.clinicalQuestion_ko, pico: a.pico, pico_ko: a.pico_ko,
    keyFindings: a.keyFindings, keyFindings_ko: a.keyFindings_ko, evidenceLevel: a.evidenceLevel,
  });
  return [{
    role: 'user',
    content: `너는 응급의학·중환자의학 논문 리뷰 영상의 대본 작가다. 아래 검증된 리포트 데이터만으로
중간폼(가로, 슬라이드 6~8장, 내레이션 총 550~750단어)과 숏폼(세로, 정확히 3장: 훅→핵심 결과→임상 한 줄,
내레이션 총 110~130단어 = 발화 약 50초)의 한국어판·영어판 대본을 만들어라.

규칙:
1. **절대 새로운 수치를 만들지 마라** — 아래 데이터에 명시된 수치만 사용한다. 수치가 없으면 정성적으로 서술한다.
2. 한국어판: 자연스러운 존댓말 내레이션, 의학용어·약어·트라이얼명은 영어 유지 가능.
3. slides[i]와 narration[i]는 1:1 대응. 핵심 결과 슬라이드 1곳에만 useChart=true (chartData를 만들 수 없으면 모두 false).
4. chartData: keyFindings에 두 군 비교 수치(예: 사망률 A% vs B%)가 명시돼 있을 때만 채운다.
   불명확하면 null — 추정 금지. source는 "PMID ${p.pmid}".
5. 마지막 슬라이드 bullets에 "PubMed: https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" 출처 포함.

리포트 데이터:
${facts}

submit_video_scripts 툴로 제출하라.`,
  }];
}

export function validateScripts(raw) {
  const need = (v, path) => { if (!v) throw new Error(`missing ${path}`); return v; };
  for (const form of ['midform', 'short']) {
    for (const lang of ['ko', 'en']) {
      const s = need(raw?.[form]?.[lang], `${form}.${lang}`);
      const n = s.slides?.length ?? 0;
      if (form === 'short' && n !== 3) throw new Error(`short.${lang}: slides must be 3, got ${n}`);
      if (form === 'midform' && (n < 5 || n > 8)) throw new Error(`midform.${lang}: slides must be 5~8, got ${n}`);
      if (s.narration?.length !== n) throw new Error(`${form}.${lang}: narration length must match slides`);
    }
  }
  return { midform: raw.midform, short: raw.short, chartData: raw.chartData ?? null };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(phase3): 영상 스크립트 프롬프트·스키마·검증 (수치 생성 금지)"`

---

### Task 3: videoRender — 슬라이드 템플릿·SRT·ffmpeg (B2·B4·B5)

**Files:**
- Create: `src/utils/videoRender.js`, `test/srt.test.mjs`

**Interfaces:**
- Produces: `slideHtml(slide, {orientation, chartSvg, brand}) → string`,
  `renderSlidePngs(slides, {orientation, chartSvg, outDir}) → Promise<string[]>` (playwright),
  `buildSrt(cues: [{startSec, endSec, text}]) → string` (순수),
  `cuesFromNarration(narration: string[], durations: number[]) → cues` (순수 — 슬라이드별 문장 단위, 글자수 비례 배분),
  `assembleVideo({pngs, mp3s, durations, srtPath, outPath, orientation}) → Promise<void>` (ffmpeg 실행),
  `probeDurationSec(file) → Promise<number>` (ffprobe).

- [ ] **Step 1: 순수부 실패 테스트 작성**

```js
// test/srt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSrt, cuesFromNarration } from '../src/utils/videoRender.js';

test('buildSrt — 표준 SRT 포맷 (HH:MM:SS,mmm)', () => {
  const srt = buildSrt([{ startSec: 0, endSec: 2.5, text: '안녕하세요' }]);
  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:02,500\n안녕하세요'));
});

test('cuesFromNarration — 슬라이드 경계 유지 + 문장별 글자수 비례 배분', () => {
  const cues = cuesFromNarration(['첫 문장. 둘째 문장이 더 깁니다.', '다음 슬라이드.'], [10, 5]);
  assert.equal(cues.at(-1).endSec, 15);              // 총 길이 보존
  assert.ok(cues[0].endSec < cues[1].endSec);        // 순차
  assert.ok(cues[1].endSec <= 10.01);                // 슬라이드1 안에서 끝남
  assert.ok(cues.at(-1).startSec >= 10);             // 슬라이드2는 10초 이후
  assert.ok(cues[0].endSec - cues[0].startSec < cues[1].endSec - cues[1].startSec); // 짧은 문장이 짧게
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` Expected: FAIL
- [ ] **Step 3: 구현** — 핵심 코드:

```js
// src/utils/videoRender.js
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
  const bullets = (slide.bullets ?? []).map((b) => `<li>${esc(b)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:${w}px;height:${h}px;background:linear-gradient(160deg,#e9f2fd,#ffffff);
       font-family:"Noto Sans KR","Apple SD Gothic Neo",sans-serif;color:#334155;display:flex;flex-direction:column;
       padding:${orientation === 'portrait' ? '120px 72px' : '96px 120px'};box-sizing:border-box}
  .brand{font-size:${orientation === 'portrait' ? 34 : 28}px;font-weight:700;color:#5b8fd9;letter-spacing:.06em}
  h1{font-size:${orientation === 'portrait' ? 66 : 64}px;line-height:1.25;margin:28px 0;color:#1e293b}
  ul{font-size:${orientation === 'portrait' ? 44 : 40}px;line-height:1.6;padding-left:1.1em}
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
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('playwright 미설치 — npm i --no-save playwright'); }
  const pre = '/opt/pw-browsers/chromium';
  const browser = existsSync(pre) ? await chromium.launch({ executablePath: pre }) : await chromium.launch();
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
  await browser.close();
  return files;
}

const ts = (sec) => {
  const ms = Math.round(sec * 1000);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
export const buildSrt = (cues) =>
  cues.map((c, i) => `${i + 1}\n${ts(c.startSec)} --> ${ts(c.endSec)}\n${c.text}\n`).join('\n');

export function cuesFromNarration(narration, durations) {
  const cues = [];
  let base = 0;
  narration.forEach((text, i) => {
    const sentences = String(text).split(/(?<=[.!?。])\s+|(?<=다\.)\s+/).filter(Boolean);
    const total = sentences.reduce((s, x) => s + x.length, 0) || 1;
    let t = base;
    for (const s of sentences) {
      const d = (s.length / total) * durations[i];
      cues.push({ startSec: t, endSec: Math.min(t + d, base + durations[i]), text: s.trim() });
      t += d;
    }
    base += durations[i];
  });
  return cues;
}

export async function probeDurationSec(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

/** 슬라이드 PNG + 슬라이드별 mp3 → 자막 번인 mp4 */
export async function assembleVideo({ pngs, mp3s, durations, srtPath, outPath }) {
  const dir = path.dirname(outPath);
  await mkdir(dir, { recursive: true });
  const vlist = pngs.map((f, i) => `file '${f}'\nduration ${durations[i].toFixed(3)}`).join('\n') + `\nfile '${pngs.at(-1)}'`;
  const alist = mp3s.map((f) => `file '${f}'`).join('\n');
  const vPath = path.join(dir, 'v.txt'), aPath = path.join(dir, 'a.txt');
  await writeFile(vPath, vlist); await writeFile(aPath, alist);
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', vPath, '-f', 'concat', '-safe', '0', '-i', aPath,
    '-vf', `subtitles=${srtPath}:force_style='FontSize=18,Outline=1',format=yuv420p`,
    '-c:v', 'libx264', '-r', '30', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outPath]);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS (srt 2건 포함)
- [ ] **Step 5: Commit** — `git commit -am "feat(phase3): 슬라이드 템플릿·SRT·ffmpeg 합성 유틸"`

---

### Task 4: tts.js + VideoAgent 본체 (B1·B3·B6·B7)

**Files:**
- Create: `src/utils/tts.js`, `src/agents/VideoAgent.js`

**Interfaces:**
- Consumes: `LLMClient.callWithTool`, Task 1~3 전부, `getGoogleAuth`(Phase 2 plan Task 1).
- Produces: `class VideoAgent { async run({ analysis, todayKST, pagesUrl, upload = true }) → { ok, videos: [{form, lang, videoId|file, error?}] } }`
- 상태: `output/video_log.json` = `{ "PMID_form_lang": videoId }` — ArchiveAgent와 동일하게 contents API로 자체 커밋(공용 함수로 추출 가능하면 `src/utils/repoCommit.js`로 빼서 둘 다 사용).

- [ ] **Step 1: tts.js 구현**

```js
// src/utils/tts.js — Google Cloud TTS REST (API 키). 키는 로그 금지.
const VOICES = { ko: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C' }, en: { languageCode: 'en-US', name: 'en-US-Neural2-D' } };

export async function synthesizeMp3(text, lang) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('GOOGLE_TTS_API_KEY 미설정');
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: VOICES[lang], audioConfig: { audioEncoding: 'MP3', speakingRate: 1.06 } }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`); // 응답 본문은 로그 금지(키 에코 방지)
  return Buffer.from((await res.json()).audioContent, 'base64');
}
```

- [ ] **Step 2: VideoAgent 구현** — 흐름(전체 코드 작성):

```js
// src/agents/VideoAgent.js — 핵심 흐름 (구현 시 이 구조 그대로)
import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { google } from 'googleapis';
import { createReadStream } from 'fs';
import { Logger } from '../utils/Logger.js';
import { LLMClient } from '../utils/LLMClient.js';
import { getGoogleAuth } from '../utils/googleAuth.js';
import { VIDEO_SCRIPT_TOOL, buildScriptMessages, validateScripts } from '../utils/videoScript.js';
import { chartFromAnalysis } from '../utils/ChartRenderer.js';
import { renderSlidePngs, cuesFromNarration, buildSrt, assembleVideo, probeDurationSec } from '../utils/videoRender.js';
import { synthesizeMp3 } from '../utils/tts.js';

const FORMS = [
  { form: 'midform', orientation: 'landscape' },
  { form: 'short', orientation: 'portrait' },
];

export class VideoAgent {
  constructor() { this.logger = new Logger('VideoAgent', { logFile: 'video_agent.jsonl' }); }

  async run({ analysis, todayKST, pagesUrl, upload = true }) {
    // B1 — 스크립트 4종 (LLM 1회)
    const llm = new LLMClient({});
    const raw = await llm.callWithTool(buildScriptMessages(analysis), VIDEO_SCRIPT_TOOL, { maxTokens: 8192 });
    const scripts = validateScripts(raw);
    const enriched = { ...analysis, chartData: scripts.chartData };

    const results = [];
    for (const { form, orientation } of FORMS) {
      for (const lang of ['ko', 'en']) {
        try {
          const file = await this._produce({ enriched, scripts: scripts[form][lang], form, lang, orientation, todayKST });
          const videoId = upload ? await this._upload({ file, analysis: enriched, form, lang, todayKST, pagesUrl }) : null;
          results.push({ form, lang, videoId, file });
        } catch (e) {
          this.logger.warn(`${form}/${lang} 실패(계속): ${e.message}`);
          results.push({ form, lang, error: e.message });
        }
      }
    }
    return { ok: results.some((r) => !r.error), videos: results };
  }

  async _produce({ enriched, scripts, form, lang, orientation, todayKST }) {
    const work = path.join(process.cwd(), 'output', 'video', `${todayKST}-${form}-${lang}`);
    await mkdir(work, { recursive: true });
    const chart = chartFromAnalysis(enriched, lang);
    const pngs = await renderSlidePngs(scripts.slides, { orientation, chartSvg: chart?.svg ?? null, outDir: work });
    const mp3s = [], durations = [];
    for (let i = 0; i < scripts.narration.length; i++) {
      const f = path.join(work, `n-${i}.mp3`);
      await writeFile(f, await synthesizeMp3(scripts.narration[i], lang));
      mp3s.push(f); durations.push(await probeDurationSec(f));
    }
    if (form === 'short') {
      const total = durations.reduce((a, b) => a + b, 0);
      if (total > 60) throw new Error(`숏폼 ${total.toFixed(1)}s > 60s — 대본 축약 필요`);
    }
    const srtPath = path.join(work, 'subs.srt');
    await writeFile(srtPath, buildSrt(cuesFromNarration(scripts.narration, durations)));
    const outPath = path.join(work, 'video.mp4');
    await assembleVideo({ pngs, mp3s, durations, srtPath, outPath });
    return outPath;
  }

  async _upload({ file, analysis, form, lang, todayKST, pagesUrl }) {
    const key = `${analysis.pmid}_${form}_${lang}`;
    const log = await this._loadLog();
    if (log[key]) { this.logger.info(`이미 업로드됨: ${key}`); return log[key]; }
    const auth = await getGoogleAuth({ logger: this.logger });
    if (!auth) throw new Error('google-auth-unset');
    const yt = google.youtube({ version: 'v3', auth });
    const p = analysis.paper ?? {};
    const title = (lang === 'ko'
      ? `[EM/CCM ${form === 'short' ? 'Shorts' : '리뷰'}] ${analysis.title_ko || p.title}`
      : `[EM/CCM ${form === 'short' ? 'Shorts' : 'Review'}] ${p.title}`).slice(0, 95) + ` (${todayKST})`;
    const description = [
      lang === 'ko' ? '오늘의 논문 리뷰 — 검증된 수치만 사용합니다.' : 'Daily paper review — verified figures only.',
      `PubMed: https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`,
      p.doi ? `DOI: https://doi.org/${p.doi}` : null,
      `Dashboard: ${pagesUrl}`,
    ].filter(Boolean).join('\n');
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: { snippet: { title, description, categoryId: '27' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } },
      media: { body: createReadStream(file) },
    });
    log[key] = res.data.id;
    await this._saveLog(log); // Phase 2와 동일한 contents API 커밋 유틸 재사용
    this.logger.info(`업로드 완료: ${form}/${lang}`);
    return res.data.id;
  }
  // _loadLog/_saveLog: output/video_log.json 읽기·쓰기 + repoCommit('output/video_log.json') — ArchiveAgent._commitArchiveToRepo를 src/utils/repoCommit.js: commitFileToRepo(relPath, message)로 일반화해 공유한다.
}
```

- [ ] **Step 3: 리팩터** — `ArchiveAgent._commitArchiveToRepo`를 `src/utils/repoCommit.js`의 `commitFileToRepo(relPath, message)`로 추출, 두 에이전트가 공유. 기존 Phase 2 테스트 회귀 확인.
- [ ] **Step 4: 문법·단위 확인** — Run: `node --check src/agents/VideoAgent.js src/utils/tts.js && npm run test:unit` Expected: 통과
- [ ] **Step 5: Commit** — `git commit -am "feat(phase3): VideoAgent — 스크립트→TTS→합성→업로드 + video_log"`

---

### Task 5: 샘플 생성 스크립트 (승인 게이트, 업로드 없음)

**Files:**
- Create: `scripts/video-sample.mjs`

- [ ] **Step 1: 구현**

```js
#!/usr/bin/env node
// scripts/video-sample.mjs — 최신 아카이브 항목으로 4편(또는 --form/--lang 지정)을
// 업로드 없이 생성한다. 산출물: output/video/<날짜-form-lang>/video.mp4
// PeterJ 승인 게이트: 이 파일을 모바일에서 시청 가능하게 전달 → 승인 후 데일리 편입.
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { VideoAgent } from '../src/agents/VideoAgent.js';
import { kstDateStr } from '../src/utils/dates.js';

const archive = JSON.parse(await readFile('output/analysis_archive.json', 'utf8'));
const entry = archive.entries.at(-1);
if (!entry) { console.error('analysis_archive.json에 항목이 없습니다 — Phase 2를 먼저 가동하세요.'); process.exit(1); }
// 아카이브 항목을 VideoAgent 입력 형태로 복원
const analysis = { ...entry, paper: { title: entry.title, journal: entry.journal, pmid: entry.pmid, doi: entry.doi } };
const r = await new VideoAgent().run({ analysis, todayKST: kstDateStr(), pagesUrl: 'https://njell85-spec.github.io/trend-review/', upload: false });
console.log(JSON.stringify(r.videos.map(({ form, lang, file, error }) => ({ form, lang, file, error })), null, 2));
```

- [ ] **Step 2: 확인** — Run: `node --check scripts/video-sample.mjs` Expected: 통과
- [ ] **Step 3: Commit** — `git commit -am "feat(phase3): 샘플 영상 생성 스크립트 (승인 게이트용)"`

---

### Task 6: 데일리 편입 + 워크플로우 (chromium 캐시·env)

**Files:**
- Modify: `github-actions-daily.mjs` (Phase 2 블록 뒤), `.github/workflows/daily-review.yml`

- [ ] **Step 1: 진입점 블록** — Phase 2 블록 아래:

```js
// ── Phase 3: 영상 4편 제작·업로드 (소프트 실패) ─────────────────────────────
let videoStatus = '미설정';
try {
  const { VideoAgent } = await import('./src/agents/VideoAgent.js');
  const r = await new VideoAgent().run({ analysis: papers[0], todayKST, pagesUrl });
  const okCnt = r.videos.filter((v) => v.videoId).length;
  videoStatus = `${okCnt}/4 업로드`;
  if (okCnt < 4) console.log(`::warning::영상 일부 실패 — ${r.videos.filter((v) => v.error).map((v) => `${v.form}/${v.lang}`).join(', ')}`);
} catch (err) {
  videoStatus = `실패: ${err.message.slice(0, 120)}`;
  console.log(`::warning::Phase 3 영상 실패 — ${err.message.slice(0, 200)}`);
}
```

jobSummary에 `` `- 영상: ${videoStatus}`, `` 추가.

- [ ] **Step 2: 워크플로우** — `Install dependencies` 뒤에 추가:

```yaml
      - name: Cache Playwright chromium
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-chromium-${{ runner.os }}
      - name: Install Playwright chromium
        run: npm i --no-save playwright && npx playwright install chromium --with-deps
```

`Run daily review pipeline` env에 `GOOGLE_TTS_API_KEY: ${{ secrets.GOOGLE_TTS_API_KEY }}` 추가.

- [ ] **Step 3: 확인** — Run: `node --check github-actions-daily.mjs && npm run test:unit && npm run spec-lint` Expected: 통과
- [ ] **Step 4: Commit** — `git commit -am "feat(phase3): 데일리 편입 + chromium 캐시 + TTS env"`

---

### Task 7: REPORT_SPEC 4-F + spec-lint 확장

**Files:**
- Modify: `REPORT_SPEC.md`, `scripts/spec-lint.mjs`

- [ ] **Step 1: 4-F 조항** — 내용: 일 4편(중간폼·숏폼 × ko·en), 숏폼 ≤60초, 비공개 고정, 스크립트 수치는 리포트 값만(새 수치 생성 금지), 원문 그림 미사용·자체 슬라이드·출처 표기, 자막 번인(+SRT 보존), `output/video_log.json` 상태 파일, Secrets(`GOOGLE_TTS_API_KEY`), 소프트 실패. 변경 이력 한 줄.
- [ ] **Step 2: spec-lint 확장** — ① `src/utils/videoScript.js`에 문자열 `절대 새로운 수치를 만들지 마라` 존재 확인, ② `VideoAgent.js`에 `privacyStatus: 'private'` 존재 확인, ③ `output/video_log.json` gitignore 회귀 검사 추가.
- [ ] **Step 3: 확인** — Run: `npm run spec-lint` Expected: 통과 (프롬프트 문구를 일부러 바꿔 FAIL 확인 후 원복)
- [ ] **Step 4: Commit** — `git commit -am "docs(phase3): REPORT_SPEC 4-F + spec-lint (수치 금지·비공개 게이트)"`

---

### Task 8: 통합 검증 (샘플 승인 → 실업로드)

- [ ] 데스크탑 데이 이후: `node scripts/video-sample.mjs` (또는 Actions 임시 잡)로 **한국어 중간폼·숏폼 샘플 생성**
- [ ] 샘플을 PeterJ가 모바일에서 시청 → 톤·속도·슬라이드 밀도 피드백 반영 (프롬프트·템플릿 튜닝 반복)
- [ ] **한국어판 승인 후** 영어판 샘플 확인 → 승인
- [ ] `workflow_dispatch` 실행 → 채널에 4편 비공개 업로드 + 자막 표시 확인
- [ ] 같은 워크플로우 재실행 → `video_log.json` 덕에 중복 업로드 없음 확인
- [ ] 증거(영상 링크·job summary)를 기록하고 7일 무개입 관찰 시작

## Self-Review 결과

- 스펙 §5.1(규격)=Task 2·3, §5.2 B1~B7=Task 2·3·4, 승인 게이트·롤아웃=Task 5·8, 편입·chromium=Task 6, §8 게이트=Task 7 — 커버 확인.
- 스펙과 다른 결정 1건(자막 번인)은 Global Constraints에 사유와 함께 명시 — PeterJ 승인 항목.
- 시그니처 정합: `chartFromAnalysis`(T1)↔`VideoAgent`(T4), `validateScripts`(T2)↔T4, `renderSlidePngs`/`cuesFromNarration`/`assembleVideo`(T3)↔T4, `commitFileToRepo` 공용화(T4 Step 3)가 Phase 2 plan Task 4와 연결됨을 명시.
- placeholder 없음 (모든 코드 스텝에 실제 코드 포함).
