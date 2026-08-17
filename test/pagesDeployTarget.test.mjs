/** pagesDeployTarget — 게시 파일 변경 커밋 선택 계약 검증. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVerifyTargets, rerunEndpointForConclusion, touchesPublishedPath } from '../src/utils/pagesDeployTarget.js';

const commit = (sha, files) => ({ sha, files });

test('앞 커밋의 HTML과 뒤 상태 파일 커밋이면 두 sha를 반환한다', () => {
  assert.deepEqual(pickVerifyTargets([
    commit('front', ['index.html']),
    commit('back', ['output/analysis_archive.json']),
  ]), ['front', 'back']);
});

test('모든 커밋이 상태 파일만 변경하면 빈 배열을 반환한다', () => {
  assert.deepEqual(pickVerifyTargets([
    commit('a', ['output/selected_papers.json']),
    commit('b', ['output/video_log.json']),
  ]), []);
});

test('최신 게시 파일 변경 커밋부터 끝까지 반환한다', () => {
  assert.deepEqual(pickVerifyTargets([
    commit('a', ['index.html']),
    commit('b', ['output/video_log.json']),
    commit('c', ['guidelines.html']),
  ]), ['c']);
});

test('첫 대상은 가장 최신 게시 커밋이고 뒤 상태 커밋도 그 게시 내용을 포함한다', () => {
  const targets = pickVerifyTargets([
    commit('old-page', ['index.html']),
    commit('latest-page', ['reviews.html']),
    commit('state-after-page', ['output/video_log.json']),
  ]);
  const [latestPublishedSha] = targets;
  assert.equal(latestPublishedSha, 'latest-page');
  assert.deepEqual(targets, ['latest-page', 'state-after-page']);
});

test('취소 런만 전체 재실행하고 그 외 실패는 실패 잡만 재실행한다', () => {
  assert.equal(rerunEndpointForConclusion(10, 'cancelled'), '/actions/runs/10/rerun');
  assert.equal(rerunEndpointForConclusion(11, 'failure'), '/actions/runs/11/rerun-failed-jobs');
});

test('블록리스트에 없는 상태·새 자산 파일은 게시 파일이다', () => {
  assert.equal(touchesPublishedPath(['output/curation_state.json']), true);
  assert.equal(touchesPublishedPath(['assets/app.js']), true);
});

test('파일이 없는 커밋은 게시 파일을 변경하지 않은 것으로 본다', () => {
  assert.equal(touchesPublishedPath([]), false);
  assert.deepEqual(pickVerifyTargets([commit('a', []), commit('b', ['output/video_log.json'])]), []);
});


/**
 * ★ 3분할(2026-08-16) — 새 게시 파일 `reviews.html` 이 배포 검증 대상으로 잡히는지.
 *   이 판정은 **부정 목록**(STATE_ONLY_PATHS)이라 새 페이지가 자동으로 포함되는데,
 *   나중에 누가 그 목록을 긍정 목록으로 바꾸면 리뷰 페이지 배포 실패가 조용히 지나간다.
 */
test('★ reviews.html 변경은 게시 파일 변경으로 잡힌다', () => {
  assert.equal(touchesPublishedPath(['reviews.html']), true);
  assert.equal(touchesPublishedPath(['index.html']), true);
  assert.equal(touchesPublishedPath(['guidelines.html']), true);
  // 상태 파일만 바뀐 커밋은 배포 검증 대상이 아니다(그대로 유지되는지 확인)
  assert.equal(touchesPublishedPath(['output/queue_reviews.json']), false);
});
