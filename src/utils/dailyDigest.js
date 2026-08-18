/**
 * dailyDigest — 그날 발행한 분석을 **화면과 같은 내용**으로 담은 Markdown 한 장.
 *
 * 왜 생겼나 (PeterJ 확정 2026-08-18):
 *   *"그날 분석한 내용 동일내용으로 md파일로 추가제시 해줘. 여차하면 텔레그램에서 눌러서
 *     그날거는 바로 읽게."*
 *   텔레그램 리포트 본문은 **제목 한 줄**뿐이라 대시보드를 열어야 내용을 본다. 이동 중에
 *   그게 안 될 때가 있어서, 텔레그램 안에서 바로 읽히는 첨부를 붙인다(.md 는 텔레그램이
 *   앱 안에서 미리보기로 연다).
 *
 * ★ "동일내용" 이 규격이다 — 여기서 요약하지 않는다. 카드가 그리는 축을 **그대로** 옮긴다.
 *   ① 논문   WHY IT MATTERS · PICO · 2차 결과 · 통계 용어 · 제한점 · 임상 결론 · Practice Change
 *   ② 가이드라인  핵심 권고 · 이전 판 대비 변경점 · 임상 임팩트
 *   ③ 리뷰   본문 번역(절별) · 확보 수준(coverage) · 임상 적용
 *   축을 줄이면 "첨부를 봤는데 화면과 다르다" 가 된다 — 그러면 아무도 첨부를 안 믿는다.
 *
 * ★ 기존 `trackDigest.js` 를 쓰지 않는 이유: 그쪽은 트랙마다 **파일 하나**를 내고 필드도
 *   제목·저널·요약 정도로 얕다(wiki 적재용). 여기 요구는 "그날 것 한 장" 이라 축이 다르다.
 *   trackDigest 는 그대로 둔다(용도가 다른 별개 산출물).
 *
 * 보안·안정성:
 *   · 모든 외부/LLM 텍스트는 `md()` 로 Markdown 문법 문자를 리터럴화한다 — 제목 안의
 *     `#`·`*`·`[]` 가 문서 구조를 새로 열지 못하게. (docBuilder 의 esc() 와 같은 취지)
 *   · 어떤 필드가 없어도 **그 절만 빠지고** 나머지는 나온다. 첨부는 부가물이라
 *     여기서 던지면 안 된다 — 호출부도 try 로 감싼다.
 */

const text = (v) => String(v ?? '').trim();
/** 트랙 구분 — 빈 줄 5개 + 수평선 + 빈 줄 5개. */
const SEP = `${'\n'.repeat(6)}---${'\n'.repeat(6)}`;
const first = (...vals) => vals.find((v) => text(v)) ?? '';
const arr = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : (text(v) ? [text(v)] : []));

/** Markdown 문법 문자를 리터럴로. 외부 텍스트가 문서 구조를 열지 못하게 한다. */
export function md(v) {
  return text(v)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]{}#+|>~])/g, '\\$1')
    .replace(/^(\s*)-/gm, '$1\\-');
}

/** 여러 줄을 한 줄로 — 제목·표 칸처럼 줄바꿈이 구조를 깨는 자리. */
const inline = (v) => md(v).replace(/\s*\n\s*/g, ' ');

/** 문단 보존 — 번역 본문은 여러 문단일 수 있다. */
const para = (v) => text(v).split(/\n+/).map((x) => x.trim()).filter(Boolean).map(md).join('\n\n');

/** 영문 원문 + 한글 번역을 나란히. 한쪽만 있으면 그것만. */
function enko(en, ko) {
  const parts = [];
  if (text(ko)) parts.push(para(ko));
  if (text(en) && text(en) !== text(ko)) parts.push(`> ${md(en).replace(/\n/g, '\n> ')}`);
  return parts.join('\n\n');
}

function block(heading, body) {
  const b = text(body);
  return b ? `## ${heading}\n\n${b}\n` : '';
}

function bullets(en = [], ko = []) {
  const list = arr(en);
  const kos = arr(ko);
  if (!list.length && !kos.length) return '';
  // 한글이 있으면 한글을 앞세우고 원문을 인용으로 — 카드와 같은 순서다.
  const rows = (list.length ? list : kos).map((item, i) => {
    const k = list.length ? kos[i] : '';
    return k ? `- ${inline(k)}\n  > ${inline(item)}` : `- ${inline(item)}`;
  });
  return rows.join('\n');
}

// ── ① 논문 (PICO) ────────────────────────────────────────────────────────────
function paperSection(p) {
  const paper = p.paper ?? {};
  const title = first(p.title_ko, paper.title, p.title);
  const titleEn = text(paper.title);
  const pmid = text(paper.pmid);
  const doi = text(paper.doi);
  const picoEn = p.pico ?? {};
  const picoKo = p.pico_ko ?? {};

  const metaBits = [
    text(paper.journal),
    pmid ? `PMID ${pmid}` : '',
    Number.isFinite(p.clinicalApplicabilityScore) ? `Opus 종합 ${p.clinicalApplicabilityScore}점` : '',
    text(p.evidenceSource),
  ].filter(Boolean);

  const picoRows = [['P', 'population'], ['I', 'intervention'], ['C', 'comparison'], ['O', 'outcome']]
    .map(([k, f]) => {
      const v = first(picoKo[f], picoEn[f]);
      return v ? `- **${k}** — ${inline(v)}` : '';
    }).filter(Boolean).join('\n');

  const glossary = (p.statGlossary ?? [])
    .map((g) => (text(g?.term) ? `- **${inline(g.term)}** — ${inline(g.explanation_ko ?? g.explanation)}` : ''))
    .filter(Boolean).join('\n');

  const sources = (p.sources ?? [])
    .map((s) => (text(s?.url) ? `- [${inline(s.label || s.url)}](${text(s.url)})` : ''))
    .filter(Boolean).join('\n');

  const links = [
    pmid ? `[PubMed ${pmid}](https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/)` : '',
    doi ? `[DOI](https://doi.org/${encodeURIComponent(doi)})` : '',
  ].filter(Boolean).join(' · ');

  return [
    `# 📄 논문\n\n## ${inline(title)}`,
    titleEn && titleEn !== text(title) ? `\n*${inline(titleEn)}*` : '',
    metaBits.length ? `\n${inline(metaBits.join(' · '))}\n` : '',
    block('WHY IT MATTERS', enko(p.clinicalQuestion, p.clinicalQuestion_ko)),
    block('PICO', picoRows),
    block('2차 결과', bullets(p.secondaryOutcomes, p.secondaryOutcomes_ko)),
    block('통계 용어', glossary),
    block('제한점', enko(p.limitations, p.limitations_ko)),
    block('임상 결론', enko(p.clinicalTakeaway, p.clinicalTakeaway_ko)),
    block('Practice Change', bullets(p.practiceChange, p.practiceChange_ko)),
    block('본문 확보·웹 보강 출처', sources),
    links ? `${links}\n` : '',
  ].filter(Boolean).join('\n');
}

// ── ②③ 가이드라인 / 리뷰 카드 ────────────────────────────────────────────────
const COVERAGE_NOTE = {
  'full-text': '원문 전문을 확보해 옮겼습니다.',
  'web-augmented': '원문 전문을 직접 받지 못해 웹에서 본문을 확보해 옮겼습니다.',
  'abstract-only': '원문 전문을 확보하지 못해 초록 범위만 옮겼습니다 — 아래 원문 링크에서 확인하세요.',
};

function cardSection(g, { fallbackHeading } = {}) {
  const isReview = g.type === 'review';
  const isRef = g.type === 'reference';
  const paper = g.paper ?? {};
  const title = first(g.title_ko, paper.title, g.title);
  const titleEn = text(paper.title);
  const pmid = text(paper.pmid);
  const srcUrl = text(paper.sourceUrl);
  const doi = text(paper.doi);

  const heading = fallbackHeading
    ?? (isReview ? '📰 리뷰 아티클' : (isRef ? '🔖 참고자료' : '📋 가이드라인'));

  const metaBits = [text(g.org), text(paper.journal), text(g.version), pmid ? `PMID ${pmid}` : '']
    .filter(Boolean);

  const changes = (g.keyChanges ?? []).map((c) => {
    const body = enko(c?.detail, c?.detail_ko);
    if (!body) return '';
    return text(c?.topic) ? `**${inline(c.topic)}**\n\n${body}` : body;
  }).filter(Boolean).join('\n\n');

  const sections = (g.sections ?? []).map((sec) => {
    const body = para(sec?.body_ko);
    if (!body) return '';
    return text(sec?.heading_ko) ? `### ${inline(sec.heading_ko)}\n\n${body}` : body;
  }).filter(Boolean).join('\n\n');

  const coverage = isReview ? (COVERAGE_NOTE[g.coverage] ?? '') : '';

  const links = [
    pmid ? `[PubMed ${pmid}](https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/)` : '',
    srcUrl ? `[원문 (발행기관)](${srcUrl})` : '',
    doi ? `[DOI](https://doi.org/${encodeURIComponent(doi)})` : '',
  ].filter(Boolean).join(' · ');

  return [
    `# ${heading}\n\n## ${inline(title)}`,
    titleEn && titleEn !== text(title) ? `\n*${inline(titleEn)}*` : '',
    metaBits.length ? `\n${inline(metaBits.join(' · '))}\n` : '',
    coverage ? `\n> ${md(coverage)}\n` : '',
    // 리뷰는 요약 축이 없다 — 도구 스키마에서 아예 뺐다(PR #125). 있으면 구판 카드다.
    block(isRef ? '핵심 내용' : '핵심 권고', bullets(g.summary, g.summary_ko)),
    block('본문 번역', sections),
    block(isRef ? '출처 성격' : '이전 판 대비 변경점', changes),
    block(isReview ? '임상 적용' : (isRef ? '어떻게 쓰나' : '임상 임팩트'),
      enko(g.practiceImpact, g.practiceImpact_ko)),
    links ? `${links}\n` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 그날의 md 한 장.
 * @param {string} dateStr  KST YYYY-MM-DD
 * @param {object[]} papers   논문 트랙 분석 결과(보통 1편)
 * @param {object|null} guideline  가이드라인 카드
 * @param {object|null} review     리뷰 발행 항목(`.card` 에 분석이 들어 있다)
 * @param {string} pagesUrl
 */
export function buildDailyDigest({ dateStr, papers = [], guideline = null, review = null, pagesUrl = '' } = {}) {
  const url = pagesUrl || 'https://njell85-spec.github.io/trend-review/';
  // 리뷰는 큐 항목 안에 카드가 들어 있다(`_stageReview` 가 `{...picked, card}` 로 저장).
  const reviewCard = review?.card ?? (review?.sections || review?.type === 'review' ? review : null);

  const bodies = [
    ...papers.filter(Boolean).map(paperSection),
    guideline ? cardSection(guideline) : '',
    reviewCard ? cardSection({ ...reviewCard, type: 'review' }) : '',
  ].filter((s) => text(s));

  const head = [
    `# Trend Review — ${md(dateStr)}`,
    '',
    bodies.length
      ? `그날 발행한 분석 ${bodies.length}건 · 화면과 같은 내용입니다.`
      : '이 날은 발행된 분석이 없습니다.',
    '',
    `📊 ${url}`,
  ].join('\n');

  // ★ 트랙 사이는 **5줄 띄운다** (PeterJ 확정 2026-08-18 — 가독성).
  //   *"논문 가이드라인 리뷰 구분을 5줄 정도 띄워서 가독성 확보."*
  //   텔레그램 md 미리보기는 좁은 폭이라 구분선 하나만으로는 어디서 트랙이 바뀌는지
  //   눈에 안 들어온다. 빈 줄은 Markdown 렌더러가 접지만, 원문으로 읽을 때도
  //   미리보기로 읽을 때도 `---` 앞뒤 여백이 실제로 벌어진다.
  return `${head}\n\n${SEP}${bodies.join(SEP)}\n`;
}

/** 첨부 파일명. 날짜 형식이 아니면 안전한 기본값으로 — 파일명에 외부 문자열을 안 태운다. */
export function dailyDigestFilename(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(dateStr))
    ? `trend-review-${text(dateStr)}.md`
    : 'trend-review-daily.md';
}
