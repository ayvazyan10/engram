#!/bin/bash
# Engram SessionStart context from the local MCP installation. Fail open.
# Older renderers leave the MCP environment placeholder untouched.
MCP_ENV=(__MCP_ENV__)
[ "${MCP_ENV[0]}" = "__MCP_""ENV__" ] && MCP_ENV=(ENGRAM_DB_PATH=__DB_PATH__ ENGRAM_SOURCE=claude-code)
env "${MCP_ENV[@]}" node __REPO_PATH__/packages/mcp/dist/session-start.js || true
exit 0
