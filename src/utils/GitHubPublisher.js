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
import { ensureCurationBlock, loadCurationState, removeSectionFromHtml, parseHiddenKey } from './curation.js';
import { mergePages, splitPages, ensureTowerTone } from './pageSplit.js';
import { ensureArchiveStatus } from './archiveStatus.js';
import { impactFactorLabel } from './journalMeta.js';
import { buildUpcoming } from './upcomingSchedule.js';
import { cadenceFor } from './trackCadence.js';
import { kstDateStr } from './dates.js';
import { TRACKS as UPCOMING_TRACKS } from './controlState.js';

/**
 * 예고 블록 전용 스타일.
 *
 * ★ **블록 안에 같이 넣는다.** 대시보드 CSS 는 index.html 에 있고 이 블록은 교체식으로
 *   끼워지므로, 밖에 두면 블록만 갱신될 때 스타일이 따라오지 않는다. 미리보기에서 실제로
 *   **스타일 없는 맨몸**으로 나온 자리다(2026-08-16, push 전에 잡았다).
 * ★ 클래스명은 마크업과 1:1 이어야 한다. 과거 CSS 는 `.up-row`/`.up-modes` 인데 마크업은
 *   `up-item`/`up-toggles` 라 **행 스타일이 통째로 안 먹었고 테스트는 전부 초록이었다.**
 *   `test/upcomingRender.test.mjs` 가 그 대응을 검사한다.
 */
const UPCOMING_STYLE = `<style>
.upcoming{margin:16px 0;font-size:14px}
.up-h{font-size:15px;margin:0 0 8px;font-weight:600}
.up-h small{display:block;font-weight:400;color:#6b7280;font-size:12px;margin-top:2px}
.up-toggles{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.up-toggle{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}
.up-toggle[data-up-mode=off]{background:#f3f4f6;color:#9ca3af;text-decoration:line-through}
.up-toggle[data-up-mode=alternate]{border-style:dashed}
.up-day{margin:10px 0 4px;font-weight:600;color:#374151;font-size:13px}
.upcoming ul{list-style:none;margin:0;padding:0}
.up-item{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:9px 0;border-bottom:1px solid #f0f1f3}
.up-track{font-size:11px;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#4338ca;white-space:nowrap}
.up-title{flex:1 0 100%;line-height:1.5}
.up-journal{flex:1 1 auto;font-size:11px;color:#6b7280;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.up-warn{color:#d97706;margin-left:3px}
.up-btn{flex:0 0 auto;border:1px solid #d1d5db;background:#fff;border-radius:6px;
  min-width:34px;min-height:34px;font-size:13px;cursor:pointer}
.up-empty{color:#9ca3af;padding:8px 0}
.up-date{font-weight:600;color:#374151;font-size:13px;margin:12px 0 2px}
.up-list{list-style:none;margin:0;padding:0}
.up-note{color:#6b7280;font-size:12px;margin-top:10px}
.up-msg{font-size:12px;color:#6b7280;min-height:16px;margin-top:6px}
.up-reset{margin-top:10px;border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
@media(prefers-color-scheme:dark){
 .up-toggle,.up-btn{background:#1f2937;border-color:#374151;color:#e5e7eb}
 .up-day{color:#d1d5db}.up-item{border-color:#374151}
 .up-track{background:#312e81;color:#c7d2fe}}
</style>`;
import { normalizeControl } from './controlState.js';

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
  // 작은따옴표까지 이스케이프 — 현재는 모든 속성이 큰따옴표라 필수는 아니나,
  // 향후 단일따옴표 속성이 추가돼도 LLM 출력이 속성을 탈출하지 못하게 방어한다.
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    logger = null,
  } = {}) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.pagesUrl = `https://${owner}.github.io/${repo}/`;
    this._repoPath = repoPath;
    // ★ 로거는 반드시 존재해야 한다. 생성자가 이걸 안 넣어서 `this.logger` 가 undefined 였고,
    //   그래서 **git push 실패 폴백이 첫 줄(logger.warn)에서 TypeError 로 죽어 한 번도
    //   실행될 수 없었다** — 폴백은 상태 JSON 까지 Contents API 로 올리는 안전망인데,
    //   그게 안 돌면 다음날 fresh checkout 이 중복방지 목록을 잃는다.
    //   (2026-08-08 §4-H 작업 중 dry-run 에서 실측 발견. 어느 호출부도 logger 를 안 넘긴다.)
    this.logger = logger ?? {
      info: (msg, data) => console.log(`[GitHubPublisher] ${msg}`, data ?? ''),
      warn: (msg, data) => console.warn(`[GitHubPublisher] ${msg}`, data ?? ''),
    };
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
        <div class="meta"><span class="i">${IC.book(T.muted)}</span>${esc(journal)}${esc(impactFactorLabel(journal))} · ${esc(date)}${pmid ? ` · PMID ${esc(pmid)}` : ''}</div>
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
  // 가이드라인 카드와 참고자료 카드는 골격이 같고 축 하나만 다르다
  // (가이드라인 = 이전 판 대비 변경점 / 참고자료 = 출처 성격).
  // `type` 미지정은 가이드라인 — 이미 배포된 상태파일의 구 카드가 여기 걸린다.
  _buildGuidelineCard(g) {
    const isRef = g.type === 'reference';
    const paper = g.paper ?? {};
    const title = paper.title ?? g.title ?? '';
    const titleKo = g.title_ko ?? '';
    const journal = paper.journal ?? '';
    const date = GitHubPublisher._fmtDate(paper.pubDate);
    const pmid = paper.pmid ?? '';
    // PubMed 미등재(발행기관 공개본) 가이드라인 — 죽은 '#' 링크 대신 원문으로 건다.
    const srcUrl = paper.sourceUrl ?? '';
    const pmurl = paper.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (srcUrl || '#'));
    const footLink = pmid
      ? `<a href="${esc(pmurl)}" target="_blank" rel="noopener" class="lnk">PubMed ${esc(pmid)}</a>`
      : (srcUrl
        ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener" class="lnk">원문 (발행기관)</a>`
        : `<a href="${esc(pmurl)}" target="_blank" rel="noopener" class="lnk">PubMed</a>`);
    const doi = paper.doi ?? '';
    const doiLink = doi ? ` · <a href="https://doi.org/${esc(doi)}" target="_blank" rel="noopener" class="lnk">DOI</a>` : '';

    const summary = (g.summary ?? []).map((t, k) => `
      <li class="pc-li"><span class="pc-dot gl-dot"></span><div><p class="txt">${esc(t)}</p>${g.summary_ko?.[k] ? `<p class="txt ko">${esc(g.summary_ko[k])}</p>` : ''}</div></li>`).join('');

    const changes = (g.keyChanges ?? []).map((c) => `
      <div class="gl-chg">${c.topic ? `<div class="gl-chg-t">${esc(c.topic)}</div>` : ''}${enko(c.detail, c.detail_ko)}</div>`).join('');

    const stateId = g.stateId ?? g.id ?? '';
    const superseded = g.status === 'superseded';
    const supersededBy = g.supersededBy ?? '';
    const supersedes = Array.isArray(g.supersedes) ? g.supersedes : [];
    const lineageBadges = `${superseded ? `<span class="chip superseded">superseded</span>` : ''}${supersededBy ? `<a class="chip successor-link" href="#${esc(supersededBy)}">신판 보기</a>` : ''}${supersedes.map((id) => `<a class="chip predecessor-link" href="#${esc(id)}">구판 보기</a>`).join('')}`;

    return `<article class="guideline-card"${stateId ? ` id="${esc(stateId)}" data-guideline-id="${esc(stateId)}"` : ''}>
      <div class="pc-top gl-top">
        <div class="medal gl-medal">${IC.book('#fff')}</div>
        <div class="chips" style="margin-top:0;margin-bottom:10px"><span class="chip gl">${isRef ? '🔖 참고자료' : '📋 가이드라인'}</span>${g.org ? `<span class="chip org">${esc(g.org)}</span>` : ''}${g.version ? `<span class="chip yr">${esc(g.version)}</span>` : ''}${lineageBadges}</div>
        <div class="ttl">${esc(titleKo || title)}</div>
        ${titleKo ? `<div class="ttle">${esc(title)}</div>` : ''}
        ${g.scope_ko ? `<p class="txt ko" style="margin-top:6px">${esc(g.scope_ko)}</p>` : ''}
        <div class="meta"><span class="i">${IC.book(T.muted)}</span>${esc(journal)}${esc(impactFactorLabel(journal))}${date ? ` · ${esc(date)}` : ''}${pmid ? ` · PMID ${esc(pmid)}` : ''}</div>
      </div>
      <div class="pc-body">
        ${summary ? `<div class="lbl gl-lbl"><span class="i">${IC.target(T.sec)}</span>${isRef ? '핵심 내용' : '핵심 권고'}</div><ul class="pc-ul">${summary}</ul>` : ''}
        ${isRef
          // 참고자료는 PeterJ 가 직접 고른 출처라 공인 문서가 아닐 수 있다 —
          // 무엇을 근거로 얼마나 믿을지 카드가 먼저 말해야 한다.
          ? (g.sourceNote_ko
            ? `<div class="lbl gl-lbl"><span class="i">${IC.pulse(T.sec)}</span>출처 성격</div><div class="gl-changes"><p class="txt ko">${esc(g.sourceNote_ko)}</p></div>`
            : '')
          : (changes
            ? `<div class="lbl gl-lbl"><span class="i">${IC.pulse(T.sec)}</span>이전 판 대비 주요 변경점</div><div class="gl-changes">${changes}</div>`
            : (g.changesUnavailable
              ? `<div class="lbl gl-lbl"><span class="i">${IC.pulse(T.sec)}</span>이전 판 대비 주요 변경점</div><div class="gl-changes"><p class="txt ko">공개 초록/확보 본문에 구체적 변경 내용이 없어(대개 본문 페이월) 세부 변경점을 확보하지 못했습니다. 아래 원문 링크에서 확인하세요.</p></div>`
              : ''))}
        ${(g.practiceImpact || g.practiceImpact_ko) ? `<div class="lbl gl-lbl"><span class="i">${IC.bulb(T.sec)}</span>${isRef ? '어떻게 쓰나' : '임상 임팩트'}</div>${enko(g.practiceImpact, g.practiceImpact_ko)}` : ''}
        ${(g.sources?.length) ? `<div class="src-box"><div class="src-h">🔎 출처</div>${g.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="src-li">${esc(s.label)}</a>`).join('')}</div>` : ''}
        <div class="pc-foot">${footLink}${doiLink} · ${isRef ? '직접 지정 참고자료' : '가이드라인 캐치업'}</div>
      </div>
    </article>`;
  }

  /** 상태 v2의 published를 정본으로 가이드 카드와 누적 행을 전량 재생성한다. */
  /**
   * 1주치 예고 리스트를 그린다.
   *
   * ★ **자기 블록만 갈아끼우고 나머지는 손대지 않는다.** 이 저장소는 렌더가 기존 내용을
   * 통째로 지운 사고를 이미 냈다(GSECTION 8→7, 본문 679KB→572KB, LLM 요약 소실).
   * 그래서 `<!-- UPCOMING -->` ~ `<!-- /UPCOMING -->` 사이만 교체한다.
   *
   * ★ 예고가 하나도 없으면 **블록을 아예 넣지 않는다.** 빈 상자를 남기면 PeterJ가
   * "오늘은 아직 안 돌았나" 와 "정말 없나" 를 구별할 수 없다.
   */
  /**
   * 예고 리스트 버튼의 동작. 브라우저에서만 돈다.
   *
   * 인증은 **기존 PAT 경로를 그대로 재사용한다**(`localStorage['tr_pat']`) — 새 토큰 체계를
   * 만들면 PeterJ가 토큰을 두 번 발급해야 한다. 토큰은 헤더로만 보내고 URL 에 싣지 않는다
   * (URL 은 브라우저 히스토리·리퍼러·서버 로그에 남는다).
   *
   * ★ 제어 상태의 시각은 **날짜까지만** 남긴다. 이 저장소는 public 이라 분 단위 토글 시각이
   * 쌓이면 생활 패턴 시계열이 회수 불가로 공개 히스토리에 남는다.
   */
  /**
   * 페이지 스크립트가 쓸 `owner/repo` 를 정한다.
   *
   * ★ 왜 이게 따로 필요한가 — 생성자는 `owner = process.env.GITHUB_OWNER` 다. 러너 밖에서
   *   렌더하면 env 가 비어 **`var OWNER='undefined'` 가 라이브 스크립트에 그대로 구워진다.**
   *   2026-08-16 PR #108 배포에서 실제로 일어났고, 예고 리스트의 ▶·🗑·토글·갈아엎기가
   *   `api.github.com/repos/undefined/undefined` 로 가서 전부 조용히 죽어 있었다.
   *   같은 페이지의 ONDEMAND_WIDGET·CURATION_BLOCK 이 멀쩡했던 것은 실력이 아니라
   *   **그 둘은 없을 때만 삽입되고 예고 블록만 매번 재생성**되기 때문이다.
   *
   * 순서: 생성자 값 → `GITHUB_REPOSITORY`(Actions 가 항상 준다) → **이미 배포된 페이지에
   * 남아 있는 올바른 식별자**. 셋 다 실패하면 null 을 돌려주고, 호출부는 스크립트를
   * 아예 굽지 않는다 — 죽은 버튼을 내보내느니 버튼이 없는 편이 정직하다.
   */
  _scriptIdent(html = '') {
    const ok = (v) => typeof v === 'string' && v && v !== 'undefined' && v !== 'null';
    if (ok(this.owner) && ok(this.repo)) return { owner: this.owner, repo: this.repo };
    const [envOwner, envRepo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/');
    if (ok(envOwner) && ok(envRepo)) return { owner: envOwner, repo: envRepo };
    for (const m of String(html).matchAll(/var OWNER='([^']*)', REPO='([^']*)'/g)) {
      if (ok(m[1]) && ok(m[2])) return { owner: m[1], repo: m[2] };
    }
    return null;
  }

  _upcomingScript(ident) {
    // 식별자를 못 정하면 스크립트를 굽지 않는다 — 죽은 버튼보다 없는 버튼이 정직하다.
    if (!ident) return '';
    return `<!-- UPBTN v4 -->
<script>
(function(){
  var OWNER='${ident.owner}', REPO='${ident.repo}';
  var API='https://api.github.com/repos/'+OWNER+'/'+REPO;
  function pat(force){
    var t=localStorage.getItem('tr_pat');
    if(!t||force){ t=prompt('GitHub Fine-grained PAT (이 저장소 actions:write 한정)\\n최초 1회만 — 이 브라우저에만 저장됩니다.'); if(t){localStorage.setItem('tr_pat',t.trim());} }
    return localStorage.getItem('tr_pat');
  }
  function say(m){ var el=document.getElementById('up-msg'); if(el){el.textContent=m;} else {alert(m);} }
  // 워크플로 구동. 토큰은 헤더로만 나간다.
  function fire(wf,inputs,okMsg){
    var t=pat(); if(!t){say('✖ 토큰이 없어 실행하지 못했습니다.');return;}
    say('⏳ 실행 중…');
    fetch(API+'/actions/workflows/'+wf+'/dispatches',{
      method:'POST',
      headers:{Authorization:'Bearer '+t,Accept:'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({ref:'main',inputs:inputs})
    }).then(function(r){
      if(r.status===204){ say(okMsg+' — 1~2분 뒤 새로고침하면 반영됩니다.'); }
      else if(r.status===401||r.status===403){ pat(true); say('✖ 토큰이 거부됐습니다. 다시 입력해 주세요.'); }
      else { say('✖ 실패 ('+r.status+')'); }
    }).catch(function(e){ say('✖ 통신 실패 — '+e.message); });
  }
  // 트랙 온오프는 워크플로가 아니라 상태 파일을 **직접** 고친다(러너를 안 띄운다).
  var NEXT={on:'off',off:'alternate',alternate:'on'};
  function toggle(track,cur,btn){
    var t=pat(); if(!t){say('✖ 토큰이 없어 실행하지 못했습니다.');return;}
    var next=NEXT[cur]||'on';
    var path='output/control_state.json';
    var H={Authorization:'Bearer '+t,Accept:'application/vnd.github+json','Content-Type':'application/json'};
    say('⏳ 전환 중…');
    fetch(API+'/contents/'+path,{headers:H}).then(function(r){
      return r.status===200?r.json():null;
    }).then(function(cur2){
      var state={schemaVersion:1,tracks:{}};
      if(cur2&&cur2.content){ try{ state=JSON.parse(decodeURIComponent(escape(atob(cur2.content.replace(/\\n/g,''))))); }catch(e){} }
      if(!state.tracks)state.tracks={};
      // 시각은 날짜까지만. public repo 에 분 단위가 쌓이면 생활 패턴이 된다.
      state.tracks[track]={mode:next,since:new Date().toISOString().slice(0,10)};
      var body={message:'chore(control): '+track+' → '+next,
        content:btoa(unescape(encodeURIComponent(JSON.stringify(state,null,2))))};
      if(cur2&&cur2.sha)body.sha=cur2.sha;
      return fetch(API+'/contents/'+path,{method:'PUT',headers:H,body:JSON.stringify(body)});
    }).then(function(r){
      if(r&&(r.status===200||r.status===201)){
        btn.dataset.upMode=next;
        btn.textContent=btn.textContent.split(' · ')[0]+' · '+({on:'켜짐',off:'꺼짐',alternate:'격일'}[next]);
        say('✔ '+track+' → '+({on:'켜짐',off:'꺼짐',alternate:'격일'}[next]));
      } else { say('✖ 전환 실패'+(r?' ('+r.status+')':'')); }
    }).catch(function(e){ say('✖ 통신 실패 — '+e.message); });
  }
  // 순차진행 토글 — 트랙 토글과 같은 파일을 고치되 최상위 sequential 만 건드린다.
  function toggleSeq(btn){
    var t=pat(); if(!t){say('✖ 토큰이 없어 실행하지 못했습니다.');return;}
    var next=(btn.dataset.upSeq!=='on');
    var path='output/control_state.json';
    var H={Authorization:'Bearer '+t,Accept:'application/vnd.github+json','Content-Type':'application/json'};
    say('⏳ 전환 중…');
    fetch(API+'/contents/'+path,{headers:H}).then(function(r){
      return r.status===200?r.json():null;
    }).then(function(cur){
      var state={schemaVersion:1,tracks:{}};
      if(cur&&cur.content){ try{ state=JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\\n/g,''))))); }catch(e){} }
      state.sequential=next;
      var body={message:'chore(control): sequential → '+(next?'on':'off'),
        content:btoa(unescape(encodeURIComponent(JSON.stringify(state,null,2))))};
      if(cur&&cur.sha)body.sha=cur.sha;
      return fetch(API+'/contents/'+path,{method:'PUT',headers:H,body:JSON.stringify(body)});
    }).then(function(r){
      if(r&&(r.status===200||r.status===201)){
        btn.dataset.upSeq=next?'on':'off';
        btn.textContent='순차진행 · '+(next?'켜짐':'꺼짐');
        say('✔ 순차진행 '+(next?'켜짐 — 논문→가이드라인→리뷰 하루 한 트랙':'꺼짐 — 세 트랙이 매일 각자')+' (다음 데일리부터)');
      } else { say('✖ 전환 실패'+(r?' ('+r.status+')':'')); }
    }).catch(function(e){ say('✖ 통신 실패 — '+e.message); });
  }
  // ★ 입력 이름은 **받는 워크플로의 계약** 그대로다. 종전 코드는 on-demand 에
  //   {pmid,mode} 를 보냈는데 그 워크플로는 {target,kind} 를 받는다 — 422 로 튕겨
  //   버튼이 조용히 죽어 있었다(실측). 여기를 고칠 때는 반드시
  //   .github/workflows/*.yml 의 inputs 를 열어서 맞춰라.
  // ★ 트랙마다 ▶ 의 뜻이 다르다 (코드리뷰 발견 B4).
  //   논문·가이드라인은 on-demand 가 그 종류의 카드를 바로 만들 수 있다.
  //   **리뷰는 못 만든다** — on-demand 는 kind=paper|guideline|reference 뿐이라
  //   리뷰를 넘기면 index.html 에 '직접 지정 논문' 으로 올라가고 리뷰 페이지에는
  //   아무것도 안 생기며 리뷰 큐도 그대로 남아 며칠 뒤 같은 논문이 리뷰로 또 나간다.
  //   그래서 리뷰의 ▶ 는 **큐 머리로 올린다**(= 다음 데일리에 이것이 나간다).
  var KIND={papers:'paper',guidelines:'guideline'};
  document.addEventListener('click',function(e){
    var b=e.target.closest?e.target.closest('button'):null; if(!b)return;
    if(b.dataset.upRun){
      var tr=b.dataset.upTrack;
      if(KIND[tr]){ fire('on-demand.yml',{target:b.dataset.upRun,kind:KIND[tr]},'▶ 지금 분석을 걸었습니다'); }
      else { fire('queue-control.yml',{track:tr,action:'promote',id:b.dataset.upRun},'▶ 맨 앞으로 올렸습니다 — 다음 실행에 나갑니다'); }
    }
    else if(b.dataset.upDrop){
      fire('queue-control.yml',{track:b.dataset.upTrack,action:'drop',id:b.dataset.upDrop},
        '🗑 뺐습니다 — 다음 항목이 채웁니다');
    }
    else if(b.dataset.upToggle){ toggle(b.dataset.upToggle,b.dataset.upMode||'on',b); }
    else if(b.dataset.upSeq!==undefined){ toggleSeq(b); }
    else if(b.dataset.upReset){
      // 되돌릴 수 없으므로 반드시 묻는다.
      if(confirm('이 트랙의 예고를 전부 빼고 다음 수집이 새로 채우게 합니다. 계속할까요?')){
        fire('queue-control.yml',{track:b.dataset.upReset,action:'reset',id:''},
          '♻ 전체를 갈아엎었습니다');
      }
    }
  });
})();
</script>`;
  }

  /**
   * 예고 줄의 제목 절단. 지침 제목은 발표 기관이 줄줄이 붙어 200자를 넘는 일이 흔하고
   * (미리보기에서 한 줄이 폰 화면 절반을 먹었다), 예고는 **훑어보는 목록**이라
   * 전문이 필요 없다. 전문은 title 속성으로 남겨 길게 누르면 보이게 한다.
   */
  static _clipTitle(t, max = 66) {
    const v = String(t ?? '').trim();
    return v.length > max ? `${v.slice(0, max - 1)}…` : v;
  }

  /**
   * 한 트랙의 예고 블록을 그린다. **트랙마다 자기 블록을 갖는다.**
   *
   * ★ 왜 트랙별로 갈랐나 (PeterJ 요구 ②) — 종전에는 세 트랙이 `index.html` 한 곳에
   *   섞여 있었다. 3페이지 체제에서는 각 페이지가 **자기 트랙의 예고와 그 버튼만**
   *   맨 위에 들고 있어야 한다. 그래서 마커를 `<!-- UPCOMING:papers -->` 처럼 트랙으로
   *   가르고, `splitPages` 가 이 마커를 보고 제 페이지로 옮긴다.
   *
   * ★ **자기 블록만 갈아끼우고 나머지는 손대지 않는다.** 이 저장소는 렌더가 기존 내용을
   *   통째로 지운 사고를 이미 냈다(GSECTION 8→7, 679KB→572KB, LLM 요약 소실).
   *
   * ★ 비어도 블록을 그린다. 조기 반환하면 큐가 마른 날 섹션이 통째로 사라져
   *   "고장인지 빈 건지" 를 구분할 수 없고, **토글까지 사라져 꺼둔 트랙을 다시 켤 수
   *   없어진다** — 이게 조기 반환의 진짜 위험이다.
   */
  _renderUpcoming(html, { from, days = 7, track, label = '', cadence = 'daily', mode = 'on', sequential = false, state = null } = {}) {
    const key = String(track ?? '');
    const rows = buildUpcoming({
      from, days, sequential,
      tracks: [{ key, label, cadence, mode, state: state ?? { queue: [] } }],
    });

    // 이전 블록은 항상 먼저 걷어낸다 — 이게 멱등성의 전부다.
    // 트랙 없는 구버전 마커(`<!-- UPCOMING -->`)도 같이 걷는다: 배포본에 그것이 남아
    // 있는데 안 걷으면 세 트랙이 섞인 낡은 블록이 새 블록과 나란히 영원히 남는다.
    let out = String(html)
      .replace(new RegExp(`\\n?<!-- UPCOMING:${key} -->[\\s\\S]*?<!-- /UPCOMING:${key} -->`, 'g'), '')
      .replace(/\n?<!-- UPCOMING -->[\s\S]*?<!-- \/UPCOMING -->/g, '');

    const byDate = new Map();
    for (const r of rows) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    }
    const dayHtml = [...byDate.entries()].map(([date, items]) => {
      const li = items.map((r) => {
        const it = r.item ?? {};
        const clip = (t) => GitHubPublisher._clipTitle(t);
        const warn = r.lowConfidence ? '<span class="up-warn" title="재순위가 약한 날">⚠</span>' : '';
        // 버튼은 data-* 만 들고 있고 동작은 블록 안 스크립트가 붙인다.
        return `<li class="up-item">`
          + `<span class="up-title" title="${esc(it.title ?? '')}">`
          + `<span class="up-track">${esc(r.trackLabel)}</span> ${esc(clip(it.title))}${warn}</span>`
          + (it.journal ? `<span class="up-journal">${esc(it.journal)}</span>` : '')
          + `<button class="up-btn up-run" data-up-run="${esc(it.pmid ?? '')}" `
          + `data-up-track="${esc(r.track)}" title="이것을 먼저 돌린다">▶</button>`
          + `<button class="up-btn up-drop" data-up-drop="${esc(it.pmid ?? '')}" `
          + `data-up-track="${esc(r.track)}" title="빼고 다음 것으로 채운다">🗑</button>`
          + `</li>`;
      }).join('');
      return `<div class="up-day"><div class="up-date">${esc(date)}</div><ul class="up-list">${li}</ul></div>`;
    }).join('');

    // 이 페이지가 맡은 트랙의 토글만 낸다. off 인 트랙도 나와야 다시 켤 수 있다.
    // 순차진행은 **셋 공통 스위치**라 세 페이지 모두에 낸다 — 어느 페이지에서든 끄고 켤 수
    // 있어야 한다(한 페이지에만 두면 그 페이지를 안 여는 날 스위치에 손이 안 닿는다).
    const MODE_LABEL = { on: '켜짐', off: '꺼짐', alternate: '격일' };
    const toggles = `<button class="up-toggle" data-up-toggle="${esc(key)}" `
      + `data-up-mode="${esc(mode)}">${esc(label)} · ${esc(MODE_LABEL[mode] ?? '켜짐')}</button>`
      + `<button class="up-toggle up-seq" data-up-seq="${sequential ? 'on' : 'off'}" `
      + `title="켜면 논문 → 가이드라인 → 리뷰 순으로 하루 한 트랙씩 돕니다">`
      + `순차진행 · ${sequential ? '켜짐' : '꺼짐'}</button>`;

    const ident = this._scriptIdent(html);
    const script = this._upcomingScript(ident);
    // 식별자를 못 정하면 버튼을 아예 내지 않는다 — 누르면 죽는 버튼을 두지 않는다.
    const dead = !ident;
    const body = dead
      ? '<p class="up-empty">저장소 식별자를 찾지 못해 버튼을 감췄습니다 — 다음 데일리 실행에서 복구됩니다.</p>'
      : `<div class="up-toggles">${toggles}</div>`
        + (dayHtml || '<p class="up-empty">예고할 것이 없습니다 — 큐가 비었거나 트랙이 꺼져 있습니다.</p>')
        + `<button class="up-reset" data-up-reset="${esc(key)}">이 목록 전체 갈아엎기</button>`;

    const block = `<!-- UPCOMING:${key} -->\n${UPCOMING_STYLE}`
      + `<section class="upcoming" data-up-section="${esc(key)}">`
      + `<h2 class="up-h">📅 ${esc(label)} — 다음 ${days}일 예고`
      + ` <span class="up-note">놔두면 날짜대로 나갑니다 · 🗑 누르면 다음 것이 채웁니다</span></h2>`
      + body
      + `<div id="up-msg" class="up-msg"></div>`
      + `</section>\n${script}\n<!-- /UPCOMING:${key} -->`;
    return out.replace('<!-- ARCHIVE_START -->', () => `${block}\n<!-- ARCHIVE_START -->`);
  }

  /**
   * 디스크의 큐·제어 상태를 읽어 예고 리스트를 그린다.
   * 세 트랙의 큐가 각각 다른 파일에 있으므로(쓰는 주체가 달라 일부러 갈랐다) 여기서 모은다.
   */
  /**
   * 어떤 날짜 표현이 와도 'YYYY-MM-DD' 로 만든다.
   *
   * ★ 2026-08-16 실측 결함 — 종전 코드는 `String(generatedAt).slice(0, 10)` 이었다.
   *   그런데 `publish()` 가 넘기는 `generatedAt` 은 **한국어 로케일 문자열**이다
   *   (`toLocaleString('ko-KR', …)` → `"2026. 08. 16. 22:45"`). 앞 10자는
   *   `"2026. 08. 1"` 이라 날짜가 아니고, `addDays` 가 `Invalid time value` 로 던진다.
   *   그 예외는 `publish()` 의 try/catch 가 삼키므로 **예고 블록이 통째로 빠진 페이지가
   *   조용히 나간다.** 로그 한 줄 말고는 아무 표시가 없다.
   *   빈 문자열이 아니라서 `|| fallback` 도 안 걸렸다 — 폴백이 있는데 안 도는 부류다.
   */
  static _toYmd(value) {
    const raw = String(value ?? '');
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const m = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return kstDateStr();
  }

  async _renderUpcomingFromDisk(html, generatedAt) {
    const out = path.join(this._repoPath, 'output');
    const readJson = async (f) => { try { return JSON.parse(await readFile(path.join(out, f), 'utf8')); } catch { return null; } };
    const [papers, guidelines, reviews, control] = await Promise.all([
      readJson('queue_papers.json'), readJson('selected_guidelines.json'),
      readJson('queue_reviews.json'), readJson('control_state.json'),
    ]);
    const c = normalizeControl(control);
    const from = GitHubPublisher._toYmd(generatedAt);
    // ★ 가이드라인 예고는 **실제로 발행 대상이 되는 것만** 보여야 한다.
    //   오케스트레이터는 `status === 'queued'` 인 것 중에서 고르는데(그리고 priority 순),
    //   예고는 큐 배열을 통째로 그리고 있었다. 지금 실물 큐가 `needsReview` 5 · `queued` 1
    //   이라 **화면은 검토 대기 항목이 오늘 나간다고 말하고 실제로는 다른 것이 나갔다.**
    //   결함 B2 와 같은 부류(화면과 게이트가 다른 것을 본다)라 같은 자리에서 막는다.
    const publishableGuidelines = guidelines?.queue
      ? { ...guidelines, queue: guidelines.queue
          .filter((x) => x?.status === 'queued')
          .sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0)) }
      : guidelines;
    const states = { papers, guidelines: publishableGuidelines, reviews };
    const labels = { papers: '논문', guidelines: '가이드라인', reviews: '리뷰' };

    // ★ 트랙마다 **자기 블록**을 그린다(PeterJ 요구 ②). `splitPages` 가 이 블록들을
    //   마커로 알아보고 각자의 페이지 맨 위로 옮긴다.
    // ★ cadence 는 `trackCadence` 에서 끌어온다 — 게이트 숫자와 같은 곳이라 화면과
    //   실제가 어긋날 수 없다(결함 B2 의 재발 차단).
    let acc = html;
    for (const key of UPCOMING_TRACKS) {
      acc = this._renderUpcoming(acc, {
        from,
        days: 7,
        track: key,
        label: labels[key],
        cadence: cadenceFor(key),
        mode: c.tracks[key].mode,
        sequential: c.sequential,
        state: states[key] ?? { queue: [] },
      });
    }
    return acc;
  }

  _renderGuidelineState(html, state, generatedAt) {
    if (!state || !Array.isArray(state.published)) return html;

    // ★ 이 함수는 **덧붙이기만 한다. 지우지 않는다.**
    //   처음 구현은 GSECTION 블록과 `data-guideline` 표 행을 **전부 지운 뒤** `state.published`
    //   로 다시 그렸다. 그러면 둘이 한꺼번에 사라진다:
    //     ① 마이그레이션된 옛 발행 7건은 `card` 가 없다(옛 배열엔 pmid/title/org/date 뿐).
    //        빈 껍데기로 재생성되면서 그동안 LLM 이 뽑은 요약·변경점·임상영향이 **소실**된다.
    //     ② PeterJ 가 수동 지정한 참고자료는 `selected_references.json` 에 있고 가이드라인
    //        상태에는 없다. 지우고 다시 그리면 매 데일리마다 화면에서 사라진다.
    //   확정 ③-C 는 "구판을 삭제하지 않는다" 이므로 지우는 설계 자체가 위반이다.
    //   그래서 하는 일은 셋뿐이다: superseded 배지 소급 · **화면에 없는** 신규 발행만 추가 ·
    //   needsReview 목록 표시.
    const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idOf = (entry) => entry.id ?? (entry.pmid ? `pmid:${entry.pmid}` : entry.sourceId ?? '');
    const pmidOf = (entry) => entry.pmid ?? entry.legacy?.pmid ?? entry.card?.paper?.pmid ?? '';
    const keyOf = (entry) => pmidOf(entry) || entry.sourceId || entry.legacy?.sourceId || idOf(entry);

    let out = html;

    // ── ① superseded 배지 소급 (기존 카드·행은 그대로 두고 배지만 얹는다) ──────────
    for (const entry of state.published) {
      if (entry.status !== 'superseded') continue;
      const key = keyOf(entry);
      if (!key) continue;
      const successor = state.published.find((x) => idOf(x) === entry.supersededBy);
      const successorPmid = successor ? pmidOf(successor) : '';
      const link = successorPmid
        ? ` <a class="gl-supersede-link" href="https://pubmed.ncbi.nlm.nih.gov/${successorPmid}/">신판 보기</a>`
        : '';
      const badge = `<span class="t-badge gl-superseded" data-superseded-for="${key}">개정됨(superseded)</span>${link}`;
      if (out.includes(`data-superseded-for="${key}"`)) continue;   // 멱등 — 재발행해도 중복 안 붙는다
      const rowRe = new RegExp(`(<tr data-pmid="${escapeRe(key)}"[^>]*data-guideline="1"[^>]*>)`);
      if (rowRe.test(out)) out = out.replace(rowRe, `$1<!--SUPERSEDED--><td class="gl-superseded-cell">${badge}</td>`.replace('<!--SUPERSEDED-->', ''));
      const secRe = new RegExp(`(<!-- GSECTION:[^\\s>]*${escapeRe(key)}[^\\s>]* -->)`);
      if (secRe.test(out)) out = out.replace(secRe, `$1\n${badge}`);
    }

    // ── ② 화면에 아직 없는 발행만 추가 (card 가 있는 것 = 새 경로가 발행한 것) ──────
    const missing = state.published.filter((entry) => {
      const key = keyOf(entry);
      if (!key) return false;
      if (out.includes(`data-pmid="${key}"`)) return false;      // 이미 표에 있다
      if (out.includes(`GSECTION:state-${idOf(entry)} `)) return false;
      return Boolean(entry.card);   // card 가 없으면 그릴 내용이 없다 — 빈 껍데기를 만들지 않는다
    });
    if (missing.length) {
      const sections = missing.map((entry) => this._buildGuidelineSection(
        entry.publishedAt || '날짜 미상', generatedAt,
        { ...entry.card, id: idOf(entry), stateId: idOf(entry), status: entry.status,
          supersededBy: entry.supersededBy, supersedes: entry.supersedes, publishedAt: entry.publishedAt },
        { sectionKey: `state-${idOf(entry)}` },
      )).join('\n');
      out = out.replace('<!-- ARCHIVE_START -->', () => `<!-- ARCHIVE_START -->\n${sections}`);
      const rows = missing.map((entry) => this._tableRows(entry.publishedAt || '', [],
        { ...entry.card, publishedAt: entry.publishedAt })).join('');
      out = out.replace('<!-- TABLE_ROWS_START -->', () => `<!-- TABLE_ROWS_START -->${rows}`);
    }

    // ── ③ 검토함(needsReview) — 판정 이유까지 보인다 ───────────────────────────
    out = out.replace(/\n?<!-- GNEEDSREVIEW -->[\s\S]*?<!-- \/GNEEDSREVIEW -->/g, '');
    const review = (state.queue ?? []).filter((x) => x.status === 'needsReview');
    if (review.length) {
      const items = review.map((x) => {
        const reasons = (x.decisionReasons ?? x.reasons ?? []).join(', ');
        const org = x.organizationId ? ` · ${esc(x.organizationId)}` : '';
        return `<li><b>${esc(x.title ?? x.id)}</b>${org}${reasons ? ` <span class="gl-reason">— ${esc(reasons)}</span>` : ''}</li>`;
      }).join('');
      const block = `<!-- GNEEDSREVIEW -->\n<details class="day day-past gl-review"><summary>🔎 검토함 ${review.length}건 — 자동 발행하지 않고 보관 중</summary><ul>${items}</ul></details>\n<!-- /GNEEDSREVIEW -->`;
      out = out.replace('<!-- ARCHIVE_START -->', () => `<!-- ARCHIVE_START -->\n${block}`);
    }
    return out;
  }

  // ── 가이드라인 전용 접이식 섹션 (논문과 분리, 한눈에 '가이드라인'으로 식별) ──────
  _buildGuidelineSection(dateStr, generatedAt, guideline, { isToday = false, manual = false, sectionKey = dateStr } = {}) {
    const card = this._buildGuidelineCard(guideline);
    // 참고자료도 이 섹션 골격을 공유한다(카드 축 하나만 다름) — 라벨까지 공유하면
    // §4-H 의 '🔖 기타 자료' 섹션 안에서 카드가 '📋 가이드라인'이라 말하는 모순이 된다.
    const isRef = guideline.type === 'reference';
    const gTitle = guideline.title_ko || guideline.paper?.title || '';
    const gMeta = `${guideline.org || guideline.paper?.journal || ''}${guideline.version ? ` · ${guideline.version}` : ''}`;
    // 논문 섹션과 동일한 흰 박스로 통일 — 구별은 앞쪽 라벨로만
    const cls = isToday ? 'day day-today' : 'day day-past';
    // ★ 오늘 카드도 **접힌 채로** 낸다 (PeterJ 요구 ③ · 2026-08-16).
    //   시각적 강조(day-today)는 남기고 펼침만 없앤다. 배포본에 남은 옛 `open` 은
    //   `pageSplit.collapseAllCards` 가 걷는다.
    const openAttr = '';
    // 'gl-badge' 를 함께 붙여야 ① teal 뱃지 스타일(.gl-badge)이 실제 적용되고
    // ② 다음 실행의 강등 정규식(t-badge gl-badge)이 이 NEW 를 제거한다.
    // (클래스가 't-badge'뿐이면 지난 가이드 카드에 NEW 가 영구히 남았다)
    const badge = manual
      ? '<span class="t-badge" style="background:linear-gradient(90deg,#b45309,#f59e0b)">직접 지정</span>'
      : (isToday ? '<span class="t-badge gl-badge">NEW</span>' : '');
    return `
<!-- GSECTION:${sectionKey} -->
<details${openAttr} class="${cls}">
  <summary class="day-sum">
    <div class="day-head">
      ${badge}<span class="day-date">${esc(dateStr)}</span><span class="gl-tag${isRef ? ' ref' : ''}">${isRef ? '🔖 기타 자료' : '📋 가이드라인'}</span><span class="day-gen">생성 ${esc(generatedAt)}</span>
      <span class="day-chev">${IC.chev(T.muted)}</span>
    </div>
    <div class="day-prev"><span class="day-prev-medal">${IC.book(T.sec)}</span><div><div class="day-prev-t">${esc(gTitle)}</div><div class="day-prev-m">${esc(gMeta)}</div></div></div>
  </summary>
  <div class="day-panel">${card}</div>
</details>
<!-- /GSECTION:${sectionKey} -->`;
  }

  /**
   * 리뷰 카드 섹션 (RSECTION).
   *
   * ★ 2026-08-16 실측 — `_stageReview` 는 큐에서 꺼내 `published` 로 옮기기만 하고
   *   **카드도 표 행도 만들지 않았다.** 리뷰 트랙은 발행되는데 화면에는 아무것도 안
   *   나오는 상태였다(테스트 590건 전부 초록). 3페이지 체제에서 리뷰 페이지를 만드는
   *   이상 그 페이지가 영원히 비어 있으면 안 되므로 여기서 렌더를 붙인다.
   *
   * 리뷰 큐 항목은 논문과 달리 LLM 카드가 없다(저수지에서 제목·저널·점수만 들고 온다).
   * 그래서 **가진 것만 정직하게** 보여준다 — 없는 요약을 지어내지 않는다.
   */
  _buildReviewSection(dateStr, generatedAt, review, { sectionKey = dateStr } = {}) {
    const rp = review?.paper ?? review ?? {};
    const pmid = rp.pmid ?? review?.pmid ?? '';
    const url = rp.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (rp.sourceUrl || '#'));
    const title = review?.title_ko || rp.title || review?.title || '';
    const journal = rp.journal || review?.journal || '';
    const topic = review?.topic ? `<span class="chip">${esc(review.topic)}</span>` : '';
    const score = Number.isFinite(Number(review?.score)) ? `<span class="chip">점수 ${esc(String(review.score))}</span>` : '';
    const card = `<article class="guideline-card">
      <div class="pc-t"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></div>
      <div class="pc-meta">${esc(journal)}</div>
      <div class="pc-chips">${topic}${score}</div>
      <div class="pc-foot"><a href="${esc(url)}" target="_blank" rel="noopener">원문</a> · 리뷰 아티클</div>
    </article>`;
    return `
<!-- RSECTION:${sectionKey} -->
<details class="day day-past">
  <summary class="day-sum">
    <div class="day-head">
      <span class="day-date">${esc(dateStr)}</span><span class="gl-tag">📰 리뷰</span><span class="day-gen">생성 ${esc(generatedAt)}</span>
      <span class="day-chev">${IC.chev(T.muted)}</span>
    </div>
    <div class="day-prev"><span class="day-prev-medal">${IC.book(T.sec)}</span><div><div class="day-prev-t">${esc(title)}</div><div class="day-prev-m">${esc(journal)}</div></div></div>
  </summary>
  <div class="day-panel">${card}</div>
</details>
<!-- /RSECTION:${sectionKey} -->`;
  }

  _buildSection(dateStr, generatedAt, topPapers, { isToday = false, route = '', manual = false, sectionKey = dateStr } = {}) {
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
    // ★ 오늘 카드도 **접힌 채로** 낸다 (PeterJ 요구 ③ · 2026-08-16).
    //   시각적 강조(day-today)는 남기고 펼침만 없앤다. 배포본에 남은 옛 `open` 은
    //   `pageSplit.collapseAllCards` 가 걷는다.
    const openAttr = '';
    // 수동 지정 배지는 인라인 스타일 — 배포된 index.html은 증분 패치라 새 CSS 클래스가
    // 주입되지 않으므로 템플릿 CSS에 의존하면 무스타일로 렌더된다. TODAY와 달리
    // 텍스트가 달라 강등 정규식에 안 걸려 과거에도 유지된다(출처 표식이므로 의도).
    const badge = manual
      ? '<span class="t-badge" style="background:linear-gradient(90deg,#b45309,#f59e0b)">직접 지정</span>'
      : (isToday ? '<span class="t-badge">TODAY</span>' : '');

    return `
<!-- SECTION:${sectionKey} -->
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
<!-- /SECTION:${sectionKey} -->`;
  }

  /**
   * 수동 디깅(on-demand) 입력 위젯 — 대시보드에서 PMID/DOI를 지정해 분석을 트리거.
   * 정적 페이지라 GitHub API(workflow_dispatch)를 브라우저에서 직접 호출하며,
   * Fine-grained PAT(이 저장소 actions:write 한정)는 사용자의 localStorage 에만 저장된다
   * (페이지 소스·저장소에 토큰 없음). 스타일은 증분 패치 호환을 위해 전부 인라인.
   */
  _onDemandWidget() {
    // 버전 마커: 배포된 index.html은 증분 패치라, 버전이 오르면 _ensureOnDemandWidget이
    // 구버전 블록을 통째로 교체한다 (v 없는 최초 배포 마커도 매치). 위젯 코드를 고치면
    // 반드시 버전을 올릴 것 — 안 올리면 배포 페이지에 영원히 반영되지 않는다.
    return `<!-- ONDEMAND_WIDGET v4 -->
<details style="max-width:960px;margin:14px auto;padding:0 16px">
  <summary style="cursor:pointer;color:#3f72bf;font-weight:700;font-size:13px">🔎 On-demand 리뷰 — 논문·가이드라인 검색</summary>
  <div style="background:#fff;border:1px solid #d9e4f0;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;color:#334155">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="od-q" placeholder="키워드 검색 (예: ACG 2026 diverticulitis)" style="flex:1;min-width:170px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px">
      <button id="od-search" style="padding:8px 16px;border:0;border-radius:8px;background:linear-gradient(90deg,#5b8fd9,#7dabe8);color:#fff;font-weight:700;font-size:13px;cursor:pointer">검색</button>
    </div>
    <div id="od-msg" style="margin-top:8px;color:#64748b"></div>
    <div id="od-list" style="margin-top:8px;display:flex;flex-direction:column;gap:8px"></div>
    <div style="margin-top:8px"><a href="#" id="od-direct" style="color:#94a3b8;font-size:12px">PMID/DOI/URL 직접 입력 · 토큰 설정</a></div>
  </div>
</details>
<script>
(function(){
  var OWNER='${this.owner}', REPO='${this.repo}';
  var EUTILS='https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  var $=function(id){return document.getElementById(id)};
  var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};
  function pat(force){
    var t=localStorage.getItem('tr_pat');
    if(!t||force){ t=prompt('GitHub Fine-grained PAT (이 저장소 actions:write 한정)\\n최초 1회만 — 이 브라우저에만 저장됩니다.'); if(t){localStorage.setItem('tr_pat',t.trim());} }
    return localStorage.getItem('tr_pat');
  }
  function dispatch(target,kind,msg){
    var t=pat(false); if(!t){msg.textContent='토큰이 필요합니다 ("직접 입력 · 토큰 설정").';return;}
    msg.textContent='분석 요청 중…';
    fetch('https://api.github.com/repos/'+OWNER+'/'+REPO+'/actions/workflows/on-demand.yml/dispatches',{
      method:'POST',
      headers:{'Authorization':'Bearer '+t,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({ref:'main',inputs:{target:String(target),kind:kind}})
    }).then(function(r){
      msg.textContent = r.status===204 ? '✅ 분석 시작 — 수 분 후 이 페이지에 "직접 지정" 카드가 추가됩니다 (새로고침).' :
        (r.status===401||r.status===403) ? '✖ 토큰 인증 실패 — "직접 입력 · 토큰 설정"에서 재입력하세요.' : '✖ 실패 (HTTP '+r.status+')';
    }).catch(function(){msg.textContent='✖ 네트워크 오류';});
  }
  function search(){
    var q=$('od-q').value.trim(), msg=$('od-msg'), list=$('od-list');
    list.innerHTML='';
    if(!q){msg.textContent='검색어를 입력하세요.';return;}
    msg.textContent='PubMed 검색 중…';
    fetch(EUTILS+'/esearch.fcgi?db=pubmed&retmode=json&retmax=8&term='+encodeURIComponent(q))
      .then(function(r){return r.json()})
      .then(function(j){
        var ids=(j.esearchresult&&j.esearchresult.idlist)||[];
        if(!ids.length){msg.textContent='결과 없음 — 검색어를 바꿔보세요.';return;}
        return fetch(EUTILS+'/esummary.fcgi?db=pubmed&retmode=json&id='+ids.join(','))
          .then(function(r){return r.json()})
          .then(function(s){
            msg.textContent=ids.length+'건 · 클릭하면 그 논문을 분석합니다';
            ids.forEach(function(id){
              var d=s.result&&s.result[id]; if(!d)return;
              var isG=/guideline|consensus|recommendation/i.test(d.title||'');
              var yr=(d.pubdate||'').slice(0,4);
              var el=document.createElement('div');
              el.style.cssText='border:1px solid #e2e8f0;border-radius:10px;padding:10px;cursor:pointer';
              el.innerHTML='<div style="font-weight:600;line-height:1.4">'+esc(d.title)+'</div>'+
                '<div style="font-size:12px;color:#64748b;margin-top:3px">'+esc(d.fulljournalname||d.source||'')+' · '+esc(yr)+' · PMID '+esc(id)+(isG?' · <b>가이드라인</b>':'')+'</div>';
              el.addEventListener('click',function(){dispatch(id,isG?'guideline':'paper',msg);});
              list.appendChild(el);
            });
          });
      }).catch(function(){msg.textContent='✖ 검색 실패 — PubMed 접근 불가(브라우저 CORS). "직접 입력"을 쓰세요.';});
  }
  $('od-search').addEventListener('click',search);
  $('od-q').addEventListener('keydown',function(e){if(e.key==='Enter')search();});
  // 직접 입력 판별. URL 은 논문(PICO)으로는 못 돌린다 — PubMed 메타데이터가 분석의 전제라
  // scripts/on-demand.mjs 가 거부한다. 그래서 URL 은 guideline/reference 중에서만 고른다.
  // test/{onDemandWidget,referenceMode}.test.mjs 가 이 함수를 위젯에서 추출해 직접 실행한다 —
  // 이름·들여쓰기를 바꾸면 그 테스트들이 적색이 된다.
  function classify(v){
    if(/^https?:\\/\\/\\S+$/i.test(v)) return {ok:true,isUrl:true};
    if(/^\\d{5,9}$/.test(v)) return {ok:true};
    if(/^10\\.\\S+\\/\\S+/.test(v)) return {ok:true};
    return {ok:false};
  }
  $('od-direct').addEventListener('click',function(e){
    e.preventDefault();
    var msg=$('od-msg');
    var v=prompt('PMID · DOI · 원문 URL 직접 입력 (취소하면 토큰만 설정):');
    if(v===null){pat(true);return;}
    v=v.trim(); if(!v)return;
    var c=classify(v);
    if(!c.ok){msg.textContent='✖ PMID(숫자) · DOI(10.…/…) · URL(https://…) 형식만 지원합니다.';return;}
    var kind;
    if(c.isUrl){
      // URL 은 논문 경로가 없다 → 가이드라인 / 참고자료 둘 중 하나.
      kind=confirm('공식 가이드라인이면 확인,\\n일반 참고자료면 취소')?'guideline':'reference';
    }else{
      kind=confirm('가이드라인이면 확인, 논문이면 취소')?'guideline':'paper';
    }
    dispatch(v,kind,msg);
  });
})();
</script>
<!-- /ONDEMAND_WIDGET -->`;
  }

  /**
   * 배포된 페이지에 위젯을 보장(멱등) — 증분 패치 경로에서도 자가 치유.
   * 현재 버전이 이미 있으면 그대로, 구버전(v 없는 최초 마커 포함)이면 블록 교체,
   * 없으면 주입. "없을 때만 주입"이면 위젯 수정이 배포 페이지에 영원히 안 실린다.
   */
  _ensureOnDemandWidget(html) {
    const widget = this._onDemandWidget();
    const currentMarker = widget.match(/<!-- ONDEMAND_WIDGET v\d+ -->/)[0];
    if (html.includes(currentMarker)) return html;
    const block = /<!-- ONDEMAND_WIDGET(?: v\d+)? -->[\s\S]*?<!-- \/ONDEMAND_WIDGET -->/;
    // 치환은 함수로 — 위젯 JS에 $& $' 같은 특수 치환 패턴이 생겨도 오작동하지 않게
    if (block.test(html)) return html.replace(block, () => widget);
    return html.replace('<!-- ARCHIVE_START -->', () => `${widget}\n<!-- ARCHIVE_START -->`);
  }

  // 하위호환 별칭 (legacy 호출부)
  _buildTodaySection(dateStr, generatedAt, topPapers) {
    return this._buildSection(dateStr, generatedAt, topPapers, { isToday: true });
  }

  /**
   * 큐레이션(R4) 적용 — 블록 보장 + 숨김 목록의 섹션 재출현 방어.
   * (예: 가이드라인 주간 게이트가 삭제된 지침을 다시 실을 때 다음 발행에서 제거)
   * 데일리 코어와 격리: 상태 파일이 없거나 깨져도 블록 주입만 하고 지나간다.
   */
  _applyCuration(html, curationState = null) {
    let out = ensureCurationBlock(html, { owner: this.owner, repo: this.repo });
    for (const [hiddenKey, info] of Object.entries(curationState?.hidden ?? {})) {
      const parsed = parseHiddenKey(hiddenKey); // "TAG:sectionKey" — 형식 밖 키는 무시
      if (!parsed) continue;
      out = removeSectionFromHtml(out, { ...parsed, pmid: info?.pmid ?? '' });
    }
    return out;
  }

  /**
   * "아카이브 저장 현황" 섹션(§4-E)을 배포 페이지에 보장(멱등, 매일 최신 데이터로 교체).
   * analysis_archive.json이 없거나 깨지면 원본을 그대로 반환한다 — 데일리 코어 무영향(소프트).
   */
  async _ensureArchiveStatus(html) {
    try {
      const raw = await readFile(path.join(this._repoPath, 'output', 'analysis_archive.json'), 'utf8');
      return ensureArchiveStatus(html, JSON.parse(raw));
    } catch {
      return html;
    }
  }

  // ── 같은 날짜 논문 행 스윕 정규식 (REPORT_SPEC §4-H-3 계약) ──────────────────
  // ★ `data-pmid` **하나만** 단 행을 잡는다. 이것이 "논문 행에 종류 마커를 붙이지
  //   않는다"는 계약의 실체다 — 속성이 하나라도 늘면 여기서 안 잡혀 같은 날 재발행분이
  //   지워지지 않고 **매일 표 행이 중복 누적**된다. 반대로 가이드(`data-guideline`)와
  //   수동 지정(`data-manual`) 행은 바로 이 성질 덕에 스윕에서 살아남는다(의도된 예외).
  //   테스트(`test/tableRowContract.test.mjs`)가 _tableRows 산출물과 이 정규식을
  //   맞물려 검사하므로, 둘 중 하나만 바뀌면 적색이 된다.
  _rowDateDupRe(dateStr) {
    const escDateCell = String(dateStr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`<tr data-pmid="[^"]*"><td class="c-date">${escDateCell}</td>[\\s\\S]*?</tr>`, 'g');
  }

  // ── 누적 아카이브 표의 행(읽음 체크박스 포함) ──────────────────────────────────
  _tableRows(dateStr, topPapers, guideline = null, { manual = false, review = null } = {}) {
    // 수동 지정 행은 data-manual 마커를 단다 — 가이드라인(data-guideline)과 같은 방식으로,
    // 이후 데일리 실행의 "날짜 기준 행 제거"(rowDateDup)에서 지워지지 않게 보호한다.
    const manualAttr = manual ? ' data-manual="1"' : '';
    const rows = topPapers.map((p) => {
      const paper = p.paper ?? {};
      const pmid = paper.pmid ?? '';
      const url = paper.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '#');
      const title = p.title_ko || paper.title || '';
      const journal = paper.journal ?? '';
      return `<tr data-pmid="${esc(pmid)}"${manualAttr}><td class="c-date">${esc(dateStr)}</td><td class="c-jour">${esc(journal)}</td><td class="c-title"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></td><td class="c-read"><input type="checkbox" class="readcb" data-pmid="${esc(pmid)}" aria-label="읽음"></td></tr>`;
    });
    if (guideline) {
      const gp = guideline.paper ?? {};
      const pmid = gp.pmid ?? '';
      // PubMed 미등재 가이드라인은 원문 URL로 걸고, 행 키(읽음 체크·중복 제거)는 sourceId 로 대신한다.
      const url = gp.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (gp.sourceUrl || '#'));
      const rowId = pmid || gp.sourceId || '';
      const title = guideline.title_ko || gp.title || '';
      const journal = guideline.org || gp.journal || '';
      // data-guideline 마커 — 날짜 기준 행 교체에서 제외(가이드는 논문과 라이프사이클이
      // 다름: 주 1회 소개 후 계속 남아야 하고, 논문 재실행 날짜 교체에 지워지면 안 됨)
      // 참고자료는 가이드라인과 다른 페이지 섹션으로 간다(§4-H) — 종류 마커를 단다.
      // ★ data-pmid 는 반드시 첫 속성으로 유지할 것: publish 의 행 dedup 과
      //   curation.js 의 삭제 패치가 `<tr data-pmid="…"[^>]*>` 로 잡는다.
      //   (논문 행에는 마커를 안 붙인다 — 같은 날 재실행 교체 정규식이 속성 추가에
      //    깨진다. 논문은 "data-guideline 없음"으로 판별된다. pageSplit.js 주석 참조.)
      const gKind = guideline.type === 'reference' ? 'reference' : 'guideline';
      const gIcon = gKind === 'reference' ? '🔖' : '📋';
      rows.push(`<tr data-pmid="${esc(rowId)}" data-kind="${gKind}" data-guideline="1"><td class="c-date">${esc(dateStr)}</td><td class="c-jour">${gIcon} ${esc(journal)}</td><td class="c-title"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></td><td class="c-read"><input type="checkbox" class="readcb" data-pmid="${esc(rowId)}" aria-label="읽음"></td></tr>`);
    }
    // ★ 리뷰 행 (3분할 · 2026-08-16). `data-kind="review"` 가 `pageSplit` 이 이 행을
    //   reviews.html 로 보내는 유일한 근거다. 지우면 행이 논문 표로 흘러든다.
    //   `data-guideline="1"` 도 같이 단다 — 날짜 기준 행 교체에서 보호받는 표식이고
    //   가이드와 라이프사이클이 같다(소개 후 계속 남는다).
    if (review) {
      const rp = review.paper ?? review;
      const pmid = rp.pmid ?? review.pmid ?? '';
      const rowId = pmid || rp.id || review.id || '';
      const url = rp.pubmedUrl ?? (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (rp.sourceUrl || '#'));
      const title = review.title_ko || rp.title || review.title || '';
      const journal = rp.journal || review.journal || '';
      rows.push(`<tr data-pmid="${esc(rowId)}" data-kind="review" data-guideline="1"><td class="c-date">${esc(dateStr)}</td><td class="c-jour">📰 ${esc(journal)}</td><td class="c-title"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)}</a></td><td class="c-read"><input type="checkbox" class="readcb" data-pmid="${esc(rowId)}" aria-label="읽음"></td></tr>`);
    }
    return rows.join('');
  }

  // ── 전체 페이지 스캐폴드 ────────────────────────────────────────────────────
  // 타워 톤(§4-H)은 원본 <style> 뒤에 얹혀야 이긴다 → ensureTowerTone 이 </head> 직전에 넣는다.
  buildPage(sectionsHtml, opts = {}) {
    return ensureTowerTone(this._buildPageRaw(sectionsHtml, opts));
  }

  _buildPageRaw(sectionsHtml, { days = 1, papers = 1, updated = '', tableRows = '' } = {}) {
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
// ★ 읽음은 이제 **저장소에도** 올린다. localStorage 에만 두면 리포트를 만드는 러너가
// 이걸 못 봐서 "몇 개 안 읽었다" 를 넣을 수 없다. localStorage 는 오프라인 캐시로 남긴다 —
// 커밋이 실패해도 화면 표시는 즉시 되고, 다음 성공 때 함께 올라간다.
var OWNER='${this.owner ?? 'njell85-spec'}',REPO='${this.repo ?? 'trend-review'}',PATH='output/read_state.json',pend=false;
function tok(){return localStorage.getItem('tr_pat');}
function ymd(){var d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);}
function push(){
  var t=tok(); if(!t){return;}            // 토큰이 없으면 화면 표시만 하고 조용히 넘어간다
  if(pend){return;} pend=true;
  var url='https://api.github.com/repos/'+OWNER+'/'+REPO+'/contents/'+PATH;
  var H={Authorization:'Bearer '+t,Accept:'application/vnd.github+json'};
  fetch(url,{headers:H}).then(function(r){return r.ok?r.json():{};}).then(function(cur){
    var items={},d=ymd();
    for(var k in s){if(s[k]){items[k]=d;}}
    var body={message:'chore(read): 읽음 상태 갱신',content:btoa(unescape(encodeURIComponent(
      JSON.stringify({schemaVersion:1,items:items},null,2)))),sha:cur.sha};
    return fetch(url,{method:'PUT',headers:H,body:JSON.stringify(body)});
  }).catch(function(){}).then(function(){pend=false;});
}
document.querySelectorAll('.readcb').forEach(function(cb){var id=cb.dataset.pmid;var tr=cb.closest('tr');
if(s[id]){cb.checked=true;tr.classList.add('is-read');}
cb.addEventListener('change',function(){s[id]=cb.checked;try{localStorage.setItem(K,JSON.stringify(s));}catch(e){}
tr.classList.toggle('is-read',cb.checked);push();});});})();
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

  /**
   * ★ 스테이징 목록은 **러너가 쓰는 파일 전부**여야 한다.
   *
   * 2026-08-16 실측 치명 결함 — 이 목록에 `reviews.html` 과 트랙 큐가 빠져 있었다.
   * 지난 세션이 "큐가 매 실행 증발한다" 를 고치면서 `.gitignore` 예외만 넣고 **여기를
   * 안 고쳤다.** 예외는 파일을 *추적 가능하게* 만들 뿐 `git add` 를 대신하지 않는다.
   * 그대로 뒀으면 리뷰 저수지가 매 실행 사라지고, 소비한 리뷰가 다음 날 또 소비되고,
   * 3번째 페이지는 원격에서 영원히 갱신되지 않는다. push 는 **성공으로 끝난다.**
   *
   * ★ `control_state.json` · `read_state.json` 은 **절대 넣지 않는다.** 브라우저가 쓰는
   *   파일이고 러너는 읽기만 한다(불변식). 러너가 되쓰기 시작하면 버튼 커밋과 상호
   *   덮어쓰기가 시작된다.
   * `test/publishStaging.test.mjs` 가 이 목록을 실제 기록 경로와 맞물려 검사한다.
   */
  static RUNNER_FILES = Object.freeze([
    'index.html', 'guidelines.html', 'reviews.html',
    'output/selected_papers.json', 'output/selected_guidelines.json',
    'output/queue_papers.json', 'output/queue_reviews.json',
  ]);

  _gitPush(dateStr) {
    const files = GitHubPublisher.RUNNER_FILES
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
    return this._getPage('index.html');
  }

  async _getPage(relPath) {
    const localPath = path.join(this._repoPath, relPath);
    try {
      return { sha: null, html: await readFile(localPath, 'utf8') };
    } catch { /* fall through to API */ }
    try {
      const data = await this._req(`/repos/${this.owner}/${this.repo}/contents/${relPath}`);
      return { sha: data.sha, html: Buffer.from(data.content, 'base64').toString('utf8') };
    } catch {
      return { sha: null, html: null };
    }
  }

  /** 참고자료 식별자 — 구본 표 행(data-kind 없음)을 가이드/기타로 가를 때만 쓴다. */
  async _referenceIds() {
    try {
      const raw = await readFile(path.join(this._repoPath, 'output', 'selected_references.json'), 'utf8');
      return new Set(JSON.parse(raw).map((r) => r.pmid || r.sourceId).filter(Boolean));
    } catch {
      return null; // 없으면 기타 0건으로 본다 — 분할 자체는 성립한다(소프트).
    }
  }

  // ── 누적 업데이트 ────────────────────────────────────────────────────────────
  async publish(dateStr, topPapers, { guideline = null, manual = false, guidelineState = null, review = null } = {}) {
    // ★ 페이지 2분할(§4-H) — 합쳤다가 가른다.
    // 아래 증분 로직(지침 중복 제거·TODAY 강등·날짜 행 교체·PMID dedup·통계 갱신)은
    // 단일 페이지를 전제로 4주간 다듬어졌다. 두 벌로 쪼개는 대신 **입력을 합쳐서**
    // 종전과 동일한 본문을 보게 하고, 맨 끝에서만 두 파일로 가른다.
    const { html: indexHtml } = await this._getIndex();
    const { html: guidesHtml } = await this._getPage('guidelines.html');
    const { html: reviewsHtml } = await this._getPage('reviews.html');
    const existing = mergePages(indexHtml, guidesHtml, reviewsHtml);
    const generatedAt = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    const route = llmTelemetry.label();
    // 수동 지정(on-demand)은 날짜 키와 분리된 자체 섹션 키를 쓴다 —
    // 같은 날의 데일리 자동 선정 섹션·표 행을 지우지 않기 위함(§1-B).
    // PubMed 미등재 가이드라인은 pmid 가 빈 문자열이라 `??` 로는 폴백되지 않는다 → `||` + sourceId.
    const gIdent = guideline?.paper?.pmid || guideline?.paper?.sourceId || '';
    const keyPmid = topPapers[0]?.paper?.pmid || gIdent || 'x';
    const sectionKey = manual ? `${dateStr}-m-${keyPmid}` : dateStr;
    // 논문이 없으면(수동 가이드라인 단독) 빈 논문 섹션을 만들지 않는다.
    const todaySection = topPapers.length
      ? this._buildSection(dateStr, generatedAt, topPapers, { isToday: true, route, manual, sectionKey })
      : '';
    const gKey = manual ? `${dateStr}-m-${gIdent || 'x'}` : dateStr;
    const guidelineSection = guideline
      ? this._buildGuidelineSection(dateStr, generatedAt, guideline, { isToday: true, manual, sectionKey: gKey })
      : '';
    // ★ 리뷰 섹션. 없으면 빈 문자열이라 아무것도 안 바뀐다(데일리 코어 무영향).
    const rIdent = review?.paper?.pmid || review?.pmid || review?.id || '';
    // ★ 식별자가 없으면 **발행하지 않는다** (2026-08-16 코드리뷰 발견 B16).
    //   식별자가 없으면 카드 중복 제거(`rIdent` 기반)도 행 dedup 도 돌지 않아
    //   매 실행 카드와 행이 무한히 쌓인다. 못 지우는 것을 만들지 않는 편이 낫다.
    if (review && !rIdent) {
      this.logger?.warn?.('리뷰에 식별자가 없어 발행하지 않는다 — 중복을 지울 방법이 없다',
        { title: String(review.title ?? '').slice(0, 60) });
    }
    const publishableReview = rIdent ? review : null;
    const reviewSection = publishableReview
      ? this._buildReviewSection(dateStr, generatedAt, publishableReview, { sectionKey: `${dateStr}-r-${rIdent}` })
      : '';

    const newRows = this._tableRows(dateStr, topPapers, guideline, { manual, review: publishableReview });

    let updated;
    if (!existing || !existing.includes('<!-- ARCHIVE_START -->')) {
      // 최초 생성 (또는 구버전 스캐폴드) → 전체 페이지를 새 디자인으로 생성
      updated = this.buildPage(`${todaySection}\n${guidelineSection}\n${reviewSection}`, { days: 1, papers: topPapers.length, updated: generatedAt, tableRows: newRows });
    } else {
      // 같은 키 섹션 제거 — 데일리는 날짜 키(그날 재실행 시 교체), 수동은 자체 키만
      // 교체(재실행 안전)하고 같은 날 데일리 섹션은 보존한다.
      const escKey = sectionKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dup = new RegExp(`\\n?<!-- SECTION:${escKey} -->[\\s\\S]*?<!-- /SECTION:${escKey} -->`, 'g');
      let body = existing.replace(dup, '');
      if (!manual) {
        const escDate = dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const gdup = new RegExp(`\\n?<!-- GSECTION:${escDate} -->[\\s\\S]*?<!-- /GSECTION:${escDate} -->`, 'g');
        body = body.replace(gdup, '');
      }
      // 같은 가이드라인(동일 PMID)이 다른 날짜 카드로 이미 올라와 있으면 제거.
      // 주간 게이트가 실패해도 같은 지침이 중복 노출되지 않게 하는 심층 방어.
      // 지문(fingerprint) = PubMed 링크(등재본) 또는 원문 URL(웹 공개본). 웹 공개본은 URL 이
      // 카드에 esc() 된 형태로 들어가므로 원문·이스케이프본 양쪽으로 대조한다.
      const gMarks = [];
      if (guideline?.paper?.pmid) gMarks.push(`pubmed.ncbi.nlm.nih.gov/${guideline.paper.pmid}/`);
      if (guideline?.paper?.sourceUrl) gMarks.push(guideline.paper.sourceUrl, esc(guideline.paper.sourceUrl));
      if (gMarks.length) {
        body = body.replace(
          /\n?<!-- GSECTION:[^\s>]+ -->[\s\S]*?<!-- \/GSECTION:[^\s>]+ -->/g,
          (block) => gMarks.some((m) => block.includes(m)) ? '' : block,
        );
      }
      // 이전 TODAY/NEW → past 로 강등. 논문(TODAY)·가이드(NEW) 모두 같은
      // 'day day-today' 컨테이너를 쓰므로 details 강등은 한 정규식이 처리한다.
      // 수동 지정은 강등을 건너뜀 — 같은 날 데일리 섹션의 TODAY 를 지우지 않기 위함.
      if (!manual) {
        body = body
          // ★ 요구 ③ 이후 새 카드는 `open` 없이 나온다. 배포본에는 **옛 open 카드가
          //   그대로 남아 있으므로** 두 형태를 모두 강등한다. 한쪽만 잡으면 어제 카드가
          //   영원히 day-today 로 남아 TODAY 가 둘이 된다.
          .replace(/<details(?: open)? class="day day-today">/g, '<details class="day day-past">')
          .replace(/<span class="t-badge">TODAY<\/span>/g, '')
          .replace(/<span class="t-badge gl-badge">NEW<\/span>/g, '');
      }
      // 같은 리뷰가 다른 날짜 카드로 이미 올라와 있으면 제거(중복 노출 방어).
      if (rIdent) {
        // ★ 여는 마커의 키를 역참조로 잡아 **닫는 마커가 같은 키일 때만** 지운다.
        //   `[^\\s>]+` 로 열어두면 닫는 마커가 어긋난 순간 다음 리뷰 카드까지 통째로
        //   삼킨다(코드리뷰 실측 · 부분 배포·수동 수정 시 재현).
        const rEsc = String(rIdent).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rDup = new RegExp(`\\n?<!-- RSECTION:([^\\s>]+-r-${rEsc}) -->[\\s\\S]*?<!-- /RSECTION:\\1 -->`, 'g');
        body = body.replace(rDup, '');
      }
      // 새 TODAY 삽입 (논문 먼저, 그 아래 가이드라인, 그 아래 리뷰)
      body = body.replace('<!-- ARCHIVE_START -->', () => `<!-- ARCHIVE_START -->\n${todaySection}${guidelineSection ? `\n${guidelineSection}` : ''}${reviewSection ? `\n${reviewSection}` : ''}`);
      // 누적 표 정리 (재실행 시 상단 섹션과 정확히 일치시키기 위해):
      //   ① 같은 날짜의 기존 행을 모두 제거 — 상단 SECTION 이 날짜 기준으로 교체되므로
      //      표도 동일하게. 하루에 여러 번 실행돼도 그날 최종 선정분만 남는다.
      if (!manual) {
        body = body.replace(this._rowDateDupRe(dateStr), '');
      }
      //   ② 같은 PMID 행 제거 — 과거 날짜에 같은 논문/지침/리뷰가 또 선정된 경우 중복 방지
      //   ★ **새 종류를 더할 때 이 목록에도 넣어야 한다.** 리뷰를 붙이면서 여기를 빼먹어
      //     같은 날 재실행하면 리뷰 행이 둘이 됐다(E2E 테스트가 잡았다). 리뷰 행은
      //     `data-guideline="1"` 을 달아 날짜 스윕(①)에서 보호받으므로, 여기서 안 지우면
      //     지울 곳이 없다.
      const dedupItems = [...topPapers, guideline, publishableReview].filter(Boolean);
      for (const p of dedupItems) {
        // 웹 공개본 가이드라인은 pmid 가 없다 — 행 키로 쓴 sourceId 로 같은 항목을 지운다.
        // 리뷰 큐 항목은 `paper` 로 감싸여 있지 않고 pmid/id 를 직접 들고 온다.
        const pmid = p.paper?.pmid || p.paper?.sourceId || p.pmid || p.id;
        if (!pmid) continue;
        // [^>]* — 가이드 행의 data-guideline="1" 같은 추가 속성이 있어도 매치되게.
        // (없으면 같은 지침 재발행 시 과거 행이 안 지워져 표에 중복이 남는다)
        const rowDup = new RegExp(`<tr data-pmid="${pmid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[\\s\\S]*?</tr>`, 'g');
        body = body.replace(rowDup, '');
      }
      if (body.includes('<!-- TABLE_ROWS_START -->')) {
        // ★ 함수형 replacer 필수. `newRows` 에는 LLM 이 만든 제목이 들어 있고, 거기에
        //   `$&` 나 `` $` `` 가 있으면 문자열 치환이 그것을 **특수 패턴으로 해석해**
        //   본문을 통째로 복제한다. `esc()` 는 `&` 를 `&amp;` 로 바꿀 뿐 `$&` 는 그대로
        //   남기므로 방어가 안 된다. 실측: 제목 하나로 index.html 575KB → 1.37MB.
        //   pageSplit.js 의 쌍둥이 자리는 이미 함수형인데 여기만 아니었다.
        body = body.replace('<!-- TABLE_ROWS_START -->', () => `<!-- TABLE_ROWS_START -->${newRows}`);
      }
      // 통계 갱신 — 분석일수는 데일리(날짜 키) 섹션만 센다. 수동 지정 섹션
      // (SECTION:YYYY-MM-DD-m-pmid)은 "하루 1편 카운트 밖의 예외"이므로 제외한다.
      const dayCount = (body.match(/<!-- SECTION:\d{4}-\d{2}-\d{2} -->/g) ?? []).length;
      const paperCount = (body.match(/class="paper-card"/g) ?? []).length || dayCount;
      body = body
        .replace(/<div class="n stat-days-count">[^<]*<\/div>/, `<div class="n stat-days-count">${dayCount}</div>`)
        .replace(/<span class="stat-updated-time">[^<]*<\/span>/, `<span class="stat-updated-time">${generatedAt}</span>`)
        .replace(/<div class="n stat-papers-count">[^<]*<\/div>/, `<div class="n stat-papers-count">${paperCount}</div>`)
        .replace(/<span class="at-count">[^<]*<\/span>/, `<span class="at-count">${paperCount}편</span>`);
      updated = body;
    }
    if (guidelineState) updated = this._renderGuidelineState(updated, guidelineState, generatedAt);
    // ★ 예고 리스트. 상태 파일이 없거나 깨져도 **발행을 막지 않는다** — 예고는 부가물이고
    //   데일리 코어 무영향이 불변식이다. 실패하면 예고 블록만 빠진 페이지가 나간다.
    try { updated = await this._renderUpcomingFromDisk(updated, generatedAt); }
    catch (err) { this.logger?.warn?.('예고 리스트 렌더 실패 — 페이지는 그대로 나간다', { err: err.message }); }
    updated = this._ensureOnDemandWidget(updated);
    let curationState = null;
    try { curationState = await loadCurationState(path.join(this._repoPath, 'output', 'curation_state.json')); } catch { /* 소프트 */ }
    updated = this._applyCuration(updated, curationState);
    updated = await this._ensureArchiveStatus(updated);

    // 두 페이지로 가른다. 스캐폴드가 아니면 split 이 guidelines=null 을 돌려주고
    // index 만 종전대로 기록된다(소프트 — 분할 실패가 데일리를 막지 않는다).
    const { index: indexOut, guidelines: guidesOut, reviews: reviewsOut, counts } = splitPages(updated, {
      refIds: await this._referenceIds(),
      needsReview: guidelineState?.needsReview
        ?? guidelineState?.queue?.filter((item) => item.status === 'needsReview')
        ?? [],
    });
    // ★ 분할이 소프트 폴백으로 떨어지면 **아무것도 쓰지 않는다** (코드리뷰 발견 B15).
    //   종전에는 병합 본문을 index.html 에 그대로 기록하고 하위 페이지는 건너뛰었다.
    //   그러면 index 에 가이드·리뷰·기타 카드가 전부 들어간 채로 남고, 하위 페이지는
    //   옛 사본을 유지한다 → **다음 실행의 merge 가 같은 것을 또 합쳐 매일 두 배가 된다.**
    //   폴백은 "분할이 데일리를 막지 않는다" 를 위한 것이지 페이지를 망가뜨리라는 뜻이
    //   아니다. 그대로 두는 편이 안전하고, 무엇보다 **소리 없이 지나가지 않게** 경고한다.
    if (!guidesOut || !reviewsOut) {
      this.logger.warn('페이지 분할이 소프트 폴백으로 떨어졌다 — 페이지를 건드리지 않는다', {
        guidelines: Boolean(guidesOut), reviews: Boolean(reviewsOut),
      });
      try { this._gitPush(dateStr); } catch { /* 상태 파일만이라도 남긴다 */ }
      return this.pagesUrl;
    }
    await writeFile(path.join(this._repoPath, 'index.html'), indexOut, 'utf8');
    await writeFile(path.join(this._repoPath, 'guidelines.html'), guidesOut, 'utf8');
    await writeFile(path.join(this._repoPath, 'reviews.html'), reviewsOut, 'utf8');
    this.logger.info('페이지 3분할 기록', counts);
    updated = indexOut;

    try {
      this._gitPush(dateStr);
      return this.pagesUrl;
    } catch (pushErr) {
      // git push 실패 폴백: index.html 뿐 아니라 상태 JSON(제외목록·가이드라인)도
      // Contents API로 함께 upsert한다. 상태 파일을 빠뜨리면(F1) 다음날 fresh checkout이
      // 중복방지 게이트를 잃어 같은 논문을 재선정한다. 각 PUT은 원격 최신 sha를 재조회해
      // 반영한다. (동시 러너로 원격이 앞선 경우의 완전 병합은 범위 밖 — 데일리는 단일 크론.)
      this.logger.warn('git push 실패 — Contents API 폴백으로 개별 업로드', { err: this._scrub(pushErr.message) });
      await this._putFileViaApi('index.html', updated, dateStr);
      // guidelines.html 을 빠뜨리면 두 페이지가 어긋난다 — 다음 실행의 merge 가
      // 낡은 가이드 페이지를 합쳐 이미 지운 카드를 되살린다.
      if (guidesOut) await this._putFileViaApi('guidelines.html', guidesOut, dateStr);
      if (reviewsOut) await this._putFileViaApi('reviews.html', reviewsOut, dateStr);
      // 폴백도 같은 목록을 쓴다 — 한쪽만 늘리면 다시 어긋난다.
      for (const rel of GitHubPublisher.RUNNER_FILES.filter((f) => f.startsWith('output/'))) {
        const abs = path.join(this._repoPath, rel);
        if (!existsSync(abs)) continue;
        await this._putFileViaApi(rel, await readFile(abs, 'utf8'), dateStr);
      }
      return this.pagesUrl;
    }
  }

  // Contents API로 파일 하나를 upsert — 원격 최신 sha를 재조회해 반영(신규 파일이면 sha 없이 생성).
  async _putFileViaApi(relPath, content, dateStr) {
    let sha = null;
    try { sha = (await this._req(`/repos/${this.owner}/${this.repo}/contents/${relPath}`)).sha; }
    catch { /* 원격에 아직 없는 신규 파일 */ }
    await this._req(`/repos/${this.owner}/${this.repo}/contents/${relPath}`, 'PUT', {
      message: `Update archive: ${dateStr}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha,
    });
  }
}
