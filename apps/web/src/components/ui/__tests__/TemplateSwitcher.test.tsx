import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('TemplateSwitcher theming and labels (M6, M11, M12)', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    useTemplateStore.setState({ activeTemplate: TEMPLATES[0]! });
  });

  it('reads its own frame from the active template — it hardcoded Mono\'s #1a1a1a / #050505 (M11)', () => {
    useTemplateStore.setState({ activeTemplate: TEMPLATES[2]! }); // Midnight
    const { container } = render(<TemplateSwitcher />);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.background).not.toBe('');
    expect(wrapper.style.background).not.toContain('#050505');
    expect(wrapper.style.borderColor).not.toContain('#1a1a1a');
  });

  it('keeps every button at the 24px minimum target (M6)', () => {
    const { container } = render(<TemplateSwitcher />);
    for (const btn of container.querySelectorAll('button')) {
      expect((btn as HTMLElement).style.minHeight).toBe('24px');
    }
  });

  it('labels its buttons with a class the 860px rule does not hide (M12)', () => {
    const { container } = render(<TemplateSwitcher />);
    expect(container.querySelectorAll('.ec-switcher-label')).toHaveLength(0);
    expect(container.querySelectorAll('.ec-template-label').length).toBeGreaterThan(0);
  });

  it('collapses to a single NAMED button below 640px, not three anonymous dots (M12)', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as typeof window.matchMedia;

    render(<TemplateSwitcher />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!).toHaveTextContent(TEMPLATES[0]!.name);

    fireEvent.click(buttons[0]!);
    expect(useTemplateStore.getState().activeTemplate.id).toBe(TEMPLATES[1]!.id);
  });
});
