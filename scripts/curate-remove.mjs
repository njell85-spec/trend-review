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
//
// ★ `-r-<pmid>` = 리뷰 섹션(RSECTION). publisher 가 `${dateStr}-r-${rIdent}` 로 만든다.
//   2026-08-16 3트랙 개편에서 생겼는데 **이 검증기가 안 따라왔다.** 그래서 리뷰 누적행의
//   🗑 를 눌러 확인까지 눌러도 워크플로가 여기서 `✖ 잘못된 sectionKey` 로 죽었고,
//   화면에는 아무 말 없이 항목이 그대로 남았다(2026-08-17 PeterJ 실측).
//   같은 개편이 놓친 자리가 이것으로 다섯 번째다 — 클라이언트 정규식 · 서버 화이트리스트 ·
//   상태 키 파서 · 워크플로 choice 목록 · 그리고 여기.
if (!/^\d{4}-\d{2}-\d{2}(-[mr]-([0-9]{1,9}|x))?$/.test(sectionKey)) {
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

// 페이지 2분할(§4-H) 이후 GSECTION 카드와 가이드·기타 표 행은 guidelines.html 에 있다.
// index.html 만 패치하면 가이드라인 삭제가 아무것도 안 지우고 "이미 없음(멱등)"이라며
// 조용히 성공한다(클라이언트 숨김이 가려줄 뿐, 발행 HTML 엔 남는다).
const targets = ['index.html', 'guidelines.html'];
const changed = [];
for (const file of targets) {
  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    continue; // guidelines.html 은 첫 분할 전이면 없다 — 소프트
  }
  const patched = removeSectionFromHtml(html, { sectionKey, tag, pmid: state.hidden[hiddenKey].pmid });
  if (patched === html) continue;
  await writeFile(file, patched, 'utf8');
  changed.push(file);
}

console.log(changed.length === 0
  ? `${hiddenKey}: 페이지에 이미 없음(멱등) — 숨김 목록만 갱신`
  : `${hiddenKey} 제거 완료 [${changed.join(', ')}]${pmid ? ` (+표 행 ${pmid})` : ''}`);
