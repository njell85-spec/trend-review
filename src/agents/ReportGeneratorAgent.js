/**
 * ReportGeneratorAgent
 * MCP bindings: filesystem (write reports), time (timestamp)
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger.js';

const EVIDENCE_COLOR = {
  High: '#10b981', Moderate: '#3b82f6', Low: '#f59e0b', 'Very Low': '#ef4444',
};
const STUDY_ICON = {
  RCT: '🧪', 'Meta-analysis': '📊', 'Systematic Review': '📋',
  Observational: '🔍', 'Case Series': '📄', Guidelines: '📌', Other: '📝',
};

export class ReportGeneratorAgent {
  constructor(options = {}) {
    this.logger = new Logger('ReportGeneratorAgent', { logFile: 'report_generator.jsonl' });
    this.outputDir = options.outputDir ?? path.join(process.cwd(), 'output');
    this.reportsDir = path.join(this.outputDir, 'reports');
  }

  async _ensureDirs() {
    for (const dir of [this.outputDir, this.reportsDir]) {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    }
  }

  async saveJsonArchive(sessionId, data) {
    const filePath = path.join(this.reportsDir, `trend_review_${sessionId}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.info('JSON archive saved', { path: filePath });
    return filePath;
  }

  async saveHtmlDashboard(sessionId, data) {
    const html = this._buildHtml(data, sessionId);
    const filePath = path.join(this.reportsDir, `trend_review_${sessionId}.html`);
    await writeFile(filePath, html, 'utf8');
    this.logger.info('HTML dashboard saved', { path: filePath });
    return filePath;
  }

  _buildHtml(data, sessionId) {
    const { topPapers, allScoredPapers, qualityReport, executionStats } = data;
    const ts = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    return `<!DOCTYPE html>
<html lang="ko" class="scroll-smooth">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Trend Review — ${sessionId}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.13.3/dist/cdn.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>
<style>
  [x-cloak]{display:none!important}
  .pico-card{border-left:4px solid #3b82f6}
  .score-badge{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border-radius:9999px;font-weight:700;font-size:.875rem}
  .evidence-badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeIn .4s ease-out}
  .rec-card{border-color:#3b82f6!important;background:#fff}
  body{background-color:#f8fafc}
</style>
</head>
<body class="font-sans antialiased" x-data="app()" x-init="init()">
<header class="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 text-white shadow-xl">
  <div class="max-w-7xl mx-auto px-6 py-6">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <div class="flex items-center gap-3 mb-1"><span class="text-3xl">🏥</span><h1 class="text-2xl font-bold tracking-tight">Trend Review</h1></div>
        <p class="text-blue-200 text-sm">응급의학·중환자의학 최신 논문 AI 분석 시스템</p>
      </div>
      <div class="flex flex-col items-end gap-1 text-right">
        <span class="text-xs text-blue-300">Session: <code class="text-blue-100">${sessionId}</code></span>
        <span class="text-xs text-blue-300">생성: ${ts}</span>
        <span class="text-xs text-blue-300">검색 기간: 최근 ${executionStats?.searchDays ?? 30}일</span>
      </div>
    </div>
  </div>
</header>
<div class="bg-white border-b shadow-sm">
  <div class="max-w-7xl mx-auto px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
    ${[
      { icon: '📚', label: '수집 논문', value: allScoredPapers.length, sub: 'PubMed 검색 결과' },
      { icon: '✅', label: '검증 통과', value: qualityReport?.pass1?.valid ?? allScoredPapers.length, sub: '품질 검증 통과' },
      { icon: '🏆', label: 'Top 선별', value: topPapers.length, sub: 'Claude AI 선정' },
      { icon: '⏱️', label: '처리 시간', value: `${executionStats?.totalElapsed ?? '—'}s`, sub: '총 실행 시간' },
    ].map((s) => `<div class="text-center"><div class="text-2xl mb-1">${s.icon}</div><div class="text-2xl font-bold text-gray-800">${s.value}</div><div class="text-xs font-semibold text-gray-600">${s.label}</div><div class="text-xs text-gray-400">${s.sub}</div></div>`).join('')}
  </div>
</div>
<main class="max-w-7xl mx-auto px-4 py-8 space-y-10">
<section>
  <h2 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
    <span>📰</span> 오늘의 추천 논문 ${topPapers.length}편
    <span class="text-sm font-normal text-gray-500 ml-2">EM/CCM 임상 적용성 기준 AI 선정</span>
  </h2>
  <div class="space-y-6">${topPapers.map((p, i) => this._buildPicoCard(p, i)).join('\n')}</div>
</section>
${this._buildSummaryTable(topPapers)}
<section class="grid grid-cols-1 md:grid-cols-2 gap-6">
  <div class="bg-white rounded-xl shadow-sm border p-6"><h3 class="font-semibold text-gray-700 mb-4">점수 분포</h3><canvas id="scoreChart" height="220"></canvas></div>
  <div class="bg-white rounded-xl shadow-sm border p-6"><h3 class="font-semibold text-gray-700 mb-4">연구 유형</h3><canvas id="studyTypeChart" height="220"></canvas></div>
</section>
<section>
  <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
    <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2"><span>📋</span> 전체 논문 목록</h2>
    <div class="flex gap-2">
      <input x-model="search" type="text" placeholder="제목, 저널 검색…" class="border rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      <select x-model="filterStudy" class="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">전체 유형</option>
        ${[...new Set(allScoredPapers.map((p) => p.scoringData?.studyType ?? 'Other'))].map((t) => `<option value="${this._esc(t)}">${this._esc(t)}</option>`).join('')}
      </select>
      <select x-model="minScore" class="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="0">전체 점수</option><option value="7">7점 이상</option><option value="5">5점 이상</option>
      </select>
    </div>
  </div>
  <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 border-b">
          <tr>
            <th class="px-4 py-3 text-left font-semibold text-gray-600 w-10">#</th>
            <th class="px-4 py-3 text-left font-semibold text-gray-600">제목</th>
            <th class="px-4 py-3 text-left font-semibold text-gray-600 hidden md:table-cell">저널</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-20">점수</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-28 hidden md:table-cell">유형</th>
            <th class="px-4 py-3 text-center font-semibold text-gray-600 w-20">링크</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="(p, i) in filteredPapers" :key="p.pmid">
            <tr class="border-b hover:bg-blue-50 transition-colors cursor-pointer" @click="expandPaper = expandPaper === p.pmid ? null : p.pmid">
              <td class="px-4 py-3 text-gray-400 text-xs" x-text="i+1"></td>
              <td class="px-4 py-3">
                <div class="font-medium text-gray-800 text-sm leading-snug" x-text="p.title"></div>
                <div class="text-xs text-gray-500 mt-0.5" x-text="p.authors?.slice(0,3).join(', ')"></div>
                <div x-show="expandPaper === p.pmid" x-cloak class="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 leading-relaxed" x-text="p.scoringData?.rationale || '—'"></div>
              </td>
              <td class="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">
                <div x-text="p.journal"></div><div class="text-gray-400" x-text="p.pubDate"></div>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="score-badge text-white" :style="'background:' + scoreColor(p.scoringData?.score ?? 0)" x-text="p.scoringData?.score ?? '—'"></span>
              </td>
              <td class="px-4 py-3 text-center hidden md:table-cell">
                <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full" x-text="p.scoringData?.studyType || '—'"></span>
              </td>
              <td class="px-4 py-3 text-center">
                <a :href="p.pubmedUrl" target="_blank" rel="noopener" class="text-blue-500 hover:text-blue-700 text-xs underline" @click.stop>PubMed</a>
              </td>
            </tr>
          </template>
          <tr x-show="filteredPapers.length === 0"><td colspan="6" class="px-4 py-8 text-center text-gray-400 text-sm">검색 결과 없음</td></tr>
        </tbody>
      </table>
    </div>
    <div class="px-4 py-2 bg-gray-50 text-xs text-gray-500 flex justify-between">
      <span x-text="filteredPapers.length + ' 건 표시'"></span><span>클릭하면 평가 근거 확인</span>
    </div>
  </div>
</section>
<section class="bg-white rounded-xl shadow-sm border p-6">
  <h2 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><span>🔬</span> 품질 보고서</h2>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
    ${[
      { label: 'Pass 1 통과율', value: `${qualityReport?.pass1?.valid ?? '—'}/${qualityReport?.pass1?.total ?? '—'}` },
      { label: '평균 품질 점수', value: qualityReport?.pass1?.avgQualityScore ?? '—' },
      { label: 'PICO 고품질', value: qualityReport?.pass2?.highQuality ?? '—' },
      { label: '평균 PICO 품질', value: qualityReport?.pass2?.avgPicoQuality ?? '—' },
    ].map((s) => `<div class="bg-gray-50 rounded-lg p-3"><div class="text-xl font-bold text-blue-600">${s.value}</div><div class="text-xs text-gray-500 mt-1">${s.label}</div></div>`).join('')}
  </div>
</section>
</main>
<footer class="mt-12 border-t bg-white py-6 text-center text-xs text-gray-400">
  <p>Trend Review Agent · Powered by Claude AI + PubMed E-utilities</p>
  <p class="mt-1">본 시스템의 분석 결과는 보조 도구이며, 임상 결정은 전문의 판단을 따르십시오.</p>
</footer>
<script>
const ALL_PAPERS = ${this._jsonForScript(allScoredPapers.map((p) => this._slimPaper(p)))};
const QUALITY = ${this._jsonForScript(qualityReport ?? {})};
function app() {
  return {
    search: '', filterStudy: '', minScore: '0', expandPaper: null,
    init() { this.$nextTick(() => { this.renderScoreChart(); this.renderStudyTypeChart(); }); },
    get filteredPapers() {
      return ALL_PAPERS.filter(p => {
        const q = this.search.toLowerCase();
        const matchSearch = !q || (p.title||'').toLowerCase().includes(q) || (p.journal||'').toLowerCase().includes(q) || (p.authors||[]).join(' ').toLowerCase().includes(q);
        const matchType = !this.filterStudy || p.scoringData?.studyType === this.filterStudy;
        const matchScore = (p.scoringData?.score ?? 0) >= Number(this.minScore);
        return matchSearch && matchType && matchScore;
      }).sort((a,b) => (b.scoringData?.score||0) - (a.scoringData?.score||0));
    },
    scoreColor(s) {
      if (s >= 9) return '#10b981'; if (s >= 7) return '#3b82f6';
      if (s >= 5) return '#f59e0b'; if (s >= 3) return '#f97316'; return '#ef4444';
    },
    renderScoreChart() {
      const dist = QUALITY.scoreDistribution || {'1-3':0,'4-6':0,'7-8':0,'9-10':0};
      new Chart(document.getElementById('scoreChart'), { type: 'bar', data: { labels: Object.keys(dist), datasets: [{ label: '논문 수', data: Object.values(dist), backgroundColor: ['#ef4444','#f59e0b','#3b82f6','#10b981'], borderRadius: 6 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
    },
    renderStudyTypeChart() {
      const types = QUALITY.studyTypeBreakdown || {};
      if (!Object.keys(types).length) return;
      const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316'];
      new Chart(document.getElementById('studyTypeChart'), { type: 'doughnut', data: { labels: Object.keys(types), datasets: [{ data: Object.values(types), backgroundColor: colors, borderWidth: 2 }] }, options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } } });
    }
  };
}
</script>
</body>
</html>`;
  }

  _buildFullTextBadge(result, paper) {
    const src = result.fullTextSource ?? 'abstract-only';
    const len = result.fullTextLength ?? 0;
    const figures = result.figures ?? [];
    if (src === 'PMC') {
      const figNote = figures.length ? ` · ${figures.length} figure/table caption${figures.length > 1 ? 's' : ''} extracted` : '';
      return `<div class="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4 text-xs text-green-800"><span>📄</span><span><strong>Full text available (PMC)</strong> — ${Math.round(len / 1000)}k chars analyzed${figNote} &nbsp;<a href="${this._esc(paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="underline hover:text-green-600">PubMed →</a></span></div>`;
    }
    if (src === 'Unpaywall') {
      return `<div class="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4 text-xs text-blue-800"><span>🔓</span><span><strong>Open-access full text (Unpaywall)</strong> — ${Math.round(len / 1000)}k chars analyzed &nbsp;<a href="${this._esc(result.oaUrl ?? paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="underline hover:text-blue-600">Full text →</a></span></div>`;
    }
    return `<div class="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 mb-4 text-xs text-gray-500"><span>📃</span><span><strong>Abstract only</strong> &nbsp;<a href="${this._esc(paper.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-blue-500 underline hover:text-blue-700">PubMed →</a></span></div>`;
  }

  _extractN(populationText) {
    const m = (populationText ?? '').match(/n\s*[=:]\s*([\d,]+)/i)
      ?? (populationText ?? '').match(/([\d,]+)\s*(?:patients|participants|children|encounters|hospitalizations)/i);
    return m ? m[1] : null;
  }

  _firstSentence(text) {
    const s = (text ?? '').match(/^[^.!?]+[.!?]/);
    return s ? s[0] : (text ?? '').slice(0, 140) + ((text ?? '').length > 140 ? '…' : '');
  }

  _buildSummaryTable(topPapers) {
    const evColors = { High: '#10b981', Moderate: '#3b82f6', Low: '#f59e0b', 'Very Low': '#ef4444' };
    const rows = topPapers.map((result, i) => {
      const p = result.paper ?? {};
      const score = result.clinicalApplicabilityScore ?? p.scoringData?.score ?? 0;
      const evidence = result.evidenceLevel ?? 'Low';
      const evColor = evColors[evidence] ?? '#6b7280';
      const scoreColor = score >= 9 ? '#10b981' : score >= 7 ? '#3b82f6' : '#f59e0b';
      const studyType = p.scoringData?.studyType ?? 'Other';
      const nVal = this._extractN(result.pico?.population ?? '');
      const keyPointEn = this._firstSentence(result.keyFindings?.[0] ?? result.clinicalTakeaway ?? '');
      const keyPointKo = this._firstSentence(result.keyFindings_ko?.[0] ?? result.clinicalTakeaway_ko ?? '');
      const authors = (p.authors ?? []).slice(0, 2).join(', ') + ((p.authors?.length ?? 0) > 2 ? ' 외' : '');
      return `<tr class="border-b hover:bg-gray-50 transition-colors align-top">
  <td class="px-4 py-4 text-center"><span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold">${i + 1}</span></td>
  <td class="px-4 py-4"><a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="font-semibold text-gray-800 hover:text-blue-700 text-sm leading-snug block mb-1">${this._esc(p.title ?? '')}</a><div class="text-xs text-gray-400">${this._esc(authors)} · ${this._esc(p.journal ?? '')} (${this._esc(p.pubDate ?? '')})</div></td>
  <td class="px-4 py-4 text-center"><div class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full inline-block mb-1">${STUDY_ICON[studyType] ?? '📝'} ${this._esc(studyType)}</div><div><span class="evidence-badge text-white text-xs" style="background:${evColor}">${this._esc(evidence)}</span></div></td>
  <td class="px-4 py-4 text-center">${nVal ? `<span class="text-sm font-bold text-gray-700">N = ${this._esc(nVal)}</span>` : '<span class="text-xs text-gray-400">—</span>'}</td>
  <td class="px-4 py-4 text-center"><span class="score-badge text-white" style="background:${scoreColor}">${score}</span></td>
  <td class="px-4 py-4"><p class="text-sm text-gray-700 leading-snug">${this._esc(keyPointEn)}</p>${keyPointKo ? `<p class="text-xs text-gray-500 italic mt-1">${this._esc(keyPointKo)}</p>` : ''}</td>
</tr>`;
    });
    return `<section>
  <h2 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><span>📊</span> 오늘의 추천 논문 비교 요약</h2>
  <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-sm">
    <thead><tr class="bg-gradient-to-r from-blue-900 to-indigo-900 text-white text-xs uppercase tracking-wide">
      <th class="px-4 py-3 text-center w-12">#</th>
      <th class="px-4 py-3 text-left">Title / 제목</th>
      <th class="px-4 py-3 text-center w-32">Study Type / Evidence</th>
      <th class="px-4 py-3 text-center w-24">Sample Size</th>
      <th class="px-4 py-3 text-center w-20">Score</th>
      <th class="px-4 py-3 text-left">Top Finding / 핵심 결과</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div></div>
</section>`;
  }

  _bilingualBlock(enText, koText, opts = {}) {
    const { enClass = 'text-sm text-gray-700', koClass = 'text-sm text-gray-500 italic' } = opts;
    const ko = koText ? `<hr class="my-2 border-gray-200"/><p class="${koClass}">${this._esc(koText)}</p>` : '';
    return `<p class="${enClass}">${this._esc(enText)}</p>${ko}`;
  }

  // ── PICO 카드 헬퍼 ─────────────────────────────────────────────────────────

  _internalValidityLabel(evidenceLevel) {
    const map = { High: { label: 'Low Risk', color: '#10b981' }, Moderate: { label: 'Some Concerns', color: '#f59e0b' }, Low: { label: 'High Risk', color: '#ef4444' }, 'Very Low': { label: 'High Risk', color: '#ef4444' } };
    return map[evidenceLevel] ?? { label: 'Some Concerns', color: '#f59e0b' };
  }

  _edApplicabilityLabel(score) {
    if (score >= 8) return { label: '적용 가능', color: '#10b981' };
    if (score >= 5) return { label: '부분 적용', color: '#f59e0b' };
    return { label: '적용 어려움', color: '#ef4444' };
  }

  // ── PICO 카드 (논문 보고값 중심 · 영-한 병렬 · 차분한 타이포그래피) ──────────

  _buildPicoCard(result, rank) {
    const p = result.paper ?? {};
    const pico = result.pico ?? {};
    const picoKo = result.pico_ko ?? {};
    const evidence = result.evidenceLevel ?? 'Low';
    const studyType = p.scoringData?.studyType ?? 'Other';
    const score = result.clinicalApplicabilityScore ?? p.scoringData?.score ?? 0;
    const validity = this._internalValidityLabel(evidence);
    const edApplicability = this._edApplicabilityLabel(score);
    const baseline = result.baseline ?? 'Not reported';
    const nVal = this._extractN(pico.population ?? '');

    // 영어 원문(줄글) 위 + 한글 번역 아래 — 동일 양식, 블록 장식 없음
    const enKo = (en, ko) => `
      <p class="text-sm text-gray-800 leading-relaxed">${this._esc(en ?? '—')}</p>
      ${ko ? `<p class="text-sm text-gray-500 leading-relaxed mt-1">${this._esc(ko)}</p>` : ''}`;

    const sectionTitle = (label) =>
      `<h3 class="text-base font-bold text-blue-900 mt-7 mb-2 pb-1 border-b border-gray-200">${label}</h3>`;
    const subhead = (label) =>
      `<div class="text-sm font-bold text-blue-700 mt-4 mb-1.5">${label}</div>`;

    const secondaryItems = (result.secondaryOutcomes ?? []).map((s, i) => `
      <li class="mb-2 pl-3 border-l-2 border-gray-200">
        <p class="text-sm text-gray-800 leading-relaxed">${this._esc(s)}</p>
        ${result.secondaryOutcomes_ko?.[i] ? `<p class="text-sm text-gray-500 leading-relaxed mt-0.5">${this._esc(result.secondaryOutcomes_ko[i])}</p>` : ''}
      </li>`).join('');

    const glossaryItems = (result.statGlossary ?? []).map(
      (g) => `<div class="mb-1"><strong class="text-gray-600">${this._esc(g.term)}</strong> — ${this._esc(g.explanation_ko)}</div>`
    ).join('');
    const glossaryBlock = glossaryItems
      ? `<div class="mt-3 bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 leading-relaxed"><div class="font-bold text-gray-600 mb-1.5">통계 용어 풀이</div>${glossaryItems}</div>`
      : '';

    const practiceItems = (result.practiceChange ?? []).map((t, i) => `
      <li class="mb-2 flex gap-2">
        <span class="text-blue-700 font-bold flex-shrink-0">·</span>
        <div>
          <p class="text-sm text-gray-800 leading-relaxed">${this._esc(t)}</p>
          ${result.practiceChange_ko?.[i] ? `<p class="text-sm text-gray-500 leading-relaxed mt-0.5">${this._esc(result.practiceChange_ko[i])}</p>` : ''}
        </div>
      </li>`).join('');

    const doiLink = p.doi
      ? ` · <a href="https://doi.org/${this._esc(p.doi)}" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">DOI</a>`
      : '';

    return `
<div class="bg-white rounded-2xl shadow-md border p-7 fade-in" x-data="{open:true}">
  <div class="flex items-start justify-between gap-4">
    <div class="flex-1 min-w-0">
      <div class="text-xs font-semibold text-gray-400 tracking-wide mb-2">No. ${String(rank + 1).padStart(2, '0')} · ${this._esc(evidence)} Evidence · ${this._esc(studyType)}</div>
      <a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-lg font-bold text-blue-900 hover:text-blue-700 leading-snug block">${this._esc(p.title ?? '')}</a>
      <div class="text-sm text-gray-500 mt-1.5"><strong class="text-gray-600">${this._esc(p.journal ?? '—')}</strong> · ${this._esc(p.pubDate ?? '—')} · <a href="${this._esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener" class="text-blue-600 underline hover:text-blue-800">PubMed</a>${doiLink}</div>
    </div>
    <button @click="open=!open" class="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap mt-1">
      <span x-show="open">접기 ▲</span><span x-show="!open" x-cloak>펼치기 ▼</span>
    </button>
  </div>
  ${subhead('Why It Matters')}
  ${enKo(result.clinicalQuestion, result.clinicalQuestion_ko)}
  <div x-show="open" x-collapse>
    <div class="mt-5">${this._buildFullTextBadge(result, p)}</div>

    ${sectionTitle('PICO Framework')}
    ${subhead('P — Patient')}
    ${enKo(pico.population, picoKo.population)}
    <div class="text-sm text-gray-700 mt-2">
      ${nVal ? `<strong>n = ${this._esc(nVal)}</strong> · ` : ''}<span class="text-gray-500">Baseline —</span> <strong>${this._esc(baseline)}</strong>
    </div>
    ${subhead('I — Intervention')}
    ${enKo(pico.intervention, picoKo.intervention)}
    ${subhead('C — Comparison')}
    ${enKo(pico.comparison, picoKo.comparison)}
    ${subhead('O — Outcome & Results')}
    <div class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Primary</div>
    ${enKo(pico.outcome, picoKo.outcome)}
    ${secondaryItems ? `<div class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-3 mb-1">Secondary</div><ul>${secondaryItems}</ul>` : ''}
    ${glossaryBlock}

    ${sectionTitle('Critical Appraisal & Applicability')}
    <div class="text-sm text-gray-800 mb-2"><span class="font-bold text-blue-700">Internal Validity</span> — <strong>${this._esc(validity.label)}</strong></div>
    <div class="text-sm text-gray-700 mb-3"><span class="text-gray-500">Reason :</span> ${this._esc(p.scoringData?.rationale ?? '—')}</div>
    <div class="text-sm font-bold text-blue-700 mb-1">Limitations</div>
    ${enKo(result.limitations, result.limitations_ko)}
    <div class="text-sm text-gray-800 mt-3"><span class="font-bold text-blue-700">ED Applicability</span> — <strong>${this._esc(edApplicability.label)}</strong></div>

    ${sectionTitle('Clinical Bottom Line')}
    ${enKo(result.clinicalTakeaway, result.clinicalTakeaway_ko)}
    ${practiceItems ? `${subhead('Practice Change')}<ul class="mt-1">${practiceItems}</ul>` : ''}
  </div>
</div>`;
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 인라인 <script>에 JSON을 안전하게 임베드 — '<' 이스케이프로 '</script>'·'<!--' 주입 차단
  _jsonForScript(obj) {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  // 대시보드 JS가 실제로 쓰는 필드만 임베드 (abstract/fullText 등 대용량·비신뢰 텍스트 제외)
  _slimPaper(p) {
    return {
      pmid: p.pmid, title: p.title, journal: p.journal, authors: p.authors,
      pubDate: p.pubDate, pubmedUrl: p.pubmedUrl, scoringData: p.scoringData,
    };
  }

  async run(sessionId, data) {
    this.logger.section('ReportGeneratorAgent — Output Generation');
    await this._ensureDirs();
    const [jsonPath, htmlPath] = await Promise.all([
      this.saveJsonArchive(sessionId, data),
      this.saveHtmlDashboard(sessionId, data),
    ]);
    this.logger.info('Reports generated successfully', { jsonPath, htmlPath });
    return { jsonPath, htmlPath };
  }
}
