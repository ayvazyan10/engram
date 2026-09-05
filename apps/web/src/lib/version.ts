import { version } from '../../package.json';

/**
 * The version the header badge prints. It used to be the literal 'v0.2'
 * while package.json said 0.4.1 — a badge whose one job is to say which
 * build is running, saying the wrong one. Vite's JSON plugin tree-shakes the
 * named import, so only the string reaches the bundle.
 */
export const APP_VERSION: string = version;
