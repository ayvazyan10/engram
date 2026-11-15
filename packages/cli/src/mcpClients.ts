/**
 * Which file an MCP client actually reads.
 *
 * `engram setup` used to write ~/.mcp.json and report "MCP configured". Nothing
 * loads that file:
 *
 *   Claude Code   ~/.claude.json          (user scope; `.mcp.json` is PROJECT scope)
 *   Cursor        ~/.cursor/mcp.json
 *   Windsurf      ~/.codeium/windsurf/mcp_config.json
 *   Codex         ~/.codex/config.toml
 *   OpenCode      ~/.config/opencode/opencode.json
 *
 * So `engram setup --source cursor --no-claude-hooks` printed "MCP configured"
 * and "Engram installed successfully!" having registered Engram with nothing.
 *
 * The list stays deliberately short. Guessing a path for a client whose config
 * location we are not sure of would recreate exactly the bug this replaces — a
 * file written, a success reported, and nothing reading it. Anything not listed
 * gets a printed snippet and an honest "not configured" instead.
 */

import path from 'path';
import type { EngramConfig } from './engramConfig.ts';

/** The file setup used to write. Kept only so `doctor` can call it out. */
export const LEGACY_GLOBAL_MCP_FILE = '.mcp.json';

export type McpClientTarget =
  | {
    kind: 'file';
    id: string;
    label: string;
    /** Absolute path of the config file this client loads. */
    path: string;
    /** Top-level key the server entry goes under. */
    key: 'mcpServers' | 'mcp';
    format: 'json' | 'toml' | 'opencode';
    /** What to tell the user after writing it. */
    activation: string;
  }
  | { kind: 'manual'; id: string };

interface KnownClient {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly relativePath: readonly string[];
  readonly activation: string;
  readonly format?: 'toml' | 'opencode';
}

const KNOWN_CLIENTS: readonly KnownClient[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    aliases: ['claude', 'claudecode', 'claude-code'],
    relativePath: ['.claude.json'],
    activation: 'Restart Claude Code (or run /mcp) to activate.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    aliases: ['cursor'],
    relativePath: ['.cursor', 'mcp.json'],
    activation: 'Restart Cursor to activate.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    aliases: ['windsurf', 'codeium'],
    relativePath: ['.codeium', 'windsurf', 'mcp_config.json'],
    activation: 'Restart Windsurf to activate.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    aliases: ['codex', 'codex-cli'],
    relativePath: ['.codex', 'config.toml'],
    activation: 'Restart Codex CLI to activate.',
    format: 'toml',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    aliases: ['opencode', 'open-code'],
    relativePath: ['.config', 'opencode', 'opencode.json'],
    activation: 'Restart OpenCode to activate.',
    format: 'opencode',
  },
];

export const KNOWN_CLIENT_IDS: readonly string[] = KNOWN_CLIENTS.map((c) => c.id);

/** Normalise the spellings people type into `--source`. */
function normalize(source: string): string {
  return source.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * The config file to write for this `--source`, or `manual` when we do not
 * know one. Never a guess: a wrong path is a silent no-op.
 */
export function resolveMcpClient(source: string, home: string): McpClientTarget {
  const wanted = normalize(source);
  const client = KNOWN_CLIENTS.find((c) => c.aliases.includes(wanted));
  if (!client) return { kind: 'manual', id: source };

  return {
    kind: 'file',
    id: client.id,
    label: client.label,
    path: path.join(home, ...client.relativePath),
    key: client.format === 'opencode' ? 'mcp' : 'mcpServers',
    format: client.format ?? 'json',
    activation: client.activation,
  };
}

export interface McpServerConfig extends Record<string, unknown> {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** One environment for setup, update and the installed SessionStart hook. */
export function mcpServerConfig(config: EngramConfig, source: string, useNpx = false): McpServerConfig {
  const env: Record<string, string> = {
    ENGRAM_DB_PATH: config.dbPath,
    ENGRAM_SOURCE: resolveMcpClient(source, '').id,
    ENGRAM_NAMESPACE_MODE: config.namespaceMode,
    ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
  };
  return useNpx
    ? { command: 'npx', args: ['-y', '@engram-ai-memory/mcp@latest'], env }
    : { command: 'node', args: [path.resolve(config.repoPath, 'packages', 'mcp', 'dist', 'server.js')], env };
}

export const CODEX_ENGRAM_TABLE = /^[ \t]*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:engram|"engram"|'engram')\s*(?:\.|\])/m;

/** Replace only Engram tables, including separated child tables. */
export function upsertCodexMcp(contents: string, server: McpServerConfig): string {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const env = Object.entries(server.env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`);
  const table = [
    '[mcp_servers.engram]',
    `command = ${JSON.stringify(server.command)}`,
    `args = [${server.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
    `env = { ${env.join(', ')} }`, '',
  ].join(newline);
  let replaced = false;
  const next = contents.split(/(?=^[ \t]*\[)/m).map((section) => {
    if (!CODEX_ENGRAM_TABLE.test(section)) return section;
    const replacement = replaced ? '' : table + newline;
    replaced = true;
    return replacement;
  }).join('');
  return replaced ? next : next + (next.endsWith(newline + newline) || !next ? ''
    : next.endsWith(newline) ? newline : newline + newline) + table + newline;
}

/** The block a user pastes into their own client's config. */
export function manualSnippet(server: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: { engram: server } }, null, 2);
}

/** The clients `engram setup --source <name>` can configure by itself. */
export function supportedClientList(): string {
  return KNOWN_CLIENTS.map((c) => c.id).join(', ');
}
