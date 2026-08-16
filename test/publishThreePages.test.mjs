import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';

/**
 * ★ 발행 경로 전체를 실제로 한 번 돌린다.
 *
 * 이 저장소가 아홉 번 넘게 밟은 함정은 **"모듈은 옳은데 아무도 안 부른다"** 다.
 * `pageSplit` 단위 테스트가 아무리 초록이어도 `publish()` 가 그것을 안 부르면 화면은
 * 안 바뀐다 — 실제로 예고 렌더가 그 상태였고(아무도 안 불렀다), 리뷰 카드도 그랬다
 * (큐만 소비하고 렌더가 없었다). 그래서 여기서는 `publish()` 를 통째로 돌려
 * **파일 세 개가 실제로 기록되는지**를 본다.
 */

/**
 * ★ 픽스처는 **합성**이다 — 배포 실물을 쓰지 않는다 (2026-08-17).
 *   종전에는 저장소의 index/guidelines/reviews.html 을 복사해 썼는데, 실물에 리뷰가
 *   하나 발행되자마자 "리뷰 섹션이 정확히 하나" 같은 검사가 통째로 깨졌다.
 *   더 나쁜 것은 반대 방향이다 — 실물이 이미 기능이 적용된 결과물이라 **기능을 없애는
 *   변이도 통과**한다(코드리뷰 발견 B5 와 같은 함정). 바닥을 직접 만든다.
 */
const SCAFFOLD = () => `<!DOCTYPE html>
<html lang="ko"><head><title>EM/CCM Trend Review</title></head><body>
<div class="wrap">
  <header class="hd"><h1>EM/CCM Trend Review</h1><div class="fn">180일 · 1편/일</div></header>
  <div class="stats">
    <div class="sc"><div class="n stat-days-count">1</div><div class="l">분석일수</div></div>
    <div class="sc"><div class="n stat-papers-count">1</div><div class="l">선정 논문</div></div>
    <div class="sc"><div class="n"><span class="stat-updated-time">2026. 08. 16. 07:00</span></div><div class="l">최종 업데이트</div></div>
  </div>
  <div class="archive">
<!-- ARCHIVE_START -->
<!-- SECTION:2026-08-16 -->
<details class="day day-past"><article class="paper-card">기존 논문</article></details>
<!-- /SECTION:2026-08-16 -->
  </div>
  <div class="arch-table">
    <div class="at-head"><span class="at-title">📚 누적</span><span class="at-count">1편</span></div>
    <div class="at-scroll"><table><tbody><!-- TABLE_ROWS_START --><tr data-pmid="11111"><td class="c-date">2026-08-16</td><td class="c-jour">NEJM</td><td class="c-title"><a href="#">기존 논문</a></td><td class="c-read"><input class="readcb"></td></tr><!-- TABLE_ROWS_END --></tbody></table></div>
  </div>
</div></body></html>`;

async function sandbox() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-pub3-'));
  await mkdir(path.join(dir, 'output'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), SCAFFOLD());
  // guidelines/reviews 는 **일부러 안 만든다** — 첫 실행(마이그레이션) 경로가 그것이다.
  await writeFile(path.join(dir, 'output', 'queue_papers.json'),
    JSON.stringify({ schemaVersion: 1, track: 'papers', queue: [], published: [], rejected: [] }));
  return dir;
}

const PAPER = {
  paper: { pmid: '99999', title: 'E2E Test Paper', journal: 'NEJM', pubDate: '2026-08' },
  title_ko: 'E2E 시험 논문',
};
const REVIEW = { pmid: '88888', title: 'E2E Review Article', journal: 'Lancet', score: 9.1, topic: 'sepsis' };

const count = (h, re) => (h.match(re) ?? []).length;

async function runPublish() {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};   // 커밋은 이 검사의 대상이 아니다(publishStaging.test.mjs 가 본다)
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const read = async (f) => readFile(path.join(dir, f), 'utf8');
  return { index: await read('index.html'), guidelines: await read('guidelines.html'), reviews: await read('reviews.html') };
}

test('★ publish 한 번에 세 페이지가 모두 기록된다', async () => {
  const p = await runPublish();
  for (const [name, html] of Object.entries(p)) {
    assert.ok(html && html.length > 1000, `${name}.html 이 기록되지 않았다`);
  }
});

test('★ 카드가 제 페이지로 간다 — 논문은 index, 리뷰는 reviews', async () => {
  const p = await runPublish();
  assert.ok(p.index.includes('E2E 시험 논문'), '논문 카드가 index 에 없다');
  assert.equal(p.reviews.includes('E2E 시험 논문'), false, '논문 카드가 리뷰 페이지로 샜다');

  // ★ 이것이 B3 회귀다 — 리뷰는 발행되는데 화면에 아무것도 안 나오던 상태.
  assert.ok(p.reviews.includes('E2E Review Article'), '리뷰 카드가 화면에 안 나온다');
  assert.equal(count(p.reviews, /<!-- RSECTION:/g), 1, '리뷰 섹션이 정확히 하나가 아니다');
  assert.match(p.reviews, /data-kind="review"/, '리뷰 표 행이 없다');
  assert.equal(p.index.includes('E2E Review Article'), false, '리뷰가 논문 페이지로 샜다');
  assert.equal(p.guidelines.includes('E2E Review Article'), false, '리뷰가 가이드라인 페이지로 샜다');
});

test('★ 새로 발행한 오늘 카드도 접혀 있다 (요구 ③)', async () => {
  const p = await runPublish();
  for (const [name, html] of Object.entries(p)) {
    assert.equal(count(html, /<details open/g), 0, `${name}.html 에 펼쳐진 카드가 있다`);
  }
  assert.match(p.index, /<details class="day day-today">/, '오늘 카드 자체가 없다 — 이 검사는 헛돈다');
});

test('★ 페이지마다 자기 트랙 예고만 붙는다 (요구 ②)', async () => {
  const p = await runPublish();
  const own = { index: 'papers', guidelines: 'guidelines', reviews: 'reviews' };
  for (const [file, track] of Object.entries(own)) {
    assert.equal(count(p[file], new RegExp(`<!-- UPCOMING:${track} -->`, 'g')), 1,
      `${file}.html 에 ${track} 예고가 하나가 아니다`);
    for (const other of Object.values(own)) {
      if (other === track) continue;
      assert.equal(count(p[file], new RegExp(`<!-- UPCOMING:${other} -->`, 'g')), 0,
        `${file}.html 에 남의 트랙 예고(${other})가 있다`);
    }
  }
});

test('★ 두 번 발행해도 카드·행이 늘지 않는다 (멱등 — 같은 날 재실행)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const once = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW });
  const twice = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  assert.equal(count(twice, /<!-- RSECTION:/g), count(once, /<!-- RSECTION:/g), '리뷰 섹션이 늘었다');
  assert.equal(count(twice, /data-kind="review"/g), count(once, /data-kind="review"/g), '리뷰 표 행이 늘었다');

  const idx = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.equal(count(idx, /<!-- SECTION:2026-08-17 -->/g), 1, '같은 날 논문 섹션이 둘이 됐다');
});

test('★ 리뷰가 없는 날에도 세 페이지가 그대로 나간다 (데일리 코어 무영향)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], {});   // review 없음
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    const html = await readFile(path.join(dir, f), 'utf8');
    assert.ok(html.length > 1000, `${f} 가 기록되지 않았다`);
  }
  const idx = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.ok(idx.includes('E2E 시험 논문'), '리뷰가 없다고 논문이 안 나갔다');
});


/**
 * ★ 치명 회귀 B1 — `publish()` 의 표 행 삽입이 함수형 replacer 가 아니었다.
 *   `newRows` 에는 **LLM 이 만든 제목**이 들어가는데, 거기에 `$&` 나 `` $` `` 가 있으면
 *   문자열 치환이 그것을 특수 패턴으로 해석해 본문을 통째로 복제한다.
 *   실측: 제목 하나로 index.html 이 575KB → 1.37MB 가 됐고 `TABLE_ROWS_START` 마커가
 *   행 안쪽에 복제돼 다음 실행의 삽입 앵커까지 어긋났다.
 *   `esc()` 는 `&` 를 `&amp;` 로 바꿀 뿐 `$&` 는 그대로 두므로 방어가 안 된다.
 */
test('★ 제목에 $& 가 있어도 페이지가 폭발하지 않는다 (치명 회귀 B1)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  const before = (await readFile(path.join(dir, 'index.html'), 'utf8')).length;

  const evil = {
    paper: { pmid: '77777', title: 'x', journal: 'NEJM' },
    title_ko: '비용 $& 효과 $` 분석 $\'',
  };
  await pub.publish('2026-08-17', [evil], {});
  const after = await readFile(path.join(dir, 'index.html'), 'utf8');

  // ★ 크기가 아니라 **구조**로 잰다. `` $` `` 는 매치 앞부분 전체를 끼워 넣으므로
  //   페이지가 자기 머리를 통째로 복제한다 — 마커가 둘이 되는 것이 그 지문이다.
  //   (크기 비교는 스캐폴드가 작을 때 정상 성장과 구분이 안 된다.)
  for (const [label, re] of [
    ['행 삽입 앵커', /<!-- TABLE_ROWS_START -->/g],
    ['행 종료 앵커', /<!-- TABLE_ROWS_END -->/g],
    ['보관 시작 마커', /<!-- ARCHIVE_START -->/g],
    ['문서 제목', /<title>/g],
  ]) {
    assert.equal(count(after, re), 1,
      `${label} 가 복제됐다 — 치환이 $& 를 패턴으로 해석해 본문을 통째로 끼워 넣었다`);
  }
  // ★ **발행이 실제로 성공했는지**까지 본다. 치환이 본문을 망가뜨리면 표 구조가 깨져
  //   분할이 소프트 폴백으로 떨어지고, 그때는 페이지를 건드리지 않는다(B15 방어).
  //   페이지가 안전한 것과 그날 논문이 나간 것은 다른 말이다 — 길이·마커만 보면
  //   "아무 일도 안 일어난 것" 을 통과로 착각한다.
  assert.ok(after.includes('77777'), '그날 논문이 페이지에 안 올라갔다 — 발행이 조용히 무산됐다');
  assert.ok(after.length > before, '페이지가 전혀 갱신되지 않았다');
});

/**
 * ★ 코드리뷰 발견 B16 — 식별자 없는 리뷰는 카드 중복 제거도 행 dedup 도 돌지 않아
 *   매 실행 무한히 쌓인다. 못 지우는 것을 만들지 않는다.
 */
test('★ 식별자 없는 리뷰는 발행하지 않는다 (지울 방법이 없는 것을 만들지 않는다)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], { review: { title: '식별자 없는 리뷰', journal: 'X' } });
  const rev = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  assert.equal(rev.includes('식별자 없는 리뷰'), false, '식별자 없는 리뷰가 발행됐다');
  assert.equal(count(rev, /<!-- RSECTION:/g), 0);
});


/**
 * ★ PeterJ 지시 2026-08-17 — 리뷰도 **번역·정리해서** 보여준다.
 *   종전 카드에는 제목·저널·점수뿐이었다("리뷰아티클 자료분석이 전혀없는데?").
 *   기준은 NEJM syncope 참고자료 카드다 — 한글 제목·원제·한글 요약·핵심 내용.
 */
const REVIEW_WITH_CARD = {
  pmid: '55555', title: 'Syncope.', journal: 'NEJM',
  card: {
    type: 'reference',
    title_ko: '실신(Syncope)',
    paper: { pmid: '55555', title: 'Syncope.', journal: 'The New England journal of medicine', pubDate: '2026-08' },
    summary_ko: 'NEJM Clinical Practice 코너의 실신 종설이다.',
    org: 'NEJM — Clinical Practice review',
  },
};

test('★ 분석 카드가 있으면 번역된 내용이 리뷰 페이지에 실린다', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], { review: REVIEW_WITH_CARD });
  const rev = await readFile(path.join(dir, 'reviews.html'), 'utf8');

  assert.ok(rev.includes('실신(Syncope)'), '한글 제목이 없다');
  assert.match(rev, /📰 리뷰 아티클/, '리뷰 칩이 없다');
  assert.equal(rev.includes('🔖 참고자료'), false, '참고자료 칩이 그대로 남았다');
  assert.equal(rev.includes('본문 정리를 만들지 못했습니다'), false, '카드가 있는데 폴백이 나왔다');
});

test('★ 분석이 실패해도 무엇이 나갔는지는 남는다 (얇은 카드 > 빈 카드)', async () => {
  const dir = await sandbox();
  const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
  pub._gitPush = () => {};
  await pub.publish('2026-08-17', [PAPER], { review: { pmid: '66666', title: 'Some review.', journal: 'Lancet' } });
  const rev = await readFile(path.join(dir, 'reviews.html'), 'utf8');
  assert.ok(rev.includes('Some review.'), '제목조차 안 남았다');
  assert.match(rev, /본문 정리를 만들지 못했습니다/, '실패를 숨겼다 — 화면이 정상인 척한다');
});
