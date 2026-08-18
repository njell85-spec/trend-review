import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ★★ 2026-08-18 실측 — **웹검색이 한 번도 실행된 적이 없었다.**
 *
 * Actions run 32092960497 (리뷰 트랙, 첫 시도·에스컬레이션 둘 다 동일):
 * ```
 * {"subtype":"error_max_turns","num_turns":13,"stop_reason":"tool_use",
 *  "server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}}
 * ```
 * `web_search_requests: 0` — 도구가 한 번도 안 돌았다. 모델은 쓰려 했고
 * (`stop_reason: tool_use`) 그 상태로 턴 한도를 다 써서 CLI 가 exit 1 로 죽었으며,
 * 호출부는 그 예외를 잡아 **text-only 로 조용히 폴백**했다.
 * 겉보기엔 "카드가 나왔다" 인데 내용은 늘 초록 범위였다(1,119자).
 *
 * 원인 둘:
 *   ① `--allowedTools` 를 **공백으로 나눠** 넘겨 `WebFetch` 가 위치 인자로 흘렀다.
 *   ② 12턴은 웹 리서치에 모자란다(실측 13턴에서 잘림).
 *
 * 이 파일은 **인자 조립 계약**을 잠근다. 프롬프트를 아무리 강하게 써도 이 한 줄이
 * 틀리면 웹은 안 돈다 — 이 저장소가 반복해서 낸 "맞물리는 자리" 결함이다.
 */

const SRC = readFileSync(new URL('../src/utils/LLMClient.js', import.meta.url), 'utf8');

test('★★ --allowedTools 는 값 하나로 넘긴다 (공백으로 쪼개면 WebFetch 가 프롬프트 자리로 샌다)', () => {
  assert.match(SRC, /'--allowedTools',\s*'WebSearch,WebFetch'/,
    '--allowedTools 가 쉼표 하나의 인자가 아니다 — 공백 분리는 위치 인자로 샌다');
  assert.ok(!/'--allowedTools',\s*'WebSearch',\s*'WebFetch'/.test(SRC),
    '공백 분리 형태가 되살아났다 — 웹툴이 다시 안 돈다');
});

test('★ 웹 리서치 기본 턴 한도가 12보다 크다 (실측 13턴에서 잘렸다)', () => {
  const m = SRC.match(/LLM_WEB_MAX_TURNS \|\| '(\d+)'/);
  assert.ok(m, 'LLM_WEB_MAX_TURNS 기본값을 못 찾았다 — 개명했으면 이 검사도 갱신하라');
  assert.ok(Number(m[1]) >= 20,
    `웹 턴 한도 기본이 ${m[1]} — 검색 3~5회 + 페이지 열기가 그 안에 안 끝난다`);
});

test('★ 웹 인자는 webSearch 분기 안에서만 붙는다 (데일리 PICO·rerank 무영향)', () => {
  // ★ 주석을 걷고 본다. 이 자리의 주석은 결함 경위를 적느라 인자 이름을 그대로
  //   인용하고 있어서, 원문 그대로 검사하면 주석 때문에 거짓 적색이 난다.
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  const i = code.indexOf('if (webSearch) {');
  assert.ok(i > 0, 'webSearch 분기를 못 찾았다');
  const before = code.slice(0, i);
  assert.ok(!before.includes('--allowedTools'),
    '웹 인자가 분기 밖에서 붙는다 — 논문 PICO·rerank 호출까지 바뀐다');
  assert.ok(!before.includes('--max-turns'), '턴 인자가 분기 밖에서 붙는다');
});

// ── 실패가 조용히 숨지 않는가 ────────────────────────────────────────────────
test('★★ 웹 실패 폴백이 진단(웹툴 호출 횟수·중단 사유)을 남긴다', () => {
  const agent = readFileSync(new URL('../src/agents/GuidelineAnalyzerAgent.js', import.meta.url), 'utf8');
  for (const key of ['web_search_requests', 'web_fetch_requests', 'num_turns', 'subtype']) {
    assert.ok(agent.includes(key),
      `폴백 로그가 ${key} 를 안 남긴다 — 다음에도 "왜 웹이 안 돌았나" 를 로그에서 못 찾는다`);
  }
  assert.match(agent, /web-search call failed/, '폴백 경고 자체가 사라졌다');
});
