#!/bin/bash
# Engram auto-store hook — saves conversation summary to engram on session end
# Reads transcript, extracts key assistant messages, stores as episodic memory

set -e

ENGRAM_API="${ENGRAM_API:-http://localhost:4901}"
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Skip if no transcript
[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

# Extract assistant messages from transcript (last 2000 chars of conversation)
SUMMARY=$(jq -r '
  select(.type == "message" and .message.role == "assistant")
  | .message.content
  | if type == "array" then map(select(.type == "text") | .text) | join(" ") else . end
' "$TRANSCRIPT_PATH" 2>/dev/null | tail -c 2000 | tr '\n' ' ' | sed 's/"/\\"/g')

# Skip if empty
[ ${#SUMMARY} -lt 20 ] && exit 0

# Truncate to 1500 chars
SUMMARY="${SUMMARY:0:1500}"

# Store to engram
curl -s -X POST "${ENGRAM_API}/api/memory" \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"Claude Code session ${SESSION_ID:-unknown}: ${SUMMARY}\",
    \"type\": \"episodic\",
    \"source\": \"claude-code\",
    \"importance\": 0.7,
    \"tags\": [\"session\", \"auto-stored\"]
  }" >/dev/null 2>&1 || true

exit 0
