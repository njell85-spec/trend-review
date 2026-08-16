import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  archiveTrackDigest,
  buildTrackDigest,
  trackDigestFilename,
} from '../src/utils/trackDigest.js';

const input = {
  track: 'papers',
  dateStr: '2026-08-16',
  item: { pmid: '40001', title: '중환자 연구', journal: 'Critical Care' },
  analysis: { keyFindings_ko: ['사망률이 감소했다.', '중대한 이상반응 차이는 없었다.'], clinicalImpact_ko: '진료 변경을 고려할 수 있다.' },
};

function frontMatterOf(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'front-matter 경계가 문서 맨 앞에 하나의 블록으로 있어야 한다');
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const colon = line.indexOf(':');
    assert.ok(colon > 0, `유효하지 않은 YAML 행: ${line}`);
    return [line.slice(0, colon), JSON.parse(line.slice(colon + 1).trim())];
  }));
}

test('front-matter가 유효한 YAML이며 track/date/pmid를 담는다', () => {
  const data = frontMatterOf(buildTrackDigest(input));
  assert.deepEqual(
    { track: data.track, date: data.date, pmid: data.pmid },
    { track: 'papers', date: '2026-08-16', pmid: '40001' },
  );
});

test('제목·저널·PMID·PubMed 링크·핵심 요약·임상 영향 순서로 나온다', () => {
  const md = buildTrackDigest(input);
  const anchors = ['# 중환자 연구', '## 저널', '## PMID', '## PubMed 링크', '## 핵심 요약', '## 임상 영향'];
  const positions = anchors.map((anchor) => md.indexOf(anchor));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('값이 없는 절은 아예 나오지 않아 빈 껍데기를 만들지 않는다', () => {
  const md = buildTrackDigest({ track: 'reviews', dateStr: '2026-08-16' });
  for (const heading of ['# ', '## 저널', '## PMID', '## PubMed 링크', '## 핵심 요약', '## 임상 영향']) {
    assert.ok(!md.includes(heading));
  }
});

test('같은 입력이면 같은 출력이다', () => {
  assert.equal(buildTrackDigest(input), buildTrackDigest(structuredClone(input)));
});

test('제목의 Markdown 특수문자 #, *, [가 문서 구조를 깨지 않는다', () => {
  const md = buildTrackDigest({ ...input, item: { ...input.item, title: '# 효과 *강조* [시험]' } });
  assert.match(md, /^# \\# 효과 \\\*강조\\\* \\\[시험\\\]$/m);
  assert.equal((md.match(/^# /gm) ?? []).length, 1);
});

test('★ 외부 제목의 줄바꿈과 ---가 front-matter를 탈출하지 못한다', () => {
  const title = '첫 줄\n---\ntrack: injected';
  const md = buildTrackDigest({ ...input, item: { ...input.item, title } });
  const data = frontMatterOf(md);
  assert.equal(data.title, title);
  assert.equal(data.track, 'papers');
  assert.equal((md.match(/^---$/gm) ?? []).length, 2);
});

test('배열 핵심 요약은 내용 손실 없이 Markdown 목록으로 만든다', () => {
  const md = buildTrackDigest(input);
  assert.match(md, /- 사망률이 감소했다\./);
  assert.match(md, /- 중대한 이상반응 차이는 없었다\./);
});

test('파일명은 date-track-pmid 규칙을 따른다', () => {
  assert.equal(trackDigestFilename(input), '2026-08-16-papers-40001.md');
});

test('아카이브는 기존 자료를 보존하고 같은 파일만 멱등 덮어쓴다', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'track-digest-'));
  const first = await archiveTrackDigest(input, { outputDir });
  await archiveTrackDigest({ ...input, item: { ...input.item, pmid: '40002' } }, { outputDir });
  const second = await archiveTrackDigest(input, { outputDir });
  assert.equal(await readFile(first.filePath, 'utf8'), second.content);
  assert.deepEqual((await readdir(outputDir)).sort(), ['2026-08-16-papers-40001.md', '2026-08-16-papers-40002.md']);
});

test('★ 파일명 입력으로 경로를 탈출할 수 없다', () => {
  assert.throws(() => trackDigestFilename({ ...input, track: '../outside' }), /파일명에 안전한/);
});
