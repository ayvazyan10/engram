export interface NameInput { tags: string[]; concept: string | null }

/** Region documents, with IDF measured against all visible memories. */
export function regionNames(rows: NameInput[], groups: number[][]): { name: string; topTags: string[] }[] {
  const allowed = (term: string) => !/^(reflection|mc:)/i.test(term);
  const terms = rows.map((row) => new Set([
    ...row.tags.filter(allowed).map((tag) => tag.toLowerCase()),
    ...(row.concept?.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []).filter(allowed),
  ]));
  const frequency = new Map<string, number>();
  for (const document of terms) for (const term of document) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  return groups.map((group) => {
    const counts = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const i of group) {
      for (const term of terms[i]!) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const tag of rows[i]!.tags.filter(allowed)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    const score = (term: string, count: number) => count * (1 + Math.log((1 + rows.length) / (1 + (frequency.get(term) ?? 0))));
    const ranked = [...counts].sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]) || a[0].localeCompare(b[0]));
    return {
      name: ranked.slice(0, 2).map(([term]) => term).join(' · ') || 'Memories',
      topTags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([tag]) => tag),
    };
  });
}
