/**
 * _ensureOnDemandWidget — 배포 페이지(증분 패치)에 위젯을 보장하는 로직 검증.
 * 핵심: "없을 때만 주입"이 아니라 구버전 블록을 현재 버전으로 교체해야
 * 위젯 버그픽스가 배포 페이지에 실린다 (2026-07-06 재검토 발견).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

const pub = new GitHubPublisher({ token: 't', owner: 'o', repo: 'r' });
const ANCHOR = '<!-- ARCHIVE_START -->';

test('위젯이 없으면 ARCHIVE_START 앞에 주입한다', () => {
  const out = pub._ensureOnDemandWidget(`<body>\n${ANCHOR}\n</body>`);
  assert.match(out, /<!-- ONDEMAND_WIDGET v\d+ -->[\s\S]*<!-- \/ONDEMAND_WIDGET -->\n<!-- ARCHIVE_START -->/);
});

test('구버전(v 없는 최초 마커) 블록은 현재 버전으로 교체된다', () => {
  const deployed = `<body>\n<!-- ONDEMAND_WIDGET -->\n<details>OLD WIDGET</details>\n<!-- /ONDEMAND_WIDGET -->\n${ANCHOR}\n</body>`;
  const out = pub._ensureOnDemandWidget(deployed);
  assert.ok(!out.includes('OLD WIDGET'), '구버전 내용이 남아있으면 안 됨');
  assert.match(out, /<!-- ONDEMAND_WIDGET v\d+ -->/);
  assert.equal(out.match(/<!-- \/ONDEMAND_WIDGET -->/g).length, 1, '위젯 블록은 정확히 1개');
});

test('현재 버전이 이미 있으면 그대로 반환한다(멱등)', () => {
  const injected = pub._ensureOnDemandWidget(`<body>\n${ANCHOR}\n</body>`);
  assert.equal(pub._ensureOnDemandWidget(injected), injected);
});

test('버전을 올리면 이전 버전 블록이 교체된다', () => {
  const injected = pub._ensureOnDemandWidget(`<body>\n${ANCHOR}\n</body>`);
  const older = injected.replace(/<!-- ONDEMAND_WIDGET v\d+ -->/, '<!-- ONDEMAND_WIDGET v1 -->');
  const out = pub._ensureOnDemandWidget(older);
  assert.ok(!out.includes('<!-- ONDEMAND_WIDGET v1 -->'));
  assert.equal(out.match(/<!-- \/ONDEMAND_WIDGET -->/g).length, 1);
});

/**
 * "직접 입력" 판별 로직 — 위젯에 실제로 실려 배포되는 인라인 JS를 그대로 꺼내 실행한다.
 * 문자열 포함 검사가 아니라 동작 검증이라야, 정규식을 잘못 고쳤을 때 적색이 된다.
 *
 * 배경(2026-08-06): URL 지정 경로(PR #65)가 백엔드에는 있는데 이 위젯이 URL을 거부해서
 * 폰에서 PubMed 미등재 가이드라인을 넣을 수 없었다.
 */
function loadClassify() {
  const src = pub._onDemandWidget();
  const m = src.match(/function classify\(v\)\{[\s\S]*?\n {2}\}/);
  assert.ok(m, '위젯에서 classify() 를 추출하지 못했다 — 함수 이름/들여쓰기가 바뀌었는지 확인');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return classify;`)();
}

test('직접 입력: PMID·DOI 는 종전대로 통과한다 (회귀)', () => {
  const classify = loadClassify();
  assert.equal(classify('41236566').ok, true, 'PMID');
  assert.equal(classify('10.1093/cid/ciae403').ok, true, 'DOI');
  // PMID/DOI 는 kind 를 강제하지 않는다 — confirm() 으로 사용자가 고른다.
  assert.equal(classify('41236566').kind, undefined);
  assert.equal(classify('10.1093/cid/ciae403').kind, undefined);
});

test('직접 입력: http(s) URL 을 받아들이고 URL 로 표시한다', () => {
  const classify = loadClassify();
  for (const u of [
    'https://www.idsociety.org/practice-guideline/amr-guidance/',
    'http://example.org/gl.html',
    'https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines?x=1&y=2',
  ]) {
    const c = classify(u);
    assert.equal(c.ok, true, `URL 이 거부됨: ${u}`);
    assert.equal(c.isUrl, true, `URL 로 표시되지 않음: ${u}`);
    // 위젯 v3 는 kind='guideline' 을 강제했다. v4 에서 참고자료(kind=reference)가 생기면서
    // URL 의 종류는 사용자가 고르게 바뀌었다 — 다만 논문(PICO)은 여전히 URL 로 못 간다
    // (scripts/on-demand.mjs 의 DOC_KINDS 가 guideline|reference 만 받는다).
    assert.equal(c.kind, undefined, `URL 의 kind 를 강제하면 참고자료를 못 넣는다: ${u}`);
  }
});

test('직접 입력: 형식이 아닌 입력은 여전히 거부한다', () => {
  const classify = loadClassify();
  for (const bad of ['sepsis', '123', 'ftp://x.org/a', 'www.idsociety.org', '10.1093']) {
    assert.equal(classify(bad).ok, false, `거부됐어야 함: ${bad}`);
  }
});
