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
    expect(output()).not.toContain('/plugin');
  });

  it('registers Claude Code at user scope, not in a project-scope file', () => {
    const home = tempDir('home');
    configureMcpClient('claude-code', server, home, []);

    expect(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.engram).toEqual(server);
    // ~/.mcp.json is the file setup used to write and nothing reads.
    expect(fs.existsSync(path.join(home, '.mcp.json'))).toBe(false);
    expect(output()).toContain('Prefer the Claude Code plugin instead (do not use both):');
    expect(output()).toContain('/plugin marketplace add ayvazyan10/engram');
    expect(output()).toContain('/plugin install engram@engram');
  });

  it.each(['claude-code', 'claude', 'claudecode'])('leaves %s MCP to an enabled plugin', (source) => {
    const home = tempDir('home');
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings));
    const before = JSON.stringify({ enabledPlugins: { 'engram@engram': true } });
    fs.writeFileSync(settings, before);
    const skipped: string[] = [];

    configureMcpClient(source, server, home, skipped);

    expect(fs.existsSync(path.join(home, '.claude.json'))).toBe(false);
    expect(fs.readFileSync(settings, 'utf8')).toBe(before);
    expect(skipped).toEqual([]);
    expect(output()).toContain('Engram plugin is active — setup leaves Claude Code MCP and hooks to it.');
    expect(output()).not.toContain('/plugin install');
  });

  it('reports malformed Claude settings before registering MCP', () => {
    const home = tempDir('home');
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings));
    fs.writeFileSync(settings, '{ broken');
    const skipped: string[] = [];

    configureMcpClient('claude-code', server, home, skipped);

    expect(fs.existsSync(path.join(home, '.claude.json'))).toBe(false);
    expect(fs.readFileSync(settings, 'utf8')).toBe('{ broken');
    expect(skipped).toHaveLength(1);
    expect(output()).toContain('Claude Code plugin check skipped');
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

  it.each([undefined, false, 'true'])('registers MCP and both hooks when plugin enabled is %s', (enabled) => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir, { recursive: true });
    if (enabled !== undefined) {
      fs.writeFileSync(paths.settings, JSON.stringify({ enabledPlugins: { 'engram@engram': enabled } }));
    }
    const hooksDir = path.join(home, '.engram', 'hooks');
    const config = { ...defaultConfig(path.join(home, '.engram')), repoPath: repoWithTemplates(), port: 4901 };
    const server = { command: 'node', args: ['/repo/packages/mcp/dist/server.js'] };

    setupClaudeCode(config, server, true, hooksDir, paths, []);

    expect(JSON.parse(fs.readFileSync(paths.userJson, 'utf8')).mcpServers.engram).toEqual(server);
    expect(output().match(/\/plugin install engram@engram/g)).toHaveLength(1);

    const settings = JSON.parse(fs.readFileSync(paths.settings, 'utf8'));
    const commands = Object.values(settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      // The registered command is shell-quoted so a home directory with spaces works.
      const script = command.replace(/^(['"])(.*)\1$/, '$2');
      expect(fs.existsSync(script)).toBe(true);
      // The API base placeholder has to be substituted, or the hook posts nowhere.
      expect(fs.readFileSync(script, 'utf8')).not.toContain('__API_BASE__');
      expect(fs.readFileSync(script, 'utf8')).toContain('http://localhost:4901');
    }
  });

  it.each([true, false])('leaves MCP and hooks untouched for an enabled plugin (withHooks=%s)', (withHooks) => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir);
    const settings = JSON.stringify({ enabledPlugins: { 'engram@engram': true }, permissions: { allow: [] } });
    const userJson = JSON.stringify({ mcpServers: { other: { command: 'other' } }, userID: 'keep' });
    fs.writeFileSync(paths.settings, settings);
    fs.writeFileSync(paths.userJson, userJson);
    const hooksDir = path.join(home, '.engram', 'hooks');
    const skipped: string[] = [];

    setupClaudeCode(defaultConfig(home), { command: 'node' }, withHooks, hooksDir, paths, skipped);

    expect(fs.readFileSync(paths.userJson, 'utf8')).toBe(userJson);
    expect(JSON.parse(fs.readFileSync(paths.userJson, 'utf8')).mcpServers.engram).toBeUndefined();
    expect(fs.readFileSync(paths.settings, 'utf8')).toBe(settings);
    expect(fs.existsSync(hooksDir)).toBe(false);
    expect(skipped).toEqual([]);
    expect(output()).toContain('Engram plugin is active — setup leaves Claude Code MCP and hooks to it.');
    expect(output()).not.toContain('/plugin install');
  });

  it('reports malformed settings without writing MCP or hooks', () => {
    const home = tempDir('home');
    const paths = claudePathsIn(home);
    fs.mkdirSync(paths.dir);
    fs.writeFileSync(paths.settings, '{ broken');
    const hooksDir = path.join(home, 'hooks');
    const skipped: string[] = [];

    setupClaudeCode(defaultConfig(home), {}, true, hooksDir, paths, skipped);

    expect(fs.readFileSync(paths.settings, 'utf8')).toBe('{ broken');
    expect(fs.existsSync(paths.userJson)).toBe(false);
    expect(fs.existsSync(hooksDir)).toBe(false);
    expect(skipped).toHaveLength(1);
    expect(output()).toContain('Claude Code plugin check skipped');
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

describe('setup command', () => {
  it.each([
    ['claude-code', [], true, false, 1],
    ['claude', [], true, false, 1],
    ['claude-code', ['--no-claude-hooks'], true, false, 1],
    ['claude-code', [], false, false, 1],
    ['mcp-client', [], true, false, 1],
    ['cursor', ['--no-claude-hooks'], true, false, 0],
    ['claude-code', [], true, true, 0],
  ] as const)('prints plugin advice once only for Claude: %s %j, detected=%s, plugin=%s',
    (source, flags, detected, enabled, adviceCount) => {
      const home = tempDir('home');
      const claudeDir = path.join(home, '.claude');
      if (detected) fs.mkdirSync(claudeDir);
      if (enabled) fs.writeFileSync(path.join(claudeDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'engram@engram': true } }));

      // File-backed output also works in sandboxes that restrict child pipes.
      const logPath = path.join(home, 'setup.log');
      const logFd = fs.openSync(logPath, 'w');
      let result;
      try {
        result = spawnSync(process.execPath, [
          '--import', 'tsx', path.join(__dirname, '..', 'cli.ts'),
          'setup', '--npx', '--source', source, ...flags,
        ], {
          env: { ...process.env, HOME: home, USERPROFILE: home, ENGRAM_HOME: path.join(home, '.engram') },
          stdio: ['ignore', logFd, logFd],
          timeout: 20000,
        });
      } finally {
        fs.closeSync(logFd);
      }
      const stdout = fs.readFileSync(logPath, 'utf8');

      expect(result.error).toBeUndefined();
      expect(result.status, stdout).toBe(0);
      expect(stdout.match(/\/plugin install engram@engram/g) ?? []).toHaveLength(adviceCount);
      // A second write would create a backup of the freshly registered MCP config.
      expect(fs.readdirSync(home).filter((file) => file.endsWith('.bak'))).toEqual([]);
      expect(stdout).toContain('Engram installed');
      if (enabled) {
        expect(fs.existsSync(path.join(home, '.claude.json'))).toBe(false);
        expect(stdout.match(/Engram plugin is active/g)).toHaveLength(1);
      }
    });
});
