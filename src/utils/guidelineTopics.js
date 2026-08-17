/**
 * 가이드라인 **검색축** — PeterJ 관심주제를 PubMed 쿼리로 만든다.
 *
 * ★ 왜 새로 만드나 (2026-08-17 실측)
 *   `config/guideline-topics.json` 은 "가이드라인 검색 전용 주제어" 라고 자기 설명까지
 *   달고 188개 용어를 갖춘 채 **아무도 안 읽는 죽은 설정**이었다 — 저장소 전체에서
 *   참조처가 자기 테스트뿐이었다. 그동안 프로덕션 수집은 EM/CCM MeSH 8개에만 묶여
 *   있었고, 30일 창에서 **8건**을 건졌다. 데일리는 하루 한 편(=월 30편)을 먹는다.
 *   시장조사는 같은 관심주제 축으로 **연 2,888편**을 셌다. 물건이 없던 게 아니라
 *   **캘 그물을 안 걸어 놨다.**
 *
 * ★ 왜 주제 그룹마다 쿼리를 따로 내나
 *   ① URL 길이 — 188개 용어를 Title·MeSH 두 축으로 한 줄에 이으면 10KB 를 넘어
 *     esearch GET 이 깨진다. 그룹 단위면 최대 ~2.6KB 다.
 *   ② **어느 주제가 마르는지 보인다.** 한 덩어리로 세면 총계만 남고, "심정지는 넉넉한데
 *     중독은 반년째 0" 같은 것이 안 보인다. manifest 에 그룹별로 남는다.
 *
 * ★ 검색 필드는 `Title` 이다(설정의 `search.field`). 설정 자신의 근거:
 *   Title/Abstract 로 재니 2,894편 중 1,097편(38%)이 **초록에서만** 걸렸다 —
 *   다른 주제 지침이 초록에서 lactate 를 한 번 언급한 것들이다. 지침은 주제를 제목에 쓴다.
 */
import { readFileSync } from 'node:fs';

const DEFAULT_CONFIG = new URL('../../config/guideline-topics.json', import.meta.url);

// ★ "이 문서가 지침 형식인가" 축. 주제축과 AND 로 묶어야 주제만 맞는 **일반 논문**이
//   딸려 오지 않는다. `scripts/guideline-census.mjs` 가 시장 규모를 잴 때 쓴 것과
//   **같은 식이어야** "시장은 2,888편인데 우리는 8편" 이 같은 자를 쓴 비교가 된다.
export const GUIDELINE_FORM_TERM =
  '(("practice guideline"[Publication Type] OR "guideline"[Publication Type]) '
  + 'OR (guideline[Title] OR guidelines[Title] OR "consensus statement"[Title] '
  + 'OR "scientific statement"[Title] OR "position statement"[Title] '
  + 'OR "focused update"[Title] OR recommendations[Title]))';

function fail(message) {
  throw new Error(`가이드라인 주제 설정 오류: ${message}`);
}

export function validateGuidelineTopics(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) fail('설정은 객체여야 합니다.');
  if (cfg.schemaVersion !== 1) fail('schemaVersion은 1이어야 합니다.');
  if (cfg.search?.field !== 'Title') fail("search.field 는 'Title' 이어야 합니다.");
  const groups = Object.entries(cfg.groups ?? {});
  if (!groups.length) fail('groups 가 비었습니다.');
  for (const [id, group] of groups) {
    if (!group?.label) fail(`${id}: label 이 없습니다.`);
    if (!Array.isArray(group.terms) || !group.terms.length) fail(`${id}: terms 가 비었습니다.`);
    for (const term of group.terms) {
      if (typeof term !== 'string' || term !== term.trim() || term.length < 3) {
        fail(`${id}: 주제어가 이상합니다 — ${JSON.stringify(term)}`);
      }
      // ★ 따옴표가 섞이면 PubMed 구문이 깨진다. 조용히 이스케이프하지 않고 막는다 —
      //   깨진 쿼리는 0건을 돌려주고, 0건은 "그 주제 지침이 없다" 와 구분이 안 된다.
      if (/["[\]()]/.test(term)) fail(`${id}: 주제어에 따옴표·괄호를 쓸 수 없습니다 — "${term}"`);
    }
  }
  return cfg;
}

export function loadGuidelineTopics(pathOrObject = DEFAULT_CONFIG) {
  const raw = typeof pathOrObject === 'object' && !(pathOrObject instanceof URL)
    ? pathOrObject
    : JSON.parse(readFileSync(pathOrObject, 'utf8'));
  validateGuidelineTopics(raw);
  return structuredClone(raw);
}

/**
 * 주제어 하나를 PubMed 절로 바꾼다.
 * ★ 끝의 `*` 는 **절단 검색**이라 따옴표 밖에 둔다 — `"antibiotic steward*"` 처럼
 *   따옴표 안에 넣으면 PubMed 가 별표를 글자로 읽어 0건이 된다.
 *   설정에서 접두 stub 을 쓸 때 `*` 를 명시하게 한 이유가 이것이다.
 */
export function termClause(term, field) {
  const trimmed = String(term).trim();
  return trimmed.endsWith('*')
    ? `${trimmed.slice(0, -1)}*[${field}]`
    : `"${trimmed}"[${field}]`;
}

function axisFor(terms, cfg) {
  const clauses = terms.map((t) => termClause(t, 'Title'));
  if (cfg.search?.alsoSearchMeshTerms) clauses.push(...terms.map((t) => termClause(t, 'MeSH Terms')));
  return `(${clauses.join(' OR ')})`;
}

function excludeClause(cfg) {
  const terms = cfg.excludeTitle?.terms ?? [];
  if (!terms.length) return '';
  return ` NOT (${terms.map((t) => termClause(t, 'Title')).join(' OR ')})`;
}

/**
 * 주제 그룹마다 esearch 스펙 하나. `collectGuidelineCandidates` 의 `specs` 에 얹는다.
 * discovery 는 전부 `pubmed-topic` — 분류기·스코어러가 발견 경로로 신뢰도를 매기는데,
 * 주제축은 PT 축만큼의 공식성 증거가 아니므로 확장(제목) 축과 같은 급으로 둔다.
 */
export function topicQuerySpecs(cfg = loadGuidelineTopics()) {
  validateGuidelineTopics(cfg);
  const exclude = excludeClause(cfg);
  return Object.entries(cfg.groups).map(([id, group]) => ({
    id: `pubmed-topic:${id}`,
    discovery: 'pubmed-topic',
    label: group.label,
    term: `${axisFor(group.terms, cfg)} AND ${GUIDELINE_FORM_TERM}${exclude}`,
  }));
}
