import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CONFIG_VERSION = 'guideline-v2';

function emptyState() {
  return {
    schemaVersion: 2,
    queue: [],
    published: [],
    rejected: [],
    sourceHealth: {},
    lastRun: null,
    updatedAt: new Date().toISOString(),
    configVersion: CONFIG_VERSION,
  };
}

function candidateId(item) {
  if (item?.id) return item.id;
  if (item?.pmid) return `pmid:${item.pmid}`;
  if (item?.sourceId) return item.sourceId;
  throw new Error('Guideline state item requires id, pmid, or sourceId');
}

export function migrateGuidelineState(raw) {
  if (raw?.schemaVersion === 2) return raw;
  if (!Array.isArray(raw)) throw new TypeError('Guideline state must be a legacy array or schemaVersion 2 object');
  const state = emptyState();
  state.published = raw.map((item) => ({
    id: candidateId(item),
    pmid: item.pmid ?? null,
    sourceId: item.sourceId ?? null,
    sourceUrl: item.sourceUrl ?? null,
    title: item.title ?? '',
    organizationId: null,
    lineageKey: null,
    versionYear: null,
    publishedAt: item.date ?? null,
    status: 'current',
    supersededBy: null,
    supersededAt: null,
    legacy: structuredClone(item),
  }));
  return state;
}

export async function loadGuidelineState(path) {
  try {
    return migrateGuidelineState(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    throw new Error(`Failed to load guideline state ${path}: ${error.message}`, { cause: error });
  }
}

function validateV2(state) {
  if (state?.schemaVersion !== 2 || !Array.isArray(state.queue)
      || !Array.isArray(state.published) || !Array.isArray(state.rejected)
      || !state.sourceHealth || typeof state.sourceHealth !== 'object') {
    throw new Error('Saved guideline state is not a valid schemaVersion 2 state');
  }
}

export async function saveGuidelineState(path, state) {
  validateV2(state);
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  const saved = await loadGuidelineState(path);
  validateV2(saved);
  if (JSON.stringify(saved) !== JSON.stringify(state)) throw new Error('Guideline state post-save verification failed');
  return saved;
}

export function mergeCandidates(state, candidates) {
  validateV2(state);
  const publishedIds = new Set(state.published.map(candidateId));
  const queue = new Map(state.queue.map((item) => [candidateId(item), item]));
  for (const candidate of candidates ?? []) {
    const id = candidateId(candidate);
    if (publishedIds.has(id)) continue;
    const previous = queue.get(id);
    const discoveredBy = [...new Set([...(previous?.discoveredBy ?? []), ...(candidate.discoveredBy ?? [])])];
    queue.set(id, {
      ...(previous ?? {}),
      ...candidate,
      id,
      discoveredBy,
      discoveredAt: previous?.discoveredAt ?? candidate.discoveredAt ?? new Date().toISOString(),
      lastSeenAt: candidate.lastSeenAt ?? new Date().toISOString(),
    });
  }
  return { ...state, queue: [...queue.values()], updatedAt: new Date().toISOString() };
}
