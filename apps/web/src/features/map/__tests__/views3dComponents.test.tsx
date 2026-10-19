import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkyView from '../views/SkyView.js';
import LandscapeView from '../views/LandscapeView.js';
import { createStage } from '../views/threeStage.js';
import { payload } from './payload.js';

vi.mock('../views/threeStage.js', () => ({ createStage: vi.fn(() => null) }));
vi.mock('../../memory/MemorySheet.js', () => ({ loadPolicy: () => Promise.resolve({ halfLifeDays: 7, archiveThreshold: 0.05 }) }));
beforeEach(() => vi.mocked(createStage).mockClear());

describe.each([['Sky', SkyView], ['Landscape', LandscapeView]] as const)('%s view fallback', (_name, View) => {
  it('leaves an empty payload calm without attempting WebGL', () => {
    render(<View payload={payload({ nodes: [], regions: [] })} />);
    expect(screen.getByText(/No memories to show/)).toBeInTheDocument();
    expect(createStage).not.toHaveBeenCalled();
  });
  it('reports unavailable WebGL without presenting a broken scene or scrubber', async () => {
    render(<View payload={payload()} />);
    expect(await screen.findByRole('status')).toHaveTextContent('WebGL is unavailable in this browser.');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
  });
});
