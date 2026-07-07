# codex-debate 스킬 — codex ↔ Claude Opus 코드리뷰 변증 토론

> 설계 문서 (SSOT). 작성 2026-07-07 (KST). 상태: **설계 승인 대기 → 확정 시 구현계획으로**.
> 근거 대화: PeterJ 지시 "클코 코덱스 코드리뷰 토론 프로세스 고정" (2026-07-07).

## 1. 목적 / 배경

같은 코드를 **codex(GPT)** 와 **Claude Opus** 가 각각 독립 리뷰한 뒤, 서로의 리포트를
**변증법적으로 주고받으며(반박·수용·추가)** 결론을 수렴시키고, **수정방안까지** 도출하는
반복 가능한 온디맨드 프로세스를 스킬로 고정한다.

실증 근거: 2026-07-07 이 저장소를 codex→Opus 순으로 교차검증했더니, Opus가 codex의
방향 오류(제외목록 부작용 방향)·과대평가(path traversal 심각도)를 잡아내고 추가 버그
2건(누적 dedup 부재, 빈 PMID 오염)을 얹었다. 두 모델의 교차검증이 단일 리뷰보다
확실히 우수함을 확인 → 매번 손으로 지휘하지 않도록 프로세스로 박는다.

PeterJ CLAUDE.md 원칙 "반복 판단·검증 작업은 워크플로우로 고정"과 정합.

## 2. 확정 결정 (되묻지 않음)

| # | 항목 | 결정 |
|---|------|------|
| D1 | 실행 방식 | **온디맨드 채팅 스킬** (Actions 자동화는 향후 별도) |
| D2 | 토론 깊이 | **수렴까지 N라운드** — 신규 반박 소진 시 종료, **최대 4라운드 캡** |
| D3 | 종료 지점 | **수정방안 수립까지** 자동 → 실제 코드 수정은 **PeterJ 승인 후** |
| D4 | 검토 대상 | **매번 인자로 지정** (파일/디렉터리/diff). 인자 없으면 `git diff`(작업 트리) |
| D5 | 판정 주체 | **중립 Opus 서브에이전트**(제3 심판) — codex도 메인 Opus도 아님 |
| D6 | codex 모델 | **`gpt-5.5`** (2026-07-07 실측: `codex exec -m gpt-5.5` 정상 응답) |
| D7 | 호출 방식 | codex는 **`codex exec` 백그라운드(read-only)** — MCP 도구 60초 타임아웃 회피 |
| D8 | 별칭 | 자연어 **"클코덱스 토론"** = 이 스킬. **"클코덱스 토론 시작"** = 실행 지시 |
| D9 | 설치 범위 | **글로벌+프로젝트 로컬 (단일 원본)** — 저장소 `.claude/`에 원본 커밋, 부트스트랩이 `~/.claude/`로 복사해 전 프로젝트 공통화 |
| D10 | 이식성 | codex CLI / `CODEX_AUTH_B64` 없는 환경(데스크탑 등)에서 **곱게 실패 + Opus 단독 폴백** |

## 3. 역할 (4개 배우)

- **리뷰어 A = codex** — `codex exec -m gpt-5.5 -s read-only` 백그라운드 호출. read-only
  샌드박스라 파일 수정 불가(검토 단계 안전).
- **리뷰어 B = Claude Opus 서브에이전트** — Agent 도구(`code-reviewer` 타입)로 독립 리뷰.
- **심판 = 중립 Opus 서브에이전트** — Agent 도구(`review-judge` 타입). 매 라운드 판정 +
  최종 종합. A/B 어느 쪽도 아닌 제3자.
- **사회자 = 메인 세션 클로드** — 라운드 진행, 리포트 전달, 수렴·캡 판정 강제, 최종 리포트
  작성, 승인 게이트 관리.

## 4. 흐름

```
클코덱스 토론 시작 [대상]     예: 클코덱스 토론 시작 src/agents
                             또는 인자 없음 → git diff(작업 트리)

[프리플라이트] codex 인증 보장 (§7)

R0 독립검토 (병렬):
   · codex        → findings_A0   (read-only exec, gpt-5.5)
   · Opus 서브    → findings_B0

R1..N 변증 (캡 4):
   · codex   ← findings_B(n-1) 전달 → 반박/수용/추가 → findings_A(n)   (병렬)
   · Opus 서브 ← findings_A(n-1) 전달 → 반박/수용/추가 → findings_B(n)
   · 심판 서브: 두 리포트 대조 → 각 발견 status 태깅
                (confirmed / rejected / open) + "이번 라운드 신규 반박 유무" 판정
   · 신규 반박 0  → 수렴 → 루프 종료
   · 라운드 == 4  → 강제 종합

[최종] 심판 서브가 통합 판정문 작성:
   · 확정 발견 (🔴/🟠/🟡 심각도별, 파일:라인, 실패 시나리오)
   · 기각 발견 (+기각 사유)
   · 미해결 (+양측 입장)
   · 수정방안 (무엇을 · 어떻게 · 우선순위)

[산출] 사회자가 리포트 저장 (§6) + PeterJ에게 요약 제시

🚦 승인 게이트: 여기서 정지. PeterJ "수정 진행" 승인 전까지 코드·상태파일 절대 미변경.
   승인 시 → 수정방안을 작업 브랜치에 반영 (별도 실행).
```

## 5. 데이터 구조 (라운드 간 추적)

발견사항은 구조화 객체로 주고받아 심판이 중복 제거·상태 추적·수렴 판정을 자동화한다:

```jsonc
{
  "id": "F1",                    // 안정 ID (라운드 넘어 유지)
  "file": "src/orchestrator/TrendReviewOrchestrator.js",
  "line": 497,
  "severity": "critical",        // critical | major | minor | trivial
  "claim": "제외목록을 publish 전에 저장 → publish 실패 시 데이터 불일치",
  "by": "codex",                 // codex | opus
  "status": "open",              // open | confirmed | rejected
  "round": 0,
  "rebuttal": null               // 상대의 반박/보완 요지
}
```

상태 파일: 스크래치패드(세션용, 커밋 안 함). 최종 리포트만 저장소에 커밋.

## 6. 산출물

- **리포트**: `docs/reviews/YYYY-MM-DD-HHMM-<대상슬러그>-debate.md`
  - 헤더(대상·라운드 수·수렴 여부·모델), 라운드별 요약, 최종 판정문, 수정방안.
- **중간 상태**: 스크래치패드(비커밋).
- 리포트는 승인 게이트 도달 시점에 커밋 (수정 전 스냅샷으로 남김).

## 7. codex 인증 프리플라이트 (중요)

2026-07-07 관찰: codex MCP/CLI가 **빈 `~/.codex/auth.json`** 으로 시작해 401(Unauthorized).
실제 인증은 `CODEX_AUTH_B64` 환경변수(base64, `auth_mode: chatgpt`)에 있으나 부트스트랩이
풀어놓지 않음. 스킬은 매 실행 첫 단계에서 **멱등 시딩**을 수행한다:

```
if [ ! -s ~/.codex/auth.json ] && [ -n "$CODEX_AUTH_B64" ]; then
  printf '%s' "$CODEX_AUTH_B64" | base64 -d > ~/.codex/auth.json
  chmod 600 ~/.codex/auth.json
fi
```

- 시크릿은 argv·로그에 노출 금지(파이프로 직접 파일 기록). PeterJ 셀프리뷰 체크리스트 ①.
- MCP 서버가 이미 빈 인증을 캐시했다면 codex **CLI(`codex exec`)** 경로를 쓰므로 영향 없음
  (CLI는 매 실행 auth.json을 새로 읽음).
- **알려진 현상(비차단)**: 프록시 환경에서 codex가 `wss://chatgpt.com/...` WebSocket에
  TLS(UnknownIssuer) 실패 후 HTTPS로 자동 폴백 → 호출당 ~7초 재시도 지연. 튜닝 여지:
  config로 HTTPS 트랜스포트 고정 검토(구현 단계에서 옵션 확인, 차단 요인 아님).

## 8. 구성 파일 · 설치 범위 (글로벌 + 로컬, 단일 원본)

**원칙**: 원본은 이 저장소에 **1벌만** 커밋한다(SSOT). 물리적 두 벌은 드리프트 위험 →
금지. "글로벌+로컬 둘 다"는 *단일 원본을 두 위치에 배치*하는 방식으로 달성한다.

| 경로(저장소 원본 = SSOT) | 역할 |
|------|------|
| `.claude/skills/codex-debate/SKILL.md` | 오케스트레이션 레시피 + 별칭·프리플라이트. **trend-review에선 프로젝트 로컬 스킬로 즉시 작동** |
| `.claude/agents/code-reviewer.md` | 리뷰어 B 서브에이전트(고정 프롬프트, read-only 관점) |
| `.claude/agents/review-judge.md` | 중립 심판 서브에이전트(판정·수렴·종합) |
| `docs/reviews/` (신설) | 토론 리포트 저장 위치 |

**글로벌화(다른 모든 프로젝트에서 사용)** — `.claude/env-bootstrap.sh`에 세션 시작 복사 추가:
```
# 저장소 원본 → 전역 위치 (global-CLAUDE.md 와 동일 패턴)
SRC="${CLAUDE_PROJECT_DIR}/.claude"
cp -r "$SRC/skills/codex-debate" "$HOME/.claude/skills/" 2>/dev/null || true
mkdir -p "$HOME/.claude/agents"
cp "$SRC/agents/code-reviewer.md" "$SRC/agents/review-judge.md" "$HOME/.claude/agents/" 2>/dev/null || true
```
- trend-review 밖 저장소가 없는 원격 세션에서도 쓰려면, `global-CLAUDE.md`가 이미 하는
  것처럼 `raw.githubusercontent.com/njell85-spec/trend-review/main/.claude/...` 폴백
  다운로드를 같이 둔다(부트스트랩에 기존 URL 패턴 재사용).
- **유지보수 규칙**: 항상 **저장소 원본만 수정**한다. `~/.claude/` 사본은 세션마다
  덮어써지는 파생물 — 직접 편집 금지(HANDOFF에 명시).

**이식성 폴백(D10)** — 스킬 프리플라이트에서 `command -v codex` 확인:
- codex 없음 → PeterJ에게 "codex 미설치 환경 — Opus 단독 리뷰로 진행할까요?" 안내(곱게 실패).
- `CODEX_AUTH_B64` 없음 & auth.json 빔 → 동일하게 안내. 데일리 코어엔 영향 없음.

스킬 frontmatter(기존 `preview` 스킬 포맷 준수):
```yaml
---
name: codex-debate
description: Use when PeterJ says "클코덱스 토론 시작" (별칭 "클코덱스 토론") — runs a
  dialectical code-review debate between codex (gpt-5.5) and Claude Opus, converging via a
  neutral judge subagent, and produces a fix plan. Stops before editing code (approval gate).
---
```

## 9. 불변식 / 안전장치

- **캡 강제**: 최대 4라운드. 사회자가 라운드 카운터로 강제 종료(무한루프 방지).
- **read-only**: codex는 read-only 샌드박스, Opus 서브는 검토 전용 프롬프트 → 토론 단계에서
  코드·상태파일 변경 불가.
- **승인 게이트**: 수정방안까지만. PeterJ 명시 승인 없이는 수정 미착수(D3).
- **데일리 코어 무영향**: 이 스킬은 리뷰 도구일 뿐 데일리 파이프라인(REPORT_SPEC 불변식)에
  손대지 않음.
- **토큰 예산**: 라운드마다 codex 1회 + Opus 서브 1회 + 심판 1회. 4라운드 최악 ≈ codex 5회 +
  Opus 서브 5회 + 심판 5회. 대상 범위가 크면 사회자가 착수 전 경고.

## 10. 성공 기준

- `클코덱스 토론 시작 <대상>` 한 줄로 전체 흐름이 돌아 리포트가 생성된다.
- codex·Opus가 실제로 서로를 반박/보완하고(단순 병렬 아님), 심판이 확정/기각/미해결로
  정리한다.
- 수렴 또는 4라운드에서 반드시 종료한다(무한루프 없음).
- 코드 수정은 승인 전까지 발생하지 않는다.
- 2026-07-07 수동 교차검증(codex 7건 → Opus 판정 + 2건 추가)과 **동등 이상 품질**을 자동 재현.

## 11. 범위 밖 (YAGNI)

- GitHub Actions 자동 게이트(PR 트리거) — 향후 별도 스펙(스킬 검증 후 확장).
- 3개 이상 모델 다자 토론 — 2자(codex·Opus)로 고정.
- 자동 수정 후 자동 커밋/PR — 승인 게이트 유지가 원칙.
