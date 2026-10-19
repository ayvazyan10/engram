import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ui.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors and offers recovery without reloading the tab.
 * React error boundaries require a class component. Atlas CSS follows the
 * colour mode even while the fallback is on screen. */
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
        <div className="ui-error-boundary" role="alert">
          <div className="ui-error-icon" aria-hidden="true">⚠</div>
          <div className="ui-error-title">Something went wrong</div>
          <div className="ec-wrap-anywhere ui-error-message">{this.state.error.message}</div>
          <button
            className="ec-primary ui-primary ui-retry"
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
