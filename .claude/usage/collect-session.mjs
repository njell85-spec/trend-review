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
const UNKNOWN_PRICE = [5, 25]; // 모르면 Opus급으로 보수적으로 잡는다(과소보고보다 낫다)
const CACHE_WRITE_MULT = Number(process.env.USAGE_CACHE_WRITE_MULT || '2');

/* 표면 — 기본은 `cloud`(클라우드 세션).
 * v3(데스크탑 로컬)는 별도 도구가 필요 없다: 로컬 Claude Code도 **같은 형식**의
 * 트랜스크립트를 `~/.claude/projects/`에 쓰므로 이 수집기가 그대로 동작한다.
 * 로컬에서 돌릴 때 `USAGE_SURFACE=local`만 주면 현황판에서 표면이 갈린다. */
const SURFACE = (() => {
  const s = String(process.env.USAGE_SURFACE || 'cloud').trim();
  return ['cloud', 'local'].includes(s) ? s : 'cloud';
})();

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

/** 훅 입력이 없을 때: ~/.claude/projects/**\/*.jsonl 중 가장 최근에 수정된 것 */
function findLatestTranscript() {
  const base = path.join(process.env.HOME || '/root', '.claude', 'projects');
  if (!existsSync(base)) return null;
  let best = null;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path: p, mtimeMs: st.mtimeMs };
      }
    }
  };
  walk(base, 0);
  return best ? best.path : null;
}

/* ---------------- 집계 ---------------- */
function aggregateTranscript(file) {
  const text = readFileSync(file, 'utf8');
  const byModel = new Map();
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
  return { byModel, turns };
}

/* ---------------- main ---------------- */
function main() {
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

  const snapshot = { session_id: sessionId, repo, updated: date, turns, records };

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
  writeFileSync(path.join(OUT_DIR, `${sessionId}.json`), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

try {
  main();
} catch {
  // 훅에서 도는 도구다 — 무슨 일이 있어도 세션을 막지 않는다.
}
process.exit(0);
