import { useEffect, useState } from 'react';
import { useRouteStore } from '../../shell/routeStore.js';
import { Icon } from '../../shell/icons.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { api } from '../../lib/api.js';
import './recall.css';

/** recall_context's own default budget, so this is the block an MCP client
 *  gets for the same words. */
const RECALL_MAX_TOKENS = 2000;

/** The `[8-char id · date]` prefix ContextAssembler puts on every line. */
const REF = /(\[[0-9a-f]{8} · [^\]\n]+\])/;

type Answer =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; context: string; ids: string[] }
  | { status: 'error'; query: string; message: string };

function idsOf(memories: unknown[]): string[] {
  return memories.flatMap((m) =>
    m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string' ? [(m as { id: string }).id] : []
  );
}

/**
 * What my AI knows: the exact block `recall_context` hands an AI for a
 * question, with every `[id · date]` opening that memory. The question lives
 * in the link (`#/recall?q=`). F4 replaces this with the recall route drawn
 * on the map; the text and its references stay.
 */
export default function RecallView({ onStore }: { onStore: () => void }) {
  const query = useRouteStore((s) => s.route.params.q ?? '');
  const setParam = useRouteStore((s) => s.setParam);
  const records = useMemoryStore((s) => s.records);
  const openId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const [input, setInput] = useState(query);
  const [answer, setAnswer] = useState<Answer>({ status: 'idle' });
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setInput(query);
    setCopied('idle');
    if (!query) {
      setAnswer({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setAnswer({ status: 'loading', query });
    api
      .recall(query, RECALL_MAX_TOKENS)
      .then((res) => !cancelled && setAnswer({ status: 'done', query, context: res.context, ids: idsOf(res.memories) }))
      .catch((err: unknown) => {
        if (!cancelled) setAnswer({ status: 'error', query, message: err instanceof Error ? err.message : 'Recall failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const resolve = (prefix: string, ids: string[]): string | undefined =>
    ids.find((id) => id.startsWith(prefix)) ?? records.find((r) => r.id.startsWith(prefix))?.id;

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied('copied'))
      .catch(() => setCopied('failed'));
  };

  return (
    <div className="at-scroll">
      <div className="at-page rc-page">
        <h1 className="at-display">What my AI knows</h1>
        <p className="at-lede">
          Ask what your AI might be asked. This is the exact text Engram hands it back; every reference opens its memory.
        </p>
        <form
          className="rc-field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', input.trim() || null);
          }}
        >
          <Icon name="route" size={20} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What might your AI be asked?"
            aria-label="Question for recall"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="at-btn" disabled={!input.trim()}>
            Ask
          </button>
        </form>

        {answer.status === 'loading' && <p className="rc-state" aria-live="polite">Recalling…</p>}
        {answer.status === 'error' && (
          <p className="rc-state" role="alert">
            Recall failed: {answer.message}
          </p>
        )}
        {answer.status === 'done' && !answer.context && (
          <div className="rc-empty">
            <p>Nothing. For “{answer.query}” your AI would get no memories back.</p>
            <p className="rc-muted">If it should know something about this, store it as a memory.</p>
            <button type="button" className="at-btn sec" onClick={onStore}>
              <Icon name="plus" size={16} />
              Store a memory
            </button>
          </div>
        )}
        {answer.status === 'done' && answer.context && (
          <figure className="rc-frame">
            <figcaption>
              <span>
                {answer.ids.length} {answer.ids.length === 1 ? 'memory' : 'memories'}, {answer.context.length.toLocaleString('en-US')}{' '}
                characters
              </span>
              <button type="button" className="at-btn sec" onClick={() => copy(answer.context)}>
                {copied === 'copied' ? 'Copied' : 'Copy'}
              </button>
            </figcaption>
            <pre>
              {answer.context.split(REF).map((part, i) => {
                const id = i % 2 === 1 ? resolve(part.slice(1, 9), answer.ids) : undefined;
                if (!id) return part;
                return (
                  <button key={i} type="button" className="rc-ref" aria-pressed={id === openId} onClick={() => selectNeuron(id)} title="Open this memory">
                    {part}
                  </button>
                );
              })}
            </pre>
            {copied === 'failed' && (
              <p role="alert" className="rc-state">
                The browser blocked the clipboard. Select the text above and copy it.
              </p>
            )}
          </figure>
        )}
      </div>
    </div>
  );
}
