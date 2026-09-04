#!/bin/bash
# Engram auto-store hook — saves conversation summary on session end.
# Works without the REST server — uses NeuralBrain directly via store-session.
#
# Install: add to your AI client's session-end hook configuration.
# Env: ENGRAM_DB_PATH (defaults to ~/.engram/engram.db)
#      ENGRAM_SOURCE (defaults to mcp-client)
#      ENGRAM_NAMESPACE_MODE, ENGRAM_NAMESPACE
#
# Anything already exported wins; otherwise the values come from
# ~/.engram/config.json, the file `engram configure` writes. Without that
# lookup the summary was stored with no namespace while the MCP server used
# the configured one — invisible to an isolated brain, and visible to every
# other namespace, which is the opposite of what isolation is for.

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

CONFIG_PATH="${ENGRAM_HOME:-$HOME/.engram}/config.json"

# Read one key from the CLI's config file. Empty when the file is absent or
# unparseable, so a broken config degrades to the defaults below rather than
# aborting the hook.
config_value() {
  [ -f "$CONFIG_PATH" ] || return 0
  jq -r --arg k "$1" '.[$k] // empty' "$CONFIG_PATH" 2>/dev/null || true
}

export ENGRAM_DB_PATH="${ENGRAM_DB_PATH:-$(config_value dbPath)}"
export ENGRAM_DB_PATH="${ENGRAM_DB_PATH:-$HOME/.engram/engram.db}"
export ENGRAM_SOURCE="${ENGRAM_SOURCE:-mcp-client}"

ENGRAM_NAMESPACE="${ENGRAM_NAMESPACE:-$(config_value namespace)}"
ENGRAM_NAMESPACE_MODE="${ENGRAM_NAMESPACE_MODE:-$(config_value namespaceMode)}"
# Only export what has a value: the store-session binary reads a blank string
# as "not configured", but an exported blank still overrides nothing useful,
# and leaving the variables unset keeps its own defaulting in charge.
[ -n "$ENGRAM_NAMESPACE" ] && export ENGRAM_NAMESPACE
[ -n "$ENGRAM_NAMESPACE_MODE" ] && export ENGRAM_NAMESPACE_MODE

npx -y @engram-ai-memory/mcp engram-store-session "Session summary: ${SUMMARY}" 2>/dev/null || true

exit 0
