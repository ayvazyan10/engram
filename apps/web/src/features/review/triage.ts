import { api, type ReviewItem, type ReviewPair, type ReviewQueue } from '../../lib/api.js';
import { archiveMemories } from './archive.js';
import type { Action } from './parts.js';

/** Fading memories are kept by this tag, which the decay policy protects. */
export const PIN_TAG = 'pinned';

/** "Leave it be" for each queue: a contradiction is resolved as keep-both,
 *  the others are dismissed on this device. */
async function leave(queue: ReviewQueue, item: ReviewItem): Promise<void> {
  if (item.kind === 'pair') {
    if (queue === 'contradictions') await api.resolveContradiction(item.a.id, item.b.id, 'keep_both');
    else await api.dismissReview('duplicates', [item.a.id, item.b.id]);
    return;
  }
  if (queue === 'fading' || queue === 'secrets') await api.dismissReview(queue, [item.memory.id]);
}

const LEFT: Record<ReviewQueue, string> = {
  contradictions: 'Marked as not a contradiction.',
  duplicates: 'Kept both.',
  fading: 'Left to fade.',
  secrets: 'Marked as not a secret.',
};

/** Does one action on one item and says what happened, for the toast. */
export async function settle(queue: ReviewQueue, item: ReviewItem, action: Action): Promise<string> {
  if (item.kind === 'pair') {
    if (action === 'keepA' || action === 'keepB') {
      await archiveMemories([action === 'keepA' ? item.b.id : item.a.id]);
      return `Kept the ${action === 'keepA' ? 'first' : 'second'} memory. The other is archived.`;
    }
    await leave(queue, item);
    return LEFT[queue];
  }
  const id = item.memory.id;
  switch (action) {
    case 'pin':
      await api.addTag(id, PIN_TAG);
      return 'Pinned. It will not fade.';
    case 'redact': {
      const { redacted } = await api.redactMemory(id);
      return `Redacted ${redacted} ${redacted === 1 ? 'value' : 'values'}. The memory stays.`;
    }
    case 'archive':
      await archiveMemories([id]);
      return 'Archived.';
    default:
      await leave(queue, item);
      return LEFT[queue];
  }
}

export type BulkAction = 'dismiss' | 'pin' | 'archive' | 'tag';

/** Of each pair, the one stored first. */
function older(pair: ReviewPair): string {
  return pair.a.createdAt <= pair.b.createdAt ? pair.a.id : pair.b.id;
}

function memoryIds(items: ReviewItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'pair' ? [item.a.id, item.b.id] : [item.memory.id]));
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/**
 * One action over a selection. Returns the keys that left the queue (tagging
 * leaves everything in place) and the toast. Leave-be has no bulk endpoint,
 * so it goes item by item and reports the ones that failed.
 */
export async function settleMany(
  queue: ReviewQueue,
  items: ReviewItem[],
  action: BulkAction,
  keyOf: (item: ReviewItem) => string,
  tag = ''
): Promise<{ removed: string[]; message: string }> {
  const unit = items[0]?.kind === 'pair' ? ['pair', 'pairs'] : ['memory', 'memories'];
  if (action === 'tag') {
    const ids = memoryIds(items);
    await api.bulkTag(ids, tag);
    return { removed: [], message: `Tagged ${plural(ids.length, 'memory', 'memories')} “${tag}”.` };
  }
  if (action === 'pin') {
    await api.bulkTag(memoryIds(items), PIN_TAG);
    return { removed: items.map(keyOf), message: `Pinned ${plural(items.length, 'memory', 'memories')}.` };
  }
  if (action === 'archive') {
    const pairs = items.filter((i): i is ReviewPair => i.kind === 'pair');
    await archiveMemories(pairs.length ? pairs.map(older) : memoryIds(items));
    return {
      removed: items.map(keyOf),
      message: pairs.length
        ? `Kept the newer of ${plural(pairs.length, 'pair', 'pairs')}; the older ones are archived.`
        : `Archived ${plural(items.length, 'memory', 'memories')}.`,
    };
  }
  const removed: string[] = [];
  let failure = '';
  for (const item of items) {
    try {
      await leave(queue, item);
      removed.push(keyOf(item));
    } catch (err) {
      failure = err instanceof Error ? err.message : 'Could not reach Engram';
    }
  }
  const done = `${LEFT[queue].replace(/\.$/, '')}: ${plural(removed.length, unit[0]!, unit[1]!)}.`;
  const missed = items.length - removed.length;
  return { removed, message: missed ? `${done} ${missed} could not be changed: ${failure}` : done };
}
