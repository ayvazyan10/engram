#!/bin/bash
# Engram SessionStart context from the local MCP installation. Fail open.
ENGRAM_DB_PATH=__DB_PATH__ ENGRAM_SOURCE=claude-code \
  node __REPO_PATH__/packages/mcp/dist/session-start.js 2>/dev/null || true
exit 0
