import { useState } from 'react';
import { useAuthStore } from '../../store/authStore.js';
import { setStoredApiKey, clearStoredApiKey } from '../../lib/apiKey.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../lib/tokens.js';

/**
 * "Enter your API key" gate (F2). Rendered on top of the whole dashboard
 * whenever useAuthStore().locked is true — a 401 from any REST call, or an
 * auth-flavored socket connect_error, sets that. Deliberately distinct from
 * both MemoryPanel's empty state and its error banner: a missing/wrong key
 * is not "the store is empty" and not a transient network failure, it's
 * "you cannot use this dashboard until you prove who you are".
 */
export default function UnlockGate() {
  const hadKey = useAuthStore((s) => s.hadKey);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const t = useTemplateStore((s) => s.activeTemplate);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setStoredApiKey(trimmed);
    // A full reload is the simplest way to guarantee every independent
    // fetcher (the 3D graph's initial load, Analytics, Reflections, and the
    // socket handshake) picks up the new key — each fetches on its own
    // mount, so anything short of a reload would mean wiring a retry
    // callback through every one of them individually.
    window.location.reload();
  }

  function handleClear() {
    clearStoredApiKey();
    useAuthStore.getState().clearKey();
    setValue('');
  }

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, background: t.cardBg, borderColor: t.panelBorder }}>
        {/* L6: was a 🔒 colour emoji — the one piece of colour art in an
            otherwise monochrome, line-drawn interface. Hand-rolled inline
            path, the same ~100-byte approach NeuronInspector's archive/close
            buttons and SearchBar's magnifier already use, rather than adding
            an icon font the bundle cannot afford. */}
        <svg viewBox="0 0 24 24" fill="none" style={styles.icon} aria-hidden="true">
          <path
            d="M7 10V7a5 5 0 0110 0v3M5.5 10h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1zM12 14v3"
            stroke={t.accent}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ ...styles.title, color: t.textPrimary }}>{hadKey ? 'Wrong key — try again' : 'API key required'}</div>
        <p style={{ ...styles.subtitle, color: t.textSecondary }}>
          {hadKey
            ? 'The stored key was rejected by the server. Enter the correct API key and try again.'
            : 'This Engram instance requires an API key. Enter the ENGRAM_API_KEY configured on the server.'}
        </p>

        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="API key"
          aria-label="API key"
          style={{ ...styles.input, background: t.inputBg, borderColor: t.panelBorder, color: t.textPrimary }}
          disabled={submitting}
        />

        <div style={styles.actions}>
          {hadKey && (
            <button
              className="ec-hover-tint"
              style={{ ...styles.clearBtn, borderColor: t.panelBorder, color: t.textSecondary }}
              onClick={handleClear}
              disabled={submitting}
            >
              Clear key
            </button>
          )}
          <button
            className="ec-primary"
            style={{ ...styles.submitBtn, background: t.accentStrong, color: t.onAccent }}
            onClick={handleSubmit}
            disabled={submitting || !value.trim()}
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 2000,
    background: 'rgba(2, 6, 16, 0.92)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    width: '380px', maxWidth: '90vw',
    border: '1px solid', borderRadius: RADIUS.xl,
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
    padding: `${SPACE['2xl']} ${SPACE['2xl']} ${SPACE.xl}`,
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
  },
  icon: { width: 30, height: 30, marginBottom: SPACE.sm },
  title: { fontSize: TYPE.xl, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em', textAlign: 'center' as const },
  subtitle: {
    fontSize: TYPE.base, textAlign: 'center' as const,
    lineHeight: 1.55, margin: `${SPACE.sm} 0 ${SPACE.xl}`,
  },
  input: {
    width: '100%', border: '1px solid', borderRadius: RADIUS.sm,
    padding: `${SPACE.sm} ${SPACE.md}`, fontSize: TYPE.base, minHeight: 34,
    fontFamily: 'inherit', boxSizing: 'border-box' as const,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm, marginTop: SPACE.lg, width: '100%' },
  clearBtn: {
    padding: `${SPACE.xs} ${SPACE.md}`, background: 'transparent', border: '1px solid', borderRadius: RADIUS.sm,
    fontSize: TYPE.sm, fontWeight: WEIGHT.medium, minHeight: 32,
  },
  submitBtn: {
    flex: 1, padding: `${SPACE.xs} ${SPACE.lg}`, border: 'none', borderRadius: RADIUS.sm,
    fontSize: TYPE.sm, fontWeight: WEIGHT.semibold, minHeight: 32,
  },
} as const;
