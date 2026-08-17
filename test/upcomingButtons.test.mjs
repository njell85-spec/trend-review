import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

// ★ 3페이지 재구성(2026-08-16)으로 `_renderUpcoming` 이 **트랙 하나씩** 그리도록 바뀌었다.
//   각 페이지가 자기 트랙 블록만 맨 위에 들어야 하기 때문이다(PeterJ 요구 ②).
//   기존 테스트는 트랙 배열을 한 번에 넘겼으므로, 여기서 접어서 같은 뜻으로 만든다.
const renderAll = (pub, html, { from, days, tracks = [], sequential = false }) =>
  tracks.reduce((acc, t) => pub._renderUpcoming(acc, {
    from, days, sequential,
    track: t.key, label: t.label, cadence: t.cadence, mode: t.mode, state: t.state,
  }), html);

// 버튼 동작 스크립트. 브라우저에서만 도는 코드라 유닛 테스트로는 **문자열을 검사**한다 —
// 위젯 테스트(onDemandWidget.test.mjs)가 쓰는 것과 같은 방식이다.
// 여기서 막고 싶은 것은 셋이다: ①PAT 를 화면·URL 에 흘리는 것 ②워크플로 이름 오타로
// 버튼이 조용히 아무것도 안 하는 것 ③시각을 분 단위로 커밋해 생활 패턴이 쌓이는 것.

const script = () => new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' })._upcomingScript({ owner: 'njell85-spec', repo: 'trend-review' });

test('★ 버튼 속성명과 스크립트가 읽는 키가 정확히 대응한다', () => {
  // 렌더는 `data-up-run` 을 쓰고 스크립트는 `dataset.upRun` 을 읽는다. 둘 중 한쪽만
  // 고치면 버튼이 **조용히 아무것도 안 한다** — 에러도 안 난다. 그래서 양쪽을 같이 본다.
  const s = script();
  const rendered = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), '<!-- ARCHIVE_START -->', {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1 }] } }],
  });
  const pairs = [['data-up-run', 'upRun'], ['data-up-drop', 'upDrop'],
    ['data-up-toggle', 'upToggle'], ['data-up-reset', 'upReset']];
  for (const [attr, key] of pairs) {
    assert.ok(rendered.includes(attr), `${attr} 속성이 화면에 없다`);
    assert.ok(s.includes(`dataset.${key}`), `${key} 를 읽는 코드가 없다`);
  }
});

test('★ PAT 는 localStorage 에서만 읽고 URL 에 싣지 않는다', () => {
  const s = script();
  assert.ok(s.includes("localStorage.getItem('tr_pat')"), '기존 토큰 저장소를 재사용해야 한다');
  assert.doesNotMatch(s, /[?&]token=|[?&]api_key=\+?t\b/, '토큰이 URL 로 나간다');
  assert.ok(s.includes('Authorization'), '헤더로 보내야 한다');
});

/**
 * ★ 이 검사가 종전에는 **파일명 문자열만** 봤다. 그래서 2026-08-16 배포에서
 *   버튼 세 개가 전부 죽어 있었는데도 초록이었다:
 *     ▶  on-demand.yml 에 {pmid, mode} 를 보냈다 — 받는 이름은 {target, kind} 다(422).
 *     🗑  curate-remove.yml 에 pmid 를 sectionKey 로 보냈다 — 그건 발행된 섹션을
 *         숨기는 워크플로라 아직 발행 전인 큐 항목과는 무관하다.
 *     ♻  '__UPCOMING_RESET__' 를 보냈는데 그 문자열을 아는 코드가 저장소에 없었다.
 *   파일명이 맞는 것과 **받는 쪽이 그 입력을 아는 것**은 다른 말이다. 이제 둘 다 본다.
 */
function workflowInputs(file) {
  const src = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('inputs:'), src.indexOf('permissions:'));
  return new Set([...block.matchAll(/^      ([a-zA-Z]\w*):$/gm)].map((m) => m[1]));
}

test('★ 버튼이 부르는 워크플로가 실재하고, 보내는 입력을 그 워크플로가 받는다', () => {
  const s = script();
  // 스크립트가 fire(...) 로 부르는 것을 전부 뽑아 실물 계약과 대조한다.
  const calls = [...s.matchAll(/fire\('([^']+)',\{([^}]*)\}/g)]
    .map((m) => ({ wf: m[1], keys: [...m[2].matchAll(/(\w+)\s*:/g)].map((k) => k[1]) }));
  assert.ok(calls.length >= 3, `버튼 호출이 너무 적다 (${calls.length}개) — 배선이 빠졌다`);

  for (const { wf, keys } of calls) {
    const declared = workflowInputs(wf);   // 파일이 없으면 여기서 던진다 = 오타 검출
    for (const k of keys) {
      assert.ok(declared.has(k),
        `${wf} 는 '${k}' 입력을 받지 않는다 (받는 것: ${[...declared].join(', ')}) — 버튼이 422 로 조용히 죽는다`);
    }
  }
});

test('★ 삭제·갈아엎기는 큐를 실제로 고치는 경로를 쓴다', () => {
  const s = script();
  assert.ok(s.includes('queue-control.yml'), '큐를 고치는 워크플로를 안 부른다');
  assert.ok(s.includes('on-demand.yml'), '지금 실행이 on-demand 를 안 부른다');
});

test('★ 제어 상태는 날짜까지만 기록한다 — public repo 에 분 단위가 쌓이면 생활 패턴이 된다', () => {
  const s = script();
  assert.ok(s.includes('slice(0,10)'), '날짜로 자르는 코드가 없다');
  assert.doesNotMatch(s, /toISOString\(\)\s*[,)]/, '시각이 통째로 들어간다');
});

test('토글은 켜짐 → 꺼짐 → 격일 → 켜짐 으로 돈다', () => {
  const s = script();
  assert.ok(/on'?\s*:\s*'off'|'on'.*'off'/.test(s) && s.includes('alternate'), '3단 순환이 없다');
});

test('★ 실패하면 사용자에게 알린다 (조용히 죽지 않는다)', () => {
  const s = script();
  assert.ok(s.includes('catch'), '에러 처리가 없다');
  assert.ok(/alert|textContent|✖/.test(s), '실패를 알리는 경로가 없다');
});

test('갈아엎기는 되돌릴 수 없으므로 확인을 받는다', () => {
  assert.ok(/confirm\(/.test(script()), '확인 없이 전체를 지운다');
});

test('스크립트가 페이지에 실제로 들어간다', () => {
  const out = renderAll(new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' }), '<!-- ARCHIVE_START -->', {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1 }] } }],
  });
  assert.ok(out.includes('data-up-drop'), '버튼이 없다');
  assert.ok(out.includes('UPBTN'), '스크립트 마커가 없다');
});

/**
 * ★ 입력 **이름**이 맞는 것과 보내는 **값**을 받아 주는 것은 다른 말이다.
 *
 * 2026-08-17 PeterJ 실측: 리뷰 예고에서 ▶ 를 눌렀더니 분석·발행이 안 되고
 * "맨 앞으로 올렸습니다" 만 떴다. `on-demand.yml` 의 `kind` 가 choice 인데
 * 목록에 `review` 가 없어서 스크립트가 아예 폴백하도록 짜여 있었다.
 * 값을 넣어도 목록에 없으면 workflow_dispatch 는 **422 로 튕긴다** — 이름만 보는
 * 검사로는 안 잡힌다.
 */
function choiceOptions(file, input) {
  const src = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const block = src.slice(src.indexOf(`      ${input}:`));
  const line = block.match(/^\s*options:\s*\[([^\]]*)\]/m);
  return line ? new Set(line[1].split(',').map((v) => v.trim())) : null;
}

test('★ ▶ 가 보내는 kind 값을 on-demand.yml 이 전부 받는다', () => {
  const s = script();
  const map = s.match(/var KIND=\{([^}]*)\}/)?.[1];
  assert.ok(map, 'KIND 매핑을 못 찾았다');
  const sent = [...map.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  const declared = choiceOptions('on-demand.yml', 'kind');
  assert.ok(declared, 'on-demand.yml 의 kind 가 choice 가 아니다');
  for (const v of sent) {
    assert.ok(declared.has(v), `on-demand.yml 의 kind 목록에 '${v}' 가 없다 — 422 로 조용히 죽는다`);
  }
  // 세 트랙 모두 지금 실행이 가능해야 한다 (PeterJ 지시 2026-08-17)
  for (const track of ['papers', 'guidelines', 'reviews']) {
    assert.match(map, new RegExp(`${track}\\s*:`), `${track} 트랙의 ▶ 가 분석 경로에 안 붙었다`);
  }
});

test('★ 🗑(누적 리스트)가 보내는 섹션 태그를 curate-remove.yml 이 전부 받는다', async () => {
  const { SECTION_TAGS } = await import('../src/utils/curation.js');
  const declared = choiceOptions('curate-remove.yml', 'tag');
  assert.ok(declared, 'curate-remove.yml 의 tag 가 choice 가 아니다');
  for (const tag of SECTION_TAGS) {
    assert.ok(declared.has(tag), `curate-remove.yml 의 tag 목록에 '${tag}' 가 없다 — 422 로 조용히 죽는다`);
  }
});
