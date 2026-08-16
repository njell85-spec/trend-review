import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const text = (value) => String(value ?? '').trim();
const first = (...values) => values.find((value) => text(value)) ?? '';

// YAML의 JSON 호환 인용 표기를 쓰면 외부 문자열의 줄바꿈·구분자가 메타데이터 경계를 바꿀 수 없다.
const yamlScalar = (value) => JSON.stringify(String(value ?? ''));

// 외부 텍스트가 제목·목록의 Markdown 구조를 새로 열지 못하도록 문법 문자를 리터럴로 만든다.
const markdownText = (value) => text(value)
  .replace(/\\/g, '\\\\')
  .replace(/([`*_[\]{}#+|>~-])/g, '\\$1');

const inlineMarkdown = (value) => markdownText(value).replace(/\s*\n\s*/g, ' ');

function valuesOf(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value) ? [text(value)] : [];
}

function section(label, value) {
  const values = valuesOf(value);
  if (!values.length) return '';
  const body = values.length === 1
    ? markdownText(values[0])
    : values.map((entry) => `- ${markdownText(entry).replace(/\n/g, '\n  ')}`).join('\n');
  return `## ${label}\n\n${body}\n`;
}

function digestFields(item = {}, analysis = {}) {
  const paper = analysis.paper ?? {};
  return {
    pmid: first(item.pmid, analysis.pmid, paper.pmid),
    journal: first(item.journal, analysis.journal, paper.journal),
    title: first(item.title_ko, analysis.title_ko, item.title, analysis.title, paper.title),
    summary: first(
      analysis.keyFindings_ko, analysis.summary_ko, analysis.keyFindings, analysis.summary,
      item.keyFindings_ko, item.summary_ko, item.keyFindings, item.summary,
    ),
    impact: first(
      analysis.clinicalImpact_ko, analysis.practiceImpact_ko, analysis.clinicalImpact, analysis.practiceImpact,
      item.clinicalImpact_ko, item.practiceImpact_ko, item.clinicalImpact, item.practiceImpact,
    ),
  };
}

/** 트랙별 분석을 Telegram 첨부와 장기 wiki 적재에 공통으로 쓸 Markdown으로 만든다. */
export function buildTrackDigest({ track, dateStr, item = {}, analysis = {} }) {
  const fields = digestFields(item, analysis);
  const frontMatter = [
    '---',
    `track: ${yamlScalar(track)}`,
    `date: ${yamlScalar(dateStr)}`,
    `pmid: ${yamlScalar(fields.pmid)}`,
    `journal: ${yamlScalar(fields.journal)}`,
    `title: ${yamlScalar(fields.title)}`,
    '---',
  ].join('\n');

  const sections = [
    fields.title ? `# ${inlineMarkdown(fields.title)}\n` : '',
    section('저널', fields.journal),
    section('PMID', fields.pmid),
    fields.pmid ? `## PubMed 링크\n\nhttps://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(fields.pmid)}/\n` : '',
    section('핵심 요약', fields.summary),
    section('임상 영향', fields.impact),
  ].filter(Boolean);

  return `${frontMatter}\n\n${sections.join('\n')}\n`;
}

function safeFilePart(value, label) {
  const part = text(value);
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) {
    throw new TypeError(`${label}은 파일명에 안전한 영문자·숫자·_·-만 포함해야 합니다.`);
  }
  return part;
}

export function trackDigestFilename({ track, dateStr, item = {}, analysis = {} }) {
  const pmid = digestFields(item, analysis).pmid;
  return `${safeFilePart(dateStr, 'dateStr')}-${safeFilePart(track, 'track')}-${safeFilePart(pmid, 'pmid')}.md`;
}

/** 같은 키는 덮어쓰고 다른 키는 보존해 날짜별 실행 결과를 계속 축적한다. */
export async function archiveTrackDigest(input, { outputDir = path.join('output', 'digests') } = {}) {
  const filename = trackDigestFilename(input);
  const content = buildTrackDigest(input);
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, content, 'utf8');
  return { filename, content, filePath };
}
