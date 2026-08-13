/** pagesDeployTarget — 게시 파일 변경 커밋 선택 계약 검증. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVerifyTargets, touchesPublishedPath } from '../src/utils/pagesDeployTarget.js';

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

test('블록리스트에 없는 상태·새 자산 파일은 게시 파일이다', () => {
  assert.equal(touchesPublishedPath(['output/curation_state.json']), true);
  assert.equal(touchesPublishedPath(['assets/app.js']), true);
});

test('파일이 없는 커밋은 게시 파일을 변경하지 않은 것으로 본다', () => {
  assert.equal(touchesPublishedPath([]), false);
  assert.deepEqual(pickVerifyTargets([commit('a', []), commit('b', ['output/video_log.json'])]), []);
});
