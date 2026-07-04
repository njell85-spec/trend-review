#!/usr/bin/env bash
# auto-pull.sh
# 세션 시작 시, 안전할 때만 GitHub 최신을 당겨온다.
# 안전 조건:
#   1) 커밋 안 된 변경이 없을 것(깨끗한 작업 트리) — 있으면 건드리지 않는다.
#   2) fast-forward 가능할 때만 당긴다(--ff-only) — 충돌/병합 커밋을 만들지 않는다.
# 어느 조건이든 안 맞으면 아무것도 안 하고 조용히 끝난다.

set -u

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" 2>/dev/null || exit 0

# 커밋 안 된 변경이 있으면 손대지 않는다(작업 보호).
[ -z "$(git status --porcelain 2>/dev/null)" ] || exit 0

# 현재 브랜치에 업스트림이 있고 fast-forward 가능할 때만 당긴다.
git pull --ff-only 2>/dev/null || true

exit 0
