#!/usr/bin/env node
/**
 * 대화 아카이브 수집기 — 세션 대화 원문을 자동으로 눌러 둔다 (커맨드센터 부품 1a)
 * =============================================================================
 * PeterJ 확정 2026-08-01: **"모든 repo 모든 세션의 대화를 수집, 보관은 GC에만.
 * 로스 없음이 목적."** 설계 정본:
 * `docs/superpowers/specs/2026-08-01-chat-archive-automation-design.md`.
 * 운용 절차: `rulebook/command-center.md` §8.
 *
 * 왜 원문을 따로 남기나
 * -----------------------------------------------------------------------------
 * raw 장부(부품 1b)는 **결론**을 받는다. 거기 이르는 과정 — 어떤 가설이 왜 뒤집혔는지,
 * 어떤 한마디가 방향을 바꿨는지 — 은 장부에 안 남는다. 나중에 제일 아쉬운 것이 그 부분이라
 * 원문을 통째로 싸게(실측 0.9%) 눌러 둔다.
 *
 * 규격 — 사용량 수집기(tools/usage/collect-session.mjs)와 **같다**
 * -----------------------------------------------------------------------------
 *     각자 자기 마당에 쓰고, 타워가 하루 한 번 걷는다.
 *
 * 새 개념을 만들지 않는다. 그릇만 다르다(사용량 JSON → 대화 마크다운).
 *   · 언제  — 각 repo는 Stop 훅(매 턴 끝), 타워는 git `pre-commit` 훅.
 *   · 무엇을 — 세션당 파일 **1개에 덮어쓴다**. 컨테이너가 언제 회수될지 모르므로 매 턴
 *             갱신해 두면 마지막으로 커밋된 스냅샷이 남는다.
 *   · 무엇을 버리나 — 툴 호출·툴 결과·thinking·시스템 주입·서브에이전트·이미지.
 *
 * **자족적 단일 파일이어야 한다.** 이 파일 하나가 각 repo의 `.claude/chat-archive/`에
 * 통째로 복사되는 배포 사본의 전부다(tools/sync-to-repo.sh). 그래서 node 내장 외에는
 * 아무것도 import하지 않는다. 반대로 CLI(`extract-session.mjs`)는 **여기서 import한다** —
 * 추출 로직이 두 벌이 되지 않게 하는 것이 이 배치의 유일한 목적이다.
 *
 * 갈래 (설계 §3-2) — 추측하지 않고 **파일의 유무**로 가른다
 * -----------------------------------------------------------------------------
 *   · 타워 자신 (`tools/chat-archive/`가 있다)      → `data/chat-archive/sessions/` + git add
 *   · 그 외 전부 (`.claude/chat-archive/relay-to-gc` 마커) → GC 클론에 직접 (§4·relayToGc)
 *   · 마커도 없다 = 옛 배포본                       → 자기 repo `.chat/sessions/` + git add (폴백)
 *
 * **2026-08-06 변경: 릴레이가 public 전용이 아니라 전 repo 공통이 됐다.**
 * 종전에 private은 자기 repo `.chat/`에 쓰고 `git add`까지만 해서, **그 세션이 커밋을 한 번도
 * 안 하면 대화가 통째로 사라졌다**(컨테이너 회수와 함께). 릴레이는 매 턴 force-push라 커밋과
 * 무관하다 — 공개 쪽이 오히려 안전한 구조였던 것을 뒤집었다. 아래 마지막 갈래는 마커가 아직
 * 안 닿은 옛 배포본을 위한 폴백으로만 남는다.
 *
 * 사용법
 * -----------------------------------------------------------------------------
 *   node .../collect-session.mjs                     # 훅 입력(stdin JSON) 또는 자동 탐색
 *   node .../collect-session.mjs --transcript <path>  # 트랜스크립트 지정
 *   node .../collect-session.mjs --print              # 파일을 쓰지 않고 본문만 출력
 *
 * **불변: 무슨 일이 있어도 종료코드 0.** 훅이 세션을 막지 않는다.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/* =============================================================================
 * 1부. 추출 로직 — CLI(extract-session.mjs)가 그대로 import해 쓴다.
 * ========================================================================== */

/** 시스템이 끼워 넣은 텍스트인가 — 사람이 쓴 말이 아니면 버린다. */
export function isInjected(text) {
  const t = text.trimStart();
  return (
    t.startsWith('<system-reminder>') ||
    t.startsWith('<command-name>') ||
    t.startsWith('<local-command') ||
    t.startsWith('Caveat:') ||
    t.startsWith('[Image:') ||
    t.startsWith('[Request interrupted') ||
    /^Stop hook feedback:/m.test(t) ||
    t.startsWith('<task-notification>')
  );
}

/**
 * 스킬 본문인가 — 맞으면 **자리표시 한 줄**을 돌려준다(아니면 null).
 *
 * 왜 필요한가 (2026-08-09 실측, GC#96): 스킬을 부르면 SKILL.md **전문이 user 턴으로**
 * 들어오는데 태그가 없어서 `isInjected`의 여덟 가지를 전부 통과했다. 그래서 아카이브에
 * `### PeterJ` 밑에 스킬 지시문이 그대로 박혔다 — 전체 감사 결과 **PeterJ 발화로 기록된
 * 글자의 57.3%**(28,210 / 49,274자)가 이것이었다. 한 건이 1만 자 안팎이라 턴 수(5/174)에
 * 비해 글자 비중이 압도적이다.
 *
 * 브리핑이 아카이브를 **원본(raw data)으로 삼기로** 했으므로(rulebook §5 "3단 방어") 이건
 * 단순한 군더더기가 아니다 — `HARD-GATE ... 승인 없이 구현하지 마라` 같은 스킬 지시문을
 * **PeterJ의 요구로 읽을 수 있다.**
 *
 * 통째로 지우지 않고 한 줄을 남기는 이유: 1만 자짜리 턴이 소리 없이 사라지면 나중에
 * "PeterJ가 여기서 무슨 말을 했나"를 알 수 없다. 무엇이 있었는지는 남기고 내용만 뺀다.
 * (같은 이유로 수거기도 "안 걷은 브랜치는 안 지운다" 가드를 둔다.)
 *
 * 형태는 실측으로 하나뿐이다 — `Base directory for this skill: <경로>`로 시작하고
 * `ARGUMENTS: …`로 끝난다. 전체 아카이브를 훑어 다른 패턴은 0건이었다.
 * **새 형태가 보이면 여기에 추가할 것.**
 */
export function skillBodyMarker(text) {
  const m = String(text).trimStart().match(/^Base directory for this skill:\s*(\S+)/);
  if (!m) return null;
  const name = m[1].split('/').filter(Boolean).pop() || '이름 미상';
  return `_(스킬 본문 생략 — ${name} · ${String(text).length.toLocaleString('en-US')}자)_`;
}

/** system-reminder 등 삽입 블록을 문장 중간에서도 걷어낸다. */
export function stripInline(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/Stop hook feedback:[\s\S]*?(?=\n\n|$)/g, '')
    .replace(/\[Image:[^\]]*\]/g, '')
    .trim();
}

/** 한 메시지에서 사람이 읽을 텍스트만 뽑는다. */
export function textOf(message) {
  // 스킬 본문은 버리기 전에 자리표시로 바꾼다 — isInjected보다 먼저 본다.
  const one = (t) => skillBodyMarker(t) ?? (isInjected(t) ? '' : stripInline(t));
  const c = message?.content;
  if (typeof c === 'string') return one(c);
  if (!Array.isArray(c)) return '';
  return c
    // tool_use / tool_result / thinking / image 는 통째로 버린다
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => one(b.text))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 트랜스크립트(JSONL 원문)에서 대화 턴만 뽑는다.
 * 연속한 같은 화자는 한 덩어리로 합친다 — 툴을 쓰며 여러 번 나눠 말한 것은 원래 한 턴이다.
 */
export function extractTurns(raw) {
  const turns = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isSidechain) continue;                 // 서브에이전트 — 본 대화가 아니다
    if (o.message?.role === 'user' && o.userType && o.userType !== 'external') continue;

    const text = textOf(o.message);
    if (!text) continue;

    const who = o.type === 'user' ? 'PeterJ' : 'Claude';
    const last = turns[turns.length - 1];
    if (last && last.who === who) last.text += `\n\n${text}`;
    else turns.push({ who, text, branch: o.gitBranch, at: o.timestamp });
  }
  return turns;
}

/** ISO 시각 → KST 날짜(YYYY-MM-DD). 파일명·헤더의 날짜는 전부 이걸 쓴다. */
export function kstDate(iso) {
  return iso ? new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10) : '';
}

/**
 * ISO 시각 → KST ISO-8601 (`2026-08-07T01:05:45+09:00`). 턴 제목 줄에 붙는다.
 *
 * 왜 날짜까지 다 넣나 (PeterJ 확정 2026-08-07): 파일명 날짜는 **첫 턴 기준으로 고정**이라
 *   자정을 넘긴 세션은 한 파일에 이틀치가 섞인다(흔하다 — 밤 작업). 거기에 `HH:MM`만 찍으면
 *   `23:09` 다음 `01:05` 가 **앞선 시각으로 읽힌다.** 선후관계를 보려고 만드는 표시가
 *   선후관계를 뒤집으면 안 된다.
 * 왜 오프셋까지 넣나: GitHub Actions 로그는 UTC고 우리 규칙은 KST다. 오프셋이 박혀 있으면
 *   나중에 뒤지는 쪽이 변환 실수를 안 하고, ISO-8601이라 **문자열 정렬만으로 시간순**이 된다.
 * 비용: 턴당 25자. 32턴짜리 아카이브(약 4만 자) 기준 2% — 줄 수는 안 늘어난다(제목 줄에 얹는다).
 */
export function kstStamp(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return `${new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 19)}+09:00`;
}

/**
 * 마크다운 본문을 만든다. 형식은 손으로 만든 기존 아카이브 2개와 **한 글자도 다르지 않다** —
 * 자동 수집분과 수동 추출분이 같은 그릇에 섞이므로 모양이 갈리면 안 된다.
 *
 * `repo`가 인자인 이유: 종전 CLI는 헤더에 `global-config`를 박아 두고 있었다. 이제 이 코드가
 * 모든 repo에서 돌므로, 어느 repo의 대화인지가 본문에 남아야 한다.
 */
export function renderArchive({ turns, title, repo, srcKB, by }) {
  const branch = turns.find((t) => t.branch)?.branch || '(불명)';
  const from = kstDate(turns[0]?.at);
  const to = kstDate(turns[turns.length - 1]?.at);
  return (
    `# 대화 아카이브 — ${title}\n\n` +
    `> 세션: ${repo} \`${branch}\` (${from}${to && to !== from ? ` ~ ${to}` : ''} KST)\n` +
    `> 추출: 세션 기록(${srcKB}KB)에서 PeterJ↔Claude 대화 텍스트만 (코드·툴 출력·시스템 주입 제외).\n` +
    `> 추출기: \`${by}\`. 규칙 정본: rulebook/command-center.md.\n\n` +
    turns
      .map((t) => {
        // 시각을 못 읽은 턴은 제목만 낸다 — 없는 시각을 지어내지 않는다.
        const at = kstStamp(t.at);
        return `### ${t.who}${at ? ` · ${at}` : ''}\n\n${t.text}`;
      })
      .join('\n\n---\n\n') +
    '\n'
  );
}

/* =============================================================================
 * 2부. 훅 입력·환경 파악 — 사용량 수집기와 같은 코드를 같은 이유로 쓴다.
 * ========================================================================== */

/** 훅은 stdin으로 JSON을 준다(session_id · transcript_path · cwd · stop_hook_active). */
function readHookInput() {
  try {
    if (process.stdin.isTTY) return null;
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 훅 입력이 없을 때: ~/.claude/projects/**\/*.jsonl 중 가장 최근에 수정된 것.
 *  `subagents/`는 건너뛴다 — 그 파일을 고르면 **서브에이전트를 하나의 세션으로 착각**해
 *  가짜 아카이브를 만들면서 정작 본 세션은 그 커밋에서 빠진다(사용량 수집기에서 겪은 실패).
 *  Windows에는 HOME이 없는 경우가 있어 USERPROFILE도 본다. */
function findLatestTranscript() {
  const home = process.env.HOME || process.env.USERPROFILE || '/root';
  const base = path.join(home, '.claude', 'projects');
  if (!existsSync(base)) return null;
  let best = null;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (name !== 'subagents') walk(p, depth + 1); }
      else if (name.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path: p, mtimeMs: st.mtimeMs };
      }
    }
  };
  try { walk(base, 0); } catch { /* 읽을 수 없으면 못 찾은 것으로 친다 */ }
  return best ? best.path : null;
}

/** git 한 번 돌리고 stdout을 준다. 실패는 전부 null — 훅에서 도는 코드다. */
function git(cwd, args, timeout = 10000) {
  try {
    return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout });
  } catch {
    return { status: 1, stdout: '', stderr: '' };
  }
}
function gitOut(cwd, args) {
  const r = git(cwd, args);
  return r.status === 0 ? String(r.stdout || '').trim() : null;
}

/** repo 루트(git toplevel). git이 없거나 repo가 아니면 준 디렉터리를 그대로 쓴다. */
function repoRoot(dir) {
  return gitOut(dir, ['rev-parse', '--show-toplevel']) || dir;
}

/** repo 이름 — origin URL의 마지막 조각. 없으면 디렉터리 이름.
 *  (클론 폴더명이 원격 이름과 다를 수 있으므로 원격을 먼저 본다.) */
function repoName(root) {
  const url = gitOut(root, ['remote', 'get-url', 'origin']);
  if (url) {
    const m = String(url).replace(/\/+$/, '').replace(/\.git$/, '').match(/([^/:]+)$/);
    if (m) return m[1];
  }
  return path.basename(root);
}

/* =============================================================================
 * 3부. public repo → GC 릴레이 (설계 §4)
 * -----------------------------------------------------------------------------
 * **대화 원문은 공개 히스토리에 올리지 않는다.** 사용량 때의 "날짜까지만 남기기"로
 * 완화되는 성격이 아니다 — 시각이 아니라 내용 자체가 문제다. 그래서 public repo의 세션은
 * 자기 repo에 아무것도 쓰지 않고, **컨테이너에 붙어 있는 GC 클론**에 직접 민다.
 *
 * 왜 세션별 브랜치인가: 공용 브랜치 하나면 동시 세션 둘이 non-fast-forward로 부딪힌다.
 * 매 턴 푸시라 충돌 창이 넓다. 자기 브랜치에는 경합이 없고, 내용이 매 턴 누적 스냅샷이라
 * force-push로 이전 커밋을 버려도 잃는 것이 없다.
 *
 * 왜 전용 worktree인가: 세션이 GC 클론을 **실제로 쓰고 있을 수 있다**(룰북 읽기 등).
 * 체크아웃된 브랜치·인덱스를 훅이 건드리면 그 세션의 작업을 망친다. worktree는 자기
 * 인덱스를 따로 갖는다. **이 갈래에서만 커밋·푸시가 허용된다.**
 * ========================================================================== */

/** 컨테이너 안에서 GC 클론을 찾는다. `/workspace`와 cwd의 조상들, 그리고 그 바로 아래 한 겹. */
function findGcClone(startDir) {
  const bases = ['/workspace'];
  let d = startDir;
  for (let i = 0; i < 6 && d && d !== path.dirname(d); i++) {
    bases.push(d);
    d = path.dirname(d);
  }
  const seen = new Set();
  const isGc = (dir) => {
    if (!dir || seen.has(dir) || !existsSync(path.join(dir, '.git'))) return false;
    seen.add(dir);
    const url = gitOut(dir, ['remote', 'get-url', 'origin']);
    return !!url && /(^|[/:])global-config(\.git)?$/.test(String(url).trim().replace(/\/+$/, ''));
  };
  for (const base of bases) {
    if (!existsSync(base)) continue;
    if (isGc(base)) return base;
    let names = [];
    try { names = readdirSync(base); } catch { continue; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const p = path.join(base, name);
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      if (isGc(p)) return p;
    }
  }
  return null;
}

/** worktree를 걸 기준 커밋 — origin/HEAD → origin/main → main → HEAD 순으로 있는 것. */
function baseRef(gc) {
  for (const ref of ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/main', 'HEAD']) {
    if (gitOut(gc, ['rev-parse', '--verify', '--quiet', ref])) return ref;
  }
  return 'HEAD';
}

/**
 * GC 클론의 전용 worktree에 파일을 쓰고 `chat/<repo>-<id8>` 브랜치로 force-push한다.
 * @returns {{ok: boolean, changed?: boolean, why?: string}}
 */
function relayToGc(gc, { repo, fileName, body, id8 }) {
  const wt = path.join(gc, '.git', 'chat-archive-wt');
  const branch = `chat/${repo}-${id8}`;

  if (!existsSync(wt)) {
    const r = git(gc, ['worktree', 'add', '--force', '-B', branch, wt, baseRef(gc)], 30000);
    if (r.status !== 0) return { ok: false, why: 'worktree를 만들지 못했습니다' };
  } else {
    /* 같은 컨테이너에서 다른 세션이 먼저 만들어 둔 worktree일 수 있다. 그때는 우리 브랜치로
     * 갈아탄다 — 매 턴 커밋·푸시하므로 저쪽에 남아 있을 미커밋 작업이 없다. */
    const cur = gitOut(wt, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (cur !== branch) {
      const r = git(wt, ['checkout', '--force', '-B', branch, baseRef(gc)], 30000);
      if (r.status !== 0) return { ok: false, why: '전용 worktree의 브랜치를 바꾸지 못했습니다' };
    }
  }

  const out = path.join(wt, 'data', 'chat-archive', 'repos', repo, fileName);
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, body, 'utf8');
  } catch {
    return { ok: false, why: 'worktree에 파일을 쓰지 못했습니다' };
  }

  if (git(wt, ['add', '--', out]).status !== 0) return { ok: false, why: 'git add 실패' };
  // 내용이 그대로면(같은 턴 재실행 등) 빈 커밋을 쌓지 않는다.
  if (git(wt, ['diff', '--cached', '--quiet']).status === 0) return { ok: true, changed: false };

  const commit = git(wt, [
    '-c', 'user.name=chat-archive', '-c', 'user.email=chat-archive@users.noreply.github.com',
    'commit', '-m', `chat-archive: ${repo} ${id8}`,
  ], 30000);
  if (commit.status !== 0) return { ok: false, why: '커밋 실패' };

  const push = git(wt, ['push', '-f', 'origin', `HEAD:refs/heads/${branch}`], 120000);
  if (push.status !== 0) return { ok: false, why: '푸시 실패(네트워크·권한)' };
  return { ok: true, changed: true, branch };
}

/* 쓴 파일을 곧바로 스테이징한다 (타워·private 갈래).
 * 컨테이너는 회수되고 타워는 나중에 GitHub에서 새로 클론해 걷는다 — **커밋돼 올라가지
 * 않으면 통째로 유실**된다. 여기서 스테이징까지만 하면 그 세션이 무슨 커밋을 하든 딸려
 * 올라간다. 커밋은 하지 않는다 — 커밋 타이밍과 메시지는 세션의 것이다.
 * 실패는 전부 삼킨다: git이 없을 수도, index.lock이 겹칠 수도 있다. 어느 경우든 파일
 * 자체는 이미 쓰였고, 세션이 평소대로 `git add`하면 그대로 올라간다. */
function stage(file) {
  try {
    spawnSync('git', ['add', '--', file], { cwd: path.dirname(file), stdio: 'ignore', timeout: 5000 });
  } catch { /* 위 주석 참조 */ }
}

/* =============================================================================
 * 4부. main
 * ========================================================================== */

const argv = process.argv.slice(2);
const PRINT_ONLY = argv.includes('--print');
const TRANSCRIPT_ARG = (() => {
  const i = argv.indexOf('--transcript');
  return i >= 0 ? argv[i + 1] : null;
})();

/* CI 실행에서는 아무것도 하지 않는다 (`CHAT_COLLECT_IN_CI=1`로 켤 수 있다).
 *
 * 왜: Actions에서 도는 `claude -p` 호출도 Stop 훅을 발화시킨다(2026-07-27 실측, 사용량
 * 수집기 주석 참조). 그런데 그건 사람과 주고받은 대화가 아니라 자동 실행이다. 아카이브에
 * 섞이면 잡음이고, public 갈래에서는 더 나쁘다 — GC 클론이 없는 러너에서 매번 Stop을
 * block하게 되어 **자동화 자체를 흔든다**. 조용히 지나가는 쪽이 안전하다. */
function ciSkipReason() {
  if (process.env.CHAT_COLLECT_IN_CI === '1') return null;
  if (process.env.GITHUB_ACTIONS === 'true') return 'GitHub Actions';
  return null;
}

function main() {
  const skip = ciSkipReason();
  if (skip && !PRINT_ONLY) {
    console.error(`[chat-archive] ${skip} 실행이라 아카이브를 쓰지 않습니다 — 사람 대화가 아닙니다. 켜려면 CHAT_COLLECT_IN_CI=1.`);
    return;
  }

  const hook = readHookInput();
  const transcript = TRANSCRIPT_ARG || hook?.transcript_path || findLatestTranscript();
  if (!transcript || !existsSync(transcript)) {
    if (PRINT_ONLY) console.error('트랜스크립트를 찾지 못했습니다.');
    return;                                   // 훅에서는 조용히 넘어간다
  }

  let raw, srcKB;
  try {
    raw = readFileSync(transcript, 'utf8');
    srcKB = Math.round(statSync(transcript).size / 1024);
  } catch { return; }

  const turns = extractTurns(raw);
  if (!turns.length) return;                  // 대화가 하나도 없으면 아무것도 안 쓴다

  const sessionId = hook?.session_id || path.basename(transcript).replace(/\.jsonl$/, '') || 'unknown';
  const id8 = sessionId.slice(0, 8);
  const root = repoRoot(hook?.cwd || process.cwd());
  const repo = repoName(root);

  /* 파일명 날짜는 **첫 턴의 KST 날짜로 고정**한다 — 자정을 넘겨도 같은 세션이 두 파일로
   * 갈라지지 않는다(설계 §6). 세션당 파일 1개, 매 턴 덮어쓰기. */
  const date = kstDate(turns[0]?.at) || kstDate(new Date().toISOString());
  const fileName = `${date}-${id8}.md`;
  /* 헤더의 추출기 경로는 **실제 실행 위치**를 적는다 — 타워에서는 tools/chat-archive/,
   * 배포 사본은 .claude/chat-archive/ 에 산다. 하드코딩하면 배포본의 헤더가 거짓말을 한다. */
  const self = (() => {
    try { return path.relative(root, fileURLToPath(import.meta.url)) || 'collect-session.mjs'; }
    catch { return 'collect-session.mjs'; }
  })();
  const body = renderArchive({
    turns, title: `${date}-${id8}`, repo, srcKB, by: self,
  });

  if (PRINT_ONLY) { console.log(body); return; }

  /* ── 갈래 0: 출력 경로가 못 박혀 있으면 그리로만 쓴다 (PC 로컬 세션) ────────
   * PeterJ 데스크탑 세션은 저장소 밖에서 도는 것이 많아(사용량 실측 52건 중 17건 =
   * 단일 최대 표면인데 대화는 0건이었다) 릴레이할 GC 클론도, 쓸 `.chat/`도 없다.
   * 사용량이 이미 쓰는 길을 그대로 쓴다 — PC가 **Drive 동기화 폴더**에 떨어뜨리고
   * 타워가 하루 한 번 걷는다(`pull-local-drive.mjs`). 새로 만드는 배관이 0이다.
   * 종전 규칙에 "저장소 밖이라 실어 보낼 곳이 없다"고 적혀 있었는데 **그것은 틀렸다** —
   * 사용량은 그 길로 이미 오고 있었다(2026-08-09 설계토론 F9). */
  const outDir = process.env.CHAT_OUT_DIR;
  if (outDir) {
    const out = path.join(outDir, fileName);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, body, 'utf8');
    console.error(`[chat-archive] ${out} — ${turns.length}턴 (CHAT_OUT_DIR)`);
    return;
  }

  /* ── 갈래 판별 (설계 §3-2) — 추측하지 않고 파일의 유무로 가른다 ───────────── */
  const isTower = existsSync(path.join(root, 'tools', 'chat-archive'));
  const relayMarker = path.join(root, '.claude', 'chat-archive', 'relay-to-gc');

  if (isTower) {
    /* 타워도 릴레이한다 (PeterJ 확정 2026-08-09 — 설계토론 F1).
     *
     * 종전에는 파일을 쓰고 스테이징만 했다. 그래서 **마지막 커밋 이후의 턴이 통째로
     * 빠졌다** — 실물로 확인됐다: 08-08·08-09 아카이브가 "핸드오프를 쓰고 마무리하겠습니다"
     * 에서 끊겨 있고, 두 세션 다 그 뒤로 한참 더 진행됐다. 잘리는 자리가 하필 4종 마무리
     * 직후 = PeterJ의 마지막 지시가 나오는 자리다.
     *
     * 왜 `sessions/`가 아니라 `repos/global-config/`인가
     *   릴레이 브랜치는 origin/main **전체 사본**이라, 수거기가 어떤 경로를 걷게 하면
     *   다른 저장소의 낡은 릴레이 브랜치도 그 경로를 함께 덮어쓴다. `sessions/`를 수거
     *   경로에 넣으면 2026-08-08 사고(낡은 사본이 main을 덮음)가 되살아난다 —
     *   harvest-branches.test.sh [4]가 지키는 바로 그것이다. 그래서 타워도 다른 저장소와
     *   똑같이 `repos/<repo>/` 밑에 쌓는다. 옛 `sessions/` 파일들은 그대로 둔다.
     *
     * 릴레이가 실패하면 종전 방식으로 되돌아간다 — 커밋에 의존하지만 아무것도 안 남는
     * 것보다는 낫다. 그 경우 같은 세션의 파일이 두 곳에 생길 수 있는데, 중복은 되돌릴 수
     * 있고 유실은 못 되돌린다. */
    const r = relayToGc(root, { repo, fileName, body, id8 });
    if (r.ok) {
      if (r.changed) console.error(`[chat-archive] ${r.branch}에 올림 — ${turns.length}턴`);
      return;
    }
    console.error(`[chat-archive] 타워 릴레이 실패(${r.why}) — 로컬 폴백으로 씁니다`);
    const out = path.join(root, 'data', 'chat-archive', 'sessions', fileName);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, body, 'utf8');
    stage(out);
    console.error(`[chat-archive] ${path.relative(root, out)} — ${turns.length}턴 (커밋해야 남습니다)`);
    return;
  }

  if (existsSync(relayMarker)) {
    const gc = findGcClone(root);
    if (!gc) {
      /* GC 클론이 없다 → 파일은 안 쓰고 **한 번만** Stop을 block해 세션에게 되돌린다.
       * 평문 stdout은 Stop 훅에서 모델에게 전달되지 않는다 — block이 유일한 전달 경로다.
       * `stop_hook_active`면 이미 우리가 한 번 막은 것이므로 그냥 통과한다(무한 루프 방지). */
      if (!hook?.stop_hook_active) {
        console.log(JSON.stringify({
          decision: 'block',
          reason: '대화 아카이브: add_repo로 njell85-spec/global-config를 붙여 주세요. 붙이면 이 세션 대화가 매 턴 자동 보관됩니다(커밋 불필요). 붙이지 않으면 이 세션 대화는 남지 않습니다.',
        }));
      }
      return;
    }
    const r = relayToGc(gc, { repo, fileName, body, id8 });
    if (!r.ok) console.error(`[chat-archive] GC 릴레이 실패 — ${r.why}`);
    else if (r.changed) console.error(`[chat-archive] GC ${r.branch}에 올림 — ${turns.length}턴`);
    return;
  }

  // 폴백 — 릴레이 마커가 아직 안 닿은 옛 배포본. 자기 마당에 쓰고 타워가 pull-repos.mjs로 걷는다.
  // **이 경로는 커밋에 의존한다**(그 세션이 커밋을 안 하면 유실) — 그래서 2026-08-06에
  // 릴레이를 전 repo 공통으로 바꿨다. 배포가 닿으면 여기로 안 온다.
  const out = path.join(root, '.chat', 'sessions', fileName);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, body, 'utf8');
  stage(out);
  console.error(`[chat-archive] ${path.relative(root, out)} — ${turns.length}턴`);
}

/* CLI(extract-session.mjs)가 import할 때는 main을 돌리지 않는다 — 직접 실행일 때만 돈다. */
const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { return false; }
})();

if (invokedDirectly) {
  try {
    main();
  } catch {
    // 훅에서 도는 도구다 — 무슨 일이 있어도 세션을 막지 않는다.
  }
  process.exit(0);
}
