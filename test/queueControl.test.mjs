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
  // ★ 값은 **env 로** 넘긴다. `${{ }}` 를 셸에 직접 펼치면 자유 입력인 id 가 따옴표를
  //   탈출해 러너에서 임의 명령이 돈다(코드리뷰 실측). 여기서 그 회귀도 같이 막는다.
  const ENV = { track: 'IN_TRACK', action: 'IN_ACTION', id: 'IN_ID' };
  for (const [flag, envName] of Object.entries(ENV)) {
    assert.ok(wf.includes(`${envName}:`), `워크플로가 ${envName} 을 안 정의한다`);
    assert.ok(wf.includes(`--${flag} "$${envName}"`), `워크플로가 --${flag} 를 env 로 안 넘긴다`);
    assert.ok(cli.includes(`arg('${flag}'`), `CLI 가 --${flag} 를 안 읽는다`);
  }
  assert.equal(/--(track|action|id) "\$\{\{/.test(wf), false,
    '자유 입력을 셸에 직접 펼쳤다 — 인젝션 경로다');
});


/**
 * ★ 코드리뷰 발견 B3 — 🗑/♻ 가 **가이드라인 트랙에서만** 하루 만에 되돌아왔다.
 *   `queueControl` 은 뺀 것을 `rejected` 로 옮기는데, 가이드라인 큐를 다시 채우는
 *   `mergeCandidates` 가 **published·queue 만 대조하고 rejected 는 안 봤다.**
 *   papers·reviews 가 쓰는 `trackQueue.mergeQueueItems` 는 이미 rejected 를 본다 —
 *   가이드라인만 예외였다. PeterJ 입장에서는 "지웠는데 다음 날 또 떴다" 가 된다.
 *
 *   합성 픽스처가 아니라 **실제 가이드라인 상태 모듈**을 태운다. 종전 테스트가
 *   track:'papers' 픽스처만 써서 이 경로를 한 번도 안 밟았다.
 */
test('★ 가이드라인에서 뺀 항목은 다음 수집에 되살아나지 않는다', async () => {
  const { mergeCandidates } = await import('../src/utils/guidelineState.js');
  const { dropFromQueue } = await import('../src/utils/queueControl.js');

  const state = {
    schemaVersion: 2,
    queue: [{ id: 'pmid:111', pmid: '111', title: '뺄 지침', status: 'queued' }],
    published: [], rejected: [], sourceHealth: {}, lastRun: null,
    updatedAt: '2026-08-16', configVersion: 'guideline-v2',
  };

  // 🗑 — 큐에서 빼고 rejected 로 옮긴다
  const { next, changed } = dropFromQueue(state, '111', '2026-08-16');
  assert.equal(changed, true);
  assert.equal(next.queue.length, 0);
  assert.equal(next.rejected.length, 1);

  // 다음 데일리가 PubMed 에서 같은 것을 또 가져온다 (mergeCandidates 는 새 상태를 돌려준다)
  const merged = mergeCandidates(next, [{ id: 'pmid:111', pmid: '111', title: '뺄 지침', status: 'queued' }]);
  assert.equal(merged.queue.length, 0,
    '뺀 지침이 다음 수집에 되살아났다 — 🗑 가 하루짜리가 된다');

  // 반대로, 뺀 적 없는 것은 정상적으로 들어와야 한다(과잉 차단이면 여기서 잡힌다)
  const merged2 = mergeCandidates(next, [{ id: 'pmid:222', pmid: '222', title: '새 지침', status: 'queued' }]);
  assert.equal(merged2.queue.length, 1, '새 지침이 안 들어왔다 — 필터가 과하다');
});


/**
 * ★ 2026-08-17 실측 — 🗑 를 눌러 큐에서는 빠졌는데 **예고 리스트에는 그대로 남아 있었다.**
 *   예고는 발행 시점에 그려지므로 큐만 고치면 화면이 안 바뀐다.
 *   버튼이 "1~2분 뒤 새로고침하면 반영됩니다" 라고 말하므로 그것이 참이어야 한다.
 */
test('★ 큐 제어 워크플로가 페이지를 다시 그리고 함께 커밋한다', async () => {
  const wf = await readFile(new URL('../.github/workflows/queue-control.yml', import.meta.url), 'utf8');
  assert.match(wf, /apply-page-render\.mjs/, '큐만 고치고 화면을 안 그린다 — 버튼이 거짓말한다');
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    assert.ok(wf.includes(f), `${f} 를 커밋하지 않는다 — 그려도 반영이 안 된다`);
  }
  // 렌더에 식별자를 넘겨야 한다 — 안 넘기면 스크립트에 'undefined' 가 구워진다(결함 B1)
  assert.match(wf, /GITHUB_OWNER:/, '렌더에 owner 를 안 넘긴다');
  assert.match(wf, /GITHUB_REPO:/, '렌더에 repo 를 안 넘긴다');
});
