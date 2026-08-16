import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

// 버튼 동작 스크립트. 브라우저에서만 도는 코드라 유닛 테스트로는 **문자열을 검사**한다 —
// 위젯 테스트(onDemandWidget.test.mjs)가 쓰는 것과 같은 방식이다.
// 여기서 막고 싶은 것은 셋이다: ①PAT 를 화면·URL 에 흘리는 것 ②워크플로 이름 오타로
// 버튼이 조용히 아무것도 안 하는 것 ③시각을 분 단위로 커밋해 생활 패턴이 쌓이는 것.

const script = () => new GitHubPublisher()._upcomingScript();

test('★ 버튼 속성명과 스크립트가 읽는 키가 정확히 대응한다', () => {
  // 렌더는 `data-up-run` 을 쓰고 스크립트는 `dataset.upRun` 을 읽는다. 둘 중 한쪽만
  // 고치면 버튼이 **조용히 아무것도 안 한다** — 에러도 안 난다. 그래서 양쪽을 같이 본다.
  const s = script();
  const rendered = new GitHubPublisher()._renderUpcoming('<!-- ARCHIVE_START -->', {
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

test('★ 워크플로 파일명이 실재하는 것과 일치한다 (오타면 버튼이 조용히 죽는다)', () => {
  const s = script();
  assert.ok(s.includes('curate-remove.yml'), '삭제가 기존 워크플로를 써야 한다');
  assert.ok(s.includes('on-demand.yml'), '구동이 기존 워크플로를 써야 한다');
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
  const out = new GitHubPublisher()._renderUpcoming('<!-- ARCHIVE_START -->', {
    from: '2026-08-16', days: 1,
    tracks: [{ key: 'papers', label: '논문', cadence: 'daily', mode: 'on',
      state: { queue: [{ pmid: '1', title: 't', score: 1 }] } }],
  });
  assert.ok(out.includes('data-up-drop'), '버튼이 없다');
  assert.ok(out.includes('UPBTN'), '스크립트 마커가 없다');
});
