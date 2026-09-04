/**
 * One place that decides what an environment variable is allowed to say.
 *
 * Every process in this repo reads its configuration from the environment, and
 * every one of them used to decide independently what a bad value means. The
 * results diverged in ways that all look like the same bug from outside:
 *
 *   - `X ?? default` only falls back when the variable is ABSENT. A host that
 *     templates an untouched optional field passes `''` instead of omitting it,
 *     so the default never applies and the empty string wins. That has now cost
 *     this project the Desktop extension's database path (an anonymous temp DB
 *     that discarded every write), the namespace mode (startup aborted), the
 *     API key (authentication silently off) and the proxy's bind host (every
 *     interface exposed).
 *   - `parseInt(X)` answers `NaN` for anything it cannot read, and `NaN`
 *     survives `??` because it is not nullish. `NaN` then disables whatever it
 *     was meant to bound: `size > NaN` is false, so a body-size cap vanishes;
 *     `setInterval(NaN)` fires about every millisecond.
 *   - An enum cast with `as` accepts any string. An unrecognised sync mode does
 *     not fail — it falls through to whichever branch happens to be last.
 *
 * So the three questions are answered here, once:
 *
 *   1. Blank (absent, empty, or whitespace-only) means UNSET. The one exception
 *      is `requireConfiguredEnv`, for variables whose mere presence is the
 *      instruction — see its doc comment.
 *   2. A value that is not a finite number in range is an ERROR, never a
 *      silently-substituted default.
 *   3. A value outside a fixed set is an ERROR.
 *
 * What a caller DOES about an invalid value is the caller's decision, and it
 * has exactly two shapes:
 *
 *   - Security control (a key, a size cap, a bind address): refuse to start.
 *     A control that removes itself when misconfigured is worse than one that
 *     was never there, because it still reports as present. Use the throwing
 *     readers (`requireConfiguredEnv`, `readEnvNumber`, `readEnvEnum`).
 *   - Tuning knob (a batch size, a sweep interval): warn on stderr and use the
 *     documented default, the way the CLI already treats a malformed config
 *     file. Use `readEnvNumberOr`.
 *
 * Values are returned byte-for-byte. Nothing here trims a string it hands
 * back — trimming a passphrase would derive a different key and make every
 * previously-encrypted row unreadable.
 */

/** Environment as these readers see it — injected so every branch is testable. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * A variable was set to something this process cannot act on.
 *
 * Carries the variable name separately from the message so a caller can decide
 * per-variable whether to abort or fall back without re-parsing prose.
 */
export class EnvConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, detail: string) {
    super(`${variable} ${detail}`);
    this.name = 'EnvConfigError';
    this.variable = variable;
  }
}

/** Bounds a numeric variable has to satisfy. */
export interface EnvNumberSpec {
  /** Lower bound, inclusive. */
  readonly min?: number;
  /** Upper bound, inclusive. */
  readonly max?: number;
  /** Reject fractions. Defaults to true — these are counts, ports and byte sizes. */
  readonly integer?: boolean;
}

/** Names a rejected value back to the operator without dumping a huge string. */
function describe(raw: string): string {
  return JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
}

/** Default sink for tuning-knob warnings. `console.warn` writes to stderr. */
function warnToStderr(message: string): void {
  console.warn(message);
}

/**
 * Read a variable where blank means unset.
 *
 * This is the replacement for `process.env[name] ?? fallback`: callers write
 * `readEnvString(env, name) ?? fallback` and get the fallback for an empty
 * string too.
 */
export function readEnvString(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  return raw !== undefined && raw.trim().length > 0 ? raw : undefined;
}

/**
 * Read a variable where being SET is itself the instruction, so blank is an
 * error rather than "unset".
 *
 * For a security control there are two distinguishable states and only one of
 * them is safe to guess at. Absent means "this was not wanted" — the
 * local-first default stands. Present-but-empty means "this was wanted and the
 * value was lost somewhere between the config file and the process", and
 * running as though it had never been asked for is precisely the failure that
 * has to be visible. `ENGRAM_API_KEY` adopted this rule; `ENGRAM_SYNC_ENCRYPTION_KEY`
 * follows it here.
 *
 * @param guidance appended to the message — say what unsetting it would mean.
 */
export function requireConfiguredEnv(
  env: EnvSource,
  name: string,
  guidance: string
): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    throw new EnvConfigError(name, `is set but empty. ${guidance}`);
  }
  return raw;
}

/**
 * Parse and bounds-check one raw value.
 *
 * `Number`, not `parseInt`: parseInt reads "10abc" as 10 and "1e3" as 1, so a
 * value that is plainly a mistake becomes a plausible-looking number instead of
 * an error.
 */
function parseEnvNumber(name: string, raw: string, spec: EnvNumberSpec): number {
  const value = Number(raw.trim());

  if (!Number.isFinite(value)) {
    throw new EnvConfigError(name, `must be a number, got ${describe(raw)}`);
  }
  if (spec.integer !== false && !Number.isInteger(value)) {
    throw new EnvConfigError(name, `must be a whole number, got ${describe(raw)}`);
  }
  if (spec.min !== undefined && value < spec.min) {
    throw new EnvConfigError(name, `must be at least ${spec.min}, got ${value}`);
  }
  if (spec.max !== undefined && value > spec.max) {
    throw new EnvConfigError(name, `must be at most ${spec.max}, got ${value}`);
  }
  return value;
}

/**
 * Strict numeric read. `undefined` when unset; throws `EnvConfigError` when the
 * value is not a finite in-range number.
 *
 * Use for anything whose absence changes behaviour that matters — a body-size
 * cap, a sync interval, a listen port.
 */
export function readEnvNumber(
  env: EnvSource,
  name: string,
  spec: EnvNumberSpec = {}
): number | undefined {
  const raw = readEnvString(env, name);
  return raw === undefined ? undefined : parseEnvNumber(name, raw, spec);
}

/**
 * Lenient numeric read for a tuning knob: an invalid value warns on stderr and
 * yields `fallback`, which is also what an unset variable yields.
 *
 * `fallback` is generic so a caller whose default is "leave it to the engine"
 * can pass `undefined` and still get the warning.
 */
export function readEnvNumberOr<F>(
  env: EnvSource,
  name: string,
  fallback: F,
  spec: EnvNumberSpec = {},
  warn: (message: string) => void = warnToStderr
): number | F {
  const raw = readEnvString(env, name);
  if (raw === undefined) return fallback;

  try {
    return parseEnvNumber(name, raw, spec);
  } catch (err: unknown) {
    if (!(err instanceof EnvConfigError)) throw err;
    warn(`[engram] ${err.message} — using ${describeFallback(fallback)} instead.`);
    return fallback;
  }
}

/** How a fallback reads in a warning: "the default (16)" or "the built-in default". */
function describeFallback(fallback: unknown): string {
  return fallback === undefined || fallback === null
    ? 'the built-in default'
    : `the default (${String(fallback)})`;
}

/**
 * Strict enum read. `undefined` when unset; throws `EnvConfigError` for a value
 * outside `allowed`.
 *
 * Not case-folded and not trimmed: a mode is a fixed token, and quietly
 * accepting " Auto " would be the same class of guess this module exists to
 * stop.
 */
export function readEnvEnum<T extends string>(
  env: EnvSource,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const raw = readEnvString(env, name);
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new EnvConfigError(name, `must be one of: ${allowed.join(', ')} — got ${describe(raw)}`);
  }
  return raw as T;
}
