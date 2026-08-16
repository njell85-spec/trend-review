#!/usr/bin/env node
/**
 * 예고 리스트 버튼(🗑 · ▶ · ♻)의 실행부.
 *
 * 브라우저가 `queue-control.yml` 을 디스패치하면 이 스크립트가 큐 파일을 고치고
 * 커밋한다. 판단 로직은 전부 `src/utils/queueControl.js` 에 있고 여기는 배선만 한다.
 *
 *   node scripts/queue-control.mjs --track papers --action drop --id 41504890
 *
 * ★ 트랙마다 큐 파일이 다르다. 쓰는 주체가 달라 일부러 갈라놓은 것이라 여기서 모은다.
 *   가이드라인은 `selected_guidelines.json`(v2 상태)이 큐를 겸한다.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyQueueAction, ACTIONS } from '../src/utils/queueControl.js';
import { kstDateStr } from '../src/utils/dates.js';

const QUEUE_FILE = {
  papers: 'output/queue_papers.json',
  guidelines: 'output/selected_guidelines.json',
  reviews: 'output/queue_reviews.json',
};

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const track = arg('track');
const action = arg('action');
const id = arg('id');

if (!QUEUE_FILE[track]) {
  console.error(`✖ 알 수 없는 트랙: ${track} (가능: ${Object.keys(QUEUE_FILE).join(', ')})`);
  process.exit(1);
}
if (!ACTIONS.includes(action)) {
  console.error(`✖ 알 수 없는 액션: ${action} (가능: ${ACTIONS.join(', ')})`);
  process.exit(1);
}

const file = path.resolve(process.cwd(), QUEUE_FILE[track]);
let state;
try {
  state = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
  // 큐 파일이 없으면 할 일이 없다. 여기서 죽으면 버튼이 빨간 실패로 보이는데,
  // 실제로는 "이미 비어 있다" 이므로 조용히 성공으로 끝낸다.
  console.log(`· 큐 파일이 없어 넘어간다: ${QUEUE_FILE[track]} (${err.code ?? err.message})`);
  process.exit(0);
}

const today = kstDateStr();
const { next, changed } = applyQueueAction(state, action, { id, today });

if (!changed) {
  console.log(`· 바뀐 것이 없다 (track=${track} action=${action} id=${id || '-'})`);
  process.exit(0);
}

await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
const before = state.queue?.length ?? 0;
const after = next.queue?.length ?? 0;
console.log(`✔ ${QUEUE_FILE[track]} — ${action}: 큐 ${before} → ${after}`);
