import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMessages, buildFailureText } from '../src/utils/reportMessage.js';
import { TelegramNotifier } from '../src/agents/TelegramNotifier.js';

// ── 메시지 포맷 정본 (REPORT_SPEC §2) — 채널을 바꿔도 텍스트는 그대로여야 한다 ──
test('buildReportMessages: 5줄 구조 · 링크 포함 · 금지 장식 없음', () => {
  const [msg, ...rest] = buildReportMessages({
    dateStr: '2026-08-04',
    topPaper: { title_ko: '제목', paper: { title: 'T', journal: 'NEJM', pmid: '12345678' } },
    pagesUrl: 'https://njell85-spec.github.io/trend-review/',
  });
  assert.equal(rest.length, 0); // 짧으면 1건
  const lines = msg.split('\n');
  assert.equal(lines[0], '[trend-review]');
  assert.equal(lines[1], '2026-08-04');
  assert.equal(lines[2], '제목');
  assert.equal(lines[3], 'NEJM · #12345678');
  assert.ok(lines[4].includes('https://njell85-spec.github.io/trend-review/'));
  assert.ok(!/🥇/u.test(msg));
});

test('buildReportMessages: 링크 미지정이면 대시보드 폴백', () => {
  const msgs = buildReportMessages({ dateStr: '2026-08-04', topPaper: {} });
  assert.ok(msgs.join('\n').includes('https://njell85-spec.github.io/trend-review/'));
});

test('buildReportMessages: 200자 초과면 제목을 자르지 않고 2건으로 분할', () => {
  const long = '가'.repeat(300);
  const msgs = buildReportMessages({
    dateStr: '2026-08-04',
    topPaper: { title_ko: long, paper: { journal: 'J', pmid: '1' } },
  });
  assert.equal(msgs.length, 2);
  assert.ok(msgs[1].includes('#1'));
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

// ★ 진행상황은 별도 메시지다. 기존 5줄 본문은 200자 계약(REPORT_SPEC §4-D) 아래 있고
// 분할 규칙이 거기 맞춰져 있어서, 본문에 끼워 넣으면 그 계약이 깨진다.
test('★ 진행상황을 줘도 기존 본문 계약(200자·분할)이 안 깨진다', () => {
  const base = { dateStr: '2026-08-16', topPaper: { title_ko: '짧은 제목', paper: { journal: 'NEJM', pmid: '1' } }, pagesUrl: 'https://x' };
  const without = buildReportMessages(base);
  const withP = buildReportMessages({ ...base, progressLines: ['논문 · 켜짐 · 미독 2'] });
  assert.deepEqual(withP.slice(0, without.length), without, '본문이 바뀌었다');
  assert.equal(withP.length, without.length + 1, '진행상황이 별도 메시지가 아니다');
  assert.match(withP.at(-1), /진행상황/);
  assert.match(withP.at(-1), /미독 2/);
});

test('진행상황이 없으면 메시지가 늘지 않는다', () => {
  const base = { dateStr: '2026-08-16', topPaper: { title_ko: 't', paper: {} }, pagesUrl: 'https://x' };
  assert.equal(buildReportMessages(base).length, buildReportMessages({ ...base, progressLines: [] }).length);
});
