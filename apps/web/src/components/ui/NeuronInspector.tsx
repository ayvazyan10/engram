import { useEffect, useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { useTemplateStore, type UITemplate } from '../../store/templateStore.js';
import { api } from '../../lib/api.js';
import { asMemoryRecord } from '../../hooks/useWebSocket.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, WEIGHT, withAlpha } from '../../lib/tokens.js';
import { parseTagLabel } from '../../lib/tagLabel.js';
import { memoryRowText, toPlainText } from '../../lib/plainText.js';
import { formatDateTime } from '../../lib/dates.js';
import ConfirmDialog from './ConfirmDialog.js';
import MemoryEditForm from './MemoryEditForm.js';
import { TypeTag } from './DataMark.js';

/** One edge of the selected memory, with the memory at its other end named:
 *  a relationship and a bar alone did not say what it connects to. */
type GraphConn = { id: string; otherId: string; otherLabel: string; relationship: string; strength: number };

/** H10: the longest record in the store is 6201 characters, which rendered a
 *  ~4000px-tall column at 12px in a 210px-wide panel — with every interactive
 *  control (tags, resolve buttons) below it. Ten lines is enough to tell what
 *  a memory is; "Show all" is one click away. */
const CONTENT_CLAMP_LINES = 10;

/** Roughly how many characters fit on one line of the inspector's ~210px
 *  text column at TYPE.base. Only used to decide whether the "Show all"
 *  toggle is worth drawing — the clamp itself is done in CSS, which measures
 *  properly. */
const CHARS_PER_LINE_ESTIMATE = 35;
const CONTENT_CLAMP_THRESHOLD = CONTENT_CLAMP_LINES * CHARS_PER_LINE_ESTIMATE;
const clampVars = { '--ec-clamp-lines': CONTENT_CLAMP_LINES } as CSSProperties;

/** First line of the memory shown in the archive confirmation, so the user
 *  can see what they are about to archive. */
const CONFIRM_EXCERPT_LENGTH = 160;

/** One message shape for every failed write, with the server's own reason
 *  kept when it sent one. */
function failureMessage(action: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : '';
  return reason ? `${action}: ${reason}` : action;
}

export default function NeuronInspector() {
  const { selectedNeuronId, selectNeuron, contradictionPairs, removeNeuron, setContradictionPairs } = useNeuralStore();
  const { records, removeRecord, updateRecordTags, updateRecord } = useMemoryStore();
  const t = useTemplateStore((s) => s.activeTemplate);
  const [conns, setConns] = useState<GraphConn[]>([]);
  // A failed neighbourhood fetch used to make the section vanish, which read
  // as "no connections". It is said instead.
  const [connsError, setConnsError] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(false);
  // H7: archive, add tag, remove tag and resolve-contradiction all caught
  // into `console.error`. This is the one panel in the app that writes, and
  // it was the only one that told the user nothing when a write failed —
  // every other surface (SearchBar, MemoryPanel, AnalyticsView,
  // ReflectionView) already surfaces its failures in the UI.
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [showAllContent, setShowAllContent] = useState(false);
  const [editing, setEditing] = useState(false);
  /** The confirmation a save leaves behind, until the reader moves on. */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // W8: a search hit outside the first 200 loaded memories (the server caps
  // listMemories there) selects an id `records` has never heard of.
  // getGraph's `node` field already carries the full row for this id — reuse
  // it instead of leaving the inspector on "Select a neuron to inspect".
  const [fallbackMemory, setFallbackMemory] = useState<MemoryRecord | null>(null);

  const memory: MemoryRecord | undefined =
    records.find((r) => r.id === selectedNeuronId) ?? fallbackMemory ?? undefined;

  useEffect(() => {
    setConns([]);
    setConnsError(false);
    setFallbackMemory(null);
    // A failure belongs to the record it happened on — moving to another
    // record clears it, along with the per-record view state.
    setActionError(null);
    setConfirmingArchive(false);
    setShowAllContent(false);
    setEditing(false);
    setSavedNote(null);
    if (!selectedNeuronId) return;
    // W5: no id check on resolve meant a slow response for a previously
    // selected neuron could arrive after a newer selection and overwrite its
    // connections. `cancelled` (set on cleanup, which fires the instant
    // `selectedNeuronId` changes again) makes a stale resolution a no-op.
    let cancelled = false;
    api.getGraph(selectedNeuronId)
      .then((g) => {
        if (cancelled) return;
        const labels = new Map<string, string>();
        for (const row of g.neighbors ?? []) {
          const neighbour = asMemoryRecord(row);
          if (neighbour) labels.set(neighbour.id, memoryRowText(neighbour).primary);
        }
        setConns(
          (g.connections ?? []).map((c) => {
            const otherId = c.sourceId === selectedNeuronId ? c.targetId : c.sourceId;
            return {
              id: c.id,
              otherId,
              otherLabel: labels.get(otherId) ?? otherId.slice(0, 8),
              relationship: c.relationship,
              strength: c.strength,
            };
          })
        );
        const node = asMemoryRecord(g.node);
        if (node) setFallbackMemory(node);
      })
      .catch(() => {
        if (!cancelled) setConnsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNeuronId]);

  // Sync local tags when memory changes
  useEffect(() => {
    if (memory) {
      try { setLocalTags(JSON.parse(memory.tags ?? '[]')); } catch { setLocalTags([]); }
    }
  }, [memory]);

  const contradictions = contradictionPairs.filter(
    (p) => p.sourceId === selectedNeuronId || p.targetId === selectedNeuronId
  );

  const handleArchive = useCallback(async () => {
    if (!selectedNeuronId) return;
    setDeleting(true);
    try {
      await api.deleteMemory(selectedNeuronId);
      removeRecord(selectedNeuronId);
      removeNeuron(selectedNeuronId);
      setConfirmingArchive(false);
      selectNeuron(null);
    } catch (err) {
      setActionError(failureMessage('Could not archive this memory', err));
    }
    setDeleting(false);
  }, [selectedNeuronId, removeRecord, removeNeuron, selectNeuron]);

  const handleAddTag = useCallback(async () => {
    if (!selectedNeuronId || !tagInput.trim()) return;
    try {
      const res = await api.addTag(selectedNeuronId, tagInput.trim());
      setLocalTags(res.tags);
      // Also write through to the store: the sync effect re-derives localTags
      // from the record, so without this the edit reverted on reselect.
      updateRecordTags(selectedNeuronId, res.tags);
      setTagInput('');
      setActionError(null);
    } catch (err) {
      setActionError(failureMessage('Could not add that tag', err));
    }
  }, [selectedNeuronId, tagInput, updateRecordTags]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!selectedNeuronId) return;
    try {
      const res = await api.removeTag(selectedNeuronId, tag);
      setLocalTags(res.tags);
      updateRecordTags(selectedNeuronId, res.tags);
      setActionError(null);
    } catch (err) {
      setActionError(failureMessage(`Could not remove the tag "${tag}"`, err));
    }
  }, [selectedNeuronId, updateRecordTags]);

  const handleSaved = useCallback((updated: MemoryRecord, reindexed: boolean) => {
    // Both copies: `records` for a loaded memory (and the cards that show
    // it), the fallback for one selected from beyond the loaded page.
    updateRecord(updated);
    setFallbackMemory(updated);
    setEditing(false);
    setActionError(null);
    setSavedNote(reindexed ? 'Saved and re-indexed for search.' : 'Saved.');
  }, [updateRecord]);

  const handleResolve = useCallback(async (sourceId: string, targetId: string, strategy: string) => {
    setResolving(true);
    try {
      const res = await api.resolveContradiction(sourceId, targetId, strategy);
      if (res.resolved) {
        // Refresh contradictions
        const updated = await api.getContradictions();
        setContradictionPairs(
          updated.contradictions.map((c) => ({
            sourceId: c.source.id,
            targetId: c.target.id,
            confidence: c.confidence,
          }))
        );
        if (res.archivedId) {
          removeRecord(res.archivedId);
          removeNeuron(res.archivedId);
        }
      }
      setActionError(null);
    } catch (err) {
      setActionError(failureMessage('Could not resolve this contradiction', err));
    }
    setResolving(false);
  }, [setContradictionPairs, removeRecord, removeNeuron]);

  if (!selectedNeuronId || !memory) {
    return (
      <div style={styles.empty}>
        {/* Decorative glyph — stays dim on purpose, it carries no information
         * a screen reader or a sighted user needs; the instructional copy
         * below it (emptyText) is what had to clear 4.5:1 (V4). */}
        <div style={{ ...styles.emptyGlyph, color: t.panelBorder }} aria-hidden="true">{GLYPH.nothingSelected}</div>
        <div style={{ ...styles.emptyText, color: t.textSecondary }}>Select a neuron to inspect</div>
        <div style={{ ...styles.emptyHint, color: t.textMuted }}>Click a node in the graph, or a memory in the list.</div>
      </div>
    );
  }

  // Bars and fills wear this; text never does (F2).
  const color = TYPE_COLORS[memory.type] ?? t.textSecondary;
  // H4: memory bodies are Markdown written by an LLM, and this panel printed
  // the source verbatim — records opened with a literal '# Memory Analysis:'.
  const conceptText = memory.concept ? toPlainText(memory.concept) : '';
  const contentText = toPlainText(memory.content);
  const summaryText = memory.summary ? toPlainText(memory.summary) : '';

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerMeta}>
          <TypeTag type={memory.type} style={styles.badge} />
          {memory.source && <span style={{ ...styles.source, color: t.textMuted }}>{memory.source}</span>}
        </div>
        <div style={{ display: 'flex', gap: SPACE['2xs'] }}>
          {!editing && (
            <button
              className="ec-hover-tint"
              style={{ ...styles.editBtn, background: t.inputBg, borderColor: t.panelBorder, color: t.textSecondary }}
              onClick={() => {
                setSavedNote(null);
                setEditing(true);
              }}
              title="Correct this memory"
            >
              <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }} aria-hidden="true">
                <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              Edit
            </button>
          )}
          <button
            className="ec-hover-tint"
            style={{ ...styles.iconBtn, background: t.inputBg, borderColor: t.panelBorder, color: STATUS.danger, opacity: deleting ? 0.4 : 1 }}
            onClick={() => setConfirmingArchive(true)}
            disabled={deleting}
            title="Archive memory"
            aria-label="Archive memory"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="ec-hover-tint"
            style={{ ...styles.iconBtn, background: t.inputBg, borderColor: t.panelBorder, color: t.textSecondary }}
            onClick={() => selectNeuron(null)}
            title="Close"
            aria-label="Close inspector"
          >
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }} aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Importance bar */}
      {!editing && <div style={styles.importanceRow}>
        <span style={{ ...styles.dimLabel, color: t.textMuted }}>Importance</span>
        <div style={{ ...styles.importanceTrack, background: t.inputBg }}>
          <div style={{ ...styles.importanceFill, width: `${Math.round(memory.importance * 100)}%`, background: color }} />
        </div>
        {/* F2: this read-out used to wear the type colour. The bar beside it
            is the mark; the number is ink. */}
        <span className="ec-tabular" style={{ color: t.textPrimary, fontSize: TYPE.sm, fontWeight: WEIGHT.semibold, minWidth: '32px', textAlign: 'right' as const }}>{Math.round(memory.importance * 100)}%</span>
      </div>}

      <div style={{ ...styles.divider, background: t.panelBorder }} />

      {/* H7: every write this panel makes reports its failure here, in the
          same banner style the rest of the app uses for a failed load. */}
      {actionError && (
        <div
          role="alert"
          style={{ ...styles.actionError, border: `1px solid ${withAlpha(STATUS.danger, 0.3)}`, background: withAlpha(STATUS.danger, 0.07) }}
        >
          <span style={{ ...styles.actionErrorText, color: STATUS.danger }}>{GLYPH.warning} {actionError}</span>
          <button
            className="ec-hover-tint"
            style={{ ...styles.actionErrorDismiss, color: STATUS.danger }}
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {savedNote && (
        <div role="status" style={{ ...styles.savedNote, color: STATUS.success, background: withAlpha(STATUS.success, 0.08), border: `1px solid ${withAlpha(STATUS.success, 0.3)}` }}>
          ✓ {savedNote}
        </div>
      )}

      {editing ? (
        <MemoryEditForm
          key={memory.id}
          memory={memory}
          tags={localTags}
          onCancel={() => setEditing(false)}
          onSaved={handleSaved}
        />
      ) : (
        <div style={styles.body}>
          {/* Concept — L1: was a bordered chip identical in shape to the
              sidebar's (then-inert) filter pills, so it promised an interaction
              it never had. Flattened to the same tinted label the type badge
              above it uses, which reads as a label rather than a control. */}
          {conceptText && (
            <Section label="Concept" t={t}>
              <div className="ec-wrap-anywhere" style={{ ...styles.conceptChip, background: withAlpha(color, 0.13), color: t.textPrimary }}>{conceptText}</div>
            </Section>
          )}

          {/* Tags — editable. H10: the write controls used to sit below an
              unbounded Content block (up to ~4000px tall), which put every
              interactive thing in this panel below the fold. */}
          <TagsSection
            t={t}
            tags={localTags}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />

          {/* Date */}
          <Section label="Stored" t={t}>
            <div className="ec-tabular" style={{ ...styles.meta, color: t.textMuted }}>{formatDateTime(memory.createdAt)}</div>
          </Section>

          {/* Content */}
          <Section label="Content" t={t}>
            <div
              className={showAllContent ? 'ec-wrap-anywhere' : 'ec-wrap-anywhere ec-clamp'}
              style={{ ...styles.content, color: t.textPrimary, ...(showAllContent ? {} : clampVars) }}
            >
              {contentText}
            </div>
            {contentText.length > CONTENT_CLAMP_THRESHOLD && (
              <button
                className="ec-hover-tint"
                style={{ ...styles.showAllBtn, color: t.textMuted, borderColor: t.panelBorder }}
                onClick={() => setShowAllContent((v) => !v)}
                aria-expanded={showAllContent}
              >
                {showAllContent ? 'Show less' : `Show all · ${contentText.length} chars`}
              </button>
            )}
          </Section>

          {/* Summary */}
          {summaryText && (
            <Section label="Summary" t={t}>
              <div className="ec-wrap-anywhere" style={{ ...styles.summary, color: t.textSecondary }}>{summaryText}</div>
            </Section>
          )}

          {contradictions.length > 0 && (
            <ContradictionsSection
              contradictions={contradictions}
              records={records}
              selectedNeuronId={selectedNeuronId}
              resolving={resolving}
              onResolve={handleResolve}
              t={t}
            />
          )}

          {connsError ? (
            <Section label="Connections" t={t}>
              <div style={{ ...styles.meta, color: t.textMuted }}>Could not load this memory&rsquo;s connections.</div>
            </Section>
          ) : (
            conns.length > 0 && <ConnectionsSection conns={conns} color={color} onSelect={selectNeuron} t={t} />
          )}
        </div>
      )}

      {/* H8: was a native confirm(). There is no un-archive route on the
          server (`DELETE /memory/:id` is the only archive call, and nothing
          restores), so an "Archived · Undo" affordance could only be a
          client-side deferred delete that silently never archives if the tab
          closes inside the undo window. A themed, focus-trapped confirmation
          that shows WHICH memory is about to go is the honest version. */}
      {confirmingArchive && (
        <ConfirmDialog
          title="Archive memory"
          message="This memory is archived on the server, not deleted — but it leaves the graph, the timeline and search results."
          subject={
            <>
              {conceptText && <span style={{ ...styles.confirmConcept, color: t.textPrimary }}>{conceptText}</span>}
              <span className="ec-wrap-anywhere" style={{ ...styles.confirmExcerpt, color: t.textSecondary }}>
                {contentText.slice(0, CONFIRM_EXCERPT_LENGTH)}{contentText.length > CONFIRM_EXCERPT_LENGTH ? '…' : ''}
              </span>
            </>
          }
          confirmLabel="Archive"
          busy={deleting}
          onConfirm={handleArchive}
          onCancel={() => setConfirmingArchive(false)}
        />
      )}
    </div>
  );
}

function Section({ label, t, children }: { label: string; t: UITemplate; children: ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: t.textMuted }}>{label}</div>
      {children}
    </div>
  );
}

function TagsSection({ t, tags, tagInput, onTagInputChange, onAddTag, onRemoveTag }: {
  t: UITemplate;
  tags: string[];
  tagInput: string;
  onTagInputChange: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  return (
    <Section label="Tags" t={t}>
      <div style={styles.tagRow}>
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} t={t} onRemove={onRemoveTag} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: SPACE['2xs'], marginTop: SPACE['2xs'] }}>
        <input
          style={{ ...styles.tagInput, background: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary }}
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddTag()}
          placeholder="Add tag…"
        />
        {tagInput && (
          <button className="ec-primary" style={{ ...styles.tagAddBtn, background: t.accentStrong, color: t.onAccent }} onClick={onAddTag} aria-label="Add tag" title="Add tag">+</button>
        )}
      </div>
    </Section>
  );
}

/** Shown in place of a tag that is empty or all whitespace. `handleAddTag`
 *  trims, so this UI cannot create one — but another client can, and a chip
 *  you cannot see is a chip you cannot remove. */
const EMPTY_TAG_LABEL = '(empty)';

/** One tag. The whole, untouched tag is on `title` and on the remove
 *  control's accessible name; only what is *drawn* is ever shortened. */
function TagChip({ tag, t, onRemove }: { tag: string; t: UITemplate; onRemove: (tag: string) => void }) {
  return (
    <span title={tag} style={{ ...styles.tag, background: t.inputBg, borderColor: t.panelBorder }}>
      <TagChipLabel tag={tag} t={t} />
      <button
        className="ec-hover-tint"
        style={{ ...styles.tagRemove, color: t.textMuted }}
        onClick={() => onRemove(tag)}
        aria-label={`Remove tag ${tag}`}
      >
        ×
      </button>
    </span>
  );
}

/** Emphasis follows information (see lib/tagLabel.ts): the half of the tag a
 *  human can actually read takes textSecondary + medium weight, the
 *  ceremony around it recedes to textMuted. Both roles are already proven at
 *  4.5:1 against inputBg — the chip's surface — for all three templates in
 *  templateStore.contrast.test.ts. */
function TagChipLabel({ tag, t }: { tag: string; t: UITemplate }) {
  const { prefix, value, emphasis } = parseTagLabel(tag);
  const lead = { color: t.textSecondary, fontWeight: WEIGHT.medium };
  const trail = { color: t.textMuted, fontWeight: WEIGHT.regular };

  if (prefix === '' && value === '') {
    return <span style={{ ...styles.tagLabel, ...trail, fontStyle: 'italic' }}>{EMPTY_TAG_LABEL}</span>;
  }

  return (
    <span style={styles.tagLabel}>
      {prefix !== '' && <span style={emphasis === 'prefix' ? lead : trail}>{prefix}</span>}
      {value !== '' && <span style={emphasis === 'value' ? lead : trail}>{value}</span>}
    </span>
  );
}

function ContradictionsSection({ contradictions, records, selectedNeuronId, resolving, onResolve, t }: {
  contradictions: { sourceId: string; targetId: string; confidence: number }[];
  records: MemoryRecord[];
  selectedNeuronId: string;
  resolving: boolean;
  onResolve: (sourceId: string, targetId: string, strategy: string) => void;
  t: UITemplate;
}) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: STATUS.contradiction }}>Contradictions · {contradictions.length}</div>
      {contradictions.map((c) => {
        const otherId = c.sourceId === selectedNeuronId ? c.targetId : c.sourceId;
        const other = records.find((r) => r.id === otherId);
        return (
          // W14: sourceId+targetId (not array index) — handleResolve replaces
          // this list, and an index key made React reuse a resolved card's
          // DOM node in place for whatever now sits at that position, which
          // silently carried over stray DOM-owned state (e.g. focus) from
          // the card that was just resolved away onto an unrelated one.
          <div key={`${c.sourceId}:${c.targetId}`} style={{ ...styles.contradictionCard, background: withAlpha(STATUS.contradiction, 0.08), borderColor: withAlpha(STATUS.contradiction, 0.3) }}>
            <div style={{ fontSize: TYPE.sm, color: t.textSecondary, lineHeight: 1.5 }}>
              {other?.content.slice(0, 100) ?? otherId.slice(0, 8)}
              {(other?.content.length ?? 0) > 100 ? '…' : ''}
            </div>
            <div className="ec-tabular" style={{ fontSize: TYPE.sm, color: STATUS.contradiction, marginTop: SPACE['2xs'] }}>
              Confidence {Math.round(c.confidence * 100)}%
            </div>
            <div style={{ display: 'flex', gap: SPACE['2xs'], marginTop: SPACE.xs, flexWrap: 'wrap' }}>
              {['keep_newest', 'keep_oldest', 'keep_important', 'keep_both'].map((s) => (
                <button
                  key={s}
                  className="ec-hover-tint"
                  style={{ ...styles.resolveBtn, color: STATUS.contradiction, borderColor: withAlpha(STATUS.contradiction, 0.3) }}
                  onClick={() => onResolve(c.sourceId, c.targetId, s)}
                  disabled={resolving}
                >
                  {s.replace('keep_', '')}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectionsSection({ conns, color, onSelect, t }: {
  conns: GraphConn[];
  color: string;
  onSelect: (id: string) => void;
  t: UITemplate;
}) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionLabel, color: t.textMuted }}>Connections · {conns.length}</div>
      <div style={styles.connList}>
        {conns.map((c) => {
          const isContradiction = c.relationship === 'contradicts';
          return (
            <button
              key={c.id}
              className="ec-hover-tint"
              style={styles.connItem}
              onClick={() => onSelect(c.otherId)}
              title={`Inspect: ${c.otherLabel}`}
            >
              <span style={{ ...styles.connLabel, color: t.textPrimary }}>{c.otherLabel}</span>
              <span style={styles.connRow}>
                <span style={{ ...styles.relBadge, background: t.inputBg, color: isContradiction ? STATUS.contradiction : t.textMuted }}>
                  {c.relationship}
                </span>
                <span style={{ ...styles.strengthTrack, background: t.inputBg }}>
                  <span style={{ ...styles.strengthFill, width: `${Math.round(c.strength * 100)}%`, background: isContradiction ? STATUS.contradiction : color }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  panel: { display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' },
  empty: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100%', gap: SPACE['2xs'], padding: SPACE.xl, textAlign: 'center' as const },
  emptyGlyph: { fontSize: TYPE.glyph, lineHeight: 1, marginBottom: SPACE.xs },
  emptyText: { fontSize: TYPE.base, fontWeight: WEIGHT.medium, lineHeight: 1.5 },
  emptyHint: { fontSize: TYPE.sm, lineHeight: 1.5, maxWidth: 200 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.sm, padding: `${SPACE.md} ${SPACE.lg} ${SPACE.sm}` },
  headerMeta: { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', gap: SPACE['2xs'], minWidth: 0 },
  badge: { padding: '3px 8px', borderRadius: RADIUS.sm },
  source: { fontSize: TYPE.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%' },
  iconBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid', borderRadius: RADIUS.sm, flexShrink: 0,
  },
  editBtn: {
    height: 28, display: 'flex', alignItems: 'center', gap: SPACE.xs, padding: `0 ${SPACE.sm}`,
    border: '1px solid', borderRadius: RADIUS.sm, flexShrink: 0,
    fontSize: TYPE.sm, fontWeight: WEIGHT.medium, fontFamily: 'inherit',
  },
  savedNote: {
    margin: `${SPACE.sm} ${SPACE.lg} 0`, padding: `${SPACE.xs} ${SPACE.sm}`,
    borderRadius: RADIUS.sm, fontSize: TYPE.sm, lineHeight: 1.4,
  },
  importanceRow: { display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: `${SPACE['2xs']} ${SPACE.lg} ${SPACE.md}` },
  dimLabel: { fontSize: TYPE.sm, minWidth: '60px' },
  importanceTrack: { flex: 1, height: '3px', borderRadius: '2px', overflow: 'hidden' },
  importanceFill: { height: '100%', borderRadius: '2px', opacity: 0.9 },
  divider: { height: '1px', flexShrink: 0 },
  body: { flex: 1, overflowY: 'auto' as const, padding: SPACE.lg, display: 'flex', flexDirection: 'column' as const, gap: SPACE.xl },
  section: { display: 'flex', flexDirection: 'column' as const, gap: SPACE.xs },
  // Sentence case, medium, a shade under the body: a label names the block
  // beneath it and then gets out of the way. The tracked capitals it used to
  // wear made every label as loud as the content it introduced.
  sectionLabel: { fontSize: TYPE.sm, fontWeight: WEIGHT.medium, letterSpacing: '0.01em', lineHeight: 1.3 },
  conceptChip: { display: 'inline-block', fontSize: TYPE.base, fontWeight: WEIGHT.medium, padding: `${SPACE['3xs']} ${SPACE.sm}`, borderRadius: RADIUS.sm, width: 'fit-content', maxWidth: '100%', lineHeight: 1.45 },
  content: { fontSize: TYPE.base, lineHeight: 1.6 },
  showAllBtn: {
    alignSelf: 'flex-start',
    marginTop: SPACE['2xs'],
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.medium,
    background: 'transparent',
    border: '1px solid',
    borderRadius: RADIUS.tight,
    padding: `${SPACE['3xs']} ${SPACE.sm}`,
    fontFamily: 'inherit',
    minHeight: 24,
  },
  actionError: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE.xs,
    margin: `${SPACE.sm} ${SPACE.lg} 0`,
    padding: `${SPACE.xs} ${SPACE.sm}`,
    borderRadius: RADIUS.sm,
  },
  actionErrorText: { fontSize: TYPE.sm, lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere' as const },
  actionErrorDismiss: {
    flexShrink: 0, width: SPACE.lg, height: SPACE.lg,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', padding: 0,
    fontSize: TYPE.base, lineHeight: 1, borderRadius: RADIUS.pill,
  },
  confirmConcept: { fontSize: TYPE.base, fontWeight: WEIGHT.semibold },
  confirmExcerpt: { fontSize: TYPE.sm, lineHeight: 1.55 },
  summary: { fontSize: TYPE.sm, lineHeight: 1.55 },
  tagRow: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'flex-start', gap: SPACE['2xs'], minWidth: 0 },
  // maxWidth + minWidth are the whole fix for the clipping: the inspector is
  // a fixed 252px with `overflow: hidden` (AppLayout), so a chip that cannot
  // shrink simply ran off the edge and was silently cut. Deliberately NOT
  // `overflow: hidden` here — that would clip the remove button's
  // focus-visible ring, which sits 2px outside its box.
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: SPACE['3xs'],
    maxWidth: '100%', minWidth: 0,
    fontSize: TYPE.sm, lineHeight: 1.4,
    padding: `${SPACE['3xs']} ${SPACE['3xs']} ${SPACE['3xs']} ${SPACE.xs}`,
    border: '1px solid', borderRadius: RADIUS.tight,
  },
  tagLabel: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  // Secondary to the label it deletes, in both size (TYPE.xs under the
  // label's TYPE.sm) and colour, with a real 16px target and a pill hover
  // tint so it still reads as a control. It was TYPE.base — larger than the
  // TYPE.xs label — which is why it read as part of the tag text.
  tagRemove: {
    flexShrink: 0, width: SPACE.lg, height: SPACE.lg,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', padding: 0,
    fontSize: TYPE.xs, lineHeight: 1, borderRadius: RADIUS.pill,
  },
  tagInput: {
    flex: 1, border: '1px solid', borderRadius: RADIUS.sm,
    padding: `${SPACE['2xs']} ${SPACE.sm}`, fontSize: TYPE.sm, minWidth: 0, minHeight: 26,
  },
  tagAddBtn: {
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: RADIUS.sm, fontSize: TYPE.lg,
    fontWeight: WEIGHT.medium, lineHeight: 1, flexShrink: 0,
  },
  meta: { fontSize: TYPE.sm },
  contradictionCard: {
    border: '1px solid', borderRadius: RADIUS.md, padding: SPACE.md,
  },
  resolveBtn: {
    fontSize: TYPE.sm, fontWeight: WEIGHT.medium, background: 'transparent', border: '1px solid',
    borderRadius: RADIUS.tight, padding: `${SPACE['3xs']} ${SPACE.sm}`, textTransform: 'capitalize' as const, minHeight: 24,
  },
  connList: { display: 'flex', flexDirection: 'column' as const, gap: SPACE.xs },
  connItem: {
    display: 'flex', flexDirection: 'column' as const, gap: SPACE['3xs'],
    width: '100%', padding: `${SPACE['3xs']} 0`, background: 'transparent', border: 'none',
    borderRadius: RADIUS.tight, textAlign: 'left' as const, fontFamily: 'inherit', cursor: 'pointer',
  },
  connLabel: { fontSize: TYPE.sm, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%' },
  connRow: { display: 'flex', alignItems: 'center', gap: SPACE.sm, width: '100%' },
  relBadge: { fontSize: TYPE.sm, padding: `${SPACE['3xs']} ${SPACE.xs}`, borderRadius: RADIUS.tight, whiteSpace: 'nowrap' as const, minWidth: '82px', lineHeight: 1.4 },
  strengthTrack: { display: 'block', flex: 1, height: '3px', borderRadius: '2px', overflow: 'hidden' },
  strengthFill: { display: 'block', height: '100%', borderRadius: '2px', opacity: 0.75 },
} as const;
