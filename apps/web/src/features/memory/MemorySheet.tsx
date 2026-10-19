import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore, type MemoryRecord } from '../../store/memoryStore.js';
import { showToast } from '../../shell/Toasts.js';
import { Icon } from '../../shell/icons.js';
import { api } from '../../lib/api.js';
import { asMemoryRecord } from '../../hooks/useWebSocket.js';
import { toPlainText, toReadableText } from '../../lib/plainText.js';
import { formatDateTime, formatRelative, formatShortDate } from '../../lib/dates.js';
import { useServerStats } from '../../lib/serverStats.js';
import { projectLabel } from '../../lib/projects.js';
import MemoryEdit from './MemoryEdit.js';
import { TYPE_NAME, TypeMark, isReflection } from './MemoryRow.js';
import { deferAction } from './deferredAction.js';
import { useMapStore } from '../map/mapStore.js';
import type { MapNode } from '../../lib/api.js';
import './memory.css';

/** One edge of the open memory, with the memory at its other end. */
export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  otherId: string;
  other: MemoryRecord | null;
  relationship: string;
  strength: number;
}

interface Detail {
  id: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
  node: MemoryRecord | null;
  links: Link[];
}

export interface DecayPolicy {
  halfLifeDays: number;
  archiveThreshold: number;
}

type Strategy = 'keep_newest' | 'keep_oldest' | 'keep_important' | 'keep_both';

const STRATEGIES: { strategy: Strategy; label: string }[] = [
  { strategy: 'keep_newest', label: 'Keep newest' },
  { strategy: 'keep_oldest', label: 'Keep oldest' },
  { strategy: 'keep_important', label: 'Keep important' },
  { strategy: 'keep_both', label: 'Keep both' },
];

/** Past this many characters the body folds, with "Show all" one click away. */
const CONTENT_FOLD = 420;
const CONTENT_FOLDED = 400;
const SHOWN_CONTRADICTIONS = 3;
const SHOWN_CONNECTIONS = 6;
/** The sheet's exit, in step with --dur-out. */
const EXIT_MS = 180;

/**
 * Days until a retention score crosses the archive threshold with no recall.
 * Retention halves every half-life, so it is the half-life times the number
 * of halvings between the two; negative once it is below.
 */
export function daysLeft(retention: number, policy: DecayPolicy): number {
  if (!(retention > 0)) return -Infinity;
  return policy.halfLifeDays * Math.log2(retention / policy.archiveThreshold);
}

/** Which memory a resolution archives, by the server's rule
 *  (core/lifecycle/contradictionResolution.ts); null for Keep both. */
export function predictLoser(
  source: Pick<MemoryRecord, 'id' | 'createdAt' | 'importance'>,
  target: Pick<MemoryRecord, 'id' | 'createdAt' | 'importance'>,
  strategy: Strategy
): string | null {
  if (strategy === 'keep_both') return null;
  if (strategy === 'keep_important') return source.importance >= target.importance ? target.id : source.id;
  const [newer, older] = Date.parse(source.createdAt) >= Date.parse(target.createdAt) ? [source, target] : [target, source];
  return strategy === 'keep_newest' ? older.id : newer.id;
}

function parseTags(raw: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function reason(err: unknown): string {
  return err instanceof Error && err.message ? `: ${err.message}` : '.';
}

function percent(n: number): string {
  return n > 0 && n < 0.01 ? '<1%' : `${Math.round(n * 100)}%`;
}

let policyRequest: Promise<DecayPolicy> | null = null;
/** The decay policy changes rarely; one request serves every sheet. */
export function loadPolicy(): Promise<DecayPolicy> {
  policyRequest ??= api.getDecayPolicy().catch((err: unknown) => {
    policyRequest = null;
    throw err;
  });
  return policyRequest;
}

/** Forgets the cached decay policy. Tests reset it between cases. */
export function resetPolicyCache(): void {
  policyRequest = null;
}

/**
 * The memory sheet, opened over any route by `?m=<id>` (the shell keeps the
 * link and the selection in step). It stays mounted through its exit, takes
 * focus when it opens, keeps Tab inside, and hands focus back to whatever
 * opened it when it closes.
 */
export default function MemorySheet() {
  const openId = useNeuralStore((s) => s.selectedNeuronId);
  const [shown, setShown] = useState<{ id: string; closing: boolean } | null>(openId ? { id: openId, closing: false } : null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (openId) {
      setShown((prev) => {
        if (!prev) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return { id: openId, closing: false };
      });
      return;
    }
    setShown((prev) => (prev ? { ...prev, closing: true } : null));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => {
      setShown(null);
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
      else document.querySelector<HTMLElement>('input[aria-label="Search memories"], main')?.focus();
    }, reduced ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [openId]);

  if (!shown) return null;
  return <Sheet id={shown.id} closing={shown.closing} />;
}

function Sheet({ id, closing }: { id: string; closing: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const editTabRef = useRef<HTMLButtonElement>(null);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const listed = useMemoryStore(
    (s) => s.records.find((r) => r.id === id) ?? s.searchResults.find((r) => r.id === id) ?? s.weakerResults.find((r) => r.id === id)
  );
  const known = useServerStats()?.byNamespace.map((b) => b.namespace) ?? [];
  const [detail, setDetail] = useState<Detail>({ id, status: 'loading', node: null, links: [] });
  const [policy, setPolicy] = useState<DecayPolicy | null>(null);
  // Retention is the server's (on the map payload), not recomputed here.
  const score = useMapStore((s) => {
    const i = s.model?.at.get(id);
    return i === undefined ? undefined : s.model!.nodes[i];
  });
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [expanded, setExpanded] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    setMode('read');
    setExpanded(false);
    setAllLinks(false);
    setActionError(null);
    setTagInput('');
    setResolved({});
    // Focus moves in when the sheet opens, and stays inside when a link
    // opens another memory in its place.
    dialogRef.current?.focus();
    const body = dialogRef.current?.querySelector('.mm-body');
    if (body) body.scrollTop = 0;
    let cancelled = false;
    setDetail({ id, status: 'loading', node: null, links: [] });
    api
      .getGraph(id, 1)
      .then((g) => {
        if (cancelled) return;
        const node = asMemoryRecord(g.node);
        const others = new Map<string, MemoryRecord>();
        for (const row of g.neighbors ?? []) {
          const other = asMemoryRecord(row);
          if (other) others.set(other.id, other);
        }
        const links = (g.connections ?? []).map((c) => {
          const otherId = c.sourceId === id ? c.targetId : c.sourceId;
          return { ...c, otherId, other: others.get(otherId) ?? null };
        });
        setDetail({ id, status: node ? 'ready' : 'missing', node, links });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status === 404 ? 'missing' : 'error';
        setDetail({ id, status, node: null, links: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    loadPolicy()
      .then((p) => !cancelled && setPolicy(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // What was fetched for an earlier memory never stands in for this one.
  const current: Detail = detail.id === id ? detail : { id, status: 'loading', node: null, links: [] };
  const memory: MemoryRecord | null = current.node || listed ? ({ ...current.node, ...listed } as MemoryRecord) : null;
  const tags = parseTags(memory?.tags);
  const close = useCallback(() => selectNeuron(null), [selectNeuron]);

  /** A changed memory, in the list it came from and in this sheet. */
  const keep = (next: MemoryRecord) => {
    useMemoryStore.getState().updateRecord(next);
    setDetail((d) => (d.node ? { ...d, node: { ...d.node, ...next } } : d));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (mode === 'edit') {
        setMode('read');
        editTabRef.current?.focus();
      } else close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled)')];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const archive = () => {
    if (!memory) return;
    const archivedId = memory.id;
    const { setHidden, removeRecord } = useMemoryStore.getState();
    setHidden(archivedId, true);
    close();
    deferAction({
      message: 'Archived. It no longer reaches your AI.',
      commit: (keepalive) =>
        api.deleteMemory(archivedId, keepalive).then(() => {
          removeRecord(archivedId);
          setHidden(archivedId, false);
        }),
      undo: () => {
        setHidden(archivedId, false);
        if (!useNeuralStore.getState().selectedNeuronId) selectNeuron(archivedId);
      },
      onError: (err) => {
        setHidden(archivedId, false);
        showToast(`Could not archive that memory${reason(err)}`);
      },
    });
  };

  const resolve = (link: Link, strategy: Strategy) => {
    if (!memory || !link.other) return;
    const self = memory;
    const pair = link.sourceId === self.id ? [self, link.other] : [link.other, self];
    const loser = predictLoser(pair[0]!, pair[1]!, strategy);
    const { setHidden, removeRecord } = useMemoryStore.getState();
    const message =
      loser === null
        ? 'Kept both. They are no longer flagged as a contradiction.'
        : loser === self.id
          ? 'Kept the other memory; this one is archived.'
          : 'Kept this memory; the other one is archived.';
    setResolved((r) => ({ ...r, [link.id]: message }));
    if (loser) setHidden(loser, true);
    if (loser === self.id) close();
    const putBack = () => {
      setResolved((r) => {
        const { [link.id]: _gone, ...rest } = r;
        return rest;
      });
      if (loser) setHidden(loser, false);
      if (loser === self.id && !useNeuralStore.getState().selectedNeuronId) selectNeuron(self.id);
    };
    deferAction({
      message: 'Contradiction resolved.',
      commit: (keepalive) =>
        api.resolveContradiction(link.sourceId, link.targetId, strategy, keepalive).then((res) => {
          const neural = useNeuralStore.getState();
          neural.setContradictionPairs(
            neural.contradictionPairs.filter((p) => !(p.sourceId === link.sourceId && p.targetId === link.targetId))
          );
          if (res.archivedId) removeRecord(res.archivedId);
          if (loser) setHidden(loser, false);
        }),
      undo: putBack,
      onError: (err) => {
        putBack();
        showToast(`Could not resolve that contradiction${reason(err)}`);
      },
    });
  };

  const addTag = async () => {
    const tag = tagInput.trim();
    if (!memory || !tag) return;
    try {
      const res = await api.addTag(memory.id, tag);
      keep({ ...memory, tags: JSON.stringify(res.tags) });
      setTagInput('');
      setActionError(null);
    } catch (err) {
      setActionError(`Could not add that tag${reason(err)}`);
    }
  };

  const removeTag = async (tag: string) => {
    if (!memory) return;
    try {
      const res = await api.removeTag(memory.id, tag);
      keep({ ...memory, tags: JSON.stringify(res.tags) });
      setActionError(null);
      showToast(`Removed the tag “${tag}”`);
    } catch (err) {
      setActionError(`Could not remove the tag “${tag}”${reason(err)}`);
    }
  };

  const contradictions = current.links.filter((l) => l.relationship === 'contradicts');
  // A memory already shown as a contradiction is not listed again as a connection.
  const disputed = new Set(contradictions.map((l) => l.otherId));
  const connections = current.links
    .filter((l) => l.relationship !== 'contradicts' && !disputed.has(l.otherId))
    .sort((a, b) => b.strength - a.strength);
  const showProject = known.some((ns) => ns !== null);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="mm-sheet"
      data-state={closing ? 'closing' : 'open'}
      onKeyDown={onKeyDown}
    >
      <header className="mm-head">
        <div className="mm-head-row">
          {memory && <TypeMark type={memory.type} hollow={isReflection(memory)} />}
          <h2 id={titleId}>
            {memory ? TYPE_NAME[memory.type] : 'Memory'}
            <span className="at-sr"> memory</span>
          </h2>
          {memory?.source && <span>{memory.source}</span>}
          {memory && showProject && <span title={memory.namespace ?? undefined}>{projectLabel(memory.namespace, known)}</span>}
          <button type="button" className="mm-icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
            <Icon name="close" size={18} />
          </button>
        </div>
        {memory && (
          <div className="mm-tabs" role="tablist" aria-label="Mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'read'}
              onClick={() => setMode('read')}
              onKeyDown={(e) => e.key === 'ArrowRight' && editTabRef.current?.focus()}
            >
              Read
            </button>
            <button
              ref={editTabRef}
              type="button"
              role="tab"
              aria-selected={mode === 'edit'}
              onClick={() => setMode('edit')}
              onKeyDown={(e) => e.key === 'ArrowLeft' && (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus()}
            >
              Edit
            </button>
          </div>
        )}
      </header>

      {!memory ? (
        <div className="mm-body">
          {current.status === 'loading' ? (
            <div className="mm-sec" aria-busy="true">
              <p className="at-sr">Loading the memory…</p>
              <i className="mm-skel" />
              <i className="mm-skel" />
              <i className="mm-skel" style={{ width: '62%' }} />
            </div>
          ) : (
            <div className="mm-sec">
              <p className="mm-text">
                {current.status === 'missing'
                  ? 'This memory is not in the store any more. It may have been archived.'
                  : 'Could not load this memory. Check that the Engram server is running, then open it again.'}
              </p>
              <button type="button" className="at-btn sec" onClick={close}>
                Close
              </button>
            </div>
          )}
        </div>
      ) : mode === 'edit' ? (
        <MemoryEdit
          key={memory.id}
          memory={memory}
          tags={tags}
          onCancel={() => {
            setMode('read');
            editTabRef.current?.focus();
          }}
          onSaved={(next, reindexed) => {
            keep(next);
            setMode('read');
            editTabRef.current?.focus();
            showToast(reindexed ? 'Saved and re-indexed for search' : 'Saved');
          }}
        />
      ) : (
        <>
          <div className="mm-body">
            {actionError && (
              <p role="alert" className="mm-error">
                {actionError}
              </p>
            )}
            <Content text={memory.content} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />

            <section className="mm-sec" aria-label="Weight">
              <Meter label="Importance" value={memory.importance} />
              {policy && score && <Retention score={score} policy={policy} />}
            </section>

            <section className="mm-sec">
              <h3>Tags</h3>
              <div className="mm-tags">
                {tags.map((tag) => (
                  <span key={tag} className="mm-tag" title={tag}>
                    <span>{tag || '(empty)'}</span>
                    <button type="button" onClick={() => void removeTag(tag)} aria-label={`Remove tag ${tag}`}>
                      ×
                    </button>
                  </span>
                ))}
                <label className="mm-tag mm-tag-add">
                  <span aria-hidden="true">+</span>
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addTag();
                      }
                    }}
                    placeholder="Add tag"
                    aria-label="Add tag"
                  />
                </label>
              </div>
            </section>

            <section className="mm-sec" aria-label="Details">
              <dl className="mm-kv">
                <dt>Concept</dt>
                <dd>{memory.concept ? toPlainText(memory.concept) : 'None'}</dd>
                {showProject && (
                  <>
                    <dt>Project</dt>
                    <dd>{memory.namespace ?? 'Global, shared by every project'}</dd>
                  </>
                )}
                <dt>Stored</dt>
                <dd>{formatDateTime(memory.createdAt)}</dd>
                <dt>Recalled</dt>
                <dd>
                  {memory.accessCount
                    ? `${memory.accessCount} ${memory.accessCount === 1 ? 'time' : 'times'}${memory.lastAccessedAt ? `, last ${formatRelative(memory.lastAccessedAt)}` : ''}`
                    : 'Never yet'}
                </dd>
              </dl>
            </section>

            {memory.summary && (
              <section className="mm-sec">
                <h3>Summary</h3>
                <p className="mm-text mm-small">{toPlainText(memory.summary)}</p>
              </section>
            )}

            {contradictions.length > 0 && (
              <section className="mm-sec">
                <h3>
                  Contradicts {contradictions.length} {contradictions.length === 1 ? 'memory' : 'memories'}
                </h3>
                {contradictions.slice(0, SHOWN_CONTRADICTIONS).map((link) => (
                  <Fault key={link.id} link={link} done={resolved[link.id]} onOpen={selectNeuron} onResolve={(s) => resolve(link, s)} />
                ))}
                {contradictions.length > SHOWN_CONTRADICTIONS && (
                  <p className="mm-small">
                    <a href="#/review">{contradictions.length - SHOWN_CONTRADICTIONS} more in the review queue</a>
                  </p>
                )}
              </section>
            )}

            {connections.length > 0 && (
              <section className="mm-sec">
                <h3>Connected to {connections.length}</h3>
                <ul className="mm-conns">
                  {(allLinks ? connections : connections.slice(0, SHOWN_CONNECTIONS)).map((link) => (
                    <li key={link.id}>
                      <button
                        type="button"
                        className="mm-conn"
                        onClick={() => selectNeuron(link.otherId)}
                        title={`${link.relationship.replace(/_/g, ' ')}, strength ${Math.round(link.strength * 100)}%`}
                      >
                        {link.other ? <TypeMark type={link.other.type} hollow={isReflection(link.other)} size={12} /> : <span />}
                        <span className="mm-conn-t">{link.other ? toPlainText(link.other.content) : link.otherId.slice(0, 8)}</span>
                        <i style={{ width: `${Math.max(4, Math.round(link.strength * 100))}%` }} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                {connections.length > SHOWN_CONNECTIONS && (
                  <button type="button" className="mm-quiet" aria-expanded={allLinks} onClick={() => setAllLinks((v) => !v)}>
                    {allLinks ? 'Show fewer' : `Show all ${connections.length}`}
                  </button>
                )}
              </section>
            )}
            {current.status === 'error' && <p className="mm-sec mm-small">Could not load this memory’s connections.</p>}
          </div>
          <div className="mm-foot">
            <p className="mm-foot-note">Archiving takes it out of search and recall, with a moment to undo.</p>
            <button type="button" className="at-btn danger" onClick={archive}>
              <Icon name="archive" size={16} />
              Archive
            </button>
            <button type="button" className="at-btn" onClick={() => setMode('edit')}>
              <Icon name="edit" size={16} />
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Content({ text, expanded, onToggle }: { text: string; expanded: boolean; onToggle: () => void }) {
  const full = toReadableText(text);
  const long = full.length > CONTENT_FOLD;
  return (
    <section className="mm-sec" aria-label="Content">
      <p className="mm-text">{expanded || !long ? full : `${full.slice(0, CONTENT_FOLDED).trimEnd()}…`}</p>
      {long && (
        <button type="button" className="mm-quiet" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Show less' : `Show all ${full.length.toLocaleString('en-US')} characters`}
        </button>
      )}
    </section>
  );
}

function Meter({ label, value, threshold }: { label: string; value: number; threshold?: number }) {
  return (
    <div className="mm-meter">
      <span>{label}</span>
      <span className="mm-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <i style={{ width: `${Math.max(1, Math.round(value * 100))}%` }} data-kind={label.toLowerCase()} />
        {threshold !== undefined && <b style={{ left: `${threshold * 100}%` }} title={`Archive threshold, ${percent(threshold)}`} />}
      </span>
      <strong>{percent(value)}</strong>
    </div>
  );
}

function Retention({ score, policy }: { score: Pick<MapNode, 'retention' | 'protected'>; policy: DecayPolicy }) {
  const threshold = percent(policy.archiveThreshold);
  const days = Math.ceil(daysLeft(score.retention, policy));
  return (
    <>
      <Meter label="Retention" value={score.retention} threshold={policy.archiveThreshold} />
      <p className="mm-note">
        {score.protected
          ? 'Protected: the decay sweep never archives it, whatever its retention.'
          : score.retention >= policy.archiveThreshold
            ? `Reaches the ${threshold} archive threshold ${days <= 1 ? 'within a day' : `in ${days} days`} unless your AI recalls it.`
            : `Below the ${threshold} archive threshold. The next decay sweep archives it unless a recall, more importance or a protection rule keeps it.`}
      </p>
    </>
  );
}

function Fault({
  link,
  done,
  onOpen,
  onResolve,
}: {
  link: Link;
  done: string | undefined;
  onOpen: (id: string) => void;
  onResolve: (strategy: Strategy) => void;
}) {
  const other = link.other;
  return (
    <div className="mm-fault" data-done={Boolean(done)}>
      <button type="button" className="mm-fault-t" onClick={() => onOpen(link.otherId)}>
        {other ? toPlainText(other.content) : link.otherId.slice(0, 8)}
      </button>
      {other && (
        <p className="mm-fault-m">
          {formatShortDate(other.createdAt)}, importance {percent(other.importance)}
        </p>
      )}
      {done ? (
        <p className="mm-fault-done" role="status">
          {done}
        </p>
      ) : (
        other && (
          <div className="mm-res" role="group" aria-label="Resolve">
            {STRATEGIES.map((s) => (
              <button key={s.strategy} type="button" onClick={() => onResolve(s.strategy)}>
                {s.label}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

