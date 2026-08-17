/** 실행형 스크립트의 취소/실패 재실행 배선 계약. */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { rerunEndpointForConclusion } from '../src/utils/pagesDeployTarget.js';

test('cancelled는 전체 rerun, failure는 rerun-failed-jobs를 고른다', () => {
  assert.equal(rerunEndpointForConclusion(101, 'cancelled'), '/actions/runs/101/rerun');
  assert.equal(rerunEndpointForConclusion(102, 'failure'), '/actions/runs/102/rerun-failed-jobs');
});

test('실행 스크립트가 conclusion을 순수 함수에 넘기고 공통 재시도 한도를 쓴다', () => {
  const source = readFileSync(new URL('../scripts/verify-pages-deploy.mjs', import.meta.url), 'utf8');
  assert.match(source, /rerunEndpointForConclusion\(run\.id, run\.conclusion\)/);
  assert.match(source, /rerunsIssued\s*>=\s*RERUN_MAX/);
  assert.match(source, /handledAttempt\.set\(run\.id, run\.run_attempt\)/);
  assert.match(source, /endpoint=\$\{result\.endpoint\}/,
    '403/422 진단에 실제 호출 경로가 남아야 한다');
});
