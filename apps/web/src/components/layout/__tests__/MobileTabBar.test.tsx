import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileTabBar from '../MobileTabBar.js';
import { TEMPLATES } from '../../../store/templateStore.js';

const t = TEMPLATES[0]!;

describe('MobileTabBar (V3 — compact-viewport pane switcher)', () => {
  it('renders the three panes and marks the active one', () => {
    render(<MobileTabBar pane="canvas" onChange={() => {}} t={t} />);

    expect(screen.getByRole('button', { name: /graph/i })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /memories/i })).toHaveAttribute('aria-current', 'false');
    expect(screen.getByRole('button', { name: /inspect/i })).toHaveAttribute('aria-current', 'false');
  });

  it('calls onChange with the tapped pane', () => {
    const onChange = vi.fn();
    render(<MobileTabBar pane="canvas" onChange={onChange} t={t} />);

    fireEvent.click(screen.getByRole('button', { name: /memories/i }));
    expect(onChange).toHaveBeenCalledWith('list');

    fireEvent.click(screen.getByRole('button', { name: /inspect/i }));
    expect(onChange).toHaveBeenCalledWith('inspector');
  });
});
