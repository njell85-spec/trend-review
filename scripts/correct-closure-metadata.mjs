// Offline, narrowly scoped historical correction. Default is dry-run.
// node scripts/correct-closure-metadata.mjs [--apply]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveGuidelineState } from '../src/utils/guidelineState.js';
import { saveTrackQueue } from '../src/utils/trackQueue.js';

export const CLOSURE_SOURCES = Object.freeze({
  ketamine: 'https://ssai.info/wp-content/uploads/acta-anaesthesiol-scand-2024-amer-ketamine-analgo-sedation-for-mechanically-ventilated-critically-ill-adults-a-rapid.pdf',
  ards: 'https://www.sccm.org/clinical-resources/guidelines/guidelines/guidelines-for-the-administration-of-neuromuscular-blockade',
});

function unique(items, pmid, where) {
  const found = items.filter(x => x.pmid === pmid);
  if (found.length !== 1) throw new Error(`Expected exactly one ${pmid} in ${where}`);
  return found[0];
}

/** No clinical rewriting, queue promotion, publication, removal or new identifiers. */
export function correctClosureMetadata(input) {
  const { guidelines, reviews } = structuredClone(input);
  if (guidelines?.schemaVersion !== 2 || reviews?.schemaVersion !== 1 || reviews.track !== 'reviews') {
    throw new Error('Unexpected state schemas');
  }
  const changes = [];
  const set = (item, field, value, location) => {
    const oldValue = item[field];
    if (JSON.stringify(oldValue) === JSON.stringify(value)) return;
    item[field] = value;
    changes.push({ location, field, oldValue, newValue: value });
  };
  const remove = (item, field, location) => {
    if (!(field in item)) return;
    changes.push({ location, field, oldValue: item[field], removed: true });
    delete item[field];
  };
  const source = (item, target, label) => {
    if (!item.card || !Array.isArray(item.card.sources)) throw new Error(`Missing source list for ${item.pmid}`);
    const url = `https://pubmed.ncbi.nlm.nih.gov/${target}/`;
    if (item.card.sources.some(x => x.url === url && x.label === label)) return;
    set(item.card, 'sources', [...item.card.sources, { label, url }], `guidelines.published[${item.pmid}].card`);
  };

  const prior = unique(guidelines.queue, '39198198', 'guideline queue');
  const coPublished = unique(guidelines.published, '39207913', 'guideline published');
  if (prior.id !== 'pmid:39198198' || coPublished.id !== 'pmid:39207913'
      || ![undefined, 'pmid:39207913'].includes(prior.supersededBy)
      || !['superseded', 'needsReview'].includes(prior.status)
      || !Array.isArray(coPublished.supersedes)) throw new Error('Ketamine state drift; manual review required');
  // Keep the unpublished co-publication held, not automatically eligible again.
  set(prior, 'status', 'needsReview', 'guidelines.queue[39198198]');
  set(prior, 'lineageReview', true, 'guidelines.queue[39198198]');
  set(prior, 'lineageReason', 'co-publication-not-new-edition', 'guidelines.queue[39198198]');
  remove(prior, 'supersededBy', 'guidelines.queue[39198198]');
  remove(prior, 'supersededAt', 'guidelines.queue[39198198]');
  set(coPublished, 'supersedes', coPublished.supersedes.filter(x => x !== prior.id), 'guidelines.published[39207913]');
  source(coPublished, '39198198', '공동출판 — Acta Anaesthesiologica Scandinavica (PMID 39198198); 신판·구판 관계 아님');

  const main = unique(guidelines.published, '41773929', 'guideline published');
  const summary = unique(guidelines.published, '41773928', 'guideline published');
  if (main.id !== 'pmid:41773929' || summary.id !== 'pmid:41773928') throw new Error('ARDS identity drift');
  source(main, '41773928', '공식 요약 — 같은 SCCM ARDS 신경근차단 지침의 Executive Summary (PMID 41773928)');
  source(summary, '41773929', '지침 본문 — 이 Executive Summary의 SCCM ARDS 신경근차단 본문 (PMID 41773929)');

  const respiratory = unique(reviews.published, '36322846', 'review published');
  if (respiratory.card?.fullTextSource !== 'abstract-only'
      || !['full-text', 'unverified'].includes(respiratory.card?.coverage)
      || respiratory.card?.coverageEvidence != null) {
    throw new Error('Respiratory coverage evidence changed; manual review required');
  }
  // A provenance conflict proves neither full-text access nor abstract-only content.
  // Do not fabricate a cache-generation receipt or rewrite the historical translation.
  set(respiratory.card, 'coverage', 'unverified', 'reviews.published[36322846].card');
  return { guidelines, reviews, changes };
}

async function main() {
  if (process.argv.slice(2).some(x => x !== '--apply')) throw new Error('Only --apply is supported');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const gp = path.join(root, 'output/selected_guidelines.json');
  const rp = path.join(root, 'output/queue_reviews.json');
  const [gRaw, rRaw] = await Promise.all([fs.readFile(gp, 'utf8'), fs.readFile(rp, 'utf8')]);
  const next = correctClosureMetadata({ guidelines: JSON.parse(gRaw), reviews: JSON.parse(rRaw) });
  if (process.argv.includes('--apply') && next.changes.length) {
    // Fail closed if another worker/publisher changed either input during the dry calculation.
    if (await fs.readFile(gp, 'utf8') !== gRaw || await fs.readFile(rp, 'utf8') !== rRaw) {
      throw new Error('Concurrent state change; no corrections written');
    }
    await saveGuidelineState(gp, next.guidelines);
    await saveTrackQueue(rp, next.reviews);
  }
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), changes: next.changes }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
