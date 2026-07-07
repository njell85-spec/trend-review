/**
 * docBuilder — 리빙 Google Doc용 HTML 생성.
 * Drive files.update(HTML→Doc 변환)에 태우므로 Doc 변환이 유지하는 기본 태그만 사용한다.
 * 모든 외부/LLM 텍스트는 esc()를 거친다 (전역 지침 ② — 이스케이프 없는 삽입 금지).
 */
export function esc(s) {
  // GitHubPublisher.esc와 동일 집합(작은따옴표 포함) — 채널 간 이스케이프 드리프트 방지
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const li = (arr) => (arr ?? []).map((x) => `<li>${esc(x)}</li>`).join('');

function entrySection(e) {
  const pico = e.pico_ko ?? {};
  const dossier = (e.dossier ?? []).map(
    (d) => `<li>${esc(d.note)} — <a href="${esc(d.url)}">${esc(d.source)}</a></li>`).join('');
  return `
<h2>${esc(e.date)} — ${esc(e.title_ko || e.title)}</h2>
<p><b>${esc(e.title)}</b><br>${esc(e.journal)} · PMID ${esc(e.pmid)}${e.doi ? ` · DOI ${esc(e.doi)}` : ''}<br>
근거: <b>${esc(e.badge)}</b> · 근거수준 ${esc(e.evidenceLevel ?? '—')}${e.pdfLink ? ` · <a href="${esc(e.pdfLink)}">원문 PDF(Drive)</a>` : ''}</p>
<h3>임상 질문</h3><p>${esc(e.clinicalQuestion_ko)}</p>
<h3>PICO</h3><ul><li>P: ${esc(pico.population)}</li><li>I: ${esc(pico.intervention)}</li><li>C: ${esc(pico.comparison)}</li><li>O: ${esc(pico.outcome)}</li></ul>
<h3>핵심 소견</h3><ul>${li(e.keyFindings_ko)}</ul><ul>${li(e.keyFindings)}</ul>
${dossier ? `<h3>근거 도시에 (페이월 — 권위 소스 보강)</h3><ul>${dossier}</ul>` : ''}
<h3>참조</h3><ul>${(e.references ?? []).map((r) => `<li><a href="${esc(r.url)}">${esc(r.label)}</a></li>`).join('')}</ul>
${e.fullText ? `<h3>본문 텍스트 (${esc(e.fullTextSource)}, 최대 1만 자)</h3><p>${esc(e.fullText).replace(/\n/g, '<br>')}</p>` : ''}
<hr>`;
}

export function buildMonthDocHtml(month, entries) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `<html><head><meta charset="utf-8"><title>Trend Review — ${esc(month)}</title></head><body>
<h1>Trend Review — ${esc(month)}</h1>
<p>EM/CCM 데일리 논문 리뷰 아카이브. 수치는 초록·본문·레지스트리·확인된 권위 웹페이지에 명시된 값만 수록.</p>
${sorted.map(entrySection).join('\n')}
</body></html>`;
}
