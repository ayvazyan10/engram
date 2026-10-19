import { api, type ReviewItem, type ReviewPair, type ReviewQueue } from '../../lib/api.js';
import type { Action } from './parts.js';

/** Fading memories are kept by this tag, which the decay policy protects. */
export const PIN_TAG = 'pinned';

/** "Leave it be" for each queue: a contradiction is resolved as keep-both,
 *  the others are dismissed on this device. */
async function leave(queue: ReviewQueue, item: ReviewItem): Promise<void> {
  if (item.kind === 'pair') {
    if (queue === 'contradictions') {
      const result = await api.resolveContradiction(item.a.id, item.b.id, 'keep_both');
      if (!result.resolved) throw new Error('Contradiction not resolved');
    }
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

interface Settlement {
  message: string;
  /** Sent after removal, with the same Undo window as the memory sheet. */
  archiveIds?: string[];
}

/** Does one action on one item and says what happened, for the toast. */
export async function settle(queue: ReviewQueue, item: ReviewItem, action: Action): Promise<Settlement> {
  if (item.kind === 'pair') {
    if (action === 'keepA' || action === 'keepB') {
      return {
        archiveIds: [action === 'keepA' ? item.b.id : item.a.id],
        message: `Kept the ${action === 'keepA' ? 'first' : 'second'} memory. The other is archived.`,
      };
    }
    await leave(queue, item);
    return { message: LEFT[queue] };
  }
  const id = item.memory.id;
  switch (action) {
    case 'pin':
      await api.addTag(id, PIN_TAG);
      return { message: 'Pinned. It will not fade.' };
    case 'redact': {
      const { redacted } = await api.redactMemory(id);
      return { message: `Redacted ${redacted} ${redacted === 1 ? 'value' : 'values'}. The memory stays.` };
    }
    case 'archive':
      return { archiveIds: [id], message: 'Archived.' };
    default:
      await leave(queue, item);
      return { message: LEFT[queue] };
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
 * leaves everything in place) and the toast. Contradictions use the bulk resolution endpoint; other
 * leave-be actions go item by item. Failed items stay in the queue.
 */
export async function settleMany(
  queue: ReviewQueue,
  items: ReviewItem[],
  action: BulkAction,
  keyOf: (item: ReviewItem) => string,
  tag = ''
): Promise<Settlement & { removed: string[] }> {
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
    return {
      removed: items.map(keyOf),
      archiveIds: pairs.length ? pairs.map(older) : memoryIds(items),
      message: pairs.length
        ? `Kept the newer of ${plural(pairs.length, 'pair', 'pairs')}; the older ones are archived.`
        : `Archived ${plural(items.length, 'memory', 'memories')}.`,
    };
  }
  const removed: string[] = [];
  let failure = '';
  if (queue === 'contradictions') {
    const pairs = items.filter((item): item is ReviewPair => item.kind === 'pair');
    for (let i = 0; i < pairs.length; i += 500) {
      const chunk = pairs.slice(i, i + 500);
      try {
        const { results } = await api.bulkResolveContradictions(chunk.map((item) => ({
          sourceId: item.a.id, targetId: item.b.id, strategy: 'keep_both',
        })));
        results.forEach((result, index) => {
          if (result.ok) removed.push(keyOf(chunk[index]!));
          else failure = result.error ?? 'Contradiction not resolved';
        });
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Could not reach Engram';
      }
    }
  } else {
    for (const item of items) {
      try {
        await leave(queue, item);
        removed.push(keyOf(item));
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Could not reach Engram';
      }
    }
  }
  const done = `${LEFT[queue].replace(/\.$/, '')}: ${plural(removed.length, unit[0]!, unit[1]!)}.`;
  const missed = items.length - removed.length;
  return { removed, message: missed ? `${done} ${missed} could not be changed: ${failure}` : done };
}
