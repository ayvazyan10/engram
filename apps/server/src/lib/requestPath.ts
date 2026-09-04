/**
 * The path part of a raw request URL, without the query string.
 *
 * `req.url` is the raw request target, query string included, so every hook
 * that compares it against a literal path silently changes behaviour the
 * moment a caller appends anything: `GET /api/health?x=1` did not match
 * `'/api/health'` and came back 401, which broke any probe that adds a
 * cache-buster. Route matching has already happened by the time an onRequest
 * hook runs, but `req.routeOptions.url` is the route PATTERN
 * ('/api/memory/:id'), not the concrete path — so hooks that gate by prefix
 * need the real path with the query removed.
 */
export function pathnameOf(rawUrl: string): string {
  const queryStart = rawUrl.indexOf('?');
  const withoutQuery = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
  const hashStart = withoutQuery.indexOf('#');
  return hashStart === -1 ? withoutQuery : withoutQuery.slice(0, hashStart);
}
