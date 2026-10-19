import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// An optional directory lets the same gate check small fixture builds in tests.
const dist = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const assets = readdirSync(resolve(dist, 'assets'));
const initial = new Set();
const insights = new Set();
function collect(file, into) {
  if (into.has(file)) return;
  into.add(file);
  const source = readFileSync(file, 'utf8');
  // Follow static imports only. Dynamic imports belong to a later navigation.
  for (const match of source.matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+\.js)["']/g)) {
    collect(resolve(dirname(file), match[1]), into);
  }
}
for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  if (!tag[0].startsWith('<script') && !/rel=["']modulepreload["']/.test(tag[0])) continue;
  const url = /(?:src|href)=["']([^"']+\.js)(?:\?[^"']*)?["']/.exec(tag[0])?.[1];
  if (url) collect(resolve(dist, url.replace(/^\//, '')), initial);
}
const roots = assets.filter((name) => /^InsightsView-.*\.js$/.test(name));
if (!initial.size || !roots.length) throw new Error('Missing initial JS or InsightsView chunk; build apps/web first.');
for (const name of roots) collect(resolve(dist, 'assets', name), insights);
if (roots.some((name) => initial.has(resolve(dist, 'assets', name))) || [...initial].some((file) => /\/charts-[^/]+\.js$/.test(file))) {
  throw new Error('Insights/charts must stay lazy.');
}
for (const file of initial) insights.delete(file);
const rows = [ ['Initial JS', initial, 200], ['Lazy Insights (including charts)', insights, 125] ].map(([name, files, limit]) => {
  const bytes = [...files].reduce((sum, file) => sum + gzipSync(readFileSync(file)).length, 0);
  return { Bundle: name, Files: files.size, 'Gzip KB': (bytes / 1024).toFixed(2), 'Budget KB': limit, Result: bytes <= limit * 1024 ? 'PASS' : 'FAIL' };
});
console.table(rows);
if (rows.some((row) => row.Result === 'FAIL')) process.exitCode = 1;
