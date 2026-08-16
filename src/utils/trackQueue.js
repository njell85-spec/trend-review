import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export function emptyQueue(track) {
  return {
    schemaVersion: 1,
    track,
    queue: [],
    published: [],
    rejected: [],
    lastRun: null,
    updatedAt: null,
  };
}

function validateState(state, track = state?.track) {
  if (state?.schemaVersion !== 1 || state.track !== track || typeof state.track !== 'string'
      || !Array.isArray(state.queue) || !Array.isArray(state.published)
      || !Array.isArray(state.rejected)) {
    throw new Error('Track queue is not a valid schemaVersion 1 state');
  }
}

export async function loadTrackQueue(path, track) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    validateState(state, track);
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyQueue(track);
    // 손상 파일을 첫 실행으로 오인하면 기존 큐를 빈 상태로 덮어쓸 수 있다.
    throw new Error(`Failed to load track queue ${path}: ${error.message}`, { cause: error });
  }
}

export async function saveTrackQueue(path, state) {
  validateState(state);
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }

  // rename 성공만으로는 디스크 내용이 의도한 상태라는 보장이 없으므로 실물을 재검증한다.
  const saved = await loadTrackQueue(path, state.track);
  validateState(saved, state.track);
  if (JSON.stringify(saved) !== JSON.stringify(state)) {
    throw new Error('Track queue post-save verification failed');
  }
  return saved;
}

export function mergeQueueItems(state, items, { today, excludePmids = [] } = {}) {
  validateState(state);
  // ★ `excludePmids` 는 **발행 장부**(selected_papers.json)에서 온다.
  //   큐의 published/rejected 로는 이걸 못 잡는다 — 그건 큐 자신의 이력이지 장부가 아니다.
  //   예비 큐는 선정 풀이 만들어진 **직후**에 저장되는데 그 시점의 풀에는 이미 발행된
  //   논문이 아직 섞여 있다(제외는 그 다음 단계에서 일어난다). 여기서 안 거르면
  //   **예고 리스트에 PeterJ가 이미 읽은 논문이 뜬다.**
  const occupied = new Set(
    [...state.queue, ...state.published, ...state.rejected]
      .filter((entry) => entry?.pmid != null)
      .map((entry) => String(entry.pmid)),
  );
  for (const pmid of excludePmids ?? []) occupied.add(String(pmid));
  const additions = [];
  for (const item of items ?? []) {
    const pmid = String(item.pmid);
    if (occupied.has(pmid)) continue;
    occupied.add(pmid);
    additions.push({ ...structuredClone(item), addedAt: today });
  }

  const queue = [...structuredClone(state.queue), ...additions]
    .sort((a, b) => (Number(b.score) - Number(a.score))
      || String(a.pmid).localeCompare(String(b.pmid)));
  return { ...structuredClone(state), queue, updatedAt: today };
}
