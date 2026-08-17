import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { consumedIds, withoutConsumed, mergeQueueItems, emptyQueue } from '../src/utils/trackQueue.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

/**
 * ★★ 2026-08-18 실측 결함 — 예정리스트가 **이미 발행된 논문**을 1번에 놓고 있었다.
 *
 * 커밋 542cfd2 시점의 실물:
 *   output/queue_papers.json 큐 12건 · output/selected_papers.json(발행 장부) 51건
 *   → 교집합 1건: PMID 41188988 이 큐 맨 위에 앉아 있었다(그 논문은 그날 발행돼 나갔다).
 *
 * 원인이 둘이었다.
 *   ① `mergeQueueItems` 가 **새로 들어오는 것만** 걸렀다. 이미 큐에 앉은 항목은
 *      그 뒤에 발행돼도 영원히 남는다.
 *   ② ▶(on-demand)는 논문·가이드라인에서 **큐를 안 건드렸다.** 리뷰만 소진했다.
 *      버튼은 "지금 이것을 내보낸다" 인데 화면은 계속 "다음에 나갈 것" 이라고 말한다.
 */

test('★ consumedIds: 발행·거절·바깥 장부를 한 정의로 모은다', () => {
  const state = {
    ...emptyQueue('papers'),
    queue: [{ pmid: '1' }, { pmid: '2' }, { pmid: '3' }],
    published: [{ pmid: '2' }],
    rejected: [{ pmid: '3' }],
  };
  const ids = consumedIds(state, ['9']);
  assert.deepEqual([...ids].sort(), ['2', '3', '9']);
  assert.deepEqual(withoutConsumed(state.queue, ids).map((x) => x.pmid), ['1']);
});

test('★★ 큐에 앉아 있던 항목도 발행되면 빠진다 (종전에는 영원히 남았다)', () => {
  const state = {
    ...emptyQueue('papers'),
    queue: [{ pmid: '41188988', score: 9.2 }, { pmid: '41232590', score: 8.1 }],
  };
  const next = mergeQueueItems(state, [], { today: '2026-08-18', excludePmids: ['41188988'] });
  assert.deepEqual(next.queue.map((x) => x.pmid), ['41232590'],
    '발행 장부에 오른 논문이 큐에 그대로 남았다 — 예정리스트가 이미 나간 것을 보여준다');
});

test('큐의 published/rejected 도 같은 규칙으로 걷힌다', () => {
  const state = {
    ...emptyQueue('reviews'),
    queue: [{ pmid: 'a', score: 3 }, { pmid: 'b', score: 2 }, { pmid: 'c', score: 1 }],
    published: [{ pmid: 'b' }],
    rejected: [{ pmid: 'c' }],
  };
  const next = mergeQueueItems(state, [], { today: '2026-08-18' });
  assert.deepEqual(next.queue.map((x) => x.pmid), ['a']);
});

test('멱등 — 두 번 돌려도 같다', () => {
  const state = { ...emptyQueue('papers'), queue: [{ pmid: '1', score: 5 }], published: [{ pmid: '1' }] };
  const a = mergeQueueItems(state, [], { today: '2026-08-18' });
  const b = mergeQueueItems(a, [], { today: '2026-08-18' });
  assert.deepEqual(a.queue, b.queue);
  assert.equal(a.queue.length, 0);
});

test('안 나간 것은 안 걷는다 — 과잉 삭제 방어', () => {
  const state = { ...emptyQueue('papers'), queue: [{ pmid: '1', score: 5 }, { pmid: '2', score: 4 }] };
  const next = mergeQueueItems(state, [], { today: '2026-08-18' });
  assert.deepEqual(next.queue.map((x) => x.pmid), ['1', '2']);
});

// ── 그리는 쪽 ────────────────────────────────────────────────────────────────
// ★ 채우는 쪽만 고치면 **데일리가 돌 때까지** 화면이 옛말을 한다. ▶ 로 지금 발행하면
//   그 사이가 하루다. 그리는 쪽도 장부를 직접 대조해야 한다.
test('★★ 예정리스트 렌더가 발행 장부에 오른 논문을 그리지 않는다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tr-upcoming-'));
  await mkdir(path.join(root, 'output'), { recursive: true });
  const w = (f, v) => writeFile(path.join(root, 'output', f), JSON.stringify(v, null, 2), 'utf8');
  await w('queue_papers.json', {
    ...emptyQueue('papers'),
    queue: [
      { pmid: '41188988', title: '이미 나간 논문', journal: 'CCM', score: 9.2 },
      { pmid: '41232590', title: '아직 안 나간 논문', journal: 'NEJM', score: 8.1 },
    ],
  });
  await w('selected_papers.json', [{ pmid: '41188988', title: '이미 나간 논문', date: '2026-08-17' }]);
  await w('control_state.json', { schemaVersion: 1, tracks: {} });

  const pub = new GitHubPublisher({ owner: 'o', repo: 'r', repoPath: root });
  const out = await pub._renderUpcomingFromDisk('<!-- ARCHIVE_START -->', '2026-08-18');

  assert.ok(!out.includes('41188988'),
    '예정리스트가 이미 발행된 논문을 보여준다 — 버튼과 화면이 서로 다른 말을 한다');
  assert.ok(out.includes('41232590'), '아직 안 나간 논문까지 사라졌다 — 과잉 삭제');
});

// ── ▶ 배선 계약 ──────────────────────────────────────────────────────────────
// "모듈은 옳은데 아무도 안 부른다" 가 이 저장소의 최다 반복 함정이다.
// 소진 함수가 있어도 **세 트랙 전부에서 불리지 않으면** 같은 버그가 그대로 남는다.
test('★★ on-demand 가 세 트랙 모두 큐를 소진한다 (배선 계약)', () => {
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  assert.match(src, /consumeTrackQueue\('output\/queue_reviews\.json'/, '리뷰 큐 소진이 없다');
  assert.match(src, /consumeTrackQueue\('output\/queue_papers\.json'/, '논문 큐 소진이 없다');
  assert.match(src, /dropFromGuidelineQueue\(/, '가이드라인 큐 소진이 없다');

  // 소진은 **publish 보다 앞**이어야 한다 — publisher 가 큐 파일을 커밋하기 때문이다.
  // 뒤에 두면 러너에서는 고쳐지고 커밋만 안 돼서 push 가 성공으로 끝난다(이 저장소가
  // 두 번 데인 자리다: "예외는 추적 가능하게 만들 뿐 git add 를 대신하지 않는다").
  const paperConsume = src.indexOf("consumeTrackQueue('output/queue_papers.json'");
  const paperPublish = src.indexOf('publisher.publish(todayKST, [analysis]');
  assert.ok(paperConsume > 0 && paperPublish > paperConsume,
    '논문 큐 소진이 publish 뒤에 있다 — 커밋에 안 실린다');

  const gConsume = src.indexOf('dropFromGuidelineQueue(pmid');
  const gPublish = src.indexOf('publisher.publish(todayKST, [], { guideline');
  assert.ok(gConsume > 0 && gPublish > gConsume,
    '가이드라인 큐 소진이 publish 뒤에 있다 — 커밋에 안 실린다');
});

test('★ 큐 파일이 publisher 스테이징 목록에 있다 (커밋 계약)', () => {
  assert.ok(GitHubPublisher.RUNNER_FILES.includes('output/queue_papers.json'));
  assert.ok(GitHubPublisher.RUNNER_FILES.includes('output/queue_reviews.json'));
  assert.ok(GitHubPublisher.RUNNER_FILES.includes('output/selected_guidelines.json'));
});

// ── ▶ 참고자료 완료 링크 ─────────────────────────────────────────────────────
// pageSplit 은 reference 카드를 reviews.html('기타 자료')로 보낸다. 종전 on-demand 는
// 둘 다 guidelines.html 로 안내해서, 방금 만든 카드가 **없는** 페이지를 열게 했다.
test('★ 참고자료는 reviews.html 로 안내한다 (카드가 실제로 있는 페이지)', () => {
  const src = readFileSync(new URL('../scripts/on-demand.mjs', import.meta.url), 'utf8');
  assert.match(src, /\$\{isRef \? 'reviews' : 'guidelines'\}\.html/,
    '참고자료 완료 링크가 카드 없는 페이지를 가리킨다');
});

// ── 실물 상태 파일 ───────────────────────────────────────────────────────────
// 저장소에 체크인된 큐와 장부가 실제로 어긋나 있지 않은지 본다. 픽스처가 아니라
// **실물**을 보는 검사가 하나는 있어야 한다 — 픽스처는 같은 오류를 같이 박고 있을 수 있다.
test('★ 실물: 논문 큐에 이미 발행된 논문이 남아 있지 않다', async () => {
  const root = new URL('../', import.meta.url);
  const read = async (f) => JSON.parse(await readFile(new URL(f, root), 'utf8'));
  const [queue, selected] = await Promise.all([
    read('output/queue_papers.json'), read('output/selected_papers.json'),
  ]);
  const published = new Set(selected.map((x) => String(x.pmid)));
  const stale = queue.queue.filter((x) => published.has(String(x.pmid))).map((x) => x.pmid);
  assert.deepEqual(stale, [], `예정리스트에 이미 발행된 논문이 남아 있다: ${stale.join(', ')}`);
});
