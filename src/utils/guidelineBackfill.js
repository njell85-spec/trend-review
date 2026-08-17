import { readFile } from 'node:fs/promises';
import { collectGuidelineCandidates, assertSupersetOfPtPath, enrichCandidates } from './guidelinePubmed.js';
import { filterByRegion } from './guidelineRegionFilter.js';
import { loadGuidelineTopics, topicQuerySpecs } from './guidelineTopics.js';
import { matchOrganization } from './guidelineOrgs.js';
import { classifyGuidelineDocument } from './guidelineClassifier.js';
import { scoreGuideline, suggestStatus } from './GuidelineScorer.js';
import { loadGuidelineOrgs } from './guidelineOrgs.js';
import { loadGuidelineState, mergeCandidates, saveGuidelineState } from './guidelineState.js';

export const DEFAULT_BACKFILL_WINDOWS = '60-30,150-120,240-210';

// ★ `monthly:24` — 2년치를 **30일씩 24조각**으로 캔다 (PeterJ 지시 2026-08-17:
//   "2년치 가이드라인 미리 풀링해놓고 + 최신 나오면 add on").
//   왜 한 창(`730-0`)으로 안 캐나: esearch 는 `retmax` 로 잘린다. 2년치를 한 번에
//   요청하면 최신 N건만 오고 **나머지는 조용히 사라진다** — 캐치업이라면서 최신만
//   또 긁는 꼴이 된다. 창을 쪼개면 각 조각이 `retmax` 안에 들어오고, `truncated`
//   플래그가 어느 조각이 넘쳤는지도 알려 준다.
//   `24-0,60-30` 같은 명시 창은 종전 그대로 쓴다.
export function parseBackfillWindows(value = DEFAULT_BACKFILL_WINDOWS, today = new Date()) {
  const midnight = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const date = (days) => { const d = new Date(midnight); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10).replaceAll('-', '/'); };
  return String(value).split(',').flatMap((part) => {
    const monthly = part.trim().match(/^monthly:(\d+)$/);
    if (monthly) {
      const months = Number(monthly[1]);
      if (!months || months > 120) throw new Error(`Invalid monthly window count: ${part}`);
      // 오래된 쪽부터 — 백로그는 옛것이 먼저 쌓여야 날짜순 소진이 자연스럽다.
      return Array.from({ length: months }, (_, i) => {
        const older = (months - i) * 30;
        const newer = older - 30;
        return { minDate: date(older), maxDate: date(newer), label: `${older}-${newer}` };
      });
    }
    const match = part.trim().match(/^(\d+)-(\d+)$/);
    if (!match || Number(match[1]) <= Number(match[2])) throw new Error(`Invalid backfill window: ${part}`);
    const [older, newer] = match.slice(1).map(Number);
    return [{ minDate: date(older), maxDate: date(newer), label: `${older}-${newer}` }];
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


// ★ "그날 아침 이 로직이 돌았다면 무엇이 뽑혔을까" 를 날짜별로 재생한다.
//   개수만 세는 것과 다르다 — 개수는 "자격이 되는 게 몇 건인가" 를 말하고,
//   이것은 "8월 1일엔 뭐가, 2일엔 뭐가 나갔을까" 를 말한다. PeterJ 가 보려던 것이 이것이다.
//
//   규칙은 프로덕션 `_stageGuideline()` 과 같다:
//     ① 그날까지 **발행된**(pubDate <= 그날) 후보만 큐에 있다 — 미래 문서를 미리 뽑지 않는다
//     ② 이미 나간 것은 다시 안 나간다
//     ③ 하루 최대 한 편, priority 최상위
//     ④ 큐가 비면 그날은 건너뛴다 (확정 ④-D)
export function simulateDailyPublishing(rows, { minDate, maxDate }) {
  const toDay = (v) => String(v ?? '').slice(0, 10).replaceAll('/', '-');
  const start = new Date(toDay(minDate));
  const end = new Date(toDay(maxDate));
  const eligible = rows.filter((r) => r.status === 'queued');
  const published = new Set();
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const available = eligible
      .filter((r) => !published.has(r.id ?? `pmid:${r.pmid}`))
      .filter((r) => !r.pubDate || toDay(r.pubDate) <= day)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const pick = available[0];
    if (pick) {
      published.add(pick.id ?? `pmid:${pick.pmid}`);
      days.push({ date: day, outcome: 'published', pmid: pick.pmid,
        org: pick.organizationId ?? null, priority: pick.priority ?? null,
        title: pick.title ?? '', queueLeft: available.length - 1 });
    } else {
      days.push({ date: day, outcome: 'empty', queueLeft: 0 });
    }
  }
  const publishedDays = days.filter((x) => x.outcome === 'published').length;
  return { days, publishedDays, skippedDays: days.length - publishedDays,
    coverage: days.length ? publishedDays / days.length : 0 };
}

export async function runGuidelineBackfill({
  windows = DEFAULT_BACKFILL_WINDOWS, today = new Date(), fetchJson, apply = false,
  statePath, orgs: suppliedOrgs, interests: suppliedInterests, collect = collectGuidelineCandidates,
  fetchArticles, topics: suppliedTopics, retmax = 100,
} = {}) {
  if (typeof fetchJson !== 'function') throw new TypeError('fetchJson must be a function');
  const orgs = suppliedOrgs ?? loadGuidelineOrgs();
  // 주제축은 백필에도 똑같이 건다 — 데일리와 다른 그물로 캐면 백로그와 유입이 서로
  // 다른 모집단이 되어, "예고에 있던 종류가 다음 날부터 안 나온다" 가 된다.
  const topicSpecs = topicQuerySpecs(suppliedTopics ?? loadGuidelineTopics());
  const interests = suppliedInterests ?? JSON.parse(await readFile(new URL('../../config/interests.json', import.meta.url), 'utf8'));
  const state = statePath ? await loadGuidelineState(statePath) : { schemaVersion: 2, queue: [], published: [], rejected: [], sourceHealth: {}, lastRun: null, updatedAt: new Date().toISOString(), configVersion: 'guideline-v2' };
  const alreadyPublished = new Set(state.published.map(idOf));
  let working = structuredClone(state);
  const reports = [];
  const stopSignals = [];

  for (const window of parseBackfillWindows(windows, today)) {
    try {
      const collected = await collect({ fetchJson, minDate: window.minDate, maxDate: window.maxDate, topicSpecs, retmax });
      const manifest = collected.manifest;
      // ★ 보강(efetch)과 지역 필터는 **프로덕션 `_stageGuideline()` 과 같은 순서**로 돈다.
      //   이 실험의 존재 이유가 "그날 아침 이 로직이 돌았다면 무엇이 나갔을까" 인데,
      //   프로덕션에 있는 단계를 빼고 재생하면 재생이 아니라 다른 실험이 된다.
      //   특히 `--apply` 를 켜면 **여기서 나온 것이 실제 큐가 된다** — 지역 필터가 빠진 채
      //   적용하면 PeterJ 가 안 읽는 지역 지침이 큐에 그대로 들어앉는다(확정 2026-08-16 위반).
      const enrichedResult = await enrichCandidates(collected.candidates, { fetchArticles });
      manifest.enrichment = enrichedResult.evidence;
      const regionFiltered = filterByRegion(enrichedResult.candidates);
      manifest.region = { kept: regionFiltered.kept.length, dropped: regionFiltered.dropped.length };
      const candidates = regionFiltered.kept;
      let missing = [];
      // ★ 초집합 검사는 **지역 필터 앞의 집합**으로 한다. 이 검사가 묻는 것은
      //   "넓힌 그물이 현행 PT 경로가 잡던 것을 놓쳤나" — 즉 **수집 회수율**이다.
      //   지역 필터는 수집이 아니라 정책이므로, 그것이 일부러 버린 것을 "놓쳤다" 로 세면
      //   최우선 정지 신호가 정상 동작에 매일 울린다(= 아무도 안 보게 된다).
      const collectedForSuperset = enrichedResult.candidates;
      try { assertSupersetOfPtPath(manifest, collectedForSuperset); }
      catch (error) {
        const match = String(error.message).match(/missing PMID\(s\): (.+)$/);
        missing = match ? match[1].split(/,\s*/) : (manifest.ptPmids ?? []).filter((pmid) => !collectedForSuperset.some((c) => String(c.pmid) === String(pmid)));
        stopSignals.push(`① ${window.label}: 초집합 위반 ${missing.join(', ') || error.message}`);
      }
      if (manifest.supersetCheckable === false) {
        stopSignals.push(`① ${window.label}: PT 쿼리 실패로 초집합 판정 불가 — 확장 경로만으로는 현행 회수율을 보장 못 한다`);
      }
      const rows = candidates.filter((candidate) => !alreadyPublished.has(idOf(candidate))).map((candidate) => {
        const classified = classifyGuidelineDocument(candidate, { orgs });
        if (classified.verdict === 'rejected') {
          // ★ 기각된 행에도 tier 를 붙인다. 종전에는 스코어러를 안 타서 `tier` 가 없었고,
          //   앵커가 `tier === 1` 로 거르는 바람에 **PT 가 잡던 tier-1 지침을 새 분류기가
          //   오탐 기각한 경우**가 통째로 계측 밖으로 빠졌다 — 재현율이 대개 1.0 으로 부풀었다.
          //   넓힌 그물이 원래 잡던 걸 버렸는지 재는 것이 이 지표의 존재 이유인데
          //   가장 중요한 손실 유형만 안 보이던 셈이다.
          const org = matchOrganization(candidate, orgs);
          const tier = org ? orgs.organizations.find((o) => o.id === org.organizationId)?.tier ?? null : null;
          return { ...candidate, status: 'rejected', tier, organizationId: org?.organizationId ?? null,
            verdict: classified.verdict, documentType: classified.documentType, reasons: classified.reasons };
        }
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
        simulation: simulateDailyPublishing(rows, window),
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
      reports.push({ window, error: message, manifest: null, counts: { candidates: 0, queued: 0, needsReview: 0, rejected: 0 }, supersetViolation: { violated: missing.length > 0 ? true : null, missing, evaluated: false }, anchors: { ptAndTier1: [], recovered: [], lost: [], recallRate: null }, queueDepth: { queued: 0, daysSustainable: 0 }, simulation: { days: [], publishedDays: 0, skippedDays: 0, coverage: 0 }, audit: { queued: [] }, rejectedSample: [] });
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
