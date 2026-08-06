#!/usr/bin/env node
/**
 * on-demand.mjs — 수동 디깅(직접 지정 분석) 실행기 (REPORT_SPEC §1-B)
 *
 * 자동 데일리 선정과 별개의 예외 경로: PeterJ가 지정한 논문/가이드라인(PMID 또는 DOI)을
 * 동일한 분석 → 대시보드(직접 지정 배지) → 텔레그램 → 아카이브 경로에 태운다.
 * 같은 날 데일리 섹션을 건드리지 않으며(자체 섹션 키), "하루 1편" 카운트 밖의 예외다.
 *
 * 사용: node scripts/on-demand.mjs <PMID|DOI|URL> [paper|guideline|reference]
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
import { TelegramNotifier } from '../src/agents/TelegramNotifier.js';
import { llmTelemetry } from '../src/utils/LLMClient.js';
import { kstDateStr } from '../src/utils/dates.js';

import { isHttpUrl, fetchSourceText, buildWebGuideline } from '../src/utils/externalGuideline.js';

import { installUsageDump } from '../src/utils/usageDump.js';

// 이 스크립트도 LLM을 태우므로 사용량을 타워 장부용으로 떨군다(USAGE_OUT 지정 시에만).
installUsageDump();

const target = (process.argv[2] ?? '').trim();
const kind = (process.argv[3] ?? 'paper').trim();
if (!target) {
  console.error('사용법: node scripts/on-demand.mjs <PMID|DOI|URL> [paper|guideline|reference]');
  process.exit(1);
}
// URL 은 논문(PICO) 경로로 못 간다 — PICO 분석은 PubMed 메타데이터(저널·저자·MeSH)가 전제다.
// 가이드라인(공식 문서)과 참고자료(PeterJ 가 직접 고른 범용 자료)만 URL 을 받는다.
const DOC_KINDS = new Set(['guideline', 'reference']);
if (isHttpUrl(target) && !DOC_KINDS.has(kind)) {
  console.error('✖ URL 지정은 kind=guideline 또는 kind=reference 에서만 지원합니다 (논문은 PMID/DOI로 지정하세요).');
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
const webMode = isHttpUrl(target);

// ── 2) 메타데이터 + 본문 확보 ────────────────────────────────────────────────
// (a) 웹 출처 가이드라인 — PubMed 미등재본(학회 홈페이지 living document).
//     본문 확보는 소프트: 차단(403)·PDF면 텍스트 없이 넘기고 LLM 웹검색 보강에 맡긴다.
// (b) 그 외 — 기존 PMID/DOI 경로(데일리와 동일 부품 재사용).
let pmid = '';
let article;
let enriched;

if (webMode) {
  console.log(`🔎 직접 지정 분석 시작: URL ${target} (${kind}) — ${todayKST}`);
  const src = await fetchSourceText(target);
  console.log(`📄 원문 텍스트: ${src.text ? `${src.text.length}자 확보` : `미확보(${src.contentType || '접근 불가'}) — LLM 웹검색 보강에 위임`}`);
  enriched = buildWebGuideline({
    url: target,
    title: (process.env.OD_TITLE ?? '').trim() || src.title || '',
    org: (process.env.OD_ORG ?? '').trim(),
    pubDate: (process.env.OD_DATE ?? '').trim(),
    text: src.text,
  });
  article = { title: enriched.title, journal: enriched.journal };
} else {
  pmid = await resolvePmid(target);
  console.log(`🔎 직접 지정 분석 시작: PMID ${pmid} (${kind}) — ${todayKST}`);
  [article] = await new DataCollectorAgent().fetchArticles([pmid]);
  if (!article) {
    console.error(`✖ PMID ${pmid} 메타데이터를 가져오지 못했습니다.`);
    process.exit(1);
  }
  ({ papers: [enriched] } = await new FullTextAgent().run([article]));
}

// ── 3) 분석 → 발행 ───────────────────────────────────────────────────────────
const publisher = new GitHubPublisher();
let pagesUrl = `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`;
let notifyPaper = null;

if (DOC_KINDS.has(kind)) {
  const isRef = kind === 'reference';
  const card = await new GuidelineAnalyzerAgent().analyze(enriched, { mode: kind });
  if (!card) {
    console.error(`✖ ${isRef ? '참고자료' : '가이드라인'} 분석 실패 — 대시보드 미변경.`);
    process.exit(1);
  }
  // 참고자료는 가이드라인 트랙의 주간 게이트·중복 방지 목록과 성격이 다르다
  // (자동 선정 대상이 아니라 PeterJ 가 직접 지정할 때만 생긴다) → 별도 상태 파일.
  await appendState(isRef ? 'output/selected_references.json' : 'output/selected_guidelines.json', {
    pmid, title: article.title, date: todayKST,
    ...(webMode ? { sourceUrl: enriched.sourceUrl, sourceId: enriched.sourceId } : {}),
  });
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
}

console.log(`🌐 발행 완료: ${pagesUrl}`);

// ── 4) 텔레그램 알림 (소프트) — 데일리와 동일 §2 포맷 ────────────────────────
try {
  const r = await new TelegramNotifier().send({ dateStr: todayKST, topPaper: notifyPaper, pagesUrl });
  if (r.sent) console.log('💬 텔레그램 알림 발송 완료');
} catch (e) {
  console.warn(`⚠️ 텔레그램 발송 실패(계속): ${e.message}`);
}

/** 제외목록에 추가(중복 자동선정 방지) — publish() 전에 호출해 publisher 커밋에 포함시킨다 */
async function appendState(rel, entry) {
  const p = path.join(process.cwd(), rel);
  let list = [];
  try { list = JSON.parse(await readFile(p, 'utf8')); } catch { /* 최초 */ }
  // 웹 출처 가이드라인은 pmid 가 빈 문자열 — 그대로 비교하면 서로 다른 문서가 전부 중복 판정된다.
  const same = (x) => (entry.pmid ? x.pmid === entry.pmid
    : Boolean(entry.sourceId) && x.sourceId === entry.sourceId);
  if (!list.some(same)) {
    list.push(entry);
    await writeFile(p, JSON.stringify(list, null, 2), 'utf8');
  }
}
