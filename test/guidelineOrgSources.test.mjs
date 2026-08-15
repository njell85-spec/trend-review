import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchOrgSource, evaluateSourceHealth, dryRunOrgSources } from '../src/utils/guidelineOrgSources.js';

const fixture = async (name) => readFile(new URL(`./fixtures/org-sources/${name}`, import.meta.url), 'utf8');
const source = (type, extra = {}) => ({ id: type, type, url: `https://example.test/${type}`, ...extra });

test('RSS, listing HTML, sitemap and JSON adapters extract and deduplicate items', async () => {
  const rss = await fetchOrgSource(source('rss'), { fetchText: () => fixture('sample.rss') });
  const html = await fetchOrgSource(source('listing-html', { selectors: { item: '.entry', title: '.title', link: '.title', date: '.date' } }), { fetchText: () => fixture('sample.html') });
  const map = await fetchOrgSource(source('sitemap'), { fetchText: () => fixture('sample.xml') });
  const json = await fetchOrgSource(source('api-json', { itemsPath: 'data.rows', fields: { title: 'name', link: 'href', date: 'issued' } }), { fetchText: () => fixture('sample.json') });
  assert.deepEqual([rss.items.length, html.items.length, map.items.length, json.items.length], [2, 2, 2, 2]);
  assert.equal(html.items[1].date, null);
});

test('manual seed is not an automatic success', async () => {
  const result = await fetchOrgSource(source('manual-seed'), {});
  assert.deepEqual({ observed: result.observed, reason: result.reason }, { observed: false, reason: 'manual-seed' });
});

test('selector mismatch, empty 200, login and redirect-looking final URL are red', async () => {
  for (const result of [
    await fetchOrgSource(source('listing-html', { selectors: { item: '.missing' } }), { fetchText: () => fixture('sample.html') }),
    { observed: true, status: 200, items: [], body: '', fetchedAt: '2026-01-02', finalUrl: 'https://example.test/x' },
    { observed: true, status: 200, items: [{ url: 'x' }], body: 'Please sign in', fetchedAt: '2026-01-02', finalUrl: 'https://example.test/login' },
  ]) assert.equal(evaluateSourceHealth(source('listing-html'), result).status, 'red');
});

test('missing marker is red and old success/new-item timestamps independently warn', () => {
  const result = { observed: true, status: 200, items: [{ url: 'x' }], body: 'wrong', fetchedAt: '2026-02-01T00:00:00Z', finalUrl: 'https://example.test/x', lastSuccessfulAt: '2026-01-01', lastNewItemAt: '2026-01-02' };
  const health = evaluateSourceHealth(source('rss', { health: { expectedContentMarker: 'EXPECTED', maxSilenceDays: 10 } }), result);
  assert.equal(health.status, 'red');
  assert.ok(health.reasons.includes('last-success-silence') && health.reasons.includes('last-new-item-silence'));
});

test('one failed source does not stop other organizations', async () => {
  const cfg = { organizations: [{ id: 'bad', sources: [source('rss')] }, { id: 'good', sources: [source('rss')] }] };
  cfg.organizations[0].sources[0].url = 'https://bad.example.test/rss'; cfg.organizations[1].sources[0].url = 'https://good.example.test/rss';
  const isolated = await dryRunOrgSources(cfg, { fetchText: (url) => url.includes('bad.') ? Promise.reject(new Error('one failed')) : fixture('sample.rss') });
  assert.deepEqual(isolated.map((x) => x.status), ['red', 'green']);
});

test('deployed configuration reports all nine organizations unconfigured', async () => {
  const cfg = JSON.parse(await readFile(new URL('../config/guideline-orgs.json', import.meta.url), 'utf8'));
  const report = await dryRunOrgSources(cfg, { fetchText: () => { throw new Error('must not fetch'); } });
  assert.equal(report.length, 9);
  assert.ok(report.every((x) => x.status === 'unconfigured'));
});
