import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';

// 스펙 §5.4 — 선정 증거 영속화.
// F1 이 4주간 은폐된 직접 원인은 버그가 아니라 **로그가 실행 증거가 아닌 플래그를
// 찍은 것**이었다. 로그를 정직하게 고쳐도 Actions 로그는 90일이면 사라지므로,
// "그날 재순위가 실제로 돌았나"를 사후에 물을 수 있는 유일한 기반은 이 상태 파일이다.
// 기존 소비자는 `.pmid` 만 읽으므로(`_loadExcludePmids`) 필드 추가는 순수 가산이다.

async function orchestratorInTmp() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-evidence-'));
  const o = new TrendReviewOrchestrator();
  o.outputDir = dir;
  o.excludeListPath = path.join(dir, 'selected_papers.json');
  return { o, file: o.excludeListPath };
}

const card = { paper: { pmid: '42568095', title: 'Telemedicine and weaning' } };

test('선정 증거: 재순위가 적용된 날은 selected_papers.json 에 증거가 남는다', async () => {
  const { o, file } = await orchestratorInTmp();
  await o._saveExcludePmids([card], { llmCalled: true, applied: true, reason: null, poolSize: 20 });
  const [entry] = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(entry.pmid, '42568095');
  assert.equal(entry.selectionMode, 'llm_reranked');
  assert.equal(entry.rerankApplied, true);
  assert.equal(entry.rerankPoolSize, 20);
  assert.equal(entry.lowConfidence, false);
});

test('선정 증거: 재순위가 안 돈 날은 미발동 사유까지 남는다 (F1 이 다시 숨지 못하게)', async () => {
  const { o, file } = await orchestratorInTmp();
  await o._saveExcludePmids([card], { llmCalled: false, applied: false, reason: 'pool_too_small', poolSize: 1 });
  const [entry] = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(entry.selectionMode, 'deterministic');
  assert.equal(entry.rerankApplied, false);
  assert.equal(entry.fallbackReason, 'pool_too_small');
  assert.equal(entry.lowConfidence, true, '재순위 미발동은 약한 날로 표기한다');
});

test('선정 증거: telemetry 가 없어도 기존 계약(pmid·title·date)은 그대로다', async () => {
  const { o, file } = await orchestratorInTmp();
  await o._saveExcludePmids([card]);
  const [entry] = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(entry.pmid, '42568095');
  assert.equal(entry.title, 'Telemedicine and weaning');
  assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(entry.rerankApplied, undefined, '증거 없는 경로에 거짓 증거를 만들지 않는다');
});

test('선정 증거: 제외목록 읽기는 새 필드에 영향받지 않는다 (데일리 코어 무영향)', async () => {
  const { o } = await orchestratorInTmp();
  await o._saveExcludePmids([card], { llmCalled: true, applied: true, reason: null, poolSize: 20 });
  assert.deepEqual(await o._loadExcludePmids(), ['42568095']);
});
