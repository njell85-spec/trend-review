/**
 * 사용자 제공 본문 통로 (`on-demand` 입력 `sourceText` → `OD_SOURCE_TEXT`) — 회귀 테스트.
 *
 * 이 통로의 실패 모드는 셋이다:
 *   ① 빈 입력/오타가 원래 초록을 덮어써서 카드가 오히려 더 나빠진다.
 *   ② 본문을 얹어 다시 돌려도 **얇은 첫 결과가 캐시에서 재사용**된다(사용자는 원인을 못 본다).
 *   ③ 데일리 코어(가이드라인 경로)의 캐시키가 흔들려 매일 캐시 미스가 난다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUserText, MIN_TEXT_LEN, MAX_TEXT_LEN } from '../src/utils/userSuppliedText.js';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';

const DOC = {
  pmid: '42555934',
  title: 'Syncope.',
  abstract: 'Short abstract.',
  fullText: '',
  fullTextSource: 'abstract-only',
  fullTextLength: 0,
};

const LONG = 'Vasovagal syncope: systolic BP <= 80 mm Hg, HR < 40 bpm, asystole >= 3 s. '.repeat(10);

// ── ① 입력 검증 ──────────────────────────────────────────────────────────────

test('빈 입력이면 문서를 건드리지 않는다 (초록 보존)', () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = applyUserText(DOC, v);
    assert.equal(r.applied, false);
    assert.equal(r.doc, DOC, '입력 그대로(참조 동일)를 돌려줘야 한다');
    assert.equal(r.doc.fullTextSource, 'abstract-only');
  }
});

test('너무 짧은 입력은 무시한다 — 오타가 초록을 덮어쓰지 못하게', () => {
  const r = applyUserText(DOC, 'x'.repeat(MIN_TEXT_LEN - 1));
  assert.equal(r.applied, false);
  assert.equal(r.reason, 'too_short');
  assert.equal(r.doc.fullText, '');
});

test('충분히 긴 본문은 fullText 로 얹고 출처를 user-supplied 로 표시한다', () => {
  const r = applyUserText(DOC, LONG);
  assert.equal(r.applied, true);
  assert.equal(r.doc.fullText, LONG.trim());
  assert.equal(r.doc.fullTextSource, 'user-supplied');
  assert.equal(r.doc.fullTextLength, LONG.trim().length,
    'fullTextLength 를 갱신해야 PICO 캐시키가 새 본문을 인식한다');
  assert.equal(DOC.fullText, '', '원본 문서를 변형하면 안 된다(불변)');
});

test('상한을 넘는 본문은 잘라서 넣는다 (LLM 컨텍스트 보호)', () => {
  const r = applyUserText(DOC, 'a'.repeat(MAX_TEXT_LEN + 5000));
  assert.equal(r.doc.fullText.length, MAX_TEXT_LEN);
  assert.equal(r.doc.fullTextLength, MAX_TEXT_LEN);
});

// ── ② 캐시키 ────────────────────────────────────────────────────────────────

const agent = new GuidelineAnalyzerAgent();

test('본문을 얹으면 캐시키가 달라진다 — 얇은 첫 결과 재사용 방지', () => {
  const thin = agent._cacheKey(DOC, 'reference');
  const thick = agent._cacheKey(applyUserText(DOC, LONG).doc, 'reference');
  assert.notEqual(thin, thick);
});

test('본문 내용이 다르면 캐시키도 다르다 (길이만 같아도 갈려야 한다)', () => {
  const a = agent._cacheKey(applyUserText(DOC, LONG).doc, 'reference');
  const b = agent._cacheKey(applyUserText(DOC, LONG.replace(/80/g, '90')).doc, 'reference');
  assert.notEqual(a, b);
});

test('본문 없는 기존 경로의 캐시키는 종전과 완전히 동일하다 (데일리 코어 불변식)', () => {
  // 접미사가 붙지 않아야 한다 — 붙으면 데일리 가이드라인이 매일 캐시 미스를 낸다.
  assert.equal(agent._cacheKey(DOC, 'guideline'),
    `guideline_v5_${agent.provider}_${agent.model}_42555934`);
  // fullText 가 있어도 출처가 user-supplied 가 아니면 종전 키 그대로.
  const pmc = { ...DOC, fullText: LONG, fullTextSource: 'PMC' };
  assert.equal(agent._cacheKey(pmc, 'guideline'), agent._cacheKey(DOC, 'guideline'));
});

// ── ③ 배선 ──────────────────────────────────────────────────────────────────

test('on-demand 워크플로우가 sourceText 를 OD_SOURCE_TEXT 로 넘긴다', async () => {
  const yml = await (await import('fs/promises')).readFile('.github/workflows/on-demand.yml', 'utf8');
  assert.match(yml, /sourceText:/, '워크플로우 입력이 없으면 폰에서 쓸 수 없다');
  assert.match(yml, /OD_SOURCE_TEXT:\s*\$\{\{ inputs\.sourceText \}\}/,
    'env 로 넘기지 않으면 스크립트가 못 읽는다 (run 에 직접 보간하면 셸 인젝션)');
});

test('on-demand 스크립트가 사용자 제공 본문을 실제로 적용한다', async () => {
  const src = await (await import('fs/promises')).readFile('scripts/on-demand.mjs', 'utf8');
  assert.match(src, /applyUserText\(enriched, process\.env\.OD_SOURCE_TEXT\)/);
  assert.match(src, /enriched = r\.doc/, '결과를 다시 대입하지 않으면 조용히 무시된다');
});
