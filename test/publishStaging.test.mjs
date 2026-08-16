import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

/**
 * ★ 2026-08-16 실측 치명 결함 — `_gitPush()` 의 스테이징 목록에 `reviews.html` 과 트랙 큐가
 *   빠져 있었다. 지난 세션이 "큐가 매 실행 증발한다" 를 고치면서 `.gitignore` 예외만
 *   넣고 여기를 안 고쳤다. **예외는 파일을 추적 가능하게 만들 뿐 `git add` 를 대신하지
 *   않는다.** 그대로였다면 리뷰 저수지가 매 실행 사라지고 3번째 페이지는 원격에서 영원히
 *   갱신되지 않았을 것이다 — 그런데 **push 는 성공으로 끝난다.**
 *
 * 이 파일은 "러너가 쓰는 파일" 과 "커밋되는 파일" 이 어긋나는 것을 막는다.
 */

const SRC = () => readFile(new URL('../src/utils/GitHubPublisher.js', import.meta.url), 'utf8');

test('★ publish 가 writeFile 하는 페이지는 전부 스테이징 목록에 있다', async () => {
  const src = await SRC();
  const written = [...src.matchAll(/writeFile\(path\.join\(this\._repoPath, '([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(written.length >= 3, `기록되는 파일이 너무 적다 (${written.length}) — 이 검사는 헛돈다`);
  for (const f of new Set(written)) {
    assert.ok(GitHubPublisher.RUNNER_FILES.includes(f),
      `publish 가 ${f} 를 쓰는데 커밋 목록에 없다 — 원격에 영원히 반영되지 않는다`);
  }
});

test('★ 러너가 저장하는 상태 파일이 전부 스테이징 목록에 있다', async () => {
  const orch = await readFile(new URL('../src/orchestrator/TrendReviewOrchestrator.js', import.meta.url), 'utf8');
  // 오케스트레이터가 기본값으로 잡는 output/ 경로들 = 러너가 쓰는 것들
  const paths = [...orch.matchAll(/path\.join\(this\.outputDir, '([^']+\.json)'\)/g)].map((m) => `output/${m[1]}`);
  assert.ok(paths.length > 0, '러너 상태 파일을 하나도 못 찾았다 — 이 검사는 헛돈다');

  // ★ 브라우저가 쓰는 파일은 **일부러 뺀다.** 러너가 되쓰면 버튼 커밋과 상호 덮어쓰기가
  //   시작된다(불변식). 그래서 여기 두 개는 목록에 없어야 정상이다.
  const BROWSER_OWNED = ['output/control_state.json', 'output/read_state.json'];
  for (const f of new Set(paths)) {
    if (BROWSER_OWNED.includes(f)) continue;
    assert.ok(GitHubPublisher.RUNNER_FILES.includes(f),
      `러너가 ${f} 를 쓰는데 커밋 목록에 없다 — 실행 사이에 사라진다`);
  }
  for (const f of BROWSER_OWNED) {
    assert.equal(GitHubPublisher.RUNNER_FILES.includes(f), false,
      `${f} 는 브라우저 소유다 — 러너가 커밋하면 상호 덮어쓰기가 시작된다`);
  }
});

test('★ 커밋되는 파일은 .gitignore 예외를 갖는다 (없으면 add 가 조용히 무시된다)', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  for (const f of GitHubPublisher.RUNNER_FILES) {
    if (!f.startsWith('output/')) continue;
    assert.ok(ignore.includes(`!${f}`),
      `${f} 가 .gitignore 예외에 없다 — git add 가 조용히 무시하고 파일이 매 실행 사라진다`);
  }
});

test('★ git push 실패 폴백도 같은 목록을 쓴다 (한쪽만 늘리면 또 어긋난다)', async () => {
  const src = await SRC();
  const fallback = src.slice(src.indexOf('git push 실패'), src.indexOf('_putFileViaApi(relPath'));
  assert.ok(fallback.includes('RUNNER_FILES'),
    '폴백이 목록을 따로 들고 있다 — 정본이 둘이 되면 반드시 어긋난다');
});
