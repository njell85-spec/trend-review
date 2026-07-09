#!/usr/bin/env node
/**
 * on-demand.mjs — 수동 디깅(직접 지정 분석) 실행기 (REPORT_SPEC §1-B)
 *
 * 자동 데일리 선정과 별개의 예외 경로: PeterJ가 지정한 논문/가이드라인(PMID 또는 DOI)을
 * 동일한 분석 → 대시보드(직접 지정 배지) → 카톡 → 아카이브 경로에 태운다.
 * 같은 날 데일리 섹션을 건드리지 않으며(자체 섹션 키), "하루 1편" 카운트 밖의 예외다.
 *
 * 사용: node scripts/on-demand.mjs <PMID|DOI> [paper|guideline]
 * 트리거: .github/workflows/on-demand.yml (대시보드 위젯 또는 Actions 수동 실행)
 */
import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { DataCollectorAgent } from '../src/agents/DataCollectorAgent.js';
import { FullTextAgent } from '../src/agents/FullTextAgent.js';
import { FilterAnalyzerAgent } from '../src/agents/FilterAnalyzerAgent.js';
import { GuidelineAnalyzerAgent } from '../src/agents/GuidelineAnalyzerAgent.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';
import { llmTelemetry } from '../src/utils/LLMClient.js';
import { kstDateStr } from '../src/utils/dates.js';

const target = (process.argv[2] ?? '').trim();
const kind = (process.argv[3] ?? 'paper').trim();
if (!target) {
  console.error('사용법: node scripts/on-demand.mjs <PMID|DOI> [paper|guideline]');
  process.exit(1);
}

// ── 1) 입력 해석: PMID 직접 / DOI → PubMed 검색 ─────────────────────────────
async function resolvePmid(t) {
  if (/^\d{5,9}$/.test(t)) return t;
  if (/^10\.\S+\/\S+/.test(t)) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(`${t}[DOI]`)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`PubMed 검색 실패 HTTP ${r.status}`);
    const id = (await r.json())?.esearchresult?.idlist?.[0];
    if (!id) throw new Error(`DOI로 PubMed 항목을 찾지 못했습니다: ${t}`);
    return id;
  }
  throw new Error(`지원하지 않는 형식입니다 (PMID 숫자 또는 DOI만): ${t}`);
}

const todayKST = kstDateStr();
const pmid = await resolvePmid(target);
console.log(`🔎 직접 지정 분석 시작: PMID ${pmid} (${kind}) — ${todayKST}`);

// ── 2) 메타데이터 + 본문 확보 (데일리와 동일 부품 재사용) ─────────────────────
const collector = new DataCollectorAgent();
const [article] = await collector.fetchArticles([pmid]);
if (!article) {
  console.error(`✖ PMID ${pmid} 메타데이터를 가져오지 못했습니다.`);
  process.exit(1);
}
const { papers: [enriched] } = await new FullTextAgent().run([article]);

// ── 3) 분석 → 발행 ───────────────────────────────────────────────────────────
const publisher = new GitHubPublisher();
let pagesUrl = `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`;
let notifyPaper = null;

if (kind === 'guideline') {
  const card = await new GuidelineAnalyzerAgent().analyze(enriched);
  if (!card) {
    console.error('✖ 가이드라인 분석 실패 — 대시보드 미변경.');
    process.exit(1);
  }
  await appendState('output/selected_guidelines.json', { pmid, title: article.title, date: todayKST });
  pagesUrl = await publisher.publish(todayKST, [], { guideline: card, manual: true });
  notifyPaper = { title_ko: card.title_ko, paper: { title: article.title, journal: article.journal, pmid } };
} else {
  const [analysis] = await new FilterAnalyzerAgent().analyzePico([enriched]);
  if (!analysis || analysis.analysisError) {
    console.error('✖ PICO 분석 실패 — 대시보드 미변경.');
    process.exit(1);
  }
  analysis.manualPick = true;
  await appendState('output/selected_papers.json', { pmid, title: article.title, date: todayKST });
  pagesUrl = await publisher.publish(todayKST, [analysis], { manual: true });
  notifyPaper = analysis;

  // 아카이브(Phase 2) — Secrets 미설정이면 조용히 스킵 (소프트)
  try {
    const { ArchiveAgent } = await import('../src/agents/ArchiveAgent.js');
    const r = await new ArchiveAgent().run({ analysis, todayKST });
    console.log(`📚 아카이브: ${r.ok ? `완료 (PDF ${r.pdf ? '적재' : '없음'})` : `건너뜀(${r.reason})`}`);
  } catch (e) {
    console.warn(`⚠️ 아카이브 실패(계속): ${e.message}`);
  }

  // 아카이브 저장 현황 패널(§4-E) 최신화 — ArchiveAgent 뒤라야 이 건이 패널에 반영된다.
  try {
    const r = await publisher.refreshArchiveStatus(todayKST);
    if (r.updated) console.log(`📦 아카이브 저장 현황 패널 최신화 (${r.pushed ? '푸시 완료' : '로컬 커밋'})`);
  } catch (e) {
    console.warn(`⚠️ 아카이브 현황 최신화 실패(계속): ${e.message}`);
  }
}

console.log(`🌐 발행 완료: ${pagesUrl}`);

// ── 4) 카톡 알림 (소프트) — 데일리와 동일 §2 포맷 ────────────────────────────
try {
  const r = await new KakaoNotifier().send({ dateStr: todayKST, topPaper: notifyPaper, pagesUrl, llmRoute: llmTelemetry.label() });
  if (r.sent) console.log('💬 카카오 알림 발송 완료');
} catch (e) {
  console.warn(`⚠️ 카카오 발송 실패(계속): ${e.message}`);
}

/** 제외목록에 추가(중복 자동선정 방지) — publish() 전에 호출해 publisher 커밋에 포함시킨다 */
async function appendState(rel, entry) {
  const p = path.join(process.cwd(), rel);
  let list = [];
  try { list = JSON.parse(await readFile(p, 'utf8')); } catch { /* 최초 */ }
  if (!list.some((x) => x.pmid === entry.pmid)) {
    list.push(entry);
    await writeFile(p, JSON.stringify(list, null, 2), 'utf8');
  }
}
