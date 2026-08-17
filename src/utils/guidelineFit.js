/**
 * 가이드라인 **셀렉** — 풀에서 PeterJ 에게 맞는 것을 고른다 (PeterJ 지시 2026-08-17:
 * *"셀렉은 LLM 통해서 나한테 맞는거 리스트를 정하고"*).
 *
 * ★ 규칙 점수(`GuidelineScorer`)와 무엇이 다른가
 *   규칙 점수는 **기관 권위·주제어 매칭·최신성**을 잰다 — "이것이 권위 있는 최신 지침인가".
 *   그것으로는 못 가르는 것이 있다: *소아 전용인가* · *한 나라 보험제도 얘기인가* ·
 *   *응급실·중환자실에서 실제로 손에 잡히는 내용인가*. 2년치를 미리 풀링하면 그런 것이
 *   수백 건 섞여 들어온다. 그 판단만 LLM 이 한다.
 *
 * ★ 이 파일은 **순수 함수만** 둔다. LLM 호출은 `src/agents/GuidelineFitAgent.js`,
 *   배선은 오케스트레이터. 판정 로직이 네트워크와 섞이면 테스트가 스텁 지옥이 된다.
 */

export const FIT_SCHEMA_VERSION = 1;

/**
 * 큐에서 아직 LLM 판정을 안 받은 것. 설정이 바뀌면 다시 받아야 하므로 버전도 본다.
 *
 * ★ **PeterJ 수동 승인은 판정에서 뺀다** (확정 ⑤-A 와 같은 원칙: 수동 승인은 자동
 *   필터를 우회한다). 실제로 이 규칙 없이 붙였더니 계약 테스트가 적색이 됐다 —
 *   PeterJ 가 직접 넣은 문서를 LLM 이 "실무와 무관" 으로 보고 격리해서 그날 발행이
 *   통째로 사라졌다. 사람이 이미 고른 것을 기계가 다시 심사하면 안 된다.
 */
export function unscoredItems(items, { limit = Infinity, version = FIT_SCHEMA_VERSION } = {}) {
  return (items ?? [])
    .filter((x) => x?.manualApproved !== true)
    .filter((x) => x?.llmFit?.version !== version)
    // 규칙 점수가 높은 것부터 판정받는다 — 예산이 모자라 잘리는 날에도
    // **먼저 나갈 후보부터** 판정이 붙어 있어야 한다.
    .sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0))
    .slice(0, limit);
}

/** LLM 에 넘길 최소 정보. 초록은 자른다 — 판정에 필요한 건 무엇에 관한 문서인가다. */
export function toFitInput(item, index, { abstractChars = 500 } = {}) {
  return {
    index,
    title: String(item?.title ?? '').slice(0, 300),
    journal: String(item?.journal ?? '').slice(0, 120),
    organization: item?.organizationId ?? null,
    documentType: item?.documentType ?? null,
    pubDate: item?.pubDate ?? null,
    abstract: String(item?.abstract ?? '').slice(0, abstractChars),
  };
}

export function fitBatches(items, size = 20) {
  if (!Number.isInteger(size) || size < 1) throw new TypeError('batch size must be a positive integer');
  const out = [];
  for (let i = 0; i < (items?.length ?? 0); i += size) out.push(items.slice(i, i + size));
  return out;
}

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
}

/**
 * 판정을 항목에 붙인다.
 *
 * ★ 상태(`status`)를 여기서 **rejected 로 내리지 않는다.** `mergeCandidates` 는 rejected 를
 *   영구 배제로 다루므로, LLM 이 한 번 잘못 자르면 그 지침은 다시는 안 들어온다.
 *   맞지 않는다고 본 것은 `needsReview` 로 **격리**한다 — 화면의 ▶ 로 되살릴 수 있고,
 *   설정이 바뀌면 다음 판정에서 복구된다. 되돌릴 수 있는 쪽으로 틀린다.
 */
export function applyFitVerdicts(items, verdicts, { now = new Date().toISOString(), threshold = 6 } = {}) {
  const byIndex = new Map((verdicts ?? [])
    .filter((v) => Number.isInteger(v?.index))
    .map((v) => [v.index, v]));
  let scored = 0;
  const next = (items ?? []).map((item, index) => {
    const verdict = byIndex.get(index);
    const score = clampScore(verdict?.fit);
    // 판정이 없거나 점수가 숫자가 아니면 **손대지 않는다.** 빈 판정을 0점으로 읽으면
    // LLM 이 한 건을 빠뜨린 날 그 지침이 조용히 격리된다.
    if (!verdict || score === null) return item;
    scored += 1;
    const keep = verdict.keep === false ? false : score >= threshold;
    const llmFit = {
      version: FIT_SCHEMA_VERSION, score, keep,
      reason: String(verdict.reason ?? '').slice(0, 200), at: now,
    };
    if (item.status === 'rejected') return { ...item, llmFit };
    return { ...item, llmFit, status: keep ? 'queued' : 'needsReview' };
  });
  return { items: next, scored };
}

export const FIT_TOOL = {
  name: 'guideline_fit',
  description: '각 문서가 이 독자의 실무에 맞는지 0~10 으로 매기고 채택 여부를 판정한다.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '입력 목록의 index 를 그대로 돌려준다' },
            fit: { type: 'integer', description: '0~10. 이 독자의 실무 적합도' },
            keep: { type: 'boolean', description: '예고 리스트에 올릴 가치가 있는가' },
            reason: { type: 'string', description: '한국어 한 줄(40자 내외). 판단 근거' },
          },
          required: ['index', 'fit', 'keep', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

export function buildFitPrompt(batch, { topicLabels = [] } = {}) {
  const topics = topicLabels.length ? topicLabels.join(' · ') : '응급의학 · 중환자의학 전반';
  return [
    '당신은 임상 문헌 큐레이터다. 아래 독자를 위해 진료지침 후보를 추린다.',
    '',
    '## 독자',
    '- 성인 **응급의학·중환자의학** 임상의. 응급실과 중환자실에서 직접 환자를 본다.',
    `- 관심 영역: ${topics}`,
    '- 원하는 것: **오늘 당장 침상에서 판단이 바뀔 수 있는** 진료지침·권고.',
    '',
    '## 점수 기준 (fit 0~10)',
    '- 9~10 국제 학회의 성인 응급·중환자 핵심 주제 지침 (소생·패혈증·기도·쇼크·중증외상 등)',
    '- 6~8  관심 영역에 닿는 실무 지침. 일부 범위가 좁아도 응급/중환자에서 쓴다',
    '- 3~5  인접 분야이거나 실무 적용이 제한적 (소아 전용 · 외래 만성질환 · 특정국 제도 위주)',
    '- 0~2  이 독자와 무관 (수의·치과·미용, 지침이 아니라 지침을 연구한 논문, 학회 행정문서)',
    '',
    '## 판정 규칙',
    '- `keep` 은 예고 리스트에 올릴 가치가 있는가다. 애매하면 **true 로 두어라** —',
    '  버려진 것은 사람이 다시 못 보지만, 남은 것은 화면에서 한 번에 지울 수 있다.',
    '- 초록이 없거나 정보가 모자라면 **제목만으로 판단하고 그렇다고 reason 에 적어라.**',
    '  모르겠다고 낮은 점수를 주지 마라 — 정보 부족과 부적합은 다르다.',
    '- **입력의 모든 index 에 대해 정확히 하나씩** 판정을 내라. 빠뜨리지 마라.',
    '',
    '## 후보',
    '```json',
    JSON.stringify(batch, null, 1),
    '```',
  ].join('\n');
}
