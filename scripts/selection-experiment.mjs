/**
 * selection-experiment.mjs — 논문 선정 개편용 recall@K 진단 실험 (일회성, 데일리 코어 무영향)
 *
 * 목적(HANDOFF §10 [2026-07-09]):
 *   현행 결정적 스코어러가 "LLM이 전량에서 고를 논문"을 상위 K에 담는지(recall@K) 실측하고,
 *   결정적이 오판(over/under-credit)한 논문 목록을 뽑아 메타 기준 촘촘화의 타깃을 만든다.
 *
 * 절차:
 *   1) DataCollectorAgent.run() 으로 실제 PubMed 논문 수집(프로덕션과 동일 경로).
 *   2) MetadataScorer 로 결정적 점수(현행 선정 로직).
 *   3) LLM 풀스크린 — 청크(기본 30편)로 나눠 claude(구독 CLI/API)에 임상적용성 1~10 채점.
 *      (청크로 나눠 429[세션 토큰 한도]를 회피 — 청크별 성공/429/거부를 그대로 로깅.)
 *   4) recall@K(K=10/20/50) + LLM top-5 + 결정적 top-5 + 오판 목록을 계산.
 *   5) 사람이 읽는 리포트를 GITHUB_STEP_SUMMARY(폰에서 읽힘)에 쓰고, 상세 JSON은 파일로 남긴다.
 *
 * 프로덕션 무영향: output/selected_papers.json 등 상태 파일을 건드리지 않는다(읽기·발송·커밋 없음).
 * 환경변수: EXP_MAX(기본 300) · EXP_CHUNK(기본 30) · EXP_OUT(기본 output/experiments).
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { LLMClient } from '../src/utils/LLMClient.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';
import { kstDateStr } from '../src/utils/dates.js';
import { runReplay, renderReplaySummary } from '../src/experiments/selectionReplay.js';

// llmTelemetry.totals(auth → 모델 → bucket)에서 입력·출력 토큰 합을 뽑는다.
const sumIn = (t) => Object.values(t ?? {}).flatMap((m) => Object.values(m ?? {}))
  .reduce((n, b) => n + (b?.in ?? 0), 0);
const sumOut = (t) => Object.values(t ?? {}).flatMap((m) => Object.values(m ?? {}))
  .reduce((n, b) => n + (b?.out ?? 0), 0);

import { installUsageDump } from '../src/utils/usageDump.js';

// 이 스크립트도 LLM을 태우므로 사용량을 타워 장부용으로 떨군다(USAGE_OUT 지정 시에만).
installUsageDump();

const MAX = Number(process.env.EXP_MAX ?? 300);
const CHUNK = Number(process.env.EXP_CHUNK ?? 30);
const USE_LLM = (process.env.EXP_LLM ?? '1') !== '0'; // 0 = 결정적 재랭킹만(빠름, LLM 없음)
const OUT = process.env.EXP_OUT ?? 'output/experiments';
const KS = [10, 20, 50];
const today = kstDateStr();

const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* non-fatal */ }
  }
  console.log(md);
};
const trunc = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1) + '…' : String(s ?? ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function replayMain() {
  const armsDoc = JSON.parse(readFileSync(new URL('../experiments/arms.json', import.meta.url), 'utf8'));
  const profile = JSON.parse(readFileSync(new URL('../config/interests.json', import.meta.url), 'utf8'));
  const journals = JSON.parse(readFileSync(new URL('../config/journals.json', import.meta.url), 'utf8'));
  const collection = JSON.parse(readFileSync(new URL('../config/collection.json', import.meta.url), 'utf8'));
  const requested = (process.env.EXP_ARM || 'A,B,C,D').split(',').map((a) => a.trim().toUpperCase()).filter(Boolean);
  const invalid = requested.filter((a) => !armsDoc.arms[a]);
  if (invalid.length) throw new Error(`Unknown EXP_ARM: ${invalid.join(', ')}`);
  const end = process.env.EXP_END || today;
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  const start = process.env.EXP_START || startDate.toISOString().slice(0, 10);
  mkdirSync(OUT, { recursive: true });

  let corpusDoc;
  let corpusPath = process.env.EXP_CORPUS;
  if (corpusPath) {
    corpusDoc = JSON.parse(readFileSync(corpusPath, 'utf8'));
  } else {
    // arm E(월별 풀)가 요청되면 코퍼스를 365일까지 넓힌다 — 12구간 × screenPerMonth.
    const eCfg = armsDoc.arms.E?.monthly ?? {};
    const needMonthly = requested.includes('E');
    // 사전순위 스코어러 — esummary 에는 초록·MeSH 가 없다. **주제 게이트를 끈다**:
    // 켜 두면 제목에 관심어가 없는 논문이 rel01=0 → -5 로 바닥에 깔려, 초록에만 주제어가
    // 있는 좋은 RCT 가 100편 안에 못 든다. prerank 는 저널 티어·설계·제목 히트로만 거른다.
    const prerankScorer = needMonthly
      ? new MetadataScorer({ profile, journals, scoring: { topicGatePenalty: 0 } })
      : null;
    const collector = new DataCollectorAgent({ collectionMode: 'dual', maxPapers: collection.maxPapers,
      includeMonthlyPool: needMonthly,
      monthlyPoolOptions: { months: eCfg.months ?? 12, monthDays: eCfg.monthDays ?? 30,
        screenPerMonth: Number(process.env.EXP_SCREEN_PER_MONTH ?? eCfg.screenPerMonth ?? 100),
        screenDepth: Number(process.env.EXP_SCREEN_DEPTH ?? eCfg.screenDepth ?? 1000),
        prerankScorer } });
    const collected = await collector.collectReplayCorpus();
    corpusDoc = { start, end, collectedAt: new Date().toISOString(), stats: collected.stats, papers: collected.papers };
    corpusPath = `${OUT}/corpus-${start}_${end}.json`;
    writeFileSync(corpusPath, JSON.stringify(corpusDoc, null, 2));
  }
  const corpus = Array.isArray(corpusDoc) ? corpusDoc : corpusDoc.papers;
  if (!Array.isArray(corpus) || !corpus.length) throw new Error('Replay corpus has no papers');
  const result = runReplay({ corpus, arms: requested, armDefinitions: armsDoc.arms,
    profile, journals, collection, start, end });
  result.corpus = corpusPath;
  const cpt = Number(process.env.EXP_CHARS_PER_TOKEN);
  if (Number.isFinite(cpt) && cpt > 0) result.charsPerToken = cpt;
  const corpusDates = corpus.map((p) => p.pubDate).filter(Boolean).sort();
  result.corpusStats = { candidateCount: corpus.length, oldestPubDate: corpusDates[0] ?? null,
    newestPubDate: corpusDates.at(-1) ?? null, ...(Array.isArray(corpusDoc) ? {} : corpusDoc.stats) };
  result.llm = { enabled: false, implemented: false, requested: process.env.EXP_LLM === '1' };
  // ── 토큰 실측 캘리브레이션 (EXP_LLM=1) ────────────────────────────────────
  // 추정 비율을 쓰지 않는다. **프로덕션과 같은 경로**(FilterAnalyzerAgent._rerankSelect)로
  // A 풀(20)·E 풀(120)을 각각 한 번씩 실제로 태우고, 그 usage 로 chars/token 을 잰다.
  // 30일 총량은 일자별 실제 프롬프트 글자수 합 × 그 비율로 낸다.
  if (USE_LLM && requested.includes('E')) {
    const { llmTelemetry } = await import('../src/utils/LLMClient.js');
    const { rerankPromptChars } = await import('../src/experiments/selectionReplay.js');
    const calib = [];
    for (const arm of ['A', 'E']) {
      const days = result.arms[arm]?.days ?? [];
      // 프롬프트가 가장 큰 날 = 그 arm 의 정상 부하
      const day = days.filter((d) => d.rerankPromptChars > 0)
        .sort((a, b) => b.rerankPromptChars - a.rerankPromptChars)[0];
      if (!day) { console.error(`[calib] ${arm}: rerank 풀이 있는 날이 없다 — 건너뜀`); continue; }
      const pool = day.ranked.slice(0, day.rerankPoolSize)
        .map((r) => corpus.find((p) => String(p.pmid) === String(r.pmid))).filter(Boolean);
      if (pool.length < 2) { console.error(`[calib] ${arm}: 풀 복원 실패`); continue; }
      const chars = rerankPromptChars(pool);
      const before = JSON.stringify(llmTelemetry.totals);
      const agent = new FilterAnalyzerAgent({ topN: 1, enableRerank: true, rerankPool: pool.length });
      agent.logger.info = () => {}; agent.logger.warn = () => {}; agent.logger.section = () => {};
      const t0 = Date.now();
      let telemetry = null;
      let failure = null;
      try { ({ telemetry } = await agent._rerankSelect(pool, 1)); }
      catch (err) { failure = err.message; console.error(`[calib] ${arm}: 호출 실패 — ${err.message}`); }
      const inTok = sumIn(llmTelemetry.totals) - sumIn(JSON.parse(before));
      const outTok = sumOut(llmTelemetry.totals) - sumOut(JSON.parse(before));
      calib.push({ arm, date: day.date, poolSize: pool.length, promptChars: chars,
        inputTokens: inTok, outputTokens: outTok,
        charsPerToken: inTok > 0 ? Number((chars / inTok).toFixed(3)) : null,
        llmCalled: telemetry?.llmCalled ?? false, applied: telemetry?.applied ?? false,
        // ★ `llmCalled` 는 "호출을 시도했다"이지 "성공했다"가 아니다. 소프트 실패라
        //   0 토큰이 그냥 넘어가면 측정이 조용히 거짓말을 한다 — 사유를 같이 낸다.
        reason: failure ?? telemetry?.reason ?? (inTok > 0 ? 'ok' : 'usage_not_recorded'),
        maxTokens: telemetry?.rerankMaxTokens ?? null,
        sec: ((Date.now() - t0) / 1000).toFixed(0) });
      console.error(`[calib] ${arm}: 풀 ${pool.length} · ${chars}자 → in ${inTok} · out ${outTok} 토큰`);
    }
    result.tokenCalibration = calib;
    const withRatio = calib.filter((c) => c.charsPerToken);
    if (withRatio.length) {
      result.charsPerToken = Number(
        (withRatio.reduce((n, c) => n + c.charsPerToken, 0) / withRatio.length).toFixed(3));
    }
  }

  const outputPath = `${OUT}/replay-${start}_${end}.json`;
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  summary(renderReplaySummary(result));
  console.error(`재생 JSON: ${outputPath}\n코퍼스: ${corpusPath}`);
}

if (process.env.EXP_MODE === 'census') {
  // 수집 풀 실측 — LLM 미사용, esearch count 만 읽는다 (scripts/pool-census.mjs).
  const { runCensus } = await import('./pool-census.mjs');
  await runCensus();
  process.exit(0);
}

if (process.env.EXP_MODE === 'replay' || String(process.env.EXP_ARM ?? '').trim()) {
  await replayMain();
  process.exit(0);
}

// ── LLM 풀스크린(청크 채점) ────────────────────────────────────────────────
async function llmScreen(papers) {
  const llm = new LLMClient({ provider: 'anthropic' });
  const tool = new FilterAnalyzerAgent()._scoringTool; // 폐기됐지만 스키마는 잔존
  const scores = new Map(); // pmid -> {score, rationale, studyType}
  const chunkLog = [];

  for (let i = 0; i < papers.length; i += CHUNK) {
    const batch = papers.slice(i, i + CHUNK);
    const idx = Math.floor(i / CHUNK) + 1;
    const prompt = `You are an expert emergency medicine and critical care (EM/CCM) physician screening the literature.
Score each of the following ${batch.length} papers from 1 to 10 for CLINICAL APPLICABILITY to EM/CCM bedside practice
(10 = high-quality, immediately practice-changing for the acute/critical patient; 1 = irrelevant or very low clinical value).
Judge on clinical merit, not just study design or journal prestige. Return one entry per paper via the submit_paper_scores tool.

Papers:
${batch.map((p, k) => `[${k + 1}] PMID ${p.pmid} | ${p.journal} | types: ${(p.publicationTypes || []).join(', ') || 'NR'}
Title: ${p.title}
Abstract: ${trunc(p.abstract, 1400)}`).join('\n\n')}`;

    const t0 = Date.now();
    try {
      const out = await llm.callWithTool([{ role: 'user', content: prompt }], tool, { maxTokens: 4096 });
      const arr = Array.isArray(out?.scores) ? out.scores : [];
      for (const s of arr) if (s?.pmid) scores.set(String(s.pmid), s);
      chunkLog.push({ chunk: idx, n: batch.length, got: arr.length, ok: true, sec: ((Date.now() - t0) / 1000).toFixed(0) });
      console.error(`chunk ${idx}: OK ${arr.length}/${batch.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    } catch (err) {
      const m = err.message || String(err);
      const kind = /429|session limit|rate.?limit|overloaded/i.test(m) ? '429'
        : /refus|cannot assist|can'?t assist|unable to|policy/i.test(m) ? 'AUP' : 'ERR';
      chunkLog.push({ chunk: idx, n: batch.length, got: 0, ok: false, kind, err: trunc(m, 160) });
      console.error(`chunk ${idx}: FAIL(${kind}) ${trunc(m, 160)}`);
    }
    await sleep(1500); // 세션 압박 완화
  }
  return { scores, chunkLog };
}

// ── main ────────────────────────────────────────────────────────────────
console.error(`\n📊 Selection experiment — ${today} · MAX=${MAX} CHUNK=${CHUNK}\n`);

const collector = new DataCollectorAgent({ maxPapers: MAX });
const { papers, stats } = await collector.run();
if (!papers.length) { summary(`## ❌ 실험 실패 — 수집된 논문 0편 (PubMed 접근 확인)`); process.exit(1); }

const scorer = new MetadataScorer();
const detScores = new Map(scorer.scorePapers(papers).map((s) => [s.pmid, s]));

// ── 결정적 재랭킹 전용 모드 (개편 스코어러 확인용 — LLM 없이 1~2분) ──────────
if (!USE_LLM) {
  const ranked = papers.map((p) => ({ p, d: detScores.get(p.pmid) ?? {} }))
    .sort((a, b) => (b.d.rawScore ?? 0) - (a.d.rawScore ?? 0));
  let md = `# 📊 결정적 재랭킹 (개편 스코어러) — ${today}\n\n`;
  md += `수집 **${papers.length}편** · PeterJ 기준: ①관심주제 ②저명저널\n\n`;
  md += `## 🩺 상위 20 — PeterJ 눈 검증(이제 취향에 맞나?)\n\n`;
  ranked.slice(0, 20).forEach((r, i) => {
    const d = r.d;
    md += `**${i + 1}. ${d.score}점** (raw ${Number(d.rawScore ?? 0).toFixed(2)}) · ${trunc(r.p.title, 82)}\n`;
    md += `  · _${r.p.journal}_ · ${d.journalTier ?? '?'}${d.gated ? ' · ⚠GATED' : ''} · ${trunc(d.rationale, 110)}\n\n`;
  });
  md += `## 하위 5 — 배제·감점 확인\n\n`;
  ranked.slice(-5).forEach((r) => {
    const d = r.d;
    md += `- ${d.score}점 · ${trunc(r.p.title, 68)} _(${r.p.journal})_${d.gated ? ' · GATED' : ''}\n`;
  });
  summary(md);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/rerank-${today}.json`, JSON.stringify({
    date: today, collect: stats,
    ranked: ranked.map((r) => ({ pmid: r.p.pmid, score: r.d.score, raw: r.d.rawScore, tier: r.d.journalTier, gated: r.d.gated, groups: r.d.matchedInterests, title: r.p.title, journal: r.p.journal })),
  }, null, 2));
  console.error(`상세 JSON: ${OUT}/rerank-${today}.json`);
  process.exit(0);
}

// ── LLM rerank 검증 모드 (EXP_MODE=rerank) — 결정적 top-K → Opus 침상가치 재순위 ──
if (process.env.EXP_MODE === 'rerank') {
  // 프로덕션과 같은 파싱 — 빈 문자열·0·음수·비수치는 전부 20으로 떨어진다(F1 과 같은 함정).
  const fa = new FilterAnalyzerAgent();
  const POOL = fa.rerankPool;
  const pool = fa._selectTopPapers(papers, [...detScores.values()], [], POOL);
  // 부수효과로 pool 요소에 rerankScore 부착(프로덕션 경로 그대로) + 실행 증거 수령.
  // ★ 순위는 프로덕션이 돌려준 것을 그대로 쓴다. 여기서 다시 정렬하면(종전 코드가
  //   `rerankScore ?? 0` 로 재정렬했다) 부분 적용 경로에서 미채점분이 0점으로 밀려
  //   **리포트가 프로덕션과 다른 순서를 보여준다** — 이 리포트의 요점이 "프로덕션이
  //   이 순서로 1편 선정"이므로 치명적이다.
  const { picks, telemetry } = await fa._rerankSelect(pool, pool.length);
  const reranked = picks;
  let md = `# 📊 결정적 + LLM rerank — ${today}\n\n`;
  md += `수집 **${papers.length}편** · 결정적 pool ${pool.length}편 → Opus 침상 임상가치 재순위\n\n`;
  // ★ 재순위가 무효면 아래 순서는 결정적 순서와 같다. 그걸 안 적으면 리포트가
  //   "LLM 이 결정적과 같은 순서를 골랐다"로 잘못 읽힌다(F1 이 은폐된 것과 같은 구조).
  if (!telemetry.applied) {
    md += `> ⚠️ **재순위 미적용 — 아래는 결정적 순위 그대로다.** `
        + `llm_called=${telemetry.llmCalled} · reason=\`${telemetry.reason ?? '—'}\`\n\n`;
  }
  md += `## 🩺 최종 top 10 (rerank 후 — 프로덕션이 이 순서로 1편 선정)\n\n`;
  reranked.slice(0, 10).forEach((p, i) => {
    md += `**${i + 1}. rerank ${p.rerankScore ?? '—'}점** (결정 ${p.scoringData?.score}) · ${trunc(p.title, 82)}\n`;
    md += `  · _${p.journal}_ · ${trunc(p.rerankRationale ?? '', 120)}\n\n`;
  });
  md += `## 결정적 top5 → rerank 후 위치 변동\n\n`;
  pool.slice(0, 5).forEach((p, i) => {
    const pos = reranked.findIndex((x) => x.pmid === p.pmid) + 1;
    md += `- 결정 #${i + 1} (${p.scoringData?.score}) → **rerank #${pos}** (${p.rerankScore ?? '—'}) · ${trunc(p.title, 62)}\n`;
  });
  summary(md);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/rerank-llm-${today}.json`, JSON.stringify({
    date: today, pool: pool.length, rerankApplied: telemetry.applied, fallbackReason: telemetry.reason,
    reranked: reranked.map((p) => ({ pmid: p.pmid, rerank: p.rerankScore, det: p.scoringData?.score, title: p.title, journal: p.journal, why: p.rerankRationale })),
  }, null, 2));
  console.error(`상세 JSON: ${OUT}/rerank-llm-${today}.json`);
  process.exit(0);
}

const { scores: llmScores, chunkLog } = await llmScreen(papers);

// 랭킹
const rows = papers.map((p) => {
  const d = detScores.get(p.pmid) ?? { rawScore: 0, score: 0, studyType: 'Other', rationale: '' };
  const l = llmScores.get(p.pmid);
  return {
    pmid: p.pmid, title: p.title, journal: p.journal,
    types: (p.publicationTypes || []).join(', '),
    detRaw: d.rawScore ?? d.score ?? 0, detScore: d.score ?? 0, detType: d.studyType, detWhy: d.rationale,
    llm: l ? Number(l.score) : null, llmWhy: l?.rationale ?? '', llmType: l?.studyType ?? '',
  };
});
const byDet = [...rows].sort((a, b) => b.detRaw - a.detRaw);
byDet.forEach((r, i) => { r.detRank = i + 1; });
const scored = rows.filter((r) => r.llm != null);
const byLlm = [...scored].sort((a, b) => (b.llm - a.llm) || (b.detRaw - a.detRaw));
byLlm.forEach((r, i) => { r.llmRank = i + 1; });

const coverage = scored.length;
const llmTop = byLlm.slice(0, 5);
const llmTop1 = byLlm[0];
const detTop = byDet.slice(0, 5);

// recall@K
const recall = KS.map((K) => {
  const detSet = new Set(byDet.slice(0, K).map((r) => r.pmid));
  const top1Hit = llmTop1 ? detSet.has(llmTop1.pmid) : false;
  const top5Hit = llmTop.filter((r) => detSet.has(r.pmid)).length;
  return { K, top1Hit, top5Hit };
});

// 오판 목록
const underCredited = scored.filter((r) => r.llm >= 8 && r.detRank > 20)
  .sort((a, b) => b.llm - a.llm || a.detRank - b.detRank).slice(0, 8);
const overCredited = detTop.filter((r) => r.llm != null && r.llm <= 5)
  .sort((a, b) => a.llm - b.llm);

// ── 리포트 ────────────────────────────────────────────────────────────────
const ok = chunkLog.filter((c) => c.ok).length;
const n429 = chunkLog.filter((c) => c.kind === '429').length;
const nAup = chunkLog.filter((c) => c.kind === 'AUP').length;

let md = `# 📊 논문 선정 실험 — ${today}\n\n`;
md += `수집 **${papers.length}편** · LLM 채점 커버리지 **${coverage}/${papers.length}** · `;
md += `청크 ${chunkLog.length}개(성공 ${ok} · 429 ${n429} · 거부 ${nAup})\n\n`;
md += `> AUP 거부 ${nAup === 0 ? '**0건** — 배치 채점은 안전(청크 풀스크린 가능)' : `**${nAup}건 발생**`}. `;
md += `429 ${n429 === 0 ? '0건.' : `${n429}건 — 청크 축소 필요.`}\n\n`;

md += `## 1) recall@K — 결정적 top-K가 "LLM 최상위"를 담나\n\n`;
md += `| K | LLM #1 포함? | LLM top-5 중 포함 |\n|---|---|---|\n`;
for (const r of recall) md += `| ${r.K} | ${r.top1Hit ? '✅' : '❌'} | ${r.top5Hit}/5 |\n`;
md += `\n→ K 후보: **LLM #1을 담는 최소 K**에 여유를 얹어 채택.\n\n`;

md += `## 2) 🩺 LLM 상위 5 — **PeterJ 눈 검증**(이게 좋은 픽인가?)\n\n`;
for (const r of llmTop) md += `**${r.llm}점** · ${trunc(r.title, 90)}\n  · _${r.journal}_ · 결정적랭크 #${r.detRank}\n  · ${trunc(r.llmWhy, 160)}\n\n`;

md += `## 3) 현행(결정적) 상위 5 — 실제로 뽑히는 것들 + LLM 평가\n\n`;
md += `_LLM 점수가 낮은 항목이 "왜 오늘 픽이 별로였나"의 정체_\n\n`;
for (const r of detTop) md += `결정적 #${r.detRank} (${r.detScore}점) · **LLM ${r.llm ?? '—'}점** · ${trunc(r.title, 80)}\n  · _${r.journal}_ · ${trunc(r.types, 60)}\n  · LLM: ${trunc(r.llmWhy, 150)}\n\n`;

md += `## 4) 메타 튜닝 타깃 A — LLM 고평가인데 결정적이 매장(≥8점 & 결정적랭크>20)\n\n`;
md += underCredited.length ? underCredited.map((r) => `- LLM ${r.llm} / 결정적 #${r.detRank} · ${trunc(r.title, 75)} _(${r.journal})_`).join('\n') : '_없음_';
md += `\n\n## 5) 메타 튜닝 타깃 B — 결정적 고평가인데 LLM 저평가(top5 & ≤5점)\n\n`;
md += overCredited.length ? overCredited.map((r) => `- 결정적 #${r.detRank} / LLM ${r.llm} · ${trunc(r.title, 75)} _(${r.journal})_ · ${trunc(r.types, 40)}`).join('\n') : '_없음_';
md += `\n`;

summary(md);

// 상세 JSON (다음 세션용) — 아티팩트 업로드 대상
mkdirSync(OUT, { recursive: true });
const jsonPath = `${OUT}/selection-${today}.json`;
writeFileSync(jsonPath, JSON.stringify({
  date: today, collect: stats, chunkLog, coverage,
  recall, llmTop, detTop, underCredited, overCredited,
  all: byDet.map((r) => ({ pmid: r.pmid, det: r.detRaw, detRank: r.detRank, llm: r.llm, llmRank: r.llmRank, title: r.title, journal: r.journal, types: r.types })),
}, null, 2));
console.error(`\n상세 JSON: ${jsonPath}`);
