#!/usr/bin/env node
/**
 * curate-remove.mjs — 대시보드 삭제(R4): 섹션 숨김 기록 + index.html 패치.
 *
 * 삭제 = 대시보드 표시 제거만(HANDOFF §10-P2 경계). Drive Doc·아카이브·
 * 재선정 방지 목록은 건드리지 않는다. 멱등 — 재실행/경합 재적용에 안전.
 * commit/push는 워크플로우(curate-remove.yml)가 담당: push 경합 시 최신
 * main으로 리셋 후 이 스크립트를 다시 돌리는 재시도 루프.
 *
 * 입력(env — run에 ${{ }} 직접 보간 금지, on-demand.yml과 동일한 인젝션 방어):
 *   CUR_SECTION_KEY  섹션 키 (YYYY-MM-DD 또는 YYYY-MM-DD-m-<pmid>)
 *   CUR_TAG          SECTION | GSECTION — 같은 날짜 키로 논문·가이드 섹션이
 *                    공존하므로 태그 없이 지우면 둘 다 소멸한다(리뷰 C1)
 *   CUR_PMID         논문 PMID (표 행 제거용, 선택)
 */
import { readFile, writeFile } from 'fs/promises';
import {
  loadCurationState, saveCurationState, removeSectionFromHtml,
} from '../src/utils/curation.js';
import { kstDateStr } from '../src/utils/dates.js';

const sectionKey = (process.env.CUR_SECTION_KEY ?? '').trim();
const tag = (process.env.CUR_TAG ?? 'SECTION').trim();
const pmid = (process.env.CUR_PMID ?? '').trim();

// 키 형식을 엄격히 검증 — PAT 소지자는 신뢰 대상이지만 임의 문자열이
// 정규식 치환·커밋 메시지로 흘러가지 않게 형식 밖 입력은 거절한다.
// -m-x: 수동 가이드라인 단독 발행은 pmid 폴백이 'x'다(publisher keyPmid ?? 'x').
if (!/^\d{4}-\d{2}-\d{2}(-m-([0-9]{1,9}|x))?$/.test(sectionKey)) {
  console.error(`✖ 잘못된 sectionKey: "${sectionKey}"`);
  process.exit(1);
}
if (!['SECTION', 'GSECTION'].includes(tag)) {
  console.error(`✖ 잘못된 tag: "${tag}"`);
  process.exit(1);
}
if (pmid && !/^\d{1,9}$/.test(pmid)) {
  console.error(`✖ 잘못된 pmid: "${pmid}"`);
  process.exit(1);
}

const hiddenKey = `${tag}:${sectionKey}`;
const state = await loadCurationState();
const prev = state.hidden[hiddenKey] ?? {};
state.hidden[hiddenKey] = {
  ...prev,
  pmid: pmid || prev.pmid || '', // pmid 없이 재실행돼도 기존 값 보존(리뷰 m2)
  date: kstDateStr(),
  at: new Date().toISOString(),
};
await saveCurationState(state);

const html = await readFile('index.html', 'utf8');
const patched = removeSectionFromHtml(html, { sectionKey, tag, pmid: state.hidden[hiddenKey].pmid });
await writeFile('index.html', patched, 'utf8');

console.log(patched === html
  ? `${hiddenKey}: 페이지에 이미 없음(멱등) — 숨김 목록만 갱신`
  : `${hiddenKey} 제거 완료${pmid ? ` (+표 행 ${pmid})` : ''}`);
