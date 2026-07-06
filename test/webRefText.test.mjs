import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRefTexts } from '../src/utils/webRefText.js';

const ok = (body, type = 'text/html') => Promise.resolve({
  ok: true, headers: { get: () => type }, text: () => Promise.resolve(body),
});

test('fetchRefTexts: HTML은 텍스트화, 실패 URL은 조용히 제외, 비HTML 제외', async () => {
  const dossier = [
    { source: 'A', url: 'https://a.x' },
    { source: 'B', url: 'https://b.x' },
    { source: 'C', url: 'https://c.x' },
  ];
  const fetchImpl = (url) =>
    url.includes('a.x') ? ok(`<p>alpha body ${'x'.repeat(300)}</p>`)
    : url.includes('b.x') ? Promise.reject(new Error('net'))
    : ok('%PDF-1.4', 'application/pdf');
  const out = await fetchRefTexts(dossier, { fetchImpl });
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'A');
  assert.ok(out[0].text.includes('alpha body'));
});

test('fetchRefTexts: dossier 비면 빈 배열', async () => {
  assert.deepEqual(await fetchRefTexts(null, {}), []);
});

test('fetchRefTexts: 너무 짧은 본문(오류 페이지)은 제외', async () => {
  const out = await fetchRefTexts([{ source: 'S', url: 'https://s.x' }], { fetchImpl: () => ok('<p>short</p>') });
  assert.equal(out.length, 0);
});
