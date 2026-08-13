// Pages 배포 검증 대상 선정을 위한 순수 함수. 네트워크·파일 시스템에 의존하지 않는다.

// 상태 전용 파일은 브라우저가 요청하지 않는 빌드 산물이다.
export const STATE_ONLY_PATHS = new Set([
  'output/selected_papers.json',
  'output/selected_guidelines.json',
  'output/analysis_archive.json',
  'output/video_log.json',
]);

export function touchesPublishedPath(filenames) {
  return filenames.length > 0 && filenames.some((filename) => !STATE_ONLY_PATHS.has(filename));
}

export function pickVerifyTargets(commits) {
  let latestPublishedIndex = -1;
  commits.forEach((commit, index) => {
    if (touchesPublishedPath(commit.files)) latestPublishedIndex = index;
  });
  return latestPublishedIndex === -1 ? [] : commits.slice(latestPublishedIndex).map(({ sha }) => sha);
}
