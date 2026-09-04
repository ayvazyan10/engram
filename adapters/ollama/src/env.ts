/**
 * Proxy configuration, read from the environment and checked before anything
 * binds a socket.
 *
 * Everything here used to live as a row of `process.env[...] ?? default` and
 * `parseInt(...)` at the top of proxy.ts, which gets two things wrong in a way
 * that is invisible until it matters:
 *
 *   - `??` only falls back when a variable is ABSENT. A host or compose file
 *     that templates an untouched optional field passes `''`, so
 *     `ENGRAM_PROXY_HOST=""` beat the loopback default and
 *     `proxy.listen(port, '')` bound every interface — handing any LAN peer an
 *     unauthenticated endpoint onto the user's GPU and memory store. That is
 *     the same empty-string-from-a-template shape that already cost this
 *     project the Desktop extension's database path, the namespace mode and
 *     the API key.
 *   - `parseInt` answers `NaN` for anything it cannot read, and `NaN` is not
 *     nullish, so it survives every `??` after it. `size > NaN` is false for
 *     every size, which meant `ENGRAM_MAX_BODY_BYTES=10mb` did not raise the
 *     cap — it deleted it, while the startup banner went on printing a limit.
 *
 * The rules are the same three the rest of the repo now uses (blank means
 * unset; a non-finite or out-of-range number is an error, not a default; an
 * unrecognised token is an error), and the split between "refuse to start" and
 * "warn and use the default" is the security-control / tuning-knob one.
 *
 * DUPLICATION, DELIBERATE. The canonical implementation is
 * `packages/core/src/lifecycle/envConfig.ts`. This adapter does not depend on
 * `@engram-ai-memory/core` and must not start to: it is a standalone HTTP
 * proxy whose only contact with Engram is `fetch` against the REST API, and
 * taking the core dependency would pull better-sqlite3 and the transformers
 * runtime into a process that needs neither. Keep the two in step by hand;
 * they are both small and both fully tested.
 */

/** Environment as these readers see it — injected so every branch is testable. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** A variable was set to something this process cannot act on. */
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
  readonly min?: number;
  readonly max?: number;
}

function describe(raw: string): string {
  return JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw);
}

/** Blank — absent, empty, or whitespace-only — means unset. */
export function readEnvString(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  return raw !== undefined && raw.trim().length > 0 ? raw : undefined;
}

/**
 * Parse and bounds-check one raw value. `Number`, not `parseInt`: parseInt
 * reads "10mb" as 10 and "1e3" as 1, turning a mistake into a plausible number.
 */
function parseEnvNumber(name: string, raw: string, spec: EnvNumberSpec): number {
  const value = Number(raw.trim());

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
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

/** Strict: `fallback` when unset, `EnvConfigError` when malformed. */
export function readEnvNumber(
  env: EnvSource,
  name: string,
  fallback: number,
  spec: EnvNumberSpec = {}
): number {
  const raw = readEnvString(env, name);
  return raw === undefined ? fallback : parseEnvNumber(name, raw, spec);
}

/** Lenient: a malformed value warns and yields `fallback`. For tuning knobs. */
export function readEnvNumberOr(
  env: EnvSource,
  name: string,
  fallback: number,
  spec: EnvNumberSpec = {},
  warn: (message: string) => void = (message) => console.warn(message)
): number {
  const raw = readEnvString(env, name);
  if (raw === undefined) return fallback;

  try {
    return parseEnvNumber(name, raw, spec);
  } catch (err: unknown) {
    if (!(err instanceof EnvConfigError)) throw err;
    warn(`[Engram] ${err.message} — using the default (${fallback}) instead.`);
    return fallback;
  }
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Loopback by default. This proxy has no authentication and drives the user's
 * GPU, and Ollama itself only listens on loopback — binding every interface
 * hands any LAN peer an open endpoint. Set ENGRAM_PROXY_HOST to widen it.
 */
export const DEFAULT_LISTEN_HOST = '127.0.0.1';

/**
 * Ceiling on a buffered request body. Anything above it is refused with 413:
 * the handler reads the whole body into memory, so without a cap a single
 * client streaming an endless upload grows RSS until the process is killed.
 */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

const DEFAULT_PROXY_PORT = 11435;
const DEFAULT_OLLAMA_TARGET = 'http://localhost:11434';
const DEFAULT_ENGRAM_API = 'http://localhost:4901';
const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 300_000;

/** Highest port number the kernel can bind. 0 means "any free port". */
const MAX_PORT = 65535;

/** Everything proxy.ts reads out of the environment, already checked. */
export interface ProxyConfig {
  readonly port: number;
  readonly listenHost: string;
  readonly ollamaTarget: string;
  readonly engramApi: string;
  readonly maxTokens: number;
  readonly maxBodyBytes: number;
  readonly toolRetry: boolean;
  readonly upstreamTimeoutMs: number;
}

/**
 * Read and validate the whole proxy configuration.
 *
 * Which variables refuse to start and which fall back:
 *
 *   SECURITY CONTROLS — throw. `ENGRAM_MAX_BODY_BYTES` is the memory bound on
 *   an unauthenticated endpoint, and `OLLAMA_PROXY_PORT` decides what the
 *   process claims to be listening on; a control that quietly turns itself off
 *   is worse than one that was never configured, because the banner still
 *   announces it.
 *
 *   TUNING KNOBS — warn on stderr and use the documented default.
 *   `ENGRAM_MAX_TOKENS` bounds how much recalled context is injected and
 *   `ENGRAM_UPSTREAM_TIMEOUT_MS` how long a generation may take; a wrong value
 *   costs latency or context, not safety.
 *
 * `ENGRAM_PROXY_HOST`, `OLLAMA_TARGET` and `ENGRAM_API` are strings where
 * blank means unset, so each falls back to its documented default instead of
 * to the empty string.
 */
export function readProxyConfig(
  env: EnvSource,
  warn?: (message: string) => void
): ProxyConfig {
  return {
    port: readEnvNumber(env, 'OLLAMA_PROXY_PORT', DEFAULT_PROXY_PORT, { min: 0, max: MAX_PORT }),
    listenHost: readEnvString(env, 'ENGRAM_PROXY_HOST') ?? DEFAULT_LISTEN_HOST,
    ollamaTarget: readEnvString(env, 'OLLAMA_TARGET') ?? DEFAULT_OLLAMA_TARGET,
    engramApi: readEnvString(env, 'ENGRAM_API') ?? DEFAULT_ENGRAM_API,
    maxTokens: readEnvNumberOr(env, 'ENGRAM_MAX_TOKENS', DEFAULT_MAX_TOKENS, { min: 1 }, warn),
    maxBodyBytes: readEnvNumber(env, 'ENGRAM_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES, { min: 1 }),
    // Opt-OUT flag: only the exact string "false" disables it, so a blank value
    // leaves the documented default (enabled) in place.
    toolRetry: env['ENGRAM_TOOL_RETRY'] !== 'false',
    upstreamTimeoutMs: readEnvNumberOr(
      env,
      'ENGRAM_UPSTREAM_TIMEOUT_MS',
      DEFAULT_UPSTREAM_TIMEOUT_MS,
      { min: 1 },
      warn
    ),
  };
}
