#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { MetadataScorer } from '../src/utils/MetadataScorer.js';
import { loadTrackQueue, saveTrackQueue } from '../src/utils/trackQueue.js';
import { buildReviewQueue, itemsForSet, REVIEW_AXES, REVIEW_TRACK } from '../src/utils/reviewQueue.js';

function parseArgs(argv) {
  // ★ 저널 세트 = 6종 (PeterJ 확정 2026-08-16).
  //   NEJM · JAMA · Lancet · BMJ + Intensive Care Med · Crit Care Med.
  //   실측 공급 주 1.6편으로 주 1회 슬롯의 1.6배다 — 🗑 을 눌러도 저수지가 마르지 않는다.
  //   4종은 주 0.8편이라 주 1회에도 빠듯하고, 10종(주 3.7편)은 질이 섞인다.
  const options = { set: 'core4_plus_ccm', limit: 400, out: 'output/queue_reviews.json', dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry') options.dry = true;
    else if (arg === '--set') options.set = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--out') options.out = argv[++i];
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!Object.hasOwn(REVIEW_AXES, options.set)) throw new Error(`지원하지 않는 --set: ${options.set}`);
  if (!Number.isInteger(options.limit) || options.limit < 0) throw new Error('--limit은 0 이상의 정수여야 합니다');
  if (!options.out) throw new Error('--out 경로가 필요합니다');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const census = JSON.parse(await readFile(resolve('experiments/guideline-census.json'), 'utf8'));
  const papers = itemsForSet(census, options.set);
  const out = resolve(options.out);
  const state = await loadTrackQueue(out, REVIEW_TRACK);
  // MetadataScorer 기본 생성자가 저장소의 interests/journals 설정을 검증해 읽는다.
  const next = buildReviewQueue({
    state, papers, scorer: new MetadataScorer(), limit: options.limit,
    today: new Date().toISOString().slice(0, 10), currentYear: new Date().getUTCFullYear(),
  });

  console.log(`set=${options.set} 입력=${papers.length} 큐=${next.queue.length} dry=${options.dry}`);
  console.table(next.queue.slice(0, 10).map(({ pmid, title, journal, score, topic }) =>
    ({ pmid, score, topic, journal, title })));
  if (!options.dry) {
    await mkdir(dirname(out), { recursive: true });
    await saveTrackQueue(out, next);
    console.log(`저장: ${out}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
