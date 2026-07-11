# 트랙 비교 실험 (Arm1 vs Arm2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로덕션 데일리(Arm1)의 오늘 픽을 재사용하고, Opus가 웹서치로 스스로 고른 논문(Arm2)을 동일 PICO로 분석해, 2주간 매일 GitHub Pages 별도 URL에 나란히 누적하는 무인 비교 실험을 만든다.

**Architecture:** 프로덕션 파이프라인과 완전히 격리된 별도 워크플로우(`compare-tracks.yml`)가 데일리 커밋 이후 실행된다. `src/experiments/`의 순수 함수(키워드·프롬프트·검증·레코드·렌더)를 얇은 오케스트레이터(`runOnce`)가 조립하고, `scripts/compare-tracks.mjs`가 env·파일 IO·git push를 담당한다. 기존 `DataCollectorAgent.fetchArticles`(PMID 검증)와 `FilterAnalyzerAgent._analyzeSinglePaper`(동일 PICO)를 수정 없이 재사용한다.

**Tech Stack:** Node.js ESM, `node --test`(node:test + node:assert/strict), GitHub Actions, claude CLI(구독)+웹서치, PubMed E-utilities.

## Global Constraints

- **데일리 코어 무접촉(제1 불변식)**: 프로덕션 파이프라인 코드·`index.html`·`output/` 상태 파일을 바꾸지 않는다. 실험은 `output/analysis_archive.json`을 **읽기만** 하고, 커밋 대상은 `experiments/` 폴더뿐이다.
- **소프트 실패**: Arm2 선정/검증/분석 실패는 그날 `arm2=null`로 기록하고 계속. 절대 크래시·프로덕션 접촉 없음.
- **테스트는 오프라인**: LLM·웹·PubMed 호출은 전부 목(mock). 라이브 호출 테스트 금지.
- **ESM only**: 모든 파일 `import`/`export`. 프로젝트 `package.json`은 `"type": "module"`.
- **테스트 러너**: `npm run test:unit` = `node --test test/*.test.mjs`. 각 테스트 파일은 `import { test } from 'node:test'; import assert from 'node:assert/strict';`.
- **KST 기준**: 날짜는 `src/utils/dates.js`의 `kstDateStr()`(→'YYYY-MM-DD') 사용.
- **커밋 서명 불가 환경**: 커밋은 되지만 GitHub에서 Unverified 표시(표시상 문제, 무시). 커밋터 이메일은 `noreply@anthropic.com` 유지.
- **게시 URL**: `https://njell85-spec.github.io/trend-review/experiments/compare.html`.
- **게이트/기간**: `vars.ENABLE_TRACK_COMPARE`(기본 미설정=off, 'true'여야 실행), `vars.TRACK_COMPARE_END`(KST 종료일).

## 재사용 인터페이스 (기존 코드, 수정 금지)

- `src/utils/dates.js` → `kstDateStr(d = new Date())` : 'YYYY-MM-DD'.
- `src/agents/DataCollectorAgent.js` → `new DataCollectorAgent()`; `async fetchArticles(pmids: string[])` → `Array<{pmid,title,abstract,authors,journal,pubDate,publicationTypes,meshTerms,keywords,doi,pmcid,pubmedUrl,collectedAt}>` (빈 배열이면 미존재).
- `src/agents/FilterAnalyzerAgent.js` → `new FilterAnalyzerAgent()`; `async _analyzeSinglePaper(paper)` → 전체 PICO 분석 객체 `{pmid,title_ko,clinicalQuestion,clinicalQuestion_ko,pico,pico_ko,baseline,secondaryOutcomes,statGlossary,keyFindings,keyFindings_ko,clinicalTakeaway,limitations,practiceChange,evidenceLevel,clinicalApplicabilityScore, paper, evidenceSource, sources}`.
- `src/utils/LLMClient.js` → `new LLMClient({ provider:'anthropic', model })`; `async callWithTool(messages, tool, { maxTokens, webSearch })` → 파싱된 툴 입력 JSON. 시스템 프롬프트(의료 리뷰 컨텍스트)는 LLMClient 내부에 이미 적용됨.
- `config/interests.json` → `{ topicGroups: { <key>: { label, weight, terms:[] } }, ... }`.
- `output/analysis_archive.json` → `{ entries: Array<{date,pmid,title,title_ko,journal,doi,badge,clinicalQuestion_ko,pico,pico_ko,keyFindings,keyFindings_ko,evidenceLevel,references,...}>, driveState }`.

## File Structure

- Create `src/experiments/trackCompare.js` — 순수 함수 + `runOnce` 오케스트레이터.
- Create `src/experiments/compareRender.js` — `renderComparisonHtml` (HTML 문자열).
- Create `scripts/compare-tracks.mjs` — 진입점(env·파일 IO·git push).
- Create `.github/workflows/compare-tracks.yml` — 크론 워크플로우.
- Create `test/trackCompare.test.mjs` — 순수 함수 + runOnce(목) 테스트.
- Create `test/compareRender.test.mjs` — 렌더 스모크 테스트.
- Runtime 산출(코드 PR에는 미포함, 워크플로우가 생성): `experiments/track-comparison.json`, `experiments/arm2-history.json`, `experiments/compare.html`.

---

### Task 1: 관심 키워드 추출 (pure)

**Files:**
- Create: `src/experiments/trackCompare.js`
- Test: `test/trackCompare.test.mjs`

**Interfaces:**
- Produces: `extractInterestKeywords(profile?) → string` — interests.json의 topicGroups 라벨+대표 용어를 Arm2 프롬프트용 한 줄 힌트로 요약. 기본 인자는 `config/interests.json`을 읽어 사용.

- [ ] **Step 1: Write the failing test**

```javascript
// test/trackCompare.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInterestKeywords } from '../src/experiments/trackCompare.js';

test('extractInterestKeywords: 라벨과 대표 용어를 포함한 문자열', () => {
  const profile = {
    topicGroups: {
      cardiac_resus: { label: '심혈관·소생', weight: 1.0, terms: ['cardiac arrest', 'resuscitation', 'ecmo', 'stemi', 'cpr'] },
      sepsis_shock: { label: '패혈증·쇼크', weight: 1.0, terms: ['sepsis', 'septic shock', 'vasopressor'] },
    },
  };
  const out = extractInterestKeywords(profile);
  assert.match(out, /cardiac arrest/);
  assert.match(out, /sepsis/);
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 10);
});

test('extractInterestKeywords: 인자 없으면 config/interests.json 사용', () => {
  const out = extractInterestKeywords();
  assert.match(out, /sepsis|cardiac|resuscitation/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trackCompare.test.mjs`
Expected: FAIL — "Cannot find module '../src/experiments/trackCompare.js'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/trackCompare.js
import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';

function _defaultProfile() {
  try {
    const url = new URL('../../config/interests.json', import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch { return { topicGroups: {} }; }
}

// interests.json → Arm2 프롬프트용 한 줄 관심 힌트.
// 그룹별로 "라벨: term1, term2, term3(대표 3개)" 를 '; '로 잇는다.
export function extractInterestKeywords(profile = _defaultProfile()) {
  const groups = Object.values(profile.topicGroups ?? {});
  const parts = groups.map((g) => {
    const terms = (g.terms ?? []).slice(0, 3).join(', ');
    return `${g.label ?? ''}: ${terms}`.trim();
  }).filter((s) => s.length > 1);
  return parts.join('; ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/trackCompare.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/trackCompare.js test/trackCompare.test.mjs
git commit -m "feat(experiment): Arm2 관심 키워드 추출(interests.json)"
```

---

### Task 2: Arm2 선정 프롬프트 + 픽 툴 스키마 (pure)

**Files:**
- Modify: `src/experiments/trackCompare.js`
- Test: `test/trackCompare.test.mjs`

**Interfaces:**
- Produces:
  - `ARM2_PICK_TOOL` — `{ name:'submit_track_pick', input_schema }`, required `['pmid','title','journal','whyChosen']`.
  - `buildArm2SelectPrompt({ sinceDate, keywords, excludePmids }) → string` — 유저 프롬프트. 6개월 창(sinceDate 이후)·관심 힌트·제외 PMID·PMID 검증 가드 포함.

- [ ] **Step 1: Write the failing test**

```javascript
// test/trackCompare.test.mjs  (append)
import { buildArm2SelectPrompt, ARM2_PICK_TOOL } from '../src/experiments/trackCompare.js';

test('ARM2_PICK_TOOL: 필수 필드 스키마', () => {
  assert.equal(ARM2_PICK_TOOL.name, 'submit_track_pick');
  assert.deepEqual(ARM2_PICK_TOOL.input_schema.required, ['pmid', 'title', 'journal', 'whyChosen']);
});

test('buildArm2SelectPrompt: 창 날짜·관심·제외·가드 포함', () => {
  const p = buildArm2SelectPrompt({
    sinceDate: '2026-01-11',
    keywords: '패혈증: sepsis, septic shock',
    excludePmids: ['111', '222'],
  });
  assert.match(p, /2026-01-11/);          // 6개월 창
  assert.match(p, /sepsis/);               // 관심 힌트
  assert.match(p, /111/);                  // 제외 목록
  assert.match(p, /222/);
  assert.match(p, /PubMed/i);              // 실재 PMID 가드
  assert.match(p, /ONE/);                  // 정확히 1편
});

test('buildArm2SelectPrompt: 제외 없으면 안내 문구', () => {
  const p = buildArm2SelectPrompt({ sinceDate: '2026-01-11', keywords: 'x', excludePmids: [] });
  assert.match(p, /None/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trackCompare.test.mjs`
Expected: FAIL — `buildArm2SelectPrompt`/`ARM2_PICK_TOOL` 미정의.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/trackCompare.js  (append)

export const ARM2_PICK_TOOL = {
  name: 'submit_track_pick',
  description: 'Submit the single chosen EM/CCM paper for today.',
  input_schema: {
    type: 'object',
    properties: {
      pmid: { type: 'string', description: 'Real PubMed ID (digits only) that you verified exists via web search. Never invent it.' },
      doi: { type: 'string', description: 'DOI if known, else empty string.' },
      title: { type: 'string' },
      journal: { type: 'string' },
      pubDate: { type: 'string', description: 'Publication year-month, e.g. "2026-05".' },
      whyChosen: { type: 'string', description: 'One or two sentences on why this has the highest clinical bedside utility.' },
    },
    required: ['pmid', 'title', 'journal', 'whyChosen'],
  },
};

// Arm2 유저 프롬프트. 시스템(의료 리뷰 컨텍스트)은 LLMClient 내부 적용.
export function buildArm2SelectPrompt({ sinceDate, keywords, excludePmids = [] }) {
  const exclude = excludePmids.length ? excludePmids.join(', ') : 'None';
  return `You are an expert emergency medicine and critical care (EM/CCM) physician.
Using web search, find exactly ONE peer-reviewed primary research paper published on or after ${sinceDate} (last 6 months) in a NOTABLE EM/CCM journal, with the HIGHEST clinical bedside utility for an acute/critical-care physician.

Interest areas to weigh (hints, not hard filters): ${keywords}.

Prefer studies that directly change acute bedside management (diagnosis, drug, procedure, resuscitation target). Avoid pure epidemiology, health-services, interhospital-transfer, remote-monitoring, quality-improvement, narrative reviews, case reports, and protocols unless clearly practice-changing.

Do NOT choose any of these already-selected PMIDs: ${exclude}.

Return your single choice via the submit_track_pick tool. The PMID MUST be a real PubMed identifier you verified via search — do not invent it. Prefer including the DOI and the publication year-month.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/trackCompare.test.mjs`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/trackCompare.js test/trackCompare.test.mjs
git commit -m "feat(experiment): Arm2 선정 프롬프트 + 픽 툴 스키마"
```

---

### Task 3: 픽 검증 (PMID 실재 + 6개월 창)

**Files:**
- Modify: `src/experiments/trackCompare.js`
- Test: `test/trackCompare.test.mjs`

**Interfaces:**
- Produces:
  - `parseYearMonth(s) → Date|null` — 'YYYY-MM'/'YYYY/MM'/'YYYY-MM-DD' 파싱(월 1일 UTC).
  - `verifyPick(pick, { fetchArticles, sinceDate }) → Promise<{ ok, paper, reason }>` — `fetchArticles(pmids)`는 주입(빈 배열=미존재). pmid 없음/미존재/창밖이면 `ok:false`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/trackCompare.test.mjs  (append)
import { parseYearMonth, verifyPick } from '../src/experiments/trackCompare.js';

test('parseYearMonth: 다양한 포맷', () => {
  assert.equal(parseYearMonth('2026-05').getUTCFullYear(), 2026);
  assert.equal(parseYearMonth('2026/05').getUTCMonth(), 4);
  assert.equal(parseYearMonth('2026-05-20').getUTCMonth(), 4);
  assert.equal(parseYearMonth('garbage'), null);
});

const paper = (over = {}) => ({ pmid: '900', title: 'T', journal: 'NEJM', pubDate: '2026-05', abstract: 'a', authors: [], meshTerms: [], keywords: [], doi: '', ...over });

test('verifyPick: 정상 → ok, paper 반환', async () => {
  const v = await verifyPick({ pmid: '900' }, {
    fetchArticles: async (ids) => [paper({ pmid: ids[0] })],
    sinceDate: '2026-01-01',
  });
  assert.equal(v.ok, true);
  assert.equal(v.paper.pmid, '900');
});

test('verifyPick: pmid 없음 → ok:false', async () => {
  const v = await verifyPick({ pmid: '' }, { fetchArticles: async () => [], sinceDate: '2026-01-01' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /pmid/i);
});

test('verifyPick: PubMed 미존재(빈 배열) → ok:false', async () => {
  const v = await verifyPick({ pmid: '900' }, { fetchArticles: async () => [], sinceDate: '2026-01-01' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not found|없|PubMed/i);
});

test('verifyPick: 6개월 창 밖 → ok:false', async () => {
  const v = await verifyPick({ pmid: '900' }, {
    fetchArticles: async () => [paper({ pubDate: '2025-01' })],
    sinceDate: '2026-01-01',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /window|창|old|date/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trackCompare.test.mjs`
Expected: FAIL — `parseYearMonth`/`verifyPick` 미정의.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/trackCompare.js  (append)

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
export function parseYearMonth(s) {
  const parts = String(s ?? '').split(/[-/\s]+/).filter(Boolean);
  if (!parts.length) return null;
  const year = Number(parts[0]);
  if (!Number.isFinite(year) || year < 1900) return null;
  let month = 0;
  if (parts[1]) {
    const m = parts[1].toLowerCase();
    month = Number.isFinite(Number(parts[1])) ? Number(parts[1]) - 1 : (MONTHS[m.slice(0, 3)] ?? 0);
  }
  const dt = new Date(Date.UTC(year, month, 1));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Arm2가 반환한 pick(PMID)을 PubMed 재조회로 검증하고 6개월 창을 확인.
// fetchArticles는 주입(테스트 목 가능). 성공 시 canonical paper 객체 반환.
export async function verifyPick(pick, { fetchArticles, sinceDate }) {
  const pmid = String(pick?.pmid ?? '').trim();
  if (!/^\d+$/.test(pmid)) return { ok: false, paper: null, reason: `invalid pmid: "${pick?.pmid ?? ''}"` };

  let articles = [];
  try { articles = await fetchArticles([pmid]); } catch (err) { return { ok: false, paper: null, reason: `fetch error: ${err.message}` }; }
  const paper = Array.isArray(articles) ? articles.find((a) => String(a.pmid) === pmid) : null;
  if (!paper) return { ok: false, paper: null, reason: `PMID ${pmid} not found on PubMed` };

  const pub = parseYearMonth(paper.pubDate);
  const since = new Date(`${sinceDate}T00:00:00Z`);
  if (!pub) return { ok: false, paper: null, reason: `unparseable pubDate "${paper.pubDate}"` };
  if (pub < since) return { ok: false, paper: null, reason: `outside 6-month window (pubDate ${paper.pubDate} < ${sinceDate})` };

  return { ok: true, paper, reason: 'ok' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/trackCompare.test.mjs`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/trackCompare.js test/trackCompare.test.mjs
git commit -m "feat(experiment): Arm2 픽 검증(PMID 실재·6개월 창)"
```

---

### Task 4: 레코드 조립·upsert·종료일 게이트 (pure)

**Files:**
- Modify: `src/experiments/trackCompare.js`
- Test: `test/trackCompare.test.mjs`

**Interfaces:**
- Produces:
  - `assembleRecord({ date, arm1, arm2 }) → { date, arm1, arm2, arm3:null, converged }` — converged = arm1·arm2 pmid 동일(둘 다 존재).
  - `upsertRecord(comparison, record) → comparison` — records 배열에서 같은 date 교체, 없으면 push. comparison 없으면 초기화.
  - `isPastEndDate(today, endDate) → boolean` — endDate 없으면 false. today > endDate면 true(문자열 'YYYY-MM-DD' 비교).

- [ ] **Step 1: Write the failing test**

```javascript
// test/trackCompare.test.mjs  (append)
import { assembleRecord, upsertRecord, isPastEndDate } from '../src/experiments/trackCompare.js';

test('assembleRecord: 수렴 계산', () => {
  const r = assembleRecord({ date: '2026-07-14', arm1: { pmid: '5' }, arm2: { pmid: '5' } });
  assert.equal(r.converged, true);
  assert.equal(r.arm3, null);
});
test('assembleRecord: 발산·null', () => {
  assert.equal(assembleRecord({ date: 'd', arm1: { pmid: '5' }, arm2: { pmid: '9' } }).converged, false);
  assert.equal(assembleRecord({ date: 'd', arm1: { pmid: '5' }, arm2: null }).converged, false);
  assert.equal(assembleRecord({ date: 'd', arm1: null, arm2: null }).converged, false);
});
test('upsertRecord: 같은 날 교체', () => {
  let c = { records: [] };
  c = upsertRecord(c, { date: 'd1', arm1: { pmid: '1' } });
  c = upsertRecord(c, { date: 'd1', arm1: { pmid: '2' } });
  assert.equal(c.records.length, 1);
  assert.equal(c.records[0].arm1.pmid, '2');
});
test('upsertRecord: comparison 없으면 초기화', () => {
  const c = upsertRecord(undefined, { date: 'd1' });
  assert.equal(c.records.length, 1);
});
test('isPastEndDate', () => {
  assert.equal(isPastEndDate('2026-07-26', '2026-07-25'), true);
  assert.equal(isPastEndDate('2026-07-25', '2026-07-25'), false);
  assert.equal(isPastEndDate('2026-07-25', ''), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trackCompare.test.mjs`
Expected: FAIL — 미정의.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/trackCompare.js  (append)

export function assembleRecord({ date, arm1, arm2 }) {
  const converged = Boolean(arm1?.pmid && arm2?.pmid && String(arm1.pmid) === String(arm2.pmid));
  return { date, arm1: arm1 ?? null, arm2: arm2 ?? null, arm3: null, converged };
}

export function upsertRecord(comparison, record) {
  const c = comparison ?? { records: [] };
  c.records = Array.isArray(c.records) ? c.records : [];
  const i = c.records.findIndex((r) => r.date === record.date);
  if (i >= 0) c.records[i] = record; else c.records.push(record);
  return c;
}

export function isPastEndDate(today, endDate) {
  if (!endDate) return false;
  return String(today) > String(endDate);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/trackCompare.test.mjs`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/trackCompare.js test/trackCompare.test.mjs
git commit -m "feat(experiment): 레코드 조립·upsert·종료일 게이트"
```

---

### Task 5: runOnce 오케스트레이터 (주입 의존성, 목 테스트)

**Files:**
- Modify: `src/experiments/trackCompare.js`
- Test: `test/trackCompare.test.mjs`

**Interfaces:**
- Consumes: `extractInterestKeywords`, `buildArm2SelectPrompt`, `ARM2_PICK_TOOL`, `verifyPick`, `assembleRecord`, `upsertRecord`.
- Produces: `runOnce({ today, sinceDate, arm1Entry, arm2History, comparison, llm, collector, analyzer, logger }) → Promise<{ record, arm2Pmid, comparison }>`.
  - `llm.callWithTool(messages, tool, opts)` → pick JSON. `collector.fetchArticles(pmids)` → articles. `analyzer._analyzeSinglePaper(paper)` → 분석 객체.
  - Arm2 검증 실패 시 1회 재시도(피드백). 최종 실패면 arm2=null. 전 구간 소프트(예외도 arm2=null).

- [ ] **Step 1: Write the failing test**

```javascript
// test/trackCompare.test.mjs  (append)
import { runOnce } from '../src/experiments/trackCompare.js';

const okPaper = { pmid: '900', title: 'T', journal: 'NEJM', pubDate: '2026-05', abstract: 'a', authors: [], meshTerms: [], keywords: [], doi: '' };
const analyzerStub = { _analyzeSinglePaper: async (p) => ({ pmid: p.pmid, title_ko: '제목', pico: {}, evidenceLevel: 'High', paper: p }) };
const collectorStub = { fetchArticles: async (ids) => [{ ...okPaper, pmid: ids[0] }] };
const base = { today: '2026-07-14', sinceDate: '2026-01-14', arm2History: [], comparison: { records: [] }, logger: { warn(){}, info(){} } };

test('runOnce: 정상 → arm2 분석 + 레코드', async () => {
  const llm = { callWithTool: async () => ({ pmid: '900', title: 'T', journal: 'NEJM', whyChosen: 'x' }) };
  const out = await runOnce({ ...base, arm1Entry: { pmid: '900' }, llm, collector: collectorStub, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, '900');
  assert.equal(out.record.converged, true);          // arm1도 900
  assert.equal(out.comparison.records.length, 1);
});

test('runOnce: 첫 픽 검증 실패 → 재시도 성공', async () => {
  let call = 0;
  const llm = { callWithTool: async () => (++call === 1 ? { pmid: 'bad', title: 'T', journal: 'J', whyChosen: 'x' } : { pmid: '900', title: 'T', journal: 'NEJM', whyChosen: 'x' }) };
  const collector = { fetchArticles: async (ids) => (ids[0] === '900' ? [{ ...okPaper }] : []) };
  const out = await runOnce({ ...base, arm1Entry: null, llm, collector, analyzer: analyzerStub });
  assert.equal(call, 2);
  assert.equal(out.arm2Pmid, '900');
});

test('runOnce: 재시도도 실패 → arm2=null (소프트)', async () => {
  const llm = { callWithTool: async () => ({ pmid: 'bad', title: 'T', journal: 'J', whyChosen: 'x' }) };
  const collector = { fetchArticles: async () => [] };
  const out = await runOnce({ ...base, arm1Entry: { pmid: '1' }, llm, collector, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, null);
  assert.equal(out.record.arm2, null);
  assert.equal(out.record.arm1.pmid, '1');
});

test('runOnce: llm 예외도 소프트(arm2=null)', async () => {
  const llm = { callWithTool: async () => { throw new Error('429'); } };
  const out = await runOnce({ ...base, arm1Entry: null, llm, collector: collectorStub, analyzer: analyzerStub });
  assert.equal(out.arm2Pmid, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trackCompare.test.mjs`
Expected: FAIL — `runOnce` 미정의.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/trackCompare.js  (append)

async function _selectAndVerify({ user, llm, collector, sinceDate }) {
  const pick = await llm.callWithTool([{ role: 'user', content: user }], ARM2_PICK_TOOL, { webSearch: true, maxTokens: 12000 });
  const v = await verifyPick(pick, { fetchArticles: (ids) => collector.fetchArticles(ids), sinceDate });
  return { pick, v };
}

// 하루치 실행: Arm2 선정→검증(1회 재시도)→동일 PICO 분석. Arm1은 호출자가 넘긴 archive 엔트리.
export async function runOnce({ today, sinceDate, arm1Entry, arm2History = [], comparison, llm, collector, analyzer, logger }) {
  let arm2 = null, arm2Pmid = null;
  try {
    const keywords = extractInterestKeywords();
    const user = buildArm2SelectPrompt({ sinceDate, keywords, excludePmids: arm2History });

    let { pick, v } = await _selectAndVerify({ user, llm, collector, sinceDate });
    if (!v.ok) {
      logger?.warn?.(`Arm2 첫 픽 거부: ${v.reason} — 재시도`);
      const retryUser = `${user}\n\nYour previous pick (PMID ${pick?.pmid ?? 'NA'}) was rejected: ${v.reason}. Choose a DIFFERENT, verifiable paper.`;
      ({ pick, v } = await _selectAndVerify({ user: retryUser, llm, collector, sinceDate }));
    }
    if (v.ok) {
      arm2 = await analyzer._analyzeSinglePaper(v.paper);
      arm2Pmid = String(v.paper.pmid);
    } else {
      logger?.warn?.(`Arm2 최종 실패: ${v.reason}`);
    }
  } catch (err) {
    logger?.warn?.(`Arm2 예외(소프트): ${err.message}`);
  }

  const record = assembleRecord({ date: today, arm1: arm1Entry ?? null, arm2 });
  const updated = upsertRecord(comparison, record);
  return { record, arm2Pmid, comparison: updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/trackCompare.test.mjs`
Expected: PASS (19 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/trackCompare.js test/trackCompare.test.mjs
git commit -m "feat(experiment): runOnce 오케스트레이터(선정·검증·재시도·분석)"
```

---

### Task 6: compare.html 렌더 (승인된 레이아웃)

**Files:**
- Create: `src/experiments/compareRender.js`
- Test: `test/compareRender.test.mjs`

**Interfaces:**
- Produces: `renderComparisonHtml(comparison, { startDate, endDate, today }) → string` — 자립형 HTML(인라인 CSS). 승인된 더미 레이아웃 반영: 히어로+스탯, 범례, 일자별 카드(Arm1/Arm2/Arm3 슬롯), 수렴 뱃지, PICO 요약(P/I/O), 모바일 세로 스택(`@media(max-width:760px)`), Arm2 실패 안내. XSS 방지 위해 모든 동적 텍스트 이스케이프.

- [ ] **Step 1: Write the failing test**

```javascript
// test/compareRender.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComparisonHtml } from '../src/experiments/compareRender.js';

const sample = {
  records: [
    { date: '2026-07-14', converged: true,
      arm1: { pmid: '42308484', title: 'Cefazolin for MSSA', title_ko: '세파졸린', journal: 'NEJM', doi: '10.x', evidenceLevel: 'High',
              pico: { population: '[USA] adults', intervention: 'cefazolin', outcome: 'mortality 12% vs 18%' }, keyFindings_ko: ['소견1'] },
      arm2: { pmid: '42308484', title: 'Cefazolin for MSSA', title_ko: '세파졸린', journal: 'NEJM', doi: '10.x', evidenceLevel: 'High',
              pico: { population: '[USA] adults', intervention: 'cefazolin', outcome: 'mortality 12% vs 18%' }, keyFindings_ko: ['소견'] },
      arm3: null },
    { date: '2026-07-13', converged: false,
      arm1: { pmid: '1', title: 'A', journal: 'JAMA', pico: {}, keyFindings_ko: [] }, arm2: null, arm3: null },
  ],
};

test('renderComparisonHtml: 핵심 요소 포함', () => {
  const html = renderComparisonHtml(sample, { startDate: '2026-07-12', endDate: '2026-07-25', today: '2026-07-14' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /ARM 1/);
  assert.match(html, /ARM 2/);
  assert.match(html, /42308484/);            // pmid 표시
  assert.match(html, /수렴/);                 // 수렴 뱃지
  assert.match(html, /max-width:760px/);      // 모바일 스택
  assert.match(html, /선정 실패|픽 없음/);     // Arm2 실패 안내
});

test('renderComparisonHtml: HTML 이스케이프', () => {
  const html = renderComparisonHtml({ records: [{ date: 'd', converged: false, arm1: { pmid: '1', title: '<script>x</script>', journal: 'J', pico: {}, keyFindings_ko: [] }, arm2: null }] }, { startDate: 'a', endDate: 'b', today: 'd' });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderComparisonHtml: 빈 records도 안전', () => {
  const html = renderComparisonHtml({ records: [] }, { startDate: 'a', endDate: 'b', today: 'c' });
  assert.match(html, /<!doctype html>/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/compareRender.test.mjs`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/experiments/compareRender.js
// 승인된 더미 레이아웃(2026-07-11)을 실데이터로 렌더. 자립형·인라인 CSS.

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function armColumn(cls, label, sub, a) {
  if (!a) {
    return `<div class="col fail"><span class="arm ${cls}">${label} <small>${esc(sub)}</small></span>
      <div class="failmsg">⚠ 이 날 선정 실패 / 픽 없음<br>PMID 검증 실패 또는 6개월 창 밖 → 소프트 스킵.</div></div>`;
  }
  const pico = a.pico ?? {};
  const kf = (a.keyFindings_ko ?? a.keyFindings ?? []).slice(0, 2)
    .map((k) => `<li>${esc(k)}</li>`).join('');
  const doi = a.doi && a.doi.length > 3 ? ` · <a href="https://doi.org/${esc(a.doi)}">DOI</a>` : '';
  return `<div class="col">
    <span class="arm ${cls}">${label} <small>${esc(sub)}</small></span>
    <div class="ttl">${esc(a.title_ko || a.title)}</div>
    ${a.title_ko ? `<div class="ttl-en">${esc(a.title)}</div>` : ''}
    <div class="meta">${esc(a.journal)} · PMID ${esc(a.pmid)}${doi}</div>
    <div class="badges"><span class="b ev">근거 ${esc(a.evidenceLevel || 'NR')}</span></div>
    <div class="pico">
      ${pico.population ? `<div class="row"><span class="k">P</span><span>${esc(pico.population)}</span></div>` : ''}
      ${pico.intervention ? `<div class="row"><span class="k">I</span><span>${esc(pico.intervention)}</span></div>` : ''}
      ${pico.outcome ? `<div class="row"><span class="k">O</span><span>${esc(pico.outcome)}</span></div>` : ''}
    </div>
    ${kf ? `<ul class="kf">${kf}</ul>` : ''}
  </div>`;
}

function dayCard(rec) {
  const conv = rec.converged ? `<span class="conv">🔗 Arm1·Arm2 수렴</span>` : '';
  return `<section class="day">
    <div class="dayhead"><span class="date">${esc(rec.date)}</span>${conv}</div>
    <div class="cols">
      ${armColumn('a1', 'ARM 1', '결정적+rerank', rec.arm1)}
      ${armColumn('a2', 'ARM 2', 'Opus 자체선정', rec.arm2)}
      ${rec.arm3 ? armColumn('a3', 'ARM 3', 'ChatGPT', rec.arm3)
        : `<div class="emptyslot">Arm 3 (ChatGPT)<br>2주 뒤 PeterJ 리스트 병합</div>`}
    </div>
  </section>`;
}

export function renderComparisonHtml(comparison, { startDate, endDate, today } = {}) {
  const records = [...(comparison?.records ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const conv = records.filter((r) => r.converged).length;
  const fail = records.filter((r) => r.arm1 && !r.arm2).length;
  const CSS = `*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#1a2230;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;line-height:1.5}
@media(prefers-color-scheme:dark){body{background:#0f141b;color:#e6ebf2}.col{background:#161d27!important;border-color:#26303d!important}}
.wrap{max-width:1100px;margin:0 auto;padding:16px 14px 40px}
.hero{background:linear-gradient(135deg,#1e3a8a,#5b21b6);color:#fff;border-radius:16px;padding:18px;margin-bottom:14px}
.hero h1{margin:0 0 4px;font-size:19px}.hero .sub{font-size:12.5px;opacity:.9}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.stat{background:rgba(255,255,255,.14);border-radius:10px;padding:7px 11px;font-size:12px}.stat b{font-size:15px;display:block}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px;font-size:11.5px;color:#5b6675}
.dayhead{display:flex;align-items:center;gap:9px;margin:0 2px 9px;font-weight:700;font-size:14px}
.conv{background:#fff7ed;color:#b45309;border:1px solid #b45309;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:20px}
.day{margin-bottom:20px}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}
@media(max-width:760px){.cols{grid-template-columns:1fr}}
.col{background:#fff;border:1px solid #e3e8ef;border-radius:13px;padding:13px;display:flex;flex-direction:column;gap:8px}
.arm{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;padding:3px 9px;border-radius:20px;width:fit-content}
.arm.a1{background:#eff4ff;color:#2563eb}.arm.a2{background:#f5f0ff;color:#7c3aed}.arm.a3{background:#effcf9;color:#0d9488}
.arm small{font-weight:600;opacity:.75}.ttl{font-weight:700;font-size:13.5px}.ttl-en{font-size:11.5px;color:#5b6675;font-style:italic}
.meta{font-size:11.5px;color:#5b6675}.meta a{color:#2563eb;text-decoration:none}
.badges{display:flex;flex-wrap:wrap;gap:5px}.b{font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;background:#eff4ff;color:#2563eb}
.pico{border-top:1px dashed #e3e8ef;padding-top:8px;display:flex;flex-direction:column;gap:5px}
.pico .row{display:grid;grid-template-columns:20px 1fr;gap:7px;font-size:11.5px}.pico .k{font-weight:800;color:#5b6675;font-size:10px}
.kf{margin:2px 0 0;padding-left:16px;font-size:11.5px}.emptyslot{display:flex;align-items:center;justify-content:center;text-align:center;color:#5b6675;font-size:11.5px;border:1px dashed #e3e8ef;border-radius:13px;min-height:120px;padding:14px}
.failmsg{font-size:12px;color:#5b6675;padding:6px 0}`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>트랙 비교 실험 · Trend Review</title><style>${CSS}</style></head>
<body><div class="wrap">
<header class="hero"><h1>논문 선정 트랙 비교 실험</h1>
<div class="sub">${esc(startDate)} → ${esc(endDate)} (KST) · 오늘 ${esc(today)}</div>
<div class="stats"><div class="stat"><b>${records.length}</b>기록된 날</div><div class="stat"><b>${conv}</b>수렴</div><div class="stat"><b>${fail}</b>Arm 2 실패</div></div></header>
<div class="legend"><span>■ Arm 1 · 결정적+rerank(현행)</span><span>■ Arm 2 · Opus 자체선정</span><span>■ Arm 3 · ChatGPT(2주 뒤)</span></div>
${records.map(dayCard).join('\n')}
<footer style="margin-top:22px;font-size:11px;color:#5b6675;text-align:center">실험용 비교 페이지 · njell85-spec.github.io/trend-review/experiments/compare.html</footer>
</div></body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/compareRender.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/experiments/compareRender.js test/compareRender.test.mjs
git commit -m "feat(experiment): compare.html 렌더(승인 레이아웃)"
```

---

### Task 7: 진입점 스크립트 (env·파일 IO·git push)

**Files:**
- Create: `scripts/compare-tracks.mjs`

**Interfaces:**
- Consumes: `runOnce`, `isPastEndDate`, `renderComparisonHtml`, `kstDateStr`, `LLMClient`, `DataCollectorAgent`, `FilterAnalyzerAgent`.
- 동작: 게이트 검사 → Arm1 엔트리 로드 → runOnce → experiments/ 3파일 write → git add/commit/pull --rebase/push → job summary. 실패는 소프트(비정상 종료로 데일리·다른 잡 영향 없음).

- [ ] **Step 1: 스크립트 작성**

```javascript
// scripts/compare-tracks.mjs
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { kstDateStr } from '../src/utils/dates.js';
import { LLMClient, ANTHROPIC_ANALYSIS_MODEL } from '../src/utils/LLMClient.js';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';
import { runOnce, isPastEndDate } from '../src/experiments/trackCompare.js';
import { renderComparisonHtml } from '../src/experiments/compareRender.js';

const EXP_DIR = 'experiments';
const CMP_PATH = path.join(EXP_DIR, 'track-comparison.json');
const HIST_PATH = path.join(EXP_DIR, 'arm2-history.json');
const HTML_PATH = path.join(EXP_DIR, 'compare.html');
const ARCHIVE_PATH = path.join('output', 'analysis_archive.json');

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}
function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

async function main() {
  if (process.env.ENABLE_TRACK_COMPARE !== 'true') { console.log('ENABLE_TRACK_COMPARE!=true — no-op'); return; }
  const today = kstDateStr();
  const endDate = process.env.TRACK_COMPARE_END ?? '';
  if (isPastEndDate(today, endDate)) { console.log(`${today} > TRACK_COMPARE_END(${endDate}) — 실험 종료, no-op`); return; }

  const sinceDate = kstDateStr(new Date(Date.now() - 183 * 86_400_000));

  // Arm1: 프로덕션 archive에서 오늘 엔트리(읽기 전용)
  const archive = await readJson(ARCHIVE_PATH, { entries: [] });
  const arm1Entry = (archive.entries ?? []).find((e) => e.date === today) ?? null;
  if (!arm1Entry) console.log(`⚠ 오늘(${today}) Arm1 archive 엔트리 없음 — arm1=null 기록`);

  const comparison = await readJson(CMP_PATH, { startDate: today, endDate, records: [] });
  comparison.startDate ??= today; comparison.endDate = endDate;
  const history = await readJson(HIST_PATH, { pmids: [] });

  const llm = new LLMClient({ provider: 'anthropic', model: ANTHROPIC_ANALYSIS_MODEL });
  const collector = new DataCollectorAgent();
  const analyzer = new FilterAnalyzerAgent();
  const logger = { warn: (m) => console.warn('WARN', m), info: (m) => console.log(m) };

  const { record, arm2Pmid, comparison: updated } = await runOnce({
    today, sinceDate, arm1Entry, arm2History: history.pmids ?? [], comparison, llm, collector, analyzer, logger,
  });
  if (arm2Pmid && !(history.pmids ?? []).includes(arm2Pmid)) (history.pmids ??= []).push(arm2Pmid);

  await mkdir(EXP_DIR, { recursive: true });
  await writeFile(CMP_PATH, JSON.stringify(updated, null, 2));
  await writeFile(HIST_PATH, JSON.stringify(history, null, 2));
  await writeFile(HTML_PATH, renderComparisonHtml(updated, { startDate: updated.startDate, endDate, today }));

  // Job summary (폰에서 Actions로 확인)
  const sum = `## 트랙 비교 ${today}\n- Arm1: ${arm1Entry ? `${arm1Entry.journal} · PMID ${arm1Entry.pmid}` : '없음'}\n- Arm2: ${arm2Pmid ? `PMID ${arm2Pmid}` : '선정 실패'}\n- 수렴: ${record.converged ? '예 🔗' : '아니오'}\n- URL: https://njell85-spec.github.io/trend-review/experiments/compare.html\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, sum, { flag: 'a' });
  console.log(sum);

  // 커밋·안전 푸시(데일리 커밋과 경합 회피)
  try {
    git(['add', CMP_PATH, HIST_PATH, HTML_PATH]);
    const staged = git(['diff', '--cached', '--name-only']);
    if (!staged) { console.log('변경 없음 — 커밋 스킵'); return; }
    git(['commit', '-m', `experiment: 트랙 비교 ${today}`]);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        git(['pull', '--rebase', 'origin', 'main']);
        git(['push', 'origin', 'HEAD:main']);
        console.log('푸시 완료'); return;
      } catch (err) {
        console.warn(`push 재시도 ${attempt}: ${err.message}`);
        if (attempt === 4) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  } catch (err) {
    console.error('커밋/푸시 실패(소프트):', err.message);  // 데일리 코어 무영향 — 종료코드 0 유지
  }
}

await main();
```

- [ ] **Step 2: 로컬 게이트 스모크 (라이브 호출 없음)**

Run: `ENABLE_TRACK_COMPARE= node scripts/compare-tracks.mjs`
Expected: 출력 `ENABLE_TRACK_COMPARE!=true — no-op`, 종료코드 0, 파일 변경 없음.

Run: `ENABLE_TRACK_COMPARE=true TRACK_COMPARE_END=2000-01-01 node scripts/compare-tracks.mjs`
Expected: 출력에 `실험 종료, no-op` 포함(종료일 게이트 동작), 종료코드 0.

- [ ] **Step 3: 회귀 확인**

Run: `npm run test:unit && npm run spec-lint`
Expected: 전체 PASS, spec-lint 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/compare-tracks.mjs
git commit -m "feat(experiment): compare-tracks 진입점(게이트·IO·안전 푸시)"
```

---

### Task 8: 워크플로우 + 문서

**Files:**
- Create: `.github/workflows/compare-tracks.yml`
- Modify: `docs/HANDOFF.md` (§10 상단에 실험 시작 안내 한 블록)

**Interfaces:**
- Consumes: `scripts/compare-tracks.mjs`. 시크릿/변수: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `PUBMED_API_KEY`, `PUBMED_EMAIL`, `vars.ANALYSIS_MODEL`, `vars.ENABLE_TRACK_COMPARE`, `vars.TRACK_COMPARE_END`.

- [ ] **Step 1: 워크플로우 작성**

```yaml
# .github/workflows/compare-tracks.yml
name: Track Comparison (Arm1 vs Arm2 · 2주 실험)

# 데일리(06:30 KST) 커밋 이후 08:00 KST(=23:00 UTC 전날)에 실행.
# 데일리 코어 무접촉: output/analysis_archive.json 읽기만, experiments/ 만 커밋.
on:
  schedule:
    - cron: '0 23 * * *'   # 08:00 KST
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: track-compare
  cancel-in-progress: false

jobs:
  compare:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install claude CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Trust workspace
        run: node -e "const fs=require('fs'),os=require('os'),path=require('path');const p=path.join(os.homedir(),'.claude.json');let j={};try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch{};j.projects=j.projects||{};const ws=process.env.GITHUB_WORKSPACE;j.projects[ws]=Object.assign({},j.projects[ws],{hasTrustDialogAccepted:true});fs.writeFileSync(p,JSON.stringify(j,null,2));console.log('trusted:',ws)"

      - name: Configure git identity
        run: |
          git config user.email "noreply@anthropic.com"
          git config user.name "Claude"

      - name: Run track comparison
        run: node scripts/compare-tracks.mjs
        env:
          ENABLE_TRACK_COMPARE:   ${{ vars.ENABLE_TRACK_COMPARE }}
          TRACK_COMPARE_END:      ${{ vars.TRACK_COMPARE_END }}
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          ANTHROPIC_API_KEY:      ${{ secrets.ANTHROPIC_API_KEY }}
          PUBMED_API_KEY:         ${{ secrets.PUBMED_API_KEY }}
          PUBMED_EMAIL:           ${{ secrets.PUBMED_EMAIL }}
          ANALYSIS_MODEL:         ${{ vars.ANALYSIS_MODEL }}
```

- [ ] **Step 2: HANDOFF 안내 추가**

`docs/HANDOFF.md`의 `## 10. ★ 다음 세션 착수점` 바로 아래에 다음 블록을 삽입:

```markdown
> **[2026-07-11] 트랙 비교 실험(Arm1 vs Arm2) 구현 완료 — 시작 대기**
> 2주 무인 A/B: Arm1(프로덕션 픽 재사용) vs Arm2(Opus 웹서치 자체선정+동일 PICO).
> 코드·워크플로우 main 병합됨. **시작하려면 PeterJ가 Variables 2개 설정**:
> `ENABLE_TRACK_COMPARE=true`, `TRACK_COMPARE_END=<시작+14일, 예 2026-07-25>` →
> compare-tracks 워크플로우 수동 dispatch로 스모크 → 이후 매일 08:00 KST 자동.
> 결과: https://njell85-spec.github.io/trend-review/experiments/compare.html
> Arm3(ChatGPT)는 2주 뒤 PeterJ가 리스트 복붙 → arm3-list.json 병합·재렌더.
> 스펙: docs/superpowers/specs/2026-07-11-track-comparison-experiment-design.md
```

- [ ] **Step 3: 워크플로우 YAML 문법 검증**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/compare-tracks.yml','utf8'); if(!/schedule|workflow_dispatch/.test(y)||!/compare-tracks.mjs/.test(y)) throw new Error('yml 내용 누락'); console.log('yml OK')"`
Expected: `yml OK`.

- [ ] **Step 4: 전체 회귀**

Run: `npm run test:unit && npm run spec-lint`
Expected: 전체 PASS(신규 22 테스트 포함), spec-lint 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/compare-tracks.yml docs/HANDOFF.md
git commit -m "feat(experiment): compare-tracks 워크플로우 + HANDOFF 안내"
```

---

## Self-Review

**1. Spec coverage:**
- §2 Arm1 재실행 안 함 → Task 7(archive 읽기). ✓
- §2 Arm2 분석=동일 PICO → Task 5(`_analyzeSinglePaper`). ✓
- §2 각 트랙 자기 과거만 제외 → Task 2(프롬프트 제외) + Task 7(history append). ✓
- §2 Claude만 2-arm → OpenAI 미사용, Arm3 수동. ✓
- §2 데일리 코어 무접촉 → Task 7(experiments/만 커밋, archive 읽기 전용) + Task 8(별도 워크플로우). ✓
- §3.2 흐름(게이트→Arm1 로드→선정→검증→분석→기록→렌더→푸시→summary) → Task 5·7. ✓
- §3.3 선정 프롬프트 → Task 2. ✓
- §4 데이터 계약(track-comparison.json·arm2-history.json) → Task 4·7. ✓
- §5 compare.html 레이아웃 → Task 6. ✓
- §6 Arm3 병합 슬롯 → Task 6(emptyslot/arm3 분기). 실제 병합은 2주 뒤 수동(범위 밖, HANDOFF 명시). ✓
- §7 소프트 실패·429·경합 → Task 5(소프트)·Task 7(pull --rebase 재시도). ✓
- §8 기간/중단 → Task 4(isPastEndDate)·Task 7·8(vars). ✓
- §9 오프라인 테스트 → Task 1~6 목. ✓

**2. Placeholder scan:** 없음 — 모든 스텝에 실제 코드·명령·기대출력.

**3. Type consistency:** `runOnce`가 소비하는 `verifyPick({fetchArticles,sinceDate})`·`assembleRecord({date,arm1,arm2})`·`upsertRecord`·`extractInterestKeywords`·`buildArm2SelectPrompt` 시그니처가 Task 1~4 정의와 일치. `renderComparisonHtml(comparison,{startDate,endDate,today})` 소비(Task 7)와 정의(Task 6) 일치. `_analyzeSinglePaper`·`fetchArticles`·`callWithTool`·`kstDateStr` 기존 코드 시그니처와 일치.

## 알려진 한계 (정직 고지)
- Arm2는 OA 본문 사전 확보 없이 분석 → `_analyzeSinglePaper`의 표준 폴백(초록+레지스트리/웹보강)을 탄다. Arm1이 본문 확보된 날은 분석 심도가 다를 수 있다(선정 비교가 1차 목표라 수용). 완전 대등화는 후속.
- 커밋 서명 불가 환경 → GitHub Unverified 표시(표시상, 무시).
