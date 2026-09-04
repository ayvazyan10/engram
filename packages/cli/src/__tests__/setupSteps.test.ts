/**
 * The steps `engram setup` and `engram update` actually perform, against a
 * temporary HOME.
 *
 * Two of them were reported as done when they were not: the MCP registration
 * (written to ~/.mcp.json, which no client reads) and the build (reported "up
 * to date" from git state alone). Both are exercised here end to end — the file
 * a client would load has to come out with the server in it, and a checkout
 * that was never built has to be reported as not built.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  shortHead,
  checkPrerequisites,
  recordBuild,
  currentBuildStatus,
  configureMcpClient,
  setupClaudeCode,
  CLAUDE_PATHS,
} from '../setupSteps.js';
import { buildArtifactPaths, parseBuildStamp } from '../buildState.js';
import { defaultConfig } from '../engramConfig.js';

let printed: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  printed = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `engram-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

const output = (): string => printed.join('\n');

/** A git repository with one commit, so shortHead has something to answer. */
function gitRepo(): string {
  const dir = tempDir('repo');
  const run = (...args: string[]): void => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  };
  run('init', '-q');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), 'engram');
  run('add', '.');
  run('commit', '-qm', 'initial');
  return dir;
}

describe('shortHead', () => {
  it('reads the revision of a real checkout', () => {
    const head = shortHead(gitRepo());
    expect(head).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('answers null — quietly, when asked — for a directory that is not a repository', () => {
    expect(shortHead(tempDir('norepo'), { quiet: true })).toBeNull();
    expect(output()).toBe('');
  });
});

describe('checkPrerequisites', () => {
  it('passes on the Node running these tests and says which version it found', () => {
    expect(checkPrerequisites(false)).toBe(true);
    expect(output()).toContain(process.versions.node);
  });

  it('checks git and pnpm too when the repository will be cloned and built', () => {
    // This workspace is built with both, so they are present here; what matters
    // is that they are checked at all — setup used to find out much later.
    checkPrerequisites(true);
    expect(output()).toMatch(/git/);
    expect(output()).toMatch(/pnpm/);
  });
});

describe('recordBuild / currentBuildStatus', () => {
  it('reports a checkout with no build as not built, naming what is missing', () => {
    const repo = gitRepo();
    const stamp = path.join(tempDir('home'), 'build.json');

    const status = currentBuildStatus(repo, stamp);
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toContain('apps/server/dist/index.js');
  });

  it('reports a completed build as current, and an interrupted one as not', () => {
    const repo = gitRepo();
    const stamp = path.join(tempDir('home'), 'build.json');
    for (const artifact of buildArtifactPaths(repo)) {
      fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
      fs.writeFileSync(artifact.path, '// built');
    }

    // Artifacts alone are not enough: this is the state left behind by an
    // update that moved the checkout and then died in `pnpm install`.
    expect(currentBuildStatus(repo, stamp).current).toBe(false);
    expect(currentBuildStatus(repo, stamp).reasons.join('\n')).toMatch(/no completed build/i);

    recordBuild(repo, stamp);
    expect(parseBuildStamp(fs.readFileSync(stamp, 'utf8'))?.rev).toBe(shortHead(repo));
    expect(currentBuildStatus(repo, stamp).current).toBe(true);
  });

  it('is not current again once the checkout moves past the recorded build', () => {
    const repo = gitRepo();
    const stamp = path.join(tempDir('home'), 'build.json');
    for (const artifact of buildArtifactPaths(repo)) {
      fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
      fs.writeFileSync(artifact.path, '// built');
    }
    recordBuild(repo, stamp);

    fs.writeFileSync(path.join(repo, 'README.md'), 'moved on');
    spawnSync('git', ['commit', '-aqm', 'second'], { cwd: repo, encoding: 'utf8' });

    const status = currentBuildStatus(repo, stamp);
    expect(status.current).toBe(false);
    expect(status.reasons.join('\n')).toMatch(/last completed build was/);
  });
});

describe('configureMcpClient', () => {
  const server = { command: 'node', args: ['/repo/packages/mcp/dist/server.js'] };

  it('writes the file the named client actually loads', () => {
    const home = tempDir('home');
    const skipped: string[] = [];

    configureMcpClient('cursor', server, home, skipped);

    const written = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(written.mcpServers.engram).toEqual(server);
    expect(skipped).toEqual([]);
    expect(output()).toContain(path.join(home, '.cursor', 'mcp.json'));
  });

  it('registers Claude Code at user scope, not in a project-scope file', () => {
    const home = tempDir('home');
    configureMcpClient('claude-code', server, home, []);

    expect(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.engram).toEqual(server);
    // ~/.mcp.json is the file setup used to write and nothing reads.
    expect(fs.existsSync(path.join(home, '.mcp.json'))).toBe(false);
  });

  it('keeps other servers already registered with that client', () => {
    const home = tempDir('home');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }),
    );

    configureMcpClient('cursor', server, home, []);

    const written = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(written.mcpServers.other).toEqual({ command: 'other-server' });
    expect(written.mcpServers.engram).toEqual(server);
  });

  it('writes nothing at all for a client it does not know, and records it as skipped', () => {
    const home = tempDir('home');
    const skipped: string[] = [];

    configureMcpClient('mcp-client', server, home, skipped);

    expect(fs.readdirSync(home)).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('mcp-client');
    // It has to hand back something the user can act on instead.
    expect(output()).toContain('"mcpServers"');
  });

  it('refuses to overwrite a config file it cannot parse', () => {
    const home = tempDir('home');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{ this is not json');
    const skipped: string[] = [];

    configureMcpClient('cursor', server, home, skipped);

    expect(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8')).toBe('{ this is not json');
    expect(skipped).toHaveLength(1);
  });
});

describe('setupClaudeCode', () => {
  /** A repo layout with the real hook templates, as setup would have cloned. */
  function repoWithTemplates(): string {
    const repo = tempDir('repo-templates');
    const templates = path.join(repo, 'packages', 'cli', 'templates');
    fs.mkdirSync(templates, { recursive: true });
    const source = path.join(__dirname, '..', '..', 'templates');
    for (const file of fs.readdirSync(source)) {
      fs.copyFileSync(path.join(source, file), path.join(templates, file));
    }
    return repo;
  }

  function claudePathsIn(home: string): { dir: string; settings: string; userJson: string } {
    return {
      dir: path.join(home, '.claude'),
      settings: path.join(home, '.claude', 'settings.json'),
      userJson: path.join(home, '.claude.json'),
    };
  }

  it('does nothing when Claude Code is not installed', () => {
    const home = tempDir('home');
    const skipped: string[] = [];

    setupClaudeCode(defaultConfig(home), {}, true, path.join(home, 'hooks'), claudePathsIn(home), skipped);

    expect(fs.existsSync(path.join(home, '.claude.json'))).toBe(false);
    expect(skipped).toEqual([]);
    expect(output()).toMatch(/not detected/i);
  });

  it('registers the server at user scope and installs both hooks', () => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    const hooksDir = path.join(home, '.engram', 'hooks');
    const config = { ...defaultConfig(path.join(home, '.engram')), repoPath: repoWithTemplates(), port: 4901 };
    const server = { command: 'node', args: ['/repo/packages/mcp/dist/server.js'] };

    setupClaudeCode(config, server, true, hooksDir, paths, []);

    expect(JSON.parse(fs.readFileSync(paths.userJson, 'utf8')).mcpServers.engram).toEqual(server);

    const settings = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
    const commands = Object.values(settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(fs.existsSync(command)).toBe(true);
      // The API base placeholder has to be substituted, or the hook posts nowhere.
      expect(fs.readFileSync(command, 'utf8')).not.toContain('__API_BASE__');
      expect(fs.readFileSync(command, 'utf8')).toContain('http://localhost:4901');
    }
  });

  it('registers the MCP server but no hooks in npx mode', () => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir, { recursive: true });

    setupClaudeCode(defaultConfig(home), { command: 'npx' }, false, path.join(home, 'hooks'), paths, []);

    expect(JSON.parse(fs.readFileSync(paths.userJson, 'utf8')).mcpServers.engram).toEqual({ command: 'npx' });
    expect(fs.existsSync(paths.settings)).toBe(false);
    expect(output()).toMatch(/npx mode has no local server/);
  });

  it('reports — and does not overwrite — a ~/.claude.json it cannot parse', () => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.userJson, '{ "oauthAccount": ');
    const skipped: string[] = [];

    setupClaudeCode(defaultConfig(home), {}, true, path.join(home, 'hooks'), paths, skipped);

    expect(fs.readFileSync(paths.userJson, 'utf8')).toBe('{ "oauthAccount": ');
    expect(skipped).toHaveLength(1);
  });

  it('reports missing hook templates instead of registering hooks that are not there', () => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    const skipped: string[] = [];

    // repoPath points at a directory with no templates/ — a broken checkout.
    setupClaudeCode(
      { ...defaultConfig(home), repoPath: tempDir('empty-repo') },
      {}, true, path.join(home, 'hooks'), paths, skipped,
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/hooks/i);
    expect(fs.existsSync(paths.settings)).toBe(false);
  });
});

describe('CLAUDE_PATHS', () => {
  it('points at the files Claude Code really reads', () => {
    expect(CLAUDE_PATHS.userJson).toBe(path.join(os.homedir(), '.claude.json'));
    expect(CLAUDE_PATHS.settings).toBe(path.join(os.homedir(), '.claude', 'settings.json'));
  });
});
