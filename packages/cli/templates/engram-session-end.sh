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

set -o pipefail
INPUT=$(cat) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty | select(type == "string")' 2>/dev/null) || CWD=""
PROJECT=""
[ -n "$CWD" ] && { PROJECT=$(timeout 0.5 git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""; }
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty | select(type == "string")' 2>/dev/null) || exit 0
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -er '.transcript_path | select(type == "string")' 2>/dev/null) || exit 0

{ [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; } && exit 0

# Concatenate the assistant's text messages, keep the tail (most recent).
SUMMARY=$(jq -r '
  select(.type == "assistant" and .message.role == "assistant")
  | .message.content
  | if type == "array" then map(select(.type == "text") | .text) | join(" ") else . end
' "$TRANSCRIPT" 2>/dev/null | tail -c 2000 | tr '\n' ' ') || exit 0

[ "${#SUMMARY}" -lt 20 ] && exit 0
SUMMARY="${SUMMARY:0:1500}"

# jq builds the body, omitting namespace outside git.
BODY=$(jq -n --arg c "Claude Code session ${SESSION_ID:-unknown}: ${SUMMARY}" --arg ns "$PROJECT" '
  {content:$c, type:"episodic", source:"claude-code", importance:0.6,
   tags:["session","session-summary","auto-stored","pending-distill"]}
  + if $ns == "" then {} else {namespace:$ns} end') || exit 0
curl -fsS --max-time 5 -X POST "${ENGRAM_API}/api/memory" \
  -H "Content-Type: application/json" -d "$BODY" >/dev/null 2>&1 || true
exit 0
