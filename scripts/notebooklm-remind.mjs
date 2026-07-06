#!/usr/bin/env node
/**
 * NotebookLM 소스 등록 리마인더 — notebooklm-sync.yml의 폴백 경로.
 * 자동 등록(notebooklm-register.py)이 실패했거나 NOTEBOOKLM_* 미설정일 때,
 * 이번 달 Doc 2개(분석·전문) 링크를 카톡 나챗방으로 보낸다. (REPORT_SPEC §4-E)
 */
import { readFile } from 'fs/promises';
import { KakaoNotifier } from '../src/agents/KakaoNotifier.js';
import { docUrlOf } from '../src/utils/fulltextDoc.js';
import { kstDateStr } from '../src/utils/dates.js';

const month = kstDateStr().slice(0, 7);
let ds = {};
try {
  ds = JSON.parse(await readFile('output/analysis_archive.json', 'utf8')).driveState ?? {};
} catch { /* 상태 파일 없으면 링크 없이 안내만 */ }

const a = ds.docIds?.[month];
const f = ds.fulltextDocIds?.[month];
const text = [
  `[trend-review] ${month} NotebookLM 연결`,
  '자동 등록 실패/미설정 — 소스 추가 필요:',
  a ? '분석 Doc: 아래 버튼' : '분석 Doc: 이달 첫 실행 후 생성됨',
  f ? `전문 Doc: ${docUrlOf(f)}` : '전문 Doc: 이달 첫 실행 후 생성됨',
].join('\n').slice(0, 195);

const r = await new KakaoNotifier().sendNotice({ text, url: a ? docUrlOf(a) : undefined });
console.log(`리마인더: ${r.sent ? '발송 완료' : `생략(${r.reason})`}`);
