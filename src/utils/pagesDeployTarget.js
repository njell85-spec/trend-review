// Pages 배포 검증 대상 선정을 위한 순수 함수. 네트워크·파일 시스템에 의존하지 않는다.

// 상태 전용 파일은 브라우저가 요청하지 않는 빌드 산물이다.
export const STATE_ONLY_PATHS = new Set([
  'output/selected_papers.json',
  'output/selected_guidelines.json',
  'output/analysis_archive.json',
  'output/video_log.json',
  // ★ 3트랙 큐(2026-08-16) — 러너가 커밋하게 됐지만 브라우저가 요청하지 않는다.
  //   빼먹으면 큐만 바뀐 커밋에도 Pages 배포 검증이 걸려 헛돌고, 배포가 안 나면
  //   가짜 실패로 데일리가 빨개진다.
  'output/queue_papers.json',
  'output/queue_reviews.json',
  // 브라우저가 쓰는 파일. 러너는 커밋하지 않지만 버튼 커밋이 main 에 들어온다.
  'output/control_state.json',
  'output/read_state.json',
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

// cancelled 런에는 실패한 잡이 없으므로 failed-jobs API가 아니라 전체 런을 재실행한다.
export function rerunEndpointForConclusion(runId, conclusion) {
  const suffix = conclusion === 'cancelled' ? 'rerun' : 'rerun-failed-jobs';
  return `/actions/runs/${runId}/${suffix}`;
}
