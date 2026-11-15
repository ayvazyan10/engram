#!/bin/bash
# Engram auto-store hook (Claude Code SessionEnd) — installed by `engram setup`.
#
# On session end, save a short summary of the assistant's messages as an episodic
# memory. This is the store half of automatic memory; engram-recall.sh recalls.
#
# Fail-open: report errors on stderr without blocking session teardown.
#
# Tunables: ENGRAM_API.

ENGRAM_API="${ENGRAM_API:-__API_BASE__}"

command -v jq >/dev/null 2>&1 || { printf '%s\n' 'Engram session-end hook requires jq' >&2; exit 0; }

set -o pipefail
INPUT=$(cat) || exit 0
REASON=$(printf '%s' "$INPUT" | jq -r '.reason | if . == null then "" elif type == "string" then . else error("invalid reason") end') || exit 0
case "$REASON" in clear|resume) exit 0 ;; esac
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd | if . == null then "" elif type == "string" then . else error("invalid cwd") end') || exit 0
PROJECT=""
[ -n "$CWD" ] && { PROJECT=$(timeout 0.5 git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""; }
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id | if . == null then "" elif type == "string" then . else error("invalid session_id") end') || exit 0
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -er '.transcript_path | if type == "string" then . else error("invalid transcript_path") end') || exit 0

{ [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; } && exit 0

# Concatenate the assistant's text messages, keep the tail (most recent).
SUMMARY=$(jq -r '
  select(.type == "assistant" and .message.role == "assistant")
  | .message.content
  | if type == "array" then map(select(.type == "text") | .text
      | if type == "string" then . else error("invalid assistant text") end) | join(" ")
    elif type == "string" then . else error("invalid assistant content") end
' "$TRANSCRIPT" | jq -Rrs '.[-2000:] | gsub("\n"; " ") | .[:1500]') || exit 0

[ "${#SUMMARY}" -lt 20 ] && exit 0

# jq builds the body, omitting namespace outside git.
BODY=$(jq -n --arg c "Claude Code session ${SESSION_ID:-unknown}: ${SUMMARY}" --arg ns "$PROJECT" '
  {content:$c, type:"episodic", source:"claude-code", importance:0.3,
   tags:["session","session-summary","auto-stored","pending-distill"]}
  + if $ns == "" then {} else {namespace:$ns} end') || exit 0
curl -fsS --max-time 5 -X POST "${ENGRAM_API}/api/memory" \
  -H "Content-Type: application/json" -d "$BODY" >/dev/null || true
exit 0
