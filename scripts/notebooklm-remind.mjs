#!/usr/bin/env node
/**
 * NotebookLM 소스 등록 리마인더 — notebooklm-sync.yml의 폴백 경로.
 * 자동 등록(notebooklm-register.py)이 실패했거나 NOTEBOOKLM_* 미설정일 때,
 * 이번 달 Doc(분석·전문)을 각각 버튼 링크로 1건씩 발송한다 — URL을 본문에 넣고
 * 자르면 링크가 깨질 수 있어(카톡 텍스트 상한) 링크는 버튼으로만. (REPORT_SPEC §4-E)
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

const k = new KakaoNotifier();
const docs = [
  { label: '분석 Doc', id: ds.docIds?.[month] },
  { label: '전문 Doc', id: ds.fulltextDocIds?.[month] },
];
for (const d of docs) {
  const text = d.id
    ? `[trend-review] ${month} NotebookLM 연결 필요\n${d.label}을 소스로 추가하세요 (아래 버튼).`
    : `[trend-review] ${month} ${d.label} 아직 없음 — 이달 첫 데일리 실행 후 재확인하세요.`;
  const r = await k.sendNotice({
    text,
    url: d.id ? docUrlOf(d.id) : undefined,
    buttonTitle: d.id ? `📄 ${d.label} 열기` : undefined,
  });
  console.log(`리마인더(${d.label}): ${r.sent ? '발송 완료' : `생략(${r.reason})`}`);
}
