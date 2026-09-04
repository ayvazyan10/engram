/**
 * The CLI's output vocabulary.
 *
 * Extracted from cli.ts so the reporting helpers can live in their own modules
 * (and be tested) instead of growing the commander entrypoint. stdout is this
 * program's interface, which is why `no-console` is off for this package —
 * everything user-facing goes through here.
 */

export const B = '\x1b[1m';
export const D = '\x1b[2m';
export const G = '\x1b[32m';
export const C = '\x1b[36m';
export const R = '\x1b[31m';
export const Y = '\x1b[33m';
export const X = '\x1b[0m';

export const ok = (msg: string): void => console.log(`${G}  ✓${X} ${msg}`);
export const fail = (msg: string): void => console.log(`${R}  ✗${X} ${msg}`);
export const step = (msg: string): void => console.log(`${C}  →${X} ${msg}`);
export const warn = (msg: string): void => console.log(`${Y}  !${X} ${msg}`);

/** Indented supporting lines under a result. */
export function detail(lines: Iterable<string>): void {
  for (const line of lines) console.log(`  ${D}${line}${X}`);
}
