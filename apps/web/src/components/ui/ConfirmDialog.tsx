import type { ReactNode } from 'react';
import { useTemplateStore } from '../../store/templateStore.js';
import { ON_STATUS, RADIUS, SPACE, STATUS, TYPE, withAlpha } from '../../lib/tokens.js';
import ModalShell from './ModalShell.js';

interface Props {
  title: string;
  /** The sentence that says what is about to happen. */
  message: string;
  /** What is about to happen it to — shown verbatim so the user can see the
   *  record before agreeing to change it. */
  subject?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A themed, focus-trapped replacement for `confirm()` (H8).
 *
 * The archive action used a native `confirm('Archive this memory?')`: OS
 * chrome in the middle of a dark dashboard, no template colour, on some
 * browsers prefixed with the page origin, and — worst — it named nothing, so
 * "this memory" was whatever the user hoped was still selected.
 */
export default function ConfirmDialog({ title, message, subject, confirmLabel, busy, onConfirm, onCancel }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);

  return (
    <ModalShell
      title={title}
      onClose={onCancel}
      width="420px"
      footer={
        <>
          <button
            className="ec-hover-tint"
            style={{ ...styles.cancelBtn, background: t.inputBg, borderColor: t.panelBorder, color: t.textSecondary }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="ec-hover-bright"
            style={{ ...styles.confirmBtn, background: STATUS.danger, color: ON_STATUS.danger, opacity: busy ? 0.5 : 1 }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ ...styles.message, color: t.textSecondary }}>{message}</p>
      {subject && (
        <div style={{ ...styles.subject, background: t.inputBg, borderColor: withAlpha(STATUS.danger, 0.3) }}>
          {subject}
        </div>
      )}
    </ModalShell>
  );
}

const styles = {
  message: { fontSize: TYPE.md, lineHeight: 1.55, margin: 0 },
  subject: {
    border: '1px solid', borderRadius: RADIUS.md,
    padding: `${SPACE.md}`,
    display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xs'],
  },
  cancelBtn: {
    padding: `${SPACE.sm} ${SPACE.lg}`, border: '1px solid', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 600, fontFamily: 'inherit',
  },
  confirmBtn: {
    padding: `${SPACE.sm} ${SPACE.xl}`, border: 'none', borderRadius: RADIUS.sm,
    fontSize: TYPE.base, fontWeight: 700, fontFamily: 'inherit',
  },
} as const;
