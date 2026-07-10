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
import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { LLMClient } from '../src/utils/LLMClient.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';
import { kstDateStr } from '../src/utils/dates.js';

const MAX = Number(process.env.EXP_MAX ?? 300);
const CHUNK = Number(process.env.EXP_CHUNK ?? 30);
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
