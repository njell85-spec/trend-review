/**
 * publish-pico-format.mjs
 * 새 PICO 포맷으로 재생성된 HTML 보고서를 GitHub Pages에 배포
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GitHubPublisher } from './src/utils/GitHubPublisher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, 'output/reports/trend_review_trend_review_20260610_101029.json');

console.log('📦 JSON 파일 읽는 중:', jsonPath);
const raw = JSON.parse(await readFile(jsonPath, 'utf8'));
const topPapers = raw.topPapers ?? [];

console.log(`✅ Top Papers 로드: ${topPapers.length}편`);
console.log('🌐 GitHub Pages 배포 중...');
console.log('   Owner:', process.env.GITHUB_OWNER);
console.log('   Repo :', process.env.GITHUB_REPO);

const gh = new GitHubPublisher();
const pagesUrl = await gh.publish('2026-06-10', topPapers);

console.log('\n✅ 배포 완료!');
console.log('🌐 GitHub Pages:', pagesUrl);
