import { useState } from 'react';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, STATUS, TYPE, TYPE_COLORS, TYPE_LABELS, WEIGHT, withAlpha } from '../../lib/tokens.js';
import { useDecayPolicy } from '../../lib/decayPolicy.js';
import { IMPORTANCE_BANDS } from './encoding.js';

/**
 * The scene's key, and its confession.
 *
 * Two jobs. The first is to say what the four visual channels encode, so the
 * graph is readable rather than decorative. The second is to state what is NOT
 * on screen: the old client rendered 67 of ~17,000 edge endpoints and said
 * nothing, and a viewer reasonably read that as "my memories are barely
 * connected". Every number below is reported by the server, not guessed here.
 */

export interface SceneStats {
  nodes: number;
  /** How positions were derived. 'offline' means the layout endpoint failed. */
  method: 'pca3' | 'fallback' | 'offline';
  /** Memories the server could not project (no usable embedding). */
  unprojected: number;
  explainedVariance: readonly number[];
  edgesShown: number;
  /** Edges with both endpoints on screen. */
  edgesRenderable: number;
  /** Connection rows in the store, including ones onto archived memories. */
  edgesStored: number;
  /** The filter rule in force, or null when nothing is filtered out. */
  edgeFilter: string | null;
}

interface Props {
  stats: SceneStats | null;
  compact: boolean;
}

const number = (n: number): string => n.toLocaleString('en-US');

export default function SceneKey({ stats, compact }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const [open, setOpen] = useState(!compact);
  if (!stats) return null;

  const surface = {
    ...s.panel,
    background: withAlpha(t.panelBg, 0.82),
    borderColor: t.panelBorder,
    color: t.textSecondary,
  };

  const edgeLine =
    stats.edgesRenderable === 0
      ? 'no edges between visible memories'
      : `${number(stats.edgesShown)} of ${number(stats.edgesRenderable)} edges` +
        (stats.edgeFilter ? ` · ${stats.edgeFilter}` : '');

  return (
    <div style={surface}>
      <button
        type="button"
        className="ec-hover-tint"
        style={{ ...s.summary, color: t.textPrimary }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Named explicitly: the summary text ("… edges between visible
        // memories") would otherwise become this control's accessible name and
        // collide with the mobile tab bar's "Memories" button.
        aria-label="Scene key"
        title="What the colours, sizes and counts mean" 
      >
        <span style={{ ...s.caret, color: t.textMuted }}>{open ? '▾' : '▸'}</span>
        <span style={s.summaryNumbers}>
          {number(stats.nodes)} nodes · {edgeLine}
        </span>
      </button>

      {open && (
        <div style={s.body}>
          <Provenance stats={stats} muted={t.textMuted} accent={t.accent} />

          <div style={{ ...s.divider, background: t.panelBorder }} />

          <Row label="Colour" hint="memory type">
            <div style={s.swatchRow}>
              {(Object.keys(TYPE_COLORS) as (keyof typeof TYPE_COLORS)[]).map((type) => (
                <span key={type} style={s.swatchItem}>
                  <span style={{ ...s.dot, background: TYPE_COLORS[type] }} />
                  <span style={{ color: t.textSecondary }}>{TYPE_LABELS[type]}</span>
                </span>
              ))}
            </div>
          </Row>

          <Row label="Size" hint="importance">
            <div style={s.swatchRow}>
              {IMPORTANCE_BANDS.map((band) => (
                <span key={band.label} style={s.swatchItem}>
                  <span
                    style={{
                      ...s.dot,
                      width: `${4 + band.radius * 1.6}px`,
                      height: `${4 + band.radius * 1.6}px`,
                      background: t.textMuted,
                    }}
                  />
                  <span style={{ color: t.textMuted }}>{band.label}</span>
                </span>
              ))}
            </div>
          </Row>

          <Row label="Brightness" hint="recency">
            <RecencyValue muted={t.textMuted} />
          </Row>

          <Row label="Halo" hint="times recalled">
            <span style={{ color: t.textMuted }}>log scale, 0 – 100+</span>
          </Row>

          <Row label="Ring" hint="contradiction">
            <span style={s.swatchItem}>
              <span style={{ ...s.ring, borderColor: STATUS.contradiction }} />
              <span style={{ color: t.textMuted }}>also the edge colour</span>
            </span>
          </Row>
        </div>
      )}
    </div>
  );
}

/**
 * What the brightness channel actually encodes — read off the server (F3).
 *
 * This row used to print "30-day half-life" from a constant in encoding.ts,
 * while the server's policy has been 7 days all along. It is the same class of
 * defect as claiming a PCA when the positions are id-derived, so it gets the
 * same treatment the Provenance block already gives that case: when the number
 * isn't known, say the channel is off rather than name a number.
 */
function RecencyValue({ muted }: { muted: string }) {
  const policy = useDecayPolicy();
  if (!policy) {
    return (
      <span style={{ color: STATUS.warning }}>
        Decay policy unreachable — brightness is off, every node is drawn at full strength.
      </span>
    );
  }
  return (
    <span style={{ color: muted }}>
      {policy.halfLifeDays}-day half-life, the server&apos;s own decay policy
    </span>
  );
}

function Provenance({ stats, muted, accent }: { stats: SceneStats; muted: string; accent: string }) {
  if (stats.method === 'offline') {
    return (
      <p style={{ ...s.note, color: STATUS.warning }}>
        Positions unavailable — the layout endpoint could not be reached, so nodes are on an
        id-derived sphere. Distance means nothing here.
      </p>
    );
  }
  if (stats.method === 'fallback') {
    return (
      <p style={{ ...s.note, color: STATUS.warning }}>
        Too few embedded memories to project. Nodes are on an id-derived sphere; distance means
        nothing until the store grows.
      </p>
    );
  }
  const variance = stats.explainedVariance.reduce((a, b) => a + b, 0);
  return (
    <>
      <p style={{ ...s.note, color: muted }}>
        Position is a <span style={{ color: accent }}>PCA of each memory&apos;s 384-d embedding</span>
        {' '}— near means similar. Three components carry {(variance * 100).toFixed(0)}% of the
        variance.
      </p>
      {stats.unprojected > 0 && (
        <p style={{ ...s.note, color: STATUS.warning }}>
          {number(stats.unprojected)} memories have no usable embedding and sit on the outer shell,
          drawn faint.
        </p>
      )}
      {stats.edgesStored > stats.edgesRenderable && (
        <p style={{ ...s.note, color: muted }}>
          {number(stats.edgesStored - stats.edgesRenderable)} more connections join memories that
          have been archived, so they have no node to draw to.
        </p>
      )}
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const t = useTemplateStore((st) => st.activeTemplate);
  return (
    <div style={s.row}>
      <span style={{ ...s.rowLabel, color: t.textPrimary }}>
        {label}
        <span style={{ ...s.rowHint, color: t.textMuted }}>{hint}</span>
      </span>
      <span style={s.rowValue}>{children}</span>
    </div>
  );
}

const s = {
  panel: {
    position: 'absolute' as const,
    left: SPACE.md,
    bottom: SPACE.md,
    maxWidth: '330px',
    border: '1px solid',
    borderRadius: RADIUS.lg,
    backdropFilter: 'blur(10px)',
    padding: `${SPACE.sm} ${SPACE.md} ${SPACE.sm}`,
    fontSize: TYPE.xs,
    lineHeight: 1.45,
    pointerEvents: 'auto' as const,
    zIndex: 3,
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.xs,
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.semibold,
    letterSpacing: '0.01em',
    width: '100%',
    textAlign: 'left' as const,
  },
  caret: { fontSize: TYPE.micro, lineHeight: 1 },
  summaryNumbers: { fontVariantNumeric: 'tabular-nums' as const },
  body: { display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xs'], marginTop: SPACE.xs },
  note: { margin: 0, fontSize: TYPE.micro, lineHeight: 1.5 },
  divider: { height: '1px', margin: `${SPACE.xs} 0` },
  row: { display: 'flex', alignItems: 'flex-start', gap: SPACE.sm },
  rowLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: '62px',
    fontSize: TYPE.micro,
    fontWeight: WEIGHT.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  rowHint: { fontSize: TYPE.micro, fontWeight: WEIGHT.regular, textTransform: 'none' as const, letterSpacing: 0 },
  rowValue: { flex: 1, fontSize: TYPE.micro, paddingTop: '1px' },
  swatchRow: { display: 'flex', flexWrap: 'wrap' as const, gap: `2px ${SPACE.sm}` },
  swatchItem: { display: 'inline-flex', alignItems: 'center', gap: SPACE['2xs'] },
  dot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  ring: {
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    border: '1.5px solid',
    display: 'inline-block',
    flexShrink: 0,
  },
} as const;
