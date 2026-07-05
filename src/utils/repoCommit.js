/**
 * repoCommit — 러너 휘발 대응: 상태 파일을 GitHub contents API로 저장소에 커밋.
 * GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO 미설정(로컬 실행)이면 조용히 생략한다.
 * ArchiveAgent(analysis_archive.json)·VideoAgent(video_log.json)가 공유.
 */
import { readFile } from 'fs/promises';
import path from 'path';

export async function commitFileToRepo(relPath, message, { logger } = {}) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    logger?.warn?.(`GITHUB_* 미설정 — ${relPath} 저장소 커밋 생략(로컬 실행)`);
    return false;
  }
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relPath}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'trend-review',
    Accept: 'application/vnd.github+json',
  };
  const cur = await fetch(api, { headers });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const content = Buffer.from(await readFile(path.join(process.cwd(), relPath))).toString('base64');
  const res = await fetch(api, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message, content, ...(sha && { sha }) }),
  });
  if (!res.ok) throw new Error(`${relPath} 커밋 실패 HTTP ${res.status}`);
  logger?.info?.(`${relPath} 저장소 커밋 완료`);
  return true;
}
