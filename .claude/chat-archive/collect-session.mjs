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
 *     매 턴 대화와 사용량을 비공개 GC 릴레이에 싣고, 타워가 하루 한 번 걷는다.
 *
 * 새 개념을 만들지 않는다. 그릇만 다르다(사용량 JSON → 대화 마크다운).
 *   · 언제  — 각 repo와 타워는 Stop 훅(매 턴 끝), 타워는 git `pre-commit`도 사용한다.
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
 *   · 타워 자신 (`tools/chat-archive/`가 있다)      → GC 릴레이, 실패하면 `data/chat-archive/repos/global-config/` + git add
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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/* =============================================================================
 * 1부. 추출 로직 — CLI(extract-session.mjs)가 그대로 import해 쓴다.
 * ========================================================================== */

/** 시스템이 끼워 넣은 텍스트인가 — 사람이 쓴 말이 아니면 버린다. */
const isRoomNotification = (text) => text.trim().startsWith('[SYSTEM NOTIFICATION - NOT USER INPUT]')
  || text.trim().startsWith('<wake reason="external-event"');

export function isInjected(text, roomNotifications = true) {
  const t = text.trimStart();
  return (
    t.startsWith('<system-reminder>') ||
    (roomNotifications && isRoomNotification(text)) ||
    t.startsWith('<command-name>') ||
    t.startsWith('<local-command') ||
    t.startsWith('Caveat:') ||
    t.startsWith('[Image:') ||
    t.startsWith('[Request interrupted') ||
    /^Stop hook feedback:/m.test(t) ||
    t.startsWith('<task-notification>') ||
    // 다른 세션·서브에이전트의 보고 — user 턴으로 오지만 모델 출력이다(2026-09-25 mpr 실물)
    t.startsWith('Another Claude session sent a message:')
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
 * **새 형태가 보이면 아래 `GENERATED_PROMPT_FORMS`에 추가할 것.**
 */
export function skillBodyMarker(text) {
  const m = String(text).trimStart().match(/^Base directory for this skill:\s*(\S+)/);
  if (!m) return null;
  const name = m[1].split('/').filter(Boolean).pop() || '이름 미상';
  return `_(스킬 본문 생략 — ${name} · ${String(text).length.toLocaleString('en-US')}자)_`;
}

/**
 * 스킬·명령·하네스가 만들어 낸 user 턴의 **다른 형태들** (2026-08-19 신설).
 *
 * GC#96(위 `skillBodyMarker`)이 잡은 것은 `Base directory for this skill:` 한 형태뿐이었고,
 * 그때 주석에 **"새 형태가 보이면 여기에 추가할 것"**이라고 적어 뒀다. 2026-08-19 전수 재감사에서
 * 그 새 형태들이 실제로 나왔다 — **PeterJ 발화로 기록된 글자의 87.4%**(6,587,904 / 7,533,464자)가
 * 사람이 쓴 말이 아니었다. GC#96 당시(57.3%)보다 오히려 나빠졌는데, 원인은 새로 쓰기 시작한
 * `/security-review`가 **바뀐 파일의 unified diff를 통째로 프롬프트에 실어** user 턴으로 넣기
 * 때문이다(단일 턴 최대 487,012자 · 148턴).
 *
 * 왜 그냥 두면 안 되나: 아카이브는 브리핑의 **원자료**다(rulebook §5 "3단 방어" ①).
 * 회수 하청·서브에이전트가 이걸 읽으면 ⓐ 창을 diff로 채워 진짜 발화를 밀어내고
 * ⓑ 스킬 지시문("Review this change…")을 **PeterJ의 요구로 읽는다.**
 *
 * 판별은 **접두 패턴 목록**으로만 한다. 크기·언어 비율 같은 휴리스틱은 실측에서 못 쓴다 —
 * diff 안에 한글 문자열이 섞여 있어 "한글 비율" 신호가 무너졌고(오탐 165/202), 길이만으로
 * 자르면 PeterJ가 붙여넣은 셋업 스크립트 같은 진짜 발화가 사라진다.
 *
 * 여기 없는 것: TR 세션에 나온 앱 자체 프롬프트(임상 큐레이터·리뷰 번역 등, 7턴).
 * 그건 그 저장소 고유라 **전 repo 공통 수집기가 알 일이 아니다** — 알고 남겨 둔다.
 */
const GENERATED_PROMPT_FORMS = [
  [/^Review this change for security vulnerabilities\./, '/security-review 프롬프트 + diff'],
  [/^You previously flagged these candidate vulnerabilities:/, '/security-review 재확인 프롬프트'],
  [/^Approach this as the design lead at a small studio/, 'artifact-design 스킬 본문'],
  [/^This session is being continued from a previous conversation/, '압축 요약 주입'],
  [/^This session's worker process was restarted\./, '워커 재시작 주입'],
];

/** 위 형태 중 하나면 자리표시 한 줄을 돌려준다(아니면 null). 이유는 `GENERATED_PROMPT_FORMS` 주석. */
export function generatedPromptMarker(text) {
  const t = String(text).trimStart();
  for (const [re, label] of GENERATED_PROMPT_FORMS) {
    if (re.test(t)) return `_(${label} 생략 — ${String(text).length.toLocaleString('en-US')}자)_`;
  }
  return null;
}

/* 내부 잡음 목록 — 정본은 같은 폴더의 internal-noise.json (Python grok/box/speakers.py 가 직접 읽는다).
 * 이 파일은 자족 배포본이라 JSON 을 읽지 못해 사본을 싣는다 — 둘이 다르면 speaker-contract.test.mjs 가 실패한다(2026-10-22 통일). */
export const INTERNAL_NOISE = {
  prefixes: [
    '^\\[?GROK_BOT_HIDDEN_PROMPT',
    '^# AGENTS\\.md',
    '^Base directory for this skill:',
    '^This session is being continued from a previous conversation',
    "^This session's worker process was restarted\\.",
    '^Review this change for security vulnerabilities\\.',
    '^You previously flagged these candidate vulnerabilities:',
    '^Approach this as the design lead at a small studio',
    '^<(?:environment_context|user_instructions|system-reminder|task-notification|recommended_plugins)\\b',
    '^\\[SYSTEM NOTIFICATION - NOT USER INPUT\\]',
    '^<wake\\b',
    '^Stop hook feedback:',
    '^\\[Request interrupted',
    '^<local-command',
    '^<command-name',
    '^Caveat:',
    '^\\[Cross-session (?:idle|delivery) notice\\]',
  ],
  harnessLines: [
    '^Another Claude session sent a message:\\s*$',
    '^From .+ Reply (?:if useful|with|using)\\b',
    '^This came from another Claude session — not typed by your user\\b',
  ],
  inline: [
    '<system-reminder>[\\s\\S]*?</system-reminder>',
    'Stop hook feedback:[\\s\\S]*?(?=\\n\\n|$)',
    '\\[Image:[^\\]]*\\]',
  ],
};
const NOISE_PREFIX = new RegExp(INTERNAL_NOISE.prefixes.join('|'));
const NOISE_LINES = INTERNAL_NOISE.harnessLines.map((s) => new RegExp(s));
const NOISE_INLINE = INTERNAL_NOISE.inline.map((s) => new RegExp(s, 'g'));

/** system-reminder 등 삽입 블록을 문장 중간에서도 걷어낸다. */
export function stripInline(text) {
  return NOISE_INLINE.reduce((t, re) => t.replace(re, ''), text).trim();
}

/** 한 메시지에서 사람이 읽을 텍스트만 뽑는다. */
export function textOf(message, roomNotifications = message?.role !== 'assistant') {
  // 스킬 본문·생성 프롬프트는 버리기 전에 자리표시로 바꾼다 — isInjected보다 먼저 본다.
  const one = (t) =>
    skillBodyMarker(t) ?? generatedPromptMarker(t) ?? (isInjected(t, roomNotifications) ? '' : stripInline(t));
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
/* ★ 작업 중에 PeterJ 가 보낸 말 (2026-09-25 실측) — `user` 가 아니라 이 모양으로 남는다:
 *   { type: 'attachment', attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt } }
 * 종전엔 user/assistant 만 봐서 **턴이 도는 중에 끼워 넣은 말이 전부 빠졌다.**
 * 사람 것만 받는다 — 같은 모양으로 에이전트 보고 등(origin.kind ≠ human)도 온다. */
function queuedHumanPrompt(o) {
  if (o.type !== 'attachment') return null;
  const a = o.attachment;
  if (!a || a.type !== 'queued_command') return null;
  const human = a.origin ? a.origin.kind === 'human' : a.humanTurn === true;
  return human ? { content: a.prompt } : null;
}

/* ★ 자동 보안 리뷰 트랜스크립트는 PeterJ 대화가 아니다 — **파일 단위로, 두 조건이 겹칠 때만** 가른다.
 * 커밋마다 도는 자동 보안 리뷰가 **같은 세션 id** 로 별도 트랜스크립트(entrypoint `sdk-py`)를 남기고,
 * GC 폴더에서 돌아 GC 의 Stop 훅이 그것을 **같은 아카이브 파일로** 밀었다(옛 `/security-review` "PeterJ 턴"의 근원).
 * ⚠️ 2026-09-25 같은 날 정정: 처음엔 "entrypoint 가 sdk 로 시작하는 **기록**은 버린다"로 막았는데,
 * **PC 의 Remote Control 서버 모드 세션도 entrypoint 가 sdk-… 로 찍혀** mpr 원격 세션의 진짜 대화(362건)가
 * 통째로 빠졌다. entrypoint 는 "사람이냐"가 아니라 "어떤 껍데기로 떴냐"다. 그래서 기록을 버리지 않고,
 * **첫 사람 메시지가 보안 리뷰 프롬프트이고 동시에 entrypoint 가 sdk*** 인 파일만 통째로 건너뛴다.
 * PeterJ 가 대화형 표면에서 직접 부른 /security-review 는 entrypoint 가 sdk 가 아니라 걸리지 않는다. */
const AUTOMATION_OPENERS = [
  /^Review this change for security vulnerabilities\./,
  /^You previously flagged these candidate vulnerabilities:/,
];
export function isAutomationTranscript(raw) {
  for (const line of String(raw).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' || o.isSidechain) continue;
    const c = o.message?.content;
    const text = typeof c === 'string' ? c
      : Array.isArray(c) ? (c.find((b) => b && b.type === 'text' && typeof b.text === 'string')?.text ?? null) : null;
    if (text === null) continue;                 // tool_result 등 — 사람 메시지가 아니다
    const sdk = typeof o.entrypoint === 'string' && o.entrypoint.startsWith('sdk');
    return sdk && AUTOMATION_OPENERS.some((re) => re.test(text.trimStart()));
  }
  return false;
}

/* ★ 같은 파일 안에 섞인 자동 보안 리뷰 턴 — **기록 단위로 출처를 가른다** (d1-20261007-25 · 10-07 실물).
 * security-guidance 2.0.8 훅은 커밋마다 백그라운드 리뷰를 돌리는데, 그 리뷰가 **본 세션과 같은 jsonl** 에
 * entrypoint `sdk-py` · parentUuid 없음으로 들어온다. 첫 사람 메시지가 원격(remote)이라 위 isAutomationTranscript
 * (파일 단위)로는 못 가르고, 종전엔 리뷰 프롬프트가 `### PeterJ`(자리표시)로, 리뷰 답이 `### Claude` 로 렌더됐다.
 * 게다가 하네스가 뒤이은 "Continue…"·사람 입력을 그 리뷰 턴의 자식으로 붙인다(10-07 18:35/18:38/18:52 KST).
 * **그래서 sdk 뿌리 사슬을 통째로 버리면 안 된다** — 진짜 사람 입력과 작업 결과가 거기 매달린다.
 * 가르는 것은 딱 이것뿐이다:
 *   뿌리 = entrypoint sdk* 이고 첫 글이 AUTOMATION_OPENERS 로 시작하는 user 기록
 *   사슬 = 부모(parentUuid)가 집합 안이고 entrypoint sdk* 이며 **사람 글이 아닌** 기록(assistant·attachment·tool_result 뿐인 user 등).
 *          부모가 없거나 줄 순서가 뒤집혀도 같은 promptId 의 user 기록(tool_result)은 뿌리에 붙인다(고정점까지 반복 — 줄 순서 무관).
 * 사람 글(user text)이 오면 거기서 사슬이 끊긴다 — 리뷰 턴의 자식이라도 사람 입력·그 뒤 작업은 종전대로 남는다.
 * 사람이 대화형 표면에서 직접 부른 /security-review 는 entrypoint 가 sdk 가 아니라 걸리지 않는다.
 * 지우지 않는다 — 화자만 `자동 보안 리뷰(요청)`·`자동 보안 리뷰(답)` 으로 바꾸고 첫 줄에 출처를 단다.
 * ⚠ 기록을 정확히 하는 것이지 하네스의 resume 갈래 선택을 고치는 것이 아니다. */
export const REVIEW_ASK = '자동 보안 리뷰(요청)';
export const REVIEW_ANSWER = '자동 보안 리뷰(답)';
/** 하네스 안내 — 출력 안전 검사가 답을 멈췄을 때 하네스가 user 자리에 넣는 글(isMeta:true · refusedMessageId · 10-11 C1 실측 CLI 2.1.296).
 * 사람 입력이 아니다 — PeterJ 로 적지 않는다(d1-20261011-12). 본문은 받은 그대로. */
export const REFUSAL_NOTE = '시스템(출력 차단)';   // 이름에 ' · ' 를 넣지 않는다 — 머리 줄 화자 파싱(/^### (.+?) · /)이 거기서 끊긴다
export const isRefusalNote = (o) => o?.type === 'user' && o.isMeta === true && typeof o.refusedMessageId === 'string' && o.refusedMessageId.length > 0;
const isSdk = (o) => typeof o?.entrypoint === 'string' && o.entrypoint.startsWith('sdk');
function firstUserText(o) {
  const c = o.message?.content;
  return typeof c === 'string' ? c
    : Array.isArray(c) ? (c.find((b) => b && b.type === 'text' && typeof b.text === 'string')?.text ?? null) : null;
}
/** 사람 글을 품은 user 기록인가 — tool_result·이미지·메타·주입(system-reminder 등)만 있으면 아니다. */
// d1-20261007-26 ①: 첫 text 블록만 보면 [주입 + 사람 말] 배열을 놓친다 → **모든** text 블록에서 주입이 아닌 사람 글을 찾는다.
// 작업 중 끼워 넣은 사람 말(attachment queued_command · origin.kind=human 또는 humanTurn=true)도 사슬 중단점이다.
const hasUserText = (o) => {
  if (queuedHumanPrompt(o)) return true;
  if (o.type !== 'user' || o.isMeta) return false;
  const c = o.message?.content;
  const texts = typeof c === 'string' ? [c]
    : Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text) : [];
  return texts.some((x) => x.trim() !== '' && !isInjected(x));
};
/** records 중 자동 보안 리뷰 턴(뿌리와 그 직접 사슬)의 집합(Set<record>). */
export function automationReviewRecords(records) {
  const set = new Set(), uuids = new Set(), prompts = new Set();
  const add = (o) => { set.add(o); if (o.uuid) uuids.add(o.uuid); };
  for (const o of records) {
    if (o.isSidechain || o.type !== 'user' || !isSdk(o)) continue;
    const text = firstUserText(o);
    if (text !== null && AUTOMATION_OPENERS.some((re) => re.test(text.trimStart()))) {
      add(o);
      if (o.promptId) prompts.add(o.promptId);
    }
  }
  if (!set.size) return set;
  for (let changed = true; changed;) {
    changed = false;
    for (const o of records) {
      if (set.has(o) || o.isSidechain || !isSdk(o) || hasUserText(o)) continue;
      const linked = (o.parentUuid && uuids.has(o.parentUuid))
        || (o.type === 'user' && o.promptId && prompts.has(o.promptId));
      if (linked) { add(o); changed = true; }
    }
  }
  return set;
}

/** 대화방 서명만 해석한다. 전달된 PeterJ 발화를 직접 지시와 구별한다. */
export function roomSpeaker(firstLine) {
  const first = String(firstLine ?? '').split(/\r?\n/)[0].trim();
  if (/^\[PeterJ via D1\]/.test(first)) return 'PeterJ(GPT)';
  if (/^\[PeterJ\]/.test(first)) return 'PeterJ(GitHub 직접)';
  // 10-06 추가(§3-7): 화살표 `⇢` · 맨 `C`(§13 투입 방) · 대상 뒤 꼬리 ` · …`. `C<자유 이름>`·C10+ 는 받지 않는다.
  const m = /^\[(D1|C[1-9]?|Claude|PeterJ\(GPT\)|PeterJ\(클로드\)) (?:→|->|⇢) (D1|C[1-9]?|Claude)(?: · [^\]]*)?\]/.exec(first);
  if (!m) return null;
  const [, from, to] = m;
  if ((from === 'D1' || from === 'PeterJ(GPT)') && /^(?:C[1-9]?|Claude)$/.test(to)) return from;
  if (/^(?:C[1-9]?|Claude|PeterJ\(클로드\))$/.test(from) && to === 'D1') return from === 'Claude' ? 'C1' : from;
  return null;
}

/** 서명은 못 읽지만 방 글 모양인가 — 첫 줄이 `[…]` 로 시작하고 같은 줄에 글 번호(g1-/c2-/d1-/c1-/c-YYYYMMDD-NN)가 있다.
 * 10-06(§3-7): 이런 글은 버리지 않고 `서명 없음` 으로 보존한다. 모양이 아니면 종전대로 버린다(일반 댓글).
 * 10-22(G1 회의 구조): G1 글 번호 `g1-…`·C2 `c2-…` 도 받는다(옛 `d1-…` 와 나란히). */
export function roomShaped(body) {
  const first = String(body ?? '').split(/\r?\n/)[0].trim();
  return /^\[[^\]\r\n]{1,120}\]/.test(first) && /\b(?:g1|d1|c1|c2|c)-\d{8}-\d{2}\b/.test(first);
}

/* ★ 방 댓글 출처 (6final · rulebook/g1-room.md §5-1) — 화자는 GitHub 작성자 신원과 '이 세션이 올렸나'로만 정한다. 본문 서명은 화자를 정하지 못한다.
 * Python 판 = grok/box/speakers.py room_comment_source · 공용 시험표 speaker-contract.fixtures.json roomComments 가 둘을 같이 묶는다. */
export const G1_APP_LOGIN = 'njell85-g1[bot]';
/** 작성자가 G1 GitHub App 봇인가 — 로그인이 정확히 같고, 종류가 주어졌으면 'Bot'. (`[bot]` 꼬리 로그인은 App 만 가질 수 있다.) */
export function isG1AppAuthor(login, type) {
  return login === G1_APP_LOGIN && (type === undefined || type === null || type === 'Bot');
}
// 이 세션이 자기 글 첫 줄 보낸 쪽에 적은 이름 — 작업 세션 이름표 꼴일 때만(C1·C2·봇·PeterJ 이름은 받지 않는다 — 진짜 C1·C2 와 섞이지 않게 · Fable B6). 이름표가 없을 때만 쓴다.
const SELF_CLAIM_RE = /^\[([A-Z][A-Z0-9]*-\d{6}(?:-\d+)?\((?:회의|작업)\)) (?:→|->|⇢) [^\]\r\n]+\]/;
const G1_TO_RE = /^\[G1 (?:→|->|⇢) ([^\]\s·]+)/;
/**
 * 방 댓글 한 건의 화자와 출처 줄. → { who, line }
 * - posted(이 세션의 add_issue_comment): 이름표 > (이름표 없을 때) 자기 글 첫 줄의 작업 세션 이름 > selfSpeaker. `## **[이름]** · 방 댓글 #ID · 이 세션 게시`
 * - 작성자 = G1 App: `## **[G1]** · 방 댓글 #ID · 직통` — 받는 쪽이 C1·C2(G1 의 검증된 글의 첫 줄, 없으면 이 세션 이름)면 `· 경유`.
 * - 그 밖(같은 계정 등): `## **[user (unverified)]** · 방 댓글 #ID · 작성 <login> · 주장(미검증)`.
 * - pasted(사람 입력 자리에 붙여 넣은 알림 — 하네스 배달이 아님): 작성자 칸이 G1 App 이어도 `· 작성 <login> · 사람 입력 · 주장(미검증)`(Fable B1).
 */
export function roomCommentSource({ posted = false, author = null, authorType, id = null, self = 'Claude', selfLabeled = false, body = '', pasted = false } = {}) {
  const first = String(body ?? '').split(/\r?\n/)[0].trim();
  const num = id == null || id === '' ? '' : ` #${id}`;
  if (posted) {
    const claim = selfLabeled ? null : SELF_CLAIM_RE.exec(first)?.[1];
    const who = claim ?? self;
    return { who, line: `## **[${who}]** · 방 댓글${num} · 이 세션 게시` };
  }
  if (pasted) return { who: UNVERIFIED, line: `## **[${UNVERIFIED}]** · 방 댓글${num} · 작성 ${author ?? '없음'} · 사람 입력 · 주장(미검증)` };
  if (isG1AppAuthor(author, authorType)) {
    const to = G1_TO_RE.exec(first)?.[1] ?? self;
    return { who: 'G1', line: `## **[G1]** · 방 댓글${num} · ${ROOM_LEADS.has(to) ? '경유' : '직통'}` };
  }
  return { who: UNVERIFIED, line: `## **[${UNVERIFIED}]** · 방 댓글${num} · 작성 ${author ?? '없음'} · 주장(미검증)` };
}
const ROOM_LEADS = new Set(['C1', 'C2']);

const blockText = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
const roomBody = (text) => text.replace(/\r\n/g, '\n').trim();

/** 문자열과 이스케이프를 존중하며 첫 JSON 객체를 읽는다 — { value, end }(end = 객체 다음 위치). 없으면 null. */
export function jsonObjectSpan(text, start) {
  const begin = text.indexOf('{', start);
  if (begin < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = begin; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { value: JSON.parse(text.slice(begin, i + 1)), end: i + 1 };
  }
  return null;
}
const jsonObjectAt = (text, start) => jsonObjectSpan(text, start)?.value ?? null;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bodyHash = (body) => createHash('sha1').update(roomBody(body)).digest('hex').slice(0, 8);

/** message.content만 읽는다. toolUseResult.notifications는 같은 알림의 사본이다.
 * tool_result 는 **알림 도구(ReadNotifications)의 결과일 때만** 읽는다(isNotif) — 명령 출력·다른 세션 조회 결과 속의
 * 같은 문구를 알림으로 잡지 않게(10-03 실측: 아카이브를 grep 한 Bash 출력이 '받은 세션 메시지'로 잡혔다). */
function roomEntries(o, isNotif = () => true) {
  const entries = [];
  const content = o.message?.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
  // 하네스가 사람 입력으로 찍은 기록(origin human · promptSource typed · turnOrigin human) 속 알림 글은 붙여 넣은 것이다 — 하네스 배달이 아니므로 작성자 칸을 믿지 않는다(Fable B1).
  const pasted = (o.origin ?? o.message?.origin)?.kind === 'human' || o.promptSource === 'typed' || o.turnOrigin === 'human';
  for (const b of blocks) {
    if (!b) continue;
    if (o.type === 'user' && ((b.type === 'tool_result' && isNotif(b.tool_use_id)) || (b.type === 'text' && typeof b.text === 'string' && isRoomNotification(b.text)))) {
      const text = b.type === 'tool_result' ? blockText(b.content) : b.text;
      /* 이벤트 태그를 미리 다 찾지 않는다 — 댓글 본문(JSON 문자열) 안의 `<event …>` 가 다음 이벤트로 잡혀
       * 스캐너 상한이 되면 정상 댓글이 잘린다(Astra 2차 재현). 읽은 JSON 객체 뒤에서부터 다음 태그를 찾는다. */
      const EVENT_RE = /<event\b([^>]*)>/g;
      for (let event; (event = EVENT_RE.exec(text));) {
        if (!/\bsource="github"/.test(event[1]) || !/\bkind="issue_comment.created"/.test(event[1])) continue;
        try {
          const start = event.index + event[0].length;
          if (/^(?:null\b|\[|-?\d)/.test(text.slice(start).trimStart())) continue;
          const span = jsonObjectSpan(text, start);
          if (!span) continue;
          EVENT_RE.lastIndex = span.end;
          const c = span.value;
          if (!object(c) || typeof c.comment !== 'string') continue;
          const times = [...text.slice(0, event.index).matchAll(/queued at:\s*(\S+)|<wake\b[^>]*\bcurrent-time="([^"]+)"/g)];
          const time = times.at(-1);
          // 작성자 신원(GitHub 가 정한 author)이 G1 App 이면 본문 모양과 상관없이 G1 글이다(6final · g1-room.md §5-1).
          const authorType = typeof c.author_type === 'string' ? c.author_type : typeof c.user_type === 'string' ? c.user_type : undefined;
          const fromPaste = pasted && b.type === 'text';
          // 붙여 넣은 알림도 남긴다(Python room_kept 와 같은 보존 판정) — 화자만 미검증으로 내린다.
          const appAuthor = isG1AppAuthor(c.author, authorType);
          const who = appAuthor ? (fromPaste ? UNVERIFIED : 'G1') : roomSpeaker(c.comment) ?? (roomShaped(c.comment) ? '서명 없음' : null);
          if (who) entries.push({ who, body: c.comment, id: c.comment_id, pr: c.pr, at: time ? (time[1] ?? time[2]) : o.timestamp, author: typeof c.author === 'string' ? c.author : null, authorType, pasted: fromPaste });
        } catch { /* 한 이벤트가 깨져도 다음 이벤트와 사람 발화는 보존한다. */ }
      }
    }
    if (o.type !== 'assistant' || b.type !== 'tool_use' || typeof b.input?.body !== 'string') continue;
    const input = b.input;
    // GitHub MCP 는 도구마다 번호 키가 다르다 — add_issue_comment `issue_number` · update_pull_request `pullNumber`(10-02 실측).
    const num = input.issue_number ?? input.issueNumber ?? input.pull_number ?? input.pullNumber ?? input.number ?? '?';
    const pr = input.owner && input.repo ? `${input.owner}/${input.repo}#${num}` : num;
    if (/add_issue_comment$/.test(b.name ?? '')) {
      const who = roomSpeaker(input.body) ?? (roomShaped(input.body) ? '서명 없음' : null);
      if (who) entries.push({ who, body: input.body, pr, at: o.timestamp, toolId: b.id, posted: true });
    } else if (/(?:update_pull_request|update_issue)$/.test(b.name ?? '') && input.body.includes('<!-- d1-room-board -->')) {
      entries.push({ who: 'C1', body: input.body, pr, at: o.timestamp, board: true });
    }
  }
  return entries;
}

/* 게시 결과(tool_result)는 바로 다음 기록이 아닐 수 있다 — 같은 턴의 다른 도구 호출·알림이 끼어든다(10-02 실측:
 * 속도 시험 요청 c1-20261002-05 가 ID 대신 해시로 남았다). 뒤로 최대 200 기록까지 같은 tool_use_id 를 찾는다. */
const POSTED_RESULT_LOOKAHEAD = 200;
function postedId(records, index, toolId) {
  if (!toolId) return null;
  for (let j = index + 1; j < Math.min(records.length, index + 1 + POSTED_RESULT_LOOKAHEAD); j++) {
    const id = postedIdIn(records[j], toolId);
    if (id !== undefined) return id;
  }
  return null;
}
/** 그 기록에 해당 tool_result 가 있으면 ID(없으면 null), 해당 결과 자체가 없으면 undefined. */
function postedIdIn(next, toolId) {
  if (next?.type !== 'user' || !Array.isArray(next.message?.content)) return undefined;
  let found;
  for (const b of next.message.content) {
    if (b?.type === 'tool_result' && b.tool_use_id === toolId) found = null;
    if (b?.type !== 'tool_result' || b.tool_use_id !== toolId || b.is_error) continue;
    try {
      const c = jsonObjectAt(blockText(b.content), 0);
      if (!object(c)) continue;
      if (/^\d+$/.test(String(c.id ?? ''))) return String(c.id);
      const id = typeof c.url === 'string' && c.url.match(/#issuecomment-(\d+)/)?.[1];
      if (id) return id;
    } catch { /* ID 없는 게시 턴은 소비형 본문 대응으로 처리한다. */ }
  }
  return found;
}

// 세션 전송 래퍼는 user text의 시작 또는 tool_result 안에서만 해석한다.
const CROSS_RE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/g;
// legacy(Remote MCP) = from-session="session_…" · native(내장 SendMessage, 10-08 실측) = from="bridge:session_…" — 둘 다 있으면(섞인 래퍼) 읽지 않는다.
// 송신자는 전체 ID 로만 남긴다(from-name 은 개명 전 옛 제목일 수 있어 쓰지 않는다 — d1-20261008-13 ①).
// legacy 는 종전처럼 from-session 하나(다른 속성 순서 허용 — 10-03 Astra 재현) · native 는 실측 꼴 그대로만(속성 순서·공백까지).
// 둘이 섞였거나(from-session + from) native 꼴이 변형이면 송신자를 읽지 않는다 → 미검증 기록(D1 d1-20261008-17 ④).
const crossFrom = (attrs) => {
  if (/(?:^|\s)from="/.test(attrs)) return /^ from="bridge:(session_[A-Za-z0-9]{20,})"(?: hop-chain="[0-9a-f]{8,64}")? from-name="[^"\r\n]*" from-mode="[a-z-]+"$/.exec(attrs)?.[1];
  const m = [...attrs.matchAll(/(?:^|\s)from-session="([^"\r\n]+)"/g)];
  return m.length === 1 ? m[0][1] : undefined;
};
const looksCross = (text) => typeof text === 'string' && text.trimStart().startsWith('<cross-session-message');
const crossStart = (text) => { const m = /^<cross-session-message\b([^>]*)>/.exec(text.trim()); return !!(m && crossFrom(m[1])); };
const shortSession = (id) => String(id).replace(/^session_/, '').slice(0, 8);
function sessionBody(text, harness = true) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) =>
    !harness || (!line.trimStart().startsWith('The following was sent by another Claude Code session') &&
    !line.trimStart().startsWith('To reply, call the send_message tool')));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)[0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent)).join('\n');
}
/** 래퍼마다 { id: 보낸 세션, body, note: 알림 id(있으면) }. 알림 머리 "--- Notification … · id: <uuid>" 를 그 래퍼의 식별자로 쓴다. */
function crossEntries(text) {
  return [...text.matchAll(CROSS_RE)].flatMap((m) => {
    const id = crossFrom(m[1]);
    if (!id) return [];
    const note = [...text.slice(0, m.index).matchAll(/--- Notification [^\n]*?· id: ([0-9a-f-]{8,})/g)].at(-1)?.[1];
    // native 본문은 들여쓰기·안내문이 없다(실측) — 공통 들여쓰기를 떼면 원문이 바뀐다(독립 검토 B9). 앞뒤 경계 LF 만 뗀다.
    const native = !/(?:^|\s)from-session="/.test(m[1]);
    return [{ id, body: native ? m[2].replace(/^\n/, '').replace(/\n$/, '') : sessionBody(m[2]), note }];
  });
}
/* uds 세션 간 메시지(같은 PC · 2026-10 하네스 · 6a 실물) — `<cross-session-message from="uds:\\.\pipe\…" hop-chain=… from-name=… from-mode=…>`.
 * 보낸 세션 ID 가 없어 세션으로 출처를 확인할 수 없다 → 화자는 미검증(from-name 은 쓰지 않는다 — 개명 전 이름이 온다 · inbound.mjs 와 같은 규칙).
 * 예외는 맨 앞 중계 기원 줄(확정 주소)뿐. 래퍼·하네스 안내문은 버리고 본문만 남긴다. 래퍼가 정확히 하나일 때만. */
const UDS_RE = /<cross-session-message from="uds:[^"\r\n]+"(?: [a-z-]+="[^"\r\n]*")*>\n([\s\S]*?)\n?<\/cross-session-message>/;
export function udsBody(text) {
  const t = String(text ?? '').replace(/\r\n/g, '\n');
  if ((t.match(/<cross-session-message\b/g) ?? []).length !== 1) return null;
  const m = UDS_RE.exec(t);
  if (!m) return null;
  // 래퍼 밖은 하네스 안내 줄·빈 줄만 허용 — 잡음 줄 필터는 래퍼 **밖**에만 건다(안쪽 원문 줄을 지우지 않게 · Fable 검토 B5).
  const outside = `${t.slice(0, m.index)}\n${t.slice(m.index + m[0].length)}`.split('\n');
  return outside.some((line) => line.trim() && !NOISE_LINES.some((re) => re.test(line))) ? null : m[1];
}
/** 래퍼를 뺀 나머지(사람이 래퍼 뒤에 이어 쓴 말) — 비면 ''. */
const crossRemainder = (text) => text.replace(CROSS_RE, '').trim();
/* Reason Network(reason-network MCP) 봉투 — 받은 메시지는 하네스가 peer user 턴(또는 바쁠 때 attachment queued_command)에
 * "Another Claude session sent a message:\n<reason-message from="<주소>" agent="<종류>" id="<ULID>">본문</reason-message>\nFrom … Reply … to "<주소>"." 로 넣는다
 * (10-18 C2 e1df4de1 실물 35+15건). 종전엔 origin.name·from 이 없어 '하청 이름없음'·'보낸 세션 unknown' 으로 적혀 G1(Grok Bot)·D1 이 보낸 말을
 * 캐치업이 주소로 찾지 못했다(2026-10-20 검토). 보낸 주소·메시지 id 를 그대로 남기고 본문은 태그 안만 — 안내문은 버린다. 시각을 지어내지 않는다. */
const REASON_RE = /<reason-message\b([^>]*)>([\s\S]*?)<\/reason-message>/;
function reasonEntry(text) {
  const m = REASON_RE.exec(String(text ?? ''));
  if (!m) return null;
  const attr = (k) => new RegExp('(?:^|\\s)' + k + '="([^"\\r\\n]*)"').exec(m[1])?.[1];
  const from = attr('from'), id = attr('id');
  if (!from || !id) return null;
  return { from, agent: attr('agent') ?? '', id, body: m[2].replace(/^\n/, '').replace(/\n$/, '') };
}
/* 하네스 Reason 배달 꼴 — 글 **맨 앞**의 봉투 하나(하네스 안내 머리 "Another Claude session sent a message:\n" 바로 뒤도 맨 앞으로 본다).
 * 하청 보고·uds 세션 메시지·사람 입력 등 다른 글 **속**에 붙여 넣은 봉투는 출처가 아니다(리뷰 B1·B2). 맨 앞 봉투 하나만 출처이고 그 뒤 글(두 번째 봉투 포함)은
 * 본문이다 — 보낸 쪽이 본문에 `</reason-message><reason-message from=<G1 주소> …>` 를 써 넣어 G1 이 되는 길을 막는다. → { envelope, rest } | null.
 * Python speakers.reason_delivery 와 같다. */
export const REASON_PREAMBLE = 'Another Claude session sent a message:\n';
export function reasonDelivery(text) {
  const t = String(text ?? '');
  const start = t.startsWith(REASON_PREAMBLE) ? REASON_PREAMBLE.length : 0;
  const m = /^<reason-message\b[^>]*>[\s\S]*?<\/reason-message>/.exec(t.slice(start));
  return m ? { envelope: m[0], rest: t.slice(start + m[0].length) } : null;
}
const reasonWho = (r) => `${r.from} (Reason${r.agent ? ` · ${r.agent}` : ''})`;
function sessionName(body, id) {
  const inner = /^\[([^\]\r\n]{1,120})\]/.exec(body.split('\n')[0])?.[1];
  // d1-20261007-17 ②: 새 메타 분리(⇢ · ' · ' 꼬리)는 확인된 프로토콜 봉투(roomSpeaker 가 읽는 서명)에만 — 일반 세션 제목은
  // 종전대로 보존해 옛 렌더와 화자가 달라지지 않게(mergeArchive 가 블록 전체 비교라 화자가 바뀌면 두 턴이 된다).
  const proto = roomSpeaker(body.split('\n')[0]) != null;
  const name = proto ? inner?.split(/→|->|⇒|=>|⇢/)[0].split(' · ')[0].trim() : inner?.split(/→|->|⇒|=>/)[0].trim();
  return name && name.length <= 40 ? name : shortSession(id);
}

// Keep the transport parser available for historical merge/diagnostic consumers.
// All archive entry points use extractDialogueTurns below.
export function extractTurns(raw, { dialogueOnly = false, repo = '', labels = {}, sessionId = '' } = {}) {
  const turns = [];
  const seenIds = new Set(), unmatchedPosts = new Map(), unmatchedNotifications = new Map();
  const records = raw.split('\n').flatMap((line) => { try { const o = JSON.parse(line); return object(o) ? [o] : []; } catch { return []; } });
  // 자기 답의 화자 = 이름표의 실제 세션 이름, 없으면 저장소-ID 8자(2026-10-22 — cwd 로 'C2' 를 지어내던 것을 걷었다).
  const sid = sessionId || records.find((o) => typeof o.sessionId === 'string' && o.sessionId)?.sessionId || '';
  const cwd = records.find((o) => o.cwd)?.cwd;
  const self = selfSpeaker(sid, repo || (cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() : ''), labels);
  const selfLabeled = !!sid && !!labels && Object.hasOwn(labels, sid);
  const botOf = promptOrigins(records);
  const sentIds = new Set(records.filter((o) => !o.isSidechain && o.type === 'assistant')
    .flatMap((o) => Array.isArray(o.message?.content) ? o.message.content : [])
    .filter((b) => b?.type === 'tool_use' && /send_message$/.test(b.name ?? ''))
    .map((b) => b.id).filter(Boolean));
  // tool_use id → 도구 이름. 알림 도구 결과만 알림으로 읽는다(모르는 id 는 허용 — 도구 호출이 잘린 사본·시험 기록).
  const toolNames = new Map(records.filter((o) => !o.isSidechain && o.type === 'assistant')
    .flatMap((o) => Array.isArray(o.message?.content) ? o.message.content : [])
    .filter((b) => b?.type === 'tool_use' && b.id).map((b) => [b.id, String(b.name ?? '')]));
  const isNotif = (id) => !toolNames.has(id) || /ReadNotifications$/.test(toolNames.get(id));
  const seenSessions = new Set();
  const reviews = automationReviewRecords(records);   // 같은 파일에 섞인 자동 보안 리뷰 턴 — 지우지 않고 화자만 가른다
  let lastAt;                                   // 시각 없는 기록은 앞 기록의 시각을 이어받는다(턴 머리가 시각 없이 렌더되면 경계를 잃는다)
  /* 중복 판정은 **이벤트 식별자**로만 — 알림 id(알림 도구로 온 것) · 도구 호출 id(보낸 것) · 기록 uuid+순번(사용자 턴으로 온 것).
   * 본문이 같다고 지우지 않는다("완료"를 두 번 받는 일은 정상이다 — Astra 재현). 식별자는 메타 줄에 실어 병합에서도 갈린다. */
  // src = 화자 출처(inputSpeaker 의 origin) — 본문이 아니라 봉투·전체 세션 ID·peer 주소. 없으면 미검증.
  const addSession = (o, who, id, body, sent = false, evt = '', src = null) => {
    // 받은 세션 메시지 맨 앞의 중계 기원 줄(6b) — 화자는 그 줄의 확정 주소, 본문에서는 줄을 뺀다(원문만 남김).
    const relay = dialogueOnly && !sent && RELAY_CARRIERS.has(src?.kind) ? relayOrigin(body) : null;
    if (dialogueOnly) {
      if (relay) body = relay.body.replace(/^\r?\n/, '');
      if (internalPrompt(body)) return;
      body = stripInline(body);
      if (!body) return;
    }
    if (evt && seenSessions.has(evt)) return;
    if (evt) seenSessions.add(evt);
    const escaped = body.split('\n').map((line) => isTurnHead(line) ? `\\${line}` : line).join('\n');
    const tag = evt ? ` · ${evt}` : '';
    turns.push({ who: dialogueOnly ? (sent ? self : inputSpeaker(relay ? relayOriginLine(relay.from, relay.id) : '', src ?? {}, labels)) :`세션 메시지(${who})`, text: dialogueOnly ? escaped : `> 세션 메시지 · ${sent ? '받는' : '보낸'} 세션 ${id}${tag}\n\n${escaped}`, at: o.timestamp ?? lastAt, branch: o.gitBranch, room: true });
  };
  let lastBoard;
  /* 턴 경계 = 하네스가 user 기록에 붙이는 promptId (d1-20261008-13 ③). 같은 화자라도 promptId 가 다르면 합치지 않는다 —
   * 10-08 MPR 실물: 받은 세션 메시지가 렌더되지 않는 꼴로 들어와 10-08 답이 10-06 Claude 턴 꼬리에 붙었다(머리 시각 10-06).
   * 훅 재진입(Stop hook feedback)이 연 promptId 만 직전 턴의 별칭으로 본다(종전처럼 한 턴 — 재진입 답은 상태 한 줄).
   * isMeta 는 별칭으로 보지 않는다 — 새 프롬프트 앞에 오는 isMeta 가 그 promptId 를 옛 턴에 묶으면 같은 버그가 되살아난다(독립 검토 B7).
   * promptId 가 없는 옛 기록은 종전 규칙(같은 화자면 합침) 그대로. */
  const promptAlias = new Map();
  let curPrompt = null;
  /* promptId 가 없는 기록(옛 CLI 등)의 턴 경계 — 사람 몫 user 입력(도구 결과 아님 · Stop 훅·isMeta 아님)이
   * 지나가면 그 뒤 Claude 글은 앞 Claude 블록에 합치지 않는다. 그 입력이 렌더되지 않는 꼴(주입·알림)이어도 마찬가지 —
   * MPR 10-06→10-08 실물 증상의 promptId 없는 판(D1 d1-20261008-17). promptId 가 있으면 promptId 규칙이 우선한다. */
  let turnBreak = false;
  const noteBreak = (o) => {
    if (o.type !== 'user' || o.isMeta || (o.userType && o.userType !== 'external')) return;
    const c = o.message?.content;
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    if (!blocks.length || blocks.every((b) => b?.type === 'tool_result')) return;
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
    // 글이 있는 입력만 경계로 본다(빈 입력·첨부만·하청 peer 는 종전대로) · Stop 훅 재진입은 같은 턴
    if (!text.trim() || (o.origin ?? o.message?.origin)?.kind === 'peer' || /^Stop hook feedback:/.test(text.trimStart())) return;
    turnBreak = true;
  };
  const notePrompt = (o) => {
    if (o.type !== 'user' || typeof o.promptId !== 'string' || !o.promptId) return;
    if (o.userType && o.userType !== 'external') return;                 // 렌더 대상이 아닌 기록은 경계를 옮기지 않는다(독립 검토 B7)
    if (promptAlias.has(o.promptId)) { curPrompt = promptAlias.get(o.promptId); return; }
    const c = o.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('') : '';
    if (curPrompt && o.promptId !== curPrompt && /^Stop hook feedback:/.test(text.trimStart())) {
      promptAlias.set(o.promptId, curPrompt); return;
    }
    curPrompt = o.promptId;
  };
  for (const [index, o] of records.entries()) {
    if (o.isSidechain || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue;                 // 서브에이전트 — 본 대화가 아니다
    if (dialogueOnly && (o.isHidden || o.hidden || reviews.has(o) || (o.isMeta && (o.origin ?? o.message?.origin)?.kind !== 'peer'))) continue;
    if (o.timestamp) lastAt = o.timestamp;
    notePrompt(o);
    noteBreak(o);
    // 다른 세션이 내장 SendMessage 로 보낸 것(10-08 C1 실측: attachment queued_command · origin.kind 'peer' · prompt = native 래퍼).
    // 사람 입력이 아니다 — PeterJ 턴으로 적지 않고 세션 메시지 턴으로. 한 전달은 delivery_id(없으면 source_uuid·기록 uuid) 하나로만 센다.
    // 송신자 = 래퍼 from 의 bridge: 뒤 전체 ID, origin.from 과 다르면 '출처 불일치'로 적는다(이름 origin.name·from-name 은 쓰지 않음).
    // Reason 수신이 바쁠 때 온 것(attachment) — 같은 메시지 id 가 idle user 턴으로도 오면 한 번만 남는다(evt = Reason <id>).
    // 봉투는 하네스 Reason 배달 꼴(맨 앞 — 안내 머리 뒤 허용)일 때만 — 같은 PC(uds) 세션 메시지 본문에 붙여 넣은 봉투로
    // G1 이 되지 않게 uds·래퍼 갈래보다 먼저 보되 맨 앞만 본다(리뷰 B1 · Python speakers.parts 와 같다).
    const busyReason = o.type === 'attachment' && o.attachment?.type === 'queued_command' && o.attachment.origin?.kind === 'peer'
        && typeof o.attachment.prompt === 'string' ? reasonDelivery(o.attachment.prompt) : null;
    if (busyReason && reasonEntry(busyReason.envelope)) {
      const r = reasonEntry(busyReason.envelope);
      addSession(o, `Reason ${r.from}`, reasonWho(r), r.body, false, `Reason ${r.id}`, { kind: 'reason', from: r.from });
      continue;
    }
    if (o.type === 'attachment' && o.attachment?.type === 'queued_command' && o.attachment.origin?.kind === 'peer'
        && typeof o.attachment.prompt === 'string' && o.attachment.prompt.startsWith('<cross-session-message')) { // 하청 보고(<agent-message>)도 peer 다 — 래퍼만
      const a = o.attachment;
      const evt = `전달 ${a.delivery_id ?? a.source_uuid ?? o.uuid ?? index}${a.source_uuid ? ` · 원본 ${a.source_uuid}` : ''}`;
      const entries = crossStart(a.prompt) ? crossEntries(a.prompt) : [];
      const uds = dialogueOnly && !entries.length ? udsBody(a.prompt) : null;
      if (entries.length === 1 && a.origin.from === `bridge:${entries[0].id}`) addSession(o, sessionName(entries[0].body, entries[0].id), entries[0].id, entries[0].body, false, evt, { kind: 'session', id: entries[0].id });
      else if (uds !== null) addSession(o, 'uds', String(a.origin.from ?? '없음'), uds, false, evt, { kind: 'uds', from: a.origin.from });
      else addSession(o, '출처 불일치', String(a.origin.from ?? '없음'), a.prompt, false, evt);
      continue;
    }
    // native 4번째 꼴 — 받는 세션이 쉬는 중이면 새 user 턴(isMeta · origin peer · "Another Claude session sent a message:\n" + 래퍼 + 안내문 · 10-08 C1 실측).
    // 사람 입력 아님 — 세션 메시지 턴으로. 래퍼 송신자·본문이 origin 과 다르면 '출처 불일치'.
    if (o.type === 'user' && o.isMeta === true && o.origin?.kind === 'peer' && typeof o.message?.content === 'string'
        && o.message.content.startsWith('Another Claude session sent a message:\n<cross-session-message')) {
      const w = o.message.content.slice('Another Claude session sent a message:\n'.length);
      const entries = crossEntries(w);
      const e0 = entries.length === 1 ? entries[0] : null;
      const evt = `기록 ${o.uuid ?? index}${o.promptId ? ` · 프롬프트 ${o.promptId}` : ''}`;
      const uds = dialogueOnly && !entries.length ? udsBody(w) : null;
      if (e0 && o.origin.from === `bridge:${e0.id}` && o.origin.body === e0.body) addSession(o, sessionName(e0.body, e0.id), e0.id, e0.body, false, evt, { kind: 'session', id: e0.id });
      else if (uds !== null) addSession(o, 'uds', String(o.origin.from ?? '없음'), uds, false, evt, { kind: 'uds', from: o.origin.from });
      else addSession(o, '출처 불일치', String(o.origin.from ?? '없음'), w, false, evt);
      continue;
    }
    let queued = queuedHumanPrompt(o);
    if (queued && looksCross(queued.content)) {
      // 사람 입력 자리로 들어온 래퍼 — 발신을 확인할 수 없으므로 PeterJ 턴이 아니라 미검증 기록(원문 보존)
      addSession(o, '미검증 래퍼', '확인 불가', String(queued.content), false, `기록 ${o.uuid ?? index}`);
      turnBreak = true;
      continue;
    }
    if (!queued && o.type !== 'user' && o.type !== 'assistant') continue;
    if (!queued && o.message?.role === 'user' && o.userType && o.userType !== 'external') continue;

    const content = (queued || o.message)?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const origin = o.origin ?? o.message?.origin;
    // isInjected/stripInline의 기존 꼴 중 기록 자체를 나타내는 표지만 첨부를 막는다.
    // system-reminder, 방 알림, Image, Request interrupted 및 나머지 Caveat는
    // 동반 주입이다. 사람 글과 함께 와도 글 필터만 적용하고 첨부는 보존한다.
    // skillBodyMarker/generatedPromptMarker는 생성된 기록 전체를 나타낸다.
    const filteredText = blocks.some((b) => {
      if (b?.type !== 'text' || typeof b.text !== 'string') return false;
      const t = b.text.trimStart();
      return /Stop hook feedback:/.test(t)
        || t.startsWith('<local-command') || t.startsWith('<command-name>')
        || t.startsWith('<task-notification>')
        || t.startsWith('Caveat: The messages below were generated by the user while running local commands')
        || t.startsWith('Another Claude session sent a message:')
        || !!skillBodyMarker(t) || !!generatedPromptMarker(t);
    });
    const humanAttachments = !filteredText && !o.isMeta && (queued || (o.type === 'user'
      && (!o.userType || o.userType === 'external')
      && origin?.kind !== 'peer' && origin?.kind !== 'task-notification'));
    // 최상위 블록만 센다. tool_result 속 첨부는 사람 입력이 아니다.
    const images = humanAttachments ? blocks.filter((b) => b?.type === 'image').length : 0;
    const documents = humanAttachments ? blocks.filter((b) => b?.type === 'document').length : 0;
    const attachmentMarkers = [
      images ? `_(이미지 ${images}장 첨부 — 본문 생략)_` : '',
      documents ? `_(첨부 문서 ${documents}개 — 본문 생략)_` : '',
    ].filter(Boolean);
    let ordinary = [];
    // whoOverride — 하네스 Reason 배달의 맨 앞 봉투 밖 글(안내문 뒤에 남은 것)은 출처가 아니다: 본문 속 봉투로 이름을 얻지 않게 미검증으로 고정(리뷰 B2).
    const flush = (markers = [], whoOverride = null) => {
      // 본문 필터 뒤에 붙여 isInjected 등의 접두 규칙으로 첨부 경계가 사라지지 않게 한다.
      const kept = dialogueOnly ? ordinary.filter((b) => !internalPrompt(b.text)) : ordinary;
      const text = [textOf({ content: kept }, !!queued || o.type === 'user'), ...markers].filter(Boolean).join('\n\n');
      ordinary = [];
      if (!text) return;
      const review = !queued && reviews.has(o);
      const who = dialogueOnly ? whoOverride ?? (queued || o.type === 'user' ? inputSpeaker(text, promptSource(o, queued ? { kind: 'human' } : origin, botOf), labels) : self) : review ? (o.type === 'user' ? REVIEW_ASK : REVIEW_ANSWER) : !queued && isRefusalNote(o) ? REFUSAL_NOTE : queued || o.type === 'user' ? 'PeterJ' : 'Claude';
      const last = turns.at(-1);
      const samePrompt = last?.prompt != null && curPrompt != null ? last.prompt === curPrompt : !turnBreak;
      turnBreak = false;
      if (last && !last.room && last.who === who && samePrompt) last.text += `\n\n${text}`;
      // 리뷰 턴의 첫 줄은 출처 표지 — 원본 기록으로 되짚을 수 있게 entrypoint·기록 uuid 를 남긴다.
      else turns.push({ who, text: review ? `> 자동 보안 리뷰 · 출처 ${o.entrypoint}${o.uuid ? ` · 기록 ${o.uuid}` : ''}\n\n${text}` : text, branch: o.gitBranch, at: o.timestamp ?? lastAt, review, prompt: curPrompt });
    };
    for (const block of blocks) {
      if (!block) continue;
      if (o.type === 'assistant' && block.type === 'tool_use' && /reason-network__send_message$/.test(block.name ?? '') && typeof block.input?.to === 'string' && typeof block.input?.message === 'string') {
        // Reason Network 발신 — 받는 쪽은 Reason 주소(세션 ID 아님). 종전엔 session_id 가 없어 통째로 빠졌다(C2 → G1·D1 로 보낸 말 전부 · 10-18 실물 73건).
        flush();
        const to = block.input.to.slice(0, 80);
        const re = typeof block.input.reply_to === 'string' && block.input.reply_to ? ` · re ${block.input.reply_to.slice(0, 40)}` : '';
        addSession(o, `→Reason ${to}`, `${to} (Reason)${re}`, block.input.message, true, block.id ? `호출 ${block.id}` : '');
      } else if (o.type === 'assistant' && block.type === 'tool_use' && /send_message$/.test(block.name ?? '') && typeof block.input?.message === 'string' && typeof block.input?.session_id === 'string') {
        flush();
        addSession(o, `→${shortSession(block.input.session_id)}`, block.input.session_id, block.input.message, true, block.id ? `호출 ${block.id}` : '');
      } else if (o.type === 'assistant' && block.type === 'tool_use' && block.name === 'SendMessage' && typeof block.input?.message === 'string' && typeof block.input?.to === 'string') {
        // 내장 SendMessage — 받는 쪽은 ListAgents 이름이다(session ID 아님). 이름임을 메타 줄에 밝힌다.
        flush();
        const to = block.input.to.slice(0, 40);
        addSession(o, `→${to}`, `${block.input.to} (이름 · 내장 SendMessage)`, block.input.message, true, block.id ? `호출 ${block.id}` : '');
      } else if (o.type === 'user' && block.type === 'tool_result' && !sentIds.has(block.tool_use_id) && isNotif(block.tool_use_id)) {
        const entries = crossEntries(blockText(block.content));
        if (entries.length) flush();
        entries.forEach((e, k) => addSession(o, sessionName(e.body, e.id), e.id, e.body, false, e.note ? `알림 ${e.note}` : `기록 ${o.uuid ?? index}-${k}`, { kind: 'session', id: e.id }));
      } else if (o.type === 'user' && block.type === 'text' && typeof block.text === 'string') {
        const origin = o.origin ?? o.message?.origin;
        // 옛 from-session 래퍼(user 글 맨 앞) — 대화 아카이브는 하네스 peer 배달일 때만 보낸 세션으로 믿는다(origin.from 이 있으면 래퍼 송신자와 같아야).
        // 사람이 친(붙여 넣은) 같은 래퍼는 아래 미검증 래퍼 갈래로 — 이름표로 C1 이 되거나 기원 줄로 G1 이 되지 않는다(리뷰 B3 · Python 은 옛 래퍼를 늘 미검증).
        // 옛 전송 파서(dialogueOnly 아님 · 병합·진단용)는 종전 그대로 받는다.
        const legacyOk = (e) => !dialogueOnly || (origin?.kind === 'peer' && (origin.from == null || origin.from === `bridge:${e.id}` || origin.from === e.id));
        if (crossStart(block.text) && crossEntries(block.text).length && crossEntries(block.text).every(legacyOk)) {
          flush();
          crossEntries(block.text).forEach((e, k) => addSession(o, sessionName(e.body, e.id), e.id, e.body, false, `기록 ${o.uuid ?? index}-${k}`, { kind: 'session', id: e.id }));
          // 래퍼 바깥에 이어 쓴 말은 원래 화자(사람) 턴으로 남긴다 — 버리지 않는다(Astra 재현: 뒤의 실제 지시가 사라졌다).
          const rest = crossRemainder(block.text);
          if (rest) { ordinary.push({ type: 'text', text: rest }); flush(); }
        } else if (looksCross(block.text)) {
          // 세션 메시지 래퍼처럼 보이지만 검증된 꼴이 아니다 — 사람 발언(PeterJ)으로 적지 않고 미검증 기록으로 원문 보존(D1 d1-20261008-17 ④)
          flush();
          addSession(o, '미검증 래퍼', '확인 불가', block.text, false, `기록 ${o.uuid ?? index}`);
        } else if (origin?.kind === 'peer' && reasonDelivery(block.text) && reasonEntry(reasonDelivery(block.text).envelope)) {
          // 봉투는 하네스가 peer 배달에 붙일 때만 출처다 — 사람 입력 속에 붙여 넣은 봉투는 본문일 뿐(이름도 id 중복 판정도 주지 않는다 · Fable 검토 10-22).
          // 그리고 하네스 Reason 배달 꼴(글 맨 앞 봉투 — 안내 머리 뒤 허용)일 때만이다: 하청 보고(<agent-message>) 등 일반 peer 글 속 봉투는 본문(리뷰 B2).
          // Reason 수신(idle 턴 꼴) — 보낸 주소·메시지 id 로 적는다('하청 이름없음'·'unknown' 이 아니라).
          flush();
          if (dialogueOnly) {
            for (const part of dialogueInputParts(block.text, origin)) {
              if (part.reason) {
                const r = part.reason;
                addSession(o, `Reason ${r.from}`, reasonWho(r), part.text, false, `Reason ${r.id}`, { kind: 'reason', from: r.from });
              } else { ordinary.push({ type: 'text', text: part.text }); flush([], part.who); }
            }
          } else {
            const r = reasonEntry(reasonDelivery(block.text).envelope);
            addSession(o, `Reason ${r.from}`, reasonWho(r), r.body, false, `Reason ${r.id}`, { kind: 'reason', from: r.from });
          }
        } else if (origin?.kind === 'peer') {
          flush();
          const body = /<agent-message\b[^>]*>([\s\S]*?)<\/agent-message>/.exec(block.text)?.[1];
          addSession(o, `하청 ${origin.name || '이름없음'}`, origin.from || '이름없음', body === undefined ? block.text : sessionBody(body, false), false, `기록 ${o.uuid ?? index}`, { kind: 'peer', from: origin.from });
        } else if (origin?.kind === 'task-notification' && !block.text.trimStart().startsWith('<task-notification>')) {
          flush();
          addSession(o, '띄운 세션', origin.from || '띄운 세션', block.text, false, `기록 ${o.uuid ?? index}`, { kind: 'peer', from: origin.from });
        } else ordinary.push(block);
      } else if (block.type === 'text') ordinary.push(block);
    }
    flush(attachmentMarkers);
    for (const entry of roomEntries(o, isNotif)) {
      const body = roomBody(entry.body);
      if (entry.board) {
        if (dialogueOnly) continue;
        if (lastBoard === body) continue;
        lastBoard = body;
      } else {
        if (entry.posted) entry.id = postedId(records, index, entry.toolId);
        const id = entry.id == null ? null : String(entry.id);
        const key = JSON.stringify([String(entry.pr ?? '?'), id]);
        if (id !== null && seenIds.has(key)) continue;
        if (id !== null) seenIds.add(key);
        // 대화 아카이브는 메시지 ID 로만 중복을 가른다(화자 계약 요구 7) — 본문 대응은 옛 전송 파서에만 남긴다.
        if (!dialogueOnly) {
          // ID 없는 게시 사본만 같은 PR/본문 알림 하나와 대응시킨다.
          const bodyKey = JSON.stringify([String(entry.pr ?? '?'), body]);
          const own = entry.posted ? unmatchedPosts : unmatchedNotifications;
          const other = entry.posted ? unmatchedNotifications : unmatchedPosts;
          if ((!entry.posted || id === null) && (other.get(bodyKey) ?? 0) > 0) {
            other.set(bodyKey, other.get(bodyKey) - 1);
            continue;
          }
          if (!entry.posted || id === null) own.set(bodyKey, (own.get(bodyKey) ?? 0) + 1);
        }
      }
      const escaped = entry.body.replace(/\r\n/g, '\n').split('\n').map((line) => isTurnHead(line) ? `\\${line}` : line).join('\n');
      // 이 세션이 올린 댓글 = 자기 자신(출처 = 이 세션의 도구 호출) · 받은 댓글 = 작성자 신원으로만(G1 App 이면 G1 · 그 밖은 미검증).
      // 대화 아카이브는 첫 줄에 출처 줄 `## **[화자]** · 방 댓글 #ID · …` 을 단다(6final — roomCommentSource · Python room_comment_source 와 같은 표).
      const src = dialogueOnly && !entry.board ? roomCommentSource({ posted: !!entry.posted, author: entry.author, authorType: entry.authorType, id: entry.id == null ? null : String(entry.id), self, selfLabeled, body: entry.body, pasted: !!entry.pasted }) : null;
      turns.push({ who: src ? src.who : entry.who, text: src ? `${src.line}\n\n${escaped}` : dialogueOnly ? escaped : `${entry.board ? `> 현황판 갱신 · ${entry.pr ?? '?'} · #${bodyHash(body)}` : `> 대화방 댓글 ${entry.id ?? `#${bodyHash(body)}`} · ${entry.pr ?? '?'}`}\n\n${escaped}`, at: entry.at, branch: o.gitBranch, room: true });
    }
  }
  return turns;
}

/** 사람 몫 프롬프트 기록인가 — 봇 표식(UserPromptSubmit 훅 기록)이 가리킬 수 있는 자리. */
function isPromptRecord(o) {
  if (queuedHumanPrompt(o)) return true;
  if (o.type !== 'user' || o.isMeta || o.isSidechain || (o.userType && o.userType !== 'external')) return false;
  const kind = (o.origin ?? o.message?.origin)?.kind;
  if (kind === 'peer' || kind === 'task-notification') return false;
  const c = o.message?.content;
  const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
  return !!text.trim() && !/^Stop hook feedback:/.test(text.trimStart());
}
/** 기록 uuid → 봇 이름. 표식 기록은 그 프롬프트 **뒤에** 온다 — parentUuid 사슬을 거슬러 첫 프롬프트 기록에 붙이고,
 * 사슬이 끊겼으면 바로 앞 프롬프트에 붙인다. 표식은 그 프롬프트 하나에만 걸린다(다음 프롬프트는 다시 판정). */
export function promptOrigins(records) {
  const byUuid = new Map(records.filter((o) => o.uuid).map((o) => [o.uuid, o]));
  const out = new Map();
  let last = null;
  for (const o of records) {
    if (o.isSidechain) continue;
    if (isPromptRecord(o)) { last = o; continue; }
    const name = originMarker(o);
    if (!name) continue;
    let p = byUuid.get(o.parentUuid), hops = 0;
    while (p && !isPromptRecord(p) && hops++ < 200) p = byUuid.get(p.parentUuid);
    const target = p && isPromptRecord(p) ? p : last;
    if (target?.uuid) out.set(target.uuid, name);
  }
  return out;
}
/** 프롬프트 기록의 출처 — 봇 표식 > 하네스의 사람 표지(origin human · turnOrigin human) > 표지 없는 대화형 기록.
 * `-p`(turnOrigin sdk · entrypoint sdk*)로 들어온 표식 없는 입력은 사람으로 보지 않는다 — 출처를 모르는 것이다. */
function promptSource(o, origin, botOf) {
  const bot = o.uuid ? botOf.get(o.uuid) : null;
  if (bot) return { kind: 'bot', name: bot };
  if (origin?.kind === 'human' || o.turnOrigin === 'human') return { kind: 'direct' };
  if (!origin?.kind && !o.turnOrigin && !o.promptSource && !isSdk(o)) return { kind: 'direct' };
  return origin?.kind ? origin : {};
}

/** 사람 몫 프롬프트 기록의 화자 — 화면(dialogue.mjs)이 수집기와 같은 판정을 쓰게(6b: G1 이 띄운 프롬프트가 화면에서 PeterJ 로 보였다).
 * 봇 표식 기록 → 그 이름 · 하네스 사람 표지/표지 없는 대화형 → DIRECT · 표식 없는 `-p`(sdk) → 미검증.
 * text 를 주면 수집기 flush 와 똑같이 inputSpeaker 로 — 사람 입력에 붙은 중계 기원 줄·봇 서명은 PeterJ 를 거둔다(리뷰 B6).
 * origin = 그 기록의 출처(대기열 사람 입력은 { kind: 'human' } — 수집기 queued 와 같다). */
export function promptSpeaker(o, botOf = new Map(), text = undefined, origin = o?.origin ?? o?.message?.origin) {
  if (text !== undefined) return inputSpeaker(text, promptSource(o, origin, botOf));
  const src = promptSource(o, origin, botOf);
  if (src.kind === 'bot') return ORIGIN_NAME.test(String(src.name ?? '')) ? String(src.name) : UNVERIFIED;
  return src.kind === 'direct' ? DIRECT : UNVERIFIED;
}

/** Identity comes from a known repository or a sender marker, never the role. */
export function sessionSpeaker(value, fallback = 'Claude') {
  const parts = String(value ?? '').toLowerCase().replace(/\\/g, '/').split('/');
  const names = { 'global-config': 'C2', mpr: 'MPR', 'trend-review': 'TR', pnews_finance: 'PNF', emr_assist_v1: 'EMR', emr_v1_codex: 'EMR', pma: 'PMA', hospital: 'HOSPITAL' };
  for (const part of parts.reverse()) if (names[part]) return names[part];
  return fallback;
}

/* ★ 화자 계약 (2026-10-22 · G1 회의 구조 요구 2·6·7) — 화자는 메시지의 **출처**로만 정한다.
 *   · Reason 봉투 `<reason-message from=…>`(본문 맨 앞) = 하네스가 붙인 출처 → 주소로 이름.
 *   · origin.kind 'human' (사람 입력 이벤트) → PeterJ. 그 밖의 경우는 PeterJ 가 될 수 없다.
 *     클로드 코드 작업 세션에서는 'direct' → 'PeterJ (작업세션 직접)' (promptSource 가 가른다 — 10-22 후속).
 *   · origin.kind 'bot' = origin-marker 훅 기록(CLAUDE_ORIGIN) → 그 봇 이름. 본문에 붙인 `[claude-origin]` 은 이름을 못 얻는다.
 *   · origin.from(peer 주소) · origin.kind 'session'(보낸 전체 세션 ID) → 주소·이름표, 없으면 ID 8자.
 *   · 그 밖 = 'user (unverified)'.
 * 본문 글자(`[G1 → C2]`·`[PeterJ]`·`[PeterJ via D1]`·`[D1/G1]`·루틴 표식)는 화자를 **정하지 못한다**(서명은 주장일 뿐 —
 * 같은 계정·같은 입력창을 누구나 쓴다). 유일한 쓰임은 사람 입력에 봇 서명이 붙었을 때 PeterJ 를 **거두는** 것이다 —
 * 옮겨 붙인 봇의 말을 PeterJ 말로 적지 않는다(요구 2). 정본 시험표: speaker-contract.fixtures.json(Python 과 공용). */
export const UNVERIFIED = 'user (unverified)';
/* 작업 세션에 사람이 직접 친 입력(2026-10-22 후속) — 하네스가 사람 입력으로 찍은 것(origin human · turnOrigin human ·
 * 표지 없는 옛 대화형 기록)이고 봇 표식이 없을 때. 봇이 `-p` 로 먹인 입력(turnOrigin sdk)은 표식이 없으면 미검증이다. */
export const DIRECT = 'PeterJ (작업세션 직접)';
/* ★ 봇 출처 표식 — 띄우는 쪽이 CLAUDE_ORIGIN=<봇 이름> 을 주면 origin-marker.mjs(UserPromptSubmit 훅)가
 * `[claude-origin] <이름>` 을 내고, 하네스가 그것을 attachment hook_success(command 에 훅 파일 이름)로 기록한다.
 * 그 **기록**만 출처다 — 본문에 같은 글자를 붙여 넣어도 이름을 얻지 못하고 PeterJ 도 거둔다(SIGNATURE_CLAIM). */
export const ORIGIN_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
export function originMarker(o) {
  const a = o?.attachment;
  if (o?.type !== 'attachment' || a?.type !== 'hook_success' || a.hookEvent !== 'UserPromptSubmit') return null;
  if (!/(?:^|[\\/"'\s])origin-marker\.mjs\b/.test(String(a.command ?? ''))) return null;
  const name = /^\[claude-origin\] (\S+)[ \t]*$/m.exec(String(a.stdout ?? a.content ?? ''))?.[1];
  return name && ORIGIN_NAME.test(name) ? name : null;
}
/* ★ 확정 봇 주소 — 정본은 같은 폴더의 speaker-registry.json(Python speakers.py 가 직접 읽는다). 자족 배포본이라 사본을 싣는다 —
 * 둘이 다르면 speaker-contract.test.mjs 가 실패한다. 예약 화자(G1·D1)는 이 표의 **정확히 같은 주소**로만 — 주소 끝 조각 이름
 * (`g1-sim`·`d1-…`·`mpr-62`)으로 화자를 주던 옛 갈래는 걷었다(6a 실패: 시험 세션 njell85-peter-j/g1-sim 이 G1 으로 찍힘). */
export const SPEAKER_REGISTRY = {
  addresses: {
    'njell85-grok-bot-vm-3697/workspace-agent': 'G1',
    'njell85-grok-bot-vm-3697/chatgpt': 'D1',
    'njell85/c2': 'C2',
  },
};
const REGISTERED = new Map(Object.entries(SPEAKER_REGISTRY.addresses).map(([k, v]) => [k.toLowerCase(), v]));
/** 확정 주소 → 화자, 아니면 null. 대소문자만 무시하고 전체가 같아야 한다(접두·포함 일치 없음). */
export const registeredSpeaker = (address) => REGISTERED.get(String(address ?? '').trim().toLowerCase()) ?? null;
/* ★ 중계 기원 줄 (6b · g1-room.md §3) — C1·C2 가 G1 의 글(Reason·방 댓글)을 작업 세션에 옮길 때 **첫 줄**에 붙이고 원문을 그대로 잇는다:
 *     <!-- relay-origin v1 from=<원래 보낸 Reason 주소> id=<원 메시지 id> -->
 * 하네스가 배달한 세션 간 메시지(같은 PC uds 래퍼 · 보낸 세션 ID 가 C1·C2 이름표로 확인된 session)의 맨 앞일 때만 읽고, from 이 확정 주소
 * 목록에 있을 때만 그 화자(예 G1)다 — 중계자(C2)는 화자가 아니고, 기원 줄로 C1·C2 이름을 얻을 수도 없다(§5). 하청 보고·task-notification 등
 * 일반 peer·사람 입력·표식 없는 입력·확정 밖 주소의 같은 줄은 주장일 뿐 → 미검증(Fable 검토 10-22 B1·B3).
 * 보낸 세션 ID 가 확인된 session 인데 C1·C2 가 아니면(작업 세션) 줄은 무시하고 화자는 그 세션 자신(리뷰 B8). 줄은 운반이 uds·session 이면 늘 본문에서 뺀다.
 * 한계(사실): uds 세션 메시지는 보낸 세션 ID 가 없어 중계자가 C1·C2 인지 기록으로 확인할 수 없다 — 아카이브·화면 모두 확정 주소의 줄이면
 * 그 봇(G1)으로 적되, 화면(dialogue.mjs)은 uds 운반에 `서명 미검증` 을 붙이고 session 운반은 C1·C2 로 확인될 때만 뗀다(리뷰 B5). 화자 이름은 승인이 아니다(§10). */
export const RELAY_ORIGIN_RE = /^<!-- relay-origin v1 from=([^\s>]{1,120}) id=([A-Za-z0-9_-]{1,64}) -->[ \t]*(?:\r?\n|$)/;
/** 중계 기원 줄 만들기 — 읽는 쪽(RELAY_ORIGIN_RE)이 같은 from·id 로 되읽지 못하는 값(공백·꺾쇠·빈 값·허용 밖 글자·길이 초과)이면 던진다(리뷰 B9). */
export function relayOriginLine(from, id) {
  const line = `<!-- relay-origin v1 from=${from} id=${id} -->`;
  const m = RELAY_ORIGIN_RE.exec(line);
  if (typeof from !== 'string' || typeof id !== 'string' || !m || m[0] !== line || m[1] !== from || m[2] !== id) throw new Error(`relay-origin: 쓸 수 없는 from·id (${JSON.stringify(String(from)).slice(0, 60)} · ${JSON.stringify(String(id)).slice(0, 40)})`);
  return line;
}
/** 글 맨 앞 중계 기원 줄 → { from, id, body(줄 뺀 나머지) } 또는 null. */
export function relayOrigin(text) {
  const t = String(text ?? '');
  const m = RELAY_ORIGIN_RE.exec(t);
  return m ? { from: m[1], id: m[2], body: t.slice(m[0].length) } : null;
}
/* 기원 줄을 읽는 배달 = 같은 PC 세션 간 메시지(uds — 아래 udsBody 로 꺼낸 것만)와 보낸 세션 ID 가 확인된 세션 메시지(session)뿐.
 * 일반 peer(하청 보고 <agent-message>·task-notification 등 LLM 이 쓴 글이 그대로 오는 길)는 넣지 않는다(Fable 검토 10-22 B1).
 * 기원 줄로 얻는 화자는 총괄 이름(C1·C2)이 될 수 없다 — 아무 세션이나 C2 로 적히지 않게(B3). session 은 운반자가 C1·C2 이름표일 때만(화면과 같다). */
const RELAY_CARRIERS = new Set(['uds', 'session']);
const LEAD_NAMES = new Set(['C1', 'C2']);
/** 기원 줄 → 화자(확정 주소 · 총괄 이름 제외) 또는 미검증. carrier = origin(kind uds|session).
 * 보낸 세션 ID 가 확인된 session 인데 C1·C2 가 아니면(작업 세션) 중계자가 아니다 — 기원 줄은 그 세션이 할 수 없는 주장이라 무시하고
 * 화자는 그 보낸 세션 자신의 이름표다(줄은 본문에서 뺀다 · 화면 dialogue.mjs 와 같다 · 리뷰 B8). */
function relaySpeaker(relay, origin, labels) {
  if (!RELAY_CARRIERS.has(origin?.kind)) return UNVERIFIED;
  if (origin.kind === 'session' && !LEAD_NAMES.has(sessionLabel(origin.id, labels))) return sessionLabel(origin.id, labels);
  const name = registeredSpeaker(relay.from);
  return name && !LEAD_NAMES.has(name) ? name : UNVERIFIED;
}
// 중계·루틴 꼴만 거둔다 — `[MPR] 오늘 배포해`처럼 PeterJ 가 직접 단 꼬리표는 그대로 PeterJ(Fable 검토 10-22).
const SIGNATURE_CLAIM = /^(?:\[(?:PeterJ via |PeterJ\(|D1\/G1\]|ROUTINE\b|claude-origin\]|[^\]\r\n]{1,40}?\s(?:→|->|⇢|⇒|=>)\s)|GROK_BOT_ROUTINE|routine(?: prompt| task|:)|루틴(?: 실행| 프롬프트|:))/i;
/** 전체 세션 ID → 이름표 이름, 없으면 ID 8자(이름을 지어내지 않는다). */
export const sessionLabel = (id, labels = {}) => (labels && Object.hasOwn(labels, id) ? labels[id] : shortSession(id));
/** 보낸 주소(Reason 봉투 from · peer origin.from) → 화자. 이름표(정확한 키) → 확정 주소 표 → 전체 세션 ID. 그 밖은 null(이름 추정 없음). */
export function addressSpeaker(address, labels = {}) {
  const a = String(address ?? '').replace(/^Reason /, '').trim();
  if (!a) return null;
  if (labels && Object.hasOwn(labels, a)) return labels[a];
  const registered = registeredSpeaker(a);
  if (registered) return registered;
  const session = /^(?:bridge:)?(session_[A-Za-z0-9]{20,})$/.exec(a)?.[1];
  return session ? sessionLabel(session, labels) : null;
}
/** 이 세션 자신(Claude 답)의 화자 — 이름표의 실제 세션 이름, 없으면 저장소-ID 8자. 저장소로 이름을 지어내지 않는다(옛 기본값 C2 버그). */
export function selfSpeaker(sessionId, repo, labels = {}) {
  const id = String(sessionId ?? '');
  if (id && labels && Object.hasOwn(labels, id)) return labels[id];
  const r = String(repo ?? '').trim();
  if (r && id) return `${r}-${shortSession(id)}`;
  return r || (id ? shortSession(id) : 'Claude');
}
export function inputSpeaker(text, origin = {}, labels = {}) {
  const t = String(text ?? '').trimStart();
  // 하네스 기록으로 확인된 봇 출처(origin-marker 훅) — 본문이 무엇이든 그 봇이다.
  if (origin?.kind === 'bot') return ORIGIN_NAME.test(String(origin.name ?? '')) ? String(origin.name) : UNVERIFIED;
  // 중계 기원 줄 — 하네스 세션 간 배달의 맨 앞일 때만, 확정 주소만(6b). 맨 앞 = 글자 그대로 첫 글자(앞 공백·빈 줄을 건너뛰지 않는다 —
  // 수집기 addSession·Python 과 같은 판정 · 리뷰 B4). 사람 입력 속 같은 줄(앞에 공백이 있어도)은 PeterJ 를 거둔다(옮겨 붙인 봇 말).
  const relay = relayOrigin(text ?? '');
  if (relay) return relaySpeaker(relay, origin, labels);
  const relayClaimed = !!relayOrigin(t);
  const typed = origin?.kind === 'human' || origin?.kind === 'direct';
  const envelope = /^<reason-message\b[^>]*\bfrom=["']([^"']+)["']/.exec(t)?.[1];
  // 봉투는 하네스의 peer 배달일 때만 출처다 — 사람 입력·표식 없는 봇 입력·PR 댓글·Codex 입력 속 봉투는 본문일 뿐(Fable 검토 10-22 B1).
  if (envelope) return origin?.kind === 'peer' ? addressSpeaker(envelope, labels) ?? UNVERIFIED : UNVERIFIED;
  if (typed) return relayClaimed || SIGNATURE_CLAIM.test(t) ? UNVERIFIED : origin.kind === 'direct' ? DIRECT : 'PeterJ';
  if (origin?.kind === 'session' && origin.id) return sessionLabel(origin.id, labels);
  return addressSpeaker(origin?.from, labels) ?? UNVERIFIED;
}

export function internalPrompt(text) {
  const t = String(text ?? '').trimStart();
  return !!skillBodyMarker(t) || !!generatedPromptMarker(t) || NOISE_PREFIX.test(t);
}

export function extractDialogueTurns(raw, { repo = '', labels = {}, sessionId = '' } = {}) {
  return extractTurns(raw, { dialogueOnly: true, repo, labels, sessionId });
}

/** Split messages from a Reason delivery without losing ordinary text outside it.
 * peer(하네스 배달) — 맨 앞 봉투 하나만 출처(reasonDelivery) · 나머지 글은 본문이라 미검증(그 속 봉투로 이름을 얻지 않는다 · 리뷰 B2).
 * 그 밖의 출처(Codex 입력 등 — 봉투를 믿지 않는다)는 종전대로 봉투마다 나누되 화자는 inputSpeaker 가 거둔다. */
export function dialogueInputParts(text, origin = {}) {
  const parts = [];
  const ordinary = (s, who = null) => {
    const clean = stripInline(s.split('\n').filter((line) => !NOISE_LINES.some((re) => re.test(line))).join('\n'));
    if (clean && !internalPrompt(clean)) parts.push({ who: who ?? inputSpeaker(clean, origin), text: clean });
  };
  if (origin?.kind === 'peer') {
    const d = reasonDelivery(text);
    const reason = d ? reasonEntry(d.envelope) : null;
    if (!reason) { ordinary(String(text ?? ''), inputSpeaker('', origin)); return parts; }
    const body = stripInline(reason.body);
    if (body && !internalPrompt(body)) parts.push({ who: inputSpeaker(d.envelope, origin), text: body, reason });
    ordinary(d.rest, UNVERIFIED);
    return parts;
  }
  let pos = 0;
  for (const match of String(text).matchAll(/<reason-message\b[^>]*>[\s\S]*?<\/reason-message>/g)) {
    const reason = reasonEntry(match[0]);
    if (!reason) continue;
    ordinary(text.slice(pos, match.index));
    const body = stripInline(reason.body);
    if (body && !internalPrompt(body)) parts.push({ who: inputSpeaker(match[0], origin), text: body, reason });
    pos = match.index + match[0].length;
  }
  ordinary(text.slice(pos));
  return parts;
}

/** 라우터 JSONL에서 사이드카에 허용한 세 필드만 남긴다. 깨진 줄은 계측 누락으로 친다. */
export function parseRouterLog(rawJsonlText) {
  const entries = [];
  for (const line of String(rawJsonlText || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const { at, promptHead, hits } = JSON.parse(line);
      entries.push({ at, promptHead, hits });
    } catch { /* 훅 로그 한 줄이 깨져도 나머지는 살린다 */ }
  }
  return entries;
}

/**
 * 트랜스크립트의 Read·Write·Edit tool_use 중 단일 파일짜리 rulebook 마크다운 접촉만 뽑는다.
 * 룰북 작성자도 작성·수정한 내용을 문맥에 갖고 있으므로 Read와 같이 취급한다.
 * 2026-08-13 실측에서 룰북을 직접 만든 세션이 "Read 기록 없음"으로 오탐됐다.
 * Bash로 `cat rulebook/x.md` 한 접촉은 잡지 않는다. 명령 문자열 파싱은 오탐이 더 크다.
 */
export function extractRulebookReads(rawTranscript) {
  const reads = [];
  const rulebookFile = /(?:^|\/)(?:\.claude\/)?rulebook\/[^\/]+\.md$/;
  const rulebookTools = new Set(['Read', 'Write', 'Edit']);
  for (const line of String(rawTranscript || '').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'assistant' || !Array.isArray(record.message?.content)) continue;
    for (const block of record.message.content) {
      const filePath = block?.input?.file_path;
      if (block?.type !== 'tool_use' || !rulebookTools.has(block?.name) || typeof filePath !== 'string') continue;
      if (!rulebookFile.test(filePath)) continue;
      const read = {
        at: record.timestamp ?? null,
        file: `rulebook/${filePath.split('/').pop()}`,
        tool: block.name,
      };
      if (record.isSidechain) read.viaSidechain = true;
      reads.push(read);
    }
  }
  return reads;
}

/** 계측 사이드카 객체를 만든다. 파일 IO가 없어 테스트와 배포 사본 양쪽에서 쓸 수 있다. */
export function buildSidecar({ sessionId, repo, routerLog = [], rulebookReads = [] }) {
  return { schema: 1, sessionId, repo, routerLog, rulebookReads };
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
        const text = t.text.split('\n').map((line) => isTurnHead(line) ? `\\${line}` : line).join('\n');
        return `### ${t.who}${at ? ` · ${at}` : ''}\n\n${text}`;
      })
      .join('\n\n---\n\n') +
    '\n'
  );
}

/**
 * 이미 눌러 둔 아카이브와 새 스냅샷을 턴 단위 합집합으로 합친다.
 * 이 파일은 단독 배포되므로 병합 구현도 반드시 인라인에 둔다. 타워 CLI는 이 함수를 import한다.
 */
/* 턴 머리를 가르는 자 — `^### ` 전부가 턴이 아니다.
 *
 * 2026-08-15 Fable 검토가 잡은 결함: 종전에는 `^### ` 를 전부 턴 경계로 봤는데,
 * **실제 아카이브 절반가량이 본문 안에 `### 소제목` 을 품고 있다**(실측 48개 중 16개).
 * 그러면 한 턴의 꼬리가 독립 블록으로 떨어져 나가고, 시각이 없어 제자리에 남는 사이
 * 시각 있는 블록만 전역 정렬돼 **꼬리가 남의 턴 사이로 이동한다.** 내용은 안 잃지만
 * 순서·귀속이 조용히 틀어지고, 브리핑이 그걸 원문으로 읽는다.
 * 일상 경로(새 스냅샷 ⊇ 기존)에서는 안 드러나서 내 적대적 시험도 못 잡았다 —
 * 드러나는 곳이 하필 **이 기능을 만든 이유인 복구 병합**이었다.
 *
 * 그래서 턴 머리는 둘 중 하나여야 한다:
 *   ① `### PeterJ` / `### Claude` — 시각이 없는 옛 형식(실물 145건이라 버리면 안 된다)
 *   ② `### <누구> · <ISO8601>` — 렌더러가 쓰는 정식 형태(저장소 이름 턴 포함)
 * 나머지 `### …` 는 전부 **본문 소제목**이라 블록 안에 남는다.
 * 턴 수 집계도 같은 자를 쓴다 — 종전에는 소제목까지 세어 관제 수치가 부풀었다. */
/* ★ 소수초 `(?:\.\d{1,3})?` (Aside 계약 v2 §1-4 · 2026-09-25) — Aside 는 머리 시각에 밀리초를 쓴다.
 * **아래 `HEAD_STAMP` 하나를 정규식과 시각 추출(mergeArchive)이 같이 쓴다** — 한 곳만 고치면
 * 턴으로는 갈리는데 시각이 null 이 돼 정렬에서 빠지거나(추출 미수정), 파일 전체가 "턴 0개"로
 * 읽혀 병합마다 통째 이어붙는다(정규식 미수정). 클로드·Codex 렌더러는 소수초를 안 쓰므로 동작 불변. */
const HEAD_STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})`;
const TURN_HEAD_RE = new RegExp(String.raw`^### (?:PeterJ|Claude|Codex|Grok|Astra|G\d+|C\d+|D\d+|MPR|TR|PNF|EMR|PMA|ROUTINE|HOSPITAL|ETC|user \(unverified\))[ \t]*$|^### .+ · ${HEAD_STAMP}[ \t]*$`);
const HEAD_STAMP_RE = new RegExp(String.raw`·\s*(${HEAD_STAMP})`);
export function isTurnHead(line) { return TURN_HEAD_RE.test(String(line)); }
/** 턴 머리 줄의 시각(ms). 시각이 없거나 못 읽으면 null — 지어내지 않는다. */
export function turnHeadAt(line) {
  const match = String(line).match(HEAD_STAMP_RE);
  const parsed = match ? Date.parse(match[1]) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

/** 대화방 턴이면 { who, line(메타 줄), rest(메타 뒤 본문) } — 아니면 null.
 * 대화방 턴 = 화자가 PeterJ·Claude 가 아니고, 머리 다음 첫 비지 않은 줄이 대화방 메타 줄인 블록. */
function roomMetaOf(block) {
  const nl = block.indexOf('\n');
  const head = nl < 0 ? block : block.slice(0, nl);
  const who = head.match(/^### (.+?) · /)?.[1];
  if (!who || who === 'PeterJ' || who === 'Claude') return null;
  const m = block.slice(nl < 0 ? block.length : nl).match(/^\n(?:[ \t]*\n)*[ \t]*(> (?:대화방 댓글 |현황판 갱신 |세션 메시지 )[^\n]*)\n?([\s\S]*)$/);
  return m ? { who, line: m[1], rest: m[2] } : null;
}
export function mergeArchive(oldText, newText) {
  const split = (text) => {
    const normalized = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const starts = [];
    let offset = 0;
    for (const line of lines) {
      if (isTurnHead(line)) starts.push(offset);
      offset += line.length + 1;
    }
    if (!starts.length) return { header: normalized.trimEnd(), blocks: [] };
    const blocks = starts.map((start, i) => normalized.slice(start, starts[i + 1] ?? normalized.length)
      .replace(/\n\n---\n\n?$/, '').trimEnd());
    return { header: normalized.slice(0, starts[0]).trimEnd(), blocks };
  };
  const oldArchive = split(oldText);
  const newArchive = split(newText);
  if (!oldArchive.blocks.length && !newArchive.blocks.length) {
    if (String(oldText) === String(newText)) return String(oldText);
    // 규격 밖 입력도 버리지는 않는다. 정상 아카이브에서는 닿지 않는 보수적 폴백이다.
    return `${String(oldText).trimEnd()}\n\n${String(newText).trimStart()}`.trimEnd() + '\n';
  }
  /* ★ base 에 턴 머리가 하나도 없으면 그 본문이 통째로 사라지던 자리다
   * (헤더로 분류된 뒤 아래에서 new 의 헤더에 밀린다 — Fable 검토가 재현했다).
   * 턴 머리가 손상된 사본이 들어오는 순간이 곧 유실이고, **이 도구는 정확히 그 순간을
   * 위해 있다.** 그래서 버리지 않고 눈에 보이게 보존한다. */
  let salvaged = '';
  if (!oldArchive.blocks.length && oldArchive.header.trim()
      && oldArchive.header.trim() !== newArchive.header.trim()) {
    salvaged = `> ⚠ 병합 보존 — 아래는 턴 머리를 못 읽은 이전 사본의 원문이다(버리지 않는다).\n\n`
      + `${oldArchive.header.trim()}\n`;
  }
  /* ★ 옛 오귀속 이전(10-03, Astra 재현) — 다른 세션 메시지·띄울 때 첫 지시가 예전엔 `### PeterJ` 로 렌더됐다.
   * 새 사본에 같은 시각의 `세션 메시지(…)` 턴이 있으면, 옛 사본의 **같은 시각 PeterJ 턴 중 래퍼로 시작하거나 본문이 그 메시지를 담은 것**만 뺀다.
   * 대응이 확인되는 것만 지운다(시각 일치 + 내용 일치) — 그 밖의 PeterJ 턴은 건드리지 않는다. */
  const sessionByAt = new Map();
  for (const block of newArchive.blocks) {
    const meta = roomMetaOf(block);
    if (!meta || !/^> 세션 메시지 /.test(meta.line)) continue;
    const at = turnHeadAt(block.slice(0, block.indexOf('\n') < 0 ? block.length : block.indexOf('\n')));
    if (!at) continue;
    if (!sessionByAt.has(at)) sessionByAt.set(at, []);
    sessionByAt.get(at).push(meta.rest.trim());
  }
  const misattributed = (block) => {
    const nl = block.indexOf('\n');
    const head = nl < 0 ? block : block.slice(0, nl);
    if (!/^### PeterJ · /.test(head)) return false;
    const bodies = sessionByAt.get(turnHeadAt(head));
    if (!bodies) return false;
    const body = block.slice(nl < 0 ? block.length : nl).trim();
    return body.startsWith('<cross-session-message') || bodies.some((b) => b && body.includes(b.split('\n')[0]));
  };
  /* ★ 자동 보안 리뷰 화자 이전 (d1-20261007-25) — 같은 리뷰 턴이 예전엔 `### PeterJ`(자리표시)·`### Claude` 로 렌더됐다.
   * 화자가 바뀌면 블록 문자열이 달라 dedupe 가 못 잡고 같은 턴이 두 번 남는다. 그래서 옛 PeterJ·Claude 블록이
   * **새 사본의 연속 블록들(같은 역할 = PeterJ↔리뷰 요청 · Claude↔리뷰 답, 리뷰를 하나 이상 포함)을 `\n\n` 으로 이은 것과
   * 시각·글자까지 같을 때만** 대체된 것으로 본다(리뷰 블록은 첫 줄 출처 표지를 빼고 비교). 옛 렌더는 같은 화자를
   * 한 블록으로 합쳤으므로 앞뒤 사람/Claude 글이 붙은 합본도 이렇게 대응된다. 그 밖은 건드리지 않는다(중복 쪽이 안전). */
  // 하네스 안내(출력 차단)도 같은 이전 — 옛 보관본엔 `### PeterJ` 로 실렸다(d1-20261011-12). 본문은 그대로라 표지 줄 없이 비교한다.
  const reviewRole = { [REVIEW_ASK]: 'PeterJ', [REVIEW_ANSWER]: 'Claude', [REFUSAL_NOTE]: 'PeterJ', PeterJ: 'PeterJ', Claude: 'Claude' };
  const seqOf = (archive) => archive.blocks.map((block) => {
    const nl = block.indexOf('\n');
    const head = nl < 0 ? block : block.slice(0, nl);
    const who = /^### (.+?) · /.exec(head)?.[1];
    let body = block.slice(nl < 0 ? block.length : nl).trim();
    const review = who === REVIEW_ASK || who === REVIEW_ANSWER || who === REFUSAL_NOTE;
    if (who === REVIEW_ASK || who === REVIEW_ANSWER) body = (/^> 자동 보안 리뷰 · 출처 [^\n]*\n+([\s\S]*)$/.exec(body)?.[1] ?? body).trim();
    return { role: reviewRole[who] ?? null, at: turnHeadAt(head), body, review };
  });
  // d1-20261007-27: 같은 엄격 대응(시각·역할·본문 완전 일치)을 **양방향**으로 — 옛 쪽에 이미 리뷰 블록 R 이 있으면
  // 새 쪽의 대응 PeterJ/Claude 블록 L 을 다시 넣지 않는다(mergeArchive(R, L) = R). 느슨한 정규화는 하지 않는다.
  const supersededBy = (seq) => {
    if (!seq.some((x) => x.review)) return () => false;
    return (block) => {
      const nl = block.indexOf('\n');
      const head = nl < 0 ? block : block.slice(0, nl);
      const role = /^### (PeterJ|Claude) · /.exec(head)?.[1];
      if (!role) return false;
      const at = turnHeadAt(head);
      const body = block.slice(nl < 0 ? block.length : nl).trim();
      for (let i = 0; i < seq.length; i++) {
        if (seq[i].role !== role || seq[i].at !== at) continue;
        let joined = '', review = false;
        for (let j = i; j < seq.length && seq[j].role === role; j++) {
          joined = joined ? `${joined}\n\n${seq[j].body}` : seq[j].body;
          review ||= seq[j].review;
          if (joined === body) { if (review) return true; continue; }
          if (!body.startsWith(joined)) break;
        }
      }
      return false;
    };
  };
  const supersededByReview = supersededBy(seqOf(newArchive));      // 옛 L ← 새 R
  const supersededByOldReview = supersededBy(seqOf(oldArchive));   // 새 L ← 옛 R (역순 재수거)
  // 첨부 경계가 새로 생긴 사본에 대응하는 옛 Claude 합본만 분해한다. 양방향 적용.
  const headBody = (b) => { const n = b.indexOf('\n'); return [n < 0 ? b : b.slice(0, n), b.slice(n < 0 ? b.length : n).replace(/(?:\n[ \t]*(?:-{3,})?[ \t]*)+$/, '').trim()]; };
  const obsolete = new Set();
  for (const [fresh, older] of [[newArchive.blocks, oldArchive.blocks], [oldArchive.blocks, newArchive.blocks]]) {
    const placeholderOnly = (block) => {
      const [head, body] = headBody(block);
      const lines = body.split(/\n\s*\n|\n/);
      return /^### PeterJ(?: \(작업세션 직접\))? · /.test(head) && lines.length >= 1 && lines.length <= 2
        && lines.every((line) => /^_\((?:이미지 \d+장 첨부|첨부 문서 \d+개) — 본문 생략\)_$/.test(line));
    };
    for (let i = 0; i + 2 < fresh.length; i++) {
      const [xh, x] = headBody(fresh[i]);
      if (!/^### Claude · /.test(xh) || !x) continue;
      // extractTurns의 같은 화자 병합 구분(\n\n)과 정확히 같게 재구성한다.
      let reconstructed = x;
      for (let j = i + 1; j + 1 < fresh.length && placeholderOnly(fresh[j]); j += 2) {
        const [yh, y] = headBody(fresh[j + 1]);
        if (!/^### Claude · /.test(yh) || !y) break;
        reconstructed += '\n\n' + y;
        for (const b of older) {
          const [bh, body] = headBody(b);
          // 옛 본문 전체가 새 체인의 접두일 때만 버린다. 미확인 꼬리는 중복 보존.
          if (bh === xh && body.startsWith(x + '\n\n') && reconstructed.startsWith(body)) obsolete.add(b);
        }
      }
    }
  }
  /* ★ 방 댓글 출처 줄 이전 (6final) — 방 댓글 턴은 이제 첫 줄에 `## **[화자]** · 방 댓글 #ID · …` 을 단다(roomCommentSource).
   * 같은 댓글의 옛 렌더(출처 줄 없는 본문 · 옛 판의 `> 대화방 댓글 ID · PR` 메타 · 화자 `서명 없음`·저장소-ID 등)가 같은 시각에 있으면
   * 새 쪽이 대체한 것으로 본다 — 시각 일치 + 본문 완전 일치(메타 꼴이면 댓글 ID 까지)일 때만. 양방향(역순 재수거). 그 밖은 건드리지 않는다. */
  {
    const SOURCE_RE = /^## \*\*\[[^\]\n]+\]\*\* · 방 댓글(?: #(\d+))? · [^\n]+\n\n([\s\S]*)$/;
    for (const [fresh, older] of [[newArchive.blocks, oldArchive.blocks], [oldArchive.blocks, newArchive.blocks]]) {
      const sourced = [];
      for (const b of fresh) {
        const [head, body] = headBody(b);
        const m = SOURCE_RE.exec(body);
        const at = turnHeadAt(head);
        if (m && at !== null) sourced.push({ at, id: m[1] ?? null, rest: m[2].trim() });
      }
      if (!sourced.length) continue;
      for (const b of older) {
        const [head, body] = headBody(b);
        if (SOURCE_RE.test(body)) continue;
        const at = turnHeadAt(head);
        const meta = /^> 대화방 댓글 (\S+) · \S+\n\n([\s\S]*)$/.exec(body);
        if (sourced.some((x) => x.at === at && (body === x.rest || (meta && x.id !== null && meta[1] === x.id && meta[2].trim() === x.rest)))) obsolete.add(b);
      }
    }
    // 출처 줄이 있는 같은 댓글(같은 #ID · 같은 본문)이 이름표가 바뀌어 머리·출처 줄만 달라졌으면 새 렌더만 남긴다(Fable B7 — 댓글 ID 하나 = 턴 하나).
    const freshIds = new Map();
    for (const b of newArchive.blocks) {
      const m = SOURCE_RE.exec(headBody(b)[1]);
      if (m?.[1]) freshIds.set(`${m[1]}\n${m[2].trim()}`, b);
    }
    for (const b of oldArchive.blocks) {
      const m = SOURCE_RE.exec(headBody(b)[1]);
      const twin = m?.[1] ? freshIds.get(`${m[1]}\n${m[2].trim()}`) : undefined;
      if (twin !== undefined && twin !== b) obsolete.add(b);
    }
  }
  const seen = new Set();
  const blocks = [];
  for (const block of [...oldArchive.blocks.filter((b) => !misattributed(b) && !supersededByReview(b)), ...newArchive.blocks.filter((b) => !supersededByOldReview(b))]) {
    // 댓글 ID와 본문이 같으면 스냅샷의 게시/알림 시각 차이도 중복이다 — 대화방 턴(roomMetaOf)일 때만.
    // 사람·클로드 턴 본문에 같은 인용이 있어도 대화방 턴으로 보지 않는다(Astra 2차: 클로드 답변 통째 유실 재현).
    const meta = roomMetaOf(block);
    const comment = meta && /^> 대화방 댓글 (?!#)\S+ · /.test(meta.line) ? meta : null;
    const key = comment ? `${comment.who}\n${comment.line}\n${comment.rest}` : block;
    if (obsolete.has(block) || seen.has(key)) continue;
    seen.add(key);
    const head = block.slice(0, block.indexOf('\n') < 0 ? block.length : block.indexOf('\n'));
    blocks.push({ block, at: turnHeadAt(head), order: blocks.length });
  }
  /* ★ 턴 도중 스냅샷 흡수 (2026-09-27 Fable 재검토 ★2).
   * 첫 턴 자가점검·마무리·"지금 수거"의 수동 실행은 **턴 도중**에 돈다 — 그 순간의 Claude 블록은 아직 덜 쓴
   * 본문이다. 뒤에 Stop 훅(또는 다음 수동 실행)이 **같은 머리·완성 본문**을 밀면, 완전일치 dedupe 로는 둘 다 남아
   * 한 턴이 두 번 기록됐다(09-27 main 62파일·2,013쌍). 같은 머리에서 **한 본문이 다른 본문의 앞부분(단락 경계)**
   * 이면 긴 쪽만 남긴다 — 짧은 쪽의 글자는 전부 긴 쪽 안에 있으므로 잃는 것이 없다. 결정적·멱등이다.
   * 앞부분이 아닌 "같은 머리·다른 본문"은 종전대로 둘 다 두고 경고한다(어느 쪽이 옳은지 모른다). */
  {
    const headOf = (block) => { const nl = block.indexOf('\n'); return nl < 0 ? block : block.slice(0, nl); };
    const norm = (block) => block.replace(/(?:\n[ \t]*(?:-{3,})?[ \t]*)+$/, '');
    const byHead = new Map();
    blocks.forEach((b, i) => {
      if (b.at === null || roomMetaOf(b.block)) return;
      const h = headOf(b.block);
      if (!byHead.has(h)) byHead.set(h, []);
      byHead.get(h).push(i);
    });
    const drop = new Set();
    for (const idxs of byHead.values()) {
      if (idxs.length < 2) continue;
      for (const i of idxs) {
        const a = norm(blocks[i].block);
        if (idxs.some((j) => j !== i && !drop.has(j) && (() => { const b = norm(blocks[j].block); return b.length > a.length && b.startsWith(`${a}\n`); })())) drop.add(i);
      }
    }
    if (drop.size) {
      const kept = blocks.filter((_, i) => !drop.has(i));
      blocks.length = 0;
      kept.forEach((b, k) => blocks.push({ ...b, order: k }));
    }
  }
  /* ★ 과도기 중복 경고 (2026-08-20 Fable 검토 · 처방 I).
   * dedupe 는 **블록 문자열 완전일치**다. 추출기를 고치면(08-19 GENERATED_PROMPT_FORMS 같은)
   * 같은 턴의 옛 렌더링과 새 렌더링이 **같은 시각으로 둘 다** 남는다. 중복이라 안전한 방향이지만,
   * 아카이브가 브리핑의 원자료라 하청이 이중으로 읽고, 부풀림을 잡으려던 개정이 부풀림을 만든다.
   * **자동으로 지우지 않는다** — 어느 쪽이 옳은지는 사람이 정한다. 소리만 낸다. */
  let dupWarn = '';
  {
    /* 키는 시각이 아니라 **턴 머리 한 줄**(화자+시각)이다. 시각만으로 묶으면 같은 초에 난
     * 사람/어시스턴트 턴이 서로 다른 본문이라 정상인데도 경고가 뜬다(2026-08-20 테스트가 잡았다). */
    const byHead = new Map();
    for (const b of blocks) {
      if (b.at === null) continue;
      const nl = b.block.indexOf('\n');
      const head = nl < 0 ? b.block : b.block.slice(0, nl);
      const prev = byHead.get(head);
      if (prev === undefined) byHead.set(head, b.block);
      else if (prev !== b.block) byHead.set(head, null);   // 같은 턴 머리·다른 본문
    }
    const n = [...byHead.values()].filter((v) => v === null).length;
    if (n) {
      dupWarn = `> ⚠ 같은 시각에 본문이 다른 턴이 ${n}쌍 있다 — 추출기 개정 과도기 등의 이중 기록일 수 있다(턴 도중 스냅샷은 자동 흡수됨).\n`
        + `> 지우지 않았다(어느 쪽이 옳은지는 사람이 정한다). 며칠 지나 안 사라지면 살펴볼 것.\n`;
    }
  }

  // 시각 없는 턴은 위치를 지어내지 않는다. 읽을 수 있는 턴끼리만 제자리 안정 정렬한다.
  const dated = blocks.filter((b) => b.at !== null).sort((a, b) => a.at - b.at || a.order - b.order);
  let datedIndex = 0;
  const ordered = blocks.map((b) => b.at === null ? b : dated[datedIndex++]);
  const stamps = ordered.filter((b) => b.at !== null).map((b) => b.at);
  const day = (stamp) => new Date(stamp + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const from = stamps.length ? day(Math.min(...stamps)) : '';
  const to = stamps.length ? day(Math.max(...stamps)) : '';
  let header = (newArchive.header || oldArchive.header).trimEnd();
  /* 지난 병합이 얹은 경고 블록은 **걷어내고 다시 계산한다** — 안 그러면 헤더로 먹혀
   * 병합할 때마다 쌓이고 멱등성이 깨진다(턴 수 주석과 같은 함정. 2026-08-20 테스트가 잡았다). */
  header = header.replace(/\n*^> ⚠ 같은 시각에 본문이 다른 턴이[^\n]*(?:\n> [^\n]*)*/m, '').trimEnd();
  if (from) header = header.replace(/^(> 세션: .*?) \([^\n]* KST\)$/m,
    `$1 (${from}${to !== from ? ` ~ ${to}` : ''} KST)`);
  /* 턴 수 주석은 **덧붙이지 말고 갈아끼운다** — 병합은 매 턴 돌므로 누적되면 안 된다.
   * 2026-08-15 실측 버그: 종전 정규식은 `… 제외).` 처럼 **마침표로 끝나는** 헤더에서
   * 기존 `· N턴` 을 못 걷어내고(`$` 앵커가 `턴` 이 아니라 `.` 에 걸린다) 병합할 때마다
   * `· 97턴 · 97턴 · 97턴 …` 으로 불어났다. 그래서 붙는 자리(문장 끝 또는 `)` 앞)를
   * 명시하고 **반복 전체**를 먼저 지운다. 멱등성은 회귀 테스트로 못박았다. */
  header = header.replace(/^> 추출: .*$/m, (line) => {
    const clean = line.replace(/(?: · \d+턴)+(?=\)?\.?$)/, '');
    return clean.endsWith(').')
      ? `${clean.slice(0, -2)} · ${ordered.length}턴).`
      : `${clean} · ${ordered.length}턴`;
  });
  const salvageBlock = salvaged ? `\n\n${salvaged.trimEnd()}` : '';
  const dupBlock = dupWarn ? `\n\n${dupWarn.trimEnd()}` : '';
  return `${header}${dupBlock}${salvageBlock}\n\n${ordered.map((b) => b.block).join('\n\n---\n\n')}\n`;
}

function archiveStats(body) {
  const heads = (String(body).match(/^### .*$/gm) || []).filter(isTurnHead);
  const dates = heads.map((h) => h.match(/·\s*(\d{4}-\d{2}-\d{2}T[^\s]+)/)?.[1])
    .filter(Boolean).map((s) => kstDate(s)).filter(Boolean);
  return { turnCount: heads.length, dateFrom: dates[0] || '', dateTo: dates[dates.length - 1] || '' };
}

function mergedBody(file, incoming) {
  return existsSync(file) ? mergeArchive(readFileSync(file, 'utf8'), incoming) : incoming;
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
  const all = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (name !== 'subagents') walk(p, depth + 1); }
      else if (name.endsWith('.jsonl')) all.push({ path: p, mtimeMs: st.mtimeMs });
    }
  };
  try { walk(base, 0); } catch { /* 읽을 수 없으면 못 찾은 것으로 친다 */ }
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  /* ★ 가장 최근 파일이 **SDK 자동화(보안 리뷰)** 일 수 있다 (2026-09-25 실측). 커밋마다 도는 리뷰가
   * 같은 세션 id 로 다른 프로젝트 폴더에 트랜스크립트를 쓰고, 본 세션보다 늦게 수정된다.
   * 그걸 고르면 추출 결과가 0턴이라 **본 세션 대화를 안 민 채 조용히 끝난다.** 앞 몇 개만 머리를 본다. */
  // 전부 훑는다(2026-09-25 Fable F8) — 커밋이 잦은 세션은 자동 리뷰 파일이 8개를 넘게 더 최근일 수 있다.
  // 머리 256KB 만 읽고, 사람 파일을 만나면 바로 멈춘다. 전부 자동화면 null — 남의 대화를 밀지 않는다.
  for (const c of all) {
    if (!automationTranscript(c.path)) return c.path;
  }
  return null;
}

/** 트랜스크립트 앞부분(256KB)으로 자동 보안 리뷰 파일인지 가른다 — 규칙은 isAutomationTranscript 한 벌. 못 읽으면 false. */
function automationTranscript(file) {
  try {
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const head = buf.toString('utf8', 0, n);
    return isAutomationTranscript(n === buf.length ? head.slice(0, head.lastIndexOf('\n')) : head);
  } catch { return false; }
}

/** git 한 번 돌리고 stdout을 준다. 실패는 전부 null — 훅에서 도는 코드다. */
function git(cwd, args, timeout = 10000) {
  try {
    return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
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

/** 트랜스크립트 기록의 `cwd` 를 세어 많은 순으로(같으면 이름순 — 결정적). 내용은 안 본다. */
export function dominantCwds(raw) {
  const counts = new Map();
  for (const m of String(raw).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
    let c;
    try { c = JSON.parse(`"${m[1]}"`); } catch { continue; }
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
}

/** 가장 많이 머문 작업 폴더 중 git 저장소의 최상위. 없으면 null. */
function dominantRepoRoot(raw) {
  for (const c of dominantCwds(raw)) {
    if (!existsSync(c)) continue;
    const top = gitOut(c, ['rev-parse', '--show-toplevel']);
    if (top) return top;
  }
  return null;
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

/** 배포본도 단일 파일이라 node 내장만 쓴다. 판→턴 비교는 snapshot-store.mjs와 같다. */
export function fullerUsage(current, incoming) {
  const a = JSON.parse(current), b = JSON.parse(incoming);
  if (a.session_id !== b.session_id) throw new Error('사용량 세션 불일치');
  const av = Number(a.schema) || 1, bv = Number(b.schema) || 1;
  return av > bv || (av === bv && (a.turns || 0) >= (b.turns || 0)) ? current : incoming;
}

export function usageRelayFile(root, sessionId) {
  // sid는 경로가 된다 — 훅 입력이 경로 밖 파일을 릴레이하지 못하도록 파일명 문자만 받는다.
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId) || sessionId === '.' || sessionId === '..') return null;
  const dir = process.env.USAGE_OUT_DIR ? path.resolve(process.env.USAGE_OUT_DIR)
    : existsSync(path.join(root, 'data', 'usage')) ? path.join(root, 'data', 'usage', 'sessions')
    : path.join(root, '.usage', 'sessions');
  try {
    const body = readFileSync(path.join(dir, `${sessionId}.json`), 'utf8');
    const snap = JSON.parse(body);
    if (snap.session_id !== sessionId || !Array.isArray(snap.records) || !snap.records.length) throw new Error('로컬 사용량 세션·레코드 불일치');
    // trend-review 같은 공개 repo에서도 목적지는 비공개 GC worktree뿐이다. 공개 repo에는 추가로 쓰지 않는다.
    // Stop 훅 순서는 보장되지 않아 한 턴 늦어도 매 턴 다시 싣는다. 없는 파일은 대화 릴레이를 막지 않는다.
    return { name: `${sessionId}.json`, relayPath: `data/usage/sessions/${sessionId}.json`, body };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[chat-archive] 사용량 읽기 경고: ${error.message}`);
    return null;
  }
}

/**
 * GC 클론의 전용 worktree에 파일을 쓰고 `chat/<repo>-<id8>` 브랜치를 명시적 lease로 갱신한다.
 * @returns {{ok: boolean, changed?: boolean, why?: string}}
 */
/** 전용 worktree 를 둘 git 디렉터리. linked worktree(`.git` 이 **파일**)에서는 `<root>/.git/<이름>` 이 파일 밑 경로라 만들 수 없어
 *  릴레이가 매 턴 "worktree를 만들지 못했습니다" 로 실패하고 `sessions/` 폴백(커밋해야 남음)으로 빠졌다 — PC 의 작업트리 세션
 *  (2026-10-20 실측: gc-codex-grok 의 3da6ecbf, 명시 경로만 커밋하는 세션이라 통째 유실 직전). 공용 디렉터리(`--git-common-dir`)로 푼다.
 *  절대경로·실존 디렉터리가 아니면(옛 git · 시험 대역) 종전 `<root>/.git` 그대로. */
function gitCommonDir(gc) {
  const out = gitOut(gc, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (out && path.isAbsolute(out)) { try { if (statSync(out).isDirectory()) return out; } catch { /* 폴백 */ } }
  return path.join(gc, '.git');
}

export function relayToGc(gc, { repo, files, id8, sessionId }) {
  const wt = path.join(gitCommonDir(gc), 'chat-archive-wt');
  const branch = `chat/${repo}-${id8}`;

  if (!existsSync(wt)) {
    const r = git(gc, ['worktree', 'add', '--force', '--no-track', '-B', branch, wt, baseRef(gc)], 30000);
    if (r.status !== 0) return { ok: false, why: 'worktree를 만들지 못했습니다' };
  } else {
    /* 같은 컨테이너에서 다른 세션이 먼저 만들어 둔 worktree일 수 있다. 그때는 우리 브랜치로
     * 갈아탄다 — 매 턴 커밋·푸시하므로 저쪽에 남아 있을 미커밋 작업이 없다. */
    const cur = gitOut(wt, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (cur !== branch) {
      const r = git(wt, ['checkout', '--force', '--no-track', '-B', branch, baseRef(gc)], 30000);
      if (r.status !== 0) return { ok: false, why: '전용 worktree의 브랜치를 바꾸지 못했습니다' };
    }
  }

  /* ★ 원격 릴레이 브랜치의 사본까지 병합한다 (2026-08-20 Fable 검토 · 처방 A).
   * 종전 push 는 `-f` 였다. worktree 사본하고만 병합하면, **컨테이너가 회수된 뒤 세션이 재개될 때**
   * 새 worktree 에는 그 세션 파일이 없고(아직 수거 전이라 main 에도 없다) 압축·재개로 쪼그라든
   * 재생성본이 그대로 force-push 되어 **원격에만 있던 앞턴을 지운다.** 수거가 하루 1회라
   * 노출 창이 최대 하루이고, 지워지면 되돌릴 수 없다(원격 리플로그에 손이 닿지 않는다).
   * 08-15 처방은 수거기·pull-repos·pull-local-drive 를 병합으로 바꿨는데 **이 push 쪽만 남아 있었다.**
   * 원격 부재만 새 브랜치로 취급한다 — 조회 실패 때 밀면 원격의 유일 사본을 지울 수 있다. */
  const REMOTE_PREV = `refs/remotes/relay-prev/${repo}-${id8}`;
  const fetched = git(wt, ['fetch', '--no-tags', '--quiet', 'origin',
    `+refs/heads/${branch}:${REMOTE_PREV}`], 60000);
  if (fetched.status !== 0) {
    // 조회 실패를 부재로 취급하면 force-push가 아직 수거되지 않은 사본을 지운다.
    const probe = git(wt, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 30000);
    if (probe.status !== 0 || String(probe.stdout || '').trim()) return { ok: false, why: '원격 사본 조회 실패' };
    git(wt, ['update-ref', '-d', REMOTE_PREV]);
  }
  // Bind this update to exactly the remote snapshot we read, including confirmed absence.
  const expectedRemote = fetched.status === 0 ? gitOut(wt, ['rev-parse', REMOTE_PREV]) : '';
  if (expectedRemote === null) return { ok: false, why: '원격 판 확인 실패' };
  const remoteCopy = (name) => {
    if (!expectedRemote) return null;
    const rel = `data/chat-archive/repos/${repo}/${name}`;
    const r = git(wt, ['show', `${REMOTE_PREV}:${rel}`]);
    if (r.status === 0) return String(r.stdout || '').trim() || null;
    // A buffer/read failure is not an absent archive. Never overwrite an unread remote copy.
    const entry = git(wt, ['ls-tree', REMOTE_PREV, '--', rel]);
    if (entry.status !== 0 || String(entry.stdout || '').trim()) throw new Error('원격 대화 읽기 실패');
    return null;
  };

  const outDir = path.join(wt, 'data', 'chat-archive', 'repos', repo);
  const usage = files.find((f) => f.relayPath);
  files = files.filter((f) => !f.relayPath);
  const outs = files.map(({ name, relayPath }) => relayPath ? path.join(wt, relayPath) : path.join(outDir, name));
  try {
    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      mkdirSync(path.dirname(outs[i]), { recursive: true });
      let body = files[i].name.endsWith('.md') ? mergedBody(outs[i], files[i].body) : files[i].body;
      if (files[i].name.endsWith('.md')) {
        /* 원격 사본이 더 차 있을 수 있다 — 턴 단위 합집합이라 결합 순서에 안전하다. */
        const prev = remoteCopy(files[i].name);
        if (prev) { try { body = mergeArchive(prev, body); } catch { /* 병합 실패 시 현재 본문 유지 */ } }
      }
      writeFileSync(outs[i], body, 'utf8');
      if (files[i].name.endsWith('.md')) {
        const meta = files.find((f) => f.name.endsWith('.meta.json'));
        if (meta) meta.body = JSON.stringify({ ...JSON.parse(meta.body), ...archiveStats(body) }, null, 2) + '\n';
      }
    }
  } catch {
    return { ok: false, why: 'worktree에 파일을 쓰지 못했습니다' };
  }

  // 사용량 오류가 대화 보관을 막지 않게 별도로 처리하고 원격 원문부터 보존한다.
  if (sessionId && /^[A-Za-z0-9_.-]{1,128}$/.test(sessionId) && !['.', '..'].includes(sessionId)) {
    const usagePath = `data/usage/sessions/${sessionId}.json`;
    const dest = path.join(wt, usagePath);
    try {
      const entry = git(wt, ['ls-tree', REMOTE_PREV, '--', usagePath]);
      const blob = /^100644 blob ([0-9a-f]+)\t/.exec(String(entry.stdout || ''))?.[1];
      // 원문을 index에 먼저 복원하면 JSON·디스크 쓰기 실패에도 원격 blob을 그대로 싣는다.
      const remoteIndexed = blob && git(wt, ['update-index', '--add', '--cacheinfo', `100644,${blob},${usagePath}`]).status === 0;
      const remote = git(wt, ['show', `${REMOTE_PREV}:${usagePath}`]);
      if (blob && remote.status !== 0) throw new Error('원격 사용량 읽기 실패');
      let body = remote.status === 0 ? String(remote.stdout) : null;
      const worktreeBody = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
      if (body !== null) {
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, body, 'utf8');
        if (!remoteIndexed && git(wt, ['add', '--', dest]).status !== 0) throw new Error('사용량 스테이징 실패');
        const parsed = JSON.parse(body);
        if (parsed.session_id !== sessionId) throw new Error('사용량 세션 불일치');
      }
      // 로컬 집계가 없어도 worktree에만 남은 더 찬 사본을 원격의 짧은 사본에 잃지 않는다.
      if (worktreeBody !== null || usage) {
        for (const candidate of [worktreeBody, usage?.body]) {
          if (candidate != null) body = body === null ? candidate : fullerUsage(body, candidate);
        }
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, body, 'utf8');
        if (git(wt, ['add', '--', dest]).status !== 0) throw new Error('사용량 스테이징 실패');
      }
    } catch (error) { console.error(`[chat-archive] 사용량 릴레이 경고: ${error.message}`); }
  }

  if (git(wt, ['add', '--', ...outs]).status !== 0) return { ok: false, why: 'git add 실패' };
  const diffStatus = git(wt, ['diff', '--cached', '--quiet']).status;
  if (diffStatus !== 0 && diffStatus !== 1) return { ok: false, why: '스테이징 비교 실패' };

  // 공유 pre-commit은 대화·사용량을 다시 수집하므로 방금 고른 합집합·누계를 덮지 않게 막는다.
  if (diffStatus === 1) {
    const commit = git(wt, [
      '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=chat-archive', '-c', 'user.email=chat-archive@users.noreply.github.com',
      'commit', '-m', `chat-archive: ${repo} ${id8}`,
    ], 30000);
    if (commit.status !== 0) return { ok: false, why: '커밋 실패' };
  }
  // An unchanged index can be an earlier committed-but-unpushed snapshot.
  if (diffStatus === 0 && gitOut(wt, ['rev-parse', 'HEAD']) === expectedRemote) return { ok: true, changed: false };

  const push = git(wt, ['push', `--force-with-lease=refs/heads/${branch}:${expectedRemote}`, 'origin', `HEAD:refs/heads/${branch}`], 120000);
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
    // GIT_DIR·GIT_WORK_TREE 를 떼고 부른다 — 연결 worktree 의 pre-commit 훅 안에서는 cwd 가 작업 트리 꼭대기로
    // 잘못 잡혀 최상위 경로로 스테이징된다(사용량 수집기 stageSnapshot 과 같은 함정 · 2026-10-04 재현).
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    spawnSync('git', ['add', '--', file], { cwd: path.dirname(file), stdio: 'ignore', timeout: 5000, env });
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
/* `--labels <파일>` — 세션 이름표를 직접 준다(CHAT_SESSION_LABELS·기본 파일보다 앞선다). 값이 빠졌으면 무시하고 기본 순서로. */
const LABELS_ARG = (() => {
  const i = argv.indexOf('--labels');
  const v = i >= 0 ? argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
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

/* 세션 이름표 — `{"전체 세션 ID": "이름"}`. 고르는 순서: `--labels <파일>` → CHAT_SESSION_LABELS → ~/.claude/session-labels.json
 * (박스 box-collect.py·reason-log.py 의 /workspace/archive-grok/session-labels.json 과 같은 꼴). 없거나 깨졌으면 빈 표 — 그때 화자는 저장소-ID 8자.
 * 깨진 파일(JSON 아님·객체 아님·못 읽음)은 stderr 한 줄로 알리고 계속한다 — 훅에서 도는 수집기라 절대 멈추지 않는다.
 * 기본 파일이 없는 것은 정상(조용히) · 직접 지정한 파일(--labels·환경변수)이 없으면 알린다. */
export function defaultLabelsFile() {
  return process.env.CHAT_SESSION_LABELS || path.join(os.homedir(), '.claude', 'session-labels.json');
}
export function loadSessionLabels(file = defaultLabelsFile(), { explicit = !!process.env.CHAT_SESSION_LABELS, warn = (m) => console.error(m) } = {}) {
  const note = (why) => { try { warn(`[chat-archive] 세션 이름표 ${file} ${why} — 세션 ID 8자로 씁니다`); } catch { /* 알림 실패도 수집을 막지 않는다 */ } };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code !== 'ENOENT' || explicit) note(e?.code === 'ENOENT' ? '없음' : `읽기 실패(${e?.code ?? 'error'})`);
    return {};
  }
  let j;
  try { j = JSON.parse(text.replace(/^﻿/, '')); } catch { note('JSON 아님'); return {}; }
  if (!object(j)) { note('객체 {"전체 세션 ID": "이름"} 가 아님'); return {}; }
  return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string' && v.trim()));
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

  if (isAutomationTranscript(raw)) return;      // 자동 보안 리뷰 파일 — PeterJ 대화가 아니다(조용히 끝낸다)
  const sessionId = hook?.session_id || path.basename(transcript).replace(/\.jsonl$/, '') || 'unknown';
  const turns = extractDialogueTurns(raw, { repo: repoName(repoRoot(hook?.cwd || process.cwd())), labels: LABELS_ARG ? loadSessionLabels(LABELS_ARG, { explicit: true }) : loadSessionLabels(), sessionId });
  if (!turns.length) return;                  // 대화가 하나도 없으면 아무것도 안 쓴다

  const id8 = sessionId.slice(0, 8);
  let root = repoRoot(hook?.cwd || process.cwd());
  /* ★ 저장소 여럿을 붙인 클라우드 세션은 작업 폴더가 `/home/user` 라 git 저장소가 아니다(2026-09-27 Fable 재검토 1번).
   * 그대로 두면 아래 폴백이 `/home/user/.chat/sessions/` 에 쓰고 git add 에 실패해 **버전 관리 밖으로 사라진다.**
   * 트랜스크립트에서 가장 많이 머문 작업 폴더 중 git 저장소인 것을 그 세션의 저장소로 본다(결정적 — 같은 기록이면 같은 답). */
  if (!gitOut(root, ['rev-parse', '--show-toplevel'])) {
    const alt = dominantRepoRoot(raw);
    if (alt) root = alt;
  }
  const repo = repoName(root);

  /* 파일명 날짜는 **첫 턴의 KST 날짜로 고정**한다 — 자정을 넘겨도 같은 세션이 두 파일로
   * 갈라지지 않는다(설계 §6). 세션당 파일 1개, 매 턴 덮어쓰기. */
  const date = kstDate(turns[0]?.at) || kstDate(new Date().toISOString());
  const fileName = `${date}-${id8}.md`;
  const metaName = `${date}-${id8}.meta.json`;
  /* 헤더의 추출기 경로는 **실제 실행 위치**를 적는다 — 타워에서는 tools/chat-archive/,
   * 배포 사본은 .claude/chat-archive/ 에 산다. 하드코딩하면 배포본의 헤더가 거짓말을 한다. */
  const self = (() => {
    try { return path.relative(root, fileURLToPath(import.meta.url)) || 'collect-session.mjs'; }
    catch { return 'collect-session.mjs'; }
  })();
  const body = renderArchive({
    turns, title: `${date}-${id8}`, repo, srcKB, by: self,
  });
  /* 메타 계측 실패는 아카이브 본체를 막지 않는다. 로그가 없거나 못 읽히면 빈 배열이다. */
  let routerLog = [];
  try {
    routerLog = parseRouterLog(readFileSync(path.join(root, '.claude', 'hooks', '.rule-router-log.jsonl'), 'utf8'));
  } catch { /* 파일 없음·권한 오류 모두 빈 로그 */ }
  let rulebookReads = [];
  try { rulebookReads = extractRulebookReads(raw); } catch { /* 깨진 계측은 본체와 분리 */ }
  let metaBody = JSON.stringify({
    ...buildSidecar({ sessionId, repo, routerLog, rulebookReads }), ...archiveStats(body),
  }, null, 2) + '\n';
  const files = [{ name: fileName, body }, { name: metaName, body: metaBody }];

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
    const metaOut = path.join(outDir, metaName);
    mkdirSync(outDir, { recursive: true });
    const finalBody = mergedBody(out, body);
    writeFileSync(out, finalBody, 'utf8');
    metaBody = JSON.stringify({ ...JSON.parse(metaBody), ...archiveStats(finalBody) }, null, 2) + '\n';
    try { writeFileSync(metaOut, metaBody, 'utf8'); } catch { /* 본체는 이미 보존됐다 */ }
    console.error(`[chat-archive] ${out} — ${turns.length}턴 (CHAT_OUT_DIR)`);
    return;
  }

  /* ── 갈래 판별 (설계 §3-2) — 추측하지 않고 파일의 유무로 가른다 ───────────── */
  const isTower = existsSync(path.join(root, 'tools', 'chat-archive'));
  const usage = usageRelayFile(root, sessionId);
  if (usage) files.push(usage);
  const relayMarker = path.join(root, '.claude', 'chat-archive', 'relay-to-gc');

  if (isTower) {
    /* 타워도 릴레이한다 (PeterJ 확정 2026-08-09 — 설계토론 F1).
     *
     * 종전에는 파일을 쓰고 스테이징만 했다. 그래서 **마지막 커밋 이후의 턴이 통째로
     * 빠졌다** — 실물로 확인됐다: 08-08·08-09 아카이브가 "핸드오프를 쓰고 마무리하겠습니다"
     * 에서 끊겨 있고, 두 세션 다 그 뒤로 한참 더 진행됐다. 잘리는 자리가 하필 4종 마무리
     * 직후 = PeterJ의 마지막 지시가 나오는 자리다.
     *
     * 왜 폴백도 `repos/global-config/`인가: pre-commit·릴레이 수거와 같은 파일에
     * 턴 합집합으로 써야 커밋에 폴백이 섞여도 두 벌이 생기지 않는다.
     * 08-08의 낡은 사본 덮어쓰기 위험은 08-15 이후 수거기가 합집합 병합으로 바뀌어
     * 해당하지 않는다(harvest-branches.sh 병합 루프·harvest-branches.test.sh main 전용 턴 회귀).
     * 릴레이 실패에도 로컬 사본을 남긴다 — 중복은 되돌릴 수 있고 유실은 못 되돌린다. */
    const r = relayToGc(root, { repo, files, id8, sessionId });
    if (r.ok) {
      if (r.changed) console.error(`[chat-archive] ${r.branch}에 올림 — ${turns.length}턴`);
      return;
    }
    console.error(`[chat-archive] 타워 릴레이 실패(${r.why}) — 로컬 폴백으로 씁니다`);
    const out = path.join(root, 'data', 'chat-archive', 'repos', 'global-config', fileName);
    const metaOut = path.join(root, 'data', 'chat-archive', 'repos', 'global-config', metaName);
    mkdirSync(path.dirname(out), { recursive: true });
    const finalBody = mergedBody(out, body);
    writeFileSync(out, finalBody, 'utf8');
    metaBody = JSON.stringify({ ...JSON.parse(metaBody), ...archiveStats(finalBody) }, null, 2) + '\n';
    try { writeFileSync(metaOut, metaBody, 'utf8'); } catch { /* 본체는 이미 보존됐다 */ }
    stage(out);
    if (existsSync(metaOut)) stage(metaOut);
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
    const r = relayToGc(gc, { repo, files, id8, sessionId });
    if (!r.ok) console.error(`[chat-archive] GC 릴레이 실패 — ${r.why}`);
    else if (r.changed) console.error(`[chat-archive] GC ${r.branch}에 올림 — ${turns.length}턴`);
    return;
  }

  // 폴백 — 릴레이 마커가 아직 안 닿은 옛 배포본. 자기 마당에 쓰고 타워가 pull-repos.mjs로 걷는다.
  // **이 경로는 커밋에 의존한다**(그 세션이 커밋을 안 하면 유실) — 그래서 2026-08-06에
  // 릴레이를 전 repo 공통으로 바꿨다. 배포가 닿으면 여기로 안 온다.
  const out = path.join(root, '.chat', 'sessions', fileName);
  const metaOut = path.join(root, '.chat', 'sessions', metaName);
  mkdirSync(path.dirname(out), { recursive: true });
  const finalBody = mergedBody(out, body);
  writeFileSync(out, finalBody, 'utf8');
  metaBody = JSON.stringify({ ...JSON.parse(metaBody), ...archiveStats(finalBody) }, null, 2) + '\n';
  try { writeFileSync(metaOut, metaBody, 'utf8'); } catch { /* 본체는 이미 보존됐다 */ }
  stage(out);
  if (existsSync(metaOut)) stage(metaOut);
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
