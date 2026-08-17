import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ★★ 버전 마커 함정 — 이 저장소의 배포 페이지는 **증분 패처**가 만든다.
 *
 * 클라이언트 코드(버튼·삭제·읽음)는 `<!-- NAME vN -->` 마커가 붙은 블록이고,
 * 교체는 "생성기 마커 ≠ 배포본 마커" 일 때만 일어난다. 그래서 문구·동작을 고쳐도
 * **버전을 안 올리면 배포 페이지에 영원히 안 들어간다.**
 *
 * 2026-08-18 실측으로 이것이 실제 사고였다:
 *   · 생성기 CURATION_BLOCK v7 ↔ 배포 3페이지 v6 — 삭제 확인 문구가 옛말을 하고 있었다
 *     ("아카이브는 유지됩니다" 라고 해놓고 서버는 분석 아카이브를 지웠다)
 *   · 읽음 스크립트는 **마커가 아예 없어서** 교체 경로 자체가 없었다.
 *     저장소 코드에는 `output/read_state.json` PUT 이 있는데 배포된 세 페이지에는
 *     그 코드가 **없었다**(`grep -c read_state.json` → 0 0 0). 읽음을 눌러도 러너는
 *     못 보고 다른 브라우저에도 안 넘어갔다.
 *
 * 이 검사는 **커밋된 실물 HTML** 을 본다. 픽스처를 쓰면 같은 오류를 같이 박고 있을 수
 * 있어서 의미가 없다(이 저장소가 `pubtypelist` 사건으로 배운 것).
 */

const PAGES = ['index.html', 'guidelines.html', 'reviews.html'];
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/**
 * 화면에 보이는 부분만 남긴다 — `<style>` 안의 CSS 주석까지 명칭 검사에 걸면
 * 눈에 안 보이는 글자 때문에 적색이 되고, 그러면 다음 사람이 검사를 느슨하게 만든다.
 * (스타일 블록은 `_buildPageRaw` 만 다시 쓰므로 배포본에서는 갱신되지 않는다.)
 */
const visible = (f) => read(f).replace(/<style>[\s\S]*?<\/style>/g, '');

/** 생성기 소스에서 현재 마커를 뽑는다 — 리터럴을 여기 또 적으면 두 곳이 갈린다. */
function generatorMarker(srcFile, name) {
  const src = read(srcFile);
  const m = src.match(new RegExp(`<!-- ${name} (v\\d+) -->`));
  assert.ok(m, `${srcFile} 에서 ${name} 마커를 못 찾았다 — 개명했으면 이 검사도 같이 고쳐라`);
  return m[1];
}

const BLOCKS = [
  { name: 'CURATION_BLOCK', src: 'src/utils/curation.js', pages: PAGES },
  { name: 'UPBTN', src: 'src/utils/GitHubPublisher.js', pages: PAGES },
  { name: 'READBTN', src: 'src/utils/GitHubPublisher.js', pages: PAGES },
  { name: 'ONDEMAND_WIDGET', src: 'src/utils/GitHubPublisher.js', pages: PAGES },
];

// ★ 대상을 4개 미만으로 찾으면 검사가 헛돌고 있는 것이다 — 이 저장소의 관례대로 실패시킨다.
test('★ 검사 대상이 실제로 잡혔다 (검사 무력화 방지)', () => {
  assert.ok(BLOCKS.length >= 4, `클라이언트 블록을 ${BLOCKS.length}개만 검사한다 — 검사가 헛돈다`);
});

for (const { name, src, pages } of BLOCKS) {
  test(`★★ ${name}: 배포본 버전이 생성기와 같다 (다르면 화면에 옛 코드가 산다)`, () => {
    const want = generatorMarker(src, name);
    for (const page of pages) {
      const got = read(page).match(new RegExp(`<!-- ${name} (v\\d+) -->`))?.[1];
      assert.equal(got, want,
        `${page} 의 ${name} 이 ${got ?? '없음'} — 생성기는 ${want}. `
        + '`node scripts/apply-page-render.mjs` 를 돌려 배포본을 맞춰라.');
    }
  });
}

test('★★ 읽음 체크가 배포본에서 저장소에 기록된다 (localStorage 로만 끝나지 않는다)', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /output\/read_state\.json/,
      `${page} 의 읽음 스크립트가 저장소에 안 올린다 — 러너가 "미독" 을 셀 수 없다`);
    assert.match(html, /method:'PUT'/, `${page} 에 읽음 PUT 이 없다`);
  }
});

test('★ 같은 페이지에 읽음 스크립트가 둘 붙지 않는다 (구판 잔존 시 이벤트 이중 발화)', () => {
  for (const page of PAGES) {
    const html = read(page);
    const count = (html.match(/var K='tr_read_v1'/g) ?? []).length;
    assert.equal(count, 1, `${page} 에 읽음 스크립트가 ${count}개 — 구판을 안 걷었다`);
  }
});

// ── 렌더 전용 경로가 클라이언트 블록까지 맞추는가 (배선 계약) ────────────────
// 버튼 워크플로(🗑·큐제어)는 `apply-page-render.mjs` 를 태운다. 여기서 안 맞추면
// **데일리가 돌기 전까지** 배포본이 옛 코드 그대로다 — 위 사고가 그래서 났다.
test('★★ apply-page-render 가 클라이언트 블록을 전부 보장한다 (배선 계약)', () => {
  const src = read('scripts/apply-page-render.mjs');
  for (const fn of ['_ensureOnDemandWidget', '_applyCuration', '_ensureArchiveStatus', '_ensureReadScript']) {
    assert.match(src, new RegExp(`publisher\\.${fn}\\(`),
      `apply-page-render 가 ${fn} 을 안 부른다 — 버튼을 눌러도 배포본이 옛 코드로 남는다`);
  }
});

test('★ publish 도 같은 블록들을 보장한다 (두 경로가 다른 페이지를 만들면 안 된다)', () => {
  const src = read('src/utils/GitHubPublisher.js');
  for (const fn of ['_ensureOnDemandWidget', '_applyCuration', '_ensureArchiveStatus', '_ensureReadScript']) {
    assert.match(src, new RegExp(`this\\.${fn}\\(updated`), `publish 가 ${fn} 을 안 부른다`);
  }
});

// ── 통계 칸: 페이지당 하나 (PeterJ 확정 2026-08-18) ──────────────────────────
test('★ 배포본 통계는 페이지당 카운트 하나 + 최종 업데이트', () => {
  for (const page of PAGES) {
    const html = read(page);
    const cards = (html.match(/<div class="sc">/g) ?? []).length;
    assert.equal(cards, 2, `${page} 의 통계 칸이 ${cards}개 — 카운트 하나 + 최종 업데이트여야 한다`);
    assert.ok(!html.includes('분석일수'), `${page} 에 분석일수 칸이 남았다`);
    assert.match(html, /<div class="l">최종 업데이트<\/div>/, `${page} 에 최종 업데이트가 없다`);
    assert.ok(!/180일\s*·\s*300편/.test(html), `${page} 에 옛 "180일 · 300편" 문구가 남았다`);
  }
});

// ── 리스트 명칭 통일 (PeterJ 확정 2026-08-18) ────────────────────────────────
test('★ 배포본이 확정 명칭을 쓴다 — 예정리스트 · 누적리스트', () => {
  for (const page of PAGES) {
    const html = visible(page);
    assert.match(html, /예정리스트/, `${page} 에 "예정리스트" 가 없다`);
    assert.match(html, /누적리스트/, `${page} 에 "누적리스트" 가 없다`);
    assert.ok(!html.includes('다음 7일 예고'), `${page} 에 옛 명칭 "다음 7일 예고" 가 남았다`);
    assert.ok(!html.includes('누적 아카이브'), `${page} 에 옛 명칭 "누적 아카이브" 가 남았다`);
  }
});
