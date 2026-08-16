import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

/**
 * ★ B1 회귀 — 배포된 index.html 에 `var OWNER='undefined', REPO='undefined'` 가 실제로
 * 구워져 나갔다(2026-08-16 PR #108). 예고 리스트의 ▶·🗑·토글·갈아엎기가 전부
 * `https://api.github.com/repos/undefined/undefined` 로 가서 **조용히 죽어 있었다.**
 *
 * 원인: `owner = process.env.GITHUB_OWNER` 인데 러너 밖에서 렌더하면 env 가 비어 있다.
 * 같은 페이지의 ONDEMAND_WIDGET·CURATION_BLOCK 이 멀쩡했던 것은 그 둘은 **없을 때만
 * 삽입**되고 예고 블록만 **매번 재생성**되기 때문이다 — 즉 재생성되는 모든 스크립트가
 * 같은 함정을 밟는다.
 *
 * 계약: **어떤 경로로도 'undefined' 를 스크립트에 굽지 않는다.**
 */

const PAGE = `<!DOCTYPE html><html><head></head><body>
  <div class="stats"></div>
  <div class="archive">
<!-- ARCHIVE_START -->
  </div>
<div class="arch-table"><tbody><!-- TABLE_ROWS_START --><!-- TABLE_ROWS_END --></tbody></div>
</body></html>`;

test('★ owner/repo 가 없으면 스크립트에 undefined 를 굽지 않는다', () => {
  const pub = new GitHubPublisher({ owner: undefined, repo: undefined });
  const out = pub._renderUpcoming(PAGE, { from: '2026-08-17', track: 'papers', label: '논문', state: { queue: [] }, mode: 'on' });
  assert.equal(/OWNER='undefined'|REPO='undefined'/.test(out), false,
    "스크립트에 리터럴 'undefined' 가 구워졌다 — 버튼이 전부 죽는다");
});

test('★ env 가 비어도 페이지에 남은 식별자로 복구한다', () => {
  const withIdent = PAGE.replace('<body>', `<body><script>var OWNER='njell85-spec', REPO='trend-review';</script>`);
  const pub = new GitHubPublisher({ owner: undefined, repo: undefined });
  const out = pub._renderUpcoming(withIdent, { from: '2026-08-17', track: 'papers', label: '논문', state: { queue: [] }, mode: 'on' });
  // ★ 페이지 전체를 보면 입력에 이미 그 문자열이 있어 자명하게 통과한다.
  //   반드시 **새로 구워진 UPBTN 블록 안**에서 확인한다.
  const btn = out.match(/<!-- UPBTN v\d+ -->[\s\S]*?<\/script>/)?.[0] ?? '';
  assert.ok(btn, 'UPBTN 스크립트 블록이 없다');
  assert.match(btn, /var OWNER='njell85-spec', REPO='trend-review'/,
    '페이지에 이미 있던 올바른 식별자를 못 살렸다');
});

test('★ 정상 경로에서는 생성자 값이 그대로 실린다', () => {
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review' });
  const out = pub._renderUpcoming(PAGE, { from: '2026-08-17', track: 'papers', label: '논문', state: { queue: [] }, mode: 'on' });
  const btn = out.match(/<!-- UPBTN v\d+ -->[\s\S]*?<\/script>/)?.[0] ?? '';
  assert.ok(btn, 'UPBTN 스크립트 블록이 없다');
  assert.match(btn, /var OWNER='njell85-spec', REPO='trend-review'/);
});

test('★ 배포된 index.html 에 undefined 식별자가 남아 있지 않다', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(/OWNER='undefined'|REPO='undefined'/.test(html), false,
    "배포본에 'undefined' 식별자가 남아 있다 — 그 블록의 버튼은 죽어 있다");
});
