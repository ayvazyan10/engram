import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RADIUS, SPACE, STATUS, TYPE } from '../../lib/tokens.js';

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
 * equivalent.
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
      return (
        <div style={styles.wrap} role="alert">
          <div style={styles.icon}>⚠</div>
          <div style={styles.title}>Something went wrong</div>
          <div style={styles.message}>{this.state.error.message}</div>
          <button className="ec-hover-bright" style={styles.button} onClick={this.handleRetry}>
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
    background: '#020817',
    color: '#e2e8f0',
    textAlign: 'center' as const,
  },
  icon: { fontSize: '32px', color: STATUS.danger },
  title: { fontSize: TYPE.lg, fontWeight: 700 },
  message: { fontSize: TYPE.sm, color: '#94a3b8', maxWidth: '440px' },
  button: {
    marginTop: SPACE.sm,
    padding: '8px 20px',
    border: 'none',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.base,
    fontWeight: 600,
    background: '#6366f1',
    color: '#ffffff',
    cursor: 'pointer',
  },
} as const;
