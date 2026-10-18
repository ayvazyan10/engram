import { useState } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';

const MONO = 'var(--ec-font-mono)';

/** The `[8-char id · date]` prefix ContextAssembler puts on every line. */
const REF = /(\[[0-9a-f]{8} · [^\]\n]+\])/;

/**
 * Home's second lens on the search box: the exact block `recall_context`
 * hands an AI for the words typed above. SearchBar already asks /api/recall
 * for every search (with recall_context's own token budget), so this reads
 * that answer from the store rather than asking twice. Each `[id · date]`
 * prefix opens its memory in the inspector.
 */
export default function WhatAiKnows({ onStore }: { onStore: () => void }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const { currentContext, contextIds, searchQuery, isSearching, records } = useMemoryStore();
  const { selectedNeuronId, selectNeuron } = useNeuralStore();
  // Keyed to the text it copied, so a new recall reads "Copy" again.
  const [copy, setCopy] = useState<{ text: string; ok: boolean } | null>(null);
  const copyState = copy?.text === currentContext ? (copy.ok ? 'copied' : 'failed') : 'idle';
  const copyContext = () => {
    const text = currentContext;
    navigator.clipboard
      .writeText(text)
      .then(() => setCopy({ text, ok: true }))
      .catch(() => setCopy({ text, ok: false }));
  };

  const resolve = (prefix: string): string | undefined =>
    contextIds.find((id) => id.startsWith(prefix)) ?? records.find((r) => r.id.startsWith(prefix))?.id;

  return (
    <section aria-labelledby="ec-ai-title" style={s.section}>
      <h1 id="ec-ai-title" style={{ ...s.title, color: t.textPrimary }}>What your AI would receive</h1>
      <p style={{ ...s.lede, color: t.textSecondary }}>
        This is the exact text your AI gets back when it asks Engram about these words — click any{' '}
        <span style={{ fontFamily: MONO, whiteSpace: 'nowrap' }}>[id · date]</span> to open that memory.
      </p>

      {!searchQuery && !isSearching && (
        <p style={{ ...s.state, color: t.textMuted }}>Type what your AI might be asked, then press Enter.</p>
      )}

      {isSearching && <p style={{ ...s.state, color: t.textMuted }}>Recalling…</p>}

      {searchQuery && !isSearching && !currentContext && (
        <div style={{ ...s.empty, borderColor: t.panelBorder }}>
          <p style={{ ...s.state, color: t.textPrimary }}>
            Nothing. For &ldquo;{searchQuery}&rdquo; your AI would get no memories back.
          </p>
          <p style={{ ...s.state, color: t.textMuted }}>
            If it should know something about this, store it as a memory.
          </p>
          <button
            type="button"
            className="ec-hover-tint"
            onClick={onStore}
            style={{ ...s.button, color: t.textSecondary, borderColor: t.panelBorder }}
          >
            Store a memory
          </button>
        </div>
      )}

      {searchQuery && !isSearching && currentContext && (
        <figure style={{ ...s.frame, borderColor: t.panelBorder, background: t.inputBg }}>
          <figcaption style={{ ...s.bar, borderBottomColor: t.panelBorder, color: t.textMuted }}>
            <span style={{ fontFamily: MONO, color: t.textSecondary }}>recall_context</span>
            <span className="ec-tabular">
              {contextIds.length} {contextIds.length === 1 ? 'memory' : 'memories'} · {currentContext.length.toLocaleString()} characters
            </span>
            <button
              type="button"
              className="ec-hover-tint"
              onClick={copyContext}
              style={{ ...s.button, ...s.copy, color: t.textSecondary, borderColor: t.panelBorder }}
            >
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
          </figcaption>
          <pre style={{ ...s.pre, color: t.textPrimary }}>
            {currentContext.split(REF).map((part, i) => {
              const id = i % 2 === 1 ? resolve(part.slice(1, 9)) : undefined;
              if (!id) return part;
              const selected = id === selectedNeuronId;
              return (
                <button
                  key={i}
                  type="button"
                  className="ec-hover-tint"
                  onClick={() => selectNeuron(id)}
                  aria-pressed={selected}
                  title="Open this memory"
                  style={{
                    ...s.ref,
                    color: t.accent,
                    background: withAlpha(t.accent, selected ? 0.22 : 0.1),
                  }}
                >
                  {part}
                </button>
              );
            })}
          </pre>
          {copyState === 'failed' && (
            <p role="alert" style={{ ...s.state, ...s.copyFailed, color: STATUS.danger }}>
              The browser blocked the clipboard. Select the text above and copy it.
            </p>
          )}
        </figure>
      )}
    </section>
  );
}

const s = {
  section: { display: 'flex', flexDirection: 'column' as const, gap: SPACE.sm, marginTop: SPACE.sm },
  title: { margin: 0, fontSize: TYPE.xl, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em' },
  lede: { margin: `0 0 ${SPACE.sm}`, fontSize: TYPE.base, lineHeight: 1.55, maxWidth: '68ch' },
  state: { margin: 0, fontSize: TYPE.base, lineHeight: 1.5 },
  empty: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', gap: SPACE.sm,
    padding: SPACE.lg, border: '1px dashed', borderRadius: RADIUS.md,
  },
  frame: { margin: 0, border: '1px solid', borderRadius: RADIUS.md, overflow: 'hidden', minWidth: 0 },
  bar: {
    display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' as const,
    padding: `${SPACE.xs} ${SPACE.xs} ${SPACE.xs} ${SPACE.md}`, borderBottom: '1px solid', fontSize: TYPE.sm,
  },
  pre: {
    margin: 0, padding: `${SPACE.md} ${SPACE.lg} ${SPACE.lg}`, fontFamily: MONO, fontSize: TYPE.sm,
    lineHeight: 1.7, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const,
  },
  ref: {
    display: 'inline', padding: `0 ${SPACE['3xs']}`, border: 'none', borderRadius: RADIUS.tight,
    font: 'inherit', cursor: 'pointer',
  },
  button: {
    minHeight: 28, padding: `0 ${SPACE.md}`, background: 'transparent', border: '1px solid',
    borderRadius: RADIUS.sm, fontSize: TYPE.sm, fontWeight: WEIGHT.medium, fontFamily: 'inherit',
  },
  copy: { marginLeft: 'auto' },
  copyFailed: { padding: `0 ${SPACE.lg} ${SPACE.md}`, fontSize: TYPE.sm },
} as const;
