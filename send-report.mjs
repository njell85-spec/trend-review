/**
 * send-report.mjs
 * 최신 archive JSON을 읽어 NotificationAgent로 Drive 업로드 + Gmail 실제 발송
 */
import 'dotenv/config';
import { readdir } from 'fs/promises';
import path from 'path';
import { NotificationAgent } from './src/agents/NotificationAgent.js';
import { GitHubPublisher } from './src/utils/GitHubPublisher.js';

const OUTPUT_DIR = './output/reports';

async function findLatest(prefix) {
  const files = await readdir(OUTPUT_DIR);
  const matched = files
    .filter(f => f.startsWith(prefix) && !f.includes('compare') && !f.includes('preview') && !f.includes('bilingual') && !f.includes('fulltext'))
    .sort()
    .reverse();
  if (!matched.length) throw new Error(`${prefix}* 파일을 찾을 수 없습니다`);
  return path.join(OUTPUT_DIR, matched[0]);
}

(async () => {
  try {
    const htmlPath = await findLatest('dashboard_litreview_');
    const jsonPath  = await findLatest('archive_litreview_');

    console.log('📄 HTML:', htmlPath);
    console.log('📦 JSON:', jsonPath);

    // archive에서 topPapers 로드
    const { default: { readFile } } = await import('fs/promises');
    const raw = JSON.parse(await readFile(jsonPath, 'utf8'));
    const topPapers = raw.topPapers ?? [];

    const sessionId = path.basename(jsonPath, '.json').replace('archive_litreview_', '');

    // GitHub Pages 배포
    const dateStr = sessionId.slice(0, 10).replace(/_/g, '-');
    const gh = new GitHubPublisher();
    const pagesUrl = await gh.publish(dateStr, topPapers);
    console.log('🌐 GitHub Pages →', pagesUrl);

    // Gmail + Drive
    const agent = new NotificationAgent();
    const result = await agent.run(sessionId, { htmlPath, jsonPath }, topPapers);

    console.log('\n✅ 완료!');
    console.log('📧 Gmail 발송 →', result.sentTo);
    console.log('📂 Drive URL  →', result.driveHtmlUrl);
    console.log('🌐 Pages URL  →', pagesUrl);
  } catch (err) {
    console.error('❌ 오류:', err.message);
    process.exit(1);
  }
})();
