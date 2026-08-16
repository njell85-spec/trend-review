import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrendReviewOrchestrator } from '../src/orchestrator/TrendReviewOrchestrator.js';
import { GitHubPublisher } from '../src/utils/GitHubPublisher.js';
import { trackRunsOn } from '../src/utils/trackCadence.js';
import { nextRunDates } from '../src/utils/upcomingSchedule.js';

/**
 * ★ 2026-08-16 코드리뷰 발견 B2 — 배포 페이지 세 곳에 트랙 on/off/격일 토글이 있는데
 *   **`mode` 를 읽는 게이트가 리뷰 하나뿐이었다.** PeterJ 가 "논문 · 꺼짐" 을 눌러도
 *   화면과 예고만 꺼진 것처럼 보이고 다음 데일리는 논문을 그대로 발행했다.
 *   버튼이 거짓말을 하는 것은 이 저장소가 반복해서 낸 사고의 정확히 같은 얼굴이다.
 *
 * 여기서 잠그는 것은 **"화면이 말하는 것과 게이트가 하는 것이 같다"** 하나다.
 */

const ROOT = new URL('..', import.meta.url).pathname;
const TRACKS = ['papers', 'guidelines', 'reviews'];
const DAYS = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];

test('★ 예고가 그리는 날과 게이트가 허락하는 날이 모든 모드에서 일치한다', () => {
  for (const track of TRACKS) {
    for (const mode of ['on', 'off', 'alternate']) {
      for (const sequential of [false, true]) {
        const drawn = new Set(nextRunDates({ from: DAYS[0], days: DAYS.length, mode, sequential, track }));
        for (const d of DAYS) {
          assert.equal(drawn.has(d), trackRunsOn(track, d, { mode, sequential }),
            `${track}/${mode}/seq=${sequential} ${d}: 예고와 게이트가 다르다`);
        }
      }
    }
  }
});

test('★ off 는 어떤 트랙에서도 아무 날도 허락하지 않는다', () => {
  for (const track of TRACKS) {
    for (const d of DAYS) assert.equal(trackRunsOn(track, d, { mode: 'off' }), false);
    assert.deepEqual(nextRunDates({ from: DAYS[0], days: 7, mode: 'off', track }), []);
  }
});

test('★ on 은 매일이다 (4-A) — 과잉 차단이면 여기서 잡힌다', () => {
  for (const track of TRACKS) {
    for (const d of DAYS) assert.equal(trackRunsOn(track, d, { mode: 'on' }), true);
  }
});

// ── 실제 파이프라인이 그 판정을 따르는가 ────────────────────────────────────
async function sandbox(control) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tr-toggle-'));
  await mkdir(path.join(dir, 'output'), { recursive: true });
  await writeFile(path.join(dir, 'output', 'control_state.json'), JSON.stringify(control));
  for (const f of ['index.html', 'guidelines.html', 'reviews.html']) {
    if (existsSync(path.join(ROOT, f))) await copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  return dir;
}

test('★ 논문 트랙을 끄면 그날 논문 카드가 페이지에 안 올라간다', async () => {
  const paper = { paper: { pmid: '55555', title: 'Toggle Test', journal: 'NEJM' }, title_ko: '토글 시험 논문' };

  for (const [mode, shouldPublish] of [['on', true], ['off', false]]) {
    const dir = await sandbox({ tracks: { papers: { mode } } });
    const o = new TrendReviewOrchestrator({ controlStatePath: path.join(dir, 'output', 'control_state.json') });
    const control = await o._loadControl();
    const due = trackRunsOn('papers', '2026-08-17',
      { mode: control.tracks.papers.mode, sequential: control.sequential });
    assert.equal(due, shouldPublish, `mode=${mode} 판정이 틀렸다`);

    // 판정 그대로 발행 경로에 넘겨 화면 결과까지 확인한다.
    const pub = new GitHubPublisher({ owner: 'njell85-spec', repo: 'trend-review', repoPath: dir });
    pub._gitPush = () => {};
    await pub.publish('2026-08-17', due ? [paper] : [], {});
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    assert.equal(html.includes('토글 시험 논문'), shouldPublish,
      `mode=${mode} 인데 화면 결과가 반대다 — 버튼이 거짓말한다`);
  }
});

test('★ 게이트가 mode 를 실제로 읽는다 (소스에 배선이 남아 있는지)', async () => {
  const src = await readFile(new URL('../src/orchestrator/TrendReviewOrchestrator.js', import.meta.url), 'utf8');
  for (const track of TRACKS) {
    assert.match(src, new RegExp(`tracks\\.${track}\\.mode`),
      `${track} 트랙의 mode 를 읽는 곳이 없다 — 토글이 아무것도 안 막는다`);
  }
  assert.equal((src.match(/trackRunsOn\(/g) ?? []).length >= 3, true,
    '세 트랙이 모두 공통 판정을 부르지 않는다');
});


/**
 * ★ 코드리뷰 발견 B9 — 논문이 쉬는 날 종전 코드는 **수집·재순위·풀텍스트·PICO·검증을
 *   전부 돌린 뒤 결과를 버렸다.** LLM 비용이 3배가 되고, 더 나쁜 것은 리포트·텔레그램이
 *   버려질 논문을 그대로 알렸다는 점이다(화면에는 없는 논문을 알림으로 받는다).
 *   이제 게이트가 수집 **앞**에 있어 애초에 뽑지 않는다.
 */
test('★ 논문이 쉬는 날에는 수집·분석을 아예 안 돌린다 (비용·정합성)', async () => {
  const dir = await sandbox({ tracks: { papers: { mode: 'off' } } });
  const o = new TrendReviewOrchestrator({ controlStatePath: path.join(dir, 'output', 'control_state.json') });

  const called = [];
  for (const stage of ['_stageCollect', '_stageValidate1', '_stageAnalyze', '_stageFetchFullText',
    '_stagePicoAnalysis', '_stageValidate2', '_stageReport']) {
    o[stage] = async () => { called.push(stage); return {}; };
  }
  o._stageGuideline = async () => null;
  o._stageReview = async () => ({ outcome: 'empty' });
  let publishedPapers = null;
  o._stagePublish = async (papers) => { publishedPapers = papers; return 'pages'; };
  o._stageNotify = async () => null;
  o.logger.saveSession = async () => {};

  const result = await o.run();
  assert.deepEqual(called, [], `쉬는 날인데 단계가 돌았다: ${called.join(', ')}`);
  assert.deepEqual(publishedPapers, [], '쉬는 날인데 논문이 발행 경로로 갔다');
  // ★ 진입점이 이 값으로 텔레그램을 만든다 — 비어야 "논문 없음" 이 그대로 전달된다.
  assert.deepEqual(result.topPapers, [], '쉬는 날인데 결과에 논문이 실렸다 — 알림이 거짓말한다');
  assert.equal(result.skipped, 'papers');
});

test('★ 논문이 도는 날에는 파이프라인이 정상으로 돈다 (과잉 차단이면 여기서 잡힌다)', async () => {
  const dir = await sandbox({ tracks: { papers: { mode: 'on' } } });
  const o = new TrendReviewOrchestrator({ controlStatePath: path.join(dir, 'output', 'control_state.json') });
  let collected = false;
  o._stageCollect = async () => { collected = true; return { papers: [{ pmid: 'p1' }], stats: {} }; };
  o._stageValidate1 = async (papers) => ({ papers, stats: {} });
  o._buildSelectionPool = (papers) => papers;
  o._saveTrack1Queue = async () => {};
  o._loadExcludePmids = async () => [];
  o._stageAnalyze = async (papers) => ({ topPapers: papers, allScoredPapers: papers, rerank: null });
  o._stageFetchFullText = async (papers) => papers;
  o._stagePicoAnalysis = async (papers) => ({ topPapers: papers, stats: {} });
  o._stageValidate2 = async (papers) => ({ validated: papers, qualityReport: {} });
  o._stageReport = async () => ({ jsonPath: 'r.json', htmlPath: 'r.html' });
  o._stageGuideline = async () => null;
  o._stageReview = async () => ({ outcome: 'empty' });
  o._saveExcludePmids = async () => {};
  let publishedPapers = null;
  o._stagePublish = async (papers) => { publishedPapers = papers; return 'pages'; };
  o._stageNotify = async () => null;
  o.logger.saveSession = async () => {};

  await o.run();
  assert.equal(collected, true, '켜져 있는데 수집을 건너뛰었다');
  assert.equal(publishedPapers.length, 1, '켜져 있는데 논문이 발행되지 않았다');
});
