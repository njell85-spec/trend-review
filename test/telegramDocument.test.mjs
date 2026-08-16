import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramNotifier } from '../src/agents/TelegramNotifier.js';

// md 첨부. PeterJ 요구: "각 1 2 3 분석 내용도 md파일 첨부해서 텔레그램에서 바로 볼수있게"

function withEnv(fn) {
  const saved = { t: process.env.TELEGRAM_BOT_TOKEN, c: process.env.TELEGRAM_CHAT_ID };
  process.env.TELEGRAM_BOT_TOKEN = 'tok'; process.env.TELEGRAM_CHAT_ID = 'chat';
  try { return fn(); } finally {
    process.env.TELEGRAM_BOT_TOKEN = saved.t; process.env.TELEGRAM_CHAT_ID = saved.c;
  }
}

test('설정이 없으면 조용히 false 를 돌려준다 (예외를 던지지 않는다)', async () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  const n = new TelegramNotifier();
  assert.equal(await n.sendDocument({ filename: 'a.md', content: 'x' }), false);
  process.env.TELEGRAM_BOT_TOKEN = saved;
});

test('★ 첨부 실패가 예외로 번지지 않는다 (본문 발송을 막으면 안 된다)', async () => {
  await withEnv(async () => {
    const n = new TelegramNotifier();
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 413, json: async () => ({ description: 'too big' }) });
    try { assert.equal(await n.sendDocument({ filename: 'a.md', content: 'x' }), false); }
    finally { globalThis.fetch = orig; }
  });
});

test('★ 네트워크가 통째로 죽어도 던지지 않는다', async () => {
  await withEnv(async () => {
    const n = new TelegramNotifier();
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ENOTFOUND'); };
    try { assert.equal(await n.sendDocument({ filename: 'a.md', content: 'x' }), false); }
    finally { globalThis.fetch = orig; }
  });
});

test('성공하면 true 이고 sendDocument 엔드포인트로 간다', async () => {
  await withEnv(async () => {
    const n = new TelegramNotifier();
    const orig = globalThis.fetch; let url = '';
    globalThis.fetch = async (u) => { url = String(u); return { ok: true, json: async () => ({}) }; };
    try {
      assert.equal(await n.sendDocument({ filename: 'a.md', content: 'x' }), true);
      assert.match(url, /\/sendDocument$/);
    } finally { globalThis.fetch = orig; }
  });
});

test('★ 캡션은 텔레그램 상한(1024자)에서 잘린다', async () => {
  await withEnv(async () => {
    const n = new TelegramNotifier();
    const orig = globalThis.fetch; let cap = '';
    globalThis.fetch = async (_u, o) => { cap = o.body.get('caption'); return { ok: true, json: async () => ({}) }; };
    try {
      await n.sendDocument({ filename: 'a.md', content: 'x', caption: '가'.repeat(2000) });
      assert.equal(cap.length, 1024);
    } finally { globalThis.fetch = orig; }
  });
});

test('★ 토큰이 로그·에러에 새지 않는다', async () => {
  await withEnv(async () => {
    const n = new TelegramNotifier();
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ description: 'bad' }) });
    try {
      const r = await n.sendDocument({ filename: 'a.md', content: 'x' });
      assert.equal(r, false);   // 실패해도 토큰이 반환값·예외로 나오지 않는다
    } finally { globalThis.fetch = orig; }
  });
});
