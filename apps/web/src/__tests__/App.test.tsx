import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App.js';

vi.mock('../components/layout/AppLayout.js', () => ({
  default: () => {
    throw new Error('AppLayout blew up');
  },
}));

describe('App wires an ErrorBoundary around AppLayout (W10)', () => {
  const originalError = console.error;
  afterEach(() => {
    console.error = originalError;
  });

  it('shows a recoverable fallback instead of a blank page when AppLayout throws', () => {
    console.error = vi.fn();
    render(<App />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});
