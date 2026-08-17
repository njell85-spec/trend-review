#!/usr/bin/env node
/**
 * curate-remove.mjs — 대시보드 삭제(R4): 섹션 숨김 기록 + index.html 패치.
 *
 * 삭제 = 대시보드 표시 제거 + **분석내용(아카이브) 제거** (PeterJ 확정 2026-08-17:
 * *"삭제하면 누적리스트 및 분석내용 모두 삭제"*). 종전에는 아카이브를 안 건드려서,
 * 28건을 지운 뒤에도 "아카이브 저장 현황" 목록이 그대로였다 — PeterJ 가 그것을 보고
 * "반영이 안 됐다" 고 했다.
 * ★ **재선정 방지 목록(`output/selected_papers.json`)은 계속 건드리지 않는다** — 지운
 *   논문이 다시 뽑히면 안 된다. 아카이브와 다른 파일이다(종전 안내 문구가 둘을 한
 *   덩어리로 묶어 놔서 같은 것처럼 읽혔다).
 * ★ Drive Doc 은 이미 append 된 것을 되돌릴 수 없다(누적) — 로컬·화면에서만 지운다.
 * 멱등 — 재실행/경합 재적용에 안전.
 * commit/push는 워크플로우(curate-remove.yml)가 담당: push 경합 시 최신
 * main으로 리셋 후 이 스크립트를 다시 돌리는 재시도 루프.
 *
 * 입력(env — run에 ${{ }} 직접 보간 금지, on-demand.yml과 동일한 인젝션 방어):
 *   CUR_SECTION_KEY  섹션 키 (YYYY-MM-DD 또는 YYYY-MM-DD-m-<pmid>)
 *   CUR_TAG          SECTION | GSECTION | RSECTION — 같은 날짜 키로 논문·가이드·리뷰
 *                    섹션이 공존하므로 태그 없이 지우면 셋 다 소멸한다(리뷰 C1)
 *   CUR_PMID         논문 PMID (표 행 제거용, 선택)
 */
import { readFile, writeFile } from 'fs/promises';
import {
  loadCurationState, saveCurationState, removeSectionFromHtml,
} from '../src/utils/curation.js';
import { ensureArchiveStatus, pruneArchiveByHidden } from '../src/utils/archiveStatus.js';
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
//   같은 개편이 놓친 자리를 세어 보면 일곱이다 — 클라이언트 정규식 · 서버 화이트리스트 ·
//   상태 키 파서 · 워크플로 choice 목록 · 이 정규식 · 아래 tag 화이트리스트 · targets.
//   ★ 다섯 번째에서 "마지막" 이라고 적었는데 아니었다. 한 개념을 추가할 때 그 개념을 아는
//     자리를 **세어서** 확인하지 않으면 며칠에 걸쳐 하나씩 터진다.
if (!/^\d{4}-\d{2}-\d{2}(-[mr]-([0-9]{1,9}|x))?$/.test(sectionKey)) {
  console.error(`✖ 잘못된 sectionKey: "${sectionKey}"`);
  process.exit(1);
}
// ★★ RSECTION 이 여기 없었다 (2026-08-17 실측). 워크플로 choice 목록엔 넣었고
//   sectionKey 정규식도 `-r-` 를 받게 넓혔는데 **이 화이트리스트만 안 따라왔다** —
//   리뷰 삭제는 여기서 exit 1 로 죽는다. 어제 "다섯 번째 자리" 라고 고쳤다고 한 것이
//   실은 세 자리 중 하나였다(검증을 `removeSectionFromHtml` 직접 호출로 해서 실제
//   프로덕션 경로를 안 태웠다). 아래 `targets` 에 reviews.html 이 없던 것도 같은 누락이다.
if (!['SECTION', 'GSECTION', 'RSECTION'].includes(tag)) {
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
// ★ reviews.html 이 빠져 있었다 — 리뷰 카드·누적행이 발행 HTML 에 그대로 남는다.
const targets = ['index.html', 'guidelines.html', 'reviews.html'];
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

// ── 분석내용(아카이브)도 지운다 ────────────────────────────────────────────────
// ★ 숨김 목록 **전체**를 훑는다 — 이번 건만 빼면 이미 지나간 삭제가 영구히 남는다
//   (실측 시점에 숨김 31건 중 28건이 아카이브에 그대로 있었다). 멱등이고 소급 정리된다.
let pruned = [];
try {
  const raw = await readFile('output/analysis_archive.json', 'utf8');
  const archive = JSON.parse(raw);
  const { archive: next, removed } = pruneArchiveByHidden(archive, state.hidden);
  pruned = removed;
  if (removed.length) {
    await writeFile('output/analysis_archive.json', `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
  // 목록은 아카이브 JSON 에서 매번 다시 그려진다 — 항목을 뺐으면 블록을 갈아야 화면이 바뀐다.
  // (제거분이 없어도 재렌더는 멱등이라 해롭지 않다.)
  const html = await readFile('index.html', 'utf8');
  const patched = ensureArchiveStatus(html, next);
  if (patched !== html) {
    await writeFile('index.html', patched, 'utf8');
    if (!changed.includes('index.html')) changed.push('index.html');
  }
} catch (err) {
  // 아카이브가 없거나 깨져도 삭제 자체는 성공시킨다 — 데일리 코어 무영향 원칙.
  console.warn(`· 아카이브 정리 건너뜀 (non-fatal): ${err.message}`);
}

console.log(changed.length === 0
  ? `${hiddenKey}: 페이지에 이미 없음(멱등) — 숨김 목록만 갱신`
  : `${hiddenKey} 제거 완료 [${changed.join(', ')}]${pmid ? ` (+표 행 ${pmid})` : ''}`);
if (pruned.length) console.log(`· 아카이브에서 ${pruned.length}건 제거 (재선정 방지 목록은 유지)`);
