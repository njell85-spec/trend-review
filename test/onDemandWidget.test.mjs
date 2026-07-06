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
