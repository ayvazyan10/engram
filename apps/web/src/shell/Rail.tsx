import { useRouteStore, type RouteName } from './routeStore.js';
import { useNeuralStore } from '../store/neuralStore.js';
import { Icon, Logo, compactCount, type IconName } from './icons.js';

export interface NavItem {
  name: RouteName;
  label: string;
  icon: IconName;
  href: string;
  /** What the destination holds, for the tooltip. */
  hint?: string;
}

export const MAP: NavItem = { name: 'map', label: 'Map', icon: 'map', href: '#/' };
export const RECALL: NavItem = { name: 'recall', label: 'Recall', icon: 'route', href: '#/recall', hint: 'What my AI knows' };
export const TIMELINE: NavItem = { name: 'timeline', label: 'Timeline', icon: 'time', href: '#/timeline' };
export const INSIGHTS: NavItem = { name: 'insights', label: 'Insights', icon: 'insight', href: '#/insights', hint: 'Numbers and reflections' };
export const REVIEW: NavItem = { name: 'review', label: 'Review', icon: 'review', href: '#/review', hint: 'Contradictions, duplicates and fading memories' };
export const SETTINGS: NavItem = { name: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' };

/** The onboarding is reached from inside Settings. */
export function isCurrent(item: RouteName, route: RouteName): boolean {
  return item === route || (item === 'settings' && route === 'welcome');
}

/** One destination: icon over its word, the Review count on its corner. */
export function NavLink({ item, current, count }: { item: NavItem; current: boolean; count?: number }) {
  return (
    <a href={item.href} className="at-nav" aria-current={current ? 'page' : undefined} title={item.hint ?? item.label}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {count !== undefined && count > 0 && (
        <span className="at-badge">
          <span aria-hidden="true">{compactCount(count)}</span>
          <span className="at-sr">, {count.toLocaleString('en-US')} waiting</span>
        </span>
      )}
    </a>
  );
}

/** The desktop rail: brand, the six destinations, and the live status. */
export default function Rail({ reviewCount }: { reviewCount: number }) {
  const route = useRouteStore((s) => s.route.name);
  const isConnected = useNeuralStore((s) => s.isConnected);
  const items = [MAP, RECALL, TIMELINE, INSIGHTS, REVIEW, SETTINGS];

  return (
    <nav className="at-rail" aria-label="Engram">
      <a href="#/" className="at-logo" aria-label="Engram, the map">
        <Logo />
      </a>
      <ul className="at-rail-list">
        {items.map((item) => (
          <li key={item.name}>
            <NavLink item={item} current={isCurrent(item.name, route)} count={item === REVIEW ? reviewCount : undefined} />
          </li>
        ))}
      </ul>
      <div
        className="at-live"
        data-on={isConnected}
        role="status"
        title={isConnected ? 'Live updates connected' : 'Live updates disconnected: the dashboard shows what it last loaded'}
      >
        <i aria-hidden="true" />
        {isConnected ? 'Live' : 'Offline'}
      </div>
    </nav>
  );
}
