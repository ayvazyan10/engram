/**
 * Whether the checkout in ~/.engram/repo has actually been built, and from
 * which revision.
 *
 * `engram update` used to decide it had nothing to do from git state alone.
 * The sequence that breaks: an update fast-forwards the repository, `pnpm
 * install` fails on a network blip, the command exits 1. The next
 * `engram update` finds git up to date, prints "✓ Already up to date." and
 * exits 0 — with apps/server/dist still missing or built from the previous
 * commit. `engram start` then runs the old server or fails with "Server not
 * found", and nothing points at the rebuild that is actually missing.
 *
 * Two questions answer it: are the entry points the CLI runs on disk, and did a
 * build ever COMPLETE for this revision. The second needs a record, because
 * artifacts from the previous commit look exactly like current ones — hence the
 * stamp, written only after a build finishes.
 */

import path from 'path';

export interface BuildArtifact {
  /** What the user calls this thing when it is missing. */
  readonly label: string;
  readonly path: string;
}

/**
 * The built entry points the CLI itself depends on: the server it starts, the
 * MCP server it registers with AI clients, and the CLI it installs globally.
 */
export function buildArtifactPaths(repoPath: string): readonly BuildArtifact[] {
  return [
    { label: 'API server', path: path.join(repoPath, 'apps', 'server', 'dist', 'index.js') },
    { label: 'MCP server', path: path.join(repoPath, 'packages', 'mcp', 'dist', 'server.js') },
    { label: 'CLI', path: path.join(repoPath, 'packages', 'cli', 'dist', 'cli.js') },
  ];
}

export interface BuildStamp {
  /** Short revision the completed build was made from. */
  readonly rev: string;
  readonly builtAt: string;
}

export function serializeBuildStamp(rev: string, now: Date = new Date()): string {
  return JSON.stringify({ rev, builtAt: now.toISOString() }, null, 2) + '\n';
}

/** Parse a stamp file; anything unreadable counts as "no stamp". */
export function parseBuildStamp(raw: string): BuildStamp | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { rev, builtAt } = parsed as { rev?: unknown; builtAt?: unknown };
    if (typeof rev !== 'string' || rev.length === 0) return null;
    return { rev, builtAt: typeof builtAt === 'string' ? builtAt : '' };
  } catch {
    return null;
  }
}

export interface BuildStatusInput {
  readonly repoPath: string;
  readonly stampPath: string;
  /** Short HEAD of the checkout, or null when git could not say. */
  readonly headRev: string | null;
  readonly exists: (p: string) => boolean;
  readonly readFile: (p: string) => string;
}

export interface BuildStatus {
  readonly current: boolean;
  /** Why not, in the words the CLI prints. Empty when current. */
  readonly reasons: readonly string[];
}

/**
 * Is the build on disk the one this checkout describes?
 *
 * With no readable stamp the honest answer is no: artifacts alone cannot
 * distinguish "built from this commit" from "built from the one before", and
 * that ambiguity is the false success this whole module exists to remove.
 */
export function buildStatus(input: BuildStatusInput): BuildStatus {
  const reasons: string[] = [];

  for (const artifact of buildArtifactPaths(input.repoPath)) {
    if (!input.exists(artifact.path)) reasons.push(`${artifact.label} is not built: ${artifact.path} is missing`);
  }

  const stamp = readStamp(input);
  if (input.headRev === null) {
    // Nothing to compare a stamp against — judge on the artifacts alone rather
    // than sending every user into a rebuild because git was unavailable.
    return { current: reasons.length === 0, reasons };
  }

  if (stamp === null) {
    reasons.push('no completed build is recorded for this checkout');
  } else if (stamp.rev !== input.headRev) {
    reasons.push(`the last completed build was ${stamp.rev}, the checkout is at ${input.headRev}`);
  }

  return { current: reasons.length === 0, reasons };
}

function readStamp(input: BuildStatusInput): BuildStamp | null {
  if (!input.exists(input.stampPath)) return null;
  try {
    return parseBuildStamp(input.readFile(input.stampPath));
  } catch {
    return null;
  }
}
