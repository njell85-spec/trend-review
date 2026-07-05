# Phase 2 — NotebookLM 연동 (Google 인증 + ArchiveAgent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 코어 파이프라인 완료 후, 논문 PDF를 Drive에 적재하고 월별 리빙 Google Doc을 갱신해 NotebookLM이 자동 동기화하게 한다.

**Architecture:** 공용 `googleAuth`(env refresh token 우선, 토큰 파일 폴백) 위에 `ArchiveAgent`가 ① PDF 확보(Unpaywall→EuropePMC) ② Drive 적재 ③ `output/analysis_archive.json`(항목+Drive 상태) 갱신·자체 커밋 ④ 월별 리빙 Doc(HTML→Google Doc 변환) 재생성을 소프트 실패로 수행한다. 진입점은 `github-actions-daily.mjs`의 카카오 발송 뒤.

**Tech Stack:** Node 20 ESM · googleapis(기존 의존성) · GitHub contents API(GITHUB_TOKEN) · node:test

## Global Constraints (스펙 §0·§8에서 발췌)

- Phase 1 코어 로직 무수정 — 허용되는 수정은 `github-actions-daily.mjs`에 후처리 블록 추가와 워크플로우 env 추가뿐.
- 전체 소프트 실패: ArchiveAgent 실패 시 경고·job summary만, exit code 영향 없음.
- 시크릿(토큰·키)을 로그·에러 메시지에 절대 노출하지 않는다 (전역 지침 ①).
- LLM 산출 텍스트를 HTML에 넣을 때 반드시 이스케이프 (전역 지침 ②).
- 날짜는 KST (`src/utils/dates.js`의 `kstDateStr` 재사용) (전역 지침 ⑤).
- 재실행 안전: 같은 날 재실행 시 중복 업로드·중복 항목 금지 (전역 지침 ④).
- 스코프는 `drive.file` + `youtube.upload` 2개 고정(Phase 3 공용) — 이번 인증 한 번으로 Phase 3까지 커버.
- 커밋 전 `npm run spec-lint` 통과.

## 파일 구조

| 경로 | 역할 |
|---|---|
| `src/utils/googleAuth.js` (신규) | OAuth2 클라이언트 생성: env(Secrets) 우선 → 토큰 파일 폴백 |
| `scripts/google-auth-setup.mjs` (신규) | 데스크탑 데이 1회: 브라우저 승인 → refresh token 출력 |
| `src/agents/ArchiveAgent.js` (신규) | PDF·Drive·아카이브 JSON·리빙 Doc 오케스트레이션 |
| `src/utils/docBuilder.js` (신규) | 아카이브 항목 배열 → 리빙 Doc HTML (순수 함수) |
| `test/googleAuth.test.mjs` `test/docBuilder.test.mjs` `test/archiveEntry.test.mjs` (신규) | node:test 단위 테스트 |
| `github-actions-daily.mjs` (수정) | 카카오 발송 뒤 Phase 2 블록 |
| `.github/workflows/daily-review.yml` (수정) | GOOGLE_* env 주입 |
| `docs/desktop-day-guide.md` (신규) | 데스크탑 데이 체크리스트 실행 가이드 |
| `REPORT_SPEC.md` + `scripts/spec-lint.mjs` (수정) | 4-E 조항 + 린트 확장 |

---

### Task 1: 테스트 러너 준비 + googleAuth 헬퍼

**Files:**
- Create: `src/utils/googleAuth.js`, `test/googleAuth.test.mjs`
- Modify: `package.json` (scripts에 `"test:unit": "node --test test/"` 추가)

**Interfaces:**
- Produces: `buildAuthConfig(env) → {clientId, clientSecret, refreshToken, source} | null` (순수),
  `getGoogleAuth({ logger }) → Promise<OAuth2Client|null>` — env 우선, 없으면 `credentials.json`+`output/google_token.json` 폴백, 둘 다 없으면 null(호출측 소프트 스킵).
- 스코프 상수 `GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/youtube.upload']`.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/googleAuth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthConfig } from '../src/utils/googleAuth.js';

test('env 3종이 모두 있으면 env 설정을 반환한다', () => {
  const cfg = buildAuthConfig({
    GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sec', GOOGLE_REFRESH_TOKEN: 'rt',
  });
  assert.deepEqual(cfg, { clientId: 'id', clientSecret: 'sec', refreshToken: 'rt', source: 'env' });
});

test('하나라도 빠지면 null (부분 설정은 오류 아님)', () => {
  assert.equal(buildAuthConfig({ GOOGLE_CLIENT_ID: 'id' }), null);
  assert.equal(buildAuthConfig({}), null);
});

test('빈 문자열은 미설정으로 취급한다', () => {
  assert.equal(buildAuthConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r' }), null);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` (스크립트 추가 후) Expected: FAIL `Cannot find module '../src/utils/googleAuth.js'`

- [ ] **Step 3: 구현**

```js
// src/utils/googleAuth.js
/**
 * googleAuth — Drive·YouTube 공용 OAuth2 헬퍼.
 * 우선순위: ① env(GitHub Secrets: CLIENT_ID/SECRET + REFRESH_TOKEN)
 *          ② credentials.json + output/google_token.json (데스크탑, NotificationAgent와 동일 파일)
 * 미설정이면 null 반환 — 호출측이 소프트 스킵한다. 토큰 값은 절대 로그에 남기지 않는다.
 */
import { google } from 'googleapis';
import { readFile } from 'fs/promises';
import path from 'path';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/youtube.upload',
];

export function buildAuthConfig(env) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = env.GOOGLE_REFRESH_TOKEN || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, source: 'env' };
}

export async function getGoogleAuth({ logger } = {}) {
  const cfg = buildAuthConfig(process.env);
  if (cfg) {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
    oauth2.setCredentials({ refresh_token: cfg.refreshToken });
    logger?.info?.('Google 인증: env(Secrets) 경로');
    return oauth2;
  }
  // 데스크탑 폴백 — NotificationAgent가 쓰는 것과 같은 파일 위치
  try {
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH ?? path.join(process.cwd(), 'credentials.json');
    const tokenPath = path.join(process.cwd(), 'output', 'google_token.json');
    const { installed, web } = JSON.parse(await readFile(credPath, 'utf8'));
    const { client_id, client_secret } = installed ?? web;
    const token = JSON.parse(await readFile(tokenPath, 'utf8'));
    const oauth2 = new google.auth.OAuth2(client_id, client_secret);
    oauth2.setCredentials(token);
    logger?.info?.('Google 인증: 토큰 파일 경로');
    return oauth2;
  } catch {
    logger?.info?.('Google 인증 미설정 — Drive/YouTube 단계 건너뜀');
    return null;
  }
}
```

`package.json` scripts에 추가: `"test:unit": "node --test test/"`

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS 3건
- [ ] **Step 5: Commit** — `git add src/utils/googleAuth.js test/googleAuth.test.mjs package.json && git commit -m "feat(phase2): googleAuth 공용 헬퍼 — env 우선, 토큰 파일 폴백"`

---

### Task 2: 데스크탑 데이 발급 스크립트 + 가이드

**Files:**
- Create: `scripts/google-auth-setup.mjs`, `docs/desktop-day-guide.md`
- Modify: `.gitignore` 확인(credentials.json·output/google_token.json 무시 — 이미 있으면 그대로)

**Interfaces:**
- Consumes: `GOOGLE_SCOPES` (Task 1)
- Produces: 터미널에 `GOOGLE_REFRESH_TOKEN` 값 1회 출력(Secrets 등록용) + `output/google_token.json` 저장

- [ ] **Step 1: 스크립트 작성** (수동 검증 대상 — 브라우저 필요라 단위 테스트 없음)

```js
#!/usr/bin/env node
// scripts/google-auth-setup.mjs — 데스크탑 데이 1회 실행.
// credentials.json(데스크탑 앱 OAuth 클라이언트)을 저장소 루트에 두고 실행하면
// 브라우저 승인 → refresh token을 화면에 1회 출력한다(GitHub Secrets 등록용).
// 이 값은 비밀이다 — 스크린샷·붙여넣기 후 터미널 기록을 지울 것.
import { google } from 'googleapis';
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { GOOGLE_SCOPES } from '../src/utils/googleAuth.js';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const { installed, web } = JSON.parse(readFileSync('credentials.json', 'utf8'));
const { client_id, client_secret } = installed ?? web;
const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES });

const server = createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end(); return; }
  res.end('<h2>인증 완료 — 터미널로 돌아가세요.</h2>');
  server.close();
  const { tokens } = await oauth2.getToken(code);
  mkdirSync('output', { recursive: true });
  writeFileSync('output/google_token.json', JSON.stringify(tokens, null, 2));
  console.log('\n✅ output/google_token.json 저장 완료 (데스크탑 실행용)');
  console.log('\nGitHub Secrets 에 등록하세요 (Settings → Secrets → Actions):');
  console.log(`  GOOGLE_CLIENT_ID     = ${client_id}`);
  console.log(`  GOOGLE_CLIENT_SECRET = ${client_secret}`);
  console.log(`  GOOGLE_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log('\n⚠️ 위 값은 비밀입니다. 등록 후 터미널 기록을 지우세요.');
});
server.listen(PORT, () => {
  console.log('브라우저에서 Google 승인 진행 중… 자동으로 열리지 않으면 URL을 여세요:\n' + url);
  const opener = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(opener, () => {});
});
```

- [ ] **Step 2: 가이드 문서 작성** — `docs/desktop-day-guide.md`에 스펙 §2 체크리스트 8항목을 실행 순서·스크린샷 지점·예상 함정(동의 화면 "테스트 사용자"에 본인 Gmail 추가 필수, 게시 상태는 "테스트" 유지)과 함께 기술. 6번(브랜드 계정·전용 채널)과 7번(NotebookLM 노트북 생성·당월 Doc 소스 연결) 포함. 마지막에 8번 검증: Actions에서 workflow_dispatch 실행 → job summary에 "Drive 적재 완료" 확인.
- [ ] **Step 3: 문법 검증** — Run: `node --check scripts/google-auth-setup.mjs` Expected: 무출력(통과)
- [ ] **Step 4: Commit** — `git add scripts/google-auth-setup.mjs docs/desktop-day-guide.md && git commit -m "feat(phase2): 데스크탑 데이 인증 발급 스크립트 + 가이드"`

---

### Task 3: docBuilder — 리빙 Doc HTML (순수 함수, 이스케이프 필수)

**Files:**
- Create: `src/utils/docBuilder.js`, `test/docBuilder.test.mjs`

**Interfaces:**
- Produces: `buildMonthDocHtml(month, entries) → string` (완전한 `<html>` 문서),
  `esc(s) → string` (HTML 이스케이프, 내보냄 — ArchiveAgent 재사용).
- entries 항목 스키마(Task 4가 생산): `{ date, pmid, title, title_ko, journal, doi, badge, clinicalQuestion_ko, pico_ko, keyFindings, keyFindings_ko, evidenceLevel, references:[{label,url}], fullText, fullTextSource, dossier:[{source, url, note}]|null, pdfLink|null }`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// test/docBuilder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthDocHtml, esc } from '../src/utils/docBuilder.js';

const entry = {
  date: '2026-07-06', pmid: '12345', title: 'Trial <script>alert(1)</script>',
  title_ko: '무작위 시험', journal: 'NEJM', doi: '10.1/x', badge: '본문(PMC)',
  clinicalQuestion_ko: '질문?', pico_ko: { patient: 'P', intervention: 'I', comparison: 'C', outcome: 'O' },
  keyFindings: ['finding A'], keyFindings_ko: ['소견 A'], evidenceLevel: '1b',
  references: [{ label: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/12345/' }],
  fullText: 'Body text', fullTextSource: 'PMC', dossier: null, pdfLink: 'https://drive.google.com/x',
};

test('제목의 HTML이 이스케이프된다 (XSS/문서 깨짐 방지)', () => {
  const html = buildMonthDocHtml('2026-07', [entry]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('날짜 역순 정렬 + 본문·근거배지·PDF 링크 포함', () => {
  const older = { ...entry, date: '2026-07-01', pmid: '99999', title: 'Old', fullText: null, fullTextSource: 'abstract-only' };
  const html = buildMonthDocHtml('2026-07', [older, entry]);
  assert.ok(html.indexOf('12345') < html.indexOf('99999')); // 최신이 먼저
  assert.ok(html.includes('본문(PMC)') && html.includes('Body text'));
  assert.ok(html.includes('https://drive.google.com/x'));
});

test('esc는 & < > " 를 치환한다', () => {
  assert.equal(esc('a&b<c>"d"'), 'a&amp;b&lt;c&gt;&quot;d&quot;');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현**

```js
// src/utils/docBuilder.js
/** 리빙 Google Doc용 HTML 생성 — Drive files.update(HTML→Doc 변환)에 태운다.
 *  모든 외부/LLM 텍스트는 esc()를 거친다. 스타일은 Doc 변환이 유지하는 기본 태그만 사용. */
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const li = (arr) => (arr ?? []).map((x) => `<li>${esc(x)}</li>`).join('');

function entrySection(e) {
  const pico = e.pico_ko ?? {};
  const dossier = (e.dossier ?? []).map(
    (d) => `<li>${esc(d.note)} — <a href="${esc(d.url)}">${esc(d.source)}</a></li>`).join('');
  return `
<h2>${esc(e.date)} — ${esc(e.title_ko || e.title)}</h2>
<p><b>${esc(e.title)}</b><br>${esc(e.journal)} · PMID ${esc(e.pmid)}${e.doi ? ` · DOI ${esc(e.doi)}` : ''}<br>
근거: <b>${esc(e.badge)}</b> · 근거수준 ${esc(e.evidenceLevel ?? '—')}${e.pdfLink ? ` · <a href="${esc(e.pdfLink)}">원문 PDF(Drive)</a>` : ''}</p>
<h3>임상 질문</h3><p>${esc(e.clinicalQuestion_ko)}</p>
<h3>PICO</h3><ul><li>P: ${esc(pico.patient)}</li><li>I: ${esc(pico.intervention)}</li><li>C: ${esc(pico.comparison)}</li><li>O: ${esc(pico.outcome)}</li></ul>
<h3>핵심 소견</h3><ul>${li(e.keyFindings_ko)}</ul><ul>${li(e.keyFindings)}</ul>
${dossier ? `<h3>근거 도시에 (페이월 — 권위 소스 보강)</h3><ul>${dossier}</ul>` : ''}
<h3>참조</h3><ul>${(e.references ?? []).map((r) => `<li><a href="${esc(r.url)}">${esc(r.label)}</a></li>`).join('')}</ul>
${e.fullText ? `<h3>본문 텍스트 (${esc(e.fullTextSource)}, 최대 1만 자)</h3><p>${esc(e.fullText).replace(/\n/g, '<br>')}</p>` : ''}
<hr>`;
}

export function buildMonthDocHtml(month, entries) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<html><head><meta charset="utf-8"><title>Trend Review — ${esc(month)}</title></head><body>
<h1>Trend Review — ${esc(month)}</h1>
<p>EM/CCM 데일리 논문 리뷰 아카이브. 수치는 초록·본문·레지스트리·확인된 권위 웹페이지에 명시된 값만 수록.</p>
${sorted.map(entrySection).join('\n')}
</body></html>`;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS (누적 6건)
- [ ] **Step 5: Commit** — `git add src/utils/docBuilder.js test/docBuilder.test.mjs && git commit -m "feat(phase2): 리빙 Doc HTML 빌더 (이스케이프·역순 정렬)"`

---

### Task 4: ArchiveAgent — 항목 생성(순수부) + 에이전트 본체

**Files:**
- Create: `src/agents/ArchiveAgent.js`, `test/archiveEntry.test.mjs`

**Interfaces:**
- Consumes: `getGoogleAuth`(Task 1), `buildMonthDocHtml`(Task 3), 분석 객체(`github-actions-daily.mjs`의 `papers[0]` — FilterAnalyzerAgent 산출: `pmid,title_ko,clinicalQuestion_ko,pico_ko,keyFindings(_ko),evidenceLevel,references,badge*,paper:{title,journal,doi,pmid,pmcid,fullText,fullTextSource,webSources?}`)
  *badge 필드명은 구현 시 `_provenance()` 산출을 grep으로 확인해 정확히 맞출 것(`provenanceBadge` 류).*
- Produces: `toArchiveEntry(analysis, { pdfLink, todayKST }) → entry`(순수, Task 3 스키마),
  `class ArchiveAgent { async run({ analysis, todayKST }) → { ok, pdf, docUpdated, reason? } }`
- 상태 파일: `output/analysis_archive.json` = `{ entries: [...], driveState: { docIds: {"YYYY-MM": id}, folderIds: {"YYYY-MM": id}, pdfFiles: {pmid: fileId} } }` — ArchiveAgent가 GitHub contents API로 자체 커밋(persist).

- [ ] **Step 1: 순수부 실패 테스트 작성**

```js
// test/archiveEntry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toArchiveEntry, upsertEntry, monthOf, pdfFileName } from '../src/agents/ArchiveAgent.js';

const analysis = {
  pmid: '12345', title_ko: '제목', clinicalQuestion_ko: 'Q', pico_ko: {},
  keyFindings: ['a'], keyFindings_ko: ['ㄱ'], evidenceLevel: '1b',
  references: [], provenanceBadge: '본문(PMC)',
  paper: { title: 'T', journal: 'NEJM', doi: '10.1/x', pmid: '12345', fullText: 'body', fullTextSource: 'PMC' },
};

test('toArchiveEntry가 Doc 스키마 필드를 채운다', () => {
  const e = toArchiveEntry(analysis, { pdfLink: 'L', todayKST: '2026-07-06' });
  assert.equal(e.date, '2026-07-06');
  assert.equal(e.pmid, '12345');
  assert.equal(e.pdfLink, 'L');
  assert.equal(e.fullTextSource, 'PMC');
});

test('upsertEntry — 같은 날짜+pmid는 교체(재실행 안전), 다른 건 추가', () => {
  const e1 = { date: '2026-07-06', pmid: '1' };
  const list = upsertEntry([e1], { date: '2026-07-06', pmid: '1', title: 'new' });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'new');
  assert.equal(upsertEntry(list, { date: '2026-07-07', pmid: '2' }).length, 2);
});

test('monthOf·pdfFileName', () => {
  assert.equal(monthOf('2026-07-06'), '2026-07');
  assert.equal(pdfFileName({ date: '2026-07-06', pmid: '12345', title: 'A/B: study?' }),
    '2026-07-06_12345_A-B- study-.pdf'.replace('- s', '-s') /* 구현의 sanitize 규칙과 일치시킬 것 */);
});
```

*(pdfFileName 기대값은 구현한 sanitize 규칙 — `[\\/:*?"<>|]` → `-`, 80자 절단 — 에 맞춰 확정한다)*

- [ ] **Step 2: 실패 확인** — Run: `npm run test:unit` Expected: FAIL
- [ ] **Step 3: 구현** — 아래 골격 전체를 작성한다.

```js
// src/agents/ArchiveAgent.js
/** Phase 2 — 논문 PDF Drive 적재 + 월별 리빙 Doc 갱신 + 아카이브 JSON 자체 커밋.
 *  전 과정 소프트 실패. 재실행 안전(driveState·upsert). 토큰은 로그 금지. */
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/Logger.js';
import { getGoogleAuth } from '../utils/googleAuth.js';
import { buildMonthDocHtml } from '../utils/docBuilder.js';

const ARCHIVE_PATH = path.join(process.cwd(), 'output', 'analysis_archive.json');
const UNPAYWALL = 'https://api.unpaywall.org/v2';
const EPMC_PDF = (pmcid) => `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcid}&blobtype=pdf`;

export const monthOf = (d) => d.slice(0, 7);
export const pdfFileName = ({ date, pmid, title }) =>
  `${date}_${pmid}_${String(title).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)}.pdf`;

export function toArchiveEntry(a, { pdfLink, todayKST }) {
  const p = a.paper ?? {};
  return {
    date: todayKST, pmid: a.pmid ?? p.pmid, title: p.title, title_ko: a.title_ko,
    journal: p.journal, doi: p.doi ?? null, badge: a.provenanceBadge ?? a.badge ?? p.fullTextSource,
    clinicalQuestion_ko: a.clinicalQuestion_ko, pico_ko: a.pico_ko ?? {},
    keyFindings: a.keyFindings ?? [], keyFindings_ko: a.keyFindings_ko ?? [],
    evidenceLevel: a.evidenceLevel ?? null, references: a.references ?? [],
    fullText: p.fullText ?? null, fullTextSource: p.fullTextSource ?? 'abstract-only',
    dossier: buildDossier(a), pdfLink: pdfLink ?? null,
  };
}

/** 페이월(본문 없음) + 웹보강 소스가 있으면 도시에 항목으로 구조화 */
function buildDossier(a) {
  const p = a.paper ?? {};
  if (p.fullText) return null;
  const srcs = a.webSources ?? p.webSources ?? [];
  if (!srcs.length) return null;
  return srcs.map((s) => ({ source: s.label ?? s.source ?? 'web', url: s.url, note: s.note ?? '웹보강 근거' }));
}

export function upsertEntry(entries, entry) {
  const rest = entries.filter((e) => !(e.date === entry.date && e.pmid === entry.pmid));
  return [...rest, entry];
}

export class ArchiveAgent {
  constructor() { this.logger = new Logger('ArchiveAgent', { logFile: 'archive_agent.jsonl' }); }

  async run({ analysis, todayKST }) {
    const auth = await getGoogleAuth({ logger: this.logger });
    if (!auth) return { ok: false, reason: 'google-auth-unset' };
    const drive = google.drive({ version: 'v3', auth });
    const state = await this._loadArchive();
    const month = monthOf(todayKST);

    // 1) 월 폴더 확보(find-or-create, 루트는 GOOGLE_DRIVE_FOLDER_ID)
    const folderId = await this._ensureMonthFolder(drive, state, month);
    // 2) PDF 확보·업로드 (실패해도 계속)
    let pdfLink = null;
    try { pdfLink = await this._uploadPdf(drive, state, analysis, todayKST, folderId); }
    catch (e) { this.logger.warn(`PDF 단계 실패(계속): ${e.message}`); }
    // 3) 아카이브 항목 upsert + 로컬 저장 + 저장소 커밋
    state.entries = upsertEntry(state.entries, toArchiveEntry(analysis, { pdfLink, todayKST }));
    await this._saveArchive(state);
    await this._commitArchiveToRepo();
    // 4) 리빙 Doc 갱신 (그 달 항목 전체 재생성)
    const monthEntries = state.entries.filter((e) => monthOf(e.date) === month);
    const html = buildMonthDocHtml(month, monthEntries);
    await this._upsertMonthDoc(drive, state, month, folderId, html);
    await this._saveArchive(state); // docId 저장 반영
    await this._commitArchiveToRepo();
    return { ok: true, pdf: Boolean(pdfLink), docUpdated: true };
  }

  async _loadArchive() {
    try { return JSON.parse(await readFile(ARCHIVE_PATH, 'utf8')); }
    catch { return { entries: [], driveState: { docIds: {}, folderIds: {}, pdfFiles: {} } }; }
  }
  async _saveArchive(state) {
    await mkdir(path.dirname(ARCHIVE_PATH), { recursive: true });
    await writeFile(ARCHIVE_PATH, JSON.stringify(state, null, 2), 'utf8');
  }

  /** GITHUB_TOKEN contents API로 output/analysis_archive.json을 저장소에 커밋(러너 휘발 대응) */
  async _commitArchiveToRepo() {
    const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) { this.logger.warn('GITHUB_* 미설정 — 아카이브 커밋 생략(로컬 실행)'); return; }
    const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/output/analysis_archive.json`;
    const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'trend-review', Accept: 'application/vnd.github+json' };
    const cur = await fetch(api, { headers });
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const content = Buffer.from(await readFile(ARCHIVE_PATH, 'utf8')).toString('base64');
    const res = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ message: `Archive: ${new Date().toISOString().slice(0, 10)} analysis_archive`, content, ...(sha && { sha }) }) });
    if (!res.ok) throw new Error(`archive 커밋 실패 HTTP ${res.status}`);
  }

  async _ensureMonthFolder(drive, state, month) {
    if (state.driveState.folderIds[month]) return state.driveState.folderIds[month];
    const parent = process.env.GOOGLE_DRIVE_FOLDER_ID || 'root';
    const q = `name='${month}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const found = await drive.files.list({ q, fields: 'files(id)' });
    const id = found.data.files[0]?.id ?? (await drive.files.create({
      requestBody: { name: month, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }, fields: 'id',
    })).data.id;
    state.driveState.folderIds[month] = id;
    return id;
  }

  /** Unpaywall url_for_pdf → EuropePMC 렌더 순서로 PDF 시도. 이미 올린 pmid는 스킵. */
  async _uploadPdf(drive, state, analysis, todayKST, folderId) {
    const p = analysis.paper ?? {};
    const pmid = analysis.pmid ?? p.pmid;
    if (state.driveState.pdfFiles[pmid]) {
      return `https://drive.google.com/file/d/${state.driveState.pdfFiles[pmid]}/view`;
    }
    const url = await this._resolvePdfUrl(p);
    if (!url) { this.logger.info(`OA PDF 없음 (PMID ${pmid}) — 스킵`); return null; }
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) { this.logger.info('PDF 응답 아님 — 스킵'); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) return null; // 오류 페이지 방어
    const { Readable } = await import('stream');
    const file = await drive.files.create({
      requestBody: { name: pdfFileName({ date: todayKST, pmid, title: p.title }), parents: [folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(buf) }, fields: 'id',
    });
    state.driveState.pdfFiles[pmid] = file.data.id;
    this.logger.info(`PDF 적재 완료 (PMID ${pmid})`);
    return `https://drive.google.com/file/d/${file.data.id}/view`;
  }

  async _resolvePdfUrl(p) {
    if (p.doi) {
      try {
        const email = process.env.PUBMED_EMAIL ?? process.env.UNPAYWALL_EMAIL ?? 'research@example.com';
        const r = await fetch(`${UNPAYWALL}/${encodeURIComponent(p.doi)}?email=${encodeURIComponent(email)}`);
        if (r.ok) {
          const j = await r.json();
          const pdf = j.best_oa_location?.url_for_pdf ?? (j.oa_locations ?? []).map((l) => l.url_for_pdf).find(Boolean);
          if (pdf) return pdf;
        }
      } catch (e) { this.logger.warn(`Unpaywall PDF 조회 실패: ${e.message}`); }
    }
    if (p.pmcid) return EPMC_PDF(String(p.pmcid).replace(/^PMC/i, ''));
    return null;
  }

  /** 월 Doc find-or-create 후 HTML→Doc 변환 업데이트 */
  async _upsertMonthDoc(drive, state, month, folderId, html) {
    const { Readable } = await import('stream');
    const media = { mimeType: 'text/html', body: Readable.from(Buffer.from(html, 'utf8')) };
    let docId = state.driveState.docIds[month];
    if (docId) {
      await drive.files.update({ fileId: docId, media });
    } else {
      const created = await drive.files.create({
        requestBody: { name: `Trend Review — ${month}`, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
        media, fields: 'id',
      });
      docId = created.data.id;
      state.driveState.docIds[month] = docId;
    }
    this.logger.info(`리빙 Doc 갱신 완료: ${month}`);
  }
}
```

*구현 시 확인 2건: ① `provenanceBadge` 실제 필드명(`FilterAnalyzerAgent._provenance()` 소스 확인 후 `toArchiveEntry` 정합), ② 웹보강 소스 배열의 실제 필드명(동일 파일). 테스트 기대값도 함께 정렬.*

- [ ] **Step 4: 통과 확인** — Run: `npm run test:unit` Expected: PASS (누적 9건 내외)
- [ ] **Step 5: Commit** — `git add src/agents/ArchiveAgent.js test/archiveEntry.test.mjs && git commit -m "feat(phase2): ArchiveAgent — PDF·Drive·아카이브·리빙 Doc"`

---

### Task 5: 데일리 진입점·워크플로우 편입

**Files:**
- Modify: `github-actions-daily.mjs` (카카오 블록 뒤, jobSummary 이전)
- Modify: `.github/workflows/daily-review.yml` (env 4줄 추가)

**Interfaces:**
- Consumes: `ArchiveAgent.run({ analysis: papers[0], todayKST })`

- [ ] **Step 1: 진입점 블록 추가** — 카카오 try/catch 블록(112~125행 부근) 아래에:

```js
// ── Phase 2: Drive 아카이브 + 리빙 Doc (소프트 실패) ────────────────────────
let archiveStatus = '미설정';
try {
  const { ArchiveAgent } = await import('./src/agents/ArchiveAgent.js');
  const r = await new ArchiveAgent().run({ analysis: papers[0], todayKST });
  archiveStatus = r.ok ? `완료 (PDF ${r.pdf ? '적재' : '없음'} · Doc 갱신)` : `건너뜀: ${r.reason}`;
} catch (err) {
  archiveStatus = `실패: ${err.message.slice(0, 120)}`;
  console.log(`::warning::Phase 2 아카이브 실패 — ${err.message.slice(0, 200)}`);
}
```

그리고 jobSummary 배열에 `` `- 아카이브: ${archiveStatus}`, `` 한 줄 추가.

- [ ] **Step 2: 워크플로우 env 추가** — `Run daily review pipeline` step env에:

```yaml
          GOOGLE_CLIENT_ID:     ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          GOOGLE_REFRESH_TOKEN: ${{ secrets.GOOGLE_REFRESH_TOKEN }}
          GOOGLE_DRIVE_FOLDER_ID: ${{ vars.GOOGLE_DRIVE_FOLDER_ID }}
```

- [ ] **Step 3: 문법·회귀 확인** — Run: `node --check github-actions-daily.mjs && npm run test:unit && npm run spec-lint` Expected: 전부 통과
- [ ] **Step 4: Commit** — `git commit -am "feat(phase2): 데일리 파이프라인에 ArchiveAgent 편입 (소프트 실패)"`

---

### Task 6: REPORT_SPEC 4-E 조항 + spec-lint 확장

**Files:**
- Modify: `REPORT_SPEC.md` (4-D 뒤에 4-E 추가), `scripts/spec-lint.mjs`

- [ ] **Step 1: REPORT_SPEC에 4-E 추가** — 내용: 하이브리드 구조(리빙 Doc 자동층 + PDF 보강층 주 1회 수동), 3티어 표, 자료는 자체 문서만(타인 파일 수집 금지), 상태 파일 `output/analysis_archive.json`(커밋 대상), Secrets 4종, 소프트 실패 원칙. 변경 이력에 한 줄 추가.
- [ ] **Step 2: spec-lint 확장** — 기존 "상태파일 gitignore 회귀" 검사 목록에 `output/analysis_archive.json` 추가 + `credentials.json`·`output/google_token.json`은 **반드시 gitignore에 있어야 함**(반대 방향) 검사 추가.
- [ ] **Step 3: 확인** — Run: `npm run spec-lint` Expected: 통과. (일부러 .gitignore에서 google_token 줄을 지우고 실행 → FAIL 확인 후 원복)
- [ ] **Step 4: Commit** — `git commit -am "docs(phase2): REPORT_SPEC 4-E + spec-lint 확장 (아카이브·시크릿 파일 게이트)"`

---

### Task 7: 통합 검증 (데스크탑 데이 이후, 실환경)

- [ ] Secrets 등록 완료 상태에서 `workflow_dispatch` 실행
- [ ] 확인: job summary에 `아카이브: 완료`, Drive에 `YYYY-MM/` 폴더 + PDF(OA인 날) + `Trend Review — YYYY-MM` Doc
- [ ] NotebookLM: 노트북에 당월 Doc 소스 추가(1회) → 몇 분 후 당일 논문 내용 질문 → 정상 인용 응답 확인
- [ ] 같은 워크플로우 재실행 → Drive에 중복 파일·Doc 없음, analysis_archive.json 항목 1개 유지 확인
- [ ] 결과(스크린샷·로그 요지)를 PR/이슈에 기록

## Self-Review 결과

- 스펙 §2(인증·체크리스트)=Task 1·2, §3.1~3.3(티어·Doc·에이전트)=Task 3·4, 편입·타임라인=Task 5, §8(게이트)=Task 6, §3.4(완료 기준)=Task 7 — 커버 확인.
- 미해결 확인 2건은 Task 4에 명시(배지·웹소스 필드명 — 구현 시 grep 확인). 그 외 placeholder 없음.
- `esc`·`buildMonthDocHtml`·`toArchiveEntry`·`upsertEntry` 시그니처가 Task 3↔4↔5 간 일치함.
