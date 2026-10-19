import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsView from '../SettingsView.js';
import { useTheme } from '../../../shell/theme.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: { health: vi.fn() },
}));

describe('SettingsView', () => {
  beforeEach(() => {
    useTheme.setState({ mode: 'auto' });
    vi.mocked(api.health).mockResolvedValue({ status: 'ok', version: '0.6.0', uptime: 1 } as never);
  });

  it("shows the running server's version, not the web package's", async () => {
    render(<SettingsView />);
    expect(await screen.findByText('Engram server v0.6.0')).toBeInTheDocument();
  });

  it('shows no version at all until the server has said which one it is', async () => {
    vi.mocked(api.health).mockRejectedValueOnce(new Error('offline'));
    render(<SettingsView />);
    await waitFor(() => expect(api.health).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
  });

  it('picks the colour mode with real radios, the current one checked', () => {
    render(<SettingsView />);
    expect(screen.getByRole('radio', { name: 'Match system' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(useTheme.getState().mode).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Match system' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('links to the setup steps', () => {
    render(<SettingsView />);
    expect(screen.getByRole('link', { name: 'Show the setup steps' })).toHaveAttribute('href', '#/welcome');
  });
});
