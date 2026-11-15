#!/bin/bash
# Engram SessionStart context from the local MCP installation. Fail open.
env __MCP_ENV__ \
  node __REPO_PATH__/packages/mcp/dist/session-start.js || true
exit 0
