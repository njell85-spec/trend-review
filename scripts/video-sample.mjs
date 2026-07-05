#!/usr/bin/env node
/**
 * video-sample.mjs — 최신 아카이브 항목으로 영상을 업로드 없이 생성한다.
 * 산출물: output/video/<날짜-form-lang>/video.mp4
 * PeterJ 승인 게이트: 이 파일들을 모바일에서 시청 가능하게 전달 → 승인 후 데일리 편입.
 *
 * 준비: GOOGLE_TTS_API_KEY(.env 또는 env) + playwright(chromium) + ffmpeg
 * 사용: node scripts/video-sample.mjs
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { VideoAgent } from '../src/agents/VideoAgent.js';
import { kstDateStr } from '../src/utils/dates.js';

let archive;
try {
  archive = JSON.parse(await readFile('output/analysis_archive.json', 'utf8'));
} catch {
  console.error('✖ output/analysis_archive.json 없음 — Phase 2를 먼저 가동하세요 (workflow_dispatch 1회).');
  process.exit(1);
}
const entry = archive.entries?.at(-1);
if (!entry) {
  console.error('✖ analysis_archive.json에 항목이 없습니다.');
  process.exit(1);
}

// 아카이브 항목을 VideoAgent 입력(분석 객체) 형태로 복원
const analysis = {
  pmid: entry.pmid,
  title_ko: entry.title_ko,
  clinicalQuestion_ko: entry.clinicalQuestion_ko,
  pico_ko: entry.pico_ko,
  keyFindings: entry.keyFindings,
  keyFindings_ko: entry.keyFindings_ko,
  evidenceLevel: entry.evidenceLevel,
  paper: { title: entry.title, journal: entry.journal, pmid: entry.pmid, doi: entry.doi },
};

console.log(`🎬 샘플 생성 시작: ${entry.date} — ${entry.title_ko || entry.title}`);
const r = await new VideoAgent().run({
  analysis,
  todayKST: kstDateStr(),
  pagesUrl: 'https://njell85-spec.github.io/trend-review/',
  upload: false,
});
console.log(JSON.stringify(
  r.videos.map(({ form, lang, file, error }) => ({ form, lang, file, error })),
  null, 2,
));
if (!r.ok) process.exit(1);
