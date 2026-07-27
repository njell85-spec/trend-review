#!/usr/bin/env node
/**
 * 관제 v2 — 클라우드/로컬 세션 사용량 수집기
 *
 * 왜 있나
 * -------
 * v1은 GitHub Actions 표면만 잡는다. 정작 토큰을 가장 많이 태우는 **세션(=이 대화)**이
 * 통째로 빠져 있었다. 2026-07-26 실측: 하루치 Actions 전체가 2.6M 토큰인데
 * 세션 하나가 56.2M — 20배였다.
 *
 * 측정은 이미 되고 있다. Claude Code가 세션 트랜스크립트(JSONL)에 턴마다
 * `message.usage`(input/output/cache_creation/cache_read)를 적는다. 문제는 **꺼내오기**다:
 * 클라우드 컨테이너는 세션이 끝나면 사라지고, 그때 트랜스크립트도 같이 사라진다.
 *
 * 그래서 이 도구는 **Stop 훅에서 매 턴 끝마다** 돌면서 지금까지의 누계를 repo 안
 * 스냅샷 파일에 덮어쓴다. 컨테이너가 언제 죽든 **마지막으로 커밋된 스냅샷**이 남는다.
 *
 * 왜 장부(jsonl)에 직접 append하지 않나
 * -------------------------------------
 * 장부는 **append-only**다. 세션 누계는 턴마다 커지므로 append하면 같은 세션이
 * 수십 줄로 불어난다. 그래서 세션은 **세션당 파일 1개(덮어쓰기)** 로 두고,
 * 현황판 빌더가 장부와 합산한다. 스냅샷은 트랜스크립트에서 언제든 다시 만들 수 있는
 * **생성물**이므로 덮어쓰기가 안전하고, 장부의 불변계약도 그대로 지켜진다.
 *
 * 정확도
 * ------
 * 트랜스크립트에는 **비용이 없다**(토큰만 있다). 그래서 모델별 공시 단가로 환산하며,
 * 레코드의 `accuracy`는 `approx`로 기록한다 — Actions 표면의 `exact`와 구분된다.
 * 구독으로 쓰는 경우 이 값은 "API로 샀다면 이만큼"이라는 환산치다(실제 청구액 아님).
 *
 * 사용법
 * ------
 *   node tools/usage/collect-session.mjs              # 훅 입력(stdin JSON) 또는 자동 탐색
 *   node tools/usage/collect-session.mjs --print      # 파일을 쓰지 않고 결과만 출력
 *   node tools/usage/collect-session.mjs --transcript <path>
 *
 * 훅에서 쓸 때는 **절대 실패로 세션을 막지 않는다** — 무슨 일이 있어도 종료코드 0.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* 출력 위치 — 이 수집기는 **모든 repo에 배포**된다(tools/sync-to-repo.sh).
 * · 타워(global-config): 장부 옆 `data/usage/sessions/`
 * · 프로젝트 repo: `.usage/sessions/` — 그 repo의 세션이 자기 repo에 남긴다.
 *   타워는 나중에 `tools/usage/collect-repos.mjs`로 걷어 합산한다.
 * 배포본은 `<repo>/.claude/usage/collect-session.mjs`에 놓이므로 ROOT는 어느 쪽이든 repo 루트다. */
const OUT_DIR = process.env.USAGE_OUT_DIR
  ? path.resolve(process.env.USAGE_OUT_DIR)
  : existsSync(path.join(ROOT, 'data', 'usage'))
    ? path.join(ROOT, 'data', 'usage', 'sessions')
    : path.join(ROOT, '.usage', 'sessions');

const argv = process.argv.slice(2);
const PRINT_ONLY = argv.includes('--print');
const TRANSCRIPT_ARG = (() => {
  const i = argv.indexOf('--transcript');
  return i >= 0 ? argv[i + 1] : null;
})();

/* ---------------- 단가표 ----------------
 * $/1M 토큰. 출처: Anthropic 공시 단가(2026-07 기준).
 * 캐시읽기 = 입력가 × 0.1 · 캐시쓰기 = 입력가 × CACHE_WRITE_MULT.
 * CACHE_WRITE_MULT: 5분 TTL이면 1.25, 1시간 TTL이면 2.0.
 * 이 세션 하네스는 1시간 TTL을 쓰므로 2.0을 기본값으로 둔다(환경변수로 조정 가능).
 * 모르는 모델은 UNKNOWN 단가로 잡고 note에 표시한다 — 조용히 0으로 만들지 않는다. */
const PRICES = {
  'claude-fable-5': [10, 50],
  'claude-mythos-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-opus-4-5': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-4-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
};
/* 모르는 모델은 **표에서 가장 비싼 값**으로 잡는다 — 과소보고보다 과대보고가 낫기 때문이다.
 * 종전에는 Opus급 [5,25]를 "보수적"이라고 썼는데, 표에 그보다 비싼 [10,50]이 이미 있어서
 * 실제로는 절반으로 과소 계상하고 있었다(2026-07-27 Fable 검토). 표가 바뀌면 같이 따라가게
 * 상수 대신 계산으로 둔다 — 단가를 하나 추가하고 이 줄을 잊는 날이 오기 때문이다. */
const UNKNOWN_PRICE = Object.values(PRICES).reduce(
  (max, p) => (p[0] > max[0] ? p : max), [0, 0]);
const CACHE_WRITE_MULT = Number(process.env.USAGE_CACHE_WRITE_MULT || '2');

/** 스냅샷 스키마 판(版). 집계 규칙이 바뀌면 올린다 — 판이 높으면 병합에서 이긴다.
 *  2 = message.id 중복 제거 + 서브에이전트 포함 (2026-07-27, 종전 대비 비용 약 -44%).
 *  3 = 표면(surface)을 환경 신호로 판정 + CI 실행 제외 (2026-07-27 저녁).
 *  이게 없으면 "턴 수가 큰 쪽이 이긴다"는 병합 규칙 때문에 **옛 스냅샷이 계속 이긴다.** */
const SNAPSHOT_SCHEMA = 3;

/* ---------------- 표면(surface) 판정 ----------------
 * 어느 경로에서 태운 토큰인가. 장부 C1의 `surface` 칸에 그대로 들어간다.
 *
 * **기본값을 박아두지 않고 환경 신호로 판정한다** (2026-07-27 개정).
 * 종전에는 기본이 `cloud`이고 "로컬에서 돌릴 때 USAGE_SURFACE=local만 주면 된다"였다.
 * 그런데 그 한 줄을 **아무도 주지 않았다** — `Trend_Review_v2`(PeterJ 데스크탑에서 매일
 * 도는 로컬 파이프라인)에 수집기를 배포했지만 `local-daily.ps1`에 그 환경변수가 없어서,
 * 로컬 사용량이 전부 `cloud`로 적힐 참이었다. 설정을 잊으면 **틀린 값이 조용히 쌓이고
 * 화면상으로는 정상으로 보인다** — 이 저장소가 반복해서 당한 실패 모양이다.
 *
 * 판정 근거는 관측된 사실이다: 클라우드 컨테이너에는 `CLAUDE_CODE_REMOTE=true`가 있고
 * (2026-07-27 실측), PeterJ 데스크탑에는 없다.
 * 못 잡는 경우도 적어 둔다 — `CLAUDE_CODE_REMOTE`를 안 세우는 클라우드 변종이 생기면
 * `local`로 잘못 적힌다. 그때는 그 세션에 `USAGE_SURFACE=cloud`를 주면 되고, 명시가
 * 판정보다 항상 우선한다. 이건 표시가 갈리는 문제지 값이 사라지는 문제는 아니다. */
const SURFACES = ['cloud', 'local', 'cowork', 'api'];
const SURFACE = (() => {
  const s = String(process.env.USAGE_SURFACE || '').trim();
  if (SURFACES.includes(s)) return s;          // 명시가 최우선
  return process.env.CLAUDE_CODE_REMOTE === 'true' ? 'cloud' : 'local';
})();

/* ---------------- CI 실행은 세지 않는다 (2026-07-27 실측으로 확정) ----------------
 *
 * **같은 실행이 장부에 두 번 들어갈 참이었다.**
 *
 * `trend-review`의 데일리 워크플로우는 `claude -p ... --output-format json`으로 CLI를
 * 여러 번 spawn한다. 실측(2026-07-27): 그 호출은 **Stop 훅을 발화시킨다.** 즉 CLI 호출마다
 * 이 수집기가 돌아 `.usage/sessions/`에 `approx` 스냅샷을 쓰고 스테이징까지 한다.
 * 그런데 같은 워크플로우의 `Append usage to tower ledger` 스텝이 **같은 토큰을 `exact`로**
 * 장부에 이미 적는다. 게다가 그 repo의 커밋 스텝은 `git add <경로>` 뒤에 경로를 못 박지 않은
 * `git commit -m`이라 스테이징된 스냅샷이 그대로 딸려 올라간다 → 이중 계상.
 *
 * 아직 안 터진 것은 자동 스테이징이 07-27에 들어갔고 그 뒤 데일리가 아직 안 돌았기 때문이다.
 *
 * **왜 `exact` 쪽을 남기나** — CLI가 스스로 보고한 값이라 정확하고(`total_cost_usd` 포함),
 * 실패한 호출까지 적재한다. 이쪽 `approx`는 공시단가 환산치다. 둘 중 하나를 버려야 하면
 * 환산치를 버리는 것이 맞다.
 *
 * **조용히 버리지 않는다** — 건너뛴 이유를 stderr에 남긴다(Actions 로그에 그대로 보인다).
 * 그리고 Actions에서 claude를 돌리면서 장부 적재를 붙이지 **않은** repo가 생기면 이 규칙이
 * 곧 누락이 되므로, 그런 repo는 `USAGE_COLLECT_IN_CI=1`로 켜면 된다.
 * 규칙 정본: rulebook/usage-accounting.md */
function ciSkipReason() {
  if (process.env.USAGE_COLLECT_IN_CI === '1') return null;   // 명시적 opt-in
  if (process.env.GITHUB_ACTIONS === 'true') return 'GitHub Actions';
  return null;
}

/** 모델 ID를 단가표 키로 정규화 (날짜 접미사 제거: claude-haiku-4-5-20251001 → claude-haiku-4-5) */
function priceFor(model) {
  if (PRICES[model]) return { price: PRICES[model], known: true };
  const stripped = String(model).replace(/-\d{8}$/, '');
  if (PRICES[stripped]) return { price: PRICES[stripped], known: true };
  return { price: UNKNOWN_PRICE, known: false };
}

function costOf(model, t) {
  const { price, known } = priceFor(model);
  const [pin, pout] = price;
  const usd =
    (t.in * pin + t.out * pout + t.cache_w * pin * CACHE_WRITE_MULT + t.cache_r * pin * 0.1) / 1e6;
  return { usd: Math.round(usd * 1e6) / 1e6, known };
}

/* ---------------- KST · 시각 정밀도 ----------------
 * 세션 스냅샷의 시각은 **날짜까지만** 남긴다 (PeterJ 확정 2026-07-26).
 *
 * 왜: 스냅샷은 public repo(trend-review 등)에도 커밋된다. 개별 수치(토큰·환산비용)는
 * 노출돼도 무해하지만, **분 단위 시각이 매일 쌓이면 시계열이 된다** — 몇 시에 일하고
 * 언제 쉬는지가 공개 git 히스토리에 영구히 남는다. 그건 사용량이 아니라 생활 패턴이다.
 * 원래 "public repo엔 누적 숫자 금지" 규칙이 막으려던 것도 금액이 아니라 이 시계열이었다.
 *
 * 비용은 0이다: 현황판은 `date`로만 집계하고, 같은 세션의 신구 판별은 시각이 아니라
 * `turns`로 한다. 그래서 뭉개도 화면·집계·중복제거가 전혀 바뀌지 않는다.
 *
 * **private·public을 가리지 않고 같은 포맷을 쓴다.** 모드 분기를 두면 어느 쪽이
 * 적용됐는지 매번 확인해야 하고, 잘못 설정된 채로 도는 것을 아무도 눈치채지 못한다. */
function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
/** KST 날짜 (YYYY-MM-DD) — 세션 스냅샷의 시각 표기는 이것 하나뿐이다. */
function kstDate() {
  const d = kstNow();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/* ---------------- 훅 입력 ----------------
 * Claude Code 훅은 stdin으로 JSON을 준다(session_id · transcript_path · cwd 등).
 * 있으면 그걸 쓰는 게 가장 정확하고, 없으면 가장 최근 트랜스크립트를 찾는다. */
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
 *  Windows에는 HOME이 없는 경우가 많아 USERPROFILE도 본다 — PeterJ 데스크탑(로컬 수집)이
 *  이 폴백을 탈 수 있기 때문이다. 훅으로 돌 때는 transcript_path가 오므로 여기까진 안 온다. */
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
      // `subagents/`는 건너뛴다 — 서브에이전트 파일은 본 세션 집계에 이미 합산되고,
      // 여기서 골라 버리면 **서브에이전트를 그 자체로 하나의 세션으로 착각**해
      // `agent-xxxx` 가짜 스냅샷을 만들면서 정작 본 세션 갱신은 그 커밋에서 빠진다.
      // (백그라운드 에이전트가 방금 쓴 파일이 mtime 최신이라 실제로 뽑히기 쉽다.)
      if (st.isDirectory()) { if (name !== 'subagents') walk(p, depth + 1); }
      else if (name.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path: p, mtimeMs: st.mtimeMs };
      }
    }
  };
  walk(base, 0);
  return best ? best.path : null;
}

/* ---------------- 집계 ---------------- */

/**
 * 트랜스크립트 한 벌을 합산한다.
 *
 * ⚠️ **같은 응답이 여러 줄에 반복 기록된다 — `message.id`로 중복을 걸러야 한다.**
 * Claude Code는 한 API 응답을 여러 JSONL 줄로 나눠 쓰면서 **각 줄에 같은 usage를 통째로
 * 되풀이**한다. 줄마다 더하면 같은 토큰이 2~4번 들어간다. 2026-07-27 이 세션 실측:
 *   usage 있는 줄 1,033 · 고유 message.id 587 · 같은 id인데 값이 다른 경우 0
 *   그대로 합산 $258.62 vs id로 중복 제거 $144.52 → **비용 +79% 과대**
 * 값이 항상 동일함을 확인했으므로 첫 줄만 취하면 정확하다.
 * (Fable 검토 2026-07-27에서 지적 → 재현·확정.)
 *
 * `id`가 없는 줄은 접을 근거가 없으므로 그대로 더한다 — 조용히 버리지 않는다.
 */
function aggregateOne(file, byModel, seen) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return 0; }
  let turns = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    const msg = o.message;
    if (!msg || typeof msg !== 'object') continue;
    const u = msg.usage;
    if (!u || typeof u !== 'object') continue;

    const id = typeof msg.id === 'string' && msg.id ? msg.id : null;
    if (id) {
      if (seen.has(id)) continue;   // 같은 응답의 되풀이 — 이미 셌다
      seen.add(id);
    }

    const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
    turns++;
    const cur = byModel.get(model) || { in: 0, out: 0, cache_w: 0, cache_r: 0 };
    const n = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
    cur.in += n(u.input_tokens);
    cur.out += n(u.output_tokens);
    cur.cache_w += n(u.cache_creation_input_tokens);
    cur.cache_r += n(u.cache_read_input_tokens);
    byModel.set(model, cur);
  }
  return turns;
}

/** 이 세션이 태운 것을 **빠짐없이** 모은다 — 메인 트랜스크립트 + 서브에이전트들.
 *  서브에이전트는 `<세션id>/subagents/agent-*.jsonl`에 따로 쌓이고, 메인에는 그 usage가
 *  전혀 안 들어간다(2026-07-27 실측: 겹치는 message.id 0개). 그래서 메인만 세면 서브에이전트에
 *  맡긴 작업이 통째로 장부에서 빠진다 — 큰 검토를 서브에이전트에 위임할수록 더 많이 샌다. */
function aggregateTranscript(file) {
  const byModel = new Map();
  const seen = new Set();
  let turns = aggregateOne(file, byModel, seen);

  const subDir = path.join(path.dirname(file), path.basename(file).replace(/\.jsonl$/, ''), 'subagents');
  if (existsSync(subDir)) {
    for (const name of readdirSync(subDir)) {
      if (name.endsWith('.jsonl')) turns += aggregateOne(path.join(subDir, name), byModel, seen);
    }
  }
  return { byModel, turns };
}

/* ---------------- main ---------------- */
function main() {
  // CI 실행이면 아무것도 쓰지 않는다(위 "CI 실행은 세지 않는다" 참조).
  // `--print`는 진단용이라 그대로 통과시킨다 — 파일을 쓰지 않으므로 이중 계상이 없다.
  const skip = ciSkipReason();
  if (skip && !PRINT_ONLY) {
    console.error(
      `[usage] ${skip} 실행이라 세션 스냅샷을 쓰지 않습니다 — 이 표면은 워크플로우가 ` +
      `exact로 장부에 직접 적습니다(이중 계상 방지). 켜려면 USAGE_COLLECT_IN_CI=1.`
    );
    return;
  }

  const hook = readHookInput();
  const transcript = TRANSCRIPT_ARG || hook?.transcript_path || findLatestTranscript();
  if (!transcript || !existsSync(transcript)) {
    if (PRINT_ONLY) console.error('트랜스크립트를 찾지 못했습니다.');
    return; // 훅에서는 조용히 넘어간다
  }

  const sessionId =
    hook?.session_id || path.basename(transcript).replace(/\.jsonl$/, '') || 'unknown';
  // repo 이름: 훅의 cwd → 없으면 이 스크립트가 사는 repo
  const repo = path.basename(hook?.cwd || ROOT);

  const { byModel, turns } = aggregateTranscript(transcript);
  if (byModel.size === 0) return;

  // 시각은 날짜까지만 (위 "KST · 시각 정밀도" 참조). 장부 C1 스키마의 `ts`·`date`
  // 두 칸을 유지하되 둘 다 같은 날짜값을 넣는다 — 칸을 없애면 장부 파서가 깨진다.
  const date = kstDate();
  const ts = date;
  const records = [];
  for (const [model, t] of byModel) {
    const { usd, known } = costOf(model, t);
    records.push({
      ts,
      date,
      surface: SURFACE,
      repo,
      task: 'session',
      model,
      in: t.in,
      out: t.out,
      cache_w: t.cache_w,
      cache_r: t.cache_r,
      cost_usd: usd,
      auth: 'subscription',
      accuracy: 'approx',
      run_id: sessionId,
      note: known
        ? `세션 누계(턴 ${turns}) · 공시단가 환산 · 캐시쓰기 배수 ${CACHE_WRITE_MULT}`
        : `세션 누계(턴 ${turns}) · ⚠️ 단가표에 없는 모델이라 Opus급으로 추정`,
    });
  }

  // `schema`는 병합 판정에 쓰인다 — 아래 설명은 lib/snapshot-store.mjs 참조.
  // 2 = message.id 중복 제거 + 서브에이전트 포함 (2026-07-27). 1 = 그 이전(과대 집계).
  const snapshot = { session_id: sessionId, schema: SNAPSHOT_SCHEMA, repo, updated: date, turns, records };

  if (PRINT_ONLY) {
    const total = records.reduce((s, r) => s + r.cost_usd, 0);
    const tok = records.reduce((s, r) => s + r.in + r.out + r.cache_w + r.cache_r, 0);
    console.log(`세션 ${sessionId.slice(0, 8)}… · 턴 ${turns} · 모델 ${records.length}종`);
    for (const r of records) {
      console.log(
        `  ${r.model.padEnd(28)} in ${String(r.in).padStart(9)} out ${String(r.out).padStart(9)}` +
        ` cw ${String(r.cache_w).padStart(9)} cr ${String(r.cache_r).padStart(11)}  $${r.cost_usd.toFixed(2)}`
      );
    }
    console.log(`  합계: ${tok.toLocaleString('en-US')} 토큰 · $${total.toFixed(2)} (환산치)`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${sessionId}.json`);
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  stageSnapshot(outFile);
}

/* 쓴 스냅샷을 곧바로 스테이징한다 (2026-07-27).
 *
 * 왜 필요한가: 각 repo 세션은 **자기 컨테이너**에서 돌고, 컨테이너는 회수된다. 타워는
 * 나중에 GitHub에서 새로 클론해 걷으므로, 스냅샷이 **커밋돼 올라가지 않으면 통째로 유실**된다.
 * 종전에는 "`git add`에 포함시킬 것"이라는 지침에만 기대고 있었다 — 세션이 잊으면 조용히
 * 사라지고, 사라졌다는 사실조차 안 보인다(화면에는 "안 썼다"와 똑같이 나온다).
 *
 * 여기서 스테이징까지만 하면 그 세션이 무슨 커밋을 하든 딸려 올라간다. 커밋·푸시는
 * 하지 않는다 — 세션의 커밋 타이밍과 메시지는 세션의 것이고, 훅이 멋대로 커밋을
 * 만들면 그게 더 나쁘다.
 *
 * 실패는 전부 삼킨다: git이 없을 수도, repo가 아닐 수도, 다른 git 명령과 index.lock이
 * 겹칠 수도 있다. 어느 경우든 **스냅샷 파일 자체는 이미 쓰였고**, 세션이 평소대로
 * `git add`하면 그대로 올라간다. 훅을 깨뜨리면서까지 지킬 값어치는 없다. */
function stageSnapshot(file) {
  try {
    spawnSync('git', ['add', '--', file], {
      cwd: path.dirname(file), stdio: 'ignore', timeout: 5000,
    });
  } catch { /* 위 주석 참조 — 조용히 넘어간다 */ }
}

try {
  main();
} catch {
  // 훅에서 도는 도구다 — 무슨 일이 있어도 세션을 막지 않는다.
}
process.exit(0);
