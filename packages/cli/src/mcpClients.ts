/**
 * Which file an MCP client actually reads.
 *
 * `engram setup` used to write ~/.mcp.json and report "MCP configured". Nothing
 * loads that file:
 *
 *   Claude Code   ~/.claude.json          (user scope; `.mcp.json` is PROJECT scope)
 *   Cursor        ~/.cursor/mcp.json
 *   Windsurf      ~/.codeium/windsurf/mcp_config.json
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
    key: 'mcpServers';
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
    key: 'mcpServers',
    activation: client.activation,
  };
}

/** The block a user pastes into their own client's config. */
export function manualSnippet(server: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: { engram: server } }, null, 2);
}

/** The clients `engram setup --source <name>` can configure by itself. */
export function supportedClientList(): string {
  return KNOWN_CLIENTS.map((c) => c.id).join(', ');
}
