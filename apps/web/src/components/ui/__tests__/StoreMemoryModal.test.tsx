import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoreMemoryModal from '../StoreMemoryModal.js';

describe('StoreMemoryModal drag-select close bug (W7)', () => {
  it('does not close when a text selection drag starts inside the modal and the mouseup lands on the overlay', () => {
    const onClose = vi.fn();
    render(<StoreMemoryModal onClose={onClose} onStored={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/what do you want to remember/i);
    const overlay = textarea.closest('[role="dialog"]')!.parentElement!;

    // Simulates dragging a text selection from inside the textarea and
    // releasing outside the modal — mousedown target is the textarea,
    // mouseup/click target is the overlay itself.
    fireEvent.mouseDown(textarea);
    fireEvent.click(overlay, { target: overlay });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a genuine click on the overlay background (mousedown and click both on the overlay)', () => {
    const onClose = vi.fn();
    render(<StoreMemoryModal onClose={onClose} onStored={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/what do you want to remember/i);
    const overlay = textarea.closest('[role="dialog"]')!.parentElement!;

    fireEvent.mouseDown(overlay, { target: overlay });
    fireEvent.click(overlay, { target: overlay });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StoreMemoryModal accessibility (W7)', () => {
  it('exposes dialog semantics: role, aria-modal, and a label pointing at the visible title', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Store Memory');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<StoreMemoryModal onClose={onClose} onStored={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every field has a label associated via htmlFor/id', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/importance/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/concept/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
  });

  it('gives the icon-only close button an accessible name', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('traps Tab focus inside the dialog rather than letting it escape to the background', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('StoreMemoryModal fields (M5, M9)', () => {
  it('shows importance as a percentage, like every other surface (M9)', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('0.7')).not.toBeInTheDocument();
  });

  it('steps the importance slider finely enough to express the values the API returns', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    expect(screen.getByLabelText(/importance/i)).toHaveAttribute('step', '0.05');
  });

  it('makes every form control inherit the body font — the select and both inputs did not (M5)', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    for (const field of [
      screen.getByLabelText(/type/i),
      screen.getByLabelText(/concept/i),
      screen.getByLabelText(/tags/i),
      screen.getByPlaceholderText(/what do you want to remember/i),
    ]) {
      expect((field as HTMLElement).style.fontFamily).toBe('inherit');
    }
  });

  it('strips the native chrome off the select, which stayed light inside a dark panel (M5)', () => {
    render(<StoreMemoryModal onClose={vi.fn()} onStored={vi.fn()} />);
    const select = screen.getByLabelText(/type/i);
    expect(select.className).toContain('ec-select');
    // The caret is painted by that class — an inline `background` shorthand
    // here would reset its background-image and silently erase it, so the
    // surface colour has to come through the longhand.
    expect(select.getAttribute('style')).toContain('background-color');
    expect(select.style.backgroundImage).toBe('');
  });
});
