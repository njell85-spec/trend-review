#!/usr/bin/env node
/**
 * on-demand.mjs — 수동 디깅(직접 지정 분석) 실행기 (REPORT_SPEC §1-B)
 *
 * 자동 데일리 선정과 별개의 예외 경로: PeterJ가 지정한 논문/가이드라인(PMID 또는 DOI)을
 * 동일한 분석 → 대시보드(직접 지정 배지) → 텔레그램 → 아카이브 경로에 태운다.
 * 같은 날 데일리 섹션을 건드리지 않으며(자체 섹션 키), "하루 1편" 카운트 밖의 예외다.
 *
 * 사용: node scripts/on-demand.mjs <PMID|DOI|URL> [paper|guideline|reference|review]
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
import { applyUserText } from '../src/utils/userSuppliedText.js';
import { appendManualEntry } from '../src/utils/guidelineState.js';

import { installUsageDump } from '../src/utils/usageDump.js';

// 이 스크립트도 LLM을 태우므로 사용량을 타워 장부용으로 떨군다(USAGE_OUT 지정 시에만).
installUsageDump();

const target = (process.argv[2] ?? '').trim();
const kind = (process.argv[3] ?? 'paper').trim();
if (!target) {
  console.error('사용법: node scripts/on-demand.mjs <PMID|DOI|URL> [paper|guideline|reference|review]');
  process.exit(1);
}
// URL 은 논문(PICO) 경로로 못 간다 — PICO 분석은 PubMed 메타데이터(저널·저자·MeSH)가 전제다.
// 가이드라인(공식 문서)과 참고자료(PeterJ 가 직접 고른 범용 자료)만 URL 을 받는다.
const DOC_KINDS = new Set(['guideline', 'reference']);
// ★ kind=synthesis — 관련 문헌 2~5건을 한 장으로 대조한다 (PeterJ 요구 2026-08-29).
//   target 에 쉼표/공백/줄바꿈으로 여러 건을 넣는다. PMID·DOI·URL 을 섞어도 된다.
//   기준선(구판)으로만 넣는 문헌은 뒤에 `!` 를 붙인다 — 예: `35363499!`.
const SYNTHESIS_KIND = 'synthesis';
// ★ kind=review — 예고 리스트의 ▶ 가 리뷰 트랙에서 부르는 경로 (PeterJ 실측 2026-08-17:
//   눌렀더니 "맨 앞으로 올렸습니다" 만 뜨고 분석·발행이 안 됐다).
//   종전에는 on-demand 가 paper|guideline|reference 뿐이라 리뷰의 ▶ 는 큐 순서만 바꿨다.
//   리뷰를 kind=paper 로 넘기면 index.html 에 '직접 지정 논문' 으로 올라가고 리뷰 페이지에는
//   아무것도 안 생기며 리뷰 큐도 그대로 남아 며칠 뒤 같은 논문이 또 나간다 —
//   그래서 폴백이 아니라 **제 트랙 경로**를 만든다.
//   분석은 데일리 `_analyzeReview` 와 같다(GuidelineAnalyzer `mode: 'reference'`).
const REVIEW_KIND = 'review';
const synTargets = kind === SYNTHESIS_KIND
  ? target.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)
  : [];
if (kind === SYNTHESIS_KIND && (synTargets.length < 2 || synTargets.length > 5)) {
  console.error(`✖ kind=synthesis 는 문헌 2~5건이 필요합니다 (받은 것: ${synTargets.length}건). 쉼표나 공백으로 구분하세요.`);
  process.exit(1);
}
if (kind !== SYNTHESIS_KIND && isHttpUrl(target) && !DOC_KINDS.has(kind)) {
  console.error('✖ URL 지정은 kind=guideline 또는 kind=reference 에서만 지원합니다 (논문·리뷰는 PMID/DOI로 지정하세요).');
  process.exit(1);
}
if (!['paper', 'guideline', 'reference', REVIEW_KIND, SYNTHESIS_KIND].includes(kind)) {
  console.error(`✖ 알 수 없는 kind: ${kind} (paper|guideline|reference|review|synthesis)`);
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
const webMode = kind !== SYNTHESIS_KIND && isHttpUrl(target);

/**
 * 종합용 — target 하나를 문서 하나로 푼다. 단일 경로와 **같은 부품**을 쓴다
 * (DataCollector + FullText, 또는 URL 이면 externalGuideline). 두 경로가 다른 방식으로
 * 문헌을 읽으면 종합 카드와 개별 카드가 서로 다른 사실을 말하게 된다.
 */
async function resolveSynthesisDoc(raw, refId) {
  const isBaseline = raw.endsWith('!');
  const t = isBaseline ? raw.slice(0, -1) : raw;
  if (isHttpUrl(t)) {
    const src = await fetchSourceText(t);
    const web = buildWebGuideline({ url: t, title: src.title || t, org: '', pubDate: '', text: src.text });
    return {
      refId, isBaseline, pmid: '', sourceUrl: t, title: web.title, journal: web.journal ?? '',
      pubDate: '', abstract: web.abstract ?? '', fullText: web.fullText ?? '', fullTextSource: 'web',
    };
  }
  const id = await resolvePmid(t);
  const [art] = await new DataCollectorAgent().fetchArticles([id]);
  if (!art) throw new Error(`PMID ${id} 메타데이터를 가져오지 못했습니다`);
  const { papers: [rich] } = await new FullTextAgent().run([art]);
  const d = rich ?? art;
  return {
    refId, isBaseline, pmid: id, sourceUrl: '', title: d.title, journal: d.journal ?? '',
    pubDate: d.pubDate ?? '', abstract: d.abstract ?? '', fullText: d.fullText ?? '',
    fullTextSource: d.fullTextSource ?? 'abstract-only',
  };
}

// ── 2) 메타데이터 + 본문 확보 ────────────────────────────────────────────────
// (a) 웹 출처 가이드라인 — PubMed 미등재본(학회 홈페이지 living document).
//     본문 확보는 소프트: 차단(403)·PDF면 텍스트 없이 넘기고 LLM 웹검색 보강에 맡긴다.
// (b) 그 외 — 기존 PMID/DOI 경로(데일리와 동일 부품 재사용).
let pmid = '';
let article;
let enriched;

if (kind === SYNTHESIS_KIND) {
  console.log(`🔎 종합 분석 시작: 문헌 ${synTargets.length}건 (${kind}) — ${todayKST}`);
  const docs = [];
  for (const [i, raw] of synTargets.entries()) {
    const d = await resolveSynthesisDoc(raw, `D${i + 1}`);
    docs.push(d);
    console.log(`  · ${d.refId}${d.isBaseline ? ' [기준선]' : ''} ${d.pmid ? `PMID ${d.pmid}` : d.sourceUrl} — ${String(d.title).slice(0, 70)}`);
  }
  // ★ URL 문헌을 전부 'web' 으로 적으면 같은 크기의 URL 묶음이 죄다 같은 sourceId 가
  //   된다(syn:web-web). 그러면 두 번째 묶음이 장부에 안 오르고 첫 묶음의 행을 지운다.
  //   URL 은 짧은 해시로 구분한다(코드리뷰 2026-08-29).
  const shortHash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0').slice(0, 6);
  };
  const slug = docs.map((d) => d.pmid || `w${shortHash(d.sourceUrl || d.title || '')}`).join('-').slice(0, 72);
  enriched = {
    docs,
    sourceId: `syn:${slug}`,
    title: docs.filter((d) => !d.isBaseline).map((d) => d.title).join(' / ').slice(0, 200),
    pmid: '',
  };
  article = { title: enriched.title, journal: '' };
} else if (webMode) {
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

// (c) 페이월 보정 — PeterJ 가 본문 정리본을 넘겼으면 그것을 본문 자리에 얹는다.
//     러너가 못 읽는 유료 문헌(NEJM 등)에서 카드가 초록 수준으로 얇아지는 것을 막는 유일한 통로.
if (kind === SYNTHESIS_KIND && String(process.env.OD_SOURCE_TEXT ?? '').trim()) {
  // ★ 조용히 무시하지 않는다. 종합 프롬프트는 doc.docs[] 만 읽으므로 이 통로가
  //   닿지 않는다 — 종전에는 "적용했습니다" 로그까지 찍고 아무 일도 안 했다.
  console.warn('⚠️ sourceText 는 종합(synthesis)에 적용되지 않습니다 — 무시하고 진행합니다. 페이월 본문이 필요하면 그 문헌을 kind=guideline 으로 먼저 발행하세요.');
} else {
  const r = applyUserText(enriched, process.env.OD_SOURCE_TEXT);
  if (r.applied) {
    enriched = r.doc;
    console.log(`📝 사용자 제공 본문 적용: ${r.length}자 (fullTextSource=user-supplied)`);
  } else if (r.reason === 'too_short') {
    console.warn(`⚠️ 사용자 제공 본문이 너무 짧아 무시합니다(${r.length}자) — 초록으로 진행.`);
  }
}

// ── 3) 분석 → 발행 ───────────────────────────────────────────────────────────
const publisher = new GitHubPublisher();
let pagesUrl = `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`;
let notifyPaper = null;

if (kind === REVIEW_KIND) {
  // 리뷰 카드는 데일리와 **같은 부품**으로 만든다 — 두 경로가 다른 카드를 그리면
  // "▶ 로 낸 것과 데일리가 낸 것이 다르게 생겼다" 가 된다.
  const card = await new GuidelineAnalyzerAgent().analyze(enriched, { mode: 'review' });
  if (!card) console.warn('⚠️ 리뷰 번역이 카드를 못 냈습니다 — 얇은 카드로 발행합니다(데일리와 같은 처리).');
  const review = {
    pmid, title: article.title, journal: article.journal,
    publishedAt: todayKST, card: card ?? null,
  };
  // ★ 큐에서 빼고 published 로 옮긴다. 안 그러면 **며칠 뒤 데일리가 같은 것을 또 낸다** —
  //   ▶ 는 "지금 이것을 내보낸다" 이지 "한 번 더 낸다" 가 아니다.
  const moved = await consumeTrackQueue('output/queue_reviews.json', pmid, todayKST, review);
  console.log(moved ? `· 리뷰 큐에서 소진 처리: ${pmid}` : `· 리뷰 큐에 없던 항목이다(직접 지정) — 큐는 그대로`);
  const published = await publisher.publish(todayKST, [], { review });
  pagesUrl = `${String(published).replace(/\/?$/, '/')}reviews.html`;
  notifyPaper = { title_ko: card?.title_ko ?? article.title, paper: { title: article.title, journal: article.journal, pmid } };
} else if (DOC_KINDS.has(kind)) {
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
  // ★ 예정리스트에서 ▶ 로 올린 지침이면 큐에서 뺀다 — 안 그러면 방금 발행한 것이
  //   예정리스트 맨 위에 그대로 남고, 다음 데일리가 같은 것을 또 낸다.
  if (!isRef) {
    const dropped = await dropFromGuidelineQueue(pmid, todayKST);
    console.log(dropped ? `· 가이드라인 큐에서 소진 처리: ${pmid}` : '· 가이드라인 큐에 없던 항목이다(직접 지정) — 큐는 그대로');
  }
  const published = await publisher.publish(todayKST, [], { guideline: card, manual: true });
  // 가이드 카드는 guidelines.html, **참고자료 카드는 reviews.html('기타 자료')** 에 실린다.
  // ★ 종전에는 둘 다 guidelines.html 로 안내했다 — 참고자료를 넣으면 텔레그램 링크가
  //   방금 만든 카드가 **없는** 페이지를 열었다(pageSplit 이 reference 를 reviews 로 보낸다).
  pagesUrl = `${String(published).replace(/\/?$/, '/')}${isRef ? 'reviews' : 'guidelines'}.html`;
  notifyPaper = { title_ko: card.title_ko, paper: { title: article.title, journal: article.journal, pmid } };
} else if (kind === SYNTHESIS_KIND) {
  const card = await new GuidelineAnalyzerAgent().analyze(enriched, { mode: SYNTHESIS_KIND });
  if (!card) {
    console.error('✖ 종합 분석 실패 — 대시보드 미변경.');
    process.exit(1);
  }
  // 종합 카드는 발행 장부에 **자체 식별자(sourceId)** 로 오른다. 묶인 문헌들의 PMID 로
  // 올리면 개별 카드와 중복 제거가 충돌해 서로를 지운다.
  await appendState('output/selected_guidelines.json', {
    pmid: '', title: card.title_ko, date: todayKST,
    sourceUrl: '', sourceId: enriched.sourceId,
  });
  // ★ 큐는 건드리지 않는다 — 종합은 큐에서 뽑은 것이 아니라 PeterJ 가 묶어 지시한 것이고,
  //   묶인 문헌은 대개 이미 개별 발행돼 있다.
  const published = await publisher.publish(todayKST, [], { guideline: card, manual: true });
  pagesUrl = `${String(published).replace(/\/?$/, '/')}guidelines.html`;
  notifyPaper = { title_ko: card.title_ko, paper: { title: card.title_ko, journal: `문헌 ${(card.documents ?? []).length}건 종합`, pmid: '' } };
} else {
  const [analysis] = await new FilterAnalyzerAgent().analyzePico([enriched]);
  if (!analysis || analysis.analysisError) {
    console.error('✖ PICO 분석 실패 — 대시보드 미변경.');
    process.exit(1);
  }
  analysis.manualPick = true;
  // Manual picks skip point scoring, so primaryTopic normally needs recalculation and stays null.
  await appendState('output/selected_papers.json', {
    pmid, title: article.title, date: todayKST,
    topic: analysis.scoringData?.primaryTopic ?? null,
  });
  // ★ 예정리스트에서 ▶ 로 올린 논문이면 큐에서 뺀다. 발행 장부(selected_papers.json)에
  //   적는 것만으로는 **큐가 그대로 남아** 예정리스트가 방금 나간 논문을 계속 보여준다.
  const movedPaper = await consumeTrackQueue('output/queue_papers.json', pmid, todayKST, {
    title: article.title, journal: article.journal,
  });
  console.log(movedPaper ? `· 논문 큐에서 소진 처리: ${pmid}` : '· 논문 큐에 없던 항목이다(직접 지정) — 큐는 그대로');
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
/**
 * 트랙 큐에서 해당 pmid 를 빼 `published` 로 옮긴다.
 * 큐에 없으면(직접 지정으로 아무 PMID 나 넣은 경우) 아무 것도 하지 않고 false.
 * 데일리(`_stageReview` · `_saveTrack1Queue`)가 쓰는 것과 같은 상태 파일·같은 모양이다.
 *
 * ★★ 2026-08-18 — 종전에는 **리뷰 전용**이었다. ▶ 가 논문·가이드라인에서 눌렸을 때는
 *   분석·발행만 하고 큐를 그대로 뒀고, 그래서 **방금 발행한 것이 예정리스트 맨 위에
 *   그대로 남았다**(실측: PMID 41188988 이 이미 발행됐는데 예정리스트 1번).
 *   버튼은 "지금 이것을 내보낸다" 라고 말하는데 화면은 "다음에 나갈 것" 이라고 말한다 —
 *   버튼의 자기 설명과 실제 동작이 어긋나는, 이 저장소의 단골 부류다.
 */
async function consumeTrackQueue(rel, targetPmid, todayStr, published) {
  const key = String(targetPmid ?? '').trim();
  if (!key) return false;
  const file = path.join(process.cwd(), rel);
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch { return false; }
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const hit = queue.find((x) => String(x?.pmid ?? '') === key);
  if (!hit) return false;
  const next = {
    ...state,
    queue: queue.filter((x) => String(x?.pmid ?? '') !== key),
    published: [...(state.published ?? []), { ...hit, ...published, publishedAt: todayStr }],
    updatedAt: todayStr,
  };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * 가이드라인 큐(선정 장부 v2)에서 해당 pmid 를 뺀다.
 * `appendManualEntry` 가 `published` 에 넣는 것과 짝이다 — 그것만으로는 **큐에 그대로
 * 남아** 예정리스트가 이미 나간 지침을 계속 보여준다. 상태 파일이 v1(배열)이면 큐가
 * 없으므로 할 일이 없다.
 */
async function dropFromGuidelineQueue(targetPmid, todayStr) {
  const key = String(targetPmid ?? '').trim();
  if (!key) return false;
  const file = path.join(process.cwd(), 'output/selected_guidelines.json');
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); } catch { return false; }
  if (!state || Array.isArray(state) || !Array.isArray(state.queue)) return false;
  const next = state.queue.filter((x) => String(x?.pmid ?? '') !== key);
  if (next.length === state.queue.length) return false;
  await writeFile(file, `${JSON.stringify({ ...state, queue: next, updatedAt: todayStr }, null, 2)}\n`, 'utf8');
  return true;
}

async function appendState(rel, entry) {
  const p = path.join(process.cwd(), rel);
  let raw = null;
  try { raw = JSON.parse(await readFile(p, 'utf8')); } catch { /* 최초 */ }
  const { changed, next } = appendManualEntry(raw, entry);
  if (changed) await writeFile(p, JSON.stringify(next, null, 2), 'utf8');
}
