import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dropFromQueue, promoteInQueue, resetQueue, applyQueueAction } from '../src/utils/queueControl.js';

/**
 * ★ 예고 리스트 버튼(🗑 ▶ ♻)의 실행부.
 *
 * 이 저장소가 아홉 번 밟은 함정은 **"모듈은 옳은데 아무도 안 부른다"** 이므로,
 * 순수 함수만 검사하지 않고 **실제 CLI 경로(`scripts/queue-control.mjs`)를 돌린다.**
 * 워크플로가 부르는 것이 바로 그 경로다.
 */

const Q = () => ({
  schemaVersion: 1, track: 'papers',
  queue: [{ pmid: 'a', title: 'A' }, { pmid: 'b', title: 'B' }, { pmid: 'c', title: 'C' }],
  published: [], rejected: [], lastRun: null, updatedAt: '2026-08-15',
});

test('🗑 은 큐에서 빼고 rejected 에 남긴다 (안 남기면 다음 수집이 도로 데려온다)', () => {
  const { next, changed } = dropFromQueue(Q(), 'b', '2026-08-16');
  assert.equal(changed, true);
  assert.deepEqual(next.queue.map((x) => x.pmid), ['a', 'c']);
  assert.deepEqual(next.rejected.map((x) => x.pmid), ['b']);
  assert.equal(next.rejected[0].rejectedAt, '2026-08-16');
});

test('▶ 는 큐 머리로 올릴 뿐 빼지 않는다', () => {
  const { next, changed } = promoteInQueue(Q(), 'c', '2026-08-16');
  assert.equal(changed, true);
  assert.deepEqual(next.queue.map((x) => x.pmid), ['c', 'a', 'b']);
});

test('♻ 는 큐를 비우고 전부 rejected 로 넘긴다', () => {
  const { next } = resetQueue(Q(), '2026-08-16');
  assert.deepEqual(next.queue, []);
  assert.deepEqual(next.rejected.map((x) => x.pmid), ['a', 'b', 'c']);
});

test('없는 id·이미 머리인 항목은 아무것도 안 바꾼다 (헛커밋 방지)', () => {
  assert.equal(dropFromQueue(Q(), 'zzz').changed, false);
  assert.equal(promoteInQueue(Q(), 'a').changed, false);
  assert.equal(resetQueue({ queue: [] }).changed, false);
});

test('원본을 고치지 않는다 (순수 함수)', () => {
  const src = Q();
  dropFromQueue(src, 'b', '2026-08-16');
  assert.deepEqual(src.queue.map((x) => x.pmid), ['a', 'b', 'c']);
});

test('모르는 액션은 조용히 넘어가지 않고 던진다', () => {
  assert.throws(() => applyQueueAction(Q(), 'nuke'), /알 수 없는 큐 액션/);
});

// ── ★ 배선 회귀 — 워크플로가 실제로 부르는 경로를 돈다 ────────────────────────
async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-qc-'));
  await mkdir(path.join(dir, 'output'), { recursive: true });
  await writeFile(path.join(dir, 'output', 'queue_papers.json'), JSON.stringify(Q(), null, 2));
  return dir;
}

const runCli = (cwd, args) => execFileSync(process.execPath,
  [path.resolve('scripts/queue-control.mjs'), ...args], { cwd, encoding: 'utf8' });

test('★ CLI 가 실제로 큐 파일을 고친다 (워크플로가 부르는 그 경로)', async () => {
  const dir = await sandbox();
  const out = runCli(dir, ['--track', 'papers', '--action', 'drop', '--id', 'b']);
  assert.match(out, /큐 3 → 2/);
  const after = JSON.parse(await readFile(path.join(dir, 'output', 'queue_papers.json'), 'utf8'));
  assert.deepEqual(after.queue.map((x) => x.pmid), ['a', 'c']);
});

test('★ CLI 는 알 수 없는 트랙·액션을 거부한다 (오타가 조용히 넘어가면 안 된다)', async () => {
  const dir = await sandbox();
  assert.throws(() => runCli(dir, ['--track', 'nope', '--action', 'drop', '--id', 'a']));
  assert.throws(() => runCli(dir, ['--track', 'papers', '--action', 'nuke', '--id', 'a']));
});

test('★ 큐 파일이 없으면 실패가 아니라 조용한 성공이다 (버튼이 빨갛게 보이면 안 된다)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-qc-empty-'));
  const out = runCli(dir, ['--track', 'reviews', '--action', 'reset']);
  assert.match(out, /큐 파일이 없어 넘어간다/);
});

test('★ 워크플로가 CLI 에 넘기는 입력 이름이 CLI 가 읽는 것과 같다', async () => {
  const wf = await readFile(new URL('../.github/workflows/queue-control.yml', import.meta.url), 'utf8');
  const cli = await readFile(new URL('../scripts/queue-control.mjs', import.meta.url), 'utf8');
  for (const flag of ['track', 'action', 'id']) {
    assert.ok(wf.includes(`--${flag} "\${{ inputs.${flag} }}"`), `워크플로가 --${flag} 를 안 넘긴다`);
    assert.ok(cli.includes(`arg('${flag}'`), `CLI 가 --${flag} 를 안 읽는다`);
  }
});
