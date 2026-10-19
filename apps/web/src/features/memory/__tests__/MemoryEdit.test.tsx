import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemoryEdit, { changesFrom, parseTagInput } from '../MemoryEdit.js';
import type { MemoryRecord } from '../../../store/memoryStore.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({ api: { updateMemory: vi.fn() } }));

const memory: MemoryRecord = {
  id: 'm1',
  type: 'semantic',
  content: 'The release workflow deploys on Fridays.',
  summary: null,
  importance: 0.6,
  source: 'rest-api',
  concept: 'release',
  tags: '["ci","deploy"]',
  createdAt: '2026-10-19T10:00:00.000Z',
};
const tags = ['ci', 'deploy'];
const draft = { content: memory.content, concept: 'release', importance: 60, tags: 'ci, deploy' };

describe('changesFrom', () => {
  it('is empty when nothing moved, whitespace included', () => {
    expect(changesFrom(memory, tags, draft)).toEqual({});
    expect(changesFrom(memory, tags, { ...draft, content: `  ${memory.content}\n`, tags: 'ci,deploy , ' })).toEqual({});
  });

  it('carries only the fields that changed', () => {
    expect(changesFrom(memory, tags, { ...draft, importance: 85 })).toEqual({ importance: 0.85 });
    expect(changesFrom(memory, tags, { ...draft, concept: 'release day' })).toEqual({ concept: 'release day' });
    expect(changesFrom(memory, tags, { ...draft, content: 'Deploys on Mondays.', tags: 'ci' })).toEqual({
      content: 'Deploys on Mondays.',
      tags: ['ci'],
    });
  });

  it('treats a missing concept as empty', () => {
    expect(changesFrom({ ...memory, concept: null }, tags, { ...draft, concept: '' })).toEqual({});
  });
});

describe('parseTagInput', () => {
  it('splits on commas, trims, drops blanks and repeats', () => {
    expect(parseTagInput(' a, b ,, a ,c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('MemoryEdit', () => {
  beforeEach(() => {
    vi.mocked(api.updateMemory).mockReset();
  });

  function renderEdit() {
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<MemoryEdit memory={memory} tags={tags} onSaved={onSaved} onCancel={onCancel} />);
    return { onSaved, onCancel };
  }

  it('starts with Save off and says nothing changed', () => {
    renderEdit();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Nothing changed yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Content')).toHaveFocus();
  });

  it('says a content change re-indexes, and an importance change does not', () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/Importance/), { target: { value: '70' } });
    expect(screen.getByText(/next time it recalls/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'New words.' } });
    expect(screen.getByText(/re-indexes this memory/)).toBeInTheDocument();
  });

  it('refuses empty content', () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: '   ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('A memory needs some content.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('saves with Ctrl+Enter, sending only the changed fields', async () => {
    vi.mocked(api.updateMemory).mockResolvedValue({
      id: 'm1',
      content: 'Deploys on Mondays.',
      importance: 0.6,
      tags: '["ci","deploy"]',
      concept: 'release',
      updatedAt: 'now',
    });
    const { onSaved } = renderEdit();
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Deploys on Mondays.' } });
    fireEvent.keyDown(screen.getByLabelText('Content'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateMemory).toHaveBeenCalledWith('m1', { content: 'Deploys on Mondays.' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ content: 'Deploys on Mondays.' }), true);
  });

  it('keeps the draft and says why when saving fails', async () => {
    vi.mocked(api.updateMemory).mockRejectedValue(new Error('offline'));
    const { onSaved } = renderEdit();
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'ci' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your changes: offline');
    expect(screen.getByLabelText('Tags')).toHaveValue('ci');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Cancel hands back without saving', () => {
    const { onCancel } = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.updateMemory).not.toHaveBeenCalled();
  });
});
