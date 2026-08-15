import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyGuidelineRun } from '../src/utils/guidelineManifest.js';

const state = { published: [{ id: 'pmid:1' }] };
const html = '<article class="guideline-card" id="pmid:1" data-guideline-id="pmid:1"></article>';
const manifest = { pubmed: { queriesAttempted: 1, ptPmids: [], queries: [] }, orgSources: { attempted: 0, failed: 0 } };
const codes = (result) => result.findings.map((x) => x.code);

test('정상 실행은 ok:true', () => assert.equal(verifyGuidelineRun({ state, html, manifest }).ok, true));
test('manifest 누락', () => assert.ok(codes(verifyGuidelineRun({ state, html, manifest: null })).includes('manifest-missing')));
test('실행했지만 source attempt 0건', () => assert.ok(codes(verifyGuidelineRun({ state, html, manifest: { pubmed: { ptPmids: [] }, orgSources: [] } })).includes('source-attempts-zero')));
test('published 상태 카드가 HTML에 없음', () => assert.ok(codes(verifyGuidelineRun({ state, html: '', manifest })).includes('published-card-missing')));
test('HTML 카드에 대응하는 상태 전이가 없음', () => assert.ok(codes(verifyGuidelineRun({ state: { published: [] }, html, manifest })).includes('html-card-without-state')));
test('일부 source 실패는 warn이고 정상 여부를 깨지 않는다', () => {
  const result = verifyGuidelineRun({ state, html, manifest: { ...manifest, orgSources: { attempted: 1, failed: 1 } } });
  assert.equal(result.ok, true);
  assert.equal(result.findings.find((x) => x.code === 'source-partial-failure')?.severity, 'warn');
});
test('직렬화된 manifest에서 ptPmids가 사라지면 error', () => {
  const result = verifyGuidelineRun({ state, html, manifest: { pubmed: { queriesAttempted: 1 }, orgSources: { attempted: 0 } } });
  assert.equal(result.findings.find((x) => x.code === 'pubmed-pt-evidence-missing')?.severity, 'error');
});

// ── 세션 검수에서 추가한 것 ────────────────────────────────────────────────
// 기존 테스트는 finding **코드**만 봤다. 그래서 모든 severity 를 error→warn 으로
// 강등하는 변이가 초록으로 통과했다 — 관제가 소리를 안 내게 만드는 변이인데도.
// 심각도와 `ok` 를 같이 못 박는다.

test('★ 상태-HTML 불일치는 warn 이 아니라 error 이고 ok=false 다', () => {
  const state = {
    schemaVersion: 2, queue: [], published: [{ id: 'pmid:1', pmid: '1', status: 'current' }],
    rejected: [], sourceHealth: {},
    lastRun: { runId: 'r', outcome: 'published', publishedId: 'pmid:1',
      manifest: { pubmed: { ptPmids: ['1'] }, orgSources: {} } },
    updatedAt: 'x', configVersion: 'guideline-v2',
  };
  const result = verifyGuidelineRun({ state, html: '<html><body></body></html>', manifest: state.lastRun.manifest });
  assert.equal(result.ok, false, '카드가 없는데 통과하면 관제가 죽은 것이다');
  const finding = result.findings.find((f) => f.code === 'published-card-missing');
  assert.ok(finding, 'published-card-missing 을 못 잡았다');
  assert.equal(finding.severity, 'error', '강등되면 아무도 안 본다');
});

test('★ 초집합 근거 소실도 error 이고 ok=false 다', () => {
  const state = {
    schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {},
    lastRun: { runId: 'r', outcome: 'empty', publishedId: null,
      manifest: { pubmed: { queries: [{ id: 'pubmed-pt', succeeded: true, idsFetched: 3 }] }, orgSources: { a: {} } } },
    updatedAt: 'x', configVersion: 'guideline-v2',
  };
  const result = verifyGuidelineRun({ state, html: '<html></html>', manifest: state.lastRun.manifest });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.severity === 'error'),
    '근거가 사라졌는데 error 가 하나도 없다 — 검사한 척만 하게 된다');
});
