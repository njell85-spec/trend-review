#!/usr/bin/env bash
# ensure-superpowers.sh
# 세션이 시작될 때마다 superpowers 플러그인이 설치·활성화돼 있는지 확인한다.
# - 이미 있으면 즉시 종료(빠름).
# - 없으면(환경 리셋/새 환경 등) 마켓플레이스를 등록하고 설치한다.
# 어떤 경우에도 세션을 방해하지 않도록 조용히, 실패해도 그냥 넘어간다.

set -u

PLUGIN="superpowers@superpowers-marketplace"

# 1) 이미 설치돼 있으면 활성화만 보장하고 끝낸다.
if claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  claude plugin enable "$PLUGIN" >/dev/null 2>&1 || true
  exit 0
fi

# 2) 없으면 마켓플레이스를 등록하고 설치한다(GitHub 출처: obra/superpowers).
claude plugin marketplace add obra/superpowers >/dev/null 2>&1 || true
claude plugin install "$PLUGIN" --scope user >/dev/null 2>&1 || true
claude plugin enable "$PLUGIN" >/dev/null 2>&1 || true

exit 0
