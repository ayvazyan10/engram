#!/bin/bash
# Engram auto-store hook (Claude Code SessionEnd) — installed by `engram setup`.
#
# On session end, save a short summary of the assistant's messages as an episodic
# memory. This is the store half of automatic memory; engram-recall.sh recalls.
#
# Fail-open: never blocks session teardown; any error is swallowed.
#
# Tunables: ENGRAM_API.

ENGRAM_API="${ENGRAM_API:-__API_BASE__}"

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

{ [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; } && exit 0

# Concatenate the assistant's text messages, keep the tail (most recent).
SUMMARY=$(jq -r '
  select(.type == "message" and .message.role == "assistant")
  | .message.content
  | if type == "array" then map(select(.type == "text") | .text) | join(" ") else . end
' "$TRANSCRIPT" 2>/dev/null | tail -c 2000 | tr '\n' ' ')

[ "${#SUMMARY}" -lt 20 ] && exit 0
SUMMARY="${SUMMARY:0:1500}"

# jq -n builds the JSON body so the content is escaped safely.
curl -s --max-time 5 -X POST "${ENGRAM_API}/api/memory" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg c "Claude Code session ${SESSION_ID:-unknown}: ${SUMMARY}" \
        '{content:$c, type:"episodic", source:"claude-code", importance:0.6, tags:["session","auto-stored"]}')" \
  >/dev/null 2>&1 || true

exit 0
