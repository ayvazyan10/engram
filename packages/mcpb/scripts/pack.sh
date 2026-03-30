#!/usr/bin/env bash
# Packages the Engram MCP Desktop Extension into engram-mcp.mcpb
# Run from the repo root: pnpm --filter @engram-ai-memory/desktop-extension pack
# Or directly: bash packages/mcpb/scripts/pack.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCPB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$MCPB_DIR/engram-mcp.mcpb"

echo "==> Validating manifest..."
if command -v mcpb &>/dev/null; then
  mcpb validate "$MCPB_DIR/manifest.json"
else
  echo "    mcpb CLI not found — skipping validation (install: npm i -g @anthropic-ai/mcpb)"
fi

echo "==> Packing bundle..."
if command -v mcpb &>/dev/null; then
  mcpb pack "$MCPB_DIR" --output "$OUT"
else
  # Fallback: build zip manually using Python (mcpb format is a ZIP)
  TMP="$(mktemp -d)"
  cp "$MCPB_DIR/manifest.json" "$TMP/manifest.json"
  cp -r "$MCPB_DIR/server" "$TMP/server"
  [ -f "$MCPB_DIR/icon.png" ] && cp "$MCPB_DIR/icon.png" "$TMP/icon.png"
  python3 -c "
import zipfile, os, sys
src, out = sys.argv[1], sys.argv[2]
skip = {'.DS_Store'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in {'__pycache__', '.git'}]
        for f in files:
            if f not in skip:
                fp = os.path.join(root, f)
                z.write(fp, os.path.relpath(fp, src))
" "$TMP" "$OUT"
  rm -rf "$TMP"
fi

echo "==> Done: $OUT"
ls -lh "$OUT"
