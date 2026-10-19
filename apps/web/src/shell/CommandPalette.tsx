import { useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { useRouteStore } from './routeStore.js';
import { useTheme, type ColourMode } from './theme.js';
import { useScopeChoices } from './ScopeSwitch.js';
import { showToast } from './Toasts.js';
import { Icon, type IconName } from './icons.js';
import { useMemoryStore } from '../store/memoryStore.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Focus the search field (the shell knows where it is). */
  onSearch: () => void;
  onStore: () => void;
}

/** `g` then a letter goes to a destination; the shell binds these keys. */
export const GO_KEYS: Record<string, string> = {
  m: '/',
  r: '/recall',
  v: '/review',
  t: '/timeline',
  i: '/insights',
  s: '/settings',
};

const DESTINATIONS: { label: string; icon: IconName; to: string; key?: string; keywords?: string[] }[] = [
  { label: 'Map', icon: 'map', to: '/', key: 'm', keywords: ['home', 'memories'] },
  { label: 'Ask what my AI knows', icon: 'route', to: '/recall', key: 'r', keywords: ['recall', 'context'] },
  { label: 'Review queue', icon: 'review', to: '/review', key: 'v', keywords: ['contradictions', 'duplicates'] },
  { label: 'Timeline', icon: 'time', to: '/timeline', key: 't', keywords: ['date', 'history'] },
  { label: 'Insights: numbers', icon: 'insight', to: '/insights', key: 'i', keywords: ['analytics', 'charts'] },
  { label: 'Insights: reflections', icon: 'insight', to: '/insights/reflections', keywords: ['patterns'] },
  { label: 'Settings', icon: 'settings', to: '/settings', key: 's', keywords: ['version', 'appearance'] },
  { label: 'Connect an AI', icon: 'plug', to: '/welcome', keywords: ['onboarding', 'setup', 'mcp', 'claude', 'cursor'] },
];

const MODES: { mode: ColourMode; label: string; icon: IconName; done: string }[] = [
  { mode: 'light', label: 'Light mode', icon: 'sun', done: 'Light mode on' },
  { mode: 'dark', label: 'Dark mode', icon: 'moon', done: 'Dark mode on' },
  { mode: 'auto', label: 'Match system colours', icon: 'contrast', done: 'Colours follow the system' },
];

/**
 * Plain word matching: cmdk's default fuzzy score ranked a command that
 * merely held the letters d-a-r-k above "Dark mode" for "dark". Every typed word must appear; a
 * command whose name starts with the first word ranks first, then one whose
 * name holds it, then one that matches by keyword only.
 */
export function matchCommand(value: string, search: string, keywords: string[] = []): number {
  const name = value.toLowerCase();
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${name} ${keywords.join(' ').toLowerCase()}`;
  if (words.length === 0) return 1;
  if (!words.every((w) => hay.includes(w))) return 0;
  return name.startsWith(words[0]!) ? 1 : name.includes(words[0]!) ? 0.8 : 0.5;
}

/**
 * ⌘K: every destination, the main actions, colour mode and project scope,
 * filtered as you type. A modal: focus stays inside, Escape or a click on the
 * scrim closes, and focus goes back where it was.
 */
export default function CommandPalette({ open, onClose, onSearch, onStore }: Props) {
  const navigate = useRouteStore((s) => s.navigate);
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const choices = useScopeChoices();
  const filter = useMemoryStore((s) => s.projectFilter);
  const setFilter = useMemoryStore((s) => s.setProjectFilter);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Remember what had focus before taking it, so closing can give it back.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => returnFocus.current?.focus();
  }, [open]);

  if (!open) return null;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      className="at-pal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        className="at-pal"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          // The field is the dialog's one stop; arrows move through the list.
          if (event.key === 'Tab') event.preventDefault();
        }}
      >
        <Command label="Commands" loop filter={matchCommand}>
          <div className="at-pal-q">
            <Icon name="search" size={20} />
            <Command.Input ref={inputRef} placeholder="Type a command or search" />
            <kbd>esc</kbd>
          </div>
          <Command.List>
            <Command.Empty>No command matches.</Command.Empty>
            <Command.Group heading="Do">
              <Item icon="search" label="Search your memories" keys={['/']} onSelect={run(onSearch)} keywords={['find']} />
              <Item icon="plus" label="Store a memory" onSelect={run(onStore)} keywords={['new', 'add', 'write']} />
            </Command.Group>
            <Command.Group heading="Go to">
              {DESTINATIONS.map((d) => (
                <Item
                  key={d.to}
                  icon={d.icon}
                  label={d.label}
                  keys={d.key ? ['G', d.key.toUpperCase()] : undefined}
                  keywords={d.keywords}
                  onSelect={run(() => navigate(d.to))}
                />
              ))}
            </Command.Group>
            {choices.length > 2 && (
              <Command.Group heading="Project">
                {choices.map((c) => (
                  <Item
                    key={c.value ?? String(c.value)}
                    icon="layers"
                    label={c.value === undefined ? 'Show all projects' : `Show ${c.label}`}
                    keywords={['project', 'scope', c.detail ?? '']}
                    current={c.value === filter}
                    onSelect={run(() => setFilter(c.value))}
                  />
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Colours">
              {MODES.map((m) => (
                <Item
                  key={m.mode}
                  icon={m.icon}
                  label={m.label}
                  keywords={['theme', 'colour', 'color', 'appearance']}
                  current={m.mode === mode}
                  onSelect={run(() => {
                    setMode(m.mode);
                    showToast(m.done);
                  })}
                />
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

interface ItemProps {
  icon: IconName;
  label: string;
  onSelect: () => void;
  keys?: string[];
  keywords?: string[];
  current?: boolean;
}

function Item({ icon, label, onSelect, keys, keywords, current }: ItemProps) {
  return (
    <Command.Item value={label} keywords={keywords} onSelect={onSelect}>
      <Icon name={icon} size={18} />
      <span className="at-pal-label">{label}</span>
      {current && <small className="at-pal-current">Current</small>}
      {keys && (
        <span className="at-keys" aria-hidden="true">
          {keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
