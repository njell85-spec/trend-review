import { readFile } from 'node:fs/promises';
import { collectGuidelineCandidates, assertSupersetOfPtPath } from './guidelinePubmed.js';
import { classifyGuidelineDocument } from './guidelineClassifier.js';
import { scoreGuideline, suggestStatus } from './GuidelineScorer.js';
import { loadGuidelineOrgs } from './guidelineOrgs.js';
import { loadGuidelineState, mergeCandidates, saveGuidelineState } from './guidelineState.js';

export const DEFAULT_BACKFILL_WINDOWS = '60-30,150-120,240-210';

export function parseBackfillWindows(value = DEFAULT_BACKFILL_WINDOWS, today = new Date()) {
  const midnight = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return String(value).split(',').map((part) => {
    const match = part.trim().match(/^(\d+)-(\d+)$/);
    if (!match || Number(match[1]) <= Number(match[2])) throw new Error(`Invalid backfill window: ${part}`);
    const [older, newer] = match.slice(1).map(Number);
    const date = (days) => { const d = new Date(midnight); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10).replaceAll('-', '/'); };
    return { minDate: date(older), maxDate: date(newer), label: `${older}-${newer}` };
  });
}

function idOf(item) { return item.id ?? (item.pmid ? `pmid:${item.pmid}` : item.sourceId); }
function auditItem(item) {
  return {
    pmid: item.pmid ?? null, title: item.title ?? '', journal: item.journal ?? '',
    documentType: item.documentType ?? null, organizationId: item.organizationId ?? null,
    priority: item.priority, verdict: item.verdict, reasons: item.reasons,
  };
}

export async function runGuidelineBackfill({
  windows = DEFAULT_BACKFILL_WINDOWS, today = new Date(), fetchJson, apply = false,
  statePath, orgs: suppliedOrgs, interests: suppliedInterests, collect = collectGuidelineCandidates,
} = {}) {
  if (typeof fetchJson !== 'function') throw new TypeError('fetchJson must be a function');
  const orgs = suppliedOrgs ?? loadGuidelineOrgs();
  const interests = suppliedInterests ?? JSON.parse(await readFile(new URL('../../config/interests.json', import.meta.url), 'utf8'));
  const state = statePath ? await loadGuidelineState(statePath) : { schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: new Date().toISOString(), configVersion: 'guideline-v2' };
  const alreadyPublished = new Set(state.published.map(idOf));
  let working = structuredClone(state);
  const reports = [];
  const stopSignals = [];

  for (const window of parseBackfillWindows(windows, today)) {
    try {
      const { candidates, manifest } = await collect({ fetchJson, minDate: window.minDate, maxDate: window.maxDate });
      let missing = [];
      try { assertSupersetOfPtPath(manifest, candidates); }
      catch (error) {
        const match = String(error.message).match(/missing PMID\(s\): (.+)$/);
        missing = match ? match[1].split(/,\s*/) : (manifest.ptPmids ?? []).filter((pmid) => !candidates.some((c) => String(c.pmid) === String(pmid)));
        stopSignals.push(`① ${window.label}: 초집합 위반 ${missing.join(', ') || error.message}`);
      }
      const rows = candidates.filter((candidate) => !alreadyPublished.has(idOf(candidate))).map((candidate) => {
        const classified = classifyGuidelineDocument(candidate, { orgs });
        if (classified.verdict === 'rejected') return { ...candidate, status: 'rejected', verdict: classified.verdict, documentType: classified.documentType, reasons: classified.reasons };
        const enriched = { ...candidate, signals: { ...candidate.signals, ...classified.signals } };
        const scored = scoreGuideline(enriched, { orgs, interests });
        const suggested = suggestStatus(scored, { policy: orgs.policy });
        return { ...enriched, ...scored, status: classified.verdict === 'needsReview' ? 'needsReview' : suggested, verdict: classified.verdict, documentType: classified.documentType, reasons: classified.reasons };
      });
      const queued = rows.filter((x) => x.status === 'queued');
      const review = rows.filter((x) => x.status === 'needsReview');
      const rejected = rows.filter((x) => x.status === 'rejected');
      if (review.length >= 15) stopSignals.push(`④ ${window.label}: needsReview ${review.length}건/창 (소진 경로 확인 필요)`);
      const anchors = rows.filter((x) => (manifest.ptPmids ?? []).includes(String(x.pmid)) && x.tier === 1);
      const recovered = anchors.filter((x) => x.status === 'queued' || x.status === 'needsReview').map((x) => x.pmid);
      const lost = anchors.filter((x) => !recovered.includes(x.pmid)).map((x) => x.pmid);
      reports.push({
        window, manifest,
        counts: { candidates: candidates.length, queued: queued.length, needsReview: review.length, rejected: rejected.length },
        supersetViolation: { violated: missing.length > 0, missing },
        anchors: { ptAndTier1: anchors.map((x) => x.pmid), recovered, lost, recallRate: anchors.length ? recovered.length / anchors.length : null },
        queueDepth: { queued: queued.length, daysSustainable: queued.length / 30 },
        audit: { queued: queued.map(auditItem) },
        rejectedSample: rejected.slice(0, 20).map((x) => ({ pmid: x.pmid ?? null, title: x.title ?? '', reasons: x.reasons })),
      });
      working = mergeCandidates(working, rows.filter((x) => x.status !== 'rejected'));
      const rejectedIds = new Set(working.rejected.map(idOf));
      working.rejected.push(...rejected.filter((x) => !rejectedIds.has(idOf(x))));
    } catch (error) {
      const message = error?.message ?? String(error);
      const match = message.match(/PubMed PT superset violation; missing PMID\(s\): (.+)$/);
      const missing = match ? match[1].split(/,\s*/) : [];
      if (missing.length) stopSignals.push(`① ${window.label}: 초집합 위반 ${missing.join(', ')}`);
      // ★ 수집이 통째로 실패한 창을 조용히 "발견 0건" 으로 넘기지 않는다.
      //   그러면 PubMed 가 죽은 날의 실행이 "깨끗한 실험, 문제 없음" 으로 읽힌다 —
      //   계획서 §11 이 막으려는 무음 실패가 실험 도구 자신에게서 나는 꼴이다.
      //   초집합 여부도 `false`(=위반 없음)가 아니라 `null`(=판정 못 함)이다.
      stopSignals.push(`⑤ ${window.label}: 수집 실패 — 이 창은 판정 불가 (${message})`);
      reports.push({ window, error: message, manifest: null, counts: { candidates: 0, queued: 0, needsReview: 0, rejected: 0 }, supersetViolation: { violated: missing.length > 0 ? true : null, missing, evaluated: false }, anchors: { ptAndTier1: [], recovered: [], lost: [], recallRate: null }, queueDepth: { queued: 0, daysSustainable: 0 }, audit: { queued: [] }, rejectedSample: [] });
    }
  }
  if (apply) {
    if (!statePath) throw new Error('--apply requires a statePath');
    working.updatedAt = new Date().toISOString();
    await saveGuidelineState(statePath, working);
  }
  const totals = reports.reduce((out, report) => { for (const key of Object.keys(out)) out[key] += report.counts[key] ?? 0; return out; }, { candidates: 0, queued: 0, needsReview: 0, rejected: 0 });
  const failedWindows = reports.filter((r) => r.error).map((r) => r.window.label);
  return { generatedAt: new Date().toISOString(), windows: reports, stopSignals, totals,
    failedWindows, evaluatedWindows: reports.length - failedWindows.length };
}
