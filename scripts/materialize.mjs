#!/usr/bin/env node
/**
 * materialize.mjs — 자료화(R4): 지정 pmid의 카드뉴스·영상 생성 + YouTube 비공개
 * 업로드 + curation_state.materialized 기록.
 *
 * "선별 승격" 경로(HANDOFF §10-P2): 전역 ENABLE_VIDEO와 무관하게 버튼을 누른
 * 항목만 제작한다. privacyStatus private 고정(VideoAgent, spec-lint 강제)이 안전망.
 * 재실행 안전: video_log.json이 이미 업로드된 편을 건너뛰므로 부분 실패 후
 * 버튼을 다시 눌러 나머지만 마저 만들 수 있다.
 *
 * 입력(env): MAT_PMID — 분석 아카이브에 있는 논문 PMID.
 */
import 'dotenv/config';
import { readFile } from 'fs/promises';
import { VideoAgent } from '../src/agents/VideoAgent.js';
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';
import { loadCurationState, saveCurationState } from '../src/utils/curation.js';
import { kstDateStr } from '../src/utils/dates.js';

const pmid = (process.env.MAT_PMID ?? '').trim();
const todayKST = kstDateStr();

async function notifyFailure(reason) {
  try {
    await new KakaoNotifier().sendFailure({ dateStr: todayKST, reason: `자료화 실패 — ${reason}` });
  } catch { /* 알림 실패는 결과에 영향 없음 */ }
}

if (!/^\d{1,9}$/.test(pmid)) {
  console.error(`✖ 잘못된 pmid: "${pmid}"`);
  process.exit(1);
}

let archive;
try {
  archive = JSON.parse(await readFile('output/analysis_archive.json', 'utf8'));
} catch {
  console.error('✖ output/analysis_archive.json 없음');
  await notifyFailure('아카이브 상태 파일 없음');
  process.exit(1);
}
const entry = (archive.entries ?? []).findLast((e) => String(e.pmid) === pmid);
if (!entry) {
  console.error(`✖ 아카이브에 PMID ${pmid} 항목이 없습니다 (아카이브 가동 이전 항목은 자료화 불가).`);
  await notifyFailure(`PMID ${pmid} 아카이브 항목 없음`);
  process.exit(1);
}

// 아카이브 항목 → VideoAgent 분석 객체 복원 (video-sample.mjs와 동일 패턴)
const analysis = {
  pmid: entry.pmid,
  title_ko: entry.title_ko,
  clinicalQuestion_ko: entry.clinicalQuestion_ko,
  pico: entry.pico,
  pico_ko: entry.pico_ko,
  keyFindings: entry.keyFindings,
  keyFindings_ko: entry.keyFindings_ko,
  evidenceLevel: entry.evidenceLevel,
  paper: { title: entry.title, journal: entry.journal, pmid: entry.pmid, doi: entry.doi },
};

const pagesUrl = process.env.GITHUB_OWNER && process.env.GITHUB_REPO
  ? `https://${process.env.GITHUB_OWNER}.github.io/${process.env.GITHUB_REPO}/`
  : 'https://njell85-spec.github.io/trend-review/';

console.log(`🎬 자료화 시작: PMID ${pmid} — ${entry.title_ko || entry.title}`);
const r = await new VideoAgent().run({ analysis, todayKST, pagesUrl, upload: true });

const uploaded = r.videos.filter((v) => v.videoId);
if (uploaded.length) {
  const state = await loadCurationState();
  state.materialized[pmid] = {
    date: state.materialized[pmid]?.date ?? todayKST,
    videos: uploaded.map(({ form, lang, videoId }) => ({ form, lang, videoId })),
  };
  await saveCurationState(state);
}

console.log(JSON.stringify({
  ok: r.ok,
  videos: r.videos.map(({ form, lang, videoId, error }) => ({ form, lang, videoId, error })),
  cards: r.cards.map(({ lang, files, error }) => ({ lang, cards: files?.length, error })),
}, null, 2));

const failed = r.videos.filter((v) => v.error);
if (!r.ok || failed.length) {
  await notifyFailure(`PMID ${pmid} — ${failed.map((f) => `${f.form}/${f.lang}`).join(', ') || '전체'} 실패 (재클릭 시 나머지만 재시도)`);
  process.exit(1);
}
