# R3 아카이브 자동화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NotebookLM 아카이브 데이터 확정안(HANDOFF §3 개정: a 분석 Doc + b′ 전문 Doc + c 웹 레퍼런스 수집)과 소스 등록 자동화(notebooklm-py + 카톡 리마인더 폴백)를 구현한다.

**Architecture:** ArchiveAgent가 기존 월별 분석 Doc에 더해 **월별 전문(全文) Doc**(plain text)을 유지한다. 전문 Doc은 append-only(pmid 단위 1회) — Drive `files.export(text/plain)` → 섹션 덧붙임 → `files.update(text/plain)` 방식이라 **Docs API·추가 스코프 불필요**. OA 논문은 이미 아카이브 항목에 있는 `fullText`를 쓰고, 페이월 논문은 dossier의 권위 웹 레퍼런스 URL 본문을 러너에서 fetch·텍스트화해 넣는다(**저장소에는 절대 커밋하지 않음 — 공개 repo 재배포 금지, Drive 비공개 Doc으로만**). 월 1일 워크플로우가 notebooklm-py로 새 달 Doc 2개를 노트북에 자동 등록하고, 실패·미설정 시 카톡 리마인더를 보낸다(소프트 실패, 데일리 코어 무영향).

**Tech Stack:** Node 20(googleapis 기존 의존만, 신규 npm 의존 0) · Python 3.12 + notebooklm-py(월 1회 워크플로우에서만) · GitHub Actions cron.

## Global Constraints

- **데일리 코어 무영향**(HANDOFF §4): 모든 신규 단계는 소프트 실패. `daily-review.yml`은 수정하지 않는다.
- **공개 repo에 타인 저작물 텍스트 신규 커밋 금지**: 웹 레퍼런스 본문·추출 텍스트는 Drive Doc으로만 보낸다. `analysis_archive.json`에 새 본문 필드를 추가하지 않는다.
- spec-lint 고정 문구("절대 새로운 수치를 만들지 마라", `privacyStatus: 'private'`) 불변.
- 시크릿·토큰을 로그/argv에 노출하지 않는다.
- 상태 추가는 `driveState` 안에만: `fulltextDocIds: {"YYYY-MM": docId}`, `fulltextDone: {"YYYY-MM": [pmid,...]}`.
- 신규 Secrets/Variables(PeterJ 셋업): `NOTEBOOKLM_AUTH_STATE`(secret, notebooklm-py 인증 상태 JSON), `NOTEBOOKLM_NOTEBOOK_ID`(variable). 미설정 시 등록 스킵→리마인더.

---

### Task 1: fulltextDoc 순수부 (`src/utils/fulltextDoc.js`)

**Files:**
- Create: `src/utils/fulltextDoc.js`
- Test: `test/fulltextDoc.test.mjs`

**Interfaces:**
- Produces: `fulltextDocName(month) -> string` (= `Trend Review 전문 — ${month}`),
  `htmlToText(html, cap=40000) -> string`,
  `fulltextSectionText(entry, webTexts=[]) -> string|null` (넣을 본문이 없으면 null),
  `docUrlOf(docId) -> string` (= `https://docs.google.com/document/d/${docId}/edit`)

- [ ] **Step 1: 실패하는 테스트 작성** (`test/fulltextDoc.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fulltextDocName, htmlToText, fulltextSectionText, docUrlOf } from '../src/utils/fulltextDoc.js';

test('fulltextDocName/docUrlOf 형식', () => {
  assert.equal(fulltextDocName('2026-07'), 'Trend Review 전문 — 2026-07');
  assert.equal(docUrlOf('abc'), 'https://docs.google.com/document/d/abc/edit');
});

test('htmlToText: script/style 제거·태그 소거·공백 축약·상한', () => {
  const html = '<html><head><style>.x{}</style><script>var a=1<2;</script></head><body><h1>T</h1><p>hello&amp;world</p><div>next</div></body></html>';
  const t = htmlToText(html);
  assert.ok(!t.includes('var a'));
  assert.ok(!t.includes('.x{}'));
  assert.ok(t.includes('hello&world'));
  assert.ok(t.includes('T'));
  assert.equal(htmlToText(`<p>${'a'.repeat(50)}</p>`, 10).length, 10);
});

test('fulltextSectionText: fullText 있으면 섹션, 없고 webTexts 있으면 레퍼런스 섹션, 둘 다 없으면 null', () => {
  const base = { date: '2026-07-06', pmid: '1', title: 'T', journal: 'J' };
  const withFt = fulltextSectionText({ ...base, fullText: 'BODY', fullTextSource: 'PMC' });
  assert.ok(withFt.includes('PMID 1') && withFt.includes('BODY') && withFt.includes('PMC'));
  const withWeb = fulltextSectionText(base, [{ source: 'S', url: 'https://e.x', text: 'WEBBODY' }]);
  assert.ok(withWeb.includes('WEBBODY') && withWeb.includes('https://e.x'));
  assert.equal(fulltextSectionText(base, []), null);
});
```

- [ ] **Step 2: 실패 확인** — `node --test test/fulltextDoc.test.mjs` → `Cannot find module` FAIL
- [ ] **Step 3: 구현**

```js
/**
 * fulltextDoc — 월별 전문(全文) Doc(plain text)용 순수부.
 * 전문 텍스트는 Drive 비공개 Doc으로만 보낸다 — 공개 repo에 커밋 금지(§3 비공개층 한정 수집).
 */
export const fulltextDocName = (month) => `Trend Review 전문 — ${month}`;
export const docUrlOf = (docId) => `https://docs.google.com/document/d/${docId}/edit`;

export function htmlToText(html, cap = 40000) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
    .slice(0, cap);
}

/** 항목 1건의 전문 섹션(plain text). 넣을 본문이 없으면 null. */
export function fulltextSectionText(e, webTexts = []) {
  const head = `\n\n========================================\n[${e.date}] PMID ${e.pmid} — ${e.title}\n${e.journal ?? ''}\n========================================\n`;
  if (e.fullText) return `${head}(본문 출처: ${e.fullTextSource ?? '확보 본문'})\n\n${e.fullText}`;
  const parts = (webTexts ?? []).filter((w) => w?.text);
  if (!parts.length) return null;
  const body = parts.map((w) => `--- 권위 웹 레퍼런스: ${w.source} (${w.url}) ---\n${w.text}`).join('\n\n');
  return `${head}(페이월 — 권위 웹 레퍼런스 본문 수집)\n\n${body}`;
}
```

- [ ] **Step 4: 통과 확인** — `node --test test/fulltextDoc.test.mjs` → 3 pass
- [ ] **Step 5: Commit** — `feat(archive): 전문 Doc 순수부(fulltextDoc) — 섹션 생성·HTML 텍스트화`

### Task 2: 웹 레퍼런스 수집기 (`src/utils/webRefText.js`)

**Files:**
- Create: `src/utils/webRefText.js`
- Test: `test/webRefText.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `htmlToText`
- Produces: `fetchRefTexts(dossier, {fetchImpl, capPerRef, timeoutMs}) -> Promise<[{source,url,text}]>` — URL별 소프트 실패(실패 항목은 제외), HTML만 텍스트화

- [ ] **Step 1: 실패하는 테스트** (`test/webRefText.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRefTexts } from '../src/utils/webRefText.js';

const ok = (body, type = 'text/html') => Promise.resolve({
  ok: true, headers: { get: () => type }, text: () => Promise.resolve(body),
});

test('fetchRefTexts: HTML은 텍스트화, 실패 URL은 조용히 제외, 비HTML 제외', async () => {
  const dossier = [
    { source: 'A', url: 'https://a.x' },
    { source: 'B', url: 'https://b.x' },
    { source: 'C', url: 'https://c.x' },
  ];
  const fetchImpl = (url) =>
    url.includes('a.x') ? ok('<p>alpha body</p>')
    : url.includes('b.x') ? Promise.reject(new Error('net'))
    : ok('%PDF-1.4', 'application/pdf');
  const out = await fetchRefTexts(dossier, { fetchImpl });
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'A');
  assert.ok(out[0].text.includes('alpha body'));
});

test('fetchRefTexts: dossier 비면 빈 배열', async () => {
  assert.deepEqual(await fetchRefTexts(null, {}), []);
});
```

- [ ] **Step 2: 실패 확인** — `node --test test/webRefText.test.mjs` FAIL
- [ ] **Step 3: 구현**

```js
/**
 * webRefText — 페이월 논문의 권위 웹 레퍼런스(dossier) 본문 수집.
 * 결과는 Drive 전문 Doc으로만 감 — repo 커밋 금지. URL별 소프트 실패.
 */
import { htmlToText } from './fulltextDoc.js';

export async function fetchRefTexts(dossier, { fetchImpl = fetch, capPerRef = 40000, timeoutMs = 20000 } = {}) {
  const out = [];
  for (const d of dossier ?? []) {
    try {
      const res = await fetchImpl(d.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'trend-review-archive (personal research archive)' },
      });
      const ctype = res.headers.get('content-type') ?? '';
      if (!res.ok || !ctype.includes('html')) continue;
      const text = htmlToText(await res.text(), capPerRef);
      if (text.length > 200) out.push({ source: d.source, url: d.url, text });
    } catch { /* URL별 소프트 실패 — 다음 레퍼런스로 */ }
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** → 2 pass
- [ ] **Step 5: Commit** — `feat(archive): 권위 웹 레퍼런스 본문 수집기(webRefText) — URL별 소프트 실패`

### Task 3: ArchiveAgent에 전문 Doc append 통합

**Files:**
- Modify: `src/agents/ArchiveAgent.js` (`run()` 말미 + 신규 `_appendFulltextDoc`)
- Test: 기존 `test/archive.test.mjs`에 상태 헬퍼 회귀 추가는 불필요(순수부는 Task 1·2에서 검증) — 통합부는 소프트 실패 구조 유지가 핵심

**Interfaces:**
- Consumes: `fulltextDocName/fulltextSectionText/docUrlOf`(Task 1), `fetchRefTexts`(Task 2)
- Produces: `driveState.fulltextDocIds[month]`, `driveState.fulltextDone[month]`(pmid 배열) — Task 4의 등록 스크립트가 `docIds`·`fulltextDocIds`를 읽는다

- [ ] **Step 1: `_loadArchive` 기본값에 `fulltextDocIds: {}, fulltextDone: {}` 추가**
- [ ] **Step 2: `run()`에서 리빙 Doc 갱신 뒤 소프트 호출**

```js
    let fulltextUpdated = false;
    try {
      fulltextUpdated = await this._appendFulltextDoc(drive, state, month, folderId, todayKST);
      await this._saveArchive(state); // fulltextDocId·fulltextDone 반영
    } catch (e) {
      this.logger.warn(`전문 Doc 갱신 실패(다음 실행에서 재시도): ${e.message}`);
    }
    return { ok: true, pdf: Boolean(pdfLink), docUpdated, fulltextUpdated };
```

- [ ] **Step 3: `_appendFulltextDoc` 구현** — append-only(월·pmid 1회), export+update 방식

```js
  /**
   * 월별 전문 Doc(plain text) append — pmid당 1회(fulltextDone). OA는 entry.fullText,
   * 페이월은 dossier 웹 레퍼런스 본문 수집(fetchRefTexts). 본문은 Drive Doc으로만
   * 보낸다(공개 repo 커밋 금지 — §3 비공개층 한정 수집). drive.file 스코프로 충분:
   * 앱 생성 Doc의 files.export(text/plain) → 덧붙임 → files.update(text/plain).
   */
  async _appendFulltextDoc(drive, state, month, folderId, todayKST) {
    const done = new Set(state.driveState.fulltextDone[month] ?? []);
    const targets = state.entries.filter(
      (e) => monthOf(e.date) === month && e.pmid && !done.has(e.pmid));
    if (!targets.length) return false;

    let docId = state.driveState.fulltextDocIds[month] ?? null;
    if (!docId) {
      const name = fulltextDocName(month);
      const found = await drive.files.list({
        q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document' and '${folderId}' in parents and trashed=false`,
        fields: 'files(id)',
      });
      docId = found.data.files?.[0]?.id ?? null;
    }

    let appended = 0;
    let body = '';
    if (docId) {
      const cur = await drive.files.export({ fileId: docId, mimeType: 'text/plain' }, { responseType: 'text' });
      body = String(cur.data ?? '');
    } else {
      body = `${fulltextDocName(month)}\n개인 연구용 비공개 아카이브 — 본문·권위 레퍼런스 수집(사적 이용 복제).`;
    }
    for (const e of targets) {
      const webTexts = e.fullText ? [] : await fetchRefTexts(e.dossier, {});
      const section = fulltextSectionText(e, webTexts);
      done.add(e.pmid); // 본문 없음도 '처리됨' — 매일 재fetch 방지
      if (!section) continue;
      body += section;
      appended += 1;
    }
    state.driveState.fulltextDone[month] = [...done];
    if (!appended && docId) return false;

    const media = { mimeType: 'text/plain', body: Readable.from(Buffer.from(body, 'utf8')) };
    if (docId) {
      await drive.files.update({ fileId: docId, media });
    } else {
      const created = await drive.files.create({
        requestBody: { name: fulltextDocName(month), mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
        media, fields: 'id',
      });
      docId = created.data.id;
    }
    state.driveState.fulltextDocIds[month] = docId;
    this.logger.info(`전문 Doc 갱신: ${month} (+${appended}편, 총 ${(body.length / 1024).toFixed(0)}KB)`);
    return true;
  }
```

- [ ] **Step 4: import 추가** — `import { fulltextDocName, fulltextSectionText } from '../utils/fulltextDoc.js';` `import { fetchRefTexts } from '../utils/webRefText.js';`
- [ ] **Step 5: 전체 테스트** — `npm run test:unit` 전건 통과 + `npm run spec-lint`
- [ ] **Step 6: Commit** — `feat(archive): 월별 전문 Doc append-only 통합 — OA 본문 + 페이월 웹 레퍼런스(소프트 실패)`

### Task 4: NotebookLM 월 1회 등록 워크플로우 + 카톡 리마인더 폴백

**Files:**
- Create: `scripts/notebooklm-register.py` (notebooklm-py 사용)
- Create: `scripts/notebooklm-remind.mjs` (카톡 리마인더)
- Modify: `src/agents/KakaoNotifier.js` (범용 `sendNotice` 추가)
- Create: `.github/workflows/notebooklm-sync.yml` (cron 매월 1일 09:00 KST + dispatch)
- Test: `test/kakao.test.mjs`(존재 시) 또는 신규 — sendNotice 미설정 게이트

**Interfaces:**
- Consumes: `analysis_archive.json`의 `driveState.docIds`·`fulltextDocIds`(Task 3)
- Produces: 워크플로우 — 등록 성공 시 종료 / 실패·미설정 시 리마인더 발송

- [ ] **Step 1: KakaoNotifier.sendNotice** (isConfigured 게이트 + `_postMemo` 재사용)

```js
  // ── 발송 (범용 공지 — NotebookLM 리마인더 등) ─────────────────────────────────
  async sendNotice({ text, url }) {
    if (!this.isConfigured) {
      this.logger.info('Kakao 미설정 — 공지 발송 생략');
      return { sent: false, reason: 'not-configured' };
    }
    await this._postMemo(text, url || 'https://njell85-spec.github.io/trend-review/');
    await this._notifyRotation();
    return { sent: true };
  }
```

- [ ] **Step 2: `scripts/notebooklm-remind.mjs`** — 이번 달 Doc 2개 링크를 읽어 짧은 리마인더 발송

```js
#!/usr/bin/env node
/** NotebookLM 소스 등록 리마인더 (자동 등록 실패/미설정 폴백) — 월 1일 notebooklm-sync.yml */
import { readFile } from 'fs/promises';
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';
import { docUrlOf } from '../src/utils/fulltextDoc.js';
import { todayKST } from '../src/utils/dates.js';

const month = todayKST().slice(0, 7);
const j = JSON.parse(await readFile('output/analysis_archive.json', 'utf8').catch(() => '{}'));
const ds = j.driveState ?? {};
const a = ds.docIds?.[month]; const f = ds.fulltextDocIds?.[month];
const lines = [`[trend-review] ${month} NotebookLM 연결 리마인더`,
  'notebooklm.google.com에서 소스 추가:',
  a ? `분석 Doc: ${docUrlOf(a)}` : '분석 Doc: (아직 생성 전 — 이달 첫 실행 후 재확인)',
  f ? `전문 Doc: ${docUrlOf(f)}` : '전문 Doc: (아직 생성 전)'];
await new KakaoNotifier().sendNotice({ text: lines.join('\n').slice(0, 195), url: a ? docUrlOf(a) : undefined });
console.log('리마인더 발송 시도 완료');
```

- [ ] **Step 3: `scripts/notebooklm-register.py`** — 소스 자동 등록(비공식 API, 소프트)

```python
#!/usr/bin/env python3
"""NotebookLM 소스 자동 등록 (notebooklm-py, 비공식 — HANDOFF §3 PeterJ 리스크 수용).
실패 시 exit 1 → 워크플로우가 카톡 리마인더 폴백. 인증 상태는 NOTEBOOKLM_AUTH_STATE
secret을 러너 파일로 복원(경로는 NOTEBOOKLM_STORAGE 환경변수로 지정).
※ 라이브러리 인터페이스는 README 기준 — 첫 실전(월 1일) 전 workflow_dispatch로 검증 필요.
"""
import asyncio, json, os, sys

async def main():
    from notebooklm import NotebookLMClient  # pip install notebooklm-py
    nb_id = os.environ["NOTEBOOKLM_NOTEBOOK_ID"]
    with open("output/analysis_archive.json") as fp:
        ds = json.load(fp).get("driveState", {})
    month = os.environ["TARGET_MONTH"]
    urls = [f"https://docs.google.com/document/d/{i}/edit"
            for i in [ds.get("docIds", {}).get(month), ds.get("fulltextDocIds", {}).get(month)] if i]
    if not urls:
        print(f"{month} Doc 없음 — 등록할 것 없음"); return
    client = await NotebookLMClient.from_storage(os.environ.get("NOTEBOOKLM_STORAGE"))
    for u in urls:
        await client.sources.add_url(nb_id, u, wait=True)
        print(f"등록 완료: {u}")

asyncio.run(main())
```

- [ ] **Step 4: `.github/workflows/notebooklm-sync.yml`**

```yaml
# NotebookLM 소스 자동 등록 (매월 1일 09:00 KST) — 실패/미설정 시 카톡 리마인더 폴백.
# 비공식 notebooklm-py 사용(HANDOFF §3 — 소프트 실패, 데일리 코어 무영향).
name: NotebookLM Sync (월 1회)
on:
  schedule:
    - cron: '0 0 1 * *'   # 매월 1일 00:00 UTC = 09:00 KST
  workflow_dispatch:
permissions:
  contents: read
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - id: month
        run: echo "m=$(TZ=Asia/Seoul date +%Y-%m)" >> "$GITHUB_OUTPUT"
      - name: Register sources (notebooklm-py)
        id: register
        if: ${{ vars.NOTEBOOKLM_NOTEBOOK_ID != '' }}
        continue-on-error: true
        env:
          NOTEBOOKLM_NOTEBOOK_ID: ${{ vars.NOTEBOOKLM_NOTEBOOK_ID }}
          NOTEBOOKLM_AUTH_STATE: ${{ secrets.NOTEBOOKLM_AUTH_STATE }}
          NOTEBOOKLM_STORAGE: ${{ runner.temp }}/nblm-auth.json
          TARGET_MONTH: ${{ steps.month.outputs.m }}
        run: |
          if [ -z "$NOTEBOOKLM_AUTH_STATE" ]; then echo "auth secret 없음"; exit 1; fi
          printf '%s' "$NOTEBOOKLM_AUTH_STATE" > "$NOTEBOOKLM_STORAGE"
          pip install --quiet notebooklm-py
          python scripts/notebooklm-register.py
      - uses: actions/setup-node@v4
        if: ${{ vars.NOTEBOOKLM_NOTEBOOK_ID == '' || steps.register.outcome != 'success' }}
        with: { node-version: '20', cache: 'npm' }
      - name: Kakao reminder fallback
        if: ${{ vars.NOTEBOOKLM_NOTEBOOK_ID == '' || steps.register.outcome != 'success' }}
        env:
          KAKAO_REST_API_KEY: ${{ secrets.KAKAO_REST_API_KEY }}
          KAKAO_REFRESH_TOKEN: ${{ secrets.KAKAO_REFRESH_TOKEN }}
          KAKAO_CLIENT_SECRET: ${{ secrets.KAKAO_CLIENT_SECRET }}
        run: npm ci --omit=dev --ignore-scripts && node scripts/notebooklm-remind.mjs
```

- [ ] **Step 5: 테스트·린트** — `npm run test:unit` + `npm run spec-lint` 통과, sendNotice 미설정 게이트 단위 테스트 1건
- [ ] **Step 6: Commit** — `feat(notebooklm): 월 1회 소스 자동 등록(notebooklm-py) + 카톡 리마인더 폴백`

### Task 5: 문서 갱신 (REPORT_SPEC §4-E · HANDOFF)

**Files:**
- Modify: `REPORT_SPEC.md` §4-E (수집 범위 개정 + 등록 자동화 + 변경 이력)
- Modify: `docs/HANDOFF.md` §5·§10 (R3 진행 상태, R5 품질 레버 노트: 대본 프롬프트에 fullText·dossier 컨텍스트 추가 옵션)

- [ ] **Step 1: REPORT_SPEC §4-E** — "하이브리드(주 1회 수동)" 문구를 개정안으로 교체: 전문 Doc(b′)·웹 레퍼런스 수집(c)·notebooklm-sync.yml(월 1일 자동 등록 + 리마인더 폴백)·비공개층 수집 원칙(공개 발신물 재구성 원칙 유지) 반영, 변경 이력 1줄.
- [ ] **Step 2: HANDOFF §5·§10** — R3 구현 완료 기록 + PeterJ 셋업 항목(B 목록에 NOTEBOOKLM_* 시크릿·노트북 ID) 추가.
- [ ] **Step 3: spec-lint + 전체 테스트 → Commit** — `docs(spec): §4-E 아카이브 수집 개정(전문 Doc·웹 레퍼런스·등록 자동화) 반영`

## Self-Review 결과

- 스펙 커버리지: b′(Task 1·3), c(Task 2·3), 등록 자동화(Task 4), 리마인더(Task 4), 문서(Task 5) — 누락 없음. a는 기존 코드 그대로.
- 플레이스홀더 없음. 타입 일관성: `fulltextDocIds/fulltextDone` 명칭 Task 3↔4 일치, `docUrlOf` Task 1↔4 일치.
- 알려진 불확실성(명시): notebooklm-py의 `from_storage()` 시그니처·인증 상태 파일 포맷은 README 수준 확인 — **PeterJ 셋업 시 workflow_dispatch로 실검증**이 계획에 포함됨(실패해도 리마인더 폴백이 안전망).
