#!/bin/bash
# Mirror Claude Code memory files after Write, Edit or MultiEdit. Installed by engram setup.
# Fail open on missing files, tools or API errors so the edit can finish.

DEFAULT_API='__API_BASE__'
ENGRAM_API="${ENGRAM_API:-$DEFAULT_API}"
NAMESPACE_MODE=__NAMESPACE_MODE__
PROJECT=__NAMESPACE__
# An older `engram update` leaves these two unrendered: behave as project mode.
[ "$NAMESPACE_MODE" = "__NAMESPACE""_MODE__" ] && NAMESPACE_MODE=project
[ "$PROJECT" = "__NAME""SPACE__" ] && PROJECT=""

command -v jq >/dev/null 2>&1 || { printf '%s\n' 'Engram memory-mirror hook requires jq' >&2; exit 0; }

set -o pipefail
INPUT=$(cat) || exit 0
FILE=$(printf '%s' "$INPUT" | jq -er '.tool_input.file_path | strings') || exit 0
[[ "$FILE" =~ /\.claude/projects/[^/]+/memory/[^/]*\.md$ ]] || exit 0
BASENAME=${FILE##*/}
[ "$BASENAME" != MEMORY.md ] && [ -f "$FILE" ] && [ ! -L "$FILE" ] || exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd | if . == null then "" elif type == "string" then . else error("invalid cwd") end') || exit 0
case "$NAMESPACE_MODE" in
  project)
    if [ -z "$PROJECT" ]; then
      CWD=$(cd -- "${CWD:-.}" 2>/dev/null && pwd -L) || exit 0
      git_cmd=(git)
      if command -v timeout >/dev/null 2>&1; then git_cmd=(timeout 0.5 git); fi
      if common_dir=$("${git_cmd[@]}" -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) &&
          [[ "$common_dir" = /* || "$common_dir" = [A-Za-z]:/* ]]; then
        if [[ $("${git_cmd[@]}" --git-dir "$common_dir" rev-parse --is-bare-repository 2>/dev/null) = true ]]; then
          PROJECT="$common_dir"
        elif [[ "$common_dir" = */.git ]]; then
          PROJECT="${common_dir%/.git}"
        fi
      fi
      if [ -z "$PROJECT" ]; then
        PROJECT=$("${git_cmd[@]}" -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || PROJECT=""
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

# The project directory distinguishes same-named files even in a shared namespace.
BODY=$(jq -cne --rawfile content "$FILE" --arg name "$BASENAME" \
  --arg file "${FILE##*/.claude/projects/}" --arg ns "$PROJECT" '
  select($content | length > 0)
  | {content:$content, type:"semantic", source:"claude-code",
     tags:["memory-file", ("memory-file:" + $name)], metadata:{claudeMemoryFile:$file}}
  + if $ns == "" then {} else {namespace:$ns} end') || exit 0
curl -fsS --max-time 5 -X POST "${ENGRAM_API}/api/memory" \
  -H "Content-Type: application/json" -H @/dev/fd/3 --data-binary @- \
  3<<<"${ENGRAM_API_KEY:+Authorization: Bearer $ENGRAM_API_KEY}" <<<"$BODY" >/dev/null || true
exit 0
