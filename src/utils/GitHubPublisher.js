/**
 * GitHubPublisher — 매일 실행 결과를 GitHub Pages(index.html)에 누적 업데이트.
 *
 * 디자인: "Sky" 파스텔 테마 (A/Aurora 베이스, 파스텔 스카이블루 키컬러).
 * 자체 완결형(인라인 CSS) — Tailwind CDN 비의존.
 *
 * 배포: git push 우선 → 실패 시 GitHub REST API 폴백.
 */
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { llmTelemetry } from './LLMClient.js';

const API = 'https://api.github.com';

// ── 디자인 토큰 (Sky 파스텔) ──────────────────────────────────────────────────
const T = {
  hd: 'radial-gradient(120% 90% at 0% 0%,#9ec7f5 0%,#7aa9ec 44%,#6f9be6 74%),radial-gradient(80% 70% at 100% 0%,#d9ecfd88 0%,transparent 60%)',
  key: '#5b8fd9', key2: '#7dabe8', soft: '#e9f2fd', softTxt: '#3f72bf',
  page: '#eef4fc', ey: '#e3effb', ink: '#0f172a', sub: '#64748b', muted: '#94a3b8',
  sec: '#5fb3a0', secTag: '#3f9b86',
  SANS: `'NanumSquare','NanumBarunGothic','NanumGothic','Apple SD Gothic Neo','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`,
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── SVG 아이콘 ────────────────────────────────────────────────────────────────
const IC = {
  star: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="${c}" width="100%" height="100%"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z"/></svg>`,
  book: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5"/></svg>`,
  bulb: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10c1 1 1.5 1.5 1.5 3h5c0-1.5.5-2 1.5-3a6 6 0 00-4-10z"/></svg>`,
  target: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" width="100%" height="100%"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="${c}"/></svg>`,
  pulse: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>`,
  scale: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M12 3v18M5 7h14M5 7l-3 6h6zM19 7l-3 6h6zM8 21h8"/></svg>`,
  filter: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>`,
  chev: (c = 'currentColor') => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M6 9l6 6 6-6"/></svg>`,
};

// ── 결과 비교 막대 (선택적; p.viz 있을 때만) ─────────────────────────────────
function bars(v, accent, accentTag) {
  const max = Math.max(v.a.v, v.b.v) * 1.18;
  const w = (x) => `${(x / max * 100).toFixed(1)}%`;
  const row = (x, col) => `<div class="bar-row">
      <span class="bar-lab">${esc(x.l)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${w(x.v)};background:${col}"></div><span class="bar-val">${x.v}%</span></div>
      <span class="bar-n">${esc(x.n ?? '')}</span></div>`;
  return `<div class="viz-block">
    <div class="viz-head"><span class="viz-title">${esc(v.title)}</span><span class="viz-tag" style="color:${accentTag};background:${accentTag}1f">${esc(v.tag)}</span></div>
    ${row(v.a, accent)}${row(v.b, '#cbd5e1')}</div>`;
}

// ── 영어 원문 + 한글 번역 병렬 ───────────────────────────────────────────────
function enko(en, ko) {
  return `<p class="txt">${esc(en ?? '—')}</p>${ko ? `<p class="txt ko">${esc(ko)}</p>` : ''}`;
}

export class GitHubPublisher {
  constructor({
    token = process.env.GITHUB_TOKEN,
    owner = process.env.GITHUB_OWNER,
    repo = process.env.GITHUB_REPO,
    repoPath = process.cwd(),
  } = {}) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.pagesUrl = `https://${owner}.github.io/${repo}/`;
    this._repoPath = repoPath;
  }

  // ── 라벨 헬퍼 ───────────────────────────────────────────────────────────────
  static _evidenceShort(ev) {
    return { 'Meta-analysis': 'Meta', 'Systematic Review': 'SR', Moderate: 'Mod', 'Very Low': 'V.Low' }[ev] ?? ev;
  }
  static _edApplicability(score) {
    const s = Number(score);
    if (s >= 8) return '적용 가능';
    if (s >= 5) return '부분 적용';
    return '적용 어려움';
  }
  static _internalValidity(ev) {
    if (['High', 'RCT', 'Meta', 'Meta-analysis', 'Systematic Review'].includes(ev)) return 'Low Risk · 낮은 비뚤림';
    if (['Moderate', 'Cohort', 'Validation'].includes(ev)) return 'Some Concerns · 일부 우려';
    return 'High Risk · 높은 비뚤림';
  }

  // 발행일 표기: 가능하면 연-월(YYYY.MM)까지. ('2026-03-28'→'2026.03', '2026'→'2026')
  static _fmtDate(d) {
    const s = String(d ?? '').trim();
    const m = s.match(/^(\d{4})[-.\/]?(\d{1,2})?/);
    if (!m) return s;
    return m[2] ? `${m[1]}.${m[2].padStart(2, '0')}` : m[1];
  }

  // ── 논문 카드 ───────────────────────────────────────────────────────────────
  _buildPaperCard(p) {
    const paper = p.paper ?? {};
    const title = paper.title ?? '제목 없음';
    const titleKo = p.title_ko ?? p.clinicalQuestion_ko_title ?? '';
    const journal = paper.journal ?? '';
    const date = GitHubPublisher._fmtDate(paper.pubDate);
    const pmid = paper.pmid ?? '';
    const pmurl = paper.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '#');
    const doi = paper.doi ?? '';
    const trial = p.trial ?? '';
    const score = p.clinicalApplicabilityScore ?? paper.scoringData?.score ?? '—';
    const ev = p.evidenceLevel ?? paper.scoringData?.studyType ?? '—';
    const studyType = paper.scoringData?.studyType ?? '';

    const picoEn = p.pico ?? {};
    const picoKo = p.pico_ko ?? {};

    const secondary = (p.secondaryOutcomes ?? []).map((s, k) => `
      <li class="sec-li"><p class="txt">${esc(s)}</p>${p.secondaryOutcomes_ko?.[k] ? `<p class="txt ko">${esc(p.secondaryOutcomes_ko[k])}</p>` : ''}</li>`).join('');

    const glossary = (p.statGlossary ?? []).map(
      (g) => `<div class="gloss-i"><b>${esc(g.term)}</b> — ${esc(g.explanation_ko)}</div>`).join('');

    const practice = (p.practiceChange ?? []).map((t, k) => `
      <li class="pc-li"><span class="pc-dot"></span><div><p class="txt">${esc(t)}</p>${p.practiceChange_ko?.[k] ? `<p class="txt ko">${esc(p.practiceChange_ko[k])}</p>` : ''}</div></li>`).join('');

    const vizBlock = p.viz
      ? `<div class="viz">${bars(p.viz.primary, T.key, T.key)}${p.viz.secondary ? `<div style="height:10px"></div>${bars(p.viz.secondary, T.sec, T.secTag)}` : ''}</div>`
      : '';

    const doiLink = doi ? ` · <a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener" class="lnk">DOI</a>` : '';

    return `<article class="paper-card">
      <div class="pc-top">
        <div class="medal">${IC.star('#fff')}</div>
        <div class="ttl">${esc(titleKo || title)}</div>
        ${titleKo ? `<div class="ttle">${esc(title)}${trial ? ` · ${esc(trial)}` : ''}</div>` : (trial ? `<div class="ttle">${esc(trial)}</div>` : '')}
        <div class="meta"><span class="i">${IC.book(T.muted)}</span>${esc(journal)} · ${esc(date)}${pmid ? ` · PMID ${esc(pmid)}` : ''}</div>
        <div class="chips">${Number.isFinite(paper.scoringData?.qualityScore) ? `<span class="chip qr">스크리닝 질 ${esc(paper.scoringData.qualityScore)} · 적합도 ${esc(paper.scoringData.relevanceScore)}</span>` : ''}<span class="chip sc">Opus 종합 ${esc(score)}점</span>${p.evidenceSource ? `<span class="chip src">${esc(p.evidenceSource)}</span>` : ''}</div>
      </div>
      <div class="pc-body">
        <div class="lbl"><span class="i">${IC.bulb(T.key)}</span>WHY IT MATTERS</div>
        ${enko(p.clinicalQuestion, p.clinicalQuestion_ko)}

        <div class="lbl"><span class="i">${IC.target(T.key)}</span>PICO</div>
        <div class="pico">
          <div class="pr"><span class="pk">P</span><div class="pv">${enko(picoEn.population, picoKo.population)}</div></div>
          <div class="pr"><span class="pk">I</span><div class="pv">${enko(picoEn.intervention, picoKo.intervention)}</div></div>
          <div class="pr"><span class="pk">C</span><div class="pv">${enko(picoEn.comparison, picoKo.comparison)}</div></div>
          <div class="pr"><span class="pk">O</span><div class="pv">${enko(picoEn.outcome, picoKo.outcome)}</div></div>
        </div>

        <div class="lbl"><span class="i">${IC.pulse(T.key)}</span>핵심 결과</div>
        ${vizBlock}
        ${secondary ? `<div class="sub-h">2차 결과</div><ul class="sec-ul">${secondary}</ul>` : ''}
        ${glossary ? `<div class="gloss"><div class="gloss-h">📊 통계 용어</div>${glossary}</div>` : ''}

        <div class="lbl"><span class="i">${IC.scale(T.key)}</span>비평적 평가</div>
        <p class="txt"><b class="hl">Internal Validity</b> — ${esc(GitHubPublisher._internalValidity(ev))}</p>
        ${paper.scoringData?.rationale ? `<p class="txt ko">${esc(paper.scoringData.rationale)}</p>` : ''}
        ${(p.limitations || p.limitations_ko) ? `<div class="sub-h">제한점</div>${enko(p.limitations, p.limitations_ko)}` : ''}

        <div class="lbl"><span class="i">${IC.bulb(T.key)}</span>임상 결론</div>
        ${enko(p.clinicalTakeaway, p.clinicalTakeaway_ko)}
        ${practice ? `<div class="sub-h">Practice Change</div><ul class="pc-ul">${practice}</ul>` : ''}

        ${(p.sources?.length) ? `<div class="src-box"><div class="src-h">🔎 본문 확보·웹 보강 출처</div>${p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="src-li">${esc(s.label)}</a>`).join('')}</div>` : ''}

        <div class="pc-foot"><a href="${esc(pmurl)}" target="_blank" rel="noopener" class="lnk">PubMed${pmid ? ` ${esc(pmid)}` : ''}</a>${doiLink}${studyType ? ` · ${esc(studyType)}` : ''}</div>
      </div>
    </article>`;
  }

  // ── 하루 섹션 (접이식) ──────────────────────────────────────────────────────
  // ── 가이드라인 캐치업 카드 (PICO 대신 요약·변경점·임팩트) ─────────────────────
  _buildGuidelineCard(g) {
    const paper = g.paper ?? {};
    const title = paper.title ?? g.title ?? '';
    const titleKo = g.title_ko ?? '';
    const journal = paper.journal ?? '';
    const date = GitHubPublisher._fmtDate(paper.pubDate);
    const pmid = paper.pmid ?? '';
    const pmurl = paper.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '#');
    const doi = paper.doi ?? '';
    const doiLink = doi ? ` · <a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener" class="lnk">DOI</a>` : '';

    const summary = (g.summary ?? []).map((t, k) => `
      <li class="pc-li"><span class="pc-dot gl-dot"></span><div><p class="txt">${esc(t)}</p>${g.summary_ko?.[k] ? `<p class="txt ko">${esc(g.summary_ko[k])}</p>` : ''}</div></li>`).join('');

    const changes = (g.keyChanges ?? []).map((c) => `
      <div class="gl-chg">${c.topic ? `<div class="gl-chg-t">${esc(c.topic)}</div>` : ''}${enko(c.detail, c.detail_ko)}</div>`).join('');

    return `<article class="guideline-card">
      <div class="pc-top gl-top">
        <div class="medal gl-medal">${IC.book('#fff')}</div>
        <div class="chips" style="margin-top:0;margin-bottom:10px"><span class="chip gl">📋 가이드라인</span>${g.org ? `<span class="chip org">${esc(g.org)}</span>` : ''}${g.version ? `<span class="chip yr">${esc(g.version)}</span>` : ''}</div>
        <div class="ttl">${esc(titleKo || title)}</div>
        ${titleKo ? `<div class="ttle">${esc(title)}</div>` : ''}
        ${g.scope_ko ? `<p class="txt ko" style="margin-top:6px">${esc(g.scope_ko)}</p>` : ''}
        <div class="meta"><span class="i">${IC.book(T.muted)}</span>${esc(journal)} · ${esc(date)}${pmid ? ` · PMID ${esc(pmid)}` : ''}</div>
      </div>
      <div class="pc-body">
        ${summary ? `<div class="lbl gl-lbl"><span class="i">${IC.target(T.sec)}</span>핵심 권고</div><ul class="pc-ul">${summary}</ul>` : ''}
        ${changes
          ? `<div class="lbl gl-lbl"><span class="i">${IC.pulse(T.sec)}</span>이전 판 대비 주요 변경점</div><div class="gl-changes">${changes}</div>`
          : (g.changesUnavailable
            ? `<div class="lbl gl-lbl"><span class="i">${IC.pulse(T.sec)}</span>이전 판 대비 주요 변경점</div><div class="gl-changes"><p class="txt ko">공개 초록/확보 본문에 구체적 변경 내용이 없어(대개 본문 페이월) 세부 변경점을 확보하지 못했습니다. 아래 원문 링크에서 확인하세요.</p></div>`
            : '')}
        ${(g.practiceImpact || g.practiceImpact_ko) ? `<div class="lbl gl-lbl"><span class="i">${IC.bulb(T.sec)}</span>임상 임팩트</div>${enko(g.practiceImpact, g.practiceImpact_ko)}` : ''}
        ${(g.sources?.length) ? `<div class="src-box"><div class="src-h">🔎 출처</div>${g.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="src-li">${esc(s.label)}</a>`).join('')}</div>` : ''}
        <div class="pc-foot"><a href="${esc(pmurl)}" target="_blank" rel="noopener" class="lnk">PubMed${pmid ? ` ${esc(pmid)}` : ''}</a>${doiLink} · 가이드라인 캐치업</div>
      </div>
    </article>`;
  }

  // ── 가이드라인 전용 접이식 섹션 (논문과 분리, 한눈에 '가이드라인'으로 식별) ──────
  _buildGuidelineSection(dateStr, generatedAt, guideline, { isToday = false } = {}) {
    const card = this._buildGuidelineCard(guideline);
    const gTitle = guideline.title_ko || guideline.paper?.title || '';
    const gMeta = `${guideline.org || guideline.paper?.journal || ''}${guideline.version ? ` · ${guideline.version}` : ''}`;
    // 논문 섹션과 동일한 흰 박스로 통일 — 구별은 앞쪽 '📋 가이드라인' 라벨로만
    const cls = isToday ? 'day day-today' : 'day day-past';
    const openAttr = isToday ? ' open' : '';
    const badge = isToday ? '<span class="t-badge">NEW</span>' : '';
    return `
<!-- GSECTION:${dateStr} -->
<details${openAttr} class="${cls}">
  <summary class="day-sum">
    <div class="day-head">
      ${badge}<span class="day-date">${esc(dateStr)}</span><span class="gl-tag">📋 가이드라인</span><span class="day-gen">생성 ${esc(generatedAt)}</span>
      <span class="day-chev">${IC.chev(T.muted)}</span>
    </div>
    <div class="day-prev"><span class="day-prev-medal">${IC.book(T.sec)}</span><div><div class="day-prev-t">${esc(gTitle)}</div><div class="day-prev-m">${esc(gMeta)}</div></div></div>
  </summary>
  <div class="day-panel">${card}</div>
</details>
<!-- /GSECTION:${dateStr} -->`;
  }

  _buildSection(dateStr, generatedAt, topPapers, { isToday = false, route = '' } = {}) {
    const paperCards = topPapers.map((p) => this._buildPaperCard(p)).join('\n');
    const cards = paperCards;
    const cnt = topPapers.length;
    const previewTitle = topPapers[0]
      ? (topPapers[0].title_ko || topPapers[0].paper?.title || '')
      : '';
    const previewMeta = topPapers[0]
      ? `${topPapers[0].paper?.journal ?? ''} · ${GitHubPublisher._fmtDate(topPapers[0].paper?.pubDate)}`
      : '';
    const cls = isToday ? 'day day-today' : 'day day-past';
    const openAttr = isToday ? ' open' : '';
    const badge = isToday ? '<span class="t-badge">TODAY</span>' : '';

    return `
<!-- SECTION:${dateStr} -->
<details${openAttr} class="${cls}">
  <summary class="day-sum">
    <div class="day-head">
      ${badge}<span class="day-date">${esc(dateStr)}</span>
      <span class="day-cnt">· ${cnt}편</span>
      <span class="day-gen">생성 ${esc(generatedAt)}${route ? ` · LLM ${esc(route)}` : ''}</span>
      <span class="day-chev">${IC.chev(T.muted)}</span>
    </div>
    <div class="day-prev"><span class="day-prev-medal">${IC.star(T.key2)}</span><div><div class="day-prev-t">${esc(previewTitle)}</div><div class="day-prev-m">${esc(previewMeta)}</div></div></div>
  </summary>
  <div class="day-panel">${cards}</div>
</details>
<!-- /SECTION:${dateStr} -->`;
  }

  // 하위호환 별칭 (legacy 호출부)
  _buildTodaySection(dateStr, generatedAt, topPapers) {
    return this._buildSection(dateStr, generatedAt, topPapers, { isToday: true });
  }

  // ── 누적 아카이브 표의 행(읽음 체크박스 포함) ──────────────────────────────────
  _tableRows(dateStr, topPapers, guideline = null) {
    const rows = topPapers.map((p) => {
      const paper = p.paper ?? {};
      const pmid = paper.pmid ?? '';
      const url = paper.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '#');
      const title = p.title_ko || paper.title || '';
      const journal = paper.journal ?? '';
      return `<tr data-pmid="${esc(pmid)}"><td class="c-date">${esc(dateStr)}</td><td class="c-jour">${esc(journal)}</td><td class="c-title"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></td><td class="c-read"><input type="checkbox" class="readcb" data-pmid="${esc(pmid)}" aria-label="읽음"></td></tr>`;
    });
    if (guideline) {
      const gp = guideline.paper ?? {};
      const pmid = gp.pmid ?? '';
      const url = gp.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '#');
      const title = guideline.title_ko || gp.title || '';
      const journal = guideline.org || gp.journal || '';
      // data-guideline 마커 — 날짜 기준 행 교체에서 제외(가이드는 논문과 라이프사이클이
      // 다름: 주 1회 소개 후 계속 남아야 하고, 논문 재실행 날짜 교체에 지워지면 안 됨)
      rows.push(`<tr data-pmid="${esc(pmid)}" data-guideline="1"><td class="c-date">${esc(dateStr)}</td><td class="c-jour">📋 ${esc(journal)}</td><td class="c-title"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></td><td class="c-read"><input type="checkbox" class="readcb" data-pmid="${esc(pmid)}" aria-label="읽음"></td></tr>`);
    }
    return rows.join('');
  }

  // ── 전체 페이지 스캐폴드 ────────────────────────────────────────────────────
  buildPage(sectionsHtml, { days = 1, papers = 1, updated = '', tableRows = '' } = {}) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EM/CCM Trend Review</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{font-family:${T.SANS};line-height:1.5;background:${T.page};color:${T.ink}}
.i{display:inline-block;vertical-align:middle}
.wrap{max-width:460px;margin:0 auto;min-height:100vh;padding-bottom:34px}
a{color:inherit}
/* header */
.hd{position:relative;padding:30px 22px 64px;overflow:hidden;color:#fff;background:${T.key};background-image:${T.hd}}
.hd .ey{font-size:10.5px;letter-spacing:2.5px;text-transform:uppercase;color:${T.ey};font-weight:800}
.hd h1{font-size:23px;font-weight:800;margin-top:5px;letter-spacing:-.6px}
.hd .fn{display:inline-flex;align-items:center;gap:7px;margin-top:12px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.3);padding:6px 12px;border-radius:99px;font-size:11px;font-weight:700}
.hd .fn .i{width:13px;height:13px}
.stats{display:flex;gap:10px;margin:-44px 18px 0;position:relative;z-index:2}
.sc{flex:1;background:rgba(255,255,255,.92);border:1px solid #fff;border-radius:16px;padding:13px;text-align:center;box-shadow:0 12px 30px -8px ${T.key}40}
.sc .n{font-size:21px;font-weight:800;color:${T.key};font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.sc .l{font-size:9px;color:${T.sub};margin-top:3px;letter-spacing:.5px;text-transform:uppercase}
/* archive */
.archive{padding:20px 18px 0;display:flex;flex-direction:column;gap:12px}
details{border-radius:18px;overflow:hidden}
.day-today{background:#fff;border:1.5px solid ${T.key};box-shadow:0 20px 50px -22px ${T.key}66}
.day-past{background:#fff;border:1px solid ${T.soft};box-shadow:0 8px 22px -14px ${T.key}33}
.day-sum{list-style:none;cursor:pointer;padding:15px 16px;display:block}
.day-sum::-webkit-details-marker{display:none}
.day-head{display:flex;align-items:center;gap:8px}
.t-badge{background:linear-gradient(90deg,${T.key},${T.key2});color:#fff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:7px;box-shadow:0 4px 12px -2px ${T.key}66}
.day-date{font-weight:800;font-size:15px}
.day-cnt{color:${T.muted};font-size:12px}
.day-gen{color:${T.muted};font-size:10.5px;margin-left:auto}
.day-chev{width:16px;height:16px;color:${T.muted};transition:transform .2s}
details[open] .day-chev{transform:rotate(180deg)}
.day-prev{display:flex;align-items:flex-start;gap:8px;margin-top:10px}
.day-prev-medal{width:16px;height:16px;flex:none;margin-top:1px}
.day-prev-t{font-size:13.5px;font-weight:800;line-height:1.35;color:${T.ink}}
.day-prev-m{font-size:11px;color:${T.muted};margin-top:2px}
details[open] .day-prev{display:none}
.day-panel{padding:0 14px 14px}
/* paper card */
.paper-card{border-top:1px solid ${T.soft}}
.pc-top{padding:18px 6px 16px}
.medal{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -6px #f59e0baa}
.medal svg{width:22px;height:22px;color:#fff}
.ttl{font-size:16px;font-weight:800;line-height:1.4;margin-top:12px;letter-spacing:-.3px}
.ttle{font-size:16px;font-weight:600;color:${T.sub};line-height:1.4;margin-top:4px}
.meta{display:flex;align-items:center;gap:6px;font-size:11px;color:${T.sub};margin-top:9px}
.meta .i{width:13px;height:13px}
.chips{display:flex;gap:6px;margin-top:13px;flex-wrap:wrap}
.chip{font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:8px}
.chip.sc{background:linear-gradient(90deg,${T.key},${T.key2});color:#fff}
.chip.ev{background:${T.soft};color:${T.softTxt}}
.chip.ap{background:#ecfdf5;color:#059669}
.chip.src{background:#fff7ed;color:#c2620c;border:1px solid #fed7aa}
.chip.qr{background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe}
.pc-body{padding:4px 6px 6px}
.lbl{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:${T.key};letter-spacing:.5px;margin:18px 0 7px}
.lbl .i{width:15px;height:15px}
.sub-h{font-size:11px;font-weight:800;color:${T.sub};margin:12px 0 4px}
.txt{font-size:13px;color:#334155;line-height:1.66}
.txt.ko{color:${T.sub};margin-top:2px}
.hl{color:${T.softTxt}}
.pico{display:flex;flex-direction:column;gap:1px;background:${T.soft};border-radius:13px;overflow:hidden;margin-top:2px}
.pr{display:flex;gap:10px;background:#fff;padding:11px 12px}
.pk{width:24px;height:24px;border-radius:8px;background:${T.soft};color:${T.softTxt};flex:none;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px}
.pv{flex:1}
.viz{background:${T.page};border:1px solid ${T.soft};border-radius:14px;padding:14px;margin-top:2px}
.viz-block{margin-top:2px}
.viz-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.viz-title{font-size:11.5px;font-weight:800;color:#334155}
.viz-tag{margin-left:auto;font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px}
.bar-row{display:flex;align-items:center;gap:8px;margin:5px 0}
.bar-lab{width:64px;flex:none;font-size:11px;color:${T.sub};text-align:right}
.bar-track{flex:1;height:18px;background:rgba(148,163,184,.16);border-radius:6px;overflow:hidden;position:relative}
.bar-fill{height:100%;border-radius:6px}
.bar-val{position:absolute;left:8px;top:0;line-height:18px;font-size:10.5px;font-weight:800;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.18)}
.bar-n{width:54px;flex:none;font-size:10px;color:${T.sub};font-variant-numeric:tabular-nums}
.sec-ul{margin:2px 0 0;padding:0;list-style:none}
.sec-li{padding-left:10px;border-left:2px solid ${T.soft};margin-bottom:7px}
.gloss{margin-top:10px;background:${T.soft};border-radius:12px;padding:11px 13px;font-size:11.5px;color:${T.sub};line-height:1.6}
.gloss-h{font-weight:800;color:${T.softTxt};margin-bottom:4px}
.gloss-i{margin-bottom:2px}
.gloss-i b{color:${T.softTxt}}
.pc-ul{margin:2px 0 0;padding:0;list-style:none}
.pc-li{display:flex;gap:8px;margin-bottom:7px}
.pc-dot{width:6px;height:6px;border-radius:99px;background:${T.key};flex:none;margin-top:7px}
/* 가이드라인 카드 (teal 계열) */
.guideline-card{border-top:2px solid ${T.sec}}
.gl-medal{background:linear-gradient(135deg,#6fc3b0,#3f9b86);box-shadow:0 8px 18px -6px ${T.sec}aa}
.gl-lbl{color:${T.secTag}}
.gl-dot{background:${T.sec}}
.chip.gl{background:linear-gradient(90deg,${T.sec},#6fc3b0);color:#fff}
.chip.org{background:#ecfdf7;color:${T.secTag};border:1px solid #b6e6da}
.chip.yr{background:#f1f5f9;color:${T.sub}}
.gl-changes{background:#f0faf7;border:1px solid #cbeae1;border-left:3px solid ${T.sec};border-radius:10px;padding:11px 13px;margin-top:4px}
.gl-chg{margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #cbeae1}
.gl-chg:last-child{margin-bottom:0;padding-bottom:0;border-bottom:0}
.gl-chg-t{font-size:12px;font-weight:800;color:${T.secTag};margin-bottom:3px}
/* 가이드라인 전용 접이식 섹션 */
.gl-day-today{background:#fff;border:1.5px solid ${T.sec};box-shadow:0 20px 50px -22px ${T.sec}55}
.gl-day-past{background:#fff;border:1px solid #d7ede7;box-shadow:0 8px 22px -14px ${T.sec}33}
.gl-tag{background:linear-gradient(90deg,${T.sec},#6fc3b0);color:#fff;font-size:11px;font-weight:800;padding:4px 10px;border-radius:7px;box-shadow:0 4px 12px -2px ${T.sec}66}
.gl-badge{background:linear-gradient(90deg,#3f9b86,#6fc3b0)!important;box-shadow:0 4px 12px -2px ${T.sec}66}
.lnk{color:${T.softTxt};font-weight:700;text-decoration:none}
.lnk:hover{text-decoration:underline}
.src-box{margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:11px 13px}
.src-h{font-size:11px;font-weight:800;color:#c2620c;margin-bottom:5px}
.src-li{display:block;font-size:11.5px;color:#9a5510;text-decoration:none;padding:2px 0;border-bottom:1px solid #fde6cc;word-break:break-all}
.src-li:last-child{border-bottom:0}
.src-li:hover{text-decoration:underline}
.pc-foot{margin-top:14px;padding-top:10px;border-top:1px solid ${T.soft};font-size:11px;color:${T.muted}}
.ft{text-align:center;font-size:10px;color:${T.muted};padding:26px 20px 0}
.ft a{color:${T.softTxt}}
/* 누적 아카이브 표 */
.arch-table{margin:18px 18px 0;background:#fff;border:1px solid ${T.soft};border-radius:16px;overflow:hidden;box-shadow:0 8px 22px -16px ${T.key}33}
.at-head{display:flex;align-items:center;gap:8px;padding:13px 16px;background:linear-gradient(90deg,${T.key},${T.key2});color:#fff}
.at-title{font-size:13px;font-weight:800}
.at-count{margin-left:auto;font-size:11px;font-weight:700;opacity:.92}
.at-scroll{overflow-x:auto}
.arch-table table{width:100%;border-collapse:collapse;font-size:12px}
.arch-table th{text-align:left;font-size:9.5px;font-weight:800;color:${T.muted};text-transform:uppercase;letter-spacing:.5px;padding:9px 10px;border-bottom:1px solid ${T.soft};white-space:nowrap}
.arch-table td{padding:10px;border-bottom:1px solid ${T.soft};vertical-align:top}
.arch-table tbody tr:last-child td{border-bottom:0}
.c-date{color:${T.muted};white-space:nowrap;font-variant-numeric:tabular-nums}
.c-jour{font-weight:700;color:#334155;white-space:nowrap}
.c-title a{color:${T.ink};text-decoration:none;line-height:1.4}
.c-title a:hover{text-decoration:underline}
.th-read,.c-read{text-align:center;width:44px}
.readcb{width:18px;height:18px;accent-color:${T.key};cursor:pointer}
tr.is-read{background:${T.soft}}
tr.is-read .c-title a,tr.is-read .c-jour{color:${T.muted};text-decoration:line-through}
/* 넓은 화면(폴드 펼침·태블릿) 대응: 좁은 화면은 460px 유지, 넓은 화면만 확대 */
@media(min-width:700px){.wrap{max-width:700px}}
@media(min-width:1080px){.wrap{max-width:760px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="hd">
    <div class="ey">AI Literature Pipeline · Claude Opus</div>
    <h1>EM/CCM Trend Review</h1>
    <div class="fn"><span class="i">${IC.filter('#fff')}</span>180일 · 300편 스크리닝 → 1편/일 선정</div>
  </header>
  <div class="stats">
    <div class="sc"><div class="n stat-days-count">${days}</div><div class="l">분석일수</div></div>
    <div class="sc"><div class="n stat-papers-count">${papers}</div><div class="l">선정 논문</div></div>
    <div class="sc"><div class="n" style="font-size:13px;line-height:1.3;padding-top:4px"><span class="stat-updated-time">${esc(updated)}</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <div class="archive">
<!-- ARCHIVE_START -->
${sectionsHtml}
  </div>
  <div class="arch-table">
    <div class="at-head"><span class="at-title">📚 누적 아카이브</span><span class="at-count">${papers}편</span></div>
    <div class="at-scroll"><table>
      <thead><tr><th>선정일</th><th>저널</th><th>논문</th><th class="th-read">읽음</th></tr></thead>
      <tbody><!-- TABLE_ROWS_START -->${tableRows}<!-- TABLE_ROWS_END --></tbody>
    </table></div>
  </div>
  <div class="ft">AI Literature Pipeline · Claude Opus · PubMed 최근 6개월 · 1편/일 · <a href="${this.pagesUrl}">${this.owner ?? 'njell85-spec'}.github.io/${this.repo ?? 'trend-review'}</a></div>
</div>
<script>
(function(){var K='tr_read_v1';var s;try{s=JSON.parse(localStorage.getItem(K))||{};}catch(e){s={};}
document.querySelectorAll('.readcb').forEach(function(cb){var id=cb.dataset.pmid;var tr=cb.closest('tr');
if(s[id]){cb.checked=true;tr.classList.add('is-read');}
cb.addEventListener('change',function(){s[id]=cb.checked;try{localStorage.setItem(K,JSON.stringify(s));}catch(e){}tr.classList.toggle('is-read',cb.checked);});});})();
</script>
</body>
</html>`;
  }

  // ── git push ────────────────────────────────────────────────────────────────
  // 토큰이 에러 메시지/프로세스 목록에 노출되지 않도록: 인자 배열 + 스크럽 + env 전달
  _scrub(s) {
    return this.token ? String(s).split(this.token).join('***') : String(s);
  }

  _git(args, extraEnv = null) {
    const res = spawnSync('git', args, {
      cwd: this._repoPath,
      encoding: 'utf8',
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
    });
    if (res.error) throw new Error(`git ${args[0]} 실패: ${this._scrub(res.error.message)}`);
    if (res.status !== 0) {
      throw new Error(`git ${args[0]} 실패: ${this._scrub((res.stderr || res.stdout || '').trim())}`);
    }
    return (res.stdout ?? '').trim();
  }

  _gitPush(dateStr) {
    const files = ['index.html', 'output/selected_papers.json', 'output/selected_guidelines.json']
      .filter((f) => existsSync(path.join(this._repoPath, f)));
    this._git(['add', ...files]);
    const diff = this._git(['diff', '--staged', '--name-only']);
    if (!diff) return;
    this._git(['commit', '-m', `Update archive: ${dateStr}`]);
    try {
      this._git(['push']);
    } catch {
      if (!this.token) throw new Error('git push 실패: GITHUB_TOKEN 미설정');
      // 토큰은 URL/argv에 싣지 않고 credential helper가 환경변수에서 읽는다
      const helper = 'credential.helper=!f() { echo "username=x-access-token"; echo "password=$GIT_PUSH_TOKEN"; }; f';
      this._git(
        ['-c', 'credential.helper=', '-c', helper,
         'push', `https://github.com/${this.owner}/${this.repo}.git`, 'HEAD:main'],
        { GIT_PUSH_TOKEN: this.token },
      );
    }
  }

  async _req(p, method = 'GET', body = null) {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `token ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`GitHub API ${method} ${p} → ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async _getIndex() {
    const localPath = path.join(this._repoPath, 'index.html');
    try {
      return { sha: null, html: await readFile(localPath, 'utf8') };
    } catch { /* fall through to API */ }
    try {
      const data = await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`);
      return { sha: data.sha, html: Buffer.from(data.content, 'base64').toString('utf8') };
    } catch {
      return { sha: null, html: null };
    }
  }

  // ── 누적 업데이트 ────────────────────────────────────────────────────────────
  async publish(dateStr, topPapers, { guideline = null } = {}) {
    const { sha, html: existing } = await this._getIndex();
    const generatedAt = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const route = llmTelemetry.label();
    const todaySection = this._buildSection(dateStr, generatedAt, topPapers, { isToday: true, route });
    const guidelineSection = guideline
      ? this._buildGuidelineSection(dateStr, generatedAt, guideline, { isToday: true })
      : '';

    const newRows = this._tableRows(dateStr, topPapers, guideline);

    let updated;
    if (!existing || !existing.includes('<!-- ARCHIVE_START -->')) {
      // 최초 생성 (또는 구버전 스캐폴드) → 전체 페이지를 새 디자인으로 생성
      updated = this.buildPage(`${todaySection}\n${guidelineSection}`, { days: 1, papers: topPapers.length, updated: generatedAt, tableRows: newRows });
    } else {
      // 같은 날짜 섹션 제거 (논문 SECTION + 가이드라인 GSECTION 모두)
      const escDate = dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dup = new RegExp(`\\n?<!-- SECTION:${escDate} -->[\\s\\S]*?<!-- /SECTION:${escDate} -->`, 'g');
      const gdup = new RegExp(`\\n?<!-- GSECTION:${escDate} -->[\\s\\S]*?<!-- /GSECTION:${escDate} -->`, 'g');
      let body = existing.replace(dup, '').replace(gdup, '');
      // 같은 가이드라인(동일 PMID)이 다른 날짜 카드로 이미 올라와 있으면 제거.
      // 주간 게이트가 실패해도 같은 지침이 중복 노출되지 않게 하는 심층 방어.
      if (guideline?.paper?.pmid) {
        const gpmid = guideline.paper.pmid;
        body = body.replace(
          /\n?<!-- GSECTION:[0-9-]+ -->[\s\S]*?<!-- \/GSECTION:[0-9-]+ -->/g,
          (block) => block.includes(`pubmed.ncbi.nlm.nih.gov/${gpmid}/`) ? '' : block,
        );
      }
      // 이전 TODAY → past 로 강등 (논문 + 가이드라인 각각)
      body = body
        .replace(/<details open class="day day-today">/g, '<details class="day day-past">')
        .replace(/<span class="t-badge">TODAY<\/span>/g, '')
        .replace(/<details open class="day gl-day gl-day-today">/g, '<details class="day gl-day gl-day-past">')
        .replace(/<span class="t-badge gl-badge">NEW<\/span>/g, '');
      // 새 TODAY 삽입 (논문 먼저, 그 아래 가이드라인)
      body = body.replace('<!-- ARCHIVE_START -->', `<!-- ARCHIVE_START -->\n${todaySection}${guidelineSection ? `\n${guidelineSection}` : ''}`);
      // 누적 표 정리 (재실행 시 상단 섹션과 정확히 일치시키기 위해):
      //   ① 같은 날짜의 기존 행을 모두 제거 — 상단 SECTION 이 날짜 기준으로 교체되므로
      //      표도 동일하게. 하루에 여러 번 실행돼도 그날 최종 선정분만 남는다.
      const escDateCell = dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rowDateDup = new RegExp(`<tr data-pmid="[^"]*"><td class="c-date">${escDateCell}</td>[\\s\\S]*?</tr>`, 'g');
      body = body.replace(rowDateDup, '');
      //   ② 같은 PMID 행 제거 — 과거 날짜에 같은 논문/지침이 또 선정된 경우 중복 방지
      const dedupItems = guideline ? [...topPapers, guideline] : topPapers;
      for (const p of dedupItems) {
        const pmid = p.paper?.pmid;
        if (!pmid) continue;
        const rowDup = new RegExp(`<tr data-pmid="${pmid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?</tr>`, 'g');
        body = body.replace(rowDup, '');
      }
      if (body.includes('<!-- TABLE_ROWS_START -->')) {
        body = body.replace('<!-- TABLE_ROWS_START -->', `<!-- TABLE_ROWS_START -->${newRows}`);
      }
      // 통계 갱신
      const dayCount = (body.match(/<!-- SECTION:/g) ?? []).length;
      const paperCount = (body.match(/class="paper-card"/g) ?? []).length || dayCount;
      body = body
        .replace(/<div class="n stat-days-count">[^<]*<\/div>/, `<div class="n stat-days-count">${dayCount}</div>`)
        .replace(/<span class="stat-updated-time">[^<]*<\/span>/, `<span class="stat-updated-time">${generatedAt}</span>`)
        .replace(/<div class="n stat-papers-count">[^<]*<\/div>/, `<div class="n stat-papers-count">${paperCount}</div>`)
        .replace(/<span class="at-count">[^<]*<\/span>/, `<span class="at-count">${paperCount}편</span>`);
      updated = body;
    }

    const localPath = path.join(this._repoPath, 'index.html');
    await writeFile(localPath, updated, 'utf8');

    try {
      this._gitPush(dateStr);
      return this.pagesUrl;
    } catch {
      let apisha = sha;
      if (!apisha) {
        try { apisha = (await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`)).sha; } catch { /* */ }
      }
      await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`, 'PUT', {
        message: `Update archive: ${dateStr}`,
        content: Buffer.from(updated, 'utf8').toString('base64'),
        sha: apisha,
      });
      return this.pagesUrl;
    }
  }
}
