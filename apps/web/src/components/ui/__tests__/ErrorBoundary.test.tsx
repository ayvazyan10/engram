import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary.js';

function Bomb(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary (W10)', () => {
  const originalError = console.error;

  afterEach(() => {
    console.error = originalError;
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('catches a render error from a descendant instead of leaving a blank page', () => {
    console.error = vi.fn(); // React logs the caught error — expected noise here
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText('all good')).not.toBeInTheDocument();
  });

  it('offers a way to recover without a hard reload', () => {
    console.error = vi.fn();
    let shouldThrow = true;
    function MaybeBomb() {
      if (shouldThrow) throw new Error('kaboom');
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeBomb />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('recovered')).toBeInTheDocument();
  });
});
