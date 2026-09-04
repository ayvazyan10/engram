/**
 * Where an MCP registration has to be written for a client to load it.
 *
 * `engram setup` wrote ~/.mcp.json and printed "MCP configured" and
 * "Engram installed successfully!". No client reads that file: Claude Code
 * reads `.mcp.json` from the PROJECT directory and user-scope servers from
 * ~/.claude.json, Cursor reads ~/.cursor/mcp.json, Windsurf reads
 * ~/.codeium/windsurf/mcp_config.json. `engram setup --source cursor
 * --no-claude-hooks` therefore registered nothing at all and said it had
 * succeeded — and `engram doctor` validated the same dead file.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveMcpClient, manualSnippet, LEGACY_GLOBAL_MCP_FILE, KNOWN_CLIENT_IDS } from '../mcpClients.js';

const HOME = '/home/tester';

describe('resolveMcpClient', () => {
  it('sends Claude Code to the user-scope file it actually loads', () => {
    const target = resolveMcpClient('claude-code', HOME);
    expect(target.kind).toBe('file');
    if (target.kind === 'file') {
      expect(target.path).toBe(path.join(HOME, '.claude.json'));
      expect(target.key).toBe('mcpServers');
    }
  });

  it('sends Cursor and Windsurf to their own config files', () => {
    const cursor = resolveMcpClient('cursor', HOME);
    expect(cursor.kind === 'file' && cursor.path).toBe(path.join(HOME, '.cursor', 'mcp.json'));

    const windsurf = resolveMcpClient('windsurf', HOME);
    expect(windsurf.kind === 'file' && windsurf.path)
      .toBe(path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'));
  });

  it('accepts the spellings people actually type', () => {
    for (const alias of ['claude', 'Claude-Code', 'CLAUDE_CODE', 'claudecode']) {
      const target = resolveMcpClient(alias, HOME);
      expect(target.kind, alias).toBe('file');
      expect(target.kind === 'file' && target.path, alias).toBe(path.join(HOME, '.claude.json'));
    }
  });

  it('never invents a path for a client it does not know', () => {
    for (const unknown of ['mcp-client', 'cline', 'zed', 'my-own-agent', '']) {
      const target = resolveMcpClient(unknown, HOME);
      expect(target.kind, unknown).toBe('manual');
    }
  });

  it('never resolves to the file nothing reads', () => {
    for (const id of KNOWN_CLIENT_IDS) {
      const target = resolveMcpClient(id, HOME);
      expect(target.kind === 'file' && target.path, id).not.toBe(path.join(HOME, LEGACY_GLOBAL_MCP_FILE));
    }
  });
});

describe('manualSnippet', () => {
  const server = { command: 'node', args: ['/home/tester/.engram/repo/packages/mcp/dist/server.js'] };

  it('prints a snippet the user can paste, with the server nested under mcpServers', () => {
    const snippet = manualSnippet(server);
    const parsed = JSON.parse(snippet) as { mcpServers: { engram: unknown } };
    expect(parsed.mcpServers.engram).toEqual(server);
  });

  it('is formatted for a human to read, not minified', () => {
    expect(manualSnippet(server)).toContain('\n');
  });
});
