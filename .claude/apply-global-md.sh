#!/usr/bin/env bash
# apply-global-md.sh
# 저장소의 global-CLAUDE.md 원본을 전역 위치(~/.claude/CLAUDE.md)로 복사한다.
# 환경이 리셋되거나 새로 만들어져도, 이 저장소를 여는 세션에서 전역 지침이
# 다시 심어지도록 보장한다. 조용히 동작하고, 실패해도 세션을 방해하지 않는다.

set -u

SRC="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/.claude/global-CLAUDE.md"
DEST="$HOME/.claude/CLAUDE.md"

# 원본이 없으면 아무것도 안 함.
[ -f "$SRC" ] || exit 0

mkdir -p "$HOME/.claude" 2>/dev/null || true

# 이미 같은 내용이면 건너뛴다(불필요한 쓰기 방지).
if [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
  exit 0
fi

cp "$SRC" "$DEST" 2>/dev/null || true
exit 0
