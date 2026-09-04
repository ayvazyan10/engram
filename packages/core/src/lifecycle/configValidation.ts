/**
 * Shared validation for the engine configuration objects callers hand in.
 *
 * Every engine here takes a `Partial<Config>` from somewhere it does not
 * control — a REST body, an MCP tool argument, a library consumer's object —
 * and merges it into live state. Merging it unchecked is a defect with a
 * consistent shape: the bad value does not fail where it is set, it fails much
 * later from inside a sweep, a task build or a SQL LIMIT, and the failure looks
 * like a bug in the engine rather than in the call that caused it.
 *
 * The rules these helpers enforce:
 *
 *   - The payload must be a plain object. A bare JSON string spreads into index
 *     keys ("0": "j", "1": "u", …), which is how a config ended up holding the
 *     letters of the word someone PUT at it.
 *   - Unknown keys are rejected, not carried through. Silently keeping them
 *     turns a typo into a setting that appears to have been accepted.
 *   - Known fields are bounds-checked against a per-field range table.
 *   - Validation runs on the MERGED result, before it is assigned, so a
 *     rejected update leaves the previous config exactly as it was.
 *
 * `label` names the config in every message ("decay policy", "reflection
 * config", "contradiction config") so a caller can tell which of several
 * configs it got wrong.
 */

/** Bounds one numeric field has to satisfy. */
export interface NumericRange {
  /** Lower bound, inclusive unless `exclusiveMin`. */
  readonly min: number;
  /** Upper bound, inclusive. */
  readonly max: number;
  /** Reject `min` itself, for fields where the bound value is meaningless. */
  readonly exclusiveMin?: boolean;
  /** Reject fractions. */
  readonly integer?: boolean;
}

/** How a rejected value is named back to the caller, without dumping an object. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `a string (${JSON.stringify(value.slice(0, 40))})`;
  return `a ${typeof value}`;
}

/**
 * Require an options object.
 *
 * `undefined` is allowed and answered with an empty object, so `new Engine()`
 * and `new Engine(undefined)` keep working. Everything else that is not a plain
 * object — a string, null, an array — is refused here rather than being spread.
 */
export function assertPlainObject(label: string, value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object of options, got ${describeValue(value)}`);
  }
  return value as Record<string, unknown>;
}

/** Refuse any key the config does not define. */
export function assertNoUnknownKeys(
  label: string,
  partial: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(partial)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `Invalid ${label}: unknown option "${key}" — expected one of: ${allowed.join(', ')}`
      );
    }
  }
}

/** Bounds-check one numeric field. */
export function assertNumberInRange(
  label: string,
  field: string,
  value: unknown,
  range: NumericRange,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: ${field} must be a finite number`);
  }
  if (range.integer && !Number.isInteger(value)) {
    throw new Error(`Invalid ${label}: ${field} must be a whole number`);
  }
  const tooLow = range.exclusiveMin ? value <= range.min : value < range.min;
  if (tooLow || value > range.max) {
    const lower = range.exclusiveMin ? `greater than ${range.min}` : `at least ${range.min}`;
    throw new Error(`Invalid ${label}: ${field} must be ${lower} and at most ${range.max}`);
  }
}

/** Require an actual boolean — "true", 1 and null are all rejected. */
export function assertBoolean(label: string, field: string, value: unknown): void {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}: ${field} must be a boolean, got ${describeValue(value)}`);
  }
}

/** Require one of a fixed set of string values. */
export function assertOneOf(
  label: string,
  field: string,
  value: unknown,
  allowed: readonly string[],
): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(
      `Invalid ${label}: ${field} must be one of: ${allowed.join(', ')} — got ${describeValue(value)}`
    );
  }
}

/**
 * Require a non-empty array whose every member is one of a fixed set.
 *
 * Empty is refused deliberately: a config that lists no members reads as
 * "everything" and behaves as "nothing", silently. Disabling belongs in the
 * config's own `enabled` flag, where it is visible.
 */
export function assertNonEmptyArrayOf(
  label: string,
  field: string,
  value: unknown,
  allowed: readonly string[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Invalid ${label}: ${field} must be a non-empty array of: ${allowed.join(', ')} ` +
        `— got ${describeValue(value)}`
    );
  }
  value.forEach((member, index) => assertOneOf(label, `${field}[${index}]`, member, allowed));
}
