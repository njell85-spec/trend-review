/**
 * GitHubPublisher
 * 매일 실행 결과를 GitHub Pages의 index.html에 누적 업데이트
 *
 * 배포 전략: git push 우선, 프록시 차단 등으로 실패 시 GitHub REST API 폴백
 * (Node.js fetch는 Windows 시스템 프록시를 무시하므로 git CLI가 더 안정적)
 */
import { readFile, writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const API = 'https://api.github.com';

export class GitHubPublisher {
  constructor({
    token    = process.env.GITHUB_TOKEN,
    owner    = process.env.GITHUB_OWNER,
    repo     = process.env.GITHUB_REPO,
    repoPath = process.cwd(),
  } = {}) {
    this.token    = token;
    this.owner    = owner;
    this.repo     = repo;
    this.pagesUrl = `https://${owner}.github.io/${repo}/`;
    this._repoPath = repoPath;
  }

  // ── git push (proxy 우회용 1순위 방법) ─────────────────────────────────────
  _gitPush(dateStr) {
    const cwd = this._repoPath;
    execSync('git add index.html', { cwd, stdio: 'pipe' });
    // 변경 없으면 커밋 건너뜀
    const diff = execSync('git diff --staged --name-only', { cwd, encoding: 'utf8' }).trim();
    if (!diff) return;
    execSync(`git commit -m "Update archive: ${dateStr}"`, { cwd, stdio: 'pipe' });
    execSync('git push', { cwd, stdio: 'pipe' });
  }

  async _req(path, method = 'GET', body = null) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `token ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async _getIndex() {
    // 로컬 파일 우선 (git push 경로), 없으면 API 폴백
    const localPath = path.join(this._repoPath, 'index.html');
    try {
      const html = await readFile(localPath, 'utf8');
      return { sha: null, html };
    } catch {
      // 로컬 없으면 API에서 읽기
    }
    try {
      const data = await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`);
      return {
        sha: data.sha,
        html: Buffer.from(data.content, 'base64').toString('utf8'),
      };
    } catch {
      return { sha: null, html: null };
    }
  }

  // ── Static helpers (ReportGeneratorAgent.js 동기화) ──────────────────────

  static _extractN(populationText) {
    const m = (populationText ?? '').match(/n\s*[=:]\s*([\d,]+)/i)
      ?? (populationText ?? '').match(/([\d,]+)\s*(?:patients|participants|children|encounters|hospitalizations|adults|subjects)/i);
    return m ? m[1] : null;
  }

  static _internalValidityLabel(ev) {
    if (['High', 'RCT', 'Meta', 'Meta-analysis', 'Systematic Review'].includes(ev))
      return { label: 'Low Risk', cls: 'bg-gray-900 text-white' };
    if (['Moderate', 'Cohort', 'Validation'].includes(ev))
      return { label: 'Some Concerns', cls: 'bg-gray-600 text-white' };
    return { label: 'High Risk', cls: 'bg-gray-300 text-gray-800' };
  }

  static _edApplicabilityLabel(score) {
    const s = Number(score);
    if (s >= 8) return { label: '적용 가능', cls: 'bg-gray-900 text-white' };
    if (s >= 5) return { label: '부분 적용', cls: 'bg-gray-600 text-white' };
    return { label: '적용 어려움', cls: 'bg-gray-300 text-gray-800' };
  }

  // ── Section builder ───────────────────────────────────────────────────────

  _buildTodaySection(dateStr, generatedAt, topPapers) {
    const numBg  = ['bg-gray-900', 'bg-gray-600', 'bg-gray-400'];
    const evStyle = {
      High:               'border border-gray-800 text-gray-800',
      Moderate:           'border border-gray-400 text-gray-600',
      Low:                'border border-gray-300 text-gray-400',
      'Very Low':         'border border-gray-200 text-gray-400',
      RCT:                'border border-gray-800 text-gray-800',
      Meta:               'border border-gray-800 text-gray-800',
      'Meta-analysis':    'border border-gray-800 text-gray-800',
      'Systematic Review':'border border-gray-800 text-gray-800',
      Cohort:             'border border-gray-400 text-gray-600',
      Validation:         'border border-gray-400 text-gray-600',
      Review:             'border border-gray-300 text-gray-400',
      Other:              'border border-gray-200 text-gray-400',
    };

    const summaryList = topPapers.slice(0, 3).map((p, i) => {
      const circ  = ['①','②','③'][i];
      const title   = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const date    = p.paper?.pubDate ?? '';
      const pmid    = p.paper?.pmid ?? '';
      return `
        <div class="text-[18px] font-black text-gray-700 mt-1">${circ} ${_esc(title)}</div>
        <div class="text-[12px] text-gray-400 pl-3">${_esc(journal)} · ${_esc(date)}${pmid ? ` · PMID ${pmid}` : ''}</div>`;
    }).join('');

    const paperCards = topPapers.slice(0, 3).map((p, i) => {
      const nb      = numBg[i];
      const title   = p.paper?.title ?? '제목 없음';
      const journal = p.paper?.journal ?? '';
      const date    = p.paper?.pubDate ?? '';
      const pmid    = p.paper?.pmid ?? '';
      const pmurl   = p.paper?.pubmedUrl ?? '#';
      const studyType = p.paper?.scoringData?.studyType ?? '';
      const score   = p.clinicalApplicabilityScore ?? '—';
      const ev      = p.evidenceLevel ?? '—';
      const evCls   = evStyle[ev] ?? 'border border-gray-300 text-gray-400';
      const evShort = { 'Meta-analysis':'Meta','Systematic Review':'SR','Moderate':'Mod','Very Low':'V.Low' }[ev] ?? ev;

      const picoEn = p.pico ?? {};
      const picoKo = p.pico_ko ?? {};
      const baseline = p.baseline ?? 'Not reported';
      const nVal = GitHubPublisher._extractN(picoEn.population ?? picoKo.population ?? '');
      const validity = GitHubPublisher._internalValidityLabel(ev);
      const edApply  = GitHubPublisher._edApplicabilityLabel(score);

      // 영어 원문(위) + 한글 번역(아래) 병렬 — 동일 양식, 블록 장식 없음
      const enKo = (en, ko) => `
        <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(en ?? '—')}</p>
        ${ko ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(ko)}</p>` : ''}`;
      const subhead = (label) => `<div class="text-[15px] font-black text-blue-700 mt-3 mb-1">${label}</div>`;
      const sectionTitle = (label) => `<div class="text-[16px] font-black text-blue-900 mt-4 mb-1.5 pb-1 border-b border-gray-200">${label}</div>`;

      const secondaryItems = (p.secondaryOutcomes ?? []).map((s, k) => `
        <li class="mb-1.5 pl-2.5 border-l-2 border-gray-200">
          <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(s)}</p>
          ${p.secondaryOutcomes_ko?.[k] ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(p.secondaryOutcomes_ko[k])}</p>` : ''}
        </li>`).join('');

      const glossaryItems = (p.statGlossary ?? []).map(
        (g) => `<div class="mb-0.5"><b class="text-gray-600">${_esc(g.term)}</b> — ${_esc(g.explanation_ko)}</div>`
      ).join('');
      const glossaryBlock = glossaryItems
        ? `<div class="mt-2 bg-gray-50 rounded-lg px-3 py-2 text-[12px] text-gray-500 leading-relaxed"><div class="font-bold text-gray-600 mb-1">📊</div>${glossaryItems}</div>`
        : '';

      const practiceItems = (p.practiceChange ?? []).map((t, k) => `
        <li class="mb-1.5 flex gap-1.5">
          <span class="text-blue-700 font-bold flex-shrink-0">·</span>
          <div>
            <p class="text-[13px] text-gray-800 leading-relaxed">${_esc(t)}</p>
            ${p.practiceChange_ko?.[k] ? `<p class="text-[13px] text-gray-500 leading-relaxed mt-0.5">${_esc(p.practiceChange_ko[k])}</p>` : ''}
          </div>
        </li>`).join('');

      const numBadge = (i + 1).toString().padStart(2, '0');
      const doiLink = p.paper?.doi
        ? ` · <a href="https://doi.org/${_esc(p.paper.doi)}" target="_blank" class="text-blue-600 underline">DOI</a>`
        : '';

      return `
    <details class="group">
      <summary class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition select-none">
        <span class="w-7 h-7 rounded-full ${nb} text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0">${numBadge}</span>
        <div class="flex-1 min-w-0">
          <div class="text-[16px] font-black text-blue-900 leading-snug">${_esc(title)}</div>
          <div class="text-[12px] text-gray-400 mt-0.5">${_esc(journal)} · ${_esc(date)}</div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[12px] ${evCls} px-1.5 py-0.5 rounded-full">${evShort}</span>
          <svg class="chev w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </summary>
      <div class="slide-in px-4 pb-4 pt-2 bg-gray-50/60">
        <div class="text-[12px] text-gray-500">
          <b class="text-gray-700">${_esc(journal)}</b> · ${_esc(date)}${studyType ? ` · ${_esc(studyType)}` : ''} · <a href="${pmurl}" target="_blank" class="text-blue-600 underline">PubMed${pmid ? ` ${pmid}` : ''}</a>${doiLink}
        </div>

        ${subhead('Why It Matters')}
        ${enKo(p.clinicalQuestion, p.clinicalQuestion_ko)}

        ${sectionTitle('PICO Framework')}
        ${subhead('P — Patient')}
        ${enKo(picoEn.population, picoKo.population)}
        <div class="text-[13px] text-gray-700 mt-1">${nVal ? `<b>n = ${_esc(nVal)}</b> · ` : ''}<span class="text-gray-500">Baseline —</span> <b>${_esc(baseline)}</b></div>
        ${subhead('I — Intervention')}
        ${enKo(picoEn.intervention, picoKo.intervention)}
        ${subhead('C — Comparison')}
        ${enKo(picoEn.comparison, picoKo.comparison)}
        ${subhead('O — Outcome & Results')}
        <div class="text-[12px] font-bold text-gray-500 uppercase mb-0.5">Primary</div>
        ${enKo(picoEn.outcome, picoKo.outcome)}
        ${secondaryItems ? `<div class="text-[12px] font-bold text-gray-500 uppercase mt-2 mb-0.5">Secondary</div><ul>${secondaryItems}</ul>` : ''}
        ${glossaryBlock}

        ${sectionTitle('Critical Appraisal & Applicability')}
        <div class="text-[13px] text-gray-800"><span class="font-bold text-blue-700">Internal Validity</span> — <b>${_esc(validity.label)}</b></div>
        ${p.paper?.scoringData?.rationale ? `<div class="text-[13px] text-gray-600 mt-0.5"><span class="text-gray-500">Reason :</span> ${_esc(p.paper.scoringData.rationale)}</div>` : ''}
        ${subhead('Limitations')}
        ${enKo(p.limitations, p.limitations_ko)}
        <div class="text-[13px] text-gray-800 mt-2"><span class="font-bold text-blue-700">ED Applicability</span> — <b>${_esc(edApply.label)}</b></div>

        ${sectionTitle('Clinical Bottom Line')}
        ${enKo(p.clinicalTakeaway, p.clinicalTakeaway_ko)}
        ${practiceItems ? `${subhead('Practice Change')}<ul class="mt-0.5">${practiceItems}</ul>` : ''}
      </div>
    </details>`;
    }).join('');

    return `
<!-- SECTION:${dateStr} -->
<details open class="rounded-xl overflow-hidden shadow-sm border-2 border-gray-900 bg-white">
  <summary class="px-4 py-3.5 flex items-start gap-3 hover:bg-gray-50 transition select-none">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-2.5">
        <span class="bg-gray-900 text-white text-[12px] font-bold px-2 py-0.5 rounded-full">TODAY</span>
        <span class="font-black text-gray-900 text-[18px]">${dateStr}</span>
        <span class="text-gray-400 text-[14px]">· ${topPapers.length}편</span>
        <span class="text-gray-300 text-[12px] ml-auto">생성 ${_esc(generatedAt)}</span>
      </div>
      <div class="space-y-1">${summaryList}
      </div>
    </div>
    <svg class="chev w-4 h-4 text-gray-400 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
  </summary>
  <div class="slide-in border-t-2 border-gray-900 divide-y divide-gray-100">
    ${paperCards}
  </div>
</details>
<!-- /SECTION:${dateStr} -->`;
  }

  async publish(dateStr, topPapers) {
    const { sha, html } = await this._getIndex();

    if (!html) {
      throw new Error('index.html을 GitHub에서 가져올 수 없습니다');
    }

    const generatedAt = new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

    // 같은 날짜의 기존 섹션 제거 (재실행 시 중복 방지)
    const dupSection = new RegExp(
      `<!-- SECTION:${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<!-- /SECTION:${dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`,
      'g'
    );
    const deduped = html.replace(dupSection, '');

    // 기존 TODAY 배지 제거, 섹션을 past 스타일로 전환
    let updated = deduped
      .replace(/<span class="bg-gray-900 text-white text-\[12px\] font-bold px-2 py-0\.5 rounded-full">TODAY<\/span>/g, '')
      .replace(/<details open class="rounded-xl overflow-hidden shadow-sm border-2 border-gray-900 bg-white">/g,
               '<details class="rounded-xl overflow-hidden shadow-sm border border-gray-200 bg-white">')
      .replace(/class="slide-in border-t-2 border-gray-900 divide-y divide-gray-100"/g,
               'class="slide-in border-t border-gray-200 divide-y divide-gray-100"');

    // 새 TODAY 섹션을 아카이브 컨테이너 맨 위에 삽입
    const todaySection = this._buildTodaySection(dateStr, generatedAt, topPapers);
    updated = updated.replace(
      /(<div class="max-w-2xl mx-auto px-3 py-5 space-y-3">)/,
      `$1\n${todaySection}`
    );

    // 통계 업데이트
    const dayCount   = (updated.match(/<!-- SECTION:/g) ?? []).length;
    const paperCount = dayCount * 3;
    updated = updated
      .replace(/<div class="stat-days-count[^"]*">\d+<\/div>/,
               `<div class="stat-days-count text-3xl font-black tabular-nums">${dayCount}</div>`)
      .replace(/<div class="stat-papers-count[^"]*">\d+<\/div>/,
               `<div class="stat-papers-count text-3xl font-black tabular-nums">${paperCount}</div>`)
      .replace(/<div class="stat-updated-time[^"]*">[^<]+<\/div>/,
               `<div class="stat-updated-time text-sm font-semibold text-gray-300">${generatedAt}</div>`);

    // ── 배포: git push 우선 → API 폴백 ────────────────────────────────────────
    const localPath = path.join(this._repoPath, 'index.html');
    await writeFile(localPath, updated, 'utf8');

    try {
      this._gitPush(dateStr);
      return this.pagesUrl;
    } catch (gitErr) {
      // git 실패 시 REST API 폴백 (sha 필요)
      let apisha = sha;
      if (!apisha) {
        try {
          const remote = await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`);
          apisha = remote.sha;
        } catch { /* sha 없으면 API도 실패할 것 */ }
      }
      const content = Buffer.from(updated, 'utf8').toString('base64');
      await this._req(`/repos/${this.owner}/${this.repo}/contents/index.html`, 'PUT', {
        message: `Update archive: ${dateStr}`,
        content,
        sha: apisha,
      });
      return this.pagesUrl;
    }
  }
}

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
