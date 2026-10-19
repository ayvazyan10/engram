export interface NameInput { tags: string[]; concept: string | null; content?: string }

const STOPWORDS = new Set(`a an and are as at be been being but by can could did do does doing for from
  had has have having he her here hers herself him himself his how i if in into is it its itself
  just me more most my myself no nor not of on once only or other our ours ourselves out over own
  same she should so some such than that the their theirs them themselves then there these they
  this those through to too under until up very was we were what when where which while who whom
  why will with would you your yours yourself yourselves also about after again against all am any
  because before below between both down during each few further off ought shall now don doesn didn
  isn aren wasn weren won wouldn couldn shouldn must mustn need needn might mightn ll re ve`.split(/\s+/));

/** Region documents, with IDF measured against all visible memories. */
export function regionNames(rows: NameInput[], groups: number[][]): { name: string; topTags: string[] }[] {
  const allowed = (term: string) => !/^(reflection|mc:)/i.test(term);
  const tokens = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => word.length >= 3 && !/^\p{N}+$/u.test(word) && !STOPWORDS.has(word) ? word : '');
  const documents = rows.map((row) => {
    const sources = [...row.tags.filter(allowed), ...(row.concept && allowed(row.concept) ? [row.concept] : [])];
    const sequences = sources.map(tokens);
    const preferred = sequences.some((words) => words.some(Boolean));
    if (!preferred) sequences.push(tokens(row.content ?? ''));
    const terms = new Set<string>();
    const bigrams = new Set<string>();
    for (const words of sequences) for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      if (!word) continue;
      terms.add(word);
      // Keep original neighbours: removing "and" must not invent a phrase.
      if (words[i + 1]) {
        const pair = `${word} ${words[i + 1]}`;
        bigrams.add(pair);
      }
    }
    return { terms, bigrams, preferred };
  });
  const frequency = new Map<string, number>();
  for (const doc of documents) for (const term of [...doc.terms, ...doc.bigrams]) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const used = new Set<string>();
  return groups.map((group) => {
    const metadata = new Set<string>();
    const counts = new Map<string, number>();
    const pairs = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const i of group) {
      const doc = documents[i]!;
      if (doc.preferred) for (const term of [...doc.terms, ...doc.bigrams]) metadata.add(term);
      for (const term of documents[i]!.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const pair of documents[i]!.bigrams) pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
      for (const tag of new Set(rows[i]!.tags.filter(allowed))) {
        if (tokens(tag).some(Boolean)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      }
    }
    const score = (term: string, count: number) => count * (1 + Math.log((1 + rows.length) / (1 + (frequency.get(term) ?? 0))));
    const rank = (a: [string, number], b: [string, number]) => Number(metadata.has(b[0])) - Number(metadata.has(a[0]))
      || score(b[0], b[1]) - score(a[0], a[1]) || a[0].localeCompare(b[0]);
    const ranked = [...counts].sort(rank);
    const phrase = [...pairs].filter(([pair, count]) => count >= 2 && count > group.length / 2
      && (!metadata.has(ranked[0]?.[0] ?? '') || metadata.has(pair))).sort(rank)[0];
    const label = phrase?.[0] ?? ranked.slice(0, 2).map(([term]) => term).join(' · ');
    const base = label.replace(/\p{L}+/gu, (word) => word[0]!.toUpperCase() + word.slice(1)) || 'Memories';
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) name = `${base} (${suffix})`;
    used.add(name);
    return {
      name,
      topTags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([tag]) => tag),
    };
  });
}
