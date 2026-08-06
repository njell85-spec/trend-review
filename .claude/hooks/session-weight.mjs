#!/usr/bin/env node
// =============================================================================
// 세션 무게 알림 — 압축(compaction) 횟수를 세어 마무리를 권고한다
// -----------------------------------------------------------------------------
// 왜 압축을 세는가 (PeterJ 확정 2026-08-06, 선택 2-1):
//   업계 관행의 컷오프는 **턴 수가 아니라 문맥창 사용률**이다(60~70% 경고 /
//   80% 전 교체). 턴 수는 우리가 만든 지표고, 압축은 **하네스 자신이 "이 세션
//   무겁다"고 판정한 순간**이다. 추정하지 않고 그 순간을 받는다.
//
//   근거: "context rot" — 입력이 길어질수록 출력 품질이 떨어진다. 프런티어
//   모델 18종 전부에서 관측됐고, 200K 창 모델이 50K에서 이미 유의하게 저하된다.
//   압축은 **비용**을 평평하게 만들 뿐 **품질 저하를 막지 못한다**(요약이라
//   정보가 깎인다). 그래서 "돈이 안 늘었으니 괜찮다"는 판단은 틀린다.
//
// 동작 (훅 두 개가 한 파일을 공유한다):
//   PreCompact — 압축 카운터를 +1 하고 조용히 끝난다(출력 없음).
//   Stop       — 카운터가 임계를 넘었고 아직 안 알렸으면 **한 번만** block해
//                모델에게 사유를 전달한다. 임계마다 1회, 세션당 최대 2회.
//
//   평문 stdout은 Stop 훅에서 모델에게 전달되지 않는다 — block이 유일한
//   전달 경로다(tools/chat-archive/collect-session.mjs와 같은 계약).
//   `stop_hook_active`면 이미 우리가 막은 것이므로 통과한다(무한 루프 방지).
//
// 상태: ~/.claude/session-weight/<session_id>.json — 컨테이너 수명과 같이 간다.
//   저장소를 오염시키지 않는다(커밋 대상 아님).
//
// 불변: **무슨 일이 있어도 세션을 깨지 않는다.** 모든 실패는 조용히 exit 0.
//   이 훅은 편의 기능이고, 이것 때문에 작업이 막히면 손해가 더 크다.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_DIR = path.join(os.homedir(), '.claude', 'session-weight');

/** 임계 — 압축 N회째에 무엇을 알릴지. 순서대로 평가하고 처음 걸리는 것 하나만 낸다. */
const STEPS = [
  {
    at: 1,
    key: 'notice',
    reason:
      '[세션 무게 예고] 이 세션이 문맥 압축을 한 번 거쳤습니다 — 하네스가 문맥창이 찼다고 판정한 것입니다. '
      + '압축은 비용은 잡아주지만 요약이라 정보가 깎이므로, 여기서부터 판단 품질이 조금씩 떨어집니다. '
      + '지금 당장 끊을 필요는 없습니다. 다만 **지금 하는 작업 단위를 끝내는 것을 목표로 잡고**, '
      + '새 주제로 넘어가려던 참이면 그 전에 마무리하는 편이 낫습니다. '
      + 'PeterJ에게 이 사실을 한 줄로 알리고(길게 설명하지 말 것) 하던 작업을 계속하세요.',
  },
  {
    at: 2,
    key: 'wrapup',
    reason:
      '[세션 마무리 권고] 이 세션이 문맥 압축을 두 번 거쳤습니다. 업계 관행 기준으로 교체 시점입니다 — '
      + '이 지점을 넘기면 같은 일을 하는 데 턴이 더 들고 실수가 늘어납니다(요약의 요약이라 초반 맥락이 얇아집니다). '
      + 'PeterJ에게 **4종 마무리 후 새 세션**을 권고하세요. 4종 마무리의 4번(다음 세션 복붙 프롬프트)이 '
      + '이어받기 비용을 없애주므로 끊는 부담이 작습니다. '
      + '다만 **PeterJ가 결정합니다** — 지금 하던 일이 몇 턴 안에 끝나면 그것까지 끝내고 마무리하자고 제안하세요. '
      + '임의로 작업을 중단하거나 마무리를 시작하지 말 것.',
  },
];

/** stdin(훅 입력 JSON)을 끝까지 읽는다. 못 읽으면 빈 객체. */
async function readHookInput() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function statePath(sessionId) {
  // 세션 id는 훅이 주는 값이라 신뢰하지만, 경로 조작만은 막는다(../ 등).
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(STATE_DIR, `${safe || 'unknown'}.json`);
}

function loadState(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    return {
      compactions: Number(s.compactions) || 0,
      announced: Array.isArray(s.announced) ? s.announced : [],
    };
  } catch {
    return { compactions: 0, announced: [] };
  }
}

function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state), 'utf8');
}

async function main() {
  const hook = await readHookInput();
  const event = hook.hook_event_name || '';
  const file = statePath(hook.session_id);

  if (event === 'PreCompact') {
    const state = loadState(file);
    state.compactions += 1;
    saveState(file, state);
    // 압축 훅에서는 아무것도 출력하지 않는다 — 압축 동작 자체를 흔들지 않는다.
    return;
  }

  if (event !== 'Stop') return;

  /* 이미 우리가 한 번 막아서 되돌아온 턴이면 통과한다. 이 가드가 없으면
   * block → 모델 응답 → Stop → block … 으로 세션이 갇힌다. */
  if (hook.stop_hook_active) return;

  const state = loadState(file);
  const step = STEPS.find((s) => state.compactions >= s.at && !state.announced.includes(s.key));
  if (!step) return;

  state.announced.push(step.key);
  saveState(file, state);
  console.log(JSON.stringify({ decision: 'block', reason: step.reason }));
}

// 어떤 예외도 세션을 깨지 않게 한다.
main().catch(() => {}).finally(() => process.exit(0));
