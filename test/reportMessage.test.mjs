import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReportMessages, buildFailureText } from '../src/utils/reportMessage.js';
import { TelegramNotifier } from '../src/agents/TelegramNotifier.js';

// ── 메시지 포맷 정본 (REPORT_SPEC §2) — 채널을 바꿔도 텍스트는 그대로여야 한다 ──
//
// ★ 2026-08-18 개정: **빈 줄이 규격의 일부다** (PeterJ 확정 — 가독성).
//   [trend-review] / 빈 줄 / 날짜 / 제목 / 저널·PMID / 빈 줄 / 📊 링크
//   줄 인덱스를 그대로 못 박는다 — 빈 줄이 사라지면 적색이 되어야 한다.
// ★★ 2026-08-18 2차 개정 — **세 트랙을 다 싣는다** (PeterJ 실측 피드백:
//    "그날 선정된 논문리스트만 있음. 논문 가이드라인 리뷰 각각 모두 제시").
const THREE = {
  dateStr: '2026-08-18',
  topPaper: { title_ko: 'Part 9: 성인 전문소생술', paper: { journal: 'Circulation', pmid: '41122884' } },
  guideline: { title_ko: '2026 급성 허혈성 뇌졸중 지침', paper: { journal: 'Stroke', pmid: '41582814' } },
  review: { pmid: '41765030', card: { title_ko: '패혈증(Sepsis)', paper: { journal: 'Lancet (London, England)', pmid: '41765030' } } },
  pagesUrl: 'https://njell85-spec.github.io/trend-review/',
};

test('★★ 세 트랙이 다 실리고 블록 사이가 빈 줄이다', () => {
  const [msg, ...rest] = buildReportMessages(THREE);
  assert.equal(rest.length, 0);
  assert.equal(msg, [
    '[trend-review]',
    '',
    '2026-08-18',
    '',
    '📄 논문',
    'Part 9: 성인 전문소생술',
    'Circulation · #41122884',
    '',
    '📋 가이드라인',
    '2026 급성 허혈성 뇌졸중 지침',
    'Stroke · #41582814',
    '',
    '📰 리뷰',
    '패혈증(Sepsis)',
    'Lancet (London, England) · #41765030',
    '',
    '📊 https://njell85-spec.github.io/trend-review/',
  ].join('\n'));
  assert.ok(!/🥇/u.test(msg));
});

test('★ 트랙 순서는 화면 탭 순서와 같다 — 논문 → 가이드라인 → 리뷰', () => {
  const [msg] = buildReportMessages(THREE);
  const order = ['📄 논문', '📋 가이드라인', '📰 리뷰'].map((l) => msg.indexOf(l));
  assert.ok(order.every((v) => v > 0), '트랙 라벨이 빠졌다');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '트랙 순서가 화면과 다르다');
});

test('★ 나간 트랙만 싣는다 — 없는 트랙의 빈 블록을 만들지 않는다', () => {
  const [msg] = buildReportMessages({ ...THREE, guideline: null, review: null });
  assert.ok(msg.includes('📄 논문'));
  assert.ok(!msg.includes('📋 가이드라인'));
  assert.ok(!msg.includes('📰 리뷰'));
  assert.ok(!/\n\n\n/.test(msg), '빈 블록 자리에 줄이 겹쳐 남았다');
});

test('★ 논문이 없고 가이드라인·리뷰만 나간 날도 알린다', () => {
  const [msg] = buildReportMessages({ ...THREE, topPaper: null });
  assert.ok(!msg.includes('📄 논문'));
  assert.ok(msg.includes('📋 가이드라인'));
  assert.ok(msg.includes('📰 리뷰'));
});

test('발행이 하나도 없으면 그렇게 말한다 (빈 알림은 고장과 구분이 안 된다)', () => {
  const [msg] = buildReportMessages({ dateStr: '2026-08-18', pagesUrl: 'https://x/' });
  assert.match(msg, /오늘 발행된 것이 없습니다/);
  assert.match(msg, /📊 https:\/\/x\//);
});

test('리뷰 큐 항목 모양(card 안에 분석)을 흡수한다', () => {
  const [msg] = buildReportMessages({
    dateStr: '2026-08-18',
    review: { pmid: '9', journal: 'ICM', card: { title_ko: '리뷰 제목' } },
    pagesUrl: 'https://x/',
  });
  assert.ok(msg.includes('리뷰 제목'));
  assert.ok(msg.includes('ICM · #9'));
});

test('buildReportMessages: 링크 미지정이면 대시보드 폴백', () => {
  const msgs = buildReportMessages({ dateStr: '2026-08-04', topPaper: {} });
  assert.ok(msgs.join('\n').includes('https://njell85-spec.github.io/trend-review/'));
});

// ★ 200자 2건 분할은 없앴다 — 카카오 상한에서 온 규칙이고, 살아 있으면 긴 제목일 때
//   본문이 갈리면서 위 빈 줄 배치가 깨진다. 대신 4096 초과 때만 제목을 자른다.
test('★ 제목이 길어도 본문은 1건 · 잘리지 않는다 (분할 금지)', () => {
  const long = '가'.repeat(300);
  const msgs = buildReportMessages({
    dateStr: '2026-08-04',
    topPaper: { title_ko: long, paper: { journal: 'J', pmid: '1' } },
  });
  assert.equal(msgs.length, 1, '분할이 되살아났다 — 빈 줄 규격이 깨진다');
  assert.ok(msgs[0].includes(long), '300자 제목은 잘리면 안 된다(상한 안)');
  assert.ok(msgs[0].includes('J · #1'));
});

test('초장문 제목은 텔레그램 상한 안으로 자르되 구조를 지킨다', () => {
  const msgs = buildReportMessages({
    dateStr: '2026-08-04',
    topPaper: { title_ko: '가'.repeat(9000), paper: { journal: 'J', pmid: '1' } },
  });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].length <= 4096, `텔레그램 상한 초과: ${msgs[0].length}`);
  const lines = msgs[0].split('\n');
  assert.equal(lines[0], '[trend-review]');
  assert.equal(lines[1], '');
  assert.equal(lines.at(-2), '', '링크 앞 빈 줄이 없다');
  assert.match(lines.at(-1), /^📊 /);
  assert.ok(/…/.test(msgs[0]), '잘랐으면 …로 표시해야 한다');
});

test('buildFailureText: 사유를 그대로 싣고 195자 이내', () => {
  const t = buildFailureText({ dateStr: '2026-08-04', reason: 'Claude 세션 한도(429)' });
  assert.ok(t.includes('Claude 세션 한도(429)'));
  assert.ok(t.length <= 195);
});

// ── 채널: 미설정이면 조용히 생략 (소프트 게이트 — 파이프라인을 세우지 않는다) ──
const unconfigured = () => {
  const prev = { t: process.env.TELEGRAM_BOT_TOKEN, c: process.env.TELEGRAM_CHAT_ID };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const n = new TelegramNotifier();
  if (prev.t !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev.t;
  if (prev.c !== undefined) process.env.TELEGRAM_CHAT_ID = prev.c;
  return n;
};

test('TelegramNotifier: 미설정이면 send/sendFailure/sendNotice 모두 {sent:false}', async () => {
  const n = unconfigured();
  assert.equal(n.isConfigured, false);
  assert.deepEqual(await n.send({ dateStr: '2026-08-04', topPaper: {} }), { sent: false, reason: 'not-configured' });
  assert.deepEqual(await n.sendFailure({ dateStr: '2026-08-04', reason: 'x' }), { sent: false, reason: 'not-configured' });
  assert.deepEqual(await n.sendNotice({ text: 'x', url: 'https://example.com' }), { sent: false, reason: 'not-configured' });
});

// ★ 진행상황은 별도 메시지다. 본문 규격(빈 줄 배치)에 끼워 넣으면 규격이 깨진다.
test('★ 진행상황을 줘도 본문 7줄 규격이 안 깨진다', () => {
  const base = { dateStr: '2026-08-16', topPaper: { title_ko: '짧은 제목', paper: { journal: 'NEJM', pmid: '1' } }, pagesUrl: 'https://x' };
  const without = buildReportMessages(base);
  const withP = buildReportMessages({ ...base, progressLines: ['논문 · 켜짐 · 미독 2'] });
  assert.deepEqual(withP.slice(0, without.length), without, '본문이 바뀌었다');
  assert.equal(withP.length, without.length + 1, '진행상황이 별도 메시지가 아니다');
  assert.match(withP.at(-1), /진행상황/);
  assert.match(withP.at(-1), /미독 2/);
  assert.match(withP[0], /^\[trend-review\]\n\n/);
});

test('진행상황이 없으면 메시지가 늘지 않는다', () => {
  const base = { dateStr: '2026-08-16', topPaper: { title_ko: 't', paper: {} }, pagesUrl: 'https://x' };
  assert.equal(buildReportMessages(base).length, buildReportMessages({ ...base, progressLines: [] }).length);
});

// ★ 채널이 메시지를 이을 때 **빈 줄**로 이어야 한다. '\n' 하나로 이으면 진행상황이
//   본문 마지막 줄(📊 링크)에 달라붙는다 — 그게 PeterJ 가 고쳐 달라고 한 증상이다.
//   빌더가 아무리 옳아도 이 한 줄이 틀리면 화면이 틀린다(맞물리는 자리 검사).
test('★ TelegramNotifier 가 메시지들을 빈 줄로 잇는다', () => {
  const src = readFileSync(new URL('../src/agents/TelegramNotifier.js', import.meta.url), 'utf8');
  const join = src.match(/buildReportMessages\([^)]*\)\.join\((['"])([^'"]*)\1\)/);
  assert.ok(join, 'send() 가 buildReportMessages(...).join(...) 을 쓰지 않는다');
  assert.equal(join[2], '\\n\\n', `메시지 구분자가 빈 줄이 아니다: ${JSON.stringify(join[2])}`);
});
