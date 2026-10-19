import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const dirs: string[] = [];
const argv = process.argv;
const exitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'table').mockImplementation(() => {});
  process.exitCode = 0;
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function build(entry = 'export{}', chart = 'export{}') {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-bundle-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/vendor-a.js">');
  for (const [name, text] of Object.entries({ 'index-a': entry, 'vendor-a': 'export{}', 'charts-a': chart,
    'InsightsView-a': 'import"./charts-a.js";import"./vendor-a.js";' })) writeFileSync(join(dir, 'assets', `${name}.js`), text);
  return dir;
}
async function check(dir: string) {
  process.argv = [argv[0]!, 'check-bundle.mjs', dir];
  await import('./check-bundle.mjs');
  return vi.mocked(console.table).mock.calls[0]![0];
}

it('counts initial preloads and the lazy charts dependency, excluding shared JS', async () => {
  const rows = await check(build('import"./vendor-a.js";import("./InsightsView-a.js")'));
  expect(process.exitCode).toBe(0);
  expect(rows).toMatchObject([{ Bundle: 'Initial JS', Files: 2, Result: 'PASS' }, { Files: 2, Result: 'PASS' }]);
});
it('fails when the combined initial gzip exceeds 200 KB', async () => {
  const rows = await check(build(randomBytes(220_000).toString('hex')));
  expect(process.exitCode).toBe(1);
  expect(rows[0]).toMatchObject({ Result: 'FAIL' });
});
it('fails when lazy chart dependencies exceed 125 KB', async () => {
  const rows = await check(build('export{}', randomBytes(140_000).toString('hex')));
  expect(process.exitCode).toBe(1);
  expect(rows[1]).toMatchObject({ Result: 'FAIL' });
});
it('rejects eagerly imported charts', async () => {
  await expect(check(build('import"./charts-a.js"'))).rejects.toThrow('must stay lazy');
});
it('rejects missing Insights outputs', async () => {
  const dir = build();
  rmSync(join(dir, 'assets', 'InsightsView-a.js'));
  await expect(check(dir)).rejects.toThrow('Missing initial JS or InsightsView');
});
