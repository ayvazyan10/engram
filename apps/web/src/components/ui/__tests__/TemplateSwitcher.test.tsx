import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TemplateSwitcher from '../TemplateSwitcher.js';
import { useTemplateStore, TEMPLATES } from '../../../store/templateStore.js';

describe('TemplateSwitcher', () => {
  beforeEach(() => {
    useTemplateStore.setState({ activeTemplate: TEMPLATES[0]! });
  });

  it('renders a button per template and marks the active one', () => {
    render(<TemplateSwitcher />);
    expect(screen.getByRole('button', { name: TEMPLATES[0]!.name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TEMPLATES[1]!.name })).toBeInTheDocument();
  });

  it('switches the active template on click', () => {
    render(<TemplateSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: TEMPLATES[1]!.name }));
    expect(useTemplateStore.getState().activeTemplate.id).toBe(TEMPLATES[1]!.id);
  });
});
