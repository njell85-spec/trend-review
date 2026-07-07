---
name: codex-debate
description: Use when PeterJ says "클코덱스 토론 시작" (별칭 "클코덱스 토론") — codex(gpt-5.5)와 Claude Opus가 코드를 독립 리뷰한 뒤 중립 심판 서브에이전트로 변증법적으로 수렴시키고 수정방안을 낸다. 코드 수정 전 승인 게이트에서 멈춘다.
---

# 클코덱스 토론 — codex ↔ Opus 변증 코드리뷰

PeterJ가 "클코덱스 토론 시작 [대상]"이라고 하면 이 절차를 사회자로서 실행한다.
SSOT: docs/superpowers/specs/2026-07-07-codex-debate-design.md.

## 0. 프리플라이트
- 대상(SCOPE) 확정: 인자 있으면 그 파일/디렉터리, 없으면 `git diff`(작업 트리).
  diff가 비면 PeterJ에게 대상을 물어본다.
- codex 가용성: `command -v codex` 실패 또는 auth 없음 → PeterJ에게
  "codex 미가용 — Opus 단독 리뷰로 진행할까요?" 물어보고 답에 따른다.
- 라운드 카운터 r=0, 캡=4.

## 1. R0 독립검토(병렬)
- codex: 스크래치패드에 리뷰 프롬프트 파일 작성 후
  `.claude/skills/codex-debate/codex-review.sh "<SCOPE>" <프롬프트> <A0.md>` 실행 →
  결과를 findings_A0(JSON)로 정규화(필요시 한 번 더 codex/직접 파싱).
- Opus: Agent 도구로 `code-reviewer`를 SCOPE로 디스패치 → findings_B0(JSON).
- 둘은 동시에(같은 메시지 병렬 호출) 돌린다.

## 2. R1..N 변증(캡 4)
각 라운드 r:
- codex ← findings_B(r-1) 를 프롬프트에 실어 반박/수용/추가 → findings_A(r).
- Opus ← findings_A(r-1) 를 PEER_FINDINGS로 `code-reviewer` 디스패치 → findings_B(r). (병렬)
- 심판: `review-judge`에 CODEX_FINDINGS=A(r), OPUS_FINDINGS=B(r),
  PRIOR_VERDICTS=지난 판정 → verdicts·new_rebuttals·converged·fix_plan.
- `converged==true`(new_rebuttals==0) 또는 r==4 → 루프 종료.

## 3. 최종 산출
- report-template.md를 채워 `docs/reviews/<YYYY-MM-DD-HHMM>-<슬러그>-debate.md` 저장.
  (KST 시각은 `TZ=Asia/Seoul date +%Y-%m-%d-%H%M`)
- PeterJ에게 요약(확정 심각도별 건수 + 우선순위 수정방안) 제시.

## 4. 승인 게이트 (불변식)
여기서 **정지**. PeterJ가 "수정 진행" 등 명시 승인을 하기 전에는 코드·상태파일을
절대 수정하지 않는다. 승인 시에만 fix_plan을 작업 브랜치에 반영(별도 실행).

## 안전장치
- 캡 4라운드 강제(무한루프 방지). 대상이 크면 착수 전 토큰 규모를 경고.
- codex read-only·Opus 리뷰 전용 → 토론 단계 코드 변경 불가.
- 데일리 코어(REPORT_SPEC 불변식) 무영향.
- 명명된 서브에이전트(`code-reviewer`·`review-judge`)가 아직 등록 안 된 세션이면
  general-purpose에 해당 프롬프트를 실어 대체한다(원본: .claude/agents/*.md).
