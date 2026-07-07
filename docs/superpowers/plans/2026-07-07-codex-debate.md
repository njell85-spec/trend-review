# codex-debate 스킬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** codex(gpt-5.5)와 Claude Opus가 코드를 독립 리뷰한 뒤 중립 심판 서브에이전트를 통해 변증법적으로 수렴시키고 수정방안을 내는 온디맨드 스킬(`codex-debate`)을, 이 저장소와 모든 프로젝트(글로벌)에서 쓸 수 있게 구축한다.

**Architecture:** 세션 메인 클로드가 `SKILL.md` 레시피를 따라 사회자로서 라운드를 진행한다. codex는 셸 래퍼(`codex-review.sh`)로 read-only 단건 리뷰를 수행하고, Opus 리뷰어·중립 심판은 Agent 도구로 정의된 서브에이전트(`code-reviewer`, `review-judge`)가 맡는다. 원본은 저장소 `.claude/`에 1벌 커밋(SSOT)하고 `env-bootstrap.sh`가 세션 시작 시 `~/.claude/`로 복사해 전 프로젝트 공통화한다.

**Tech Stack:** Markdown(SKILL·agents), Bash(래퍼·부트스트랩), codex CLI 0.142.5(`codex exec`), Claude Code Agent/Skill 도구.

## Global Constraints

- codex 모델은 **`gpt-5.5`** 고정. 호출은 `codex exec -m gpt-5.5 -s read-only --skip-git-repo-check`.
- codex는 **read-only 샌드박스**, 리뷰 단계에서 코드·상태파일 변경 금지.
- 토론 캡 **최대 4라운드**, 신규 반박 소진 시 조기 종료.
- 종료는 **수정방안까지** — 실제 코드 수정은 PeterJ 승인 후 별도.
- 시크릿(`CODEX_AUTH_B64` 등)은 argv·로그에 노출 금지 — 파이프로 직접 파일 기록.
- SSOT: 원본은 저장소 `.claude/`에만. `~/.claude/` 사본은 파생물(직접 수정 금지).
- codex/`CODEX_AUTH_B64` 없는 환경은 곱게 실패 + Opus 단독 폴백 안내.
- 별칭: "클코덱스 토론" = 스킬, "클코덱스 토론 시작" = 실행 지시.
- 커밋 아이덴티티 `Claude <noreply@anthropic.com>` (서명 배지는 무시).
- 데일리 코어(REPORT_SPEC 불변식) 무영향.

## File Structure

| 파일 | 책임 |
|------|------|
| `.claude/skills/codex-debate/SKILL.md` | 오케스트레이션 레시피(흐름·별칭·게이트) — 세션 에이전트가 따라 실행 |
| `.claude/skills/codex-debate/codex-review.sh` | codex 단건 리뷰 래퍼(auth 프리플라이트 + `codex exec` + 산출물 경로 반환) |
| `.claude/skills/codex-debate/report-template.md` | 최종 리포트 골격(심판이 채움) |
| `.claude/agents/code-reviewer.md` | 리뷰어 B 서브에이전트(독립 리뷰·반박, 구조화 JSON 산출) |
| `.claude/agents/review-judge.md` | 중립 심판 서브에이전트(대조·수렴 판정·최종 종합) |
| `.claude/env-bootstrap.sh` | (수정) 세션 시작 시 원본을 `~/.claude/`로 복사 |
| `docs/reviews/.gitkeep` | 토론 리포트 저장 디렉터리 |
| `docs/HANDOFF.md` | (수정) 완료 상태·유지보수 규칙 반영 |

---

### Task 1: codex 리뷰 래퍼 (`codex-review.sh`) + auth 프리플라이트

**Files:**
- Create: `.claude/skills/codex-debate/codex-review.sh`
- Test: 수동 실행(아래 Step)

**Interfaces:**
- Consumes: env `CODEX_AUTH_B64`(선택), codex CLI at `codex`(PATH) 또는 `/opt/node22/bin/codex`.
- Produces: `codex-review.sh <SCOPE> <PROMPT_FILE> <OUT_FILE>` — codex 리뷰를 실행해 최종 메시지를 `<OUT_FILE>`에 기록. 종료코드 0=성공, 10=codex 미설치, 11=인증 불가.

- [ ] **Step 1: 래퍼 스크립트 작성**

`.claude/skills/codex-debate/codex-review.sh`:
```bash
#!/usr/bin/env bash
# codex 단건 코드리뷰 래퍼. auth 멱등 시딩 + codex exec(read-only, gpt-5.5).
# 사용: codex-review.sh <SCOPE> <PROMPT_FILE> <OUT_FILE>
#   SCOPE       리뷰 대상 설명(로그용, 자유문자열)
#   PROMPT_FILE codex에 넘길 프롬프트 파일 경로
#   OUT_FILE    codex 최종 메시지를 기록할 경로
set -euo pipefail

SCOPE="${1:?scope required}"
PROMPT_FILE="${2:?prompt file required}"
OUT_FILE="${3:?out file required}"

CODEX_BIN="$(command -v codex || echo /opt/node22/bin/codex)"
if [ ! -x "$CODEX_BIN" ]; then
  echo "codex CLI 미설치 — Opus 단독 폴백 필요" >&2
  exit 10
fi

# ── auth 멱등 시딩 (시크릿은 파이프로만, argv/로그 노출 금지) ──
AUTH="${CODEX_HOME:-$HOME/.codex}/auth.json"
mkdir -p "$(dirname "$AUTH")"
if [ ! -s "$AUTH" ] && [ -n "${CODEX_AUTH_B64:-}" ]; then
  printf '%s' "$CODEX_AUTH_B64" | base64 -d > "$AUTH"
  chmod 600 "$AUTH"
fi
if [ ! -s "$AUTH" ]; then
  echo "codex 인증 없음(auth.json 빔, CODEX_AUTH_B64 미설정) — Opus 단독 폴백 필요" >&2
  exit 11
fi

echo "codex 리뷰 시작: $SCOPE" >&2
# wss→https 폴백 경고는 정상(프록시 환경). -o 로 최종 메시지만 추출.
"$CODEX_BIN" exec \
  -m gpt-5.5 \
  -s read-only \
  --skip-git-repo-check \
  -o "$OUT_FILE" \
  - < "$PROMPT_FILE" >&2
echo "codex 리뷰 완료 → $OUT_FILE" >&2
```

- [ ] **Step 2: 실행권한 부여**

Run: `chmod +x .claude/skills/codex-debate/codex-review.sh`
Expected: 무출력, 종료코드 0.

- [ ] **Step 3: 미설치 폴백 경로 검증(모의)**

Run: `PATH=/nonexistent bash -c 'command -v codex || echo /opt/node22/bin/codex'`
Expected: `/opt/node22/bin/codex` 출력 (실제 존재하므로 폴백 경로 정상). codex 존재 확인용.

- [ ] **Step 4: 소규모 실제 리뷰 스모크**

작은 프롬프트 파일로 실제 codex 왕복을 확인한다(스크래치패드 사용):
```bash
SP="$(mktemp -d)"
printf '%s\n' 'src/utils/dates.js 파일만 읽고, 버그·개선점을 3줄 이내로 한국어 요약. 수정 금지.' > "$SP/p.txt"
.claude/skills/codex-debate/codex-review.sh "dates.js" "$SP/p.txt" "$SP/out.md"
echo "--- OUT ---"; cat "$SP/out.md"
```
Expected: 종료코드 0, `$SP/out.md`에 dates.js에 대한 한국어 요약이 기록됨(빈 파일 아님).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/codex-debate/codex-review.sh
git commit -m "feat(codex-debate): codex 단건 리뷰 래퍼 + auth 멱등 시딩"
```

---

### Task 2: 리뷰어 B 서브에이전트 (`code-reviewer.md`)

**Files:**
- Create: `.claude/agents/code-reviewer.md`
- Test: Agent 도구 소규모 디스패치(아래 Step)

**Interfaces:**
- Consumes: 대상 코드(파일/디렉터리/diff) + (라운드≥1일 때) 상대 리포트 JSON.
- Produces: 아래 스키마의 JSON만 반환 — `{ "findings": [ {id,file,line,severity,claim,rebuttal} ] }`. `severity ∈ {critical,major,minor,trivial}`.

- [ ] **Step 1: 서브에이전트 정의 작성**

`.claude/agents/code-reviewer.md`:
```markdown
---
name: code-reviewer
description: 코드리뷰 변증 토론의 Claude측 독립 리뷰어. 지정 대상을 비판적으로 검토하고, 상대(codex) 리포트가 주어지면 반박·수용·추가한다. 구조화 JSON만 반환.
tools: Read, Grep, Glob, Bash
---

당신은 비판적 시니어 코드 리뷰어다. **파일을 절대 수정하지 마라(읽기 전용).**

## 입력
- `SCOPE`: 리뷰 대상(파일/디렉터리 목록 또는 `git diff`).
- `PEER_FINDINGS`(선택): 상대 리뷰어(codex)의 발견 JSON. 있으면 각 항목을
  실제 코드로 검증해 **반박(rejected)·수용(confirmed)·보완**하고, 놓친 것을 **추가**한다.

## 검토 관점
버그·오류(런타임/async/에러핸들링/경쟁/null), 보안(시크릿 로그노출·인젝션·경로조작),
불필요구조(죽은코드·중복·과설계), 효율(반복 API·병렬화·캐시·I/O).

## 규칙
- 추측을 사실처럼 쓰지 마라. 확인=confirmed, 의심=open으로 구분.
- 반드시 실제 코드를 읽고 `파일:라인` 근거를 대라.
- 심각도 과장 금지. 위협모델(운영자 제어 입력 등)을 고려해 등급을 매겨라.

## 출력 — 아래 JSON만, 다른 텍스트 없이 반환
{
  "findings": [
    {
      "id": "B1",
      "file": "src/...",
      "line": 123,
      "severity": "critical|major|minor|trivial",
      "claim": "무엇이 왜 문제인지 + 실패 시나리오",
      "rebuttal": "PEER_FINDINGS의 특정 항목에 대한 반박/수용이면 그 id와 사유, 아니면 null"
    }
  ]
}
당신의 최종 메시지는 사람이 아니라 프로그램이 파싱한다. JSON 외 텍스트를 넣지 마라.
```

- [ ] **Step 2: 소규모 독립 리뷰 디스패치 검증**

세션에서 Agent 도구로 `code-reviewer`를 대상 `src/utils/dates.js`로 디스패치.
Expected: `findings` 배열을 가진 유효 JSON 반환(파싱 성공), 각 항목에 file/line/severity/claim 존재.

- [ ] **Step 3: 반박 모드 검증**

동일 서브에이전트에 `PEER_FINDINGS`로 가짜 항목 1개(예: `{"id":"A1","file":"src/utils/dates.js","line":1,"severity":"critical","claim":"존재하지 않는 버그"}`)를 주고 디스패치.
Expected: 반환 JSON에 해당 A1을 검증해 `rebuttal`에 반박/기각 사유가 담긴 항목이 포함됨.

- [ ] **Step 4: 커밋**

```bash
git add .claude/agents/code-reviewer.md
git commit -m "feat(codex-debate): Claude측 리뷰어 서브에이전트 정의"
```

---

### Task 3: 중립 심판 서브에이전트 (`review-judge.md`)

**Files:**
- Create: `.claude/agents/review-judge.md`
- Test: Agent 도구 디스패치(아래 Step)

**Interfaces:**
- Consumes: 이번 라운드 codex 발견 JSON + Opus 발견 JSON (+ 이전 확정 목록).
- Produces: `{ "verdicts":[{id,file,line,severity,status,reason}], "new_rebuttals": <int>, "converged": <bool>, "fix_plan":[{priority,what,how}] }`. `status ∈ {confirmed,rejected,open}`.

- [ ] **Step 1: 심판 정의 작성**

`.claude/agents/review-judge.md`:
```markdown
---
name: review-judge
description: 코드리뷰 변증 토론의 중립 심판. codex와 Claude 두 리뷰어의 발견을 제3자 입장에서 대조·판정하고, 수렴 여부와 최종 수정방안을 낸다. 구조화 JSON만 반환.
tools: Read, Grep, Glob, Bash
---

당신은 codex팀도 Claude팀도 아닌 **중립 심판**이다. **파일 수정 금지.**

## 입력
- `CODEX_FINDINGS`, `OPUS_FINDINGS`: 이번 라운드 양측 발견 JSON.
- `PRIOR_VERDICTS`(선택): 지난 라운드까지 확정/기각된 판정.

## 할 일
1. 같은 결함을 가리키는 항목을 **동일 id로 병합**(file+line 근접 + claim 의미).
2. 각 결함을 실제 코드로 확인해 **confirmed/rejected/open** 판정 + 사유.
   양측 주장이 갈리면 코드를 직접 읽어 심판한다.
3. **이번 라운드에 새로 제기된 반박/발견 수**(`new_rebuttals`)를 센다.
   PRIOR_VERDICTS 대비 새 항목·새 반박이 없으면 0.
4. `new_rebuttals == 0`이면 `converged=true`.
5. confirmed 항목으로 **우선순위 수정방안**(무엇을·어떻게)을 만든다.

## 규칙
- 근거 없는 판정 금지 — 반드시 코드 확인. 심각도는 위협모델 반영.
- 확정과 의심을 구분(open 남용 금지, 확인 가능하면 confirmed/rejected로).

## 출력 — 아래 JSON만
{
  "verdicts": [
    {"id":"F1","file":"src/...","line":123,"severity":"critical|major|minor|trivial",
     "status":"confirmed|rejected|open","reason":"판정 근거 + (있으면) 실패 시나리오"}
  ],
  "new_rebuttals": 0,
  "converged": true,
  "fix_plan": [
    {"priority":1,"what":"무엇을 고칠지","how":"어떻게(파일:라인·접근)"}
  ]
}
최종 메시지는 프로그램이 파싱한다. JSON 외 텍스트 금지.
```

- [ ] **Step 2: 판정·수렴 검증**

Agent로 `review-judge` 디스패치. 입력: 겹치는 발견 2개(codex 1 + opus 1, 같은 file:line) + 서로 다른 1개.
Expected: 유효 JSON. 겹치는 2개는 1개 verdict로 병합, `new_rebuttals` 정수, `converged` 불리언, `fix_plan` 존재.

- [ ] **Step 3: 커밋**

```bash
git add .claude/agents/review-judge.md
git commit -m "feat(codex-debate): 중립 심판 서브에이전트 정의"
```

---

### Task 4: 리포트 템플릿 + SKILL.md 오케스트레이션

**Files:**
- Create: `.claude/skills/codex-debate/report-template.md`
- Create: `.claude/skills/codex-debate/SKILL.md`
- Create: `docs/reviews/.gitkeep`

**Interfaces:**
- Consumes: Task1 래퍼(`codex-review.sh`), Task2·3 서브에이전트(`code-reviewer`,`review-judge`).
- Produces: 세션 에이전트가 따라 실행하는 절차. 산출물 = `docs/reviews/YYYY-MM-DD-HHMM-<슬러그>-debate.md`.

- [ ] **Step 1: 리포트 템플릿 작성**

`.claude/skills/codex-debate/report-template.md`:
```markdown
# 코드리뷰 변증 토론 — <대상>

- 일시(KST): <YYYY-MM-DD HH:MM>
- 대상: <scope>
- 모델: codex=gpt-5.5 · reviewer/judge=Opus
- 라운드: <n> (수렴=<yes/no>, 캡=4)

## 최종 판정 (심각도별)
### 🔴 Critical
- <file:line> — <claim> · 실패 시나리오 · 권고

### 🟠 Major / 🟡 Minor / ⚪ Trivial
- …

## 기각된 주장
- <id> <file:line> — 기각 사유

## 미해결(open)
- <id> — 양측 입장

## 수정방안 (우선순위)
1. <what> — <how>

## 라운드 로그(요약)
- R0 codex n건 / opus m건 · R1 반박 … · 수렴 지점
```

- [ ] **Step 2: SKILL.md 작성**

`.claude/skills/codex-debate/SKILL.md`:
```markdown
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
```

- [ ] **Step 3: reviews 디렉터리 placeholder**

Run: `mkdir -p docs/reviews && touch docs/reviews/.gitkeep`
Expected: `docs/reviews/.gitkeep` 생성.

- [ ] **Step 4: 스킬 인식 확인**

세션에서 `ListSkills`(또는 스킬 목록)로 `codex-debate`가 뜨는지 확인.
Expected: `codex-debate` 스킬이 목록에 나타남(프로젝트 로컬 인식).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/codex-debate/SKILL.md .claude/skills/codex-debate/report-template.md docs/reviews/.gitkeep
git commit -m "feat(codex-debate): 오케스트레이션 SKILL.md + 리포트 템플릿 + reviews 디렉터리"
```

---

### Task 5: 글로벌 설치 (부트스트랩 복사)

**Files:**
- Modify: `.claude/env-bootstrap.sh` (전역 CLAUDE.md 복사 블록 뒤에 스킬·에이전트 복사 추가)

**Interfaces:**
- Consumes: 저장소 `.claude/skills/codex-debate/`, `.claude/agents/*.md`.
- Produces: 세션 시작 시 `~/.claude/skills/codex-debate/`, `~/.claude/agents/{code-reviewer,review-judge}.md` 설치.

- [ ] **Step 1: 부트스트랩에 복사 블록 추가**

`.claude/env-bootstrap.sh`의 전역 CLAUDE.md 적용 블록(약 51~63행) **직후**에 삽입:
```bash
# ── codex-debate 스킬·에이전트 전역 설치 (SSOT=저장소 .claude, 사본은 파생물) ──
SRC_CD="${CLAUDE_PROJECT_DIR:-}/.claude"
if [ -d "$SRC_CD/skills/codex-debate" ]; then
  mkdir -p "$HOME/.claude/skills" "$HOME/.claude/agents" 2>/dev/null || true
  cp -r "$SRC_CD/skills/codex-debate" "$HOME/.claude/skills/" 2>/dev/null || true
  cp "$SRC_CD/agents/code-reviewer.md" "$SRC_CD/agents/review-judge.md" \
     "$HOME/.claude/agents/" 2>/dev/null || true
  chmod +x "$HOME/.claude/skills/codex-debate/codex-review.sh" 2>/dev/null || true
fi
```

- [ ] **Step 2: 부트스트랩 구문 검증**

Run: `bash -n .claude/env-bootstrap.sh && echo "syntax OK"`
Expected: `syntax OK`.

- [ ] **Step 3: 복사 동작 검증(모의 실행)**

Run:
```bash
CLAUDE_PROJECT_DIR="$(pwd)" bash -c '
SRC_CD="$CLAUDE_PROJECT_DIR/.claude"
mkdir -p "$HOME/.claude/skills" "$HOME/.claude/agents"
cp -r "$SRC_CD/skills/codex-debate" "$HOME/.claude/skills/"
cp "$SRC_CD/agents/code-reviewer.md" "$SRC_CD/agents/review-judge.md" "$HOME/.claude/agents/"
ls "$HOME/.claude/skills/codex-debate/" "$HOME/.claude/agents/"'
```
Expected: `~/.claude/skills/codex-debate/`에 SKILL.md·codex-review.sh, `~/.claude/agents/`에 두 md 존재.

- [ ] **Step 4: 커밋**

```bash
git add .claude/env-bootstrap.sh
git commit -m "feat(codex-debate): env-bootstrap이 스킬·에이전트를 ~/.claude로 전역 설치"
```

---

### Task 6: 엔드투엔드 드라이런 + HANDOFF 갱신

**Files:**
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: Task1~5 전체.
- Produces: 실제 소규모 토론 1회 산출물 + 인수인계 기록.

- [ ] **Step 1: 소규모 E2E 토론 실행**

세션에서 `codex-debate` 스킬을 대상 **`src/utils/dates.js` 단일 파일**, 캡 2라운드로 실행
(SKILL.md 절차대로 codex R0 + Opus R0 → 심판 → 필요시 R1 → 리포트).
Expected: `docs/reviews/<날짜>-dates-debate.md` 생성. 리포트에 확정/기각/수정방안 섹션이 채워지고,
codex·Opus가 실제로 서로를 참조(반박/보완)한 흔적이 라운드 로그에 있음. **코드는 미변경**(게이트에서 정지).

- [ ] **Step 2: 게이트 준수 확인**

Run: `git status --porcelain src/`
Expected: 무출력(리뷰 대상 소스는 변경되지 않음 — 승인 게이트 준수).

- [ ] **Step 3: HANDOFF 갱신**

`docs/HANDOFF.md` §5(완료 상태)에 추가:
```markdown
- codex-debate 스킬 완료: "클코덱스 토론 시작 [대상]"으로 codex(gpt-5.5)↔Opus 변증 리뷰.
  SSOT=.claude/skills/codex-debate + .claude/agents/{code-reviewer,review-judge}.md,
  env-bootstrap이 ~/.claude로 전역 설치. 리포트=docs/reviews/. 수정은 승인 게이트 후.
  **유지보수: 저장소 원본만 수정, ~/.claude 사본은 세션마다 덮어써지는 파생물.**
```

- [ ] **Step 4: 커밋 + 푸시**

```bash
git add docs/HANDOFF.md docs/reviews/
git commit -m "docs(codex-debate): E2E 드라이런 산출물 + HANDOFF 완료 반영"
git push -u origin claude/codex-mcp-check-1nj97m
```

---

## Self-Review 결과

- **Spec 커버리지**: D1(온디맨드 스킬)=Task4, D2(수렴/4캡)=Task3·4, D3(승인게이트)=Task4·6,
  D4(대상 인자)=Task4 §0, D5(중립심판)=Task3, D6(gpt-5.5)=Task1, D7(codex exec)=Task1,
  D8(별칭)=Task4, D9(글로벌+로컬)=Task5, D10(폴백)=Task1·4. §7 auth 프리플라이트=Task1.
  누락 없음.
- **플레이스홀더 스캔**: 실행 코드/명령/기대출력 모두 구체값. TBD 없음.
- **타입 일관성**: findings JSON 키(id/file/line/severity/claim/rebuttal), 심판 출력
  키(verdicts/new_rebuttals/converged/fix_plan) Task2·3·4에서 동일 사용. 래퍼 종료코드
  10/11 Task1 정의 → Task4 폴백 분기와 일치.
