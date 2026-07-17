#!/bin/bash
# Engram auto-store hook — saves conversation summary on session end.
# Works without the REST server — uses NeuralBrain directly via store-session.
#
# Install: add to your AI client's session-end hook configuration.
# Env: ENGRAM_DB_PATH (defaults to ~/.engram/engram.db)
#      ENGRAM_SOURCE (defaults to mcp-client)

set -e

INPUT=$(cat)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

SUMMARY=$(jq -r '
  select(.type == "message" and .message.role == "assistant")
  | .message.content
  | if type == "array" then map(select(.type == "text") | .text) | join(" ") else . end
' "$TRANSCRIPT_PATH" 2>/dev/null | tail -c 2000 | tr '\n' ' ' | sed 's/"/\\"/g')

[ ${#SUMMARY} -lt 20 ] && exit 0

SUMMARY="${SUMMARY:0:1500}"

export ENGRAM_DB_PATH="${ENGRAM_DB_PATH:-$HOME/.engram/engram.db}"
export ENGRAM_SOURCE="${ENGRAM_SOURCE:-mcp-client}"

npx -y @engram-ai-memory/mcp engram-store-session "Session summary: ${SUMMARY}" 2>/dev/null || true

exit 0
