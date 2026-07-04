#!/usr/bin/env bash
# =============================================================================
# PeterJ 환경 부트스트랩 (env-bootstrap.sh)
# -----------------------------------------------------------------------------
# 목적: 환경이 "완전 리셋"되거나 새 환경을 만들어도, 모든 프로젝트에
#       아래 3가지가 자동으로 다시 깔리게 한다.
#         1) 새 세션 시작 시 안전 자동 pull
#         2) superpowers 플러그인 설치·활성 유지
#         3) 전역 지침(~/.claude/CLAUDE.md) 적용
#
# 사용법: 이 파일 내용을 클라우드 "환경 설정 > 셋업 스크립트"에 붙여넣으면,
#         컨테이너가 뜰 때마다 자동 실행되어 위 3가지를 심어준다.
#         (이 저장소에도 보관되어 버전관리·백업 역할을 한다.)
#
# 안전: 기존 설정을 보존하고, 이미 있으면 중복 추가하지 않는다(멱등).
# =============================================================================
set -u
mkdir -p "$HOME/.claude"

# ── (1) 계정 단위 세션 시작 스크립트 작성 ────────────────────────────────
cat > "$HOME/.claude/peterj-session-start.sh" <<'SCRIPT'
#!/usr/bin/env bash
# 모든 프로젝트 공통 세션 시작 자동화.
set -u

# 1) 안전 자동 pull (현재 프로젝트) — 깨끗한 상태 + fast-forward 가능할 때만.
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ]; then
  (
    cd "$CLAUDE_PROJECT_DIR" || exit 0
    [ -z "$(git status --porcelain 2>/dev/null)" ] || exit 0
    git pull --ff-only 2>/dev/null || true
  ) || true
fi

# 2) superpowers 설치·활성 유지.
PLUGIN="superpowers@superpowers-marketplace"
if ! claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  claude plugin marketplace add obra/superpowers >/dev/null 2>&1 || true
  claude plugin install "$PLUGIN" --scope user >/dev/null 2>&1 || true
fi
claude plugin enable "$PLUGIN" >/dev/null 2>&1 || true

# 3) 전역 지침 적용.
mkdir -p "$HOME/.claude" 2>/dev/null || true
cat > "$HOME/.claude/CLAUDE.md" <<'MD'
# 전역 지침 (PeterJ) — Global CLAUDE.md

## 대화 규칙
- 사용자 호칭은 항상 **PeterJ**.
- 답변은 항상 **존댓말**.

## 환경 유지
- **superpowers 플러그인은 항상 설치·활성 상태로 유지**한다.

## 작업 습관
- 새 세션 시작 시 자동 pull(최신 동기화), 작업 마무리 시 commit + push.

## 추가 예정 (PeterJ가 채워나갈 자리)
MD

exit 0
SCRIPT
chmod +x "$HOME/.claude/peterj-session-start.sh"

# ── (2) settings.json 에 SessionStart 훅 등록 (기존 보존 + 중복 방지) ────
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
try:
    with open(p) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
cmd = 'bash "$HOME/.claude/peterj-session-start.sh"'
hook = {"type": "command", "command": cmd}
ss = cfg.setdefault("hooks", {}).setdefault("SessionStart", [])
already = any(
    h.get("command") == cmd
    for entry in ss
    for h in entry.get("hooks", [])
)
if not already:
    ss.append({"hooks": [hook]})
with open(p, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print("SessionStart hook registered" if not already else "hook already present")
PY

echo "PeterJ 환경 부트스트랩 완료."
