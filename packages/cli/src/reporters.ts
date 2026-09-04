/**
 * How the CLI explains the things that go wrong during setup and update.
 *
 * Pure console reporting: each function takes the result somebody else
 * produced and says what it means and what to do about it. Extracted from
 * cli.ts, which is a 1400-line commander entrypoint and was never going to
 * grow a test for any of this while these lived inside it.
 */

import { ConfigParseError } from './claudeSetup.js';
import { npmErrorLines, globalInstallAdvice } from './globalInstall.js';
import { installFailureHints } from './installFailure.js';
import { C, D, X, fail, warn, detail } from './ui.js';
import type { FetchFailure, RepoSyncResult } from './gitUpdate.js';

/**
 * Explain a failed fetch. An auth failure is worth spelling out: this checkout
 * pulls a public repository over anonymous HTTPS, so the only way git ends up
 * sending credentials at all is a credential helper volunteering a stale entry
 * — which reads as a network problem unless we say otherwise.
 */
export function reportFetchFailure(failure: FetchFailure, repoPath: string): void {
  switch (failure) {
    case 'auth':
      fail('The remote asked for credentials and rejected them.');
      console.log('  Engram is a public repository — this checkout needs no credentials.');
      console.log('  A stale entry in a git credential helper is the usual cause.');
      console.log(`  Fix: ${C}git credential reject <<< $'protocol=https\\nhost=github.com\\n'${X}`);
      console.log(`  Then check: ${D}grep github.com ~/.git-credentials${X} and ${D}git config --get-all credential.helper${X}`);
      console.log(`  Verify the remote is HTTPS and public: ${D}cd ${repoPath} && git remote -v${X}`);
      return;
    case 'not-found':
      fail('The remote repository does not exist — the URL is wrong or the repository moved.');
      console.log(`  Check the remote: ${D}cd ${repoPath} && git remote -v${X}`);
      console.log(`  Or start over: ${D}rm -rf ${repoPath}${X} and run ${C}engram setup${X}`);
      return;
    case 'network':
      fail('Could not reach the remote repository. Check your connection.');
      return;
    default:
      fail('Could not fetch from the remote repository.');
      return;
  }
}

/** Explain a failed sync and how to get past it. */
export function reportSyncFailure(result: RepoSyncResult, repoPath: string): void {
  switch (result.status) {
    case 'fetch-failed':
      reportFetchFailure(result.failure, repoPath);
      break;
    case 'no-upstream':
      fail(`No upstream branch is configured for ${repoPath}.`);
      console.log(`  Fix: ${D}cd ${repoPath} && git branch --set-upstream-to=origin/master${X}`);
      return;
    case 'blocked': {
      const named = result.blocked.length > 0 ? `: ${result.blocked.join(', ')}` : '';
      if (result.failure === 'untracked-collision') {
        fail(`Update blocked — untracked files clash with new files from upstream${named}`);
      } else if (result.failure === 'local-changes') {
        fail(`Update blocked — local edits to files the update replaces${named}`);
      } else if (result.failure === 'diverged') {
        fail('Update blocked — this checkout has commits that are not upstream.');
      } else {
        fail('Update failed.');
      }
      break;
    }
    default:
      return;
  }

  if ('detail' in result && result.detail) {
    for (const line of result.detail.split('\n')) console.log(`  ${D}${line}${X}`);
  }
  if (result.status === 'blocked') {
    console.log(`  Fix: ${C}engram update --force${X} ${D}(stashes local changes, keeps commits on a backup branch)${X}`);
  }
}

/**
 * Explain a failed `npm install -g` in npm's own words, and hand back a fix
 * line that targets the prefix this CLI actually lives under.
 *
 * Both call sites used to swallow the error whole: `stdio: 'pipe'` captures
 * npm's diagnosis and a bare catch dropped it, so an EACCES on a prefix the
 * user never chose surfaced as one warning line — followed by advice that
 * resolved that same wrong prefix and failed the same way.
 */
export function reportGlobalInstallFailure(err: unknown, prefix: string | null, verb: string): void {
  warn(`Could not ${verb} the CLI globally.`);
  detail(npmErrorLines(err));
  console.log(`  Fix: ${C}${globalInstallAdvice(prefix)}${X}`);
}

/**
 * Explain a failed dependency install. Shared by setup and update: the install
 * is the same command in both, and so is everything that goes wrong with it.
 *
 * pnpm ran with `stdio: 'inherit'`, so its output is already on screen and none
 * of it reached us — this adds the reading of it the user cannot do, not a
 * diagnosis we do not have.
 */
export function reportInstallFailure(): void {
  fail('Install failed. Check the output above for details.');
  for (const hint of installFailureHints()) {
    console.log(`  ${D}${hint.cause}${X}`);
    console.log(`  Fix: ${C}${hint.fix}${X}`);
  }
}

/**
 * Report a user config file we refused to modify, and record it so the run
 * cannot end on a plain success banner.
 *
 * A parse failure is never licence to replace the file. ~/.claude.json is
 * Claude Code's primary state file — the login, and every project's trust
 * state — and a torn read while Claude Code was rewriting it used to be enough
 * to hand back a near-empty object that setup then wrote straight over.
 */
export function reportConfigRefusal(err: unknown, what: string, skipped: string[]): void {
  if (err instanceof ConfigParseError) {
    fail(`${what} skipped — ${err.file} is not valid JSON, and Engram will not overwrite it.`);
    detail([err.message]);
    console.log(`  Fix: ${C}inspect ${err.file}, repair or move it, then re-run engram setup${X}`);
    skipped.push(`${what} — ${err.file} could not be parsed`);
    return;
  }
  warn(`${what} skipped: ${err instanceof Error ? err.message : String(err)}`);
  skipped.push(`${what} — ${err instanceof Error ? err.message : String(err)}`);
}

/** Say where the rescue copy went, so an unwanted merge can be undone. */
export function reportBackup(backup: string | null): void {
  if (backup) detail([`previous contents saved to ${backup}`]);
}

