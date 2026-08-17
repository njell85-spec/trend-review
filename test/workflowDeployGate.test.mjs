/** 버튼 워크플로의 Pages 배포 게이트·경합 안전 계약. */
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const workflowDir = new URL('../.github/workflows/', import.meta.url);
const read = (name) => readFileSync(new URL(name, workflowDir), 'utf8');
const buttonWorkflows = [
  ['curate-remove.yml', 'remove'],
  ['queue-control.yml', 'control'],
  ['on-demand.yml', 'analyze'],
];

function jobBlock(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `${name} 잡을 못 찾았다`);
  return match[0];
}

test('★ HTML push 버튼 워크플로 3종 모두 별도 verify-pages 잡을 실행한다', () => {
  assert.ok(buttonWorkflows.length >= 3,
    `대상 워크플로가 ${buttonWorkflows.length}개뿐이다 — 검사가 헛돌고 있다`);
  for (const [file, mainJob] of buttonWorkflows) {
    const source = read(file);
    const verify = jobBlock(source, 'verify-pages');
    assert.match(verify, new RegExp(`needs: ${mainJob}\\b`), `${file}: 본 작업 성공 뒤 실행되어야 한다`);
    assert.match(verify, /timeout-minutes:\s*25/);
    assert.match(verify, /contents:\s*read/);
    for (const key of ['GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
      assert.match(verify, new RegExp(`^\\s+${key}:`, 'm'), `${file}: ${key} env가 없다`);
    }
    assert.match(verify, /node scripts\/verify-pages-deploy\.mjs/);
    assert.doesNotMatch(verify, /if:\s*always\(\)/, `${file}: 본 작업 실패 뒤 게이트를 돌리면 안 된다`);
  }
});

test('★ actions: write는 검증 잡에만 있다', () => {
  for (const [file, mainJob] of buttonWorkflows) {
    const source = read(file);
    assert.match(jobBlock(source, 'verify-pages'), /^\s+actions:\s*write\s*$/m);
    assert.doesNotMatch(jobBlock(source, mainJob), /^\s+actions:\s*write\s*$/m,
      `${file}: 본 작업 잡에 재실행 권한을 주면 안 된다`);
  }
});

test('★ 본 작업 클릭은 접지 않고 검증 잡만 최신 하나로 접는다', () => {
  for (const [file, mainJob] of buttonWorkflows) {
    const source = read(file);
    assert.doesNotMatch(jobBlock(source, mainJob), /\bconcurrency:/,
      `${file}: 본 작업에 concurrency를 걸면 연속 클릭이 유실된다`);
    const verify = jobBlock(source, 'verify-pages');
    assert.match(verify, /concurrency:\s*\n\s+group:\s*verify-pages\s*\n\s+cancel-in-progress:\s*true/,
      `${file}: 검증 잡은 최신 것만 남겨야 한다`);
  }
});

test('★ 생성 HTML을 다시 쓰는 워크플로에는 pull --rebase가 없다', () => {
  const writers = readdirSync(workflowDir)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => [file, read(file)])
    .filter(([, source]) => source.includes('scripts/apply-page-render.mjs'));
  assert.ok(writers.length >= 3, `HTML 생성 워크플로가 ${writers.length}개뿐이다 — 검사가 헛돌고 있다`);
  for (const [file, source] of writers) {
    assert.doesNotMatch(source, /git pull --rebase/, `${file}: 낡은 생성 HTML을 rebase하면 안 된다`);
  }
});

test("★ workflow if에서 inputs boolean을 직접 판정하지 않는다", () => {
  const workflows = readdirSync(workflowDir).filter((file) => file.endsWith('.yml'));
  assert.ok(workflows.length >= 3, '워크플로 목록을 못 읽었다 — 검사가 헛돌고 있다');
  for (const file of workflows) {
    const source = read(file);
    assert.doesNotMatch(source, /^\s*if:\s*(?:\$\{\{\s*)?inputs\.[A-Za-z_]\w*\s*(?:\}\})?\s*$/m,
      `${file}: inputs boolean 직접 truthy 판정 금지`);
    assert.doesNotMatch(source, /^\s*if:\s*\$\{\{\s*inputs\.[A-Za-z_]\w*\s*==\s*'true'\s*\}\}\s*$/m,
      `${file}: 타입이 다른 boolean/'true' 비교 금지`);
  }
});
