/**
 * archiveStatus(§4-E) — "아카이브 저장 현황" 섹션의 서버측 계약 검증.
 * ① 본문 출처 분류(OA/웹/초록)·PDF·전문Doc 집계 ② 게이트(display:none + tr_pat)·접힘
 * ③ 메타데이터만(본문 텍스트 미노출) ④ ensure 멱등(교체·중복 없음)·소프트.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArchiveStatusRows, archiveStatusBlock, ensureArchiveStatus, ARCHIVE_STATUS_VERSION,
} from '../src/utils/archiveStatus.js';

const sampleArchive = () => ({
  entries: [
    { date: '2026-07-06', pmid: 'A1', title: 'OA paper', fullText: 'BODY-SECRET-TEXT', fullTextSource: 'PMC', dossier: [] },
    { date: '2026-07-05', pmid: 'A2', title: 'Paywalled', fullText: null, fullTextSource: 'abstract-only', dossier: [{ url: 'x' }] },
    { date: '2026-07-04', pmid: 'A3', title: 'Abstract only', fullText: null, fullTextSource: 'abstract-only', dossier: [] },
  ],
  driveState: {
    pdfFiles: { A1: 'file1' },
    fulltextDone: { '2026-07': ['A1', 'A2'] },
  },
});

test('분류·집계: OA/웹/초록 + PDF + 전문Doc', () => {
  const { counts } = buildArchiveStatusRows(sampleArchive());
  assert.equal(counts.total, 3);
  assert.equal(counts.oa, 1);   // A1 (fullText 있음)
  assert.equal(counts.web, 1);  // A2 (fullText 없고 dossier 있음)
  assert.equal(counts.abs, 1);  // A3 (fullText·dossier 없음)
  assert.equal(counts.pdf, 1);  // A1만 pdfFiles
});

test('최신 선정일 우선 정렬', () => {
  const { rows } = buildArchiveStatusRows(sampleArchive());
  assert.ok(rows.indexOf('2026-07-06') < rows.indexOf('2026-07-05'));
  assert.ok(rows.indexOf('2026-07-05') < rows.indexOf('2026-07-04'));
});

test('전문Doc 포함 여부는 fulltextDone 기준(달별)', () => {
  const { rows } = buildArchiveStatusRows(sampleArchive());
  // A1·A2는 전문Doc ✓, A3는 –. ✓/– 개수로 계약 확인
  assert.equal((rows.match(/전문Doc <span class="as-b as-y">✓/g) || []).length, 2);
  assert.equal((rows.match(/전문Doc <span class="as-b as-n">–/g) || []).length, 1);
});

test('블록: 버전 마커·게이트(display:none)·접힘·본문 텍스트 미노출', () => {
  const html = archiveStatusBlock(sampleArchive());
  assert.match(html, new RegExp(`<!-- ARCHIVE_STATUS ${ARCHIVE_STATUS_VERSION} -->`));
  assert.match(html, /<!-- \/ARCHIVE_STATUS -->/);
  assert.match(html, /id="as-wrap" style="display:none"/);           // 기본 숨김
  assert.match(html, /localStorage\.getItem\('tr_pat'\)/);            // 토큰 있을 때만 해제
  assert.ok(!/<details class="as-box" open>/.test(html), '기본 접힘(details에 open 없음)');
  assert.ok(!html.includes('BODY-SECRET-TEXT'), '본문 텍스트가 노출되면 안 됨');
});

test('ensure: 푸터 앞 주입 + 멱등 교체(중복 없음)', () => {
  const page = '<body>\n<div class="arch-table">…</div>\n  <div class="ft">footer</div>\n</body>';
  const once = ensureArchiveStatus(page, sampleArchive());
  assert.equal((once.match(/<!-- ARCHIVE_STATUS/g) || []).length, 1);
  assert.ok(once.indexOf('ARCHIVE_STATUS') < once.indexOf('class="ft"'), '푸터 앞에 위치');
  // 다시 적용해도 블록은 하나만(교체) — 데이터 갱신 시나리오
  const twice = ensureArchiveStatus(once, sampleArchive());
  assert.equal((twice.match(/<!-- ARCHIVE_STATUS v1 -->/g) || []).length, 1);
});

test('ensure: 앵커·기존 블록 없으면 원본 유지(소프트)', () => {
  const noAnchor = '<body>내용만 있고 푸터 없음</body>';
  assert.equal(ensureArchiveStatus(noAnchor, sampleArchive()), noAnchor);
});

test('빈 아카이브도 안전(0건 렌더)', () => {
  const html = archiveStatusBlock({ entries: [], driveState: {} });
  assert.match(html, /아직 아카이브된 항목이 없습니다/);
  assert.match(html, /총 <b>0건<\/b>/);
});
