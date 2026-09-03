/**
 * What to tell the user when `pnpm install` fails under `engram setup` /
 * `engram update`.
 *
 * The install runs with `stdio: 'inherit'` — pnpm's output goes straight to the
 * terminal and never reaches this process — so there is nothing here to parse
 * and no way to diagnose the actual error. What there is, is a shortlist: two
 * causes account for nearly every failed install we get reported, both of them
 * ending in the same unexplained `ELIFECYCLE` line, and both invisible in
 * pnpm's own output unless you already know what you are looking at. Naming
 * them beats "check the output above" whether or not we guessed right.
 *
 * Kept free of process.exit / console side effects and of the colour constants
 * in cli.ts, so it stays unit-testable and the two call sites share one copy of
 * the text: the caller owns how it is printed, this owns what it says.
 */

/** One likely cause of a failed install, paired with the way out of it. */
export interface InstallFailureHint {
  /** The cause, in the user's terms — what actually went wrong. */
  readonly cause: string;
  /** The way past it. Actionable enough to type or copy. */
  readonly fix: string;
}

/**
 * The shortlist, freshly built per call.
 *
 * `nodeVersion` is a parameter rather than a `process.version` read inside the
 * cause string so the text is testable without stubbing the process — the
 * default is the only thing production passes.
 */
export function installFailureHints(nodeVersion: string = process.version): readonly InstallFailureHint[] {
  return [
    {
      // better-sqlite3 ships prebuilt binaries per Node ABI. On a Node it has
      // no binary for, prebuild-install quietly falls through to `node-gyp
      // rebuild`, which needs a full C++ toolchain — Visual Studio Build Tools
      // on Windows, which almost nobody installing a memory server has.
      cause: `better-sqlite3 may have no prebuilt binary for Node ${nodeVersion}, leaving it to compile from source — which needs a C++ toolchain.`,
      fix: 'Install Node 22 LTS, which has a prebuilt binary on every platform, then run the install again.',
    },
    {
      // The EPERM lands on `gyp clean`, so it only ever surfaces once the
      // source build above has already started — but it is a separate problem,
      // and stopping the server fixes it on its own.
      cause: 'On Windows, a running Engram process holds the files the installer is replacing (an EPERM on unlink in the output above).',
      fix: 'engram stop, then run the install again.',
    },
  ];
}
