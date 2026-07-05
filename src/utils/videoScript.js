/**
 * videoScript — 영상 대본 생성의 순수부 (프롬프트·툴 스키마·구조 검증).
 * LLM 호출 자체는 VideoAgent가 LLMClient.callWithTool로 수행한다.
 * 핵심 규칙: 수치는 리포트 값 그대로 — "절대 새로운 수치를 만들지 마라" (REPORT_SPEC §4-F,
 * spec-lint가 이 문구의 존재를 감시한다).
 */
const slideSchema = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          useChart: { type: 'boolean' },
        },
        required: ['heading', 'bullets', 'useChart'],
      },
    },
    narration: { type: 'array', items: { type: 'string' } },
  },
  required: ['slides', 'narration'],
};
const langPair = { type: 'object', properties: { ko: slideSchema, en: slideSchema }, required: ['ko', 'en'] };

export const VIDEO_SCRIPT_TOOL = {
  name: 'submit_video_scripts',
  description: 'Daily paper-review video scripts (midform + short, ko + en).',
  input_schema: {
    type: 'object',
    properties: {
      midform: langPair,
      short: langPair,
      chartData: {
        type: ['object', 'null'],
        properties: {
          title: { type: 'string' },
          title_ko: { type: 'string' },
          unit: { type: 'string' },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'number' },
                ci: { type: ['array', 'null'], items: { type: 'number' } },
              },
              required: ['label', 'value'],
            },
          },
          source: { type: 'string' },
        },
      },
    },
    required: ['midform', 'short', 'chartData'],
  },
};

export function buildScriptMessages(a) {
  const p = a.paper ?? {};
  const facts = JSON.stringify({
    title: p.title,
    title_ko: a.title_ko,
    journal: p.journal,
    pmid: p.pmid,
    clinicalQuestion_ko: a.clinicalQuestion_ko,
    pico: a.pico,
    pico_ko: a.pico_ko,
    keyFindings: a.keyFindings,
    keyFindings_ko: a.keyFindings_ko,
    evidenceLevel: a.evidenceLevel,
  });
  return [{
    role: 'user',
    content: `너는 응급의학·중환자의학 논문 리뷰 영상의 대본 작가다. 아래 검증된 리포트 데이터만으로
중간폼(가로, 슬라이드 6~8장, 내레이션 총 550~750단어)과 숏폼(세로, 정확히 3장: 훅→핵심 결과→임상 한 줄,
내레이션 총 110~130단어 = 발화 약 50초)의 한국어판·영어판 대본을 만들어라.

규칙:
1. **절대 새로운 수치를 만들지 마라** — 아래 데이터에 명시된 수치만 사용한다. 수치가 없으면 정성적으로 서술한다.
2. 한국어판: 자연스러운 존댓말 내레이션. 의학용어·약어·트라이얼명은 영어를 유지해도 된다.
3. slides[i]와 narration[i]는 1:1 대응. 핵심 결과 슬라이드 1곳에만 useChart=true (chartData를 만들 수 없으면 모두 false).
4. chartData: keyFindings에 두 군 비교 수치(예: 사망률 A% vs B%)가 명시돼 있을 때만 채운다.
   불명확하면 null — 추정 금지. source는 "PMID ${p.pmid}".
5. 마지막 슬라이드 bullets에 "PubMed: https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/" 출처를 포함하라.
6. 슬라이드 bullets는 장당 2~4개, 각 12단어 이내로 간결하게.

리포트 데이터:
${facts}

submit_video_scripts 툴로 제출하라.`,
  }];
}

export function validateScripts(raw) {
  for (const form of ['midform', 'short']) {
    for (const lang of ['ko', 'en']) {
      const s = raw?.[form]?.[lang];
      if (!s) throw new Error(`missing ${form}.${lang}`);
      const n = s.slides?.length ?? 0;
      if (form === 'short' && n !== 3) throw new Error(`short.${lang}: slides must be 3, got ${n}`);
      if (form === 'midform' && (n < 5 || n > 8)) throw new Error(`midform.${lang}: slides must be 5~8, got ${n}`);
      if (s.narration?.length !== n) throw new Error(`${form}.${lang}: narration length must match slides (${s.narration?.length} vs ${n})`);
    }
  }
  return { midform: raw.midform, short: raw.short, chartData: raw.chartData ?? null };
}
