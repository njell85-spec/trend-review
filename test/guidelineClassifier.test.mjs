import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGuidelineDocument } from '../src/utils/guidelineClassifier.js';
import { loadGuidelineOrgs } from '../src/utils/guidelineOrgs.js';

const corpus = JSON.parse(await readFile(new URL('./fixtures/guideline-corpus.json', import.meta.url)));
const orgs = loadGuidelineOrgs();

test('guideline corpus classifications all match their expected verdict', async (t) => {
  for (const candidate of corpus) {
    await t.test(candidate.title, () => {
      const result = classifyGuidelineDocument(candidate, { orgs });
      assert.equal(result.verdict, candidate.expect, `${candidate.title}: actual verdict=${result.verdict}`);
      assert.ok(Array.isArray(result.reasons));
      assert.equal(typeof result.evidence.format, 'boolean');
      assert.equal(typeof result.evidence.publisher, 'boolean');
      assert.equal(typeof result.evidence.normative, 'boolean');
      assert.equal(typeof result.evidence.official, 'boolean');
    });
  }
});
