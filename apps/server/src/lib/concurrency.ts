/**
 * Map over items with a ceiling on how many run at once.
 *
 * POST /api/memory/batch accepts up to 1000 items and used to hand every one
 * of them to `Promise.all` at the same moment. Each store embeds its text, so
 * one request opened up to 1000 concurrent embedder calls, each holding its
 * input and its output vector, and the event loop had no gap to serve anything
 * else until the slowest finished. The array bound (maxItems: 1000) limits how
 * much work one request may ask for; this limits how much of it is in flight.
 *
 * Results come back in input order regardless of completion order — the batch
 * response returns `ids` positionally, so reordering would silently mismatch
 * ids to the memories the caller sent.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit < 1) throw new RangeError('concurrency limit must be at least 1');

  const results = new Array<R>(items.length);
  let next = 0;

  // One worker per slot, each pulling the next index until the list is empty.
  // A chunked "run 16, await all, run the next 16" loop would idle the whole
  // slot set on its slowest member; this keeps every slot busy.
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await fn(item, index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);

  return results;
}
