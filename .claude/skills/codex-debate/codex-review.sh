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
