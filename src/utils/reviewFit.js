/**
 * 리뷰 아티클(트랙3) **셀렉** — 저수지에서 PeterJ 가 복습으로 읽을 값이 있는 것을 고른다.
 * PeterJ 확정 2026-08-17(3-1): *"트랙3 397건에도 LLM 셀렉 걸어라."*
 *
 * ★★ 왜 `guidelineFit.js` 의 프롬프트를 재사용하지 않나 — 재사용하면 **전건 격리된다.**
 *   그 프롬프트의 점수 기준은 "권위 있는 최신 **진료지침**인가" 이고, 마지막 줄이
 *   `0~2 … 지침이 아니라 지침을 연구한 논문` 이다. 리뷰 아티클은 **정의상 전부**
 *   지침이 아니다. 그대로 돌리면 LLM 이 성실하게 0~2 점을 주고 397건이 다 내려간다.
 *   더 나쁜 것은 그 결과가 "셀렉이 잘 걸렀다" 로 읽힌다는 점이다.
 *
 * ★ 트랙마다 **고르는 기준이 다르다**(PeterJ 확정: 세 트랙은 분석도 셀렉도 다르다).
 *   가이드라인은 *권위*를 재고, 리뷰는 *복습 가치*를 잰다. 같은 문서가 한쪽에서 10점이고
 *   다른 쪽에서 2점인 것이 정상이다.
 *
 * ★ 배치·판정 적용·격리 정책은 `guidelineFit.js` 의 순수 함수를 **그대로 쓴다**
 *   (`unscoredItems` · `fitBatches` · `applyFitVerdicts`). 거기 담긴 것은 트랙과 무관한
 *   규칙이다 — 전역 index 로 판정을 받는 계약, 빠뜨린 판정은 무판정, 격리는 `needsReview`.
 *   그것을 복사하면 같은 함정을 두 곳에서 따로 밟는다.
 */

/** 리뷰 큐의 규칙 점수 필드는 `score` 다(가이드라인은 `priority`). */
export function reviewPriorityOf(item) {
  return Number(item?.score) || 0;
}

/** LLM 에 넘길 최소 정보. 리뷰 큐는 초록을 안 들고 있어 제목·저널·주제가 전부다. */
export function toReviewFitInput(item, index) {
  return {
    index,
    title: String(item?.title ?? '').slice(0, 300),
    journal: String(item?.journal ?? '').slice(0, 120),
    topic: item?.topic ?? null,
    ruleScore: Number(item?.score) || 0,
  };
}

export const REVIEW_FIT_TOOL = {
  name: 'review_fit',
  description: '각 리뷰 아티클이 이 독자의 복습 자료로 값이 있는지 0~10 으로 매기고 채택 여부를 판정한다.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '입력 목록의 index 를 그대로 돌려준다' },
            fit: { type: 'integer', description: '0~10. 이 독자의 복습 가치' },
            keep: { type: 'boolean', description: '복습 목록에 올릴 가치가 있는가' },
            reason: { type: 'string', description: '한국어 한 줄(40자 내외). 판단 근거' },
          },
          required: ['index', 'fit', 'keep', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

export function buildReviewFitPrompt(batch, { topicLabels = [] } = {}) {
  const topics = topicLabels.length ? topicLabels.join(' · ') : '응급의학 · 중환자의학 전반';
  return [
    '당신은 임상 문헌 큐레이터다. 아래 독자의 **복습용 리뷰 아티클**을 추린다.',
    '',
    '## 독자',
    '- 성인 **응급의학·중환자의학** 임상의. 응급실과 중환자실에서 직접 환자를 본다.',
    `- 관심 영역: ${topics}`,
    '- 이 목록의 용도는 **복습**이다. 새 권고를 찾는 것이 아니라, 이미 아는 주제를',
    '  한 편으로 정리해 다시 훑는 것이다. 종설 전문을 한국어로 번역해 읽는다.',
    '',
    '## ★ 이것은 진료지침 심사가 아니다',
    '- 후보는 **전부 리뷰 아티클이다.** "지침이 아니다" 는 감점 사유가 **아니다.**',
    '- 권고 등급·근거 수준이 없어도 좋다. 서술형 종설이 오히려 복습에 맞는다.',
    '- 학회 지침이 아니라는 이유로 점수를 깎지 마라 — 그것으로 깎으면 전건이 0점이 된다.',
    '',
    '## 점수 기준 (fit 0~10)',
    '- 9~10 성인 응급·중환자 핵심 주제를 한 편으로 정리한 종설',
    '       (소생·패혈증·기도·쇼크·호흡부전·중증외상·중독·부정맥 등)',
    '- 6~8  관심 영역에 닿는 임상 종설. 주제가 좁아도 응급실·중환자실에서 만난다',
    '- 3~5  인접 분야이거나 복습 가치가 제한적',
    '       (소아 전용 · 외래 만성질환 관리 · 특정국 제도 · 수술 술기 위주)',
    '- 0~2  이 독자와 무관하거나 복습용으로 못 쓴다',
    '       (기초과학·분자기전 위주 · 다른 과 전용 · 연구방법론 · 학회 행정문서 ·',
    '        체계적 문헌고찰/메타분석처럼 통계 결과가 본체인 것)',
    '',
    '## 판정 규칙',
    '- `keep` 은 복습 목록에 올릴 가치가 있는가다. 애매하면 **true 로 두어라** —',
    '  버려진 것은 사람이 다시 못 보지만, 남은 것은 화면에서 한 번에 지울 수 있다.',
    '- 초록이 없다. **제목·저널로 판단하고 그렇다고 reason 에 적어라.**',
    '  모르겠다고 낮은 점수를 주지 마라 — 정보 부족과 부적합은 다르다.',
    '- **입력의 모든 index 에 대해 정확히 하나씩** 판정을 내라. 빠뜨리지 마라.',
    '',
    '## 후보',
    '```json',
    JSON.stringify(batch, null, 1),
    '```',
  ].join('\n');
}
