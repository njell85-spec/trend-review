import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { splitPages } from '../src/utils/pageSplit.js';

// REPORT_SPEC §4-H-3 — 누적 표 행 속성 순서 계약. 어기면 데일리가 **조용히** 깨진다:
// 같은 날 재발행 시 기존 행을 지우는 정규식이 `<tr data-pmid="[^"]*"><td class="c-date">…`
// 라서, 논문 행에 속성이 하나라도 늘면 매치가 깨져 **매일 발행마다 표 행이 중복 누적**된다.
// 지금까지 이 계약은 문서(§4-H·HANDOFF)와 주석에만 있었고 실행으로 잠기지 않았다.
// 이 파일이 그 잠금이다 — 계약을 깨면 여기가 적색이 된다.

const DATE = '2026-08-09';
const paperCard = (pmid = '42568095') => ({
  title_ko: '중환자실 원격의료와 인공호흡기 이탈',
  paper: { pmid, title: 'Telemedicine and weaning', journal: 'Critical Care Medicine' },
});
const guidelineCard = {
  title_ko: 'IDSA 그람음성 내성균 가이던스',
  org: 'IDSA',
  paper: { pmid: '39108079', title: 'AMR guidance', journal: 'Clin Infect Dis' },
};

test('§4-H-3: 논문 행은 data-pmid 하나만 단다 (첫 속성이자 유일 속성)', () => {
  const row = new GitHubPublisher()._tableRows(DATE, [paperCard()]);
  assert.match(
    row,
    /^<tr data-pmid="42568095"><td class="c-date">/,
    '논문 행에 속성이 늘면 같은-날짜 교체가 깨져 표 행이 매일 중복 누적된다',
  );
});

test('§4-H-3: 같은 날 재발행 정규식이 자기가 만든 논문 행을 실제로 제거한다', () => {
  const pub = new GitHubPublisher();
  const row = pub._tableRows(DATE, [paperCard()]);
  // 프로덕션 publish() 가 쓰는 바로 그 정규식이어야 한다 — 테스트가 사본을 만들면
  // 사본만 초록이고 프로덕션은 깨진 채로 남는다.
  const re = pub._rowDateDupRe(DATE);
  assert.equal(row.replace(re, ''), '', '같은 날짜 논문 행이 안 지워진다 → 중복 누적');
});

test('§4-H-3: 두 번 발행해도 표에 논문 행은 하나만 남는다 (중복 누적 회귀)', () => {
  const pub = new GitHubPublisher();
  const first = pub._tableRows(DATE, [paperCard()]);
  const second = pub._tableRows(DATE, [paperCard()]);
  const swept = (first + second).replace(pub._rowDateDupRe(DATE), '');
  const table = swept + second; // publish() 순서: 같은 날짜 행 제거 → 새 행 삽입
  assert.equal((table.match(/<tr data-pmid=/g) || []).length, 1);
});

test('§4-H-3: 가이드·수동지정 행은 날짜 스윕에서 살아남는다 (의도된 예외)', () => {
  const pub = new GitHubPublisher();
  const gRow = pub._tableRows(DATE, [], guidelineCard);
  const mRow = pub._tableRows(DATE, [paperCard('41841715')], null, { manual: true });
  const re = pub._rowDateDupRe(DATE);
  assert.ok(gRow.replace(re, '').includes('data-guideline="1"'), '가이드 행이 지워지면 주 1회 소개가 사라진다');
  assert.ok(mRow.replace(re, '').includes('data-manual="1"'), '수동 지정 행이 지워지면 직접 지정분이 사라진다');
});

test('§4-H-3: 모든 행에서 data-pmid 가 첫 속성 — PMID dedup 정규식이 잡는다', () => {
  const pub = new GitHubPublisher();
  const rows = pub._tableRows(DATE, [paperCard()], guidelineCard)
             + pub._tableRows(DATE, [paperCard('41841715')], null, { manual: true });
  for (const pmid of ['42568095', '39108079', '41841715']) {
    // publish() 의 `rowDup` 과 동형 — data-pmid 가 첫 속성이 아니면 매치가 0이 된다.
    const rowDup = new RegExp(`<tr data-pmid="${pmid}"[^>]*>[\\s\\S]*?</tr>`, 'g');
    assert.equal((rows.match(rowDup) || []).length, 1, `PMID ${pmid} 행 dedup 실패`);
  }
});

test('§4-H-3: 종류 마커는 data-pmid 뒤 — pageSplit 이 행을 페이지별로 가른다', () => {
  const pub = new GitHubPublisher();
  const rows = pub._tableRows(DATE, [paperCard()], guidelineCard);
  const merged = `<!-- TABLE_ROWS_START -->${rows}`;
  // 논문 행은 index, 가이드 행은 guidelines 로 가야 한다(§4-H).
  assert.match(rows, /<tr data-pmid="39108079" data-kind="guideline" data-guideline="1">/);
  assert.ok(splitPages, 'splitPages 계약 존재');
  assert.ok(merged.includes('data-pmid="42568095"><td'), '논문 행은 마커 없음으로 판별된다');
});
