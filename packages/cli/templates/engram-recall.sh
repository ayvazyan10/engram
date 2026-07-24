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
MIN_SIM="${ENGRAM_RECALL_MIN_SIM:-0.35}"

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# Skip trivial prompts, slash-commands and bash passthrough (!).
[ "${#PROMPT}" -lt 12 ] && exit 0
case "$PROMPT" in /*|!*) exit 0 ;; esac

RES=$(curl -s --max-time 3 -X POST "${ENGRAM_API}/api/recall" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg q "$PROMPT" '{query:$q, maxTokens:600}')" 2>/dev/null) || exit 0
[ -z "$RES" ] && exit 0

# All gating + formatting in jq (no shell float math): inject only when the best
# match clears MIN_SIM and a context block exists.
OUT=$(printf '%s' "$RES" | jq -c --argjson min "$MIN_SIM" '
  ([.memories[]? | (.similarity // .score // 0)] | max // 0) as $top
  | (.context // "") as $ctx
  | if ($top >= $min) and (($ctx | length) > 0)
    then { hookSpecificOutput: {
             hookEventName: "UserPromptSubmit",
             additionalContext: (
               "Relevant long-term memories, auto-recalled from engram for this prompt "
               + "(background context — verify before relying on it):\n\n"
               + ($ctx[0:2500]) ) } }
    else empty end
' 2>/dev/null)

[ -n "$OUT" ] && printf '%s' "$OUT"
exit 0
