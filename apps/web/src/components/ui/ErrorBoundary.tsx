import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTemplateStore } from '../../store/templateStore.js';
import { GLYPH, RADIUS, SPACE, STATUS, TYPE, WEIGHT } from '../../lib/tokens.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * W10: the app had no error boundary anywhere. REST payloads were cast
 * unvalidated, and both TimelineView and ReflectionView fed a raw
 * `createdAt` into date-fns without guarding it — a `RangeError` (or any
 * other render-time throw, from any future component) unmounted the whole
 * React tree, leaving a permanently blank page with no way to recover short
 * of a hard reload. This catches any such error below it, shows a visible
 * fallback instead of silence, and offers a way back in without losing the
 * tab/session (a hard reload would, e.g., drop an in-progress store draft
 * in a way "Try again" does not).
 *
 * A class component is required here — React only supports error boundaries
 * via `getDerivedStateFromError`/`componentDidCatch`, there is no hook
 * equivalent. It reads the active template straight off the store instead
 * (no hook needed for a synchronous read), so the one screen that appears
 * when everything else has failed is still in the theme the user chose.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Detailed context server-side logging isn't available from the browser
    // — this is the client-side equivalent: keep it, don't swallow it.
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      const t = useTemplateStore.getState().activeTemplate;
      return (
        <div style={{ ...styles.wrap, background: t.rootBg, color: t.textPrimary }} role="alert">
          <div style={styles.icon} aria-hidden="true">{GLYPH.warning}</div>
          <div style={styles.title}>Something went wrong</div>
          <div className="ec-wrap-anywhere" style={{ ...styles.message, color: t.textSecondary }}>{this.state.error.message}</div>
          <button
            className="ec-primary"
            style={{ ...styles.button, background: t.accentStrong, color: t.onAccent }}
            onClick={this.handleRetry}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    gap: SPACE.sm,
    padding: SPACE.xl,
    textAlign: 'center' as const,
  },
  icon: { fontSize: TYPE.glyph, lineHeight: 1, color: STATUS.danger },
  title: { fontSize: TYPE.xl, fontWeight: WEIGHT.semibold, letterSpacing: '-0.01em' },
  message: { fontSize: TYPE.sm, lineHeight: 1.5, maxWidth: '440px' },
  button: {
    marginTop: SPACE.sm,
    padding: `${SPACE.xs} ${SPACE.xl}`,
    border: 'none',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.semibold,
    minHeight: 32,
  },
} as const;
