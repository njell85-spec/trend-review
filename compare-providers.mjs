/**
 * compare-providers.mjs
 *
 * 최신 archive JSON에서 top papers를 불러와
 * Claude(캐시) vs GPT-4o(신규 분석)를 나란히 비교하는 HTML 생성.
 *
 * Usage:
 *   node compare-providers.mjs
 *   node compare-providers.mjs --archive output/reports/archive_litreview_XXXX.json
 */
import 'dotenv/config';
import { readFile, writeFile, readdir } from 'fs/promises';
import path from 'path';
import { FilterAnalyzerAgent } from './src/agents/FilterAnalyzerAgent.js';

// ── 최신 archive 파일 찾기 ─────────────────────────────────────────────────
async function findLatestArchive(dir) {
  const files = (await readdir(dir))
    .filter((f) => f.startsWith('archive_') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) throw new Error(`No archive files found in ${dir}`);
  return path.join(dir, files[0]);
}

// ── paper 객체 재구성 (full-text 포함) ────────────────────────────────────
function reconstructPapers(topPapers) {
  return topPapers.map((r) => ({
    ...(r.paper ?? {}),
    fullText: r.fullText ?? r.paper?.fullText,
    fullTextSource: r.fullTextSource ?? r.paper?.fullTextSource,
    fullTextLength: r.fullTextLength ?? r.paper?.fullTextLength,
    figures: r.figures ?? r.paper?.figures ?? [],
  }));
}

// ── 비교 HTML 생성 ─────────────────────────────────────────────────────────
function buildComparisonHtml(comparisons, sessionId) {
  const ts = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const cards = comparisons.map((c, idx) => buildCard(c, idx)).join('\n');

  return `<!DOCTYPE html>
<html lang="ko" class="scroll-smooth">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Claude vs GPT-4o — 논문 분석 비교</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body{background:#f8fafc;font-family:system-ui,sans-serif}
  .claude-col{border-top:3px solid #f97316}
  .gpt-col{border-top:3px solid #10b981}
  .diff-highlight{background:#fef9c3}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeIn .4s ease-out}
</style>
</head>
<body>

<!-- Header -->
<header class="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white shadow-xl">
  <div class="max-w-7xl mx-auto px-6 py-6">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight flex items-center gap-3">
          🤖 LLM 비교 분석 — Claude vs GPT-4o
        </h1>
        <p class="text-gray-300 text-sm mt-1">동일 논문·동일 full-text 입력 → 두 AI의 PICO 분석 비교</p>
      </div>
      <div class="text-right text-xs text-gray-400">
        <div>기준: ${sessionId}</div>
        <div>생성: ${ts}</div>
        <div>논문 수: ${comparisons.length}편</div>
      </div>
    </div>
    <!-- Legend -->
    <div class="flex gap-6 mt-4">
      <div class="flex items-center gap-2">
        <div class="w-4 h-1 rounded bg-orange-500"></div>
        <span class="text-sm font-semibold text-orange-300">Claude Sonnet 4.6</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-4 h-1 rounded bg-emerald-400"></div>
        <span class="text-sm font-semibold text-emerald-300">GPT-4o</span>
      </div>
    </div>
  </div>
</header>

<main class="max-w-7xl mx-auto px-4 py-8 space-y-10">
  ${cards}
</main>

<footer class="mt-12 border-t bg-white py-6 text-center text-xs text-gray-400">
  <p>EM/CCM Literature Review Agent · Claude vs GPT-4o 비교 분석</p>
  <p class="mt-1">본 시스템의 분석 결과는 보조 도구이며, 임상 결정은 전문의 판단을 따르십시오.</p>
</footer>

</body>
</html>`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCard({ paper, claude, gpt }, idx) {
  const p = paper ?? {};
  const title = esc(p.title ?? '(제목 없음)');
  const authors = esc((p.authors ?? []).slice(0, 3).join(', ') + ((p.authors?.length ?? 0) > 3 ? ' 외' : ''));
  const journal = esc(`${p.journal ?? ''} (${p.pubDate ?? ''})`);

  const ftSrc = p.fullTextSource ?? 'abstract-only';
  const ftBadge = ftSrc === 'PMC'
    ? `<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">📄 PMC full-text</span>`
    : ftSrc === 'Unpaywall'
    ? `<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">🔓 Unpaywall</span>`
    : `<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200">📃 Abstract only</span>`;

  const claudeScore = claude?.clinicalApplicabilityScore ?? '—';
  const gptScore = gpt?.clinicalApplicabilityScore ?? '—';
  const scoreDiff = (typeof claudeScore === 'number' && typeof gptScore === 'number')
    ? Math.abs(claudeScore - gptScore)
    : null;
  const scoreDiffBadge = scoreDiff !== null
    ? `<span class="text-xs px-2 py-0.5 rounded-full ${scoreDiff === 0 ? 'bg-green-100 text-green-700' : scoreDiff <= 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}">점수 차이: ${scoreDiff}</span>`
    : '';

  const picoFields = [
    { key: 'population',    labelEn: 'P — Population',    labelKo: '대상 환자군', icon: '👥' },
    { key: 'intervention',  labelEn: 'I — Intervention',  labelKo: '중재/노출',   icon: '💉' },
    { key: 'comparison',    labelEn: 'C — Comparison',    labelKo: '비교군',      icon: '⚖️' },
    { key: 'outcome',       labelEn: 'O — Outcome',       labelKo: '결과 지표',   icon: '📊' },
  ];

  const picoRows = picoFields.map(({ key, labelEn, labelKo, icon }) => `
    <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden mb-3">
      <div class="col-span-2 bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600">
        ${icon} ${labelEn} / ${labelKo}
      </div>
      <div class="claude-col bg-orange-50 px-3 py-3 text-sm text-gray-700 border-r border-gray-200 leading-relaxed">
        ${esc(claude?.pico?.[key] ?? '—')}
        ${claude?.pico_ko?.[key] ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(claude.pico_ko[key])}</p>` : ''}
      </div>
      <div class="gpt-col bg-emerald-50 px-3 py-3 text-sm text-gray-700 leading-relaxed">
        ${esc(gpt?.pico?.[key] ?? '—')}
        ${gpt?.pico_ko?.[key] ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(gpt.pico_ko[key])}</p>` : ''}
      </div>
    </div>`).join('');

  const findingsRows = (() => {
    const maxLen = Math.max(
      (claude?.keyFindings ?? []).length,
      (gpt?.keyFindings ?? []).length,
      1
    );
    return Array.from({ length: maxLen }, (_, i) => `
    <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden mb-2">
      <div class="claude-col bg-orange-50 px-3 py-2 text-sm text-gray-700 border-r border-gray-200 leading-relaxed">
        <span class="text-orange-400 mr-1">✓</span>${esc(claude?.keyFindings?.[i] ?? '—')}
        ${claude?.keyFindings_ko?.[i] ? `<p class="text-xs text-gray-500 italic mt-1 ml-4">${esc(claude.keyFindings_ko[i])}</p>` : ''}
      </div>
      <div class="gpt-col bg-emerald-50 px-3 py-2 text-sm text-gray-700 leading-relaxed">
        <span class="text-emerald-500 mr-1">✓</span>${esc(gpt?.keyFindings?.[i] ?? '—')}
        ${gpt?.keyFindings_ko?.[i] ? `<p class="text-xs text-gray-500 italic mt-1 ml-4">${esc(gpt.keyFindings_ko[i])}</p>` : ''}
      </div>
    </div>`).join('');
  })();

  return `
<div class="bg-white rounded-2xl shadow-md border fade-in overflow-hidden">
  <!-- Paper header -->
  <div class="bg-gradient-to-r from-gray-800 to-gray-700 text-white px-6 py-4">
    <div class="flex items-start gap-3">
      <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20 text-sm font-bold flex-shrink-0">${String(idx + 1).padStart(2, '0')}</span>
      <div class="flex-1 min-w-0">
        <a href="${esc(p.pubmedUrl ?? '#')}" target="_blank" rel="noopener"
           class="text-base font-bold text-white hover:text-blue-300 leading-snug block mb-1">
          ${title}
        </a>
        <div class="text-gray-300 text-xs">${authors} · ${journal}</div>
        <div class="flex items-center gap-3 mt-2">
          ${ftBadge}
          ${scoreDiffBadge}
        </div>
      </div>
    </div>
  </div>

  <div class="px-6 py-4 space-y-5">

    <!-- Score comparison -->
    <div class="grid grid-cols-2 gap-3">
      <div class="claude-col bg-orange-50 rounded-lg p-3 border border-orange-100 text-center">
        <div class="text-xs text-orange-500 font-semibold mb-1">🤖 Claude Sonnet 4.6</div>
        <div class="text-2xl font-bold text-orange-600">${claudeScore}</div>
        <div class="text-xs text-gray-400">임상 적용성 점수</div>
        <div class="text-xs mt-1">
          <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">${esc(claude?.evidenceLevel ?? '—')} Evidence</span>
        </div>
      </div>
      <div class="gpt-col bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center">
        <div class="text-xs text-emerald-600 font-semibold mb-1">🤖 GPT-4o</div>
        <div class="text-2xl font-bold text-emerald-600">${gptScore}</div>
        <div class="text-xs text-gray-400">임상 적용성 점수</div>
        <div class="text-xs mt-1">
          <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">${esc(gpt?.evidenceLevel ?? '—')} Evidence</span>
        </div>
      </div>
    </div>

    <!-- Clinical Question -->
    <div>
      <div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">🔍 Clinical Question / 임상 질문</div>
      <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden">
        <div class="claude-col bg-orange-50 px-3 py-3 text-sm text-gray-700 border-r border-gray-200 leading-relaxed">
          ${esc(claude?.clinicalQuestion ?? '—')}
          ${claude?.clinicalQuestion_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(claude.clinicalQuestion_ko)}</p>` : ''}
        </div>
        <div class="gpt-col bg-emerald-50 px-3 py-3 text-sm text-gray-700 leading-relaxed">
          ${esc(gpt?.clinicalQuestion ?? '—')}
          ${gpt?.clinicalQuestion_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(gpt.clinicalQuestion_ko)}</p>` : ''}
        </div>
      </div>
    </div>

    <!-- PICO -->
    <div>
      <div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">📋 PICO</div>
      <div class="grid grid-cols-2 text-xs font-semibold mb-1">
        <div class="text-orange-500 pl-2">Claude Sonnet 4.6</div>
        <div class="text-emerald-600 pl-2">GPT-4o</div>
      </div>
      ${picoRows}
    </div>

    <!-- Key Findings -->
    <div>
      <div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">🔑 Key Findings / 핵심 결과</div>
      <div class="grid grid-cols-2 text-xs font-semibold mb-1">
        <div class="text-orange-500 pl-2">Claude Sonnet 4.6</div>
        <div class="text-emerald-600 pl-2">GPT-4o</div>
      </div>
      ${findingsRows}
    </div>

    <!-- Clinical Takeaway -->
    <div>
      <div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">⚡ Clinical Takeaway / 임상 적용 포인트</div>
      <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden">
        <div class="claude-col bg-amber-50 px-3 py-3 text-sm text-gray-700 border-r border-gray-200 leading-relaxed">
          ${esc(claude?.clinicalTakeaway ?? '—')}
          ${claude?.clinicalTakeaway_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(claude.clinicalTakeaway_ko)}</p>` : ''}
        </div>
        <div class="gpt-col bg-amber-50 px-3 py-3 text-sm text-gray-700 leading-relaxed">
          ${esc(gpt?.clinicalTakeaway ?? '—')}
          ${gpt?.clinicalTakeaway_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(gpt.clinicalTakeaway_ko)}</p>` : ''}
        </div>
      </div>
    </div>

    <!-- Limitations -->
    <div>
      <div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">⚠️ Limitations / 제한점</div>
      <div class="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden">
        <div class="claude-col bg-red-50 px-3 py-3 text-sm text-gray-700 border-r border-gray-200 leading-relaxed">
          ${esc(claude?.limitations ?? '—')}
          ${claude?.limitations_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(claude.limitations_ko)}</p>` : ''}
        </div>
        <div class="gpt-col bg-red-50 px-3 py-3 text-sm text-gray-700 leading-relaxed">
          ${esc(gpt?.limitations ?? '—')}
          ${gpt?.limitations_ko ? `<hr class="my-2 border-gray-200"/><p class="text-xs text-gray-500 italic">${esc(gpt.limitations_ko)}</p>` : ''}
        </div>
      </div>
    </div>

  </div>
</div>`;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const archiveArgIdx = args.indexOf('--archive');
  const archivePath = archiveArgIdx >= 0
    ? args[archiveArgIdx + 1]
    : await findLatestArchive(path.join(process.cwd(), 'output', 'reports'));

  console.log(`\n📂 Archive: ${archivePath}`);
  const archive = JSON.parse(await readFile(archivePath, 'utf8'));
  const { topPapers, executionStats } = archive;
  const sessionId = path.basename(archivePath, '.json').replace('archive_', '');

  console.log(`📄 Top papers: ${topPapers.length}편\n`);

  // Claude 결과는 archive에 이미 있음
  const claudeResults = topPapers;

  // GPT-4o 분석 실행
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 .env에 없습니다. 추가 후 다시 실행하세요.');
    process.exit(1);
  }

  console.log('🤖 GPT-4o PICO 분석 시작...\n');
  const gptAgent = new FilterAnalyzerAgent({ provider: 'openai', topN: topPapers.length });
  const papers = reconstructPapers(topPapers);
  const gptResults = await gptAgent.analyzePico(papers);

  // 결과 병합
  const comparisons = topPapers.map((claudeResult, i) => ({
    paper: claudeResult.paper ?? {},
    fullTextSource: claudeResult.fullTextSource,
    claude: claudeResult,
    gpt: gptResults[i],
  }));

  // HTML 저장
  const html = buildComparisonHtml(comparisons, sessionId);
  const outPath = path.join(
    process.cwd(), 'output', 'reports',
    `compare_${sessionId}.html`
  );
  await writeFile(outPath, html, 'utf8');

  console.log(`\n✅ 비교 완료!`);
  console.log(`   HTML: ${outPath}`);
  console.log('\n결과 요약:');
  comparisons.forEach((c, i) => {
    const cs = c.claude?.clinicalApplicabilityScore ?? '?';
    const gs = c.gpt?.clinicalApplicabilityScore ?? '?';
    const diff = typeof cs === 'number' && typeof gs === 'number' ? Math.abs(cs - gs) : '?';
    console.log(`   [${i + 1}] ${(c.paper?.title ?? '').slice(0, 55)}…`);
    console.log(`       Claude: ${cs}점 | GPT-4o: ${gs}점 | 차이: ${diff}`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
