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
# Tunables: ENGRAM_API, ENGRAM_RECALL_MIN_SIM, ENGRAM_SOURCE.

ENGRAM_API="${ENGRAM_API:-__API_BASE__}"
MIN_SIM="${ENGRAM_RECALL_MIN_SIM:-0.5}"
SOURCE="${ENGRAM_SOURCE:-claude-code}"
NAMESPACE_MODE=__NAMESPACE_MODE__
PROJECT=__NAMESPACE__
# An older `engram update` leaves these two unrendered: behave as project mode.
[ "$NAMESPACE_MODE" = "__NAMESPACE""_MODE__" ] && NAMESPACE_MODE=project
[ "$PROJECT" = "__NAME""SPACE__" ] && PROJECT=""

exec 2>/dev/null
command -v jq >/dev/null || exit 0

set -o pipefail
INPUT=$(cat) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd | if . == null then "" elif type == "string" then . else error("invalid cwd") end') || exit 0
case "$NAMESPACE_MODE" in
  project)
    if [ -z "$PROJECT" ]; then
      CWD=$(cd -- "${CWD:-.}" 2>/dev/null && pwd -L) || exit 0
      # Worktrees share the main repository's namespace (common dir <repo>/.git).
      # Anything else (old git echoing --path-format, submodules) uses the top level.
      if command -v timeout >/dev/null 2>&1; then
        if PROJECT=$(timeout 0.5 git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
            [[ ( "$PROJECT" = /* || "$PROJECT" = [A-Za-z]:/* ) && "$PROJECT" = */.git ]]; then
          PROJECT="${PROJECT%/.git}"
        else
          PROJECT=$(timeout 0.5 git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""
        fi
      else
        if PROJECT=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
            [[ ( "$PROJECT" = /* || "$PROJECT" = [A-Za-z]:/* ) && "$PROJECT" = */.git ]]; then
          PROJECT="${PROJECT%/.git}"
        else
          PROJECT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""
        fi
      fi
      if [ -z "$PROJECT" ]; then
        case "$CWD" in /|"$HOME") PROJECT="" ;; *) PROJECT="$CWD" ;; esac
      fi
    fi
    ;;
  filter|isolated) ;;
  none) PROJECT="" ;;
  *) exit 0 ;;
esac
PROMPT=$(printf '%s' "$INPUT" | jq -er '.prompt | if type == "string" then . else error("invalid prompt") end') || exit 0

# Skip trivial prompts, slash-commands and bash passthrough (!).
[ "${#PROMPT}" -lt 12 ] && exit 0
case "$PROMPT" in /*|!*) exit 0 ;; esac
# Messages from other sessions, subagents and background tasks are not the
# user's prompt; their wrapper (sender names, paths) skews similarity too.
# The host may put a line of its own before the tag, so look at the head.
WRAPPER='<(cross-session-message|agent-message|task-notification)[[:space:]>]'
[[ "${PROMPT:0:300}" =~ $WRAPPER ]] && exit 0

# Search returns the stored tags and raw cosine score. Recall drops the tags.
BODY=$(jq -cn --arg q "$PROMPT" --arg ns "$PROJECT" --arg mode "$NAMESPACE_MODE" --argjson min "$MIN_SIM" '
  if ($min | type) != "number" or $min < 0 or $min > 1 then error("invalid MIN_SIM") else . end
  | {query:$q, threshold:$min, topK:20}
  + if $ns != "" then {namespace:$ns} elif $mode == "none" then {}
    elif $mode == "isolated" then error("missing namespace") else {global:true} end') || exit 0
RES=$(curl -fsS --max-time 3 -X POST "${ENGRAM_API}/api/search" \
  -H "Content-Type: application/json" -d "$BODY") || exit 0
[ -z "$RES" ] && exit 0
if [ -n "$PROJECT" ] && [ "$NAMESPACE_MODE" != isolated ]; then
  # Shared knowledge can apply across projects. Episodes belong to their project.
  BODY=$(jq -c 'del(.namespace) + {global:true, types:["semantic","procedural"]}' <<<"$BODY") || exit 0
  GLOBAL=$(curl -fsS --max-time 3 -X POST "${ENGRAM_API}/api/search" \
    -H "Content-Type: application/json" -d "$BODY") || exit 0
  RES=$(printf '%s\n%s\n' "$RES" "$GLOBAL" | jq -esc '
    if length != 2 then error("missing search response") else . end
    | map(.results | if type == "array" then . else error("invalid results") end) | {results:add}
  ') || exit 0
fi

# Apply the same per-memory gate and formatting inside and outside git.
OUT=$(printf '%s' "$RES" | jq -c --argjson min "$MIN_SIM" --arg source "$SOURCE" '
  def transcript: test("^\\s*(user\\s*:|assistant\\s*:|claude code session [^:\\n]+:|session summary\\s*:)"; "i");
  def sim2: (. * 100 | round) as $n | "\(($n / 100) | floor).\(("0" + ($n % 100 | tostring))[-2:])";
  .results | if type == "array" then . else error("invalid results") end
  | map(select((.score | type) == "number" and .score >= $min)
      # Raw transcripts are noise whatever their type (consolidation stores them as semantic).
      | select((.content | transcript | not) and ((.summary // "") | transcript | not))
      | select(.type == "semantic" or .type == "procedural" or
          (.type == "episodic" and .source == $source
           and (((.tags // "[]") | fromjson | any(. == "pending-distill" or . == "session-summary")) | not)))
      | .text = ((.summary // .content) | gsub("[\r\n]+"; " "))
      | select((.text | test("\\S")) and (.id | length) >= 8
          and (.createdAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}"))))
  | sort_by(.score) | reverse
  | reduce .[] as $m ([]; if any(.[]; .content == $m.content or (.id != null and .id == $m.id))
      then . else . + [$m] end)
  | .[:3] | select(length > 0) | length as $count
  | map("[\(.id[:8]) · \(.createdAt[:10]) · sim \(.score | sim2) · \((.source // "unknown") | gsub("[\r\n]+"; " "))] \(.text)"
        | .[:(2498 / $count | floor)])
  | {hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ("Engram already recalled \($count) memories for this prompt; call recall_context/search_memory only for a targeted lookup with a specific query.\n\n" + join("\n"))
    }}
') || exit 0

[ -n "$OUT" ] && printf '%s' "$OUT"
exit 0
