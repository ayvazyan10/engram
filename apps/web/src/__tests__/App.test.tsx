import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App.js';

vi.mock('../shell/Shell.js', () => ({
  default: () => {
    throw new Error('Shell blew up');
  },
}));

describe('App wires an ErrorBoundary around the shell (W10)', () => {
  const originalError = console.error;
  afterEach(() => {
    console.error = originalError;
  });

  it('shows a recoverable fallback instead of a blank page when the shell throws', () => {
    console.error = vi.fn();
    render(<App />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
