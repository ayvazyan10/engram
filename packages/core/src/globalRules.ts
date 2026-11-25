import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The client running an MCP server identifies itself through ENGRAM_SOURCE. */
export function globalRulesPath(source: string, home = os.homedir()): string | undefined {
  switch (source) {
    case 'claude-code': return path.join(home, '.claude', 'CLAUDE.md');
    case 'codex': return path.join(process.env['CODEX_HOME'] || path.join(home, '.codex'), 'AGENTS.md');
    case 'opencode': return path.join(home, '.config', 'opencode', 'AGENTS.md');
    case 'windsurf': return path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md');
    case 'cline': return path.join(home, 'Documents', 'Cline', 'Rules', 'engram.md');
    default: return undefined;
  }
}

const GLOBAL_RULES = `# Memory (Engram)

Engram is this user's long-term memory, shared by every AI tool they use (Claude Code, Codex, Cursor, …).
- ALWAYS store durable facts in Engram with store_memory: decisions and their reasons, conventions, fixes, user preferences, handovers. Not routine chatter.
- NEVER keep a durable fact only in this tool's own memory (e.g. Claude Code memory files, MEMORY.md). That memory is invisible to every other tool. If you save something there, store it in Engram too, in the same turn.
- Before starting work that depends on earlier decisions, recall from Engram (recall_context, search_memory). Recalled memories can be stale — verify before relying on them.
- Correct a stale fact with update_memory; retire one with forget.
- The user's explicit instructions win over this block.`;

export function withGlobalRules(text: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const rules = GLOBAL_RULES.replaceAll('\n', newline);
  const markers = [...text.matchAll(/^[\t \uFEFF]*<!-- engram:(start|end) -->[\t ]*(?=\r?$)/gm)];
  if (!markers.length) {
    const separator = !text || text.endsWith(newline + newline) ? '' : text.endsWith('\n') ? newline : newline + newline;
    return text + separator + ['<!-- engram:start -->', rules, '<!-- engram:end -->', ''].join(newline);
  }
  const [start, end] = markers;
  if (markers.length !== 2 || start?.[1] !== 'start' || end?.[1] !== 'end') {
    throw new Error('Expected one matching pair of Engram rule markers');
  }
  return text.slice(0, start.index + start[0].length) + newline + rules + newline + text.slice(end.index);
}

async function readRules(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Called after MCP connects. All filesystem work yields to the transport. */
export async function ensureGlobalRules(source: string): Promise<void> {
  if (process.env['ENGRAM_GLOBAL_RULES'] === '0') return;
  const file = globalRulesPath(source);
  if (!file) return;

  const original = await readRules(file);
  const next = withGlobalRules(original ?? '');
  if (next === original) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Follow existing dotfile symlinks and preserve edits made while merging.
  const target = original === null ? file : await fs.realpath(file);
  const mode = original === null ? 0o600 : (await fs.stat(target)).mode & 0o777;
  const temp = target + '.engram-' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, next, { flag: 'wx', mode });
    if (original === null) {
      // Publish the complete file only if a user or another server hasn't created it.
      try { await fs.link(temp, target); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || await readRules(file) !== next) throw err;
      }
    } else {
      await fs.chmod(temp, mode);
      const current = await readRules(file);
      if (current === next) return;
      if (current !== original) throw new Error(file + ' changed while updating Engram rules');
      await fs.rename(temp, target);
    }
  } finally {
    await fs.rm(temp, { force: true });
  }
}
