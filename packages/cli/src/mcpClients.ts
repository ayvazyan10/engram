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

import fs from 'node:fs';
import { globalRulesPath } from '@engram-ai-memory/core/global-rules';
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

/** Global instruction files for the selected client and clients present on disk. */
export function globalRulesFiles(home: string, source = ''): string[] {
  const selected = resolveMcpClient(source, home).id;
  const files = KNOWN_CLIENTS.flatMap((client) => {
    const file = globalRulesPath(client.id, home);
    if (!file) return [];
    const config = path.join(home, ...client.relativePath);
    const dir = client.id === 'claude-code' ? path.join(home, '.claude') : path.dirname(config);
    const rulesDir = client.id === 'codex' ? path.dirname(file) : dir;
    const selectedForRules = client.id === selected && client.id !== 'windsurf';
    if (!selectedForRules && !fs.existsSync(rulesDir) && !fs.existsSync(config)) return [];
    return [file];
  });
  const cline = path.join(home, 'Documents', 'Cline');
  const clineRules = globalRulesPath('cline', home);
  return clineRules && [cline, path.join(home, '.cline'), path.join(home, 'Cline')].some(dir => fs.existsSync(dir))
    ? [...files, clineRules] : files;
}

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
export function mcpServerConfig(config: EngramConfig, source: string, useNpx = false, globalRules = true): McpServerConfig {
  const env: Record<string, string> = {
    ENGRAM_DB_PATH: config.dbPath,
    ENGRAM_SOURCE: resolveMcpClient(source, '').id,
    ...(!globalRules ? { ENGRAM_GLOBAL_RULES: '0' } : {}),
    ENGRAM_NAMESPACE_MODE: config.namespaceMode,
    ...(config.namespace ? { ENGRAM_NAMESPACE: config.namespace } : {}),
  };
  return useNpx
    ? { command: 'npx', args: ['-y', '@engram-ai-memory/mcp@latest'], env }
    : { command: 'node', args: [path.resolve(config.repoPath, 'packages', 'mcp', 'dist', 'server.js')], env };
}

/** Read statement boundaries without mistaking multiline values for tables. */
function codexTomlStatements(lines: string[]) {
  const statements: {
    start: number; end: number; header: boolean; path: string[]; table: string[]; comments: string[];
  }[] = [];
  let table: string[] = [];
  let quote = '';
  let depth = 0;
  let start = -1;
  let firstLine = '';
  let keyEnd = -1;
  let comments: string[] = [];
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!;
    if (start < 0) {
      if (/^\s*(?:#.*)?$/.test(line)) continue;
      start = row;
      firstLine = line;
      keyEnd = -1;
      comments = [];
    }
    for (let col = 0; col < line.length; col++) {
      const char = line[col]!;
      if (quote) {
        if (quote[0] === '"' && char === '\\') { col++; continue; }
        if (line.startsWith(quote, col)) {
          if (quote.length === 3) {
            // A multiline string can end with one or two extra literal quotes.
            while (line[col + 1] === quote[0]) col++;
          }
          quote = '';
        }
        continue;
      }
      if (char === '#') {
        comments.push(line.slice(col));
        if (row === start) firstLine = line.slice(0, col);
        break;
      }
      if (char === '"' || char === "'") {
        quote = line.startsWith(char.repeat(3), col) ? char.repeat(3) : char;
        col += quote.length - 1;
      } else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') depth--;
      else if (char === '=' && row === start && keyEnd < 0) keyEnd = col;
    }
    if (quote || depth !== 0) continue;
    const text = firstLine.trim();
    const header = text.startsWith('[');
    const rawPath = header ? text.slice(text.startsWith('[[') ? 2 : 1, text.endsWith(']]') ? -2 : -1)
      : lines[start]!.slice(0, keyEnd);
    if (!header && keyEnd < 0) throw new Error('Cannot update Codex config: unrecognised TOML statement');
    const parts = rawPath.match(/[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*'/g) ?? [];
    const keyPath = parts.map((part) => part.startsWith('"') ? JSON.parse(part) as string
      : part.startsWith("'") ? part.slice(1, -1) : part);
    if (header) table = keyPath;
    statements.push({ start, end: row, header, path: keyPath, table, comments });
    start = -1;
  }
  if (start >= 0) throw new Error('Cannot update Codex config: unterminated TOML string or array');
  return statements;
}

/** Include inline/dotted registrations when doctor checks for Engram. */
export function hasCodexMcp(contents: string): boolean {
  return codexTomlStatements(contents.split(/\r?\n/)).some((statement) => {
    const keyPath = statement.header ? statement.path : [...statement.table, ...statement.path];
    return keyPath[0] === 'mcp_servers' && keyPath[1] === 'engram';
  });
}

/** Update managed values in place, preserving other keys and comments. */
export function upsertCodexMcp(contents: string, server: McpServerConfig): string {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  const statements = codexTomlStatements(lines);
  for (const statement of statements) {
    if (statement.header) continue;
    const keyPath = [...statement.table, ...statement.path];
    if (keyPath[0] === 'mcp_servers' && (keyPath[1] === 'engram' && statement.table.length < 2
      || statement.table.length === 0 && statement.path.length === 1)) {
      throw new Error('Cannot update Codex config: Engram or mcp_servers is defined inline or with dotted keys. Move Engram to [mcp_servers.engram] before running setup.');
    }
  }
  const env = Object.entries(server.env).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`);
  const managed = new Map([
    ['command', JSON.stringify(server.command)],
    ['args', `[${server.args.map((arg) => JSON.stringify(arg)).join(', ')}]`],
    ['env', `{ ${env.join(', ')} }`],
  ]);
  const engram = statements.filter((s) => s.table[0] === 'mcp_servers' && s.table[1] === 'engram');
  const root = engram.find((s) => s.header && s.table.length === 2);
  const envTable = engram.find((s) => s.header && s.table.length === 3 && s.table[2] === 'env');
  const dottedEnv = engram.some((s) => !s.header && s.table.length === 2 && s.path.length === 2 && s.path[0] === 'env');
  const envValues = new Map(Object.entries(server.env).map(([key, value]) => [key, JSON.stringify(value)]));
  if (envTable || dottedEnv) managed.delete('env');
  const replacements = new Map<number, { end: number; lines: string[] }>();
  const insertions = new Map<number, string[]>();
  const replace = (statement: (typeof statements)[number], key: string, value: string) => {
    replacements.set(statement.start, {
      end: statement.end,
      lines: [`${key} = ${value}${statement.comments[0] ? ` ${statement.comments[0]}` : ''}`, ...statement.comments.slice(1)],
    });
  };
  for (const statement of engram) {
    if (statement.header) continue;
    const key = statement.path[0]!;
    if (statement.table.length === 2 && statement.path.length === 1 && managed.has(key)) {
      if (key === 'env') {
        const inline = lines.slice(statement.start, statement.end + 1).join('\n')
          .match(/^[^=]*=\s*\{([\s\S]*)$/)?.[1];
        const existing = new Map<string, string>();
        let remaining = inline?.trim() ?? '';
        while (!/^\}\s*(?:#.*)?$/.test(remaining)) {
          const pair = remaining.match(/^([A-Za-z0-9_-]+|"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*=\s*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*(?:,\s*(?=[^\s}])|(?=\}))/);
          if (!pair) throw new Error('Cannot update Codex config: move the inline env entries to [mcp_servers.engram.env] before running setup.');
          const rawKey = pair[1]!;
          const envKey = rawKey.startsWith('"') ? JSON.parse(rawKey) as string
            : rawKey.startsWith("'") ? rawKey.slice(1, -1) : rawKey;
          existing.set(envKey, pair[2]!);
          remaining = remaining.slice(pair[0].length).trim();
        }
        const merged = new Map([...existing, ...envValues]);
        managed.set('env', `{ ${[...merged].map(([name, value]) => `${JSON.stringify(name)} = ${value}`).join(', ')} }`);
      }
      replace(statement, key, managed.get(key)!);
      managed.delete(key);
    } else {
      const envKey = statement.table.length === 3 && statement.table[2] === 'env' && statement.path.length === 1 ? key
        : statement.table.length === 2 && statement.path.length === 2 && key === 'env' ? statement.path[1] : undefined;
      if (envKey !== undefined && envValues.has(envKey)) {
        replace(statement, `${statement.table.length === 2 ? 'env.' : ''}${JSON.stringify(envKey)}`, envValues.get(envKey)!);
        envValues.delete(envKey);
      }
    }
  }
  const insert = (header: (typeof statements)[number], additions: string[]) => {
    if (!additions.length) return;
    let at = statements.find((s) => s.header && s.start > header.start)?.start ?? lines.length;
    // Leave a comment/blank block attached to the following table.
    while (at > header.end + 1 && /^\s*(?:#.*)?$/.test(lines[at - 1]!)) at--;
    insertions.set(at, [...(insertions.get(at) ?? []), ...additions]);
  };
  const additions = [...managed].map(([key, value]) => `${key} = ${value}`);
  if (envTable) insert(envTable, [...envValues].map(([key, value]) => `${JSON.stringify(key)} = ${value}`));
  else if (dottedEnv) additions.push(...[...envValues].map(([key, value]) => `env.${JSON.stringify(key)} = ${value}`));
  if (root) insert(root, additions);
  const output: string[] = [];
  for (let row = 0; row < lines.length; row++) {
    output.push(...(insertions.get(row) ?? []));
    const replacement = replacements.get(row);
    if (replacement) {
      output.push(...replacement.lines);
      row = replacement.end;
    } else output.push(lines[row]!);
  }
  output.push(...(insertions.get(lines.length) ?? []));
  const next = output.join(newline);
  if (root) return next;
  const table = ['[mcp_servers.engram]', ...additions, ''].join(newline);
  return next + (next.endsWith(newline + newline) || !next ? ''
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
