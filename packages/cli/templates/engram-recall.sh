#!/bin/bash
# Engram auto-recall hook (Claude Code UserPromptSubmit) — installed by `engram setup`.
#
# On every real user prompt, semantically recall relevant long-term memories from
# the running Engram server and inject them as background context. This is the
# retrieval half of automatic memory; engram-session-end.sh is the store half.
#
# Fail-open: any error (server down, slow, bad JSON) injects nothing and never
# blocks the prompt. Relevance-gated so unrelated prompts stay clean.
#
# Tunables: ENGRAM_API, ENGRAM_RECALL_MIN_SIM.

ENGRAM_API="${ENGRAM_API:-__API_BASE__}"
MIN_SIM="${ENGRAM_RECALL_MIN_SIM:-0.5}"

command -v jq >/dev/null 2>&1 || { printf '%s\n' 'Engram recall hook requires jq' >&2; exit 0; }

set -o pipefail
INPUT=$(cat) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd | if . == null then "" elif type == "string" then . else error("invalid cwd") end') || exit 0
PROJECT=""
[ -n "$CWD" ] && { PROJECT=$(timeout 0.5 git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""; }
PROMPT=$(printf '%s' "$INPUT" | jq -er '.prompt | if type == "string" then . else error("invalid prompt") end') || exit 0

# Skip trivial prompts, slash-commands and bash passthrough (!).
[ "${#PROMPT}" -lt 12 ] && exit 0
case "$PROMPT" in /*|!*) exit 0 ;; esac

BODY=$(jq -n --arg q "$PROMPT" --arg ns "$PROJECT" '
  {query:$q, maxTokens:600, touch:false} + if $ns == "" then {} else {namespace:$ns} end') || exit 0
RES=$(curl -fsS --max-time 3 -X POST "${ENGRAM_API}/api/recall" \
  -H "Content-Type: application/json" -d "$BODY") || exit 0
[ -z "$RES" ] && exit 0
if [ -n "$PROJECT" ]; then
  BODY=$(jq -n --arg q "$PROMPT" '{query:$q, maxTokens:600, global:true, touch:false}') || exit 0
  GLOBAL=$(curl -fsS --max-time 3 -X POST "${ENGRAM_API}/api/recall" \
    -H "Content-Type: application/json" -d "$BODY") || exit 0
  RES=$(jq -en --argjson project "$RES" --argjson shared "$GLOBAL" '
    [$project, $shared] | map(.memories | if type == "array" then . else error("invalid memories") end)
    | {memories: add}
  ') || exit 0
fi

# Apply the same per-memory gate and formatting inside and outside git.
OUT=$(printf '%s' "$RES" | jq -c --argjson min "$MIN_SIM" '
  if ($min | type) != "number" then error("invalid MIN_SIM") else . end
  | .memories | if type == "array" then . else error("invalid memories") end
  | map(
      (.similarity // .score // 0) as $score
      | if ($score | type) != "number" then error("invalid similarity") else . end
      | select($score >= $min)
      | (.memory // .) as $memory
      | ($memory.summary // $memory.content) as $text
      | if ($text | type) != "string" then error("invalid memory text") else . end
      | select(($text | length) > 0)
      | {id:$memory.id, createdAt:$memory.createdAt, content:($memory.content // $text), text:$text, score:$score})
  | sort_by(.score) | reverse
  | reduce .[] as $m ([]; if any(.[]; .content == $m.content or (.id != null and .id == $m.id))
      then . else . + [$m] end)
  | .[:3]
  | map(
      (if (.id | type) == "string" and (.id | length) > 0 and (.createdAt | type) == "string"
        then if (.createdAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}"))
          then "[" + .id[:8] + " · " + .createdAt[:10] + "] " else "" end
        else "" end) + (.text | gsub("[\r\n]+"; " ")))
  | join("\n") as $ctx
  | if ($ctx | length) > 0
    then { hookSpecificOutput: {
             hookEventName: "UserPromptSubmit",
             additionalContext: (
               "Relevant long-term memories, auto-recalled from engram for this prompt "
               + "(background context — verify before relying on it):\n\n"
               + ($ctx[0:2500]) ) } }
    else empty end
') || exit 0

[ -n "$OUT" ] && printf '%s' "$OUT"
exit 0
