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

// ★ 테스트가 실제 `output/` 을 오염시키는 것을 막는다.
// 실측으로 걸린 자리: 테스트 픽스처(`paper-1`, 제목 빈 문자열)가 프로덕션 큐에 들어가
// 배포 페이지 예고 리스트에 **빈 줄**로 떴다. 테스트는 임시 디렉터리를 써야 한다.
function assertNotProductionInTest(file) {
  if (!process.env.NODE_TEST_CONTEXT) return;
  if (/(^|[/\\])output[/\\]/.test(String(file))) {
    throw new Error(`테스트가 프로덕션 경로에 쓰려 한다: ${file} — 임시 디렉터리를 쓰라`);
  }
}

export async function saveTrackQueue(path, state) {
  assertNotProductionInTest(path);
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

/**
 * 이 큐에서 **이미 소진된** 것들의 pmid 집합.
 * 발행됐거나(published) 뺐거나(rejected) 바깥 장부에 올라간 것(extra).
 *
 * ★ 정본이 하나여야 하는 이유 — 큐를 **채우는 쪽**(mergeQueueItems)과 **그리는 쪽**
 *   (예정리스트 렌더)이 "이미 나간 것" 의 정의를 따로 적으면 한쪽만 고쳐지고
 *   화면이 거짓말을 한다. 이 저장소가 여러 번 데인 부류다.
 */
export function consumedIds(state, extra = []) {
  const ids = new Set();
  for (const entry of [...(state?.published ?? []), ...(state?.rejected ?? [])]) {
    if (entry?.pmid != null) ids.add(String(entry.pmid));
  }
  for (const pmid of extra ?? []) if (pmid != null) ids.add(String(pmid));
  return ids;
}

/** 소진된 것을 큐에서 걷어낸다. 멱등. */
export function withoutConsumed(queue, ids) {
  return (queue ?? []).filter((item) => !ids.has(String(item?.pmid ?? '')));
}

export function mergeQueueItems(state, items, { today, excludePmids = [] } = {}) {
  validateState(state);
  // ★ `excludePmids` 는 **발행 장부**(selected_papers.json)에서 온다.
  //   큐의 published/rejected 로는 이걸 못 잡는다 — 그건 큐 자신의 이력이지 장부가 아니다.
  //   예비 큐는 선정 풀이 만들어진 **직후**에 저장되는데 그 시점의 풀에는 이미 발행된
  //   논문이 아직 섞여 있다(제외는 그 다음 단계에서 일어난다). 여기서 안 거르면
  //   **예고 리스트에 PeterJ가 이미 읽은 논문이 뜬다.**
  //
  // ★★ 2026-08-18 — 종전에는 **새로 들어오는 것만** 걸렀다. 이미 큐에 앉아 있는
  //   항목은 그 뒤에 발행돼도 영원히 남았다. 실측(커밋 542cfd2 시점): 논문 큐 12건 중
  //   PMID 41188988 이 **이미 발행된 논문인데 예정리스트 1번**에 앉아 있었다.
  //   ▶ 로 지금 발행한 항목도 같은 이유로 예정리스트에 계속 떴다(on-demand 는
  //   장부에만 적고 큐는 안 건드렸다). **큐 자체도 매번 걸러야** 화면이 사실을 말한다.
  const consumed = consumedIds(state, excludePmids);
  const surviving = withoutConsumed(structuredClone(state.queue), consumed);

  const occupied = new Set([
    ...surviving.filter((entry) => entry?.pmid != null).map((entry) => String(entry.pmid)),
    ...consumed,
  ]);
  const additions = [];
  for (const item of items ?? []) {
    const pmid = String(item.pmid);
    if (occupied.has(pmid)) continue;
    occupied.add(pmid);
    additions.push({ ...structuredClone(item), addedAt: today });
  }

  const queue = [...surviving, ...additions]
    .sort((a, b) => (Number(b.score) - Number(a.score))
      || String(a.pmid).localeCompare(String(b.pmid)));
  return { ...structuredClone(state), queue, updatedAt: today };
}
