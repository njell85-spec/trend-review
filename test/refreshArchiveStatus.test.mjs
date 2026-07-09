/**
 * GitHubPublisher.refreshArchiveStatus (§4-E, item 2 / 2A) — 하루 지연 수정 회귀.
 *
 * 배경: ArchiveAgent 가 "그날 항목"을 analysis_archive.json 에 추가하는 시점이 publish() 뒤라,
 * publish 가 구운 "아카이브 저장 현황" 패널은 항상 하루 지연됐다. refreshArchiveStatus 는
 * ArchiveAgent 직후 호출돼 최신 항목까지 다시 굽는다.
 *
 * 임시 git repo(원격·토큰 없음)로 검증: 지연 상태 → 재주입 후 오늘 PMID 포함(로컬 커밋),
 * 2회차 no-op(멱등), 소프트(원격 없어도 던지지 않음).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { archiveStatusBlock } from '../src/utils/archiveStatus.js';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
};

// 어제까지(1건)만 반영된 아카이브 — publish 가 구운 "지연" 상태를 흉내낸다.
const staleArchive = () => ({
  entries: [{ date: '2026-07-08', pmid: 'OLD1', title: 'Yesterday paper', fullText: 'x', fullTextSource: 'PMC', dossier: [] }],
  driveState: { pdfFiles: {}, fulltextDone: { '2026-07': ['OLD1'] } },
});
// ArchiveAgent 가 오늘 항목(NEW2)을 추가한 뒤의 최신 상태.
const freshArchive = () => ({
  entries: [
    { date: '2026-07-09', pmid: 'NEW2', title: 'Today paper', fullText: null, fullTextSource: 'abstract-only', dossier: [] },
    { date: '2026-07-08', pmid: 'OLD1', title: 'Yesterday paper', fullText: 'x', fullTextSource: 'PMC', dossier: [] },
  ],
  driveState: { pdfFiles: {}, fulltextDone: { '2026-07': ['OLD1'] } },
});

function setupRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tr-refresh-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(dir, 'output'), { recursive: true });
  return dir;
}

test('refreshArchiveStatus: 지연 패널을 오늘 항목까지 다시 굽는다(로컬 커밋·소프트)', async () => {
  const dir = setupRepo();
  try {
    // 지연 상태로 배포된 index.html: 어제(1건)만 담긴 §4-E 블록 + 푸터 앵커
    const staleBlock = archiveStatusBlock(staleArchive());
    writeFileSync(path.join(dir, 'index.html'),
      `<html><body><!-- ARCHIVE_START -->x<!-- ARCHIVE_END -->\n${staleBlock}\n  <div class="ft">footer</div></body></html>`);
    // 최신 아카이브 JSON(오늘 NEW2 추가됨)
    writeFileSync(path.join(dir, 'output', 'analysis_archive.json'), JSON.stringify(freshArchive()));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'seed');
    const before = git(dir, 'rev-parse', 'HEAD');

    const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
    const pub = new GitHubPublisher({ token: null, owner: 'o', repo: 'r', repoPath: dir });

    const r1 = await pub.refreshArchiveStatus('2026-07-09');
    assert.equal(r1.updated, true, '지연 상태 → 갱신됨');
    assert.equal(r1.pushed, false, '원격·토큰 없음 → push 안 됨(소프트, 던지지 않음)');

    const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('PMID NEW2'), '오늘 항목이 패널에 반영');
    assert.ok(html.includes('PMID OLD1'), '어제 항목도 유지');
    assert.match(html, /as-cnt">2건/, '총 2건으로 갱신');

    const after = git(dir, 'rev-parse', 'HEAD');
    assert.notEqual(after, before, '로컬 커밋이 생성됨');
    assert.match(git(dir, 'log', '-1', '--pretty=%s'), /Refresh archive status: 2026-07-09/);

    // 2회차: 이미 최신 → 멱등 no-op(커밋 안 늘어남)
    const r2 = await pub.refreshArchiveStatus('2026-07-09');
    assert.equal(r2.updated, false, '변경 없으면 no-op');
    assert.equal(git(dir, 'rev-parse', 'HEAD'), after, '두 번째 호출은 커밋을 만들지 않음');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshArchiveStatus: index.html 없으면 무영향(소프트)', async () => {
  const dir = setupRepo();
  try {
    const { GitHubPublisher } = await import('../src/utils/GitHubPublisher.js');
    const pub = new GitHubPublisher({ token: null, owner: 'o', repo: 'r', repoPath: dir });
    const r = await pub.refreshArchiveStatus('2026-07-09');
    assert.deepEqual(r, { updated: false, pushed: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
