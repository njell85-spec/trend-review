/**
 * 삭제가 **분석내용까지** 따라가는지 (PeterJ 확정 2026-08-17).
 *
 * PeterJ 실측: 논문 28건을 지웠는데 "아카이브 저장 현황" 목록에 그대로 남아 있었고,
 * "지난 논문" 배지는 43건(실제 15건)이라고 말했다. 카드와 누적 표는 정상 제거됐다 —
 * **지운 뒤에도 화면이 지우기 전 숫자를 말하는** 부류라 "반영 안 됨" 으로 보였다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneArchiveByHidden, archiveStatusBlock } from '../src/utils/archiveStatus.js';
import { recountStats, curationBlock } from '../src/utils/curation.js';

const entry = (pmid, date) => ({ pmid, date, title_ko: `논문 ${pmid}` });

// ── 아카이브 정리 ────────────────────────────────────────────────────────────

test('숨긴 항목이 아카이브에서 빠진다', () => {
  const archive = { entries: [entry('1', '2026-08-01'), entry('2', '2026-08-02')], driveState: {} };
  const hidden = { 'SECTION:2026-08-01': { pmid: '1' } };
  const { archive: next, removed } = pruneArchiveByHidden(archive, hidden);
  assert.deepEqual(removed, ['1']);
  assert.deepEqual(next.entries.map((e) => e.pmid), ['2']);
  assert.deepEqual(archive.entries.map((e) => e.pmid), ['1', '2'], '원본을 고쳤다');
  assert.deepEqual(next.driveState, {}, 'driveState 를 잃었다');
});

test('★ 숨김 목록 전체를 훑는다 — 지나간 삭제도 소급 정리된다', () => {
  // 이번에 지운 것은 3번뿐이지만 1·2번은 예전에 지운 것이다.
  const archive = { entries: ['1', '2', '3', '4'].map((p) => entry(p, '2026-08-01')) };
  const hidden = {
    'SECTION:a': { pmid: '1' }, 'SECTION:b': { pmid: '2' }, 'SECTION:c': { pmid: '3' },
  };
  const { removed, archive: next } = pruneArchiveByHidden(archive, hidden);
  assert.deepEqual(removed.sort(), ['1', '2', '3']);
  assert.deepEqual(next.entries.map((e) => e.pmid), ['4']);
});

test('★ pmid 가 빈 숨김 기록은 아무것도 지우지 않는다', () => {
  // 빈 문자열을 그대로 비교하면 pmid 없는 아카이브 항목이 통째로 날아간다.
  const archive = { entries: [{ date: '2026-08-01', title_ko: 'pmid 없는 것' }, entry('9', '2026-08-02')] };
  const { removed, archive: next } = pruneArchiveByHidden(archive, { 'SECTION:x': { pmid: '' } });
  assert.deepEqual(removed, []);
  assert.equal(next.entries.length, 2);
  assert.equal(next, archive, '바뀐 것이 없으면 원본을 그대로 돌려준다');
});

test('아카이브가 없거나 깨져도 던지지 않는다 (소프트)', () => {
  assert.deepEqual(pruneArchiveByHidden(null, { a: { pmid: '1' } }).removed, []);
  assert.deepEqual(pruneArchiveByHidden({}, { a: { pmid: '1' } }).removed, []);
  assert.deepEqual(pruneArchiveByHidden({ entries: 'x' }, { a: { pmid: '1' } }).removed, []);
});

test('아카이브 안내 문구가 삭제를 따라간다고 말한다 (종전 문구는 반대였다)', () => {
  const html = archiveStatusBlock({ entries: [entry('1', '2026-08-01')], driveState: {} });
  assert.ok(!html.includes('삭제한 논문도 여기엔 "저장됨"으로 남습니다'), '종전 문구가 남아 있다');
  assert.match(html, /삭제한 논문은 이 목록에서도 빠집니다/);
  // ★ 재선정 방지는 별개 파일이라 유지된다 — 이것을 안 적으면 "지운 게 다시 뽑히나?" 가 된다.
  assert.match(html, /재선정 방지 목록은 유지/);
});

// ── 지난 카드 배지 ───────────────────────────────────────────────────────────

const sec = (key, today = false) => `<!-- SECTION:${key} -->\n`
  + `<details class="day${today ? ' day-today' : ''}"><summary>${key}</summary>`
  + '<div class="paper-card"></div></details>\n'
  + `<!-- /SECTION:${key} -->`;

test('★ 지난 N건 배지가 실제 개수로 다시 세어진다', () => {
  const html = [
    sec('2026-08-17', true),
    '<details class="past-fold"><summary>지난 논문 <span class="n">43건</span></summary>',
    sec('2026-08-16'), sec('2026-08-15'),
    '</details>',
  ].join('\n');
  const out = recountStats(html);
  assert.match(out, /<summary>지난 논문 <span class="n">2건<\/span><\/summary>/);
});

test('배지 계산 규칙이 foldPast 와 같다 — day-today 는 지난 것이 아니다', () => {
  const html = '<details class="past-fold"><summary>지난 논문 <span class="n">9건</span></summary>'
    + `${sec('2026-08-17', true)}${sec('2026-08-16')}</details>`;
  assert.match(recountStats(html), /<span class="n">1건<\/span>/);
});

test('past-fold 가 없는 페이지는 건드리지 않는다', () => {
  const html = `${sec('2026-08-17', true)}<div class="n stat-days-count">0</div>`;
  assert.ok(!recountStats(html).includes('past-fold'));
});

test('리뷰·가이드 섹션도 지난 것으로 센다 (세 트랙 공통 배지)', () => {
  const rsec = '<!-- RSECTION:2026-08-16-r-1 -->\n<details class="day"><summary>r</summary></details>\n<!-- /RSECTION:2026-08-16-r-1 -->';
  const html = `<details class="past-fold"><summary>지난 리뷰 <span class="n">7건</span></summary>${rsec}</details>`;
  assert.match(recountStats(html), /<span class="n">1건<\/span>/);
});

// ── 확인 대화상자 ────────────────────────────────────────────────────────────

test('삭제 확인 문구가 분석내용까지 지운다고 알린다', () => {
  const block = curationBlock({ owner: 'o', repo: 'r' });
  const decode = (s) => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  const msg = decode(block.match(/if\(!confirm\('(.*?)'\)\)return;/)[1]);
  assert.match(msg, /분석내용/);
  assert.match(msg, /재선정 방지 목록은 유지/);
  // 클라이언트 코드를 고쳤으면 버전을 올려야 배포 페이지에 반영된다.
  assert.match(block, /CURATION_BLOCK v7/);
});

// ── ★ 계약: 스크립트가 쓰는 파일은 워크플로 git add 목록에 다 있어야 한다 ──────
// 이 저장소가 **두 번** 데인 자리다:
//   08-16 reviews.html·트랙 큐가 add 목록에 없어 큐가 매 실행 증발할 뻔했다
//   08-17 analysis_archive.json 프루닝과 reviews.html 패치를 붙이고 이 줄을 안 고쳤다
// 증상이 고약하다 — 러너에서는 고쳐지고 커밋만 안 돼서 **push 가 성공으로 끝난다.**
// 게다가 index.html 블록은 프루닝된 값으로 다시 그려져 화면은 맞아 보이는데,
// JSON 이 안 올라가서 다음 데일리 렌더가 지운 항목을 되살린다.

test('★ curate-remove 가 쓰는 모든 파일이 워크플로 git add 목록에 있다', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile('scripts/curate-remove.mjs', 'utf8');
  const wf = await readFile('.github/workflows/curate-remove.yml', 'utf8');

  // ① writeFile('<경로>' …) 로 직접 쓰는 것
  const written = [...script.matchAll(/writeFile\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  // ② targets 배열 — 섹션 패치 대상 페이지
  const targets = [...script.matchAll(/const targets = \[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/['"`]/g, '')))
    .filter(Boolean);
  // ③ 상태 파일은 헬퍼(saveCurationState)를 거쳐 정규식에 안 걸린다 — 못 박아 둔다
  const files = [...new Set([...written, ...targets, 'output/curation_state.json'])]
    .filter((f) => f.includes('.'));

  assert.ok(files.length >= 4, `대상 파일을 못 찾았다 (${files.join(', ')}) — 이 검사가 헛돌고 있다`);
  const addLines = wf.split('\n').filter((l) => l.includes('git add') || l.includes('for f in'));
  const haystack = addLines.join('\n');
  const missing = files.filter((f) => !haystack.includes(f));
  assert.deepEqual(missing, [], `git add 목록에 없다: ${missing.join(', ')}`);
});

test('★ 워크플로 tag choice 값과 스크립트 화이트리스트가 일치한다', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile('scripts/curate-remove.mjs', 'utf8');
  const wf = await readFile('.github/workflows/curate-remove.yml', 'utf8');
  // 워크플로가 보내는 값을 스크립트가 거절하면 exit 1 이고 화면엔 아무 말이 없다
  // (2026-08-17 리뷰 삭제가 정확히 그렇게 죽었다 — choice 엔 RSECTION 이 있는데
  //  스크립트 화이트리스트엔 없었다).
  const choices = wf.match(/options: \[([^\]]+)\]/)[1].split(',').map((s) => s.trim());
  const allowed = script.match(/\[([^\]]*?)\]\.includes\(tag\)/)[1]
    .split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(choices.slice().sort(), allowed.slice().sort(),
    `워크플로 choice ${choices.join('|')} vs 스크립트 허용 ${allowed.join('|')}`);
});
