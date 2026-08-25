#!/usr/bin/env node
'use strict';

/**
 * Worker process for the getDeviceId() cross-process race regression test
 * (see deviceId-race.test.ts). Deliberately plain CommonJS, not TypeScript:
 * this needs to run as a REAL separate OS process, and the compiled `dist/`
 * output is what actually ships — that's what should be under test here, not
 * a re-transpiled-on-the-fly copy of the source.
 *
 * Protocol (line-delimited, over stdio):
 *   1. Requires the compiled adapter + deviceId modules from `dist/` and
 *      opens a connection to the (already-migrated) SQLite file at argv[2].
 *   2. Prints "READY", then blocks reading one line from stdin.
 *   3. On receiving "GO", calls getDeviceId() and prints exactly one JSON
 *      result line: {"ok":true,"deviceId":"..."} or {"ok":false,"error":"..."}.
 *   4. Always exits 0 (errors are reported in the JSON payload, not via exit
 *      code) so the parent can tell "process crashed unexpectedly" (nonzero
 *      exit) apart from "getDeviceId() threw" (ok:false in the JSON).
 */

const path = require('path');
const readline = require('readline');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: deviceId-race-worker.cjs <db-path>');
  process.exit(2);
}

const distRoot = path.join(__dirname, '..', '..', '..', 'dist');

let getDatabaseConnection;
let closeDatabase;
let getDeviceId;
try {
  ({ getDatabaseConnection, closeDatabase } = require(path.join(distRoot, 'db', 'index.js')));
  ({ getDeviceId } = require(path.join(distRoot, 'sync', 'deviceId.js')));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: `require failed: ${error instanceof Error ? error.message : String(error)}` }));
  process.exit(0);
}

try {
  getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: `connection failed: ${error instanceof Error ? error.message : String(error)}` }));
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });

// Signal readiness only after the connection is fully open, so the parent's
// "GO" release doesn't have to absorb connection-setup jitter — every
// worker's getDeviceId() call fires within a tight window of every other's.
process.stdout.write('READY\n');

rl.once('line', (line) => {
  rl.close();

  if (line.trim() !== 'GO') {
    console.log(JSON.stringify({ ok: false, error: `unexpected control message: ${line}` }));
    process.exit(0);
    return;
  }

  try {
    const deviceId = getDeviceId();
    console.log(JSON.stringify({ ok: true, deviceId }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    try {
      closeDatabase();
    } catch {
      // Best-effort cleanup — already reporting the primary result above.
    }
    process.exit(0);
  }
});
