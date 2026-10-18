/** The folders of a namespace path, POSIX or Windows. */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/**
 * What a memory's project is called on screen: the git root's folder name
 * ("api"), or "Global" for a memory with no project. When another known
 * project ends in the same folder name, the parent folder is added
 * ("work/api" beside "play/api") so the two cannot be mistaken.
 */
export function projectLabel(namespace: string | null | undefined, known: readonly (string | null)[]): string {
  if (namespace == null) return 'Global';
  const parts = segments(namespace);
  const base = parts[parts.length - 1] ?? namespace;
  const clash = known.some((other) => other != null && other !== namespace && segments(other).pop() === base);
  return clash && parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base;
}
