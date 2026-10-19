import { create } from 'zustand';

/**
 * Hash routing, with no router dependency. `#/timeline`, `#/insights/reflections`,
 * `#/recall?q=sync`; `?m=<id>` opens a memory over any route. An unknown path
 * lands on the map.
 */
export type RouteName = 'map' | 'recall' | 'review' | 'timeline' | 'insights' | 'settings' | 'welcome' | 'plates';

export interface Route {
  name: RouteName;
  /** The second path segment: a review queue, an Insights tab. */
  sub: string | null;
  params: Record<string, string>;
}

const NAMES: readonly RouteName[] = ['map', 'recall', 'review', 'timeline', 'insights', 'settings', 'welcome', 'plates'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const queryAt = raw.indexOf('?');
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const query = queryAt === -1 ? '' : raw.slice(queryAt + 1);
  const [first, sub] = path.split('/').filter(Boolean);
  const name = NAMES.find((n) => n === first) ?? 'map';
  return { name, sub: name === 'map' ? null : (sub ?? null), params: Object.fromEntries(new URLSearchParams(query)) };
}

export function toHash(route: Route): string {
  const path = route.name === 'map' ? '/' : `/${route.name}${route.sub ? `/${route.sub}` : ''}`;
  const query = new URLSearchParams(route.params).toString();
  return `#${path}${query ? `?${query}` : ''}`;
}

interface RouteState {
  route: Route;
  /** Goes to a hash such as '/timeline' or '#/insights/reflections', as a new
   *  history entry, so Back returns. */
  navigate: (to: string) => void;
  /** Sets or clears one query parameter in place, without a history entry. */
  setParam: (key: string, value: string | null) => void;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  route: parseHash(window.location.hash),
  navigate: (to) => {
    const hash = to.startsWith('#') ? to : `#${to}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    set({ route: parseHash(hash) });
  },
  setParam: (key, value) => {
    const { route } = get();
    if ((route.params[key] ?? null) === value) return;
    const params = { ...route.params };
    if (value === null) delete params[key];
    else params[key] = value;
    const next = { ...route, params };
    window.history.replaceState(window.history.state, '', toHash(next));
    set({ route: next });
  },
}));

// Back, Forward, a typed URL and plain <a href="#/…"> links all land here.
window.addEventListener('hashchange', () => {
  useRouteStore.setState({ route: parseHash(window.location.hash) });
});
